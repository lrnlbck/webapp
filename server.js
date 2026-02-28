require('dotenv').config();

const express = require('express');
const session = require('express-session');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const { verifyPin, setPinInEnv } = require('./src/auth');
const { loadCache, saveCache, getCacheMeta } = require('./src/cache');
const { runFullRefresh, getRefreshProgress, getDemoData } = require('./src/refreshService');
const { generateSummaryPDF } = require('./src/pdfGenerator');
const { generateStatsPDF } = require('./src/statsGenerator');
const { startScheduler } = require('./src/scheduler');
const {
    loadTimetableCache, saveTimetableCache, getTimetableMeta,
    runTimetableRefresh, getWeekEvents,
    getRefreshProgress: getTimetableProgress
} = require('./src/timetableService');
const { getDemoTimetable } = require('./src/scrapers/timetable');
const { sendTestMail } = require('./src/emailService');
const { checkAllPortals } = require('./src/portalStatusService');
const {
    loadExams, createExam, updateExamStatus, toggleCalendar, deleteExam, getCalendarEvents
} = require('./src/lernplanService');
const { generateIcal } = require('./src/icalService');

const app = express();
const PORT = process.env.PORT || 3000;

// ─── Middleware ────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.set('trust proxy', 1);
const isProd = process.env.NODE_ENV === 'production' || !!process.env.RAILWAY_ENVIRONMENT;

app.use(session({
    secret: process.env.SESSION_SECRET || 'tuebingen-lernplan-secret-2026',
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: isProd,
        maxAge: 24 * 60 * 60 * 1000,
        sameSite: 'lax'
    } // 24h
}));

// ─── Auth Middleware ───────────────────────────────────────────────────────
function requireAuth(req, res, next) {
    if (req.session && req.session.authenticated) return next();
    return res.status(401).json({ error: 'Nicht authentifiziert' });
}

// ─── Auth Routes ──────────────────────────────────────────────────────────
app.post('/api/auth/login', async (req, res) => {
    const { pin } = req.body;
    if (!pin) return res.status(400).json({ error: 'PIN fehlt' });

    const pinHash = process.env.PIN_HASH;
    const appPin = process.env.APP_PIN;

    // Spezieller Railway APP_PIN Bypass
    if (appPin && appPin.trim() !== '') {
        if (pin === appPin) {
            req.session.authenticated = true;
            return res.json({ success: true });
        }
        return res.status(401).json({ error: 'Falscher PIN' });
    }

    // Wenn noch kein PIN gesetzt, erster Setup-Schritt (Lokal)
    if (!pinHash || pinHash.trim() === '') {
        if (/^\d{4,8}$/.test(pin)) {
            await setPinInEnv(pin);
            req.session.authenticated = true;
            return res.json({ success: true, firstSetup: true, message: 'PIN gesetzt und eingeloggt!' });
        }
        return res.status(400).json({ error: 'PIN muss 4-8 Ziffern haben' });
    }

    try {
        const valid = await verifyPin(pin, pinHash);
        if (valid) {
            req.session.authenticated = true;
            return res.json({ success: true });
        } else {
            return res.status(401).json({ error: 'Falscher PIN' });
        }
    } catch (err) {
        return res.status(500).json({ error: 'Server-Fehler bei Authentifizierung' });
    }
});

app.post('/api/auth/logout', (req, res) => {
    req.session.destroy();
    res.json({ success: true });
});

app.get('/api/auth/status', (req, res) => {
    const pinSet = !!((process.env.APP_PIN && process.env.APP_PIN.trim()) || (process.env.PIN_HASH && process.env.PIN_HASH.trim()));
    res.json({
        authenticated: !!(req.session && req.session.authenticated),
        pinSet
    });
});

app.get('/api/auth/portals', requireAuth, async (req, res) => {
    try {
        if (req.query.demo === 'true') {
            return res.json({
                portals: { ILIAS: { status: 'connected' }, ALMA: { status: 'connected' }, MOODLE: { status: 'connected' }, SIMED: { status: 'connected' } },
                timestamp: new Date().toISOString()
            });
        }
        const statuses = await checkAllPortals();
        res.json(statuses);
    } catch (err) {
        res.status(500).json({ error: 'Fehler beim Abruf der Portal-Status' });
    }
});

// ─── Data Routes ──────────────────────────────────────────────────────────
app.get('/api/subjects', requireAuth, (req, res) => {
    let data = req.query.demo === 'true' ? getDemoData() : loadCache();
    if (!data || data.length === 0) {
        data = getDemoData();
        saveCache(data);
    }

    // Nach Fach gruppieren
    const grouped = {};
    data.forEach(item => {
        const key = item.courseTitle || 'Allgemein';
        if (!grouped[key]) {
            grouped[key] = {
                name: key,
                platform: item.platform || 'Unbekannt',
                lectures: [],
                totalTopics: 0
            };
        }
        grouped[key].lectures.push(item);
        grouped[key].totalTopics += (item.topics || []).length;
    });

    const meta = getCacheMeta();
    res.json({
        subjects: Object.values(grouped),
        lastUpdated: meta.lastUpdated,
        totalMaterials: data.length
    });
});

app.get('/api/refresh/status', requireAuth, (req, res) => {
    res.json(getRefreshProgress());
});

app.post('/api/refresh', requireAuth, async (req, res) => {
    try {
        if (req.query.demo === 'true') {
            return res.json({ message: 'Demo Refresh (simuliert)', status: 'done' });
        }
        // Starte Refresh im Hintergrund
        res.json({ message: 'Aktualisierung gestartet', status: 'running' });
        await runFullRefresh();
    } catch (err) {
        console.error('Refresh Fehler:', err.message);
    }
});

app.get('/api/summary/pdf', requireAuth, async (req, res) => {
    try {
        let data = loadCache();
        if (!data || data.length === 0) data = getDemoData();

        const pdfPath = await generateSummaryPDF(data);
        res.download(pdfPath, `Lernplan_SoSe2026_${new Date().toLocaleDateString('de-DE').replace(/\./g, '-')}.pdf`, err => {
            if (err) console.error('PDF Download Fehler:', err);
            // Aufräumen nach Download
            setTimeout(() => {
                try { fs.unlinkSync(pdfPath); } catch { }
            }, 5000);
        });
    } catch (err) {
        console.error('PDF Generierung Fehler:', err.message);
        res.status(500).json({ error: 'PDF-Generierung fehlgeschlagen: ' + err.message });
    }
});

app.get('/api/stats/pdf', requireAuth, async (req, res) => {
    try {
        let data = loadCache();
        if (!data || data.length === 0) data = getDemoData();

        // Build subjects structure expected by statsGenerator
        const grouped = {};
        data.forEach(item => {
            const key = item.courseTitle || 'Allgemein';
            if (!grouped[key]) grouped[key] = { name: key, lectures: [] };
            grouped[key].lectures.push(item);
        });
        const subjects = Object.values(grouped);

        const pdfPath = await generateStatsPDF(subjects);
        const today = new Date().toLocaleDateString('de-DE').replace(/\./g, '-');
        res.download(pdfPath, `Quellenanalyse_${today}.pdf`, err => {
            if (err) console.error('Stats-PDF Fehler:', err);
            setTimeout(() => { try { fs.unlinkSync(pdfPath); } catch { } }, 5000);
        });
    } catch (err) {
        console.error('Stats-PDF Fehler:', err.message);
        res.status(500).json({ error: 'Statistik-PDF fehlgeschlagen: ' + err.message });
    }
});

// ─── Timetable Routes ─────────────────────────────────────────────────────
// GET /api/timetable?week=0  (0 = aktuelle Woche, +1/-1 = vor/zurück)
app.get('/api/timetable', requireAuth, (req, res) => {
    let events = req.query.demo === 'true' ? getDemoTimetable() : loadTimetableCache();
    if (!events || events.length === 0) {
        events = getDemoTimetable();
        saveTimetableCache(events);
    }
    const weekOffset = parseInt(req.query.week || '0');
    const semKey = req.query.semester || 'ss26';
    const semStarts = {
        ss26: '2026-04-20', ws2627: '2026-10-15',
        ss27: '2027-04-19', ws2728: '2027-10-14'
    };
    const semStart = new Date(semStarts[semKey] || semStarts.ss26);
    const weekEvents = getWeekEvents(events, weekOffset, semStart);
    const meta = getTimetableMeta();
    res.json({ events: weekEvents, total: events.length, weekOffset, lastUpdated: meta.lastUpdated });
});

app.get('/api/timetable/all', requireAuth, (req, res) => {
    let events = loadTimetableCache();
    if (!events || events.length === 0) events = getDemoTimetable();
    res.json({ events, lastUpdated: getTimetableMeta().lastUpdated });
});

app.get('/api/timetable/status', requireAuth, (req, res) => {
    res.json({ ...getTimetableProgress(), lastUpdated: getTimetableMeta().lastUpdated });
});

app.post('/api/timetable/refresh', requireAuth, async (req, res) => {
    res.json({ message: 'Stundenplan-Aktualisierung gestartet', status: 'running' });
    runTimetableRefresh(false).catch(e => console.error('Timetable refresh:', e.message));
});

app.post('/api/timetable/test-mail', requireAuth, async (req, res) => {
    try {
        await sendTestMail();
        res.json({ success: true, message: 'Test-Mail gesendet!' });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ─── Lernplan Routes ─────────────────────────────────────────────────────

// GET /api/lernplan/exams - alle Prüfungen
app.get('/api/lernplan/exams', requireAuth, (req, res) => {
    res.json(loadExams());
});

// POST /api/lernplan/exams - neue Prüfung anlegen
app.post('/api/lernplan/exams', requireAuth, (req, res) => {
    try {
        const timetableEvents = loadTimetableCache() || [];
        const exam = createExam(req.body, timetableEvents);
        console.log(`🎯 Prüfung angelegt: ${exam.subject} | Themen: ${(exam.selectedTopics || []).length} | Blöcke: ${(exam.learnBlocks || []).length}`);
        res.json(exam);
    } catch (err) {
        console.error('Lernplan Fehler:', err.message, err.stack);
        res.status(500).json({ error: err.message });
    }
});

// PATCH /api/lernplan/exams/:id - Status ändern
app.patch('/api/lernplan/exams/:id', requireAuth, (req, res) => {
    const { status, showInCalendar } = req.body;
    let exam = null;
    if (status !== undefined) exam = updateExamStatus(req.params.id, status);
    if (showInCalendar !== undefined) exam = toggleCalendar(req.params.id, showInCalendar);
    if (!exam) return res.status(404).json({ error: 'Prüfung nicht gefunden' });
    res.json(exam);
});

// DELETE /api/lernplan/exams/:id - Prüfung löschen
app.delete('/api/lernplan/exams/:id', requireAuth, (req, res) => {
    deleteExam(req.params.id);
    res.json({ success: true });
});

// GET /api/lernplan/calendar - Lernblöcke für eine Woche
app.get('/api/lernplan/calendar', requireAuth, (req, res) => {
    const weekOffset = parseInt(req.query.week || '0');
    const events = getCalendarEvents(weekOffset);
    res.json({ events, weekOffset });
});

// GET /api/lernplan/pdf - PDF Prüfungsübersicht
app.get('/api/lernplan/pdf', requireAuth, async (req, res) => {
    try {
        const exams = loadExams();
        const { generateLernplanPDF } = require('./src/lernplanPdfGenerator');
        const pdfPath = await generateLernplanPDF(exams);
        const today = new Date().toLocaleDateString('de-DE').replace(/\./g, '-');
        res.download(pdfPath, `Pruefungsuebersicht_${today}.pdf`, err => {
            if (err) console.error('Lernplan PDF Fehler:', err);
            setTimeout(() => { try { fs.unlinkSync(pdfPath); } catch { } }, 5000);
        });
    } catch (err) {
        console.error('Lernplan PDF Fehler:', err.message);
        res.status(500).json({ error: 'PDF-Generierung fehlgeschlagen: ' + err.message });
    }
});

// ─── Utility Routes ───────────────────────────────────────────────────────
app.post('/api/auth/reset-pin', async (req, res) => {
    // Clear PIN hash in env (next login will set a new one)
    let envContent = '';
    const ENV_PATH = path.join(__dirname, '.env');
    if (fs.existsSync(ENV_PATH)) {
        envContent = fs.readFileSync(ENV_PATH, 'utf8');
        envContent = envContent.replace(/PIN_HASH=.*/g, 'PIN_HASH=');
        fs.writeFileSync(ENV_PATH, envContent);
    }
    process.env.PIN_HASH = '';
    req.session.destroy();
    res.json({ success: true });
});

app.post('/api/cache/clear', requireAuth, (req, res) => {
    const { clearCache } = require('./src/cache');
    clearCache();
    res.json({ success: true });
});

// ─── Version ──────────────────────────────────────────────────────────────
app.get('/api/version', (req, res) => {
    const { version } = require('./package.json');
    res.json({ version });
});

// ─── iCal Kalender-Feed ───────────────────────────────────────────────────
// Öffentlich zugänglich (kein Session-Auth), aber durch optionalen Token geschützt
app.get('/api/calendar/ical', (req, res) => {
    try {
        const expectedToken = process.env.ICAL_TOKEN;
        if (expectedToken && req.query.token !== expectedToken) {
            return res.status(401).send('Unauthorized – bitte ICAL_TOKEN als Query-Parameter angeben');
        }
        const timetableEvents = loadTimetableCache() || [];
        const exams = loadExams();
        const ical = generateIcal(timetableEvents, exams);
        res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
        res.setHeader('Content-Disposition', 'attachment; filename="tuetool.ics"');
        res.setHeader('Cache-Control', 'no-cache, max-age=0');
        res.send(ical);
        console.log('📅 iCal Feed abgerufen');
    } catch (err) {
        console.error('iCal Fehler:', err.message);
        res.status(500).send('iCal-Generierung fehlgeschlagen');
    }
});

// POST /api/lernplan/exams/import – Restore exams from localStorage backup
app.post('/api/lernplan/exams/import', requireAuth, (req, res) => {
    try {
        const incoming = req.body.exams;
        if (!Array.isArray(incoming) || incoming.length === 0) {
            return res.json({ restored: 0 });
        }
        const existing = loadExams();
        if (existing.length > 0) {
            // Server already has data – don't overwrite
            return res.json({ restored: 0, skipped: true });
        }
        // Validate and save
        const fs = require('fs');
        const path = require('path');
        const LERNPLAN_PATH = path.join(__dirname, 'cache/lernplan.json');
        fs.mkdirSync(path.dirname(LERNPLAN_PATH), { recursive: true });
        fs.writeFileSync(LERNPLAN_PATH, JSON.stringify(incoming, null, 2));
        console.log(`📥 ${incoming.length} Prüfungen aus localStorage wiederhergestellt`);
        res.json({ restored: incoming.length });
    } catch (err) {
        console.error('Import Fehler:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// ─── SPA Fallback ─────────────────────────────────────────────────────────
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ─── Start ────────────────────────────────────────────────────────────────
app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n🎓 Uni Tübingen Lernplan App`);
    console.log(`🚀 Server läuft auf Port ${PORT}`);
    console.log(`📱 Öffne auf iPhone: Stelle sicher, dass du im gleichen WLAN bist`);

    const pinSet = !!(process.env.PIN_HASH && process.env.PIN_HASH.trim());
    if (!pinSet) {
        console.log(`\n⚠️  Kein PIN gesetzt! Beim ersten Login wird dein PIN automatisch gespeichert.`);
    }

    // Scheduler starten (tägliche Aktualisierung)
    startScheduler();

    // Initiale Demo-Daten laden falls Cache leer
    if (!loadCache()) {
        const demo = getDemoData();
        saveCache(demo);
        console.log('📊 Demo-Daten geladen (konfiguriere .env für echte Plattform-Daten)');
    }
});

module.exports = app;
