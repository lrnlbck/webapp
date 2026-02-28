/**
 * Portal Status Checker
 * Führt leichte Login-Pings aus, um zu prüfen ob die Credentials in Railway korrekt sind.
 */
const axios = require('axios');
const cheerio = require('cheerio');

async function checkIlias() {
    if (!process.env.ILIAS_USER || process.env.ILIAS_USER === 'dein_benutzername') return 'not_configured';
    try {
        const ILIAS_BASE = process.env.ILIAS_URL || 'https://ovidius.uni-tuebingen.de';
        const IDP_BASE = 'https://idp.uni-tuebingen.de';
        const cookieJar = {};
        const client = axios.create({ maxRedirects: 15, timeout: 20000, validateStatus: s => s < 500 });

        client.interceptors.response.use(r => {
            (r.headers['set-cookie'] || []).forEach(c => {
                const [kv] = c.split(';');
                const idx = kv.indexOf('=');
                if (idx > 0) cookieJar[kv.slice(0, idx).trim()] = kv.slice(idx + 1).trim();
            });
            return r;
        });
        client.interceptors.request.use(cfg => {
            const cs = Object.entries(cookieJar).map(([k, v]) => `${k}=${v}`).join('; ');
            if (cs) cfg.headers['Cookie'] = cs;
            return cfg;
        });

        // Schritt 1: ILIAS aufrufen
        const step1Url = `${ILIAS_BASE}/ilias3/ilias.php?lang=de&cmd=force_login&baseClass=ilStartUpGUI`;
        console.log(`🔍 ILIAS Check Schritt 1: GET ${step1Url}`);
        const r1 = await client.get(step1Url);
        console.log(`🔍 ILIAS Schritt 1 Status: ${r1.status}, URL nach Redirects: ${r1.request?.res?.responseUrl || '?'}`);
        console.log(`🔍 ILIAS Schritt 1 HTML-Anfang: ${r1.data.substring(0, 400)}`);

        const $idp = cheerio.load(r1.data);
        const idpForm = $idp('form').first();
        const idpAction = idpForm.attr('action');
        console.log(`🔍 ILIAS IDP-Form action: ${idpAction || 'NICHT GEFUNDEN'}`);
        console.log(`🔍 ILIAS Alle Forms auf Seite: ${$idp('form').length}`);

        if (!idpAction) {
            console.error('❌ ILIAS: IDP Login-Formular nicht gefunden. Response HTML:', r1.data.substring(0, 600));
            return 'error';
        }

        const idpPostUrl = idpAction.startsWith('http') ? idpAction : `${IDP_BASE}${idpAction}`;
        const idpParams = new URLSearchParams();
        idpParams.append('j_username', process.env.ILIAS_USER);
        idpParams.append('j_password', process.env.ILIAS_PASS || '');
        idpParams.append('_eventId_proceed', '');
        idpForm.find('input[type=hidden]').each((_, el) => {
            const n = $idp(el).attr('name');
            if (n) idpParams.set(n, $idp(el).val() || '');
        });

        // Schritt 2: Credentials an IDP
        console.log(`🔍 ILIAS Check Schritt 2: POST ${idpPostUrl}`);
        const r2 = await client.post(idpPostUrl, idpParams.toString(), {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        });
        console.log(`🔍 ILIAS Schritt 2 Status: ${r2.status}`);
        const $r2 = cheerio.load(r2.data);

        const samlAction = $r2('form').first().attr('action');
        console.log(`🔍 ILIAS SAML Action: ${samlAction || 'NICHT GEFUNDEN'}`);
        if (!samlAction) {
            console.error('❌ ILIAS: SAML-Assertion form nicht gefunden. IDP Antwort:', r2.data.substring(0, 500));
            return 'error';
        }

        const samlParams = new URLSearchParams();
        $r2('form input').each((_, el) => {
            const n = $r2(el).attr('name');
            if (n) samlParams.append(n, $r2(el).val() || '');
        });
        const r3 = await client.post(samlAction, samlParams.toString(), {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        });
        console.log(`🔍 ILIAS Schritt 3 Status: ${r3.status}`);
        const $r3 = cheerio.load(r3.data);
        const ok = $r3('[data-action*="logout"], a[href*="logout"], .il-maincontrols-breadcrumbs').length > 0
            || Object.keys(cookieJar).some(k => k.toLowerCase().includes('ilias'));
        if (!ok) console.warn('⚠️  ILIAS: SAML abgeschlossen, aber kein Login erkannt. Seite:', r3.data.substring(0, 300));
        else console.log('✅ ILIAS: Erfolgreich eingeloggt');
        return ok ? 'connected' : 'error';
    } catch (e) {
        console.error('❌ ILIAS Verbindungsfehler:', e.message);
        return 'error';
    }
}


async function checkAlma() {
    if (!process.env.ALMA_USER || process.env.ALMA_USER === 'dein_benutzername') return 'not_configured';
    try {
        const baseURL = process.env.ALMA_URL || 'https://alma.uni-tuebingen.de';
        const client = axios.create({ baseURL, maxRedirects: 10, timeout: 10000 });
        const loginPage = await client.get('/');
        const $ = cheerio.load(loginPage.data);
        const formAction = $('form').first().attr('action') || '';
        const res = await client.post(formAction, new URLSearchParams({
            username: process.env.ALMA_USER, password: process.env.ALMA_PASS, submit: 'Anmelden'
        }).toString(), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
        // Error on ALMA usually throws HTTP error or stays on login page
        const isErrorPage = res.data.includes('nicht korrekt') || res.data.includes('Fehler');
        if (isErrorPage) console.warn('⚠️  ALMA: Login fehlgeschlagen – Passwort falsch?');
        return isErrorPage ? 'error' : 'connected';
    } catch (e) {
        console.error('❌ ALMA Verbindungsfehler:', e.message);
        return 'error';
    }
}

async function checkMoodle() {
    if (!process.env.MOODLE_USER || process.env.MOODLE_USER === 'dein_benutzername') {
        if (!process.env.MOODLE_TOKEN) return 'not_configured';
        return 'connected';
    }
    try {
        const baseURL = process.env.MOODLE_URL || 'https://moodle.zdv.uni-tuebingen.de';
        const cookieJar = {};
        const client = axios.create({ baseURL, timeout: 15000, maxRedirects: 10, validateStatus: s => s < 500 });
        client.interceptors.response.use(r => {
            (r.headers['set-cookie'] || []).forEach(c => {
                const [kv] = c.split(';');
                const idx = kv.indexOf('=');
                if (idx > 0) cookieJar[kv.slice(0, idx).trim()] = kv.slice(idx + 1).trim();
            });
            return r;
        });
        client.interceptors.request.use(cfg => {
            const cs = Object.entries(cookieJar).map(([k, v]) => `${k}=${v}`).join('; ');
            if (cs) cfg.headers['Cookie'] = cs;
            return cfg;
        });

        const loginPage = await client.get('/login/index.php');
        const $ = cheerio.load(loginPage.data);
        const loginToken = $('input[name="logintoken"]').val() || '';

        const res = await client.post('/login/index.php', new URLSearchParams({
            username: process.env.MOODLE_USER,
            password: process.env.MOODLE_PASS,
            logintoken: loginToken,
            anchor: ''
        }).toString(), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });

        const success = res.data.includes('logout.php') || res.data.includes('user/profile.php')
            || Object.keys(cookieJar).some(k => k.toLowerCase().includes('moodle'));
        if (!success) console.warn('⚠️  MOODLE: Login fehlgeschlagen. Seitenanfang:', res.data.substring(0, 200));
        return success ? 'connected' : 'error';
    } catch (e) {
        console.error('❌ MOODLE Verbindungsfehler:', e.message);
        return 'error';
    }
}

async function checkSimed() {
    if (!process.env.SIMED_USER || process.env.SIMED_USER === 'dein_benutzername') return 'not_configured';
    try {
        const baseURL = process.env.SIMED_URL || 'https://simed.uni-tuebingen.de';
        const client = axios.create({ baseURL, timeout: 10000 });
        const loginPage = await client.get('/Login');
        const $ = cheerio.load(loginPage.data);
        const csrfToken = $('input[name="_csrf_token"], input[name="csrfmiddlewaretoken"], input[name="_token"]').val() || '';
        const formAction = $('form').first().attr('action') || '/Login';
        const res = await client.post(formAction, new URLSearchParams({
            _username: process.env.SIMED_USER, _password: process.env.SIMED_PASS, _csrf_token: csrfToken, submit: 'Login'
        }).toString(), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, validateStatus: () => true });
        // 302 Redirect is typically a successful login
        if (res.status === 302 || (res.data && res.data.includes('logout'))) return 'connected';
        console.warn('⚠️  SIMED: Login fehlgeschlagen, Status:', res.status);
        return 'error';
    } catch (e) {
        console.error('❌ SIMED Verbindungsfehler:', e.message);
        return 'error';
    }
}

async function checkAllPortals() {
    const [ilias, alma, moodle, simed] = await Promise.all([
        checkIlias(),
        checkAlma(),
        checkMoodle(),
        checkSimed()
    ]);
    return {
        timestamp: new Date().toISOString(),
        portals: {
            ILIAS: { name: 'ILIAS', status: ilias },
            ALMA: { name: 'ALMA', status: alma },
            MOODLE: { name: 'Moodle', status: moodle },
            SIMED: { name: 'SIMED', status: simed }
        }
    };
}

module.exports = { checkAllPortals };
