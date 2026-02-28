/**
 * MOODLE Scraper/API – Uni Tübingen
 * Nutzt REST API wenn Token vorhanden, sonst Session-Scraping
 */
const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');

const DOWNLOADS_DIR = path.join(__dirname, '../../downloads/moodle');
const BASE_URL = process.env.MOODLE_URL || 'https://moodle.zdv.uni-tuebingen.de';

// --- REST API Methode ---
async function getMoodleViaApi() {
    const token = process.env.MOODLE_TOKEN;
    if (!token || token.trim() === '' || token === 'dein_api_token_optional') {
        return null; // Kein Token → Fallback zu Scraping
    }

    const apiBase = `${BASE_URL}/webservice/rest/server.php`;

    async function call(wsfunction, params = {}) {
        const response = await axios.post(apiBase, null, {
            params: { wstoken: token, moodlewsrestformat: 'json', wsfunction, ...params }
        });
        if (response.data.exception) throw new Error(response.data.message);
        return response.data;
    }

    // Meine Kurse laden
    const courses = await call('core_course_get_enrolled_courses_by_timeline_classification', {
        classification: 'inprogress', limit: 50
    }).catch(() => call('core_enrol_get_users_courses', { userid: 0 }));

    const courseList = Array.isArray(courses) ? courses : (courses.courses || []);
    console.log(`📚 MOODLE API: ${courseList.length} Kurse gefunden`);

    const materials = [];
    for (const course of courseList) {
        try {
            const contents = await call('core_course_get_contents', { courseid: course.id });
            for (const section of contents) {
                for (const module of (section.modules || [])) {
                    if (module.modname === 'resource' && module.contents) {
                        for (const file of module.contents) {
                            if (/\.(pdf|pptx|ppt)$/i.test(file.filename)) {
                                materials.push({
                                    title: module.name,
                                    url: `${file.fileurl}&token=${token}`,
                                    ext: path.extname(file.filename).toLowerCase(),
                                    courseTitle: course.fullname,
                                    date: file.timemodified ? new Date(file.timemodified * 1000) : new Date()
                                });
                            }
                        }
                    }
                }
            }
        } catch (err) {
            console.warn(`  ⚠️  MOODLE Kurs ${course.fullname}: ${err.message}`);
        }
    }

    return materials;
}

// --- Session Scraping Fallback ---
async function getMoodleViaScraping() {
    if (!process.env.MOODLE_USER || process.env.MOODLE_USER === 'dein_benutzername') {
        return [];
    }

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

    // Login-Token holen
    const loginPage = await client.get('/login/index.php');
    const $ = cheerio.load(loginPage.data);
    const logintoken = $('input[name=logintoken]').val() || '';

    await client.post('/login/index.php', new URLSearchParams({
        username: process.env.MOODLE_USER,
        password: process.env.MOODLE_PASS,
        logintoken
    }).toString(), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });

    // Kurse laden
    const myCoursesPage = await client.get('/my/courses.php');
    const $mc = cheerio.load(myCoursesPage.data);
    const courses = [];
    $mc('a[href*="/course/view.php"]').each((_, el) => {
        const href = $mc(el).attr('href');
        const title = $mc(el).text().trim();
        if (href && title) courses.push({ title, url: href });
    });

    console.log(`📚 MOODLE Scraping: ${courses.length} Kurse gefunden`);

    const materials = [];
    for (const course of courses.slice(0, 15)) {
        const coursePage = await client.get(course.url).catch(() => null);
        if (!coursePage) continue;
        const $c = cheerio.load(coursePage.data);
        $c('a[href*="pluginfile"], a[href*="mod/resource"]').each((_, el) => {
            const href = $c(el).attr('href');
            if (href && /\.(pdf|pptx|ppt)$/i.test(href)) {
                materials.push({
                    title: $c(el).text().trim() || 'Dokument',
                    url: href,
                    ext: path.extname(href).toLowerCase(),
                    courseTitle: course.title,
                    date: new Date()
                });
            }
        });
    }

    return materials;
}

async function downloadMoodleFile(client, material) {
    fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });
    const courseDir = path.join(DOWNLOADS_DIR, material.courseTitle.replace(/[^a-zA-Z0-9äöüÄÖÜ\s-]/g, '').trim());
    fs.mkdirSync(courseDir, { recursive: true });

    const fileName = `${material.title.replace(/[^a-zA-Z0-9äöüÄÖÜ\s-]/g, '').trim()}${material.ext}`;
    const filePath = path.join(courseDir, fileName);
    if (fs.existsSync(filePath)) return { ...material, filePath };

    try {
        const res = await (client || axios).get(material.url, { responseType: 'arraybuffer', timeout: 60000 });
        fs.writeFileSync(filePath, res.data);
        console.log(`  ⬇️  Heruntergeladen: ${fileName}`);
        return { ...material, filePath };
    } catch (err) {
        console.warn(`  ⚠️  Download Fehler: ${fileName}`);
        return null;
    }
}

async function scrapeMoodle() {
    if (!process.env.MOODLE_USER || process.env.MOODLE_USER === 'dein_benutzername') {
        console.log('⚠️  MOODLE: Nicht konfiguriert, überspringe...');
        return [];
    }

    try {
        let materials = await getMoodleViaApi();
        if (materials === null) {
            console.log('🔄 MOODLE: Kein API-Token, nutze Scraping...');
            materials = await getMoodleViaScraping();
        } else {
            console.log('✅ MOODLE: Nutze REST API');
        }

        const downloaded = [];
        for (const material of materials.slice(0, 50)) {
            const result = await downloadMoodleFile(null, material);
            if (result) downloaded.push(result);
        }
        return downloaded;
    } catch (err) {
        console.error(`❌ MOODLE Fehler: ${err.message}`);
        return [];
    }
}

module.exports = { scrapeMoodle };
