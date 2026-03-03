const fs = require('fs');
const path = require('path');

const LEISTUNG_PATH = path.join(__dirname, '../cache/leistung.json');

// ─── UUID ohne externe Abhängigkeit ──────────────────────────────
function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
}

// ─── Persistenz ──────────────────────────────────────────────────
function loadGrades() {
    try {
        if (fs.existsSync(LEISTUNG_PATH)) {
            return JSON.parse(fs.readFileSync(LEISTUNG_PATH, 'utf8'));
        }
    } catch { }
    return [];
}

function saveGrades(grades) {
    fs.mkdirSync(path.dirname(LEISTUNG_PATH), { recursive: true });
    fs.writeFileSync(LEISTUNG_PATH, JSON.stringify(grades, null, 2));
}

// ─── Öffentliche API ─────────────────────────────────────────────
function createGrade(gradeData) {
    const grades = loadGrades();
    const grade = {
        id: generateId(),
        semester: gradeData.semester,
        subject: gradeData.subject,
        title: gradeData.title,
        value: parseFloat(gradeData.value) || 0,
        createdAt: new Date().toISOString()
    };
    grades.push(grade);
    saveGrades(grades);
    return grade;
}

function deleteGrade(id) {
    let grades = loadGrades();
    grades = grades.filter(g => g.id !== id);
    saveGrades(grades);
}

function updateGrade(id, gradeData) {
    let grades = loadGrades();
    const idx = grades.findIndex(g => g.id === id);
    if (idx === -1) return null;
    if (gradeData.subject !== undefined) grades[idx].subject = gradeData.subject;
    if (gradeData.title !== undefined) grades[idx].title = gradeData.title;
    if (gradeData.value !== undefined) grades[idx].value = parseFloat(gradeData.value) || 0;
    saveGrades(grades);
    return grades[idx];
}

function importGrades(incomingGrades) {
    if (!Array.isArray(incomingGrades) || incomingGrades.length === 0) return 0;
    const existing = loadGrades();
    if (existing.length > 0) return 0; // Don't overwrite if server already has data
    saveGrades(incomingGrades);
    return incomingGrades.length;
}

module.exports = {
    loadGrades,
    createGrade,
    updateGrade,
    deleteGrade,
    importGrades
};
