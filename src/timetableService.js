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
const REPORTED_PATH = path.join(__dirname, '../cache/timetable_reported.json');

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

// ─── Bereits gemeldete Änderungen ─────────────────────────────────
function loadReportedState() {
    try {
        if (fs.existsSync(REPORTED_PATH)) return JSON.parse(fs.readFileSync(REPORTED_PATH, 'utf8'));
    } catch { }
    return { addedIds: [], changedSnapshots: [] };
}

function saveReportedState(diff) {
    const state = {
        addedIds: diff.added.map(e => e.id),
        // Snapshot des gemeldeten Ziel-Zustands für jede Änderung
        changedSnapshots: diff.changed.map(c => ({
            id: c.after.id,
            timeFrom: c.after.timeFrom,
            timeTo: c.after.timeTo,
            location: c.after.location,
            title: c.after.title
        })),
        reportedAt: new Date().toISOString()
    };
    fs.mkdirSync(path.dirname(REPORTED_PATH), { recursive: true });
    fs.writeFileSync(REPORTED_PATH, JSON.stringify(state, null, 2));
}

function filterAlreadyReported(diff) {
    const reported = loadReportedState();
    const reportedAddedIds = new Set(reported.addedIds || []);
    const reportedChangedMap = new Map(
        (reported.changedSnapshots || []).map(s => [s.id, s])
    );

    const added = diff.added.filter(e => !reportedAddedIds.has(e.id));

    const changed = diff.changed.filter(c => {
        const prev = reportedChangedMap.get(c.after.id);
        if (!prev) return true; // noch nie gemeldet
        // Unterdrücken, wenn der aktuelle Zustand identisch mit dem zuletzt gemeldeten Zustand ist
        return !(
            prev.timeFrom === c.after.timeFrom &&
            prev.timeTo === c.after.timeTo &&
            prev.location === c.after.location &&
            prev.title === c.after.title
        );
    });

    return { added, removed: diff.removed, changed };
}

// ─── Vergleich ────────────────────────────────────────────────────
function compareTimetables(oldEvents, newEvents) {
    // Nur zukünftige Events berücksichtigen – vergangene Termine nicht melden
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const isFuture = e => e.date && new Date(e.date) >= today;

    const futureNew = (newEvents || []).filter(isFuture);
    const futureOld = (oldEvents || []).filter(isFuture);

    const oldMap = new Map(futureOld.map(e => [e.id, e]));
    const newMap = new Map(futureNew.map(e => [e.id, e]));

    const added = futureNew.filter(e => !oldMap.has(e.id));
    const removed = futureOld.filter(e => !newMap.has(e.id));
    const changed = [];

    futureNew.forEach(newEv => {
        const oldEv = oldMap.get(newEv.id);
        if (!oldEv) return;
        if (oldEv.timeFrom !== newEv.timeFrom ||
            oldEv.timeTo !== newEv.timeTo ||
            oldEv.location !== newEv.location ||
            oldEv.title !== newEv.title) {
            changed.push({ before: oldEv, after: newEv });
        }
    });

    return { added, removed, changed };
}

// ─── Haupt-Refresh ────────────────────────────────────────────────
async function runTimetableRefresh(sendMailOnChange = true) {
    if (refreshProgress.status === 'running') return;
    refreshProgress = { status: 'running', message: 'Stundenplan wird geladen...', progress: 10 };

    try {
        const oldEvents = loadTimetableCache();
        const isFirstLoad = !oldEvents; // Kein Cache = erster Start nach Neustart
        refreshProgress = { status: 'running', message: 'Portale werden abgefragt...', progress: 40 };

        const newEvents = await scrapeTimetable();
        refreshProgress = { status: 'running', message: 'Verarbeitung...', progress: 75 };

        // Änderungen vergleichen (nur wenn bereits ein Cache vorhanden war)
        const rawDiff = compareTimetables(oldEvents, newEvents);
        // Bereits gemeldete Änderungen herausfiltern
        const diff = isFirstLoad ? rawDiff : filterAlreadyReported(rawDiff);
        const hasChanges = !isFirstLoad && (diff.added.length + diff.changed.length + diff.removed.length > 0);

        if (isFirstLoad) {
            console.log('Stundenplan: Erster Load nach Neustart – kein Mail-Vergleich.');
        } else if (hasChanges) {
            console.log(`Stundenplan-Änderungen: +${diff.added.length} neu, ~${diff.changed.length} geändert, -${diff.removed.length} entfernt`);
            if (sendMailOnChange) {
                try {
                    await sendChangeMail(diff);
                    saveReportedState(diff); // Gemeldete Änderungen persistieren
                } catch (e) { console.warn('Mail-Fehler:', e.message); }
            }
        } else {
            console.log('Stundenplan: Keine (neuen) Änderungen festgestellt.');
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
