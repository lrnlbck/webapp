/**
 * Lernplan App – Frontend JavaScript
 * Hängt von app.js (api, toast, state) ab
 */

// ═══════════════════════════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════════════════════════
const lpState = {
    weekOffset: 0,
    exams: [],
    subjectsForForm: [],
    activeTab: 'calendar' // 'calendar' | 'exams'
};

// ═══════════════════════════════════════════════════════════════
// NAVIGATION (Hub ↔ Lernplan)
// ═══════════════════════════════════════════════════════════════
function openLernplan() {
    document.getElementById('hub-screen').classList.remove('visible');
    document.getElementById('lernplan-app').classList.add('visible');
    lpSwitchTab('calendar');
    lpLoadCalendar();
    lpLoadExams();
}

function closeLernplan() {
    document.getElementById('lernplan-app').classList.remove('visible');
    document.getElementById('hub-screen').classList.add('visible');
    if (window._showHub) window._showHub();
}

// ═══════════════════════════════════════════════════════════════
// TABS
// ═══════════════════════════════════════════════════════════════
function lpSwitchTab(tab) {
    lpState.activeTab = tab;
    document.querySelectorAll('.lp-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
    document.querySelectorAll('.lp-tab-content').forEach(c => c.classList.toggle('visible', c.dataset.tab === tab));

    if (tab === 'exams') lpRenderExams();
    if (tab === 'calendar') lpLoadCalendar();
}

// ═══════════════════════════════════════════════════════════════
// CALENDAR VIEW
// ═══════════════════════════════════════════════════════════════
async function lpLoadCalendar(offset) {
    if (offset !== undefined) lpState.weekOffset = offset;

    try {
        const data = await api('GET', `/api/lernplan/calendar?week=${lpState.weekOffset}`);
        lpRenderCalendar(data.events || []);
    } catch (err) {
        console.error('Lernplan Kalender Fehler:', err);
    }
}

function lpWeekBounds(weekOffset) {
    const now = new Date();
    const dayOfWeek = now.getDay() === 0 ? 6 : now.getDay() - 1;
    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() - dayOfWeek + weekOffset * 7);
    weekStart.setHours(0, 0, 0, 0);
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 6);
    return { weekStart, weekEnd };
}

function lpRenderCalendar(events) {
    const container = document.getElementById('lp-calendar-events');
    if (!container) return;

    // Week header using real calendar weeks
    const { weekStart, weekEnd } = lpWeekBounds(lpState.weekOffset);
    const fmt = d => d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' });
    const kw = Math.ceil((weekStart - new Date(weekStart.getFullYear(), 0, 1)) / 604800000) + 1;
    document.getElementById('lp-week-title').textContent = `KW ${kw} ${weekStart.getFullYear()}`;
    document.getElementById('lp-week-dates').textContent = `${fmt(weekStart)} – ${fmt(weekEnd)}`;

    if (events.length === 0) {
        container.innerHTML = `
          <div class="lp-empty">
            <div class="lp-empty-icon">📅</div>
            <div class="lp-empty-title">Keine Termine diese Woche</div>
            <div class="lp-empty-desc">Lege eine Prüfung an, um automatische Lernblöcke zu erhalten.</div>
          </div>`;
        return;
    }

    // Group by day
    const DAYS = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
    const byDay = {};
    events.forEach(e => {
        const d = new Date(e.date);
        const key = d.toDateString();
        if (!byDay[key]) byDay[key] = { date: d, events: [] };
        byDay[key].events.push(e);
    });

    container.innerHTML = Object.values(byDay).map(({ date, events: dayEvents }) => {
        const isToday = date.toDateString() === new Date().toDateString();
        return `
          <div class="lp-day-block">
            <div class="lp-day-header ${isToday ? 'lp-day-today' : ''}">
              <span class="lp-day-label">${DAYS[date.getDay()]} ${date.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })}</span>
              ${isToday ? '<span style="font-size:9px;background:var(--accent-blue);color:white;padding:2px 7px;border-radius:99px;font-weight:700;text-transform:uppercase;">Heute</span>' : ''}
            </div>
            ${dayEvents.map(e => `
              <div class="lp-event ${e.type === 'exam' ? 'exam-event' : ''}">
                <div class="lp-event-time">
                  <div class="lp-event-time-from">${e.timeFrom || ''}</div>
                  <div class="lp-event-time-to">${e.timeTo || ''}</div>
                </div>
                <div class="lp-event-body">
                  <div class="lp-event-title">${e.title}</div>
                  ${e.topics && e.topics.length > 0 ? `<div class="lp-event-topics">${e.topics.slice(0, 5).join(' · ')}${e.topics.length > 5 ? ` · +${e.topics.length - 5}` : ''}</div>` : ''}
                </div>
              </div>`).join('')}
          </div>`;
    }).join('');
}

// ═══════════════════════════════════════════════════════════════
// EXAMS LIST
// ═══════════════════════════════════════════════════════════════
// ─── localStorage Backup ────────────────────────────────────────
const LP_STORE_KEY = 'tuetool_lernplan_exams';
const LP_SYNC_TIME_KEY = 'tuetool_lernplan_sync_time';

function lpSaveToLocalStorage(exams) {
    try {
        localStorage.setItem(LP_STORE_KEY, JSON.stringify(exams));
        localStorage.setItem(LP_SYNC_TIME_KEY, Date.now().toString());
    } catch { }
}

function lpGetFromLocalStorage() {
    try { return JSON.parse(localStorage.getItem(LP_STORE_KEY) || '[]'); } catch { return []; }
}

function lpGetLastSyncTime() {
    try { return parseInt(localStorage.getItem(LP_SYNC_TIME_KEY) || '0', 10); } catch { return 0; }
}

async function lpRestoreToServer(localExams) {
    if (!localExams || localExams.length === 0) return;
    try {
        const res = await api('POST', '/api/lernplan/exams/import', { exams: localExams });
        if (res.restored > 0) {
            console.log(`[Lernplan] ${res.restored} Prüfungen aus localStorage auf Server wiederhergestellt`);
            toast(`📥 ${res.restored} Prüfungen wiederhergestellt`, 'success', 4000);
        }
    } catch { }
}

// ═══════════════════════════════════════════════════════════════
// EXAMS LIST
// ═══════════════════════════════════════════════════════════════
async function lpLoadExams() {
    try {
        let exams = await api('GET', '/api/lernplan/exams');
        const local = lpGetFromLocalStorage();
        const lastSync = lpGetLastSyncTime();

        // Wenn der Server 0 liefert, das lokale Backup aber voll ist:
        // Unterscheiden zwischen "Railway hat neugestartet" und "Nutzer hat gerade alles gelöscht".
        // Wenn der letzte bewusste Sync sehr alt ist (Railway Neustart), dann stelle her.
        // Wenn der Sync sehr neu ist (Nutzer hat gerade auf Löschen gedrückt), dann vertraue dem leeren Array.
        if ((!exams || exams.length === 0) && local.length > 0) {
            // Wenn die letzte erfolgreiche lokale Sicherung mindestens 1 Sekunde alt ist.
            // (Bei manuellem Löschen wird der SyncTimestamp auf JETZT gesetzt)
            if (Date.now() - lastSync > 1000) {
                // Server might have lost data (Railway redeploy) – try localStorage
                await lpRestoreToServer(local);
                exams = await api('GET', '/api/lernplan/exams');
                if (!exams || exams.length === 0) exams = local;
            }
        }

        lpState.exams = exams || [];
        lpSaveToLocalStorage(lpState.exams); // always keep in sync
        lpRenderExams();
    } catch (err) {
        console.error('Exams Fehler:', err);
        // Fallback: show localStorage data
        lpState.exams = lpGetFromLocalStorage();
        lpRenderExams();
    }
}

function lpRenderExams() {
    const container = document.getElementById('lp-exams-list');
    if (!container) return;

    const exams = lpState.exams;

    if (exams.length === 0) {
        container.innerHTML = `
          <div class="lp-empty">
            <div class="lp-empty-icon">🎯</div>
            <div class="lp-empty-title">Keine Prüfungen angelegt</div>
            <div class="lp-empty-desc">Tippe auf "+ Prüfung anlegen" um zu starten.</div>
          </div>`;
        return;
    }

    container.innerHTML = exams.map(exam => {
        const examDate = new Date(exam.examDate);
        const daysLeft = Math.ceil((examDate - new Date()) / (1000 * 60 * 60 * 24));
        const isDone = exam.status === 'done' || exam.status === 'cancelled';

        return `
          <div class="lp-exam-card ${isDone ? 'done' : ''}">
            <div class="lp-exam-card-header">
              <div>
                <div class="lp-exam-card-subject">🎯 ${exam.subject}</div>
                <div class="lp-exam-card-date">📅 ${examDate.toLocaleDateString('de-DE', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' })}</div>
              </div>
            </div>
            <div class="lp-exam-card-meta">
              <span class="lp-exam-chip hours">⏱ ~${exam.hoursNeeded || 0}h Lernaufwand</span>
              ${!isDone && daysLeft > 0 ? `<span class="lp-exam-chip days-left">⏳ ${daysLeft} Tage</span>` : ''}
              ${isDone ? `<span class="lp-exam-chip done-chip">✓ Abgeschlossen</span>` : ''}
              <span class="lp-exam-chip">📖 ${(exam.selectedTopics || []).length} Themen</span>
            </div>
            ${!isDone ? `
            <div class="lp-exam-cal-toggle">
              <label class="switch" style="transform:scale(0.8);transform-origin:left;">
                <input type="checkbox" ${exam.showInCalendar ? 'checked' : ''} onchange="lpToggleCalendar('${exam.id}', this.checked)">
                <span class="slider"></span>
              </label>
              <span>Im Kalender anzeigen</span>
            </div>` : ''}
            <div class="lp-exam-actions">
              ${!isDone ? `<button class="lp-exam-action-btn success" onclick="lpMarkDone('${exam.id}')">✓ Als geschrieben markieren</button>` : ''}
              <button class="lp-exam-action-btn danger" onclick="lpDeleteExam('${exam.id}')">🗑 Löschen</button>
            </div>
          </div>`;
    }).join('');
}

// ═══════════════════════════════════════════════════════════════
// EXAM ACTIONS
// ═══════════════════════════════════════════════════════════════
async function lpMarkDone(id) {
    try {
        await api('PATCH', `/api/lernplan/exams/${id}`, { status: 'done' });
        toast('✅ Prüfung als geschrieben markiert!', 'success');
        await lpLoadExams();
        lpSaveToLocalStorage(lpState.exams);
        lpLoadCalendar();
    } catch { toast('Fehler beim Aktualisieren', 'error'); }
}

async function lpToggleCalendar(id, show) {
    try {
        await api('PATCH', `/api/lernplan/exams/${id}`, { showInCalendar: show });
        await lpLoadExams();
        lpSaveToLocalStorage(lpState.exams);
        await lpLoadCalendar();
    } catch { toast('Fehler', 'error'); }
}

async function lpDeleteExam(id) {
    if (!confirm('Prüfung wirklich löschen?')) return;
    try {
        await api('DELETE', `/api/lernplan/exams/${id}`);
        toast('Prüfung gelöscht', 'info');
        // Sofort aus lokalem State entfernen und wegschreiben, damit lpLoadExams es nicht wiederherstellt
        lpState.exams = lpState.exams.filter(e => e.id !== id);
        lpSaveToLocalStorage(lpState.exams);

        await lpLoadExams();
        lpLoadCalendar();
    } catch { toast('Fehler beim Löschen', 'error'); }
}

// ═══════════════════════════════════════════════════════════════
// NEW EXAM FORM
// ═══════════════════════════════════════════════════════════════
async function lpOpenNewExamForm() {
    // Fächer aus Lernübersicht laden
    try {
        const data = await api('GET', '/api/subjects');
        lpState.subjectsForForm = data.subjects || [];
    } catch {
        lpState.subjectsForForm = [];
    }

    // Fach-Dropdown füllen
    const input = document.getElementById('lp-form-subject');
    input.value = '';
    const datalist = document.getElementById('lp-subjects-list');
    if (datalist) {
        datalist.innerHTML = lpState.subjectsForForm.map(s => `<option value="${s.name}">`).join('');
    }

    // Topics + custom topics leeren
    document.getElementById('lp-topics-container').innerHTML = '<div style="padding:10px 14px;color:var(--text-muted);font-size:13px;">Zuerst ein Fach wählen</div>';
    document.getElementById('lp-custom-topics').innerHTML = '';
    document.getElementById('lp-custom-topic-input').value = '';
    document.getElementById('lp-form-notes').value = '';
    document.getElementById('lp-form-date').value = '';

    document.getElementById('lp-modal').classList.add('open');
}

function lpCloseModal() {
    document.getElementById('lp-modal').classList.remove('open');
}

function lpOnSubjectChange() {
    const subjectName = document.getElementById('lp-form-subject').value;
    const subject = lpState.subjectsForForm.find(s => s.name === subjectName);
    const container = document.getElementById('lp-topics-container');

    if (!subject || !subject.lectures || subject.lectures.length === 0) {
        container.innerHTML = '<div style="padding:10px 14px;color:var(--text-muted);font-size:13px;">Keine Themen gefunden</div>';
        return;
    }

    // Themen aus Vorlesungen sammeln
    const allTopics = [];
    subject.lectures.forEach(l => {
        (l.topics || [l.title]).forEach(t => {
            if (!allTopics.includes(t)) allTopics.push(t);
        });
    });

    container.innerHTML = allTopics.map((topic, i) => `
      <label class="lp-topic-item">
        <input type="checkbox" name="topic" value="${topic}" checked>
        <span class="lp-topic-label">${topic}</span>
      </label>`).join('');
}

function lpSelectAllTopics(selectAll) {
    document.querySelectorAll('#lp-topics-container input[type="checkbox"]')
        .forEach(cb => cb.checked = selectAll);
}

// ─── Custom Topic Chips ──────────────────────────────────────────
function lpAddCustomTopic() {
    const input = document.getElementById('lp-custom-topic-input');
    const value = input.value.trim();
    if (!value) return;

    const container = document.getElementById('lp-custom-topics');

    // Prevent duplicates
    const existing = [...container.querySelectorAll('[data-topic]')].map(el => el.dataset.topic);
    if (existing.includes(value)) {
        input.value = '';
        return;
    }

    const chip = document.createElement('div');
    chip.dataset.topic = value;
    chip.style.cssText = 'display:inline-flex;align-items:center;gap:6px;background:rgba(91,141,239,0.12);border:1px solid rgba(91,141,239,0.3);border-radius:99px;padding:4px 10px;font-size:12px;color:var(--accent-blue);';
    chip.innerHTML = `<span>${value}</span><span onclick="lpRemoveCustomTopic(this)" style="cursor:pointer;font-size:16px;line-height:1;color:var(--text-muted);">×</span>`;
    container.appendChild(chip);
    input.value = '';
    input.focus();
}

function lpRemoveCustomTopic(el) {
    el.parentElement.remove();
}

async function lpSubmitExam() {
    const subject = document.getElementById('lp-form-subject').value;
    const examDate = document.getElementById('lp-form-date').value;

    if (!subject) { toast('Bitte ein Fach wählen', 'error'); return; }
    if (!examDate) { toast('Bitte ein Prüfungsdatum wählen', 'error'); return; }

    // Themen aus Checkboxen + eigene Themen sammeln und deduplizieren
    const checkedTopics = [...document.querySelectorAll('#lp-topics-container input:checked')].map(cb => cb.value);
    const customTopics = [...document.querySelectorAll('#lp-custom-topics [data-topic]')].map(el => el.dataset.topic);
    const selectedTopics = [...new Set([...checkedTopics, ...customTopics])];

    if (selectedTopics.length === 0) { toast('Bitte mindestens ein Thema wählen oder eigene Themen eingeben', 'error'); return; }

    const notes = document.getElementById('lp-form-notes').value;

    try {
        const btn = document.getElementById('lp-submit-btn');
        btn.disabled = true;
        btn.textContent = 'Wird erstellt…';

        const exam = await api('POST', '/api/lernplan/exams', { subject, examDate, selectedTopics, notes });
        toast(`🎯 Prüfung "${subject}" angelegt – ${exam.learnBlocks?.length || 0} Lernblöcke geplant!`, 'success', 5000);
        lpCloseModal();
        await lpLoadExams();
        lpSaveToLocalStorage(lpState.exams);
        lpLoadCalendar();
        lpSwitchTab('calendar');

        btn.disabled = false;
        btn.textContent = 'Prüfung anlegen';
    } catch (err) {
        toast('Fehler: ' + err.message, 'error');
        document.getElementById('lp-submit-btn').disabled = false;
    }
}

// ═══════════════════════════════════════════════════════════════
// PDF DOWNLOAD
// ═══════════════════════════════════════════════════════════════
async function lpDownloadPDF() {
    try {
        toast('PDF wird erstellt…', 'info', 3000);
        const res = await fetch('/api/lernplan/pdf', { credentials: 'include' });
        if (!res.ok) throw new Error('PDF-Fehler');
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `Pruefungsuebersicht_${new Date().toLocaleDateString('de-DE').replace(/\./g, '-')}.pdf`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
        toast('✅ PDF heruntergeladen!', 'success');
    } catch (err) {
        toast('PDF Fehler: ' + err.message, 'error');
    }
}

// ═══════════════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════════════
function initLernplan() {
    // Hub Card
    document.getElementById('open-lernplan')?.addEventListener('click', openLernplan);

    // Back button
    document.getElementById('back-from-lernplan')?.addEventListener('click', closeLernplan);

    // Tabs
    document.querySelectorAll('.lp-tab').forEach(t => {
        t.addEventListener('click', () => lpSwitchTab(t.dataset.tab));
    });

    // Week navigation
    document.getElementById('lp-prev-week')?.addEventListener('click', () => lpLoadCalendar(lpState.weekOffset - 1));
    document.getElementById('lp-next-week')?.addEventListener('click', () => lpLoadCalendar(lpState.weekOffset + 1));

    // New Exam
    document.getElementById('lp-new-exam-btn')?.addEventListener('click', lpOpenNewExamForm);
    document.getElementById('lp-modal-cancel')?.addEventListener('click', lpCloseModal);
    document.getElementById('lp-submit-btn')?.addEventListener('click', lpSubmitExam);
    document.getElementById('lp-form-subject')?.addEventListener('input', lpOnSubjectChange);
    document.getElementById('lp-select-all')?.addEventListener('click', () => lpSelectAllTopics(true));
    document.getElementById('lp-deselect-all')?.addEventListener('click', () => lpSelectAllTopics(false));
    document.getElementById('lp-pdf-btn')?.addEventListener('click', lpDownloadPDF);

    // Close modal by clicking backdrop
    const overlay = document.getElementById('lp-modal');
    overlay?.addEventListener('click', e => { if (e.target === overlay) lpCloseModal(); });
}

document.addEventListener('DOMContentLoaded', initLernplan);
