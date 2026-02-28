/**
 * Lernplan-Service
 * Verwaltet Prüfungen und generiert algorithmisch einen Lernplan
 */
const fs = require('fs');
const path = require('path');

const LERNPLAN_PATH = path.join(__dirname, '../cache/lernplan.json');

// ─── Persistenz ──────────────────────────────────────────────────
function loadExams() {
    try {
        if (fs.existsSync(LERNPLAN_PATH)) {
            return JSON.parse(fs.readFileSync(LERNPLAN_PATH, 'utf8'));
        }
    } catch { }
    return [];
}

function saveExams(exams) {
    fs.mkdirSync(path.dirname(LERNPLAN_PATH), { recursive: true });
    fs.writeFileSync(LERNPLAN_PATH, JSON.stringify(exams, null, 2));
}

// ─── UUID ohne externe Abhängigkeit ──────────────────────────────
function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
}

// ─── Planungsalgorithmus ─────────────────────────────────────────
/**
 * Generiert Lernblöcke für eine Prüfung.
 *
 * Regeln:
 *  - Lernzeit pro Thema: 45 Minuten
 *  - Maximal 3 Lernblöcke à 2 Stunden pro Tag
 *  - Keine Lernblöcke zwischen 22:00 und 07:00
 *  - Lernblöcke werden bevorzugt morgens (09:00) und nachmittags (14:00 / 18:00) angesetzt
 *  - Tage mit Pflichtveranstaltungen bekommen max. 1 Block
 *  - Keine Lernblöcke am Prüfungstag selbst
 *  - Vorlaufberechnung: 1 Tag pro Thema, mind. 3 Tage, max. 30 Tage vor Prüfung
 */
function generateLernplan(exam, timetableEvents = []) {
    const examDate = new Date(exam.examDate);
    examDate.setHours(0, 0, 0, 0);

    const topics = exam.selectedTopics || [];
    const minutesNeeded = topics.length * 45; // 45 min pro Thema
    const hoursNeeded = Math.ceil(minutesNeeded / 60);

    // Vorlauf berechnen: 1 Tag pro 2 Themen, mind. 3, max. 30
    const learnDaysNeeded = Math.max(3, Math.min(30, Math.ceil(topics.length / 2)));
    const startDate = new Date(examDate);
    startDate.setDate(examDate.getDate() - learnDaysNeeded);
    startDate.setHours(0, 0, 0, 0);

    // Verfügbare Lernslots pro Tag (Uhrzeit, Dauer in Minuten)
    const dailySlots = [
        { hour: 9, minute: 0, durationMin: 90, label: '09:00' },
        { hour: 14, minute: 0, durationMin: 90, label: '14:00' },
        { hour: 18, minute: 0, durationMin: 90, label: '18:00' },
    ];

    // Timetable Events nach Datum indexieren (als Menge von Tagen mit Pflichtveranstaltungen)
    const busyDays = new Set();
    (timetableEvents || []).forEach(e => {
        if (e.mandatory && e.date) {
            const d = new Date(e.date);
            busyDays.add(d.toDateString());
        }
    });

    // Themen auf Tage verteilen
    const blocks = [];
    let topicIndex = 0;
    let topicsPerDay = Math.max(1, Math.ceil(topics.length / learnDaysNeeded));

    const current = new Date(startDate);
    while (current < examDate && topicIndex < topics.length) {
        current.setHours(0, 0, 0, 0);
        const dateStr = current.toDateString();
        const isBusy = busyDays.has(dateStr);
        const maxSlotsToday = isBusy ? 1 : dailySlots.length;
        let slotsUsed = 0;

        for (const slot of dailySlots) {
            if (slotsUsed >= maxSlotsToday) break;
            if (topicIndex >= topics.length) break;

            // Maximal topicsPerDay Themen pro Block
            const chunkTopics = topics.slice(topicIndex, topicIndex + topicsPerDay);
            if (chunkTopics.length === 0) break;

            const blockDate = new Date(current);
            blockDate.setHours(slot.hour, slot.minute, 0, 0);
            const endDate = new Date(blockDate);
            endDate.setMinutes(endDate.getMinutes() + slot.durationMin);

            blocks.push({
                id: generateId(),
                examId: exam.id,
                subject: exam.subject,
                title: `📖 ${exam.subject} – Lernblock`,
                topics: chunkTopics,
                date: blockDate.toISOString(),
                timeFrom: slot.label,
                timeTo: `${String(endDate.getHours()).padStart(2, '0')}:${String(endDate.getMinutes()).padStart(2, '0')}`,
                durationMin: slot.durationMin,
                type: 'learn_block',
                color: '#059669'
            });

            topicIndex += chunkTopics.length;
            slotsUsed++;
        }

        current.setDate(current.getDate() + 1);
    }

    // Restliche Themen in letzte verfügbare Tage packen falls nötig
    if (topicIndex < topics.length && blocks.length > 0) {
        blocks[blocks.length - 1].topics.push(...topics.slice(topicIndex));
        blocks[blocks.length - 1].title += ` (+${topics.length - topicIndex} weitere)`;
    }

    return {
        blocks,
        hoursNeeded,
        learnDaysNeeded,
        startDate: startDate.toISOString()
    };
}

// ─── Öffentliche API ─────────────────────────────────────────────
function createExam(examData, timetableEvents = []) {
    const exams = loadExams();

    const exam = {
        id: generateId(),
        subject: examData.subject,
        examDate: examData.examDate,
        selectedTopics: examData.selectedTopics || [],
        notes: examData.notes || '',
        status: 'upcoming', // upcoming | done | cancelled
        showInCalendar: true,
        createdAt: new Date().toISOString()
    };

    const { blocks, hoursNeeded, learnDaysNeeded, startDate } = generateLernplan(exam, timetableEvents);
    exam.learnBlocks = blocks;
    exam.hoursNeeded = hoursNeeded;
    exam.learnDaysNeeded = learnDaysNeeded;
    exam.learnStartDate = startDate;

    // Prüfungstermin selbst als Block hinzufügen
    exam.examBlock = {
        id: generateId(),
        examId: exam.id,
        subject: exam.subject,
        title: `🎯 Prüfung: ${exam.subject}`,
        date: exam.examDate,
        timeFrom: '08:00',
        timeTo: '12:00',
        type: 'exam',
        color: '#ef4444'
    };

    exams.push(exam);
    saveExams(exams);
    return exam;
}

function updateExamStatus(id, status) {
    const exams = loadExams();
    const idx = exams.findIndex(e => e.id === id);
    if (idx === -1) return null;
    exams[idx].status = status;
    if (status === 'done' || status === 'cancelled') {
        exams[idx].showInCalendar = false;
    }
    saveExams(exams);
    return exams[idx];
}

function toggleCalendar(id, show) {
    const exams = loadExams();
    const idx = exams.findIndex(e => e.id === id);
    if (idx === -1) return null;
    exams[idx].showInCalendar = show;
    saveExams(exams);
    return exams[idx];
}

function deleteExam(id) {
    const exams = loadExams().filter(e => e.id !== id);
    saveExams(exams);
}

/**
 * Gibt alle Lernblöcke + Prüfungstermine für eine Woche zurück.
 * weekOffset=0 ist IMMER die aktuelle Woche (unabhängig vom Semester).
 */
function getCalendarEvents(weekOffset = 0) {
    const exams = loadExams().filter(e => e.showInCalendar && e.status === 'upcoming');

    // Aktuelle Kalender-Woche (Montag 00:00 bis Sonntag 23:59)
    const now = new Date();
    const dayOfWeek = now.getDay() === 0 ? 6 : now.getDay() - 1; // Mon=0 … Sun=6
    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() - dayOfWeek + weekOffset * 7);
    weekStart.setHours(0, 0, 0, 0);
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 7);

    const events = [];
    for (const exam of exams) {
        for (const block of (exam.learnBlocks || [])) {
            const d = new Date(block.date);
            if (d >= weekStart && d < weekEnd) {
                events.push({ ...block, examSubject: exam.subject });
            }
        }
        if (exam.examBlock) {
            const d = new Date(exam.examBlock.date);
            if (d >= weekStart && d < weekEnd) {
                events.push({ ...exam.examBlock, examSubject: exam.subject });
            }
        }
    }

    return events.sort((a, b) => new Date(a.date) - new Date(b.date));
}

module.exports = {
    loadExams,
    createExam,
    updateExamStatus,
    toggleCalendar,
    deleteExam,
    getCalendarEvents,
    generateLernplan
};
