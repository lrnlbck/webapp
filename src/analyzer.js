/**
 * Dokument-Analyzer: Extrahiert Text aus PDFs und PPTXs,
 * filtert wichtige Themen via TF-IDF
 */
const fs = require('fs');
const path = require('path');

// Lazy-Load pdf-parse to avoid issues if not installed yet
let pdfParse;
try { pdfParse = require('pdf-parse'); } catch (e) { pdfParse = null; }

// PPTX: Lese als ZIP, extrahiere XML
const { execSync } = require('child_process');
const os = require('os');

// Medizinische Stoppwörter (Deutsch) – werden nicht als Themen gezählt
const STOP_WORDS = new Set([
    'der', 'die', 'das', 'ein', 'eine', 'und', 'oder', 'aber', 'mit', 'von', 'zu', 'in',
    'an', 'auf', 'für', 'ist', 'sind', 'wird', 'werden', 'hat', 'haben', 'dass', 'den',
    'dem', 'des', 'bei', 'aus', 'nach', 'vor', 'durch', 'über', 'unter', 'nicht', 'auch',
    'als', 'wie', 'im', 'am', 'zum', 'zur', 'um', 'bis', 'seit', 'noch', 'dann', 'wenn',
    'was', 'wer', 'wo', 'wie', 'kann', 'können', 'soll', 'sollte', 'muss', 'müssen',
    'wird', 'wurde', 'werden', 'war', 'waren', 'sein', 'seins', 'eine', 'einer', 'eines',
    'sich', 'man', 'es', 'sie', 'er', 'wir', 'ihr', 'alle', 'mehr', 'viele', 'einem',
    'einer', 'dieses', 'dieser', 'diesem', 'diesen', 'diese', 'bzw', 'abb', 'tab', 'seite',
    'folie', 'slide', 'prof', 'dr', 'university', 'universität', 'tübingen', 'übersicht',
    'einleitung', 'zusammenfassung', 'kapitel', 'abschnitt', 'thema', 'inhalt', 'beispiel'
]);

// Medizinische Themen-Kategorien für bessere Klassifizierung
const MEDICAL_KEYWORDS = [
    'anatom', 'physiolog', 'biochem', 'histolog', 'patholog', 'pharmakolog', 'mikrobiolog',
    'immunolog', 'genetik', 'zell', 'gewebe', 'organ', 'system', 'muskel', 'nerv', 'knochen',
    'gefäß', 'blut', 'herz', 'lunge', 'leber', 'niere', 'gehirn', 'hormon', 'enzym',
    'protein', 'dna', 'rna', 'rezeptor', 'synapse', 'membran', 'zellkern', 'mitochondri',
    'metabolism', 'stoffwechsel', 'kreislauf', 'atmung', 'verdauung', 'immunsystem',
    'antikörper', 'antigen', 'infektion', 'entzündung', 'tumor', 'kanzerogen', 'mutation'
];

async function extractTextFromPDF(filePath) {
    if (!pdfParse) return '';
    try {
        const data = fs.readFileSync(filePath);
        const result = await pdfParse(data, { max: 50 }); // Max 50 Seiten
        return result.text || '';
    } catch (err) {
        console.warn(`  ⚠️  PDF Parse Fehler (${path.basename(filePath)}): ${err.message}`);
        return '';
    }
}

async function extractTextFromPPTX(filePath) {
    try {
        // PPTX ist ein ZIP – entpacke und lese XML
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pptx-'));

        // Unzip (verfügbar auf macOS/Linux/Windows mit Node)
        const AdmZip = (() => {
            try { return require('adm-zip'); } catch { return null; }
        })();

        if (!AdmZip) {
            // Fallback: System unzip
            try {
                execSync(`unzip -qq -o "${filePath}" "ppt/slides/slide*.xml" -d "${tmpDir}"`, { timeout: 10000 });
                const slideFiles = fs.readdirSync(path.join(tmpDir, 'ppt', 'slides'))
                    .filter(f => f.startsWith('slide') && f.endsWith('.xml'));

                let text = '';
                for (const sf of slideFiles) {
                    const xml = fs.readFileSync(path.join(tmpDir, 'ppt', 'slides', sf), 'utf8');
                    text += xml.replace(/<[^>]+>/g, ' ') + ' ';
                }
                return text;
            } catch { return ''; }
        }

        const zip = new AdmZip(filePath);
        const slides = zip.getEntries().filter(e => e.entryName.match(/ppt\/slides\/slide\d+\.xml/));
        let text = '';
        for (const slide of slides) {
            const xml = slide.getData().toString('utf8');
            text += xml.replace(/<[^>]+>/g, ' ') + ' ';
        }
        return text;
    } catch (err) {
        console.warn(`  ⚠️  PPTX Parse Fehler (${path.basename(filePath)}): ${err.message}`);
        return '';
    }
}

function extractTopics(text, maxTopics = 15) {
    if (!text || text.length < 50) return [];

    // Tokenize: Wörter mit Länge >= 4 Buchstaben
    const words = text.toLowerCase()
        .replace(/[^\wäöüÄÖÜß\s-]/g, ' ')
        .split(/\s+/)
        .filter(w => w.length >= 4 && !STOP_WORDS.has(w) && !/^\d+$/.test(w));

    // Wort-Frequenz zählen
    const freq = {};
    words.forEach(w => { freq[w] = (freq[w] || 0) + 1; });

    // TF-IDF-ähnliche Gewichtung: Medizinische Keywords bevorzugen
    const scored = Object.entries(freq).map(([word, count]) => {
        let score = count;
        // Boost für medizinische Begriffe
        if (MEDICAL_KEYWORDS.some(kw => word.includes(kw))) score *= 2.5;
        // Boost für längere Wörter (Fachbegriffe sind oft länger)
        if (word.length > 8) score *= 1.3;
        return { word, count, score };
    });

    scored.sort((a, b) => b.score - a.score);

    // Dedupliziere ähnliche Wörter (z.B. Anatom/Anatomie)
    const topics = [];
    const seen = new Set();
    for (const { word } of scored) {
        const stem = word.substring(0, Math.min(word.length, 8));
        if (!seen.has(stem)) {
            seen.add(stem);
            // Kapitalisiere erstes Buchstaben
            topics.push(word.charAt(0).toUpperCase() + word.slice(1));
        }
        if (topics.length >= maxTopics) break;
    }

    return topics;
}

function getWeekNumber(date) {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() + 3 - (d.getDay() + 6) % 7);
    const week1 = new Date(d.getFullYear(), 0, 4);
    return 1 + Math.round(((d.getTime() - week1.getTime()) / 86400000 - 3 + (week1.getDay() + 6) % 7) / 7);
}

async function analyzeDocument(material) {
    if (!material.filePath || !fs.existsSync(material.filePath)) {
        return {
            title: material.title,
            courseTitle: material.courseTitle,
            platform: material.platform || 'Unbekannt',
            topics: [],
            date: material.date || new Date(),
            week: getWeekNumber(material.date || new Date()),
            filePath: material.filePath
        };
    }

    const ext = path.extname(material.filePath).toLowerCase();
    let text = '';

    if (ext === '.pdf') {
        text = await extractTextFromPDF(material.filePath);
    } else if (ext === '.pptx' || ext === '.ppt') {
        text = await extractTextFromPPTX(material.filePath);
    }

    const topics = extractTopics(text);
    const date = material.date || fs.statSync(material.filePath).mtime;

    return {
        title: material.title,
        courseTitle: material.courseTitle,
        platform: material.platform || 'Unbekannt',
        topics,
        text: text.substring(0, 500), // Erste 500 Zeichen als Vorschau
        date,
        week: getWeekNumber(date),
        filePath: material.filePath
    };
}

async function analyzeAll(materials) {
    const results = [];
    for (const material of materials) {
        try {
            const analyzed = await analyzeDocument(material);
            results.push(analyzed);
            console.log(`  📖 Analysiert: ${material.title} (${analyzed.topics.length} Themen)`);
        } catch (err) {
            console.warn(`  ⚠️  Analyse Fehler: ${material.title} – ${err.message}`);
        }
    }
    return results;
}

module.exports = { analyzeAll, analyzeDocument, extractTopics, getWeekNumber };
