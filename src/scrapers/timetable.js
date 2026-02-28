/**
 * Stundenplan-Scraper
 * Holt Termine aus ALMA, ILIAS, MOODLE und dedupliziert sie
 */
const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');

// ─── ALMA (HIS/LSF – Hauptquelle für Stundenpläne) ────────────────
async function scrapeAlmaTimetable() {
    if (!process.env.ALMA_USER || process.env.ALMA_USER === 'dein_benutzername') {
        console.log('⚠️  ALMA: Nicht konfiguriert, überspringe Stundenplan-Scraping.');
        return [];
    }

    const BASE_URL = process.env.ALMA_URL || 'https://alma.uni-tuebingen.de';
    const cookieJar = {};
    const client = axios.create({ baseURL: BASE_URL, maxRedirects: 10, timeout: 30000 });

    client.interceptors.response.use(res => {
        (res.headers['set-cookie'] || []).forEach(c => {
            const [kv] = c.split(';');
            const [k, v] = kv.split('=');
            if (k) cookieJar[k.trim()] = (v || '').trim();
        });
        return res;
    });
    client.interceptors.request.use(cfg => {
        cfg.headers['Cookie'] = Object.entries(cookieJar).map(([k, v]) => `${k}=${v}`).join('; ');
        return cfg;
    });

    try {
        // Login
        const loginPage = await client.get('/');
        const $ = cheerio.load(loginPage.data);
        const formAction = $('form').first().attr('action') || '/';
        await client.post(formAction, new URLSearchParams({
            username: process.env.ALMA_USER,
            password: process.env.ALMA_PASS,
            submit: 'Anmelden'
        }).toString(), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });

        // Stundenplan laden (persönlicher Stundenplan)
        const schedPage = await client.get('/qisserver/rds?state=wplan&act=Stundenplan&show=plan&P.subc=pm&expand=0');
        const $s = cheerio.load(schedPage.data);
        const events = [];

        // Stundenplan-Tabelle parsen (typisches HIS-Format)
        $s('table.tb').each((_, table) => {
            $s(table).find('tr').each((_, row) => {
                const cells = $s(row).find('td');
                if (cells.length >= 4) {
                    const title = $s(cells[0]).text().trim();
                    const timeStr = $s(cells[1]).text().trim();
                    const location = $s(cells[2]).text().trim();
                    const lecturer = $s(cells[3]).text().trim();
                    const dayStr = $s(cells[4] || cells[0]).text().trim();

                    if (title && title.length > 3) {
                        const { timeFrom, timeTo, weekday, date } = parseTimeString(timeStr, dayStr);
                        events.push({
                            id: generateId(title, timeStr, location),
                            title,
                            timeFrom,
                            timeTo,
                            weekday,
                            date,
                            location,
                            lecturer,
                            subject: guessSubject(title),
                            mandatory: isMandatory(title),
                            platform: 'ALMA'
                        });
                    }
                }
            });
        });

        console.log(`📅 ALMA Stundenplan: ${events.length} Termine gefunden`);
        return events;
    } catch (err) {
        console.error(`❌ ALMA Stundenplan Fehler: ${err.message}`);
        return [];
    }
}

// ─── MOODLE (Kalender-Events) ──────────────────────────────────────
async function scrapeMoodleTimetable() {
    if (!process.env.MOODLE_USER || process.env.MOODLE_USER === 'dein_benutzername') return [];

    const BASE_URL = process.env.MOODLE_URL || 'https://moodle.zdv.uni-tuebingen.de';
    const token = process.env.MOODLE_TOKEN;
    const events = [];

    try {
        if (token && token.trim()) {
            // REST API: Kalender-Events
            const res = await axios.post(`${BASE_URL}/webservice/rest/server.php`, null, {
                params: {
                    wstoken: token,
                    moodlewsrestformat: 'json',
                    wsfunction: 'core_calendar_get_calendar_upcoming_view'
                },
                timeout: 20000
            }).catch(() => null);

            if (res?.data?.events) {
                res.data.events.forEach(e => {
                    if (e.modulename !== 'assign') { // Keine Abgaben, nur echte Termine
                        events.push({
                            id: generateId(e.name, e.timestart),
                            title: e.name,
                            timeFrom: new Date(e.timestart * 1000).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }),
                            timeTo: e.timeduration ? new Date((e.timestart + e.timeduration) * 1000).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }) : '',
                            date: new Date(e.timestart * 1000).toISOString(),
                            weekday: new Date(e.timestart * 1000).getDay(),
                            location: e.location || '',
                            lecturer: '',
                            subject: guessSubject(e.name),
                            mandatory: isMandatory(e.name),
                            platform: 'MOODLE'
                        });
                    }
                });
            }
        }
    } catch (err) {
        console.warn(`⚠️  MOODLE Kalender: ${err.message}`);
    }

    console.log(`📅 MOODLE Stundenplan: ${events.length} Termine`);
    return events;
}

// ─── ILIAS (Kalender) ─────────────────────────────────────────────
async function scrapeIliasTimetable() {
    if (!process.env.ILIAS_USER || process.env.ILIAS_USER === 'dein_benutzername') return [];

    const BASE_URL = process.env.ILIAS_URL || 'https://ilias.uni-tuebingen.de';
    const cookieJar = {};
    const client = axios.create({ baseURL: BASE_URL, maxRedirects: 10, timeout: 30000 });

    client.interceptors.response.use(res => {
        (res.headers['set-cookie'] || []).forEach(c => {
            const [kv] = c.split(';');
            const [k, v] = kv.split('=');
            if (k) cookieJar[k.trim()] = (v || '').trim();
        });
        return res;
    });
    client.interceptors.request.use(cfg => {
        cfg.headers['Cookie'] = Object.entries(cookieJar).map(([k, v]) => `${k}=${v}`).join('; ');
        return cfg;
    });

    try {
        // Login
        const loginPage = await client.get('/ilias.php?lang=de&cmd=force_login&baseClass=ilStartUpGUI');
        const $ = cheerio.load(loginPage.data);
        const loginForm = $('form.ilLoginForm, form[name="form_"]');
        const params = new URLSearchParams();
        params.append('username', process.env.ILIAS_USER);
        params.append('password', process.env.ILIAS_PASS);
        params.append('cmd[doStandardAuthentication]', 'Anmelden');
        loginForm.find('input[type=hidden]').each((_, el) => {
            params.append($(el).attr('name'), $(el).val() || '');
        });
        await client.post(loginForm.attr('action') || '/ilias.php', params.toString(), {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        });

        // Kalender-Seite
        const calPage = await client.get('/ilias.php?baseClass=ilCalendarPresentationGUI&cmd=month');
        const $c = cheerio.load(calPage.data);
        const events = [];

        $c('.ilCalendarAppointmentBg, .calendarRow').each((_, el) => {
            const title = $c(el).find('.ilCalendarLabel, .title').text().trim();
            const timeStr = $c(el).find('.time').text().trim();
            if (title && title.length > 2) {
                events.push({
                    id: generateId(title, timeStr),
                    title,
                    timeFrom: timeStr.split('-')[0]?.trim() || '',
                    timeTo: timeStr.split('-')[1]?.trim() || '',
                    date: new Date().toISOString(),
                    weekday: 0,
                    location: $c(el).find('.location').text().trim(),
                    lecturer: '',
                    subject: guessSubject(title),
                    mandatory: isMandatory(title),
                    platform: 'ILIAS'
                });
            }
        });

        console.log(`📅 ILIAS Kalender: ${events.length} Termine`);
        return events;
    } catch (err) {
        console.warn(`⚠️  ILIAS Kalender: ${err.message}`);
        return [];
    }
}

// ─── Helpers ──────────────────────────────────────────────────────
function parseTimeString(timeStr, dayStr) {
    // Format: "Mo 08:15 - 09:45" oder "08:15-09:45"
    const timeMatch = timeStr.match(/(\d{1,2}:\d{2})\s*[-–]\s*(\d{1,2}:\d{2})/);
    const timeFrom = timeMatch ? timeMatch[1] : '';
    const timeTo = timeMatch ? timeMatch[2] : '';

    const WEEKDAYS = { 'Mo': 1, 'Di': 2, 'Mi': 3, 'Do': 4, 'Fr': 5, 'Sa': 6, 'So': 0 };
    const dayMatch = (dayStr + ' ' + timeStr).match(/Mo|Di|Mi|Do|Fr|Sa|So/);
    const weekday = dayMatch ? (WEEKDAYS[dayMatch[0]] || 0) : 0;

    // Datum berechnen (nächstes Vorkommen des Wochentags)
    const now = new Date();
    const curr = now.getDay();
    const diff = (weekday - curr + 7) % 7;
    const date = new Date(now);
    date.setDate(now.getDate() + diff);
    if (timeFrom) {
        const [h, m] = timeFrom.split(':');
        date.setHours(parseInt(h), parseInt(m), 0, 0);
    }

    return { timeFrom, timeTo, weekday, date: date.toISOString() };
}

function guessSubject(title) {
    const SUBJECTS = ['Anatomie', 'Physiologie', 'Biochemie', 'Histologie', 'Biologie', 'Physik', 'Chemie', 'SIMED', 'Klinik', 'Medizin'];
    for (const s of SUBJECTS) {
        if (title.toLowerCase().includes(s.toLowerCase())) return s;
    }
    return 'Allgemein';
}

function isMandatory(title) {
    const keywords = ['pflicht', 'praktikum', 'prak', 'testat', 'schein', 'klausur', 'dissek', 'sezier'];
    return keywords.some(k => title.toLowerCase().includes(k));
}

function generateId(title, time, location = '') {
    return Buffer.from(`${title}|${time}|${location}`).toString('base64').substring(0, 24);
}

function deduplicate(events) {
    const seen = new Set();
    return events.filter(e => {
        const key = `${e.title}|${e.timeFrom}|${e.weekday}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

// ─── Demo-Stundenplan ─────────────────────────────────────────────
function getDemoTimetable() {
    const semStart = new Date('2026-04-20'); // SoSe 2026
    const events = [];

    const slots = [
        { title: 'Anatomie Vorlesung', timeFrom: '08:15', timeTo: '09:45', weekday: 1, subject: 'Anatomie', mandatory: false, location: 'Hörsaal 1' },
        { title: 'Anatomie Praktikum', timeFrom: '14:00', timeTo: '17:00', weekday: 2, subject: 'Anatomie', mandatory: true, location: 'Sezier­saal' },
        { title: 'Physiologie Vorlesung', timeFrom: '10:15', timeTo: '11:45', weekday: 1, subject: 'Physiologie', mandatory: false, location: 'Hörsaal 2' },
        { title: 'Physiologie Praktikum', timeFrom: '14:00', timeTo: '16:00', weekday: 4, subject: 'Physiologie', mandatory: true, location: 'Physiologie-Labor' },
        { title: 'Biochemie Vorlesung', timeFrom: '08:15', timeTo: '09:45', weekday: 3, subject: 'Biochemie', mandatory: false, location: 'Hörsaal 3' },
        { title: 'Biochemie Praktikum', timeFrom: '14:00', timeTo: '17:00', weekday: 5, subject: 'Biochemie', mandatory: true, location: 'Biochemie-Labor' },
        { title: 'Histologie Kurs', timeFrom: '10:15', timeTo: '12:15', weekday: 3, subject: 'Histologie', mandatory: true, location: 'Mikroskopiersaal' },
        { title: 'Biologie Vorlesung', timeFrom: '12:15', timeTo: '13:45', weekday: 2, subject: 'Biologie', mandatory: false, location: 'Hörsaal 4' },
        { title: 'Medizinische Psychologie', timeFrom: '08:15', timeTo: '09:45', weekday: 5, subject: 'Allgemein', mandatory: false, location: 'Hörsaal 5' },
        { title: 'SIMED Kursus', timeFrom: '14:00', timeTo: '16:00', weekday: 3, subject: 'SIMED', mandatory: true, location: 'SIMED-Zentrum' },
        { title: 'Chemie Vorlesung', timeFrom: '10:15', timeTo: '11:45', weekday: 4, subject: 'Chemie', mandatory: false, location: 'Chemie-Hörsaal' },
        { title: 'Physik Vorlesung', timeFrom: '12:15', timeTo: '13:45', weekday: 5, subject: 'Physik', mandatory: false, location: 'Physik-Hörsaal' },
    ];

    // Für jede Semesterwoche Termine generieren (14 Wochen)
    for (let week = 0; week < 14; week++) {
        slots.forEach(slot => {
            const eventDate = new Date(semStart);
            eventDate.setDate(semStart.getDate() + week * 7 + (slot.weekday === 0 ? 6 : slot.weekday - 1));
            const [h, m] = slot.timeFrom.split(':');
            eventDate.setHours(parseInt(h), parseInt(m), 0, 0);

            events.push({
                id: generateId(slot.title, slot.timeFrom, week.toString()),
                title: slot.title,
                timeFrom: slot.timeFrom,
                timeTo: slot.timeTo,
                weekday: slot.weekday,
                date: eventDate.toISOString(),
                location: slot.location,
                lecturer: 'Demo-Dozent',
                subject: slot.subject,
                mandatory: slot.mandatory,
                platform: 'Demo',
                week: week + 1
            });
        });
    }

    return events;
}

// ─── Haupt-Export ─────────────────────────────────────────────────
async function scrapeTimetable() {
    const anyConfigured =
        (process.env.ALMA_USER && process.env.ALMA_USER !== 'dein_benutzername') ||
        (process.env.MOODLE_USER && process.env.MOODLE_USER !== 'dein_benutzername') ||
        (process.env.ILIAS_USER && process.env.ILIAS_USER !== 'dein_benutzername');

    if (!anyConfigured) {
        console.log('📅 Stundenplan: Kein Portal konfiguriert – Demo-Daten werden verwendet.');
        return getDemoTimetable();
    }

    const [alma, moodle, ilias] = await Promise.allSettled([
        scrapeAlmaTimetable(),
        scrapeMoodleTimetable(),
        scrapeIliasTimetable()
    ]);

    const all = [
        ...(alma.status === 'fulfilled' ? alma.value : []),
        ...(moodle.status === 'fulfilled' ? moodle.value : []),
        ...(ilias.status === 'fulfilled' ? ilias.value : [])
    ];

    const deduped = deduplicate(all);
    console.log(`📅 Stundenplan gesamt: ${deduped.length} Termine`);
    return deduped;
}

module.exports = { scrapeTimetable, getDemoTimetable };
