/**
 * ILIAS Scraper – Uni Tübingen
 * Login via SAML2/Shibboleth SSO (idp.uni-tuebingen.de)
 */
const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');

const DOWNLOADS_DIR = path.join(__dirname, '../../downloads/ilias');
const ILIAS_BASE = process.env.ILIAS_URL || 'https://ovidius.uni-tuebingen.de';
const IDP_BASE = 'https://idp.uni-tuebingen.de';

/**
 * Erstellt eine axios-Instanz mit persistentem Cross-Domain Cookie-Jar
 */
function createSession() {
    const cookieJar = {};

    const instance = axios.create({
        maxRedirects: 15,
        timeout: 30000,
        validateStatus: s => s < 500,
        headers: {
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36'
        }
    });

    // Cookies aus allen Antworten sammeln (auch IDP)
    instance.interceptors.response.use(response => {
        const setCookies = response.headers['set-cookie'];
        if (setCookies) {
            setCookies.forEach(c => {
                const [keyVal] = c.split(';');
                const eqIdx = keyVal.indexOf('=');
                if (eqIdx > 0) {
                    const k = keyVal.slice(0, eqIdx).trim();
                    const v = keyVal.slice(eqIdx + 1).trim();
                    cookieJar[k] = v;
                }
            });
        }
        return response;
    });

    // Cookie-Header bei jedem Request setzen
    instance.interceptors.request.use(config => {
        const cookieStr = Object.entries(cookieJar).map(([k, v]) => `${k}=${v}`).join('; ');
        if (cookieStr) config.headers['Cookie'] = cookieStr;
        return config;
    });

    instance._cookieJar = cookieJar;
    return instance;
}

/**
 * SAML2/Shibboleth Login-Flow:
 * ILIAS → (302) → IDP Login-Seite → POST Credentials → SAML-Assertion → ILIAS
 */
async function login() {
    if (!process.env.ILIAS_USER || !process.env.ILIAS_PASS ||
        process.env.ILIAS_USER === 'dein_benutzername') {
        throw new Error('ILIAS-Zugangsdaten nicht konfiguriert. Bitte .env befüllen.');
    }

    const client = createSession();

    // ── Schritt 1: ILIAS aufrufen → wird zu IDP weitergeleitet ──────
    console.log('🔑 ILIAS: Starte SAML2-Login...');
    const step1 = await client.get(`${ILIAS_BASE}/ilias3/ilias.php?lang=de&cmd=force_login&baseClass=ilStartUpGUI`);

    // Nach Redirects landen wir auf dem IDP-Login-Formular
    // Letzte URL manuell aus Location-Header oder aus absenden-URL bauen
    let idpLoginUrl = step1.request?.res?.responseUrl || step1.config?.url || `${IDP_BASE}/idp/profile/SAML2/Redirect/SSO`;

    let $idp = cheerio.load(step1.data);

    // Falls wir noch nicht auf dem IDP sind, folge dem Redirect manuell
    if (!step1.data.includes('idp') && !step1.data.includes('Passwort') && step1.headers?.location) {
        const redirectUrl = step1.headers.location.startsWith('http')
            ? step1.headers.location
            : `${ILIAS_BASE}${step1.headers.location}`;
        const step1b = await client.get(redirectUrl);
        idpLoginUrl = step1b.request?.res?.responseUrl || redirectUrl;
        $idp = cheerio.load(step1b.data);
    }

    // ── Schritt 2: IDP Login-Formular absenden ───────────────────────
    const idpForm = $idp('form').first();
    const idpAction = idpForm.attr('action');
    if (!idpAction) throw new Error('IDP Login-Formular nicht gefunden. URL: ' + idpLoginUrl);

    const idpPostUrl = idpAction.startsWith('http') ? idpAction : `${IDP_BASE}${idpAction}`;

    const idpParams = new URLSearchParams();
    idpParams.append('j_username', process.env.ILIAS_USER);
    idpParams.append('j_password', process.env.ILIAS_PASS);
    idpParams.append('_eventId_proceed', '');

    // Alle versteckten Felder (execution, csrf_token, etc.) mitnehmen
    idpForm.find('input[type=hidden]').each((_, el) => {
        const name = $idp(el).attr('name');
        const value = $idp(el).val() || '';
        if (name) idpParams.set(name, value);
    });

    const step2 = await client.post(idpPostUrl, idpParams.toString(), {
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Referer': idpLoginUrl
        }
    });

    const $saml = cheerio.load(step2.data);

    // ── Schritt 3: SAML-Assertion an ILIAS zurückschicken ───────────
    const samlForm = $saml('form').first();
    const samlAction = samlForm.attr('action');

    if (!samlAction) {
        // Kein SAML-Form → Login fehlgeschlagen
        const errMsg = $saml('.form-element-error, .error, #msg_error').text().trim();
        throw new Error(`IDP Login fehlgeschlagen: ${errMsg || 'Falsches Passwort?'}`);
    }

    const samlParams = new URLSearchParams();
    samlForm.find('input').each((_, el) => {
        const name = $saml(el).attr('name');
        const value = $saml(el).val() || '';
        if (name) samlParams.append(name, value);
    });

    const step3 = await client.post(samlAction, samlParams.toString(), {
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Referer': idpPostUrl
        }
    });

    // ── Schritt 4: Session prüfen ────────────────────────────────────
    const $after = cheerio.load(step3.data);
    const hasCookies = Object.keys(client._cookieJar).some(k => k.toLowerCase().includes('ilias') || k.toLowerCase().includes('session'));
    const hasLogout = $after('[data-action*="logout"], a[href*="logout"]').length > 0;
    const hasPersonalDesktop = $after('.ilStartUpSection, .il-maincontrols-breadcrumbs').length > 0;

    if (!hasCookies && !hasLogout && !hasPersonalDesktop) {
        console.warn('⚠️  ILIAS: Login möglicherweise fehlgeschlagen, versuche fortzufahren...');
    } else {
        console.log('✅ ILIAS: Erfolgreich via SAML2 eingeloggt');
    }

    return client;
}

async function getCourseList(client) {
    const response = await client.get('ilias.php?baseClass=ilPersonalDesktopGUI&cmd=jumpToSelectedItems');
    const $ = cheerio.load(response.data);
    const courses = [];

    // Kurse aus der Sidebar / Meine Kurse
    $('a[href*="ref_id"]').each((_, el) => {
        const href = $(el).attr('href');
        const title = $(el).text().trim();
        const refMatch = href && href.match(/ref_id=(\d+)/);
        if (refMatch && title && title.length > 3) {
            const refId = refMatch[1];
            if (!courses.find(c => c.refId === refId)) {
                courses.push({ title, refId, href: `${BASE_URL}/${href}` });
            }
        }
    });

    console.log(`📚 ILIAS: ${courses.length} Kurse gefunden`);
    return courses;
}

async function getCourseMaterials(client, course) {
    const response = await client.get(
        `ilias.php?ref_id=${course.refId}&baseClass=ilRepositoryGUI`
    );
    const $ = cheerio.load(response.data);
    const materials = [];

    $('a[href*=".pdf"], a[href*=".pptx"], a[href*=".ppt"], a[href*="download"]').each((_, el) => {
        const href = $(el).attr('href');
        const title = $(el).text().trim() || $(el).attr('title') || 'Unbenannt';
        if (href && !materials.find(m => m.url === href)) {
            let url = href.startsWith('http') ? href : `${BASE_URL}${href}`;
            const ext = href.toLowerCase().includes('.pptx') ? '.pptx' :
                href.toLowerCase().includes('.ppt') ? '.ppt' : '.pdf';
            materials.push({ title, url, ext, courseTitle: course.title });
        }
    });

    return materials;
}

async function downloadFile(client, material) {
    const courseDir = path.join(DOWNLOADS_DIR, material.courseTitle.replace(/[^a-zA-Z0-9äöüÄÖÜ\s-]/g, '').trim());
    fs.mkdirSync(courseDir, { recursive: true });

    const fileName = `${material.title.replace(/[^a-zA-Z0-9äöüÄÖÜ\s-]/g, '').trim()}${material.ext}`;
    const filePath = path.join(courseDir, fileName);

    if (fs.existsSync(filePath)) return { ...material, filePath };

    try {
        const response = await client.get(material.url, { responseType: 'arraybuffer', timeout: 60000 });
        fs.writeFileSync(filePath, response.data);
        console.log(`  ⬇️  Heruntergeladen: ${fileName}`);
        return { ...material, filePath };
    } catch (err) {
        console.warn(`  ⚠️  Fehler beim Download: ${fileName} – ${err.message}`);
        return null;
    }
}

async function scrapeILIAS() {
    fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });

    if (!process.env.ILIAS_USER || process.env.ILIAS_USER === 'dein_benutzername') {
        console.log('⚠️  ILIAS: Nicht konfiguriert, überspringe...');
        return [];
    }

    try {
        const client = await login();
        const courses = await getCourseList(client);
        const allMaterials = [];

        for (const course of courses.slice(0, 20)) { // Max 20 Kurse
            try {
                const materials = await getCourseMaterials(client, course);
                for (const material of materials.slice(0, 10)) { // Max 10 Dateien pro Kurs
                    const downloaded = await downloadFile(client, material);
                    if (downloaded) allMaterials.push(downloaded);
                }
            } catch (err) {
                console.warn(`  ⚠️  Fehler bei Kurs ${course.title}: ${err.message}`);
            }
        }

        return allMaterials;
    } catch (err) {
        console.error(`❌ ILIAS Fehler: ${err.message}`);
        return [];
    }
}

module.exports = { scrapeILIAS };
