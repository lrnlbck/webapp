/**
 * Cache-Verwaltung: Speichert analysierte Daten lokal als JSON
 */
const fs = require('fs');
const path = require('path');

const CACHE_DIR = path.join(__dirname, '../cache');
const CACHE_FILE = path.join(CACHE_DIR, 'subjects.json');
const META_FILE = path.join(CACHE_DIR, 'meta.json');

function ensureDir() {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
}

function loadCache() {
    ensureDir();
    if (!fs.existsSync(CACHE_FILE)) return null;
    try {
        const data = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
        return data;
    } catch { return null; }
}

function saveCache(data) {
    ensureDir();
    fs.writeFileSync(CACHE_FILE, JSON.stringify(data, null, 2));
    fs.writeFileSync(META_FILE, JSON.stringify({
        lastUpdated: new Date().toISOString(),
        count: data.length
    }));
}

function getCacheMeta() {
    ensureDir();
    if (!fs.existsSync(META_FILE)) return { lastUpdated: null, count: 0 };
    try { return JSON.parse(fs.readFileSync(META_FILE, 'utf8')); }
    catch { return { lastUpdated: null, count: 0 }; }
}

function clearCache() {
    if (fs.existsSync(CACHE_FILE)) fs.unlinkSync(CACHE_FILE);
    if (fs.existsSync(META_FILE)) fs.unlinkSync(META_FILE);
}

module.exports = { loadCache, saveCache, getCacheMeta, clearCache };
