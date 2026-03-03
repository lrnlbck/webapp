/**
 * TüTool App
 * Main Frontend JavaScript – iPhone optimiert
 */

// ═══════════════════════════════════════════════════════════════
// SEMESTER CONFIG
// ═══════════════════════════════════════════════════════════════
const SEMESTERS = {
    ss26: { label: 'SS 26', start: new Date('2026-04-20'), icon: '☀️', full: 'SoSe 2026' },
    ws2627: { label: 'WS 26/27', start: new Date('2026-10-15'), icon: '❄️', full: 'WiSe 26/27' },
    ss27: { label: 'SS 27', start: new Date('2027-04-19'), icon: '☀️', full: 'SoSe 2027' },
    ws2728: { label: 'WS 27/28', start: new Date('2027-10-14'), icon: '❄️', full: 'WiSe 27/28' },
};

// ═══════════════════════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════════════════════
const state = {
    authenticated: false,
    pinInput: '',
    subjects: [],
    lastUpdated: null,
    currentView: 'subjects',
    refreshing: false,
    pinSet: false,
    semesterKey: localStorage.getItem('semesterKey') || 'ss26',
};

function currentSemester() {
    return SEMESTERS[state.semesterKey] || SEMESTERS.ss26;
}


// Subject display config
const SUBJECT_CONFIG = {
    'Anatomie': { icon: '🦴', color: '#ef4444' },
    'Physiologie': { icon: '💗', color: '#3b82f6' },
    'Biochemie': { icon: '⚗️', color: '#22c55e' },
    'Histologie': { icon: '🔬', color: '#f97316' },
    'Biologie': { icon: '🧬', color: '#06b6d4' },
    'Physik': { icon: '⚡', color: '#a855f7' },
    'Chemie': { icon: '🧪', color: '#6366f1' },
    'SIMED': { icon: '🏥', color: '#ec4899' },
    'MOODLE': { icon: '🌐', color: '#1a73e8' },
    'ILIAS': { icon: '📖', color: '#34a853' },
    'ALMA': { icon: '🏛️', color: '#fb8c00' },
    'Allgemein': { icon: '📝', color: '#64748b' },
    'Demo': { icon: '🎯', color: '#8b5cf6' },
};

function getSubjectConfig(name) {
    for (const [key, cfg] of Object.entries(SUBJECT_CONFIG)) {
        if (name.toLowerCase().includes(key.toLowerCase())) return cfg;
    }
    return { icon: '📚', color: '#64748b' };
}

// ═══════════════════════════════════════════════════════════
// API HELPERS
// ═══════════════════════════════════════════════════════════
async function api(method, path, body) {
    const isDemoMode = localStorage.getItem('demoMode') === 'true';
    let url = path;
    if (isDemoMode) {
        url += (url.includes('?') ? '&' : '?') + 'demo=true';
    }

    const opts = {
        method,
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include'
    };
    if (body) opts.body = JSON.stringify(body);
    const res = await fetch(url, opts);
    return res.json();
}

// ═══════════════════════════════════════════════════════════
// TOAST NOTIFICATIONS
// ═══════════════════════════════════════════════════════════
function toast(message, type = 'info', duration = 3500) {
    const icons = { success: '✅', error: '❌', info: 'ℹ️' };
    const container = document.getElementById('toast-container');
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.innerHTML = `<span class="toast-icon">${icons[type]}</span><span>${message}</span>`;
    container.appendChild(el);
    requestAnimationFrame(() => { requestAnimationFrame(() => el.classList.add('show')); });
    setTimeout(() => {
        el.classList.remove('show');
        setTimeout(() => el.remove(), 400);
    }, duration);
}

// ═══════════════════════════════════════════════════════════
// PIN / LOCK SCREEN
// ═══════════════════════════════════════════════════════════
function updatePinDots() {
    const len = state.pinInput.length;
    for (let i = 0; i < 4; i++) {
        const dot = document.getElementById(`dot-${i}`);
        dot.classList.toggle('active', i < len);
        dot.classList.remove('error');
    }
}

function pinError(msg) {
    const errorEl = document.getElementById('pin-error');
    errorEl.textContent = msg;
    for (let i = 0; i < 4; i++) {
        document.getElementById(`dot-${i}`).classList.add('error');
    }
    setTimeout(() => {
        state.pinInput = '';
        updatePinDots();
        errorEl.textContent = '';
    }, 800);
}

async function checkAppVersion(serverVersion) {
    if (!serverVersion) return false;
    const localVersion = localStorage.getItem('tuetool_cache_version');

    // Wenn eine alte Version vorlag und nun eine neue kommt, lösche Cache
    if (localVersion && localVersion !== serverVersion) {
        console.log(`App Update erkannt: ${localVersion} -> ${serverVersion}`);
        toast('Neues Update gefunden! Lade App neu...', 'info');

        if ('caches' in window) {
            try {
                const keys = await caches.keys();
                await Promise.all(keys.map(k => caches.delete(k)));
            } catch (e) { console.error('Cache clear error', e); }
        }
        if ('serviceWorker' in navigator) {
            try {
                const regs = await navigator.serviceWorker.getRegistrations();
                await Promise.all(regs.map(r => r.unregister()));
            } catch (e) { console.error('SW unregister error', e); }
        }

        localStorage.setItem('tuetool_cache_version', serverVersion);
        setTimeout(() => window.location.reload(true), 1500);
        return true;
    } else if (!localVersion) {
        localStorage.setItem('tuetool_cache_version', serverVersion);
    }
    return false;
}

async function submitPin() {
    const pin = state.pinInput;
    if (pin.length < 4) return;

    try {
        const data = await api('POST', '/api/auth/login', { pin });
        if (data.success) {
            state.authenticated = true;
            if (data.firstSetup) {
                toast(`🔐 PIN "${pin}" wurde gespeichert!`, 'success', 4000);
            }
            const isReloading = await checkAppVersion(data.version);
            if (!isReloading) {
                unlockApp();
            }
        } else {
            pinError('Falscher PIN');
        }
    } catch {
        pinError('Server nicht erreichbar');
    }
    state.pinInput = '';
    updatePinDots();
}

function handlePinDigit(digit) {
    if (state.pinInput.length >= 8) return;
    state.pinInput += digit;
    updatePinDots();
    if (state.pinInput.length === 4) {
        setTimeout(submitPin, 100);
    }
}

function handlePinDelete() {
    if (state.pinInput.length > 0) {
        state.pinInput = state.pinInput.slice(0, -1);
        updatePinDots();
    }
}

function unlockApp() {
    const lockScreen = document.getElementById('lock-screen');
    lockScreen.classList.add('hidden');
    setTimeout(() => lockScreen.style.display = 'none', 450);
    // timetable.js overrides this to show the hub – if not loaded yet, fall back
    if (window._showHub) {
        window._showHub();
    } else {
        loadSubjects();
    }
}

function lockApp() {
    const lockScreen = document.getElementById('lock-screen');
    const mainApp = document.getElementById('main-app');
    lockScreen.style.display = '';
    mainApp.classList.remove('visible');
    state.authenticated = false;
    state.pinInput = '';
    updatePinDots();
    requestAnimationFrame(() => {
        requestAnimationFrame(() => lockScreen.classList.remove('hidden'));
    });
}

// Setup PIN pad events
function initPinPad() {
    document.querySelectorAll('.pin-btn[data-digit]').forEach(btn => {
        btn.addEventListener('click', () => handlePinDigit(btn.dataset.digit));
    });
    document.getElementById('pin-delete').addEventListener('click', handlePinDelete);

    // Keyboard support
    document.addEventListener('keydown', e => {
        if (!document.getElementById('lock-screen').classList.contains('hidden')) {
            if (e.key >= '0' && e.key <= '9') handlePinDigit(e.key);
            else if (e.key === 'Backspace') handlePinDelete();
        }
    });
}

// ═══════════════════════════════════════════════════════════
// NAVIGATION
// ═══════════════════════════════════════════════════════════
function showView(viewName) {
    state.currentView = viewName;
    const views = ['subjects', 'week', 'settings'];
    views.forEach(v => {
        const el = document.getElementById(`${v}-view`);
        el.classList.toggle('visible', v === viewName);
    });

    document.querySelectorAll('.nav-item').forEach(item => {
        item.classList.toggle('active', item.dataset.view === viewName);
    });

    if (viewName === 'week') renderWeekView();
    if (viewName === 'settings') renderSettings();
}

// ═══════════════════════════════════════════════════════════
// SUBJECTS VIEW
// ═══════════════════════════════════════════════════════════
async function loadSubjects() {
    try {
        const data = await api('GET', '/api/subjects');
        state.subjects = data.subjects || [];
        state.lastUpdated = data.lastUpdated;
        renderSubjects();
        updateStats();
        updateLastUpdated();
    } catch (err) {
        console.error('Fehler beim Laden:', err);
        // Show demo message
        document.getElementById('subjects-grid').innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">⚠️</div>
        <div class="empty-title">Server nicht erreichbar</div>
        <div class="empty-text">Stelle sicher, dass der Server läuft (<code>npm start</code>)</div>
      </div>`;
    }
}

function updateStats() {
    const totalLectures = state.subjects.reduce((s, sub) => s + (sub.lectures || []).length, 0);
    const totalTopics = state.subjects.reduce((s, sub) => s + (sub.totalTopics || 0), 0);
    document.getElementById('stat-subjects').textContent = state.subjects.length;
    document.getElementById('stat-lectures').textContent = totalLectures;
    document.getElementById('stat-topics').textContent = totalTopics;
    document.getElementById('subjects-count').textContent = state.subjects.length;
}

function updateLastUpdated() {
    const el = document.getElementById('last-updated-text');
    if (state.lastUpdated) {
        const d = new Date(state.lastUpdated);
        el.textContent = `Aktualisiert: ${d.toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}`;
    } else {
        el.textContent = 'Noch nicht aktualisiert';
    }
}

function renderSubjects() {
    const grid = document.getElementById('subjects-grid');
    if (!state.subjects.length) {
        grid.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">🎓</div>
        <div class="empty-title">Noch keine Daten</div>
        <div class="empty-text">Drücke „Aktualisieren", um Daten von den Uni-Plattformen zu laden.<br><br>Oder konfiguriere zunächst deine Zugangsdaten in der <code>.env</code>-Datei.</div>
      </div>`;
        return;
    }

    grid.innerHTML = state.subjects.map((subject, idx) => {
        const cfg = getSubjectConfig(subject.name);
        const lectures = subject.lectures || [];

        // Group lectures by week
        const byWeek = {};
        lectures.forEach(lec => {
            const w = lec.week || 1;
            if (!byWeek[w]) byWeek[w] = [];
            byWeek[w].push(lec);
        });

        const weekKeys = Object.keys(byWeek).map(Number).sort((a, b) => a - b);

        const weeksHtml = weekKeys.map(w => {
            const items = byWeek[w];
            const lecturesHtml = items.map(lec => {
                const topicsHtml = (lec.topics || []).slice(0, 8).map(t =>
                    `<span class="topic-chip">${escapeHtml(t)}</span>`
                ).join('');

                return `
          <div class="lecture-item">
            <div class="lecture-title">${escapeHtml(lec.title)}</div>
            ${topicsHtml ? `<div class="topics-list">${topicsHtml}</div>` : ''}
            <div class="lecture-platform">
              <span>📌</span> ${escapeHtml(lec.platform || 'Unbekannt')}
            </div>
          </div>`;
            }).join('');

            // Calculate week date (SoSe 2026 starts April 20)
            const semesterStart = currentSemester().start;
            const weekStart = new Date(semesterStart);
            weekStart.setDate(semesterStart.getDate() + (w - 1) * 7);
            const weekEnd = new Date(weekStart);
            weekEnd.setDate(weekStart.getDate() + 6);
            const fmtDate = d => d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' });

            return `
        <div class="week-group">
          <div class="week-label">
            <span class="week-pill">KW ${w}</span>
            ${fmtDate(weekStart)} – ${fmtDate(weekEnd)}
          </div>
          ${lecturesHtml}
        </div>`;
        }).join('');

        const platformBadge = subject.platform || subject.lectures?.[0]?.platform || 'Lokal';

        return `
      <div class="subject-card" data-subject="${idx}" style="animation-delay:${idx * 0.05}s">
        <div class="subject-card-header" onclick="toggleSubject(${idx})">
          <div class="subject-color-bar" style="background:${cfg.color}"></div>
          <div class="subject-icon" style="background:${cfg.color}22">${cfg.icon}</div>
          <div class="subject-info">
            <div class="subject-name">${escapeHtml(subject.name)}</div>
            <div class="subject-meta">${lectures.length} Vorlesungen · ${subject.totalTopics || 0} Themen</div>
          </div>
          <span class="subject-chevron">›</span>
        </div>
        <div class="subject-body">
          <div class="subject-body-inner">
            ${weeksHtml || '<div class="subject-meta" style="text-align:center;padding:12px;">Noch keine Inhalt verfügbar</div>'}
          </div>
        </div>
      </div>`;
    }).join('');
}

function toggleSubject(idx) {
    const card = document.querySelector(`.subject-card[data-subject="${idx}"]`);
    card.classList.toggle('open');
}

// ═══════════════════════════════════════════════════════════
// WEEK VIEW
// ═══════════════════════════════════════════════════════════
function renderWeekView() {
    const timeline = document.getElementById('week-timeline');

    // Collect all lectures and group by week
    const byWeek = {};
    state.subjects.forEach(subject => {
        (subject.lectures || []).forEach(lec => {
            const w = lec.week || 1;
            if (!byWeek[w]) byWeek[w] = {};
            if (!byWeek[w][subject.name]) byWeek[w][subject.name] = [];
            byWeek[w][subject.name].push(lec);
        });
    });

    if (!Object.keys(byWeek).length) {
        timeline.innerHTML = `<div class="empty-state"><div class="empty-icon">📅</div><div class="empty-title">Noch kein Wochenplan</div><div class="empty-text">Aktualisiere zuerst deine Daten.</div></div>`;
        return;
    }

    const weeks = Object.keys(byWeek).map(Number).sort((a, b) => a - b);
    const semesterStart = currentSemester().start;

    timeline.innerHTML = weeks.map(w => {
        const weekStart = new Date(semesterStart);
        weekStart.setDate(semesterStart.getDate() + (w - 1) * 7);
        const weekEnd = new Date(weekStart);
        weekEnd.setDate(weekStart.getDate() + 6);
        const fmtDate = d => d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });

        const subjects = byWeek[w];
        const subjectsHtml = Object.entries(subjects).map(([subName, lectures]) => {
            const cfg = getSubjectConfig(subName);
            const topTopics = [...new Set(lectures.flatMap(l => l.topics || []))].slice(0, 5);
            return `
        <div class="week-subject-item">
          <div class="week-subject-dot" style="background:${cfg.color}"></div>
          <div class="week-subject-content">
            <div class="week-subject-name">${cfg.icon} ${escapeHtml(subName)}</div>
            <div class="week-subject-topics">${topTopics.map(t => escapeHtml(t)).join(' · ') || 'Keine Themen'}</div>
          </div>
        </div>`;
        }).join('');

        const lectureCount = Object.values(subjects).flat().length;

        return `
      <div class="week-block">
        <div class="week-block-header">
          <div class="week-block-title">📅 Woche ${w} (KW ${w})</div>
          <div class="week-block-date">${fmtDate(weekStart)} – ${fmtDate(weekEnd)}<br><small>${lectureCount} Vorlesungen</small></div>
        </div>
        <div class="week-subjects">${subjectsHtml}</div>
      </div>`;
    }).join('');
}

// ═══════════════════════════════════════════════════════════
// SETTINGS VIEW
// ═══════════════════════════════════════════════════════════
function renderSettings() {
    const platforms = [
        { name: 'ILIAS', icon: '📖', url: process.env?.ILIAS_URL || 'ilias.uni-tuebingen.de', color: '#34a853' },
        { name: 'MOODLE', icon: '🌐', url: 'moodle.zdv.uni-tuebingen.de', color: '#1a73e8' },
        { name: 'ALMA', icon: '🏛️', url: 'alma.uni-tuebingen.de', color: '#fb8c00' },
        { name: 'SIMED', icon: '🏥', url: 'simed.uni-tuebingen.de', color: '#ec4899' }
    ];

    const container = document.getElementById('platform-cards');
    container.innerHTML = platforms.map(p => {
        const subjectData = state.subjects.find(s =>
            s.platform === p.name || s.name === p.name
        );
        const hasData = !!subjectData;

        return `
      <div class="platform-card">
        <div class="platform-header">
          <div class="subject-icon" style="background:${p.color}22;width:36px;height:36px;font-size:18px;">${p.icon}</div>
          <div>
            <strong style="font-size:14px;">${p.name}</strong>
            <div style="font-size:11px;color:var(--text-muted);">${p.url}</div>
          </div>
          <span class="platform-badge ${hasData ? 'ok' : ''}" style="margin-left:auto;background:${hasData ? 'rgba(52,211,153,0.15)' : 'rgba(255,255,255,0.05)'};color:${hasData ? 'var(--accent-green)' : 'var(--text-muted)'};">
            ${hasData ? '✓ Aktiv' : 'Nicht konfiguriert'}
          </span>
        </div>
        <div class="platform-status" style="font-size:11px;color:var(--text-muted);">
          Zugangsdaten in <code>.env</code> eintragen
        </div>
      </div>`;
    }).join('');
}

// ═══════════════════════════════════════════════════════════
// REFRESH
// ═══════════════════════════════════════════════════════════
async function startRefresh() {
    if (state.refreshing) return;
    state.refreshing = true;

    const btn = document.getElementById('btn-refresh');
    const icon = document.getElementById('refresh-icon');
    const bar = document.getElementById('refresh-bar');
    const label = document.getElementById('refresh-label');
    const fill = document.getElementById('progress-fill');

    btn.disabled = true;
    icon.style.animation = 'spin 1.2s linear infinite';
    bar.classList.add('visible');

    try {
        // Start refresh
        await api('POST', '/api/refresh');
        toast('Aktualisierung gestartet...', 'info');

        // Poll progress
        const poll = setInterval(async () => {
            try {
                const progress = await api('GET', '/api/refresh/status');
                label.textContent = progress.message || 'Aktualisiere...';
                fill.style.width = `${progress.progress || 0}%`;

                if (progress.status === 'done') {
                    clearInterval(poll);
                    toast('✅ Aktualisierung abgeschlossen!', 'success');
                    await loadSubjects();
                    finishRefresh(btn, icon, bar);
                } else if (progress.status === 'error') {
                    clearInterval(poll);
                    toast(`Fehler: ${progress.message}`, 'error');
                    finishRefresh(btn, icon, bar);
                }
            } catch { clearInterval(poll); finishRefresh(btn, icon, bar); }
        }, 1500);

        // Timeout nach 5 Minuten
        setTimeout(() => {
            clearInterval(poll);
            finishRefresh(btn, icon, bar);
        }, 300000);

    } catch (err) {
        toast('Fehler beim Aktualisieren', 'error');
        finishRefresh(btn, icon, bar);
    }
}

function finishRefresh(btn, icon, bar) {
    state.refreshing = false;
    btn.disabled = false;
    icon.style.animation = '';
    setTimeout(() => bar.classList.remove('visible'), 2000);
}

// ═══════════════════════════════════════════════════════════
// PDF SUMMARY
// ═══════════════════════════════════════════════════════════
async function downloadSummary() {
    const btn = document.getElementById('btn-summary');
    btn.disabled = true;

    toast('📄 PDF wird generiert...', 'info');

    try {
        const res = await fetch('/api/summary/pdf', { credentials: 'include' });
        if (!res.ok) throw new Error('Server-Fehler');

        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        const today = new Date().toLocaleDateString('de-DE').replace(/\./g, '-');
        a.download = `Lernplan_SoSe2026_${today}.pdf`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
        toast('✅ PDF heruntergeladen!', 'success');
    } catch (err) {
        toast('Fehler beim PDF-Erstellen', 'error');
    } finally {
        btn.disabled = false;
    }
}

// ═══════════════════════════════════════════════════════════
// STATISTICS PDF
// ═══════════════════════════════════════════════════════════
async function downloadStats() {
    const btn = document.getElementById('btn-stats');
    btn.disabled = true;

    toast('📊 Statistik-PDF wird erstellt...', 'info');

    try {
        const res = await fetch('/api/stats/pdf', { credentials: 'include' });
        if (!res.ok) throw new Error('Server-Fehler');

        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        const today = new Date().toLocaleDateString('de-DE').replace(/\./g, '-');
        a.download = `Quellenanalyse_${today}.pdf`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
        toast('✅ Statistik-PDF heruntergeladen!', 'success');
    } catch (err) {
        toast('Fehler beim Statistik-PDF', 'error');
    } finally {
        btn.disabled = false;
    }
}


function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

// ═══════════════════════════════════════════════════════════════
// SEMESTER PICKER
// ═══════════════════════════════════════════════════════════════
function initSemesterPicker() {
    const btn = document.getElementById('semester-picker');
    const dropdown = document.getElementById('semester-dropdown');
    const overlay = document.getElementById('semester-overlay');
    const label = document.getElementById('semester-label');

    function openDropdown() {
        dropdown.classList.add('open');
        overlay.classList.add('visible');
        btn.classList.add('open');
    }

    function closeDropdown() {
        dropdown.classList.remove('open');
        overlay.classList.remove('visible');
        btn.classList.remove('open');
    }

    btn.addEventListener('click', () => {
        dropdown.classList.contains('open') ? closeDropdown() : openDropdown();
    });

    overlay.addEventListener('click', closeDropdown);

    document.querySelectorAll('.semester-option').forEach(opt => {
        opt.addEventListener('click', () => {
            const key = opt.dataset.key;
            state.semesterKey = key;
            localStorage.setItem('semesterKey', key);

            // Update label
            label.textContent = SEMESTERS[key].label;

            // Update active state on buttons
            document.querySelectorAll('.semester-option').forEach(o => {
                o.classList.toggle('active', o.dataset.key === key);
            });
            // Update checkmarks
            Object.keys(SEMESTERS).forEach(k => {
                const el = document.getElementById(`check-${k}`);
                if (el) el.textContent = k === key ? '✓' : '';
            });

            closeDropdown();

            // Re-render with new semester dates
            renderSubjects();
            if (state.currentView === 'week') renderWeekView();

            toast(`${SEMESTERS[key].icon} ${SEMESTERS[key].full} gewählt`, 'info', 2200);
        });
    });

    // Apply persisted semester on load
    const saved = state.semesterKey;
    if (saved && SEMESTERS[saved]) {
        label.textContent = SEMESTERS[saved].label;
        document.querySelectorAll('.semester-option').forEach(o => {
            o.classList.toggle('active', o.dataset.key === saved);
        });
        Object.keys(SEMESTERS).forEach(k => {
            const el = document.getElementById(`check-${k}`);
            if (el) el.textContent = k === saved ? '✓' : '';
        });
    }
}

// ═══════════════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════════════
async function init() {
    // Check auth status
    try {
        const status = await api('GET', '/api/auth/status');
        state.pinSet = status.pinSet;
        state.authenticated = status.authenticated;

        // Update hint text if no PIN set yet
        if (!status.pinSet) {
            document.getElementById('lock-hint').innerHTML =
                '🆕 Erster Start! Gib einen 4-8-stelligen<br>PIN ein, der gespeichert wird.';
        }

        if (status.authenticated) {
            unlockApp();
        }
    } catch {
        // Server not reachable – show lock screen anyway
    }

    initPinPad();
    initSemesterPicker();

    // Nav
    document.querySelectorAll('.nav-item').forEach(item => {
        item.addEventListener('click', () => showView(item.dataset.view));
    });

    // Buttons
    document.getElementById('btn-refresh').addEventListener('click', startRefresh);
    document.getElementById('btn-summary').addEventListener('click', downloadSummary);
    document.getElementById('btn-stats').addEventListener('click', downloadStats);
    document.getElementById('btn-logout').addEventListener('click', async () => {
        await api('POST', '/api/auth/logout');
        lockApp();
        toast('Ausgeloggt', 'info', 2000);
    });

    document.getElementById('btn-change-pin').addEventListener('click', async () => {
        await api('POST', '/api/auth/logout');
        lockApp();
        document.getElementById('lock-hint').innerHTML =
            '🔐 Gib deinen neuen PIN ein (4-8 Ziffern)';
        toast('Gib deinen neuen PIN ein', 'info');
        // Reset PIN hash by clearing it
        const patchResult = await fetch('/api/auth/reset-pin', { method: 'POST', credentials: 'include' }).catch(() => null);
    });

    document.getElementById('btn-clear-cache').addEventListener('click', () => {
        if (confirm('Cache wirklich leeren? Alle lokalen Daten werden gelöscht.')) {
            // POST to clear cache
            api('POST', '/api/cache/clear').then(() => {
                state.subjects = [];
                renderSubjects();
                updateStats();
                toast('Cache geleert', 'success');
            });
        }
    });

    // Demo Mode Toggle
    const toggleDemo = document.getElementById('toggle-demo');
    if (toggleDemo) {
        toggleDemo.checked = localStorage.getItem('demoMode') === 'true';
        toggleDemo.addEventListener('change', (e) => {
            localStorage.setItem('demoMode', e.target.checked);
            toast(e.target.checked ? 'Demo-Modus aktiviert (Refresh erforderlich)' : 'Demo-Modus deaktiviert', 'info');
        });
    }

    // Service Worker
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('/sw.js').catch(() => { });
    }

    // App-Version im Footer anzeigen
    fetch('/api/version')
        .then(r => r.json())
        .then(d => {
            const el = document.getElementById('app-version');
            if (el && d.version) el.textContent = `v${d.version}`;
        })
        .catch(() => { /* ignore */ });

    // Hub-Demo-Toggle synchronisieren
    const hubDemoToggle = document.getElementById('toggle-demo-hub');
    const settingsDemoToggle = document.getElementById('toggle-demo');
    if (hubDemoToggle) {
        hubDemoToggle.checked = localStorage.getItem('demoMode') === 'true';
        hubDemoToggle.addEventListener('change', (e) => {
            localStorage.setItem('demoMode', e.target.checked);
            if (settingsDemoToggle) settingsDemoToggle.checked = e.target.checked;
            toast(e.target.checked ? '🧪 Demo-Modus aktiviert – Seite neu laden' : '✅ Demo-Modus deaktiviert – Seite neu laden', 'info', 3000);
            setTimeout(() => location.reload(), 1500);
        });
    }
    if (settingsDemoToggle) {
        settingsDemoToggle.addEventListener('change', (e) => {
            if (hubDemoToggle) hubDemoToggle.checked = e.target.checked;
        });
    }
}

// ─── iCal Info Modal ─────────────────────────────────────────────
function lpShowIcalInfo() {
    const base = window.location.origin;
    const token = ''; // user sets ICAL_TOKEN in Railway env
    const url = `${base}/api/calendar/ical`;
    const msg = `📅 Apple Kalender Abonnement\n\n` +
        `Öffne auf dem iPhone:\nEinstellungen → Kalender → Accounts → Account hinzufügen → Andere → Kalenderabo hinzufügen\n\n` +
        `Server-URL:\n${url}\n\n` +
        `(Optional: In Railway ICAL_TOKEN setzen und ?token=XXX anhängen für Passwortschutz)`;
    if (confirm(`${msg}\n\nURL in Zwischenablage kopieren?`)) {
        navigator.clipboard.writeText(url).then(() => {
            if (typeof toast === 'function') toast('📋 iCal-URL kopiert!', 'success');
        }).catch(() => {
            alert(`iCal URL:\n${url}`);
        });
    }
}

// Expose toggleSubject globally for onclick
window.toggleSubject = toggleSubject;

document.addEventListener('DOMContentLoaded', init);
