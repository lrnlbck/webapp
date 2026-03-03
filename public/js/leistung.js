/**
 * Leistungsübersicht App – Frontend JavaScript
 * Hängt von app.js (api, toast) ab
 */

const lsState = {
    grades: [],
    activeTab: 'semesters',
    selectedSemester: null,
    subjectsForForm: [],
    editingGradeId: null
};

// 12 Fachsemester ab SS26
const LS_SEMESTERS = [
    { key: 'ss26', label: '1. FS – SS 26' },
    { key: 'ws2627', label: '2. FS – WS 26/27' },
    { key: 'ss27', label: '3. FS – SS 27' },
    { key: 'ws2728', label: '4. FS – WS 27/28' },
    { key: 'ss28', label: '5. FS – SS 28' },
    { key: 'ws2829', label: '6. FS – WS 28/29' },
    { key: 'ss29', label: '7. FS – SS 29' },
    { key: 'ws2930', label: '8. FS – WS 29/30' },
    { key: 'ss30', label: '9. FS – SS 30' },
    { key: 'ws3031', label: '10. FS – WS 30/31' },
    { key: 'ss31', label: '11. FS – SS 31' },
    { key: 'ws3132', label: '12. FS – WS 31/32' }
];

// ═══════════════════════════════════════════════════════════════
// NAVIGATION
// ═══════════════════════════════════════════════════════════════
function openLeistung() {
    document.getElementById('hub-screen').classList.remove('visible');
    document.getElementById('leistung-app').classList.add('visible');
    lsSwitchTab('semesters');
    lsLoadGrades();
}

function closeLeistung() {
    document.getElementById('leistung-app').classList.remove('visible');
    document.getElementById('hub-screen').classList.add('visible');
    if (window._showHub) window._showHub();
}

function lsSwitchTab(tab) {
    lsState.activeTab = tab;
    document.querySelectorAll('.ls-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
    document.querySelectorAll('.ls-tab-content').forEach(c => c.classList.toggle('visible', c.dataset.tab === tab));

    if (tab === 'semesters') lsRenderSemesters();
    if (tab === 'subjects') lsRenderSubjects();
}

// ═══════════════════════════════════════════════════════════════
// API LOKAL BACKUP
// ═══════════════════════════════════════════════════════════════
const LS_STORE_KEY = 'tuetool_leistung_grades';

function lsSaveBackup(grades) {
    try { localStorage.setItem(LS_STORE_KEY, JSON.stringify(grades)); } catch { }
}

function lsLoadBackup() {
    try { return JSON.parse(localStorage.getItem(LS_STORE_KEY) || '[]'); } catch { return []; }
}

async function lsLoadGrades() {
    try {
        let grades = await api('GET', '/api/leistung/grades');
        // Wenn Server 0 liefert, gucken ob wir lokales Backup haben (zB nach Server Neustart)
        if ((!grades || grades.length === 0)) {
            const local = lsLoadBackup();
            if (local.length > 0) {
                // Restore am Server versuchen
                await api('POST', '/api/leistung/grades/import', { grades: local });
                grades = local;
            }
        }

        lsState.grades = grades || [];
        lsSaveBackup(lsState.grades);

        lsUpdateOverallStats();
        if (lsState.activeTab === 'semesters') lsRenderSemesters();
        if (lsState.activeTab === 'subjects') lsRenderSubjects();
        if (lsState.selectedSemester) lsOpenSemester(lsState.selectedSemester); // Refresh open view

    } catch (err) {
        console.error('Leistungsübersicht Fehler:', err);
        lsState.grades = lsLoadBackup();
        lsUpdateOverallStats();
        lsRenderSemesters();
    }
}

// ═══════════════════════════════════════════════════════════════
// RENDERING
// ═══════════════════════════════════════════════════════════════
function lsCalcAvg(grades) {
    if (!grades || grades.length === 0) return null;
    const sum = grades.reduce((acc, g) => acc + g.value, 0);
    return (sum / grades.length).toFixed(1);
}

function lsUpdateOverallStats() {
    const avg = lsCalcAvg(lsState.grades);
    document.getElementById('ls-total-avg').textContent = avg !== null ? `Ø ${avg}` : '–';
    document.getElementById('ls-total-points').textContent = lsState.grades.length;
}

function lsRenderSemesters() {
    const container = document.getElementById('ls-semester-list');
    if (!container) return;

    // Grades pro Semester grupieren
    const bySem = {};
    lsState.grades.forEach(g => {
        if (!bySem[g.semester]) bySem[g.semester] = [];
        bySem[g.semester].push(g);
    });

    container.innerHTML = LS_SEMESTERS.map(sem => {
        const semesterGrades = bySem[sem.key] || [];
        const avg = lsCalcAvg(semesterGrades);
        return `
        <div class="ls-semester-card" onclick="lsOpenSemester('${sem.key}')">
            <div>
                <div class="ls-semester-name">${sem.label}</div>
                <div class="ls-semester-meta">${semesterGrades.length} Noten eingetragen</div>
            </div>
            <div class="ls-semester-avg">
                ${avg ? avg : '-'} 
            </div>
        </div>`;
    }).join('');
}

function lsRenderSubjects() {
    const container = document.getElementById('ls-subjects-list');
    if (!container) return;

    if (lsState.grades.length === 0) {
        container.innerHTML = `<div class="ls-empty">Noch keine Noten eingetragen.</div>`;
        return;
    }

    // Grades pro Fach grupieren
    const bySubj = {};
    lsState.grades.forEach(g => {
        if (!bySubj[g.subject]) bySubj[g.subject] = [];
        bySubj[g.subject].push(g);
    });

    // Fächer sortieren alphabetisch
    const sortedSubjects = Object.keys(bySubj).sort();

    container.innerHTML = sortedSubjects.map(sub => {
        const grades = bySubj[sub];
        const avg = lsCalcAvg(grades);
        return `
        <div class="ls-subject-card">
            <div>
                <div class="ls-subject-name">${escapeHtml(sub)}</div>
                <div class="ls-subject-details">${grades.length} Note(n) eingetragen</div>
            </div>
            <div class="ls-semester-avg" style="color:var(--text-primary);">Ø ${avg}</div>
        </div>`;
    }).join('');
}

// ═══════════════════════════════════════════════════════════════
// SEMESTER VIEW & MODAL
// ═══════════════════════════════════════════════════════════════
function lsOpenSemester(semKey) {
    lsState.selectedSemester = semKey;
    const semConfig = LS_SEMESTERS.find(s => s.key === semKey);
    document.getElementById('ls-active-semester-title').textContent = semConfig ? semConfig.label : semKey;

    document.getElementById('ls-semester-view').classList.add('open');
    lsRenderGradesInSemester();
}

function lsCloseSemester() {
    document.getElementById('ls-semester-view').classList.remove('open');
    lsState.selectedSemester = null;
}

function lsRenderGradesInSemester() {
    const container = document.getElementById('ls-semester-content');
    const grades = lsState.grades.filter(g => g.semester === lsState.selectedSemester);

    if (grades.length === 0) {
        container.innerHTML = `
        <div class="ls-empty">
            <div style="font-size:40px;margin-bottom:12px;">📈</div>
            <div style="font-weight:700;margin-bottom:4px;">Noch keine Noten</div>
            <div style="font-size:12px;">Trage deine erste Note für dieses Semester ein.</div>
        </div>`;
        return;
    }

    container.innerHTML = grades.map(g => `
    <div class="ls-grade-card">
        <button class="ls-edit-grade" onclick="lsOpenEditGradeModal('${g.id}')">✎</button>
        <button class="ls-delete-grade" onclick="lsDeleteGrade('${g.id}')">✕</button>
        <div class="ls-grade-info">
            <div class="ls-grade-subject">${escapeHtml(g.subject)}</div>
            <div class="ls-grade-title">${escapeHtml(g.title)}</div>
        </div>
        <div class="ls-grade-value">${g.value.toFixed(1)}</div>
    </div>
    `).join('');
}

// ═══════════════════════════════════════════════════════════════
// ACTIONS
// ═══════════════════════════════════════════════════════════════
async function lsOpenAddGradeModal() {
    lsState.editingGradeId = null;
    document.querySelector('#ls-modal .lp-modal-title').textContent = 'Neue Note eintragen';

    // Fächer aus der Lernübersicht laden für die Datalist (wie im Lernplan)
    try {
        const data = await api('GET', '/api/subjects');
        lsState.subjectsForForm = data.subjects || [];
    } catch {
        lsState.subjectsForForm = [];
    }

    const datalist = document.getElementById('ls-subjects-list');
    if (datalist) {
        datalist.innerHTML = lsState.subjectsForForm.map(s => `<option value="${escapeHtml(s.name)}">`).join('');
    }

    document.getElementById('ls-form-subject').value = '';
    document.getElementById('ls-form-title').value = '';
    document.getElementById('ls-form-value').value = '';

    document.getElementById('ls-modal').classList.add('open');
}

async function lsOpenEditGradeModal(id) {
    const grade = lsState.grades.find(g => g.id === id);
    if (!grade) return;

    lsState.editingGradeId = id;
    document.querySelector('#ls-modal .lp-modal-title').textContent = 'Note bearbeiten';

    // Fächer laden
    try {
        const data = await api('GET', '/api/subjects');
        lsState.subjectsForForm = data.subjects || [];
    } catch {
        lsState.subjectsForForm = [];
    }
    const datalist = document.getElementById('ls-subjects-list');
    if (datalist) {
        datalist.innerHTML = lsState.subjectsForForm.map(s => `<option value="${escapeHtml(s.name)}">`).join('');
    }

    document.getElementById('ls-form-subject').value = grade.subject;
    document.getElementById('ls-form-title').value = grade.title;
    document.getElementById('ls-form-value').value = grade.value;

    document.getElementById('ls-modal').classList.add('open');
}

function lsCloseModal() {
    document.getElementById('ls-modal').classList.remove('open');
}

async function lsSubmitGrade() {
    const subject = document.getElementById('ls-form-subject').value.trim();
    const title = document.getElementById('ls-form-title').value.trim();
    const value = document.getElementById('ls-form-value').value;

    if (!subject) { toast('Bitte ein Fach eintragen/auswählen', 'error'); return; }
    if (!title) { toast('Bitte einen Titel für die Note eintragen', 'error'); return; }
    if (!value || isNaN(parseFloat(value))) { toast('Bitte eine gültige Note eintragen', 'error'); return; }

    const btn = document.getElementById('ls-submit-btn');
    btn.disabled = true;

    try {
        if (lsState.editingGradeId) {
            await api('PATCH', `/api/leistung/grades/${lsState.editingGradeId}`, {
                subject,
                title,
                value: parseFloat(value)
            });
            toast('✅ Note bearbeitet!', 'success');
        } else {
            await api('POST', '/api/leistung/grades', {
                semester: lsState.selectedSemester,
                subject,
                title,
                value: parseFloat(value)
            });
            toast('✅ Note gespeichert!', 'success');
        }

        lsCloseModal();
        await lsLoadGrades();
    } catch (err) {
        toast('Fehler beim Speichern', 'error');
    } finally {
        btn.disabled = false;
    }
}

async function lsDeleteGrade(id) {
    if (!confirm('Note wirklich löschen?')) return;
    try {
        await api('DELETE', `/api/leistung/grades/${id}`);
        toast('Note gelöscht', 'info');
        // Sofort lokal löschen für flüssige UI
        lsState.grades = lsState.grades.filter(g => g.id !== id);
        lsSaveBackup(lsState.grades);

        lsUpdateOverallStats();
        lsRenderGradesInSemester();
        lsRenderSemesters(); // Update averages in background
    } catch {
        toast('Fehler beim Löschen', 'error');
    }
}

// ═══════════════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════════════
function initLeistung() {
    // Hub
    document.getElementById('open-leistung')?.addEventListener('click', openLeistung);
    document.getElementById('back-from-leistung')?.addEventListener('click', closeLeistung);

    // Tabs
    document.querySelectorAll('.ls-tab').forEach(t => {
        t.addEventListener('click', () => lsSwitchTab(t.dataset.tab));
    });

    // Semester View
    document.getElementById('ls-close-semester')?.addEventListener('click', lsCloseSemester);
    document.getElementById('ls-floating-back')?.addEventListener('click', lsCloseSemester);
    document.getElementById('ls-add-grade')?.addEventListener('click', lsOpenAddGradeModal);

    // Modal
    document.getElementById('ls-modal-cancel')?.addEventListener('click', lsCloseModal);
    document.getElementById('ls-submit-btn')?.addEventListener('click', lsSubmitGrade);

    // Backdrop klick
    const overlay = document.getElementById('ls-modal');
    overlay?.addEventListener('click', e => { if (e.target === overlay) lsCloseModal(); });
}

document.addEventListener('DOMContentLoaded', initLeistung);
