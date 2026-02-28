/**
 * SIMED Scraper – Uni Tübingen (Simulationsmedizin / SIMED)
 * Session-basiertes Scraping
 */
const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');

const DOWNLOADS_DIR = path.join(__dirname, '../../downloads/simed');
const BASE_URL = process.env.SIMED_URL || 'https://simed.uni-tuebingen.de';

async function scrapeSimed() {
    fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });

    if (!process.env.SIMED_USER || process.env.SIMED_USER === 'dein_benutzername') {
        console.log('⚠️  SIMED: Nicht konfiguriert, überspringe...');
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

        // SIMED Login
        const loginPage = await client.get('/Login');
        const $ = cheerio.load(loginPage.data);
        const csrfToken = $('input[name="_csrf_token"], input[name="csrfmiddlewaretoken"], input[name="_token"]').val() || '';
        const formAction = $('form').first().attr('action') || '/Login';

        await client.post(formAction, new URLSearchParams({
            _username: process.env.SIMED_USER,
            _password: process.env.SIMED_PASS,
            username: process.env.SIMED_USER,
            password: process.env.SIMED_PASS,
            _csrf_token: csrfToken,
            submit: 'Login'
        }).toString(), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });

        const dashPage = await client.get('/');
        const $dash = cheerio.load(dashPage.data);

        const materials = [];
        $dash('a[href*=".pdf"], a[href*=".pptx"]').each((_, el) => {
            const href = $dash(el).attr('href');
            const title = $dash(el).text().trim() || 'SIMED Dokument';
            if (href) {
                materials.push({
                    title,
                    url: href.startsWith('http') ? href : `${BASE_URL}${href}`,
                    ext: href.toLowerCase().endsWith('.pptx') ? '.pptx' : '.pdf',
                    courseTitle: 'SIMED',
                    platform: 'SIMED'
                });
            }
        });

        console.log(`📚 SIMED: ${materials.length} Materialien gefunden`);

        const downloaded = [];
        for (const material of materials.slice(0, 20)) {
            const courseDir = path.join(DOWNLOADS_DIR, 'SIMED');
            fs.mkdirSync(courseDir, { recursive: true });
            const fileName = `${material.title.replace(/[^a-zA-Z0-9äöüÄÖÜ\s-]/g, '').trim()}${material.ext}`;
            const filePath = path.join(courseDir, fileName);

            if (!fs.existsSync(filePath)) {
                try {
                    const res = await client.get(material.url, { responseType: 'arraybuffer', timeout: 60000 });
                    fs.writeFileSync(filePath, res.data);
                    console.log(`  ⬇️  Heruntergeladen: ${fileName}`);
                } catch {
                    continue;
                }
            }
            downloaded.push({ ...material, filePath });
        }

        return downloaded;
    } catch (err) {
        console.error(`❌ SIMED Fehler: ${err.message}`);
        return [];
    }
}

module.exports = { scrapeSimed };
