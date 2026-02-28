/**
 * Statistik-PDF Generator – pdfkit-kompatibel
 * Erstellt einen Quellen- und Analysebericht als PDF
 */
const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');

const OUTPUT_DIR = path.join(__dirname, '../summaries');
const FONTS_DIR = path.join(__dirname, 'fonts');

const PLATFORM_COLORS = {
    'ILIAS': [52, 168, 83],
    'MOODLE': [26, 115, 232],
    'ALMA': [251, 140, 0],
    'SIMED': [236, 72, 153],
    'Demo': [139, 92, 246],
    'Unbekannt': [100, 116, 139],
};

function getPlatformRgb(platform) {
    return PLATFORM_COLORS[platform] || PLATFORM_COLORS['Unbekannt'];
}

function buildStats(subjects) {
    const stats = {
        totalDocuments: 0,
        totalTopics: 0,
        byPlatform: {},
        bySubject: {},
        documents: [],
        generatedAt: new Date()
    };

    const platforms = ['ILIAS', 'MOODLE', 'ALMA', 'SIMED', 'Demo', 'Unbekannt'];
    platforms.forEach(p => {
        stats.byPlatform[p] = { count: 0, topics: 0, subjects: new Set() };
    });

    subjects.forEach(subject => {
        const subjectName = subject.name || subject.courseTitle || 'Allgemein';
        if (!stats.bySubject[subjectName]) {
            stats.bySubject[subjectName] = { count: 0, topics: 0, platforms: new Set() };
        }

        (subject.lectures || []).forEach(lec => {
            const platform = lec.platform || 'Unbekannt';
            const topics = (lec.topics || []).length;
            const key = PLATFORM_COLORS[platform] ? platform : 'Unbekannt';

            stats.totalDocuments++;
            stats.totalTopics += topics;

            stats.byPlatform[key].count++;
            stats.byPlatform[key].topics += topics;
            stats.byPlatform[key].subjects.add(subjectName);

            stats.bySubject[subjectName].count++;
            stats.bySubject[subjectName].topics += topics;
            stats.bySubject[subjectName].platforms.add(platform);

            stats.documents.push({
                title: lec.title || 'Unbenannt',
                platform: key,
                subject: subjectName,
                topics,
                filePath: lec.filePath || null,
                week: lec.week || null
            });
        });
    });

    // Convert Sets to arrays
    Object.values(stats.byPlatform).forEach(p => { p.subjects = [...p.subjects]; });
    Object.values(stats.bySubject).forEach(s => { s.platforms = [...s.platforms]; });

    stats.topPlatform = Object.entries(stats.byPlatform)
        .filter(([, v]) => v.count > 0)
        .sort(([, a], [, b]) => b.count - a.count)[0]?.[0] || 'Keine';

    return stats;
}

// ─── Helper: draw filled rect ────────────────────────────────
function filledRect(doc, x, y, w, h, r, g, b) {
    doc.save().fillColor([r, g, b]).rect(x, y, w, h).fill().restore();
}

// ─── Helper: section divider line ────────────────────────────
function sectionLine(doc, y, accent) {
    doc.save().strokeColor(accent).lineWidth(0.5).moveTo(50, y).lineTo(545, y).stroke().restore();
}

// ─── Helper: section title ────────────────────────────────────
function sectionTitle(doc, text, y, accent) {
    doc.save()
        .fillColor(accent)
        .fontSize(14).font('Roboto-Bold')
        .text(text, 50, y)
        .restore();
    sectionLine(doc, y + 20, accent);
    return y + 32;
}

// ─── Helper: horizontal progress bar ─────────────────────────
function barChart(doc, x, y, totalW, h, fillRatio, rgb) {
    // Background
    doc.save().fillColor('#2a2a3a').rect(x, y, totalW, h).fill().restore();
    // Fill
    const fillW = Math.max(2, Math.round(fillRatio * totalW));
    doc.save().fillColor(rgb).rect(x, y, fillW, h).fill().restore();
}

async function generateStatsPDF(subjects) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    const outputPath = path.join(OUTPUT_DIR, `Quellen_Statistik_${Date.now()}.pdf`);
    const stats = buildStats(subjects);

    return new Promise((resolve, reject) => {
        // bufferPages: true is REQUIRED for switchToPage (footer)
        const doc = new PDFDocument({
            size: 'A4',
            bufferPages: true,
            margins: { top: 50, bottom: 60, left: 50, right: 50 },
            info: {
                Title: 'Quellenanalyse und Statistik',
                Author: 'Uni Tuebingen Lernplan App',
                Subject: 'Herkunft der analysierten Dokumente'
            }
        });

        const stream = fs.createWriteStream(outputPath);
        doc.pipe(stream);
        doc.registerFont('Roboto', path.join(FONTS_DIR, 'Roboto-Regular.ttf'));
        doc.registerFont('Roboto-Bold', path.join(FONTS_DIR, 'Roboto-Bold.ttf'));
        doc.font('Roboto');

        const W = doc.page.width;   // 595.28
        const MARGIN = 50;
        const CONTENT = W - 2 * MARGIN;  // 495.28
        const ACCENT = '#4a7de8';        // blue – safe for pdfkit fillColor

        // ═══ DECKBLATT ══════════════════════════════════════════
        // Header background
        filledRect(doc, 0, 0, W, 160, 19, 19, 31);
        filledRect(doc, 0, 0, W, 4, 74, 125, 232);

        doc.fillColor('#f1f5f9').fontSize(24).font('Roboto-Bold')
            .text('Quellenanalyse & Statistik', MARGIN, 40, { width: CONTENT });
        doc.fillColor('#94a3b8').fontSize(12).font('Roboto')
            .text('TüTool App', MARGIN, 74);
        doc.fillColor('#64748b').fontSize(10)
            .text(`Erstellt: ${stats.generatedAt.toLocaleString('de-DE', {
                day: '2-digit', month: '2-digit', year: 'numeric',
                hour: '2-digit', minute: '2-digit'
            })}`, MARGIN, 94);

        // Quick-stat boxes
        const BOX_COUNT = 4;
        const BOX_W = (CONTENT - (BOX_COUNT - 1) * 8) / BOX_COUNT;
        const boxes = [
            { label: 'Dokumente', value: stats.totalDocuments },
            { label: 'Themen', value: stats.totalTopics },
            { label: 'Faecher', value: Object.keys(stats.bySubject).length },
            { label: 'Portale', value: Object.values(stats.byPlatform).filter(p => p.count > 0).length }
        ];
        boxes.forEach((box, i) => {
            const bx = MARGIN + i * (BOX_W + 8);
            filledRect(doc, bx, 118, BOX_W, 36, 30, 30, 45);
            doc.fillColor(ACCENT).fontSize(18).font('Roboto-Bold')
                .text(String(box.value), bx, 124, { width: BOX_W, align: 'center' });
            doc.fillColor('#64748b').fontSize(8).font('Roboto')
                .text(box.label, bx, 144, { width: BOX_W, align: 'center' });
        });

        // Top-Portal info
        doc.fillColor('#94a3b8').fontSize(10).font('Roboto')
            .text(`Haupt-Quelle: ${stats.topPlatform}`, MARGIN, 164);

        // ═══ SECTION 1: Herkunft nach Portal ════════════════════
        let y = 192;
        y = sectionTitle(doc, 'Herkunft der Daten nach Portal', y, ACCENT);

        const activePlatforms = Object.entries(stats.byPlatform)
            .filter(([, v]) => v.count > 0)
            .sort(([, a], [, b]) => b.count - a.count);

        const maxCount = activePlatforms.length > 0
            ? Math.max(...activePlatforms.map(([, v]) => v.count))
            : 1;

        if (activePlatforms.length === 0) {
            doc.fillColor('#64748b').fontSize(10)
                .text('Keine Plattformdaten vorhanden (Demo-Modus).', MARGIN, y);
            y += 20;
        }

        activePlatforms.forEach(([name, data]) => {
            if (y > 700) { doc.addPage(); y = 50; }
            const rgb = getPlatformRgb(name);

            // Platform label
            doc.fillColor(rgb).fontSize(12).font('Roboto-Bold').text(name, MARGIN, y);
            doc.fillColor('#94a3b8').fontSize(9).font('Roboto')
                .text(
                    `${data.count} Dokument${data.count !== 1 ? 'e' : ''}  |  ${data.topics} Themen  |  ${Math.round(data.count / stats.totalDocuments * 100)}% des Gesamts`,
                    MARGIN, y + 14
                );

            // Bar
            const BAR_X = 210;
            const BAR_W = CONTENT - 160;
            barChart(doc, BAR_X, y + 2, BAR_W, 11, data.count / maxCount, rgb);

            // Faecher
            if (data.subjects.length > 0) {
                doc.fillColor('#475569').fontSize(8)
                    .text('Faecher: ' + data.subjects.slice(0, 6).join(', '), MARGIN, y + 28, { width: CONTENT });
            }
            y += 48;
        });

        // ═══ SECTION 2: Dokumente ═══════════════════════════════
        y += 6;
        if (y > 660) { doc.addPage(); y = 50; }
        y = sectionTitle(doc, 'Analysierte Dokumente', y, ACCENT);

        if (stats.documents.length === 0) {
            doc.fillColor('#64748b').fontSize(10).text('Keine Dokumente analysiert.', MARGIN, y);
            y += 20;
        } else {
            const bySubject = {};
            stats.documents.forEach(d => {
                if (!bySubject[d.subject]) bySubject[d.subject] = [];
                bySubject[d.subject].push(d);
            });

            Object.entries(bySubject).forEach(([subject, docs]) => {
                if (y > 690) { doc.addPage(); y = 50; }

                // Subject heading row
                filledRect(doc, MARGIN, y, CONTENT, 18, 30, 30, 45);
                doc.fillColor(ACCENT).fontSize(9).font('Roboto-Bold')
                    .text(`${subject}  (${docs.length})`, MARGIN + 6, y + 4);
                y += 24;

                docs.forEach(d => {
                    if (y > 715) { doc.addPage(); y = 50; }
                    const rgb = getPlatformRgb(d.platform);

                    // Dot
                    doc.save().fillColor(rgb).circle(MARGIN + 6, y + 5, 3).fill().restore();

                    // Title + platform
                    const title = (d.title || 'Unbenannt').substring(0, 55);
                    doc.fillColor('#e2e8f0').fontSize(9).font('Roboto-Bold')
                        .text(title, MARGIN + 16, y, { width: 320, ellipsis: true, continued: false });

                    doc.fillColor(rgb).fontSize(8).font('Roboto')
                        .text(d.platform, 400, y, { width: 60 });

                    doc.fillColor('#475569').fontSize(8)
                        .text(`${d.topics} Themen`, 468, y, { width: 70 });

                    if (d.filePath) {
                        doc.fillColor('#334155').fontSize(7)
                            .text(path.basename(d.filePath), MARGIN + 16, y + 11, { width: 400, ellipsis: true });
                        y += 24;
                    } else {
                        y += 16;
                    }
                });
                y += 4;
            });
        }

        // ═══ SECTION 3: Statistik nach Fach ════════════════════
        if (y > 640) { doc.addPage(); y = 50; }
        y += 6;
        y = sectionTitle(doc, 'Statistik nach Fach', y, ACCENT);

        const subjectEntries = Object.entries(stats.bySubject)
            .sort(([, a], [, b]) => b.count - a.count);
        const maxSubjectCount = subjectEntries.length > 0
            ? Math.max(...subjectEntries.map(([, v]) => v.count))
            : 1;

        subjectEntries.forEach(([name, data]) => {
            if (y > 710) { doc.addPage(); y = 50; }

            doc.fillColor('#e2e8f0').fontSize(10).font('Roboto-Bold')
                .text(name, MARGIN, y, { width: 150 });
            doc.fillColor('#64748b').fontSize(8).font('Roboto')
                .text(`${data.count} Dok  |  ${data.topics} Themen`, MARGIN, y + 12);

            const BAR_X = 210;
            const BAR_W = CONTENT - 160;
            barChart(doc, BAR_X, y + 2, BAR_W, 10, data.count / maxSubjectCount, [74, 125, 232]);

            if (data.platforms.length > 0) {
                doc.fillColor('#334155').fontSize(7)
                    .text('Quellen: ' + data.platforms.join(', '), BAR_X + BAR_W + 8, y + 4, { width: 80, ellipsis: true });
            }
            y += 30;
        });

        // ═══ FOOTER auf allen Seiten ════════════════════════════
        const range = doc.bufferedPageRange();
        for (let i = 0; i < range.count; i++) {
            doc.switchToPage(i);
            const footerY = doc.page.height - 40;
            sectionLine(doc, footerY - 4, '#2a2a3a');
            doc.fillColor('#475569').fontSize(7).font('Roboto')
                .text(
                    `Uni Tuebingen Vorklinik Lernplan  |  Seite ${i + 1} von ${range.count}  |  ${stats.generatedAt.toLocaleDateString('de-DE')}`,
                    MARGIN, footerY, { width: CONTENT, align: 'center' }
                );
        }

        doc.end();
        stream.on('finish', () => resolve(outputPath));
        stream.on('error', reject);
    });
}

module.exports = { generateStatsPDF, buildStats };
