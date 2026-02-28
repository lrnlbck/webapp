/**
 * ALMA Scraper – Uni Tübingen (Lehrveranstaltungsplanung)
 * alma.uni-tuebingen.de – Session-basiertes Scraping
 */
const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');

const DOWNLOADS_DIR = path.join(__dirname, '../../downloads/alma');
const BASE_URL = process.env.ALMA_URL || 'https://alma.uni-tuebingen.de';

async function scrapeAlma() {
    fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });

    if (!process.env.ALMA_USER || process.env.ALMA_USER === 'dein_benutzername') {
        console.log('⚠️  ALMA: Nicht konfiguriert, überspringe...');
        return [];
    }

    try {
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

        // ALMA Login (HIS/LSF Style)
        const loginPage = await client.get('/');
        const $ = cheerio.load(loginPage.data);

        const formAction = $('form').first().attr('action') || '';
        await client.post(formAction, new URLSearchParams({
            username: process.env.ALMA_USER,
            password: process.env.ALMA_PASS,
            submit: 'Anmelden'
        }).toString(), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });

        // Lehrveranstaltungen abrufen
        const lvPage = await client.get('qisserver/rds?state=wplan&act=stg&show=plan&P.subc=pm');
        const $lv = cheerio.load(lvPage.data);
        const courses = [];

        $lv('table.tb tr').each((_, row) => {
            const cells = $lv(row).find('td');
            if (cells.length >= 2) {
                const title = $lv(cells[0]).text().trim();
                const link = $lv(cells[0]).find('a').attr('href');
                if (title && title.length > 3) {
                    courses.push({ title, url: link ? `${BASE_URL}${link}` : null });
                }
            }
        });

        console.log(`📚 ALMA: ${courses.length} Lehrveranstaltungen gefunden`);

        // ALMA liefert primär Stundenplan-Daten, keine direkten Dateien
        // Wir extrahieren Metadaten für den Lernplan
        const schedule = [];
        for (const course of courses.slice(0, 30)) {
            schedule.push({
                title: course.title,
                courseTitle: course.title,
                platform: 'ALMA',
                type: 'schedule',
                filePath: null
            });
        }

        return schedule;
    } catch (err) {
        console.error(`❌ ALMA Fehler: ${err.message}`);
        return [];
    }
}

module.exports = { scrapeAlma };
