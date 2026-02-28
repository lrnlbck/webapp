/**
 * Lernplan PDF Generator
 * Erstellt eine Prüfungsübersicht als PDF
 */
const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');

const OUTPUT_DIR = path.join(__dirname, '../summaries');
const FONTS_DIR = path.join(__dirname, 'fonts');

async function generateLernplanPDF(exams) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    const outputPath = path.join(OUTPUT_DIR, `Pruefungsuebersicht_${Date.now()}.pdf`);

    return new Promise((resolve, reject) => {
        const doc = new PDFDocument({
            size: 'A4',
            bufferPages: true,
            margins: { top: 50, bottom: 50, left: 50, right: 50 },
            info: { Title: 'Prüfungsübersicht – TüTool', Author: 'TüTool App' }
        });

        const stream = fs.createWriteStream(outputPath);
        doc.pipe(stream);
        doc.registerFont('Roboto', path.join(FONTS_DIR, 'Roboto-Regular.ttf'));
        doc.registerFont('Roboto-Bold', path.join(FONTS_DIR, 'Roboto-Bold.ttf'));
        doc.font('Roboto');

        const W = doc.page.width;
        const MARGIN = 50;
        const CONTENT = W - 2 * MARGIN;

        // ── HEADER ──────────────────────────────────────────────────
        doc.rect(0, 0, W, 120).fill('#1a1a2e');
        doc.rect(0, 0, W, 4).fill('#5b8def');

        doc.fillColor('#ffffff').fontSize(26).font('Roboto-Bold')
            .text('Prüfungsübersicht', MARGIN, 35, { width: CONTENT });
        doc.fillColor('#94a3b8').fontSize(12).font('Roboto')
            .text(`TüTool · Erstellt am ${new Date().toLocaleDateString('de-DE', { day: '2-digit', month: 'long', year: 'numeric' })}`, MARGIN, 72);

        doc.moveDown(6);

        const activeExams = exams.filter(e => e.status === 'upcoming');
        const doneExams = exams.filter(e => e.status === 'done' || e.status === 'cancelled');

        if (activeExams.length === 0) {
            doc.fillColor('#64748b').fontSize(14).font('Roboto')
                .text('Keine aktiven Prüfungen.', MARGIN, 160, { width: CONTENT, align: 'center' });
        } else {
            let y = 160;

            // ── Statistik Box ────────────────────────────────────────
            doc.roundedRect(MARGIN, y, CONTENT, 50, 8).fill('#f1f5f9');
            doc.fillColor('#1e293b').fontSize(11).font('Roboto-Bold')
                .text(`Gesamt: ${exams.length} Prüfungen`, MARGIN + 16, y + 10);
            doc.fillColor('#059669').fontSize(11).font('Roboto')
                .text(`✓ Abgeschlossen: ${doneExams.length}`, MARGIN + 200, y + 10);
            doc.fillColor('#ef4444').fontSize(11)
                .text(`⏳ Ausstehend: ${activeExams.length}`, MARGIN + 380, y + 10);

            const totalHours = activeExams.reduce((s, e) => s + (e.hoursNeeded || 0), 0);
            doc.fillColor('#5b8def').fontSize(10)
                .text(`Gesamt-Lernaufwand: ~${totalHours}h`, MARGIN + 16, y + 28);
            y += 70;

            // ── Aktive Prüfungen ─────────────────────────────────────
            doc.fillColor('#1e293b').fontSize(15).font('Roboto-Bold').text('Anstehende Prüfungen', MARGIN, y);
            doc.moveTo(MARGIN, y + 22).lineTo(W - MARGIN, y + 22).strokeColor('#e2e8f0').stroke();
            y += 35;

            for (const exam of activeExams) {
                if (y > 700) { doc.addPage(); y = 50; }

                const examDate = new Date(exam.examDate).toLocaleDateString('de-DE', {
                    weekday: 'long', day: '2-digit', month: 'long', year: 'numeric'
                });
                const daysLeft = Math.ceil((new Date(exam.examDate) - new Date()) / (1000 * 60 * 60 * 24));

                // Fach-Chip
                doc.roundedRect(MARGIN, y, 8, 60, 2).fill('#ef4444');

                // Titel
                doc.fillColor('#1e293b').fontSize(13).font('Roboto-Bold')
                    .text(exam.subject, MARGIN + 20, y + 4);

                // Datum & Info
                doc.fillColor('#64748b').fontSize(10).font('Roboto')
                    .text(`📅  ${examDate}`, MARGIN + 20, y + 22);
                doc.fillColor('#94a3b8').fontSize(10)
                    .text(`📚  Lernaufwand: ~${exam.hoursNeeded || 0}h   |   📆  Lernstart: ${exam.learnStartDate ? new Date(exam.learnStartDate).toLocaleDateString('de-DE') : '–'}   |   ⏳  Noch ${daysLeft > 0 ? daysLeft + ' Tage' : 'Heute!'}`,
                        MARGIN + 20, y + 36);

                // Themen
                if (exam.selectedTopics && exam.selectedTopics.length > 0) {
                    const topicsStr = exam.selectedTopics.slice(0, 8).join(' · ') +
                        (exam.selectedTopics.length > 8 ? ` · +${exam.selectedTopics.length - 8} weitere` : '');
                    doc.fillColor('#475569').fontSize(9)
                        .text(`🗒  ${topicsStr}`, MARGIN + 20, y + 50, { width: CONTENT - 30 });
                }

                y += 80;
                doc.moveTo(MARGIN + 20, y - 8).lineTo(W - MARGIN, y - 8).strokeColor('#f1f5f9').lineWidth(0.5).stroke();
            }

            // ── Abgeschlossene ───────────────────────────────────────
            if (doneExams.length > 0) {
                if (y > 650) { doc.addPage(); y = 50; }
                y += 20;
                doc.fillColor('#94a3b8').fontSize(13).font('Roboto-Bold').text('Abgeschlossen / Nicht angetreten', MARGIN, y);
                doc.moveTo(MARGIN, y + 20).lineTo(W - MARGIN, y + 20).strokeColor('#e2e8f0').stroke();
                y += 32;

                for (const exam of doneExams) {
                    if (y > 720) { doc.addPage(); y = 50; }
                    doc.fillColor('#94a3b8').fontSize(11).font('Roboto')
                        .text(`✓  ${exam.subject}  –  ${new Date(exam.examDate).toLocaleDateString('de-DE')}`, MARGIN, y);
                    y += 22;
                }
            }
        }

        // ── Footer ───────────────────────────────────────────────────
        const pageCount = doc.bufferedPageRange().count;
        for (let i = 0; i < pageCount; i++) {
            doc.switchToPage(i);
            doc.fillColor('#94a3b8').fontSize(8)
                .text(`TüTool – Prüfungsübersicht  |  Seite ${i + 1} von ${pageCount}  |  ${new Date().toLocaleDateString('de-DE')}`,
                    MARGIN, doc.page.height - 40, { width: CONTENT, align: 'center' });
        }

        doc.end();
        stream.on('finish', () => resolve(outputPath));
        stream.on('error', reject);
    });
}

module.exports = { generateLernplanPDF };
