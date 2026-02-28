/**
 * Stundenplan-Service
 * Verwaltet Stundenplan-State, Vergleich, Cache
 */
const fs = require('fs');
const path = require('path');
const { scrapeTimetable } = require('./scrapers/timetable');
const { sendChangeMail } = require('./emailService');

const CACHE_PATH = path.join(__dirname, '../cache/timetable.json');
const CACHE_META = path.join(__dirname, '../cache/timetable_meta.json');

// Fortschritt
let refreshProgress = { status: 'idle', message: 'Bereit', progress: 0 };

function getRefreshProgress() { return refreshProgress; }

// ─── Cache ────────────────────────────────────────────────────────
function loadTimetableCache() {
    try {
        if (fs.existsSync(CACHE_PATH)) return JSON.parse(fs.readFileSync(CACHE_PATH, 'utf8'));
    } catch { }
    return null;
}

function saveTimetableCache(events) {
    fs.mkdirSync(path.dirname(CACHE_PATH), { recursive: true });
    fs.writeFileSync(CACHE_PATH, JSON.stringify(events, null, 2));
    fs.writeFileSync(CACHE_META, JSON.stringify({ lastUpdated: new Date().toISOString() }));
}

function getTimetableMeta() {
    try {
        if (fs.existsSync(CACHE_META)) return JSON.parse(fs.readFileSync(CACHE_META, 'utf8'));
    } catch { }
    return { lastUpdated: null };
}

// ─── Vergleich ────────────────────────────────────────────────────
function compareTimetables(oldEvents, newEvents) {
    const oldMap = new Map((oldEvents || []).map(e => [e.id, e]));
    const newMap = new Map((newEvents || []).map(e => [e.id, e]));

    const added = newEvents.filter(e => !oldMap.has(e.id));
    const removed = (oldEvents || []).filter(e => !newMap.has(e.id));
    const changed = [];

    newEvents.forEach(newEv => {
        const oldEv = oldMap.get(newEv.id);
        if (!oldEv) return;
        // Änderung wenn Zeit, Ort oder Titel geändert
        if (oldEv.timeFrom !== newEv.timeFrom ||
            oldEv.timeTo !== newEv.timeTo ||
            oldEv.location !== newEv.location ||
            oldEv.title !== newEv.title) {
            changed.push({ before: oldEv, after: newEv });
        }
    });

    return { added, removed, changed };
}

// ─── Haupt-Refresh ───────────────────────────────────────────────
async function runTimetableRefresh(sendMailOnChange = true) {
    if (refreshProgress.status === 'running') return;
    refreshProgress = { status: 'running', message: 'Stundenplan wird geladen...', progress: 10 };

    try {
        const oldEvents = loadTimetableCache();
        refreshProgress = { status: 'running', message: 'Portale werden abgefragt...', progress: 40 };

        const newEvents = await scrapeTimetable();
        refreshProgress = { status: 'running', message: 'Verarbeitung...', progress: 75 };

        // Änderungen vergleichen
        const diff = compareTimetables(oldEvents, newEvents);
        const hasChanges = diff.added.length + diff.changed.length + diff.removed.length > 0;

        if (hasChanges) {
            console.log(`🔄 Stundenplan-Änderungen: +${diff.added.length} neu, ~${diff.changed.length} geändert, -${diff.removed.length} entfernt`);
            if (sendMailOnChange) {
                try { await sendChangeMail(diff); } catch (e) { console.warn('Mail-Fehler:', e.message); }
            }
        }

        saveTimetableCache(newEvents);
        refreshProgress = { status: 'done', message: `${newEvents.length} Termine geladen`, progress: 100, lastUpdated: new Date().toISOString(), hasChanges, diff };

        setTimeout(() => {
            if (refreshProgress.status === 'done') refreshProgress.status = 'idle';
        }, 30000);

        return { events: newEvents, diff };
    } catch (err) {
        console.error('Stundenplan Refresh Fehler:', err.message);
        refreshProgress = { status: 'error', message: err.message, progress: 0 };
        return null;
    }
}

// ─── Wochenfilter ────────────────────────────────────────────────
function getWeekEvents(events, weekOffset = 0, semesterStart = new Date('2026-04-20')) {
    if (!events) return [];

    const now = new Date();
    const target = new Date(semesterStart);

    // Aktuelle Semesterwoche berechnen
    const currentWeekSince = Math.floor((now - semesterStart) / (7 * 86400000));
    const targetWeek = currentWeekSince + weekOffset + 1; // 1-indexed

    const weekStart = new Date(semesterStart);
    weekStart.setDate(semesterStart.getDate() + (targetWeek - 1) * 7);
    weekStart.setHours(0, 0, 0, 0);
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 7);

    return events
        .filter(e => {
            if (!e.date) return false;
            const d = new Date(e.date);
            return d >= weekStart && d < weekEnd;
        })
        .sort((a, b) => new Date(a.date) - new Date(b.date));
}

module.exports = {
    loadTimetableCache,
    saveTimetableCache,
    getTimetableMeta,
    compareTimetables,
    runTimetableRefresh,
    getWeekEvents,
    getRefreshProgress
};
