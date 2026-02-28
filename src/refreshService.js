/**
 * Refresh-Service: Koordiniert alle Scraper und Analyse
 */
const { scrapeILIAS } = require('./scrapers/ilias');
const { scrapeMoodle } = require('./scrapers/moodle');
const { scrapeAlma } = require('./scrapers/alma');
const { scrapeSimed } = require('./scrapers/simed');
const { analyzeAll } = require('./analyzer');
const { saveCache, loadCache } = require('./cache');

let isRefreshing = false;
let refreshProgress = { status: 'idle', message: '', progress: 0 };

function getRefreshProgress() {
    return refreshProgress;
}

async function runFullRefresh() {
    if (isRefreshing) {
        throw new Error('Aktualisierung läuft bereits...');
    }

    isRefreshing = true;
    refreshProgress = { status: 'running', message: 'Starte Aktualisierung...', progress: 0 };

    try {
        const allMaterials = [];

        // ILIAS
        refreshProgress = { status: 'running', message: '🎓 ILIAS wird geladen...', progress: 10 };
        const iliasMaterials = await scrapeILIAS();
        allMaterials.push(...iliasMaterials.map(m => ({ ...m, platform: 'ILIAS' })));

        // MOODLE
        refreshProgress = { status: 'running', message: '📚 MOODLE wird geladen...', progress: 30 };
        const moodleMaterials = await scrapeMoodle();
        allMaterials.push(...moodleMaterials.map(m => ({ ...m, platform: 'MOODLE' })));

        // ALMA
        refreshProgress = { status: 'running', message: '🏛️ ALMA wird geladen...', progress: 50 };
        const almaMaterials = await scrapeAlma();
        allMaterials.push(...almaMaterials.map(m => ({ ...m, platform: 'ALMA' })));

        // SIMED
        refreshProgress = { status: 'running', message: '🏥 SIMED wird geladen...', progress: 65 };
        const simedMaterials = await scrapeSimed();
        allMaterials.push(...simedMaterials.map(m => ({ ...m, platform: 'SIMED' })));

        console.log(`\n📊 Gesamt: ${allMaterials.length} Materialien gefunden`);

        // Analysieren
        refreshProgress = { status: 'running', message: '🔍 Dokumente werden analysiert...', progress: 75 };
        const analyzed = await analyzeAll(allMaterials);

        const anyConfigured =
            (process.env.ILIAS_USER && process.env.ILIAS_USER !== 'dein_benutzername') ||
            (process.env.ALMA_USER && process.env.ALMA_USER !== 'dein_benutzername') ||
            (process.env.MOODLE_USER && process.env.MOODLE_USER !== 'dein_benutzername') ||
            (process.env.SIMED_USER && process.env.SIMED_USER !== 'dein_benutzername');

        // Demo-Daten einfügen wenn keine echten Plattform-Daten konfiguriert sind
        const finalData = anyConfigured ? analyzed : getDemoData();

        // Cache speichern
        refreshProgress = { status: 'running', message: '💾 Speichere Ergebnisse...', progress: 95 };
        saveCache(finalData);

        refreshProgress = { status: 'done', message: `✅ ${finalData.length} Einträge aktualisiert`, progress: 100 };
        console.log(`✅ Aktualisierung abgeschlossen: ${finalData.length} Einträge`);

        return finalData;
    } catch (err) {
        refreshProgress = { status: 'error', message: `❌ Fehler: ${err.message}`, progress: 0 };
        throw err;
    } finally {
        isRefreshing = false;
    }
}

function getDemoData() {
    // Demo-Daten für TüTool SoSe 2026 wenn keine Plattformen konfiguriert
    const now = new Date('2026-04-20');
    const demoEntries = [
        { courseTitle: 'Anatomie', title: 'Einführung & Grundbegriffe', topics: ['Anatomische Lage', 'Körperebenen', 'Organsysteme', 'Gewebstypen', 'Nomina anatomica'], week: 1, platform: 'Demo' },
        { courseTitle: 'Anatomie', title: 'Bewegungsapparat', topics: ['Skelett', 'Muskulatur', 'Gelenke', 'Sehnen', 'Bänder', 'Knorpel'], week: 2, platform: 'Demo' },
        { courseTitle: 'Anatomie', title: 'Herz und Kreislauf', topics: ['Herzanatomie', 'Herzklappen', 'Koronararterien', 'Blutgefäße', 'Lymphsystem'], week: 3, platform: 'Demo' },
        { courseTitle: 'Physiologie', title: 'Zellphysiologie', topics: ['Membranpotential', 'Ionenkanäle', 'Aktionspotential', 'Osmose', 'Diffusion'], week: 1, platform: 'Demo' },
        { courseTitle: 'Physiologie', title: 'Herzphysiologie', topics: ['Erregungsleitung', 'EKG', 'Herzfrequenz', 'Schlagvolumen', 'Herzzyklus'], week: 3, platform: 'Demo' },
        { courseTitle: 'Physiologie', title: 'Atemphysiologie', topics: ['Lungenvolumina', 'Gasaustausch', 'Ventilation', 'Perfusion', 'Blutgase'], week: 4, platform: 'Demo' },
        { courseTitle: 'Biochemie', title: 'Aminosäuren & Proteine', topics: ['Aminosäurestruktur', 'Peptidbindung', 'Proteinstruktur', 'Enzyme', 'Km-Wert'], week: 1, platform: 'Demo' },
        { courseTitle: 'Biochemie', title: 'Kohlenhydratstoffwechsel', topics: ['Glykolyse', 'Citratcyclus', 'Gluconeogenese', 'Glykogensynthese', 'Pentosephosphatweg'], week: 2, platform: 'Demo' },
        { courseTitle: 'Biochemie', title: 'Lipidstoffwechsel', topics: ['Fettsäuresynthese', 'β-Oxidation', 'Cholesterin', 'Lipoproteine', 'Ketonkörper'], week: 3, platform: 'Demo' },
        { courseTitle: 'Histologie', title: 'Grundgewebe', topics: ['Epithelgewebe', 'Bindegewebe', 'Muskelgewebe', 'Nervengewebe', 'Zellorganellen'], week: 1, platform: 'Demo' },
        { courseTitle: 'Histologie', title: 'Mikroskopie', topics: ['Hämatoxylin/Eosin', 'PAS-Färbung', 'Immunhistochemie', 'Lichtmikroskop', 'Elektronenmikroskop'], week: 2, platform: 'Demo' },
        { courseTitle: 'Biologie', title: 'Zellbiologie', topics: ['Zellzyklus', 'Mitose', 'Meiose', 'DNA-Replikation', 'Transkription', 'Translation'], week: 1, platform: 'Demo' },
        { courseTitle: 'Biologie', title: 'Genetik', topics: ['Mendel-Gesetze', 'Mutation', 'Chromosomen', 'Genregulation', 'Epigenetik'], week: 2, platform: 'Demo' },
        { courseTitle: 'Chemie', title: 'Organische Chemie', topics: ['Funktionelle Gruppen', 'Reaktionsmechanismen', 'Säure-Base', 'Redoxreaktionen', 'Puffer'], week: 1, platform: 'Demo' },
        { courseTitle: 'SIMED', title: 'Klinische Untersuchung', topics: ['Anamnese', 'Inspektion', 'Palpation', 'Perkussion', 'Auskultation'], week: 2, platform: 'SIMED' },
    ];

    return demoEntries.map(e => ({
        ...e,
        date: new Date(2026, 3, 20 + (e.week - 1) * 7).toISOString(),
        text: `Demo-Eintrag für ${e.courseTitle}: ${e.title}`,
        filePath: null
    }));
}

module.exports = { runFullRefresh, getRefreshProgress, getDemoData };
