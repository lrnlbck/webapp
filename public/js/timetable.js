/**
 * Stundenplan & Hub Frontend Logic
 * Depends on: app.js (toast, api, state, SEMESTERS, SUBJECT_CONFIG)
 */

// ═══════════════════════════════════════════════════════════════
// HUB NAVIGATION
// ═══════════════════════════════════════════════════════════════

function showHub() {
  document.getElementById('hub-screen').classList.add('visible');
  document.getElementById('lernuebersicht-app').classList.remove('visible');
  document.getElementById('stundenplan-app').classList.remove('visible');
  // Update greeting
  const hour = new Date().getHours();
  const greeting =
    hour < 12 ? 'Guten Morgen' :
      hour < 18 ? 'Guten Tag' :
        document.getElementById('hub-greeting').textContent = greeting;

  // Portal Status check
  checkPortals();
}

async function checkPortals() {
  const btn = document.getElementById('portal-refresh-btn');
  const chips = {
    ILIAS: document.getElementById('chip-ilias'),
    ALMA: document.getElementById('chip-alma'),
    MOODLE: document.getElementById('chip-moodle'),
    SIMED: document.getElementById('chip-simed')
  };

  // UI Reset
  if (btn) btn.classList.add('spinning');
  Object.values(chips).forEach(chip => {
    if (!chip) return;
    chip.className = 'portal-chip loading';
  });

  try {
    const data = await api('GET', '/api/auth/portals');
    if (data && data.portals) {
      Object.entries(data.portals).forEach(([key, info]) => {
        const chip = chips[key];
        if (chip) {
          chip.className = `portal-chip ${info.status}`;
          if (info.status === 'not_configured') chip.title = 'In Railway nicht konfiguriert';
          else if (info.status === 'error') chip.title = 'Fehler beim Login';
          else chip.title = 'Verbunden';
        }
      });
    }
  } catch (err) {
    console.error('Portal Check Fehler:', err);
  } finally {
    if (btn) btn.classList.remove('spinning');
  }
}

function openApp(appName) {
  document.getElementById('hub-screen').classList.remove('visible');
  if (appName === 'lernuebersicht') {
    document.getElementById('lernuebersicht-app').classList.add('visible');
    // Trigger Lernübersicht data load (defined in app.js)
    if (typeof loadSubjects === 'function') loadSubjects();
  } else if (appName === 'stundenplan') {
    document.getElementById('stundenplan-app').classList.add('visible');
    loadTimetable(0);
  }
}

// ═══════════════════════════════════════════════════════════════
// STUNDENPLAN STATE
// ═══════════════════════════════════════════════════════════════

const spState = {
  weekOffset: 0,
  events: [],
  currentView: 'week'
};

const SUBJECT_COLORS_SP = {
  'Anatomie': '#ef4444',
  'Physiologie': '#3b82f6',
  'Biochemie': '#22c55e',
  'Histologie': '#f97316',
  'Biologie': '#06b6d4',
  'Physik': '#a855f7',
  'Chemie': '#6366f1',
  'SIMED': '#ec4899',
  'Klinik': '#f59e0b',
  'Allgemein': '#64748b',
  'Demo': '#8b5cf6',
};

function getSubjectColorSp(subject) {
  if (!subject) return '#64748b';
  for (const [key, col] of Object.entries(SUBJECT_COLORS_SP)) {
    if (subject.toLowerCase().includes(key.toLowerCase())) return col;
  }
  return '#64748b';
}

const WEEKDAY_NAMES = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
const WEEKDAY_FULL = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];

// ═══════════════════════════════════════════════════════════════
// LOAD & RENDER TIMETABLE
// ═══════════════════════════════════════════════════════════════

async function loadTimetable(weekOffset) {
  spState.weekOffset = weekOffset;
  const semKey = (typeof state !== 'undefined' && state.semesterKey) ? state.semesterKey : 'ss26';

  try {
    const [timetableData, lernplanData] = await Promise.all([
      fetch(`/api/timetable?week=${weekOffset}&semester=${semKey}`, { credentials: 'include' }).then(r => r.json()).catch(() => ({ events: [] })),
      fetch(`/api/lernplan/calendar?week=${weekOffset}`, { credentials: 'include' }).then(r => r.json()).catch(() => ({ events: [] }))
    ]);

    const timetableEvents = (timetableData.events || []).map(e => ({ ...e, _source: 'timetable' }));

    // Lernplan-Events in das Stundenplan-Format umwandeln
    const lernplanEvents = (lernplanData.events || []).map(e => ({
      ...e,
      _source: 'lernplan',
      // Kompatible Felder für renderTimetable
      mandatory: e.type === 'exam',
      platform: e.type === 'exam' ? 'Prüfung' : 'Lernplan',
    }));

    spState.events = [...timetableEvents, ...lernplanEvents];
    updateWeekHeader(weekOffset, semKey);
    renderTimetable(spState.events);

    if (timetableData.lastUpdated) {
      const d = new Date(timetableData.lastUpdated);
      const label = d.toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
      document.getElementById('sp-week-label').textContent = `Zuletzt: ${label}`;
    }
  } catch (err) {
    document.getElementById('sp-content').innerHTML = `
      <div class="sp-empty">
        <div class="sp-empty-icon">⚠️</div>
        <div class="sp-empty-title">Server nicht erreichbar</div>
        <div class="sp-empty-desc">Stelle sicher, dass der Server läuft (npm start)</div>
      </div>`;
  }
}

function updateWeekHeader(weekOffset, semKey) {
  const semStarts = {
    ss26: '2026-04-20', ws2627: '2026-10-15',
    ss27: '2027-04-19', ws2728: '2027-10-14'
  };
  const semStart = new Date(semStarts[semKey] || semStarts.ss26);

  const now = new Date();
  const currentWeekSince = Math.floor((now - semStart) / (7 * 86400000));
  const targetWeek = currentWeekSince + weekOffset + 1;

  const weekStart = new Date(semStart);
  weekStart.setDate(semStart.getDate() + (targetWeek - 1) * 7);
  weekStart.setHours(0, 0, 0, 0);
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 6);

  const fmt = d => d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });

  const titleEl = document.getElementById('sp-week-title');
  const datesEl = document.getElementById('sp-week-dates');

  if (weekOffset === 0) {
    titleEl.textContent = `Diese Woche · KW ${getISOWeek(weekStart)}`;
  } else if (weekOffset === 1) {
    titleEl.textContent = `Nächste Woche · KW ${getISOWeek(weekStart)}`;
  } else if (weekOffset === -1) {
    titleEl.textContent = `Letzte Woche · KW ${getISOWeek(weekStart)}`;
  } else {
    const semWeekLabel = targetWeek > 0 ? `SW ${targetWeek}` : '';
    titleEl.textContent = `KW ${getISOWeek(weekStart)} ${semWeekLabel ? '· ' + semWeekLabel : ''}`;
  }
  datesEl.textContent = `${fmt(weekStart)} – ${fmt(weekEnd)}`;
}

function renderTimetable(events) {
  const container = document.getElementById('sp-content');
  if (!events || events.length === 0) {
    container.innerHTML = `
      <div class="sp-empty">
        <div class="sp-empty-icon">📅</div>
        <div class="sp-empty-title">Keine Veranstaltungen</div>
        <div class="sp-empty-desc">Für diese Woche sind keine Termine eingetragen.<br>Drücke <strong>🔄</strong> zum Aktualisieren.</div>
      </div>`;
    return;
  }

  // Build legend
  const subjects = [...new Set(events.map(e => e.subject))];
  const legendHtml = subjects.map(s => `
    <div class="sp-legend-item">
      <div class="sp-legend-dot" style="background:${getSubjectColorSp(s)};"></div>
      ${escSp(s)}
    </div>`).join('') +
    `<div class="sp-legend-item">
      <div class="sp-legend-dot" style="background:#ef4444; border:2px solid #ef4444;"></div>
      Pflicht
    </div>`;

  // Group by weekday (1=Mo ... 7=So)
  const byDay = {};
  events.forEach(e => {
    const d = new Date(e.date);
    const dayKey = d.getDay(); // 0=Sun,...,6=Sat
    if (!byDay[dayKey]) byDay[dayKey] = { date: d, events: [] };
    byDay[dayKey].events.push(e);
  });

  // Order Mo–Fr–Sa–So
  const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0];
  const today = new Date().getDay();

  let daysHtml = '';
  DAY_ORDER.forEach(dayNum => {
    if (!byDay[dayNum]) return;
    const { date, events: dayEvents } = byDay[dayNum];
    const isToday = dayNum === today;

    // Sort by time
    dayEvents.sort((a, b) => (a.timeFrom || '').localeCompare(b.timeFrom || ''));

    const eventsHtml = dayEvents.map(e => {
      const isExam = e._source === 'lernplan' && e.type === 'exam';
      const isLearn = e._source === 'lernplan' && e.type === 'learn_block';
      const color = isExam ? '#ef4444' :
        isLearn ? '#059669' :
          getSubjectColorSp(e.subject);
      const extraClass = isExam ? ' sp-event-exam' :
        isLearn ? ' sp-event-learn' : '';
      return `
        <div class="sp-event${e.mandatory ? ' mandatory' : ''}${extraClass}" style="border-left-color:${color};">
          <div class="sp-event-time">
            <div class="sp-event-time-from">${escSp(e.timeFrom || '–')}</div>
            <div class="sp-event-time-to">${escSp(e.timeTo || '')}</div>
          </div>
          <div class="sp-event-body">
            <div class="sp-event-title">${escSp(e.title)}</div>
            <div class="sp-event-meta">
              ${e.location ? `<span class="sp-event-chip location">📍 ${escSp(e.location)}</span>` : ''}
              ${e.lecturer ? `<span class="sp-event-chip">👤 ${escSp(e.lecturer)}</span>` : ''}
              ${e.platform ? `<span class="sp-event-chip platform">${escSp(e.platform)}</span>` : ''}
              ${isLearn && e.topics && e.topics.length > 0 ? `<span class="sp-event-chip" style="color:#059669;">📖 ${e.topics.slice(0, 3).join(' · ')}${e.topics.length > 3 ? ` +${e.topics.length - 3}` : ''}</span>` : ''}
              ${e.mandatory && !isExam ? '<span class="sp-pflicht-badge">Pflicht</span>' : ''}
              ${isExam ? '<span class="sp-pflicht-badge" style="background:rgba(239,68,68,0.15);color:#ef4444;">🎯 Prüfung</span>' : ''}
            </div>
          </div>
        </div>`;
    }).join('');

    daysHtml += `
      <div class="sp-day-block${isToday ? ' sp-day-today' : ''}">
        <div class="sp-day-header">
          <span class="sp-day-label">${WEEKDAY_FULL[dayNum]}</span>
          <span class="sp-day-date">${date.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })}</span>
          ${isToday ? '<span class="sp-day-badge">Heute</span>' : ''}
        </div>
        ${eventsHtml}
      </div>`;
  });

  container.innerHTML = `
    <div class="sp-legend">${legendHtml}</div>
    ${daysHtml}`;
}

// ═══════════════════════════════════════════════════════════════
// STUNDENPLAN SETTINGS VIEW
// ═══════════════════════════════════════════════════════════════

function renderSpSettings() {
  const container = document.getElementById('sp-content');
  container.innerHTML = `
    <div style="padding:16px;">
      <div class="settings-group-title" style="margin-bottom:10px;">E-Mail-Benachrichtigungen</div>

      <div class="settings-group">
        <div class="settings-item" style="cursor:default;">
          <div class="settings-item-left">
            <div class="settings-item-icon" style="background:rgba(52,211,153,0.15);">📧</div>
            <div>
              <div class="settings-item-label">Änderungs-Mails</div>
              <div class="settings-item-desc">Täglich 06:00 & 21:00 bei Änderungen</div>
            </div>
          </div>
          <span style="font-size:11px;color:var(--accent-green);">Aktiv</span>
        </div>
        <div class="settings-item" style="cursor:default;">
          <div class="settings-item-left">
            <div class="settings-item-icon" style="background:rgba(91,141,239,0.15);">📅</div>
            <div>
              <div class="settings-item-label">Wochenausblick</div>
              <div class="settings-item-desc">Sonntag 16:00 Uhr automatisch</div>
            </div>
          </div>
          <span style="font-size:11px;color:var(--accent-green);">Aktiv</span>
        </div>
        <div class="settings-item" id="sp-test-mail-btn">
          <div class="settings-item-left">
            <div class="settings-item-icon" style="background:rgba(251,146,60,0.15);">✉️</div>
            <div>
              <div class="settings-item-label">Test-Mail senden</div>
              <div class="settings-item-desc">Verbindung testen</div>
            </div>
          </div>
          <span class="settings-chevron">›</span>
        </div>
      </div>

      <div class="settings-group-title" style="margin:16px 0 10px;">Automatische Aktualisierung</div>
      <div class="settings-group">
        <div class="settings-item" style="cursor:default;">
          <div class="settings-item-left">
            <div class="settings-item-icon" style="background:rgba(139,92,246,0.15);">🔄</div>
            <div>
              <div class="settings-item-label">3× täglich</div>
              <div class="settings-item-desc">07:00 · 13:00 · 19:00 Uhr</div>
            </div>
          </div>
          <span style="font-size:11px;color:var(--accent-green);">Aktiv</span>
        </div>
      </div>
    </div>`;

  // Wire test-mail button
  const testBtn = document.getElementById('sp-test-mail-btn');
  if (testBtn) {
    testBtn.addEventListener('click', async () => {
      testBtn.style.opacity = '0.5';
      testBtn.style.pointerEvents = 'none';
      try {
        const res = await fetch('/api/timetable/test-mail', { method: 'POST', credentials: 'include' });
        const data = await res.json();
        if (data.success) toast('✅ Test-Mail gesendet!', 'success');
        else toast('Fehler: ' + data.error, 'error');
      } catch { toast('Server-Fehler', 'error'); }
      testBtn.style.opacity = '';
      testBtn.style.pointerEvents = '';
    });
  }
}

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════

function escSp(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function getISOWeek(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 3 - (d.getDay() + 6) % 7);
  const week1 = new Date(d.getFullYear(), 0, 4);
  return 1 + Math.round(((d.getTime() - week1.getTime()) / 86400000 - 3 + (week1.getDay() + 6) % 7) / 7);
}

// ═══════════════════════════════════════════════════════════════
// INIT STUNDENPLAN
// ═══════════════════════════════════════════════════════════════

function initTimetable() {
  // Hub navigation
  document.getElementById('open-lernuebersicht')?.addEventListener('click', () => openApp('lernuebersicht'));
  document.getElementById('open-stundenplan')?.addEventListener('click', () => openApp('stundenplan'));
  document.getElementById('hub-lock-btn')?.addEventListener('click', () => {
    if (typeof lockApp === 'function') lockApp();
    else document.getElementById('hub-screen').classList.remove('visible');
  });
  document.getElementById('portal-refresh-btn')?.addEventListener('click', checkPortals);

  // Back buttons
  document.getElementById('back-from-lern')?.addEventListener('click', showHub);
  document.getElementById('back-from-stundenplan')?.addEventListener('click', showHub);

  // Week navigation
  document.getElementById('sp-prev-week')?.addEventListener('click', () => {
    loadTimetable(spState.weekOffset - 1);
  });
  document.getElementById('sp-next-week')?.addEventListener('click', () => {
    loadTimetable(spState.weekOffset + 1);
  });

  // Stundenplan refresh
  document.getElementById('sp-btn-refresh')?.addEventListener('click', async () => {
    const btn = document.getElementById('sp-btn-refresh');
    btn.style.opacity = '0.5';
    btn.style.pointerEvents = 'none';
    toast('🔄 Stundenplan wird aktualisiert...', 'info');
    try {
      await fetch('/api/timetable/refresh', { method: 'POST', credentials: 'include' });
      await new Promise(r => setTimeout(r, 1500));
      await loadTimetable(spState.weekOffset);
      toast('✅ Stundenplan aktualisiert!', 'success');
    } catch { toast('Fehler beim Aktualisieren', 'error'); }
    btn.style.opacity = '';
    btn.style.pointerEvents = '';
  });

  // Stundenplan bottom nav
  document.querySelectorAll('[data-sp-view]').forEach(item => {
    item.addEventListener('click', () => {
      document.querySelectorAll('[data-sp-view]').forEach(i => i.classList.remove('active'));
      item.classList.add('active');
      spState.currentView = item.dataset.spView;
      if (spState.currentView === 'week') {
        document.getElementById('sp-week-nav')?.style?.removeProperty('display');
        loadTimetable(spState.weekOffset);
      } else if (spState.currentView === 'settings') {
        renderSpSettings();
      }
    });
  });
}

// ═══════════════════════════════════════════════════════════════
// HOOK INTO app.js unlockApp
// ═══════════════════════════════════════════════════════════════

document.addEventListener('DOMContentLoaded', () => {
  initTimetable();

  // Register showHub so app.js unlockApp can call it
  window._showHub = showHub;

  // Patch unlockApp to show Hub instead of directly showing content
  const originalUnlock = window._originalUnlockApp;
  // unlockApp is defined in app.js – we override it here
  window.unlockApp = function () {
    document.getElementById('lock-screen').classList.add('hidden');
    setTimeout(() => { document.getElementById('lock-screen').style.display = 'none'; }, 450);
    showHub();
  };

  // Override lockApp to hide hub and sub-apps
  window.lockApp = function () {
    const lockScreen = document.getElementById('lock-screen');
    lockScreen.style.display = '';
    document.getElementById('hub-screen').classList.remove('visible');
    document.getElementById('lernuebersicht-app').classList.remove('visible');
    document.getElementById('stundenplan-app').classList.remove('visible');
    if (typeof state !== 'undefined') {
      state.authenticated = false;
      state.pinInput = '';
      if (typeof updatePinDots === 'function') updatePinDots();
    }
    requestAnimationFrame(() => {
      requestAnimationFrame(() => lockScreen.classList.remove('hidden'));
    });
  };
});
