/**
 * PDF-Generator: Erstellt eine Zusammenfassungs-PDF, sortiert nach Fach und Woche
 */
const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');

const OUTPUT_DIR = path.join(__dirname, '../summaries');
const FONTS_DIR = path.join(__dirname, 'fonts');

// Farbpalette
const COLORS = {
    primary: '#1a73e8',
    secondary: '#34a853',
    accent: '#ea4335',
    bg: '#f8f9fa',
    dark: '#202124',
    gray: '#5f6368',
    lightGray: '#dadce0',
    white: '#ffffff',
    // Fach-Farben für TüTool
    subjects: {
        'Anatomie': '#e53935',
        'Physiologie': '#1e88e5',
        'Biochemie': '#43a047',
        'Histologie': '#fb8c00',
        'Biologie': '#00acc1',
        'Physik': '#8e24aa',
        'Chemie': '#3949ab',
        'SIMED': '#e91e63',
        'MOODLE': '#1a73e8',
        'ILIAS': '#34a853',
        'ALMA': '#fb8c00',
        'default': '#607d8b'
    }
};

function getSubjectColor(subjectName) {
    for (const [key, color] of Object.entries(COLORS.subjects)) {
        if (subjectName.toLowerCase().includes(key.toLowerCase())) return color;
    }
    return COLORS.subjects.default;
}

function groupBySubjectAndWeek(subjects) {
    const grouped = {};
    for (const item of subjects) {
        const subject = item.courseTitle || 'Allgemein';
        if (!grouped[subject]) grouped[subject] = {};
        const week = item.week || 0;
        if (!grouped[subject][week]) grouped[subject][week] = [];
        grouped[subject][week].push(item);
    }
    return grouped;
}

async function generateSummaryPDF(subjects) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    const outputPath = path.join(OUTPUT_DIR, `Lernplan_SoSe2026_${Date.now()}.pdf`);

    return new Promise((resolve, reject) => {
        const doc = new PDFDocument({
            size: 'A4',
            bufferPages: true,
            margins: { top: 50, bottom: 50, left: 50, right: 50 },
            info: {
                Title: 'TüTool Lernplan – Sommersemester 2026',
                Author: 'Uni Tübingen Lernplan App',
                Subject: 'Lernplan nach Fächern und Wochen'
            }
        });

        const stream = fs.createWriteStream(outputPath);
        doc.pipe(stream);
        doc.registerFont('Roboto', path.join(FONTS_DIR, 'Roboto-Regular.ttf'));
        doc.registerFont('Roboto-Bold', path.join(FONTS_DIR, 'Roboto-Bold.ttf'));
        doc.font('Roboto');

        // ─── DECKBLATT ───────────────────────────────────────────────────
        doc.rect(0, 0, doc.page.width, 200).fill(COLORS.primary);
        doc.fill(COLORS.white)
            .fontSize(28).font('Roboto-Bold')
            .text('TüTool Lernplan', 50, 70, { width: doc.page.width - 100, align: 'center' })
            .fontSize(16).font('Roboto')
            .text('Sommersemester 2026 – Universität Tübingen', 50, 115, { width: doc.page.width - 100, align: 'center' })
            .fontSize(11).font('Roboto')
            .text(`Erstellt am: ${new Date().toLocaleDateString('de-DE', { day: '2-digit', month: 'long', year: 'numeric' })}`, 50, 155, { width: doc.page.width - 100, align: 'center' });

        doc.fill(COLORS.dark).moveDown(8);

        // ─── INHALTSVERZEICHNIS ──────────────────────────────────────────
        doc.fontSize(18).font('Roboto-Bold').fill(COLORS.primary)
            .text('Inhaltsverzeichnis', 50, 230);
        doc.moveTo(50, 255).lineTo(545, 255).strokeColor(COLORS.primary).stroke();

        const grouped = groupBySubjectAndWeek(subjects);
        const subjectNames = Object.keys(grouped).sort();
        let tocY = 270;

        subjectNames.forEach((subject, i) => {
            const color = getSubjectColor(subject);
            doc.roundedRect(50, tocY, 8, 16, 2).fill(color);
            doc.fontSize(11).font('Roboto').fill(COLORS.dark)
                .text(`${i + 1}. ${subject}`, 68, tocY + 2);
            const weekCount = Object.keys(grouped[subject]).length;
            const itemCount = Object.values(grouped[subject]).flat().length;
            doc.fill(COLORS.gray).fontSize(9)
                .text(`${weekCount} Wochen · ${itemCount} Vorlesungen`, 350, tocY + 3);
            tocY += 24;

            if (tocY > 750) {
                doc.addPage();
                tocY = 50;
            }
        });

        // ─── FÄCHER-SEITEN ────────────────────────────────────────────────
        subjectNames.forEach((subject, subIdx) => {
            doc.addPage();

            const color = getSubjectColor(subject);

            // Fach-Header
            doc.rect(0, 0, doc.page.width, 90).fill(color);
            doc.fill(COLORS.white)
                .fontSize(22).font('Roboto-Bold')
                .text(subject, 50, 25, { width: doc.page.width - 100 })
                .fontSize(11).font('Roboto')
                .text(`Sommersemester 2026 · ${Object.keys(grouped[subject]).length} Wochen`, 50, 58);

            let y = 110;
            const weeks = Object.keys(grouped[subject]).map(Number).sort((a, b) => a - b);

            for (const week of weeks) {
                const items = grouped[subject][week];

                // Wochen-Header
                if (y > 720) { doc.addPage(); y = 50; }
                doc.roundedRect(50, y, 350, 24, 4).fill(color + '22');
                doc.fill(color).fontSize(12).font('Roboto-Bold')
                    .text(`📅  Woche ${week}  (KW ${week})`, 60, y + 5);

                // Startdatum berechnen (SoSe 2026 beginnt ~20. April 2026)
                const semesterStart = new Date('2026-04-20');
                const weekStart = new Date(semesterStart);
                weekStart.setDate(semesterStart.getDate() + (week - 1) * 7);
                const weekEnd = new Date(weekStart);
                weekEnd.setDate(weekStart.getDate() + 6);
                const formatDate = d => d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' });
                doc.fill(COLORS.gray).fontSize(9).font('Roboto')
                    .text(`${formatDate(weekStart)} – ${formatDate(weekEnd)}`, 410, y + 7);

                y += 32;

                for (const item of items) {
                    if (y > 720) { doc.addPage(); y = 50; }

                    // Vorlesungstitel
                    doc.fill(COLORS.dark).fontSize(10).font('Roboto-Bold')
                        .text(`• ${item.title}`, 60, y, { width: 480 });
                    y += 16;

                    // Themen
                    if (item.topics && item.topics.length > 0) {
                        const topicsText = item.topics.slice(0, 10).join(' · ');
                        doc.fill(COLORS.gray).fontSize(9).font('Roboto')
                            .text(`  Themen: ${topicsText}`, 68, y, { width: 465, lineGap: 2 });
                        y += doc.heightOfString(topicsText, { width: 465 }) + 8;
                    } else {
                        y += 10;
                    }

                    // Plattform-Badge
                    const platform = item.platform || 'Unbekannt';
                    doc.roundedRect(68, y - 8, platform.length * 6 + 8, 12, 3)
                        .fill(color + '33');
                    doc.fill(color).fontSize(7).font('Roboto-Bold')
                        .text(platform, 72, y - 6);
                    y += 10;
                }
                y += 12;
            }
        });

        // ─── LETZTE SEITE: Lernhinweise ─────────────────────────────────
        doc.addPage();
        doc.rect(0, 0, doc.page.width, 60).fill(COLORS.primary);
        doc.fill(COLORS.white).fontSize(18).font('Roboto-Bold')
            .text('💡 Lernhinweise', 50, 18);

        const tips = [
            ['Regelmäßigkeit', 'Lerne täglich 4–6 Stunden, verteilt auf mehrere Sessions.'],
            ['Aktives Lernen', 'Nutze Karteikarten (Anki) und erkläre Themen in eigenen Worten.'],
            ['Verknüpfungen', 'Verbinde Anatomie-, Physiologie- und Biochemie-Inhalte miteinander.'],
            ['Pausen', 'Pomodoro-Technik: 25 Min lernen, 5 Min Pause.'],
            ['Vorkurs-Wiederholung', 'Wiederhole Grundlagen aus Biologie, Chemie und Physik regelmäßig.'],
            ['Klinischer Bezug', 'Frage dich bei jedem Thema: „Wann ist das klinisch relevant?"']
        ];

        let tipY = 80;
        tips.forEach(([title, text]) => {
            doc.fill(COLORS.primary).fontSize(11).font('Roboto-Bold').text(`${title}:`, 50, tipY);
            doc.fill(COLORS.gray).fontSize(10).font('Roboto').text(text, 50, tipY + 14, { width: 495 });
            tipY += 45;
        });

        doc.end();
        stream.on('finish', () => resolve(outputPath));
        stream.on('error', reject);
    });
}

module.exports = { generateSummaryPDF };
