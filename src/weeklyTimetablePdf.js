/**
 * Wochenplan PDF Generator – Querformat
 * Erstellt eine kompakte Wochenübersicht im Landscape-Format für den Mail-Anhang
 */
const PDFDocument = require('pdfkit');
const path = require('path');
const fs = require('fs');

const FONTS_DIR = path.join(__dirname, 'fonts');

const DAY_NAMES = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
const DAY_SHORT = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];

const SUBJECT_COLORS = {
    'Anatomie': [239, 68, 68],
    'Physiologie': [59, 130, 246],
    'Biochemie': [34, 197, 94],
    'Histologie': [249, 115, 22],
    'Biologie': [6, 182, 212],
    'Physik': [168, 85, 247],
    'Chemie': [99, 102, 241],
    'SIMED': [236, 72, 153],
};

function subjectRgb(subject) {
    if (!subject) return [100, 116, 139];
    for (const [key, rgb] of Object.entries(SUBJECT_COLORS)) {
        if (subject.toLowerCase().includes(key.toLowerCase())) return rgb;
    }
    return [100, 116, 139];
}

/**
 * events: Array von Timetable-Events mit .date, .title, .timeFrom, .timeTo, .location, .mandatory
 * weekLabel: string z. B. "KW 18 · 04.05. – 10.05.2026"
 * Returns: Buffer (PDF-Inhalt)
 */
async function generateWeeklyTimetablePDF(events, weekLabel = '') {
    return new Promise((resolve, reject) => {
        const chunks = [];

        const doc = new PDFDocument({
            size: 'A4',
            layout: 'landscape',       // ← Querformat!
            margins: { top: 36, bottom: 36, left: 36, right: 36 },
            info: { Title: `Stundenplan ${weekLabel}`, Author: 'TüTool' },
            bufferPages: true,
        });

        doc.registerFont('Roboto', path.join(FONTS_DIR, 'Roboto-Regular.ttf'));
        doc.registerFont('Roboto-Bold', path.join(FONTS_DIR, 'Roboto-Bold.ttf'));
        doc.font('Roboto');

        doc.on('data', chunk => chunks.push(chunk));
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        doc.on('error', reject);

        const PW = doc.page.width;   // A4 landscape: 841.89
        const PH = doc.page.height;  // A4 landscape: 595.28
        const ML = 36, MR = 36, MT = 36, MB = 36;
        const CONTENT_W = PW - ML - MR;
        const CONTENT_H = PH - MT - MB;

        // ── Header ─────────────────────────────────────────────────
        doc.rect(0, 0, PW, 52).fill('#1a1a2e');
        doc.rect(0, 0, PW, 4).fill('#5b8def');

        doc.fillColor('#ffffff').fontSize(16).font('Roboto-Bold')
            .text('Stundenplan', ML, 14, { width: CONTENT_W / 2 });
        doc.fillColor('#94a3b8').fontSize(11).font('Roboto')
            .text(`TüTool · ${weekLabel}`, ML, 34);
        doc.fillColor('#94a3b8').fontSize(10)
            .text(`Erstellt: ${new Date().toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}`,
                ML + CONTENT_W / 2, 14, { width: CONTENT_W / 2, align: 'right' });

        const tableTop = 62;
        const tableHeight = PH - MB - tableTop;

        // Filter events for week
        const sortedEvents = [...events].sort((a, b) => new Date(a.date) - new Date(b.date));

        // Group by weekday (Mon–Fri, then Sat, Sun)
        const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0];
        const byDay = {};
        sortedEvents.forEach(e => {
            if (!e.date) return;
            const d = new Date(e.date);
            const key = d.getDay();
            if (!byDay[key]) byDay[key] = { date: d, events: [] };
            byDay[key].events.push(e);
        });

        const activeDays = DAY_ORDER.filter(d => byDay[d]);

        if (activeDays.length === 0) {
            doc.fillColor('#64748b').fontSize(14).font('Roboto')
                .text('Keine Veranstaltungen diese Woche.', ML, tableTop + 40, { width: CONTENT_W, align: 'center' });
            doc.end();
            return;
        }

        const colW = CONTENT_W / activeDays.length;
        const COL_PADDING = 6;

        // ── Day Headers ─────────────────────────────────────────────
        activeDays.forEach((dayNum, i) => {
            const x = ML + i * colW;
            const { date } = byDay[dayNum];
            const isToday = new Date().toDateString() === date.toDateString();

            doc.rect(x + 1, tableTop, colW - 2, 26)
                .fill(isToday ? '#2563eb' : '#1e293b');

            doc.fillColor(isToday ? '#ffffff' : '#94a3b8')
                .fontSize(10).font('Roboto-Bold')
                .text(DAY_SHORT[dayNum], x + COL_PADDING, tableTop + 4, { width: colW - COL_PADDING * 2, align: 'left' });
            doc.fillColor(isToday ? '#bfdbfe' : '#64748b')
                .fontSize(9).font('Roboto')
                .text(date.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' }),
                    x + COL_PADDING, tableTop + 15, { width: colW - COL_PADDING * 2, align: 'left' });
        });

        // ── Events per column ────────────────────────────────────────
        const eventsTop = tableTop + 30;
        const MAX_EVENTS_H = PH - MB - eventsTop;

        activeDays.forEach((dayNum, i) => {
            const x = ML + i * colW;
            const { events: dayEvents } = byDay[dayNum];
            dayEvents.sort((a, b) => (a.timeFrom || '').localeCompare(b.timeFrom || ''));

            let y = eventsTop;
            const slotH = Math.min(70, Math.floor(MAX_EVENTS_H / Math.max(dayEvents.length, 1)));

            dayEvents.forEach(e => {
                if (y + slotH > PH - MB) return; // Skip if out of page

                const [r, g, b] = subjectRgb(e.subject);

                // Card background
                doc.rect(x + 2, y + 2, colW - 4, slotH - 4)
                    .fillAndStroke(`rgba(${r},${g},${b},0.08)`, `rgb(${Math.round(r * 0.4)},${Math.round(g * 0.4)},${Math.round(b * 0.4)})`);

                // Left accent bar
                doc.rect(x + 2, y + 2, 3, slotH - 4)
                    .fill(`rgb(${r},${g},${b})`);

                const textX = x + 10;
                const textW = colW - 14;
                let textY = y + 6;

                // Mandatory badge
                if (e.mandatory) {
                    doc.rect(x + colW - 32, y + 4, 28, 11).fill('#ef4444');
                    doc.fillColor('#ffffff').fontSize(6).font('Roboto-Bold')
                        .text('PFLICHT', x + colW - 31, y + 6, { width: 26, align: 'center' });
                }

                // Time
                if (e.timeFrom) {
                    doc.fillColor('#94a3b8').fontSize(7).font('Roboto')
                        .text(`${e.timeFrom}${e.timeTo ? '–' + e.timeTo : ''}`, textX, textY, { width: textW });
                    textY += 9;
                }

                // Title
                doc.fillColor('#e2e8f0').fontSize(8).font('Roboto-Bold')
                    .text(e.title || '', textX, textY, {
                        width: textW,
                        height: slotH - (textY - y) - 4,
                        lineBreak: true,
                        ellipsis: true
                    });
                textY += 16;

                // Location
                if (e.location && textY + 9 < y + slotH) {
                    doc.fillColor('#64748b').fontSize(7).font('Roboto')
                        .text(`📍 ${e.location}`, textX, textY, { width: textW, ellipsis: true });
                }

                y += slotH;
            });
        });

        // ── Column separators ────────────────────────────────────────
        activeDays.forEach((_, i) => {
            if (i === 0) return;
            const x = ML + i * colW;
            doc.moveTo(x, tableTop).lineTo(x, PH - MB)
                .strokeColor('#1e293b').lineWidth(0.5).stroke();
        });

        // ── Footer ───────────────────────────────────────────────────
        const pageCount = doc.bufferedPageRange().count;
        for (let p = 0; p < pageCount; p++) {
            doc.switchToPage(p);
            doc.fillColor('#475569').fontSize(7).font('Roboto')
                .text(`TüTool · Automatisch erstellt · ${new Date().toLocaleDateString('de-DE')}`,
                    ML, PH - 22, { width: CONTENT_W, align: 'center' });
        }

        doc.end();
    });
}

module.exports = { generateWeeklyTimetablePDF };
