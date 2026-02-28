/**
 * E-Mail-Service – Stundenplan-Benachrichtigungen
 * Zukünftig über Resend API (HTTPS), um Railways SMTP-Blocks zu umgehen.
 */
const { Resend } = require('resend');
const { generateWeeklyTimetablePDF } = require('./weeklyTimetablePdf');
const { loadTimetableCache } = require('./timetableService');

const resend = new Resend(process.env.RESEND_API_KEY || 'not_configured');

function getSender() {
  return process.env.MAIL_FROM || 'stundenplan@lml-med.de';
}

function getRecipient() {
  return process.env.MAIL_TO || 'laurinlobeck@gmail.com';
}

/**
 * Sendet eine Änderungs-E-Mail mit Vorher/Nachher-Vergleich
 */
async function sendChangeMail(diff) {
  if (!process.env.RESEND_API_KEY) {
    console.warn('⚠️  RESEND_API_KEY nicht konfiguriert – überspringe E-Mail.');
    return false;
  }
  if (!diff || (diff.added.length + diff.changed.length + diff.removed.length === 0)) {
    return false; // Keine Änderungen
  }

  const addedHtml = diff.added.map(e => `
  <tr style="background:#064e3b;">
    <td style="padding:6px 10px; color:#6ee7b7; font-weight:600;">NEU</td>
    <td style="padding:6px 10px;">${formatEvent(e)}</td>
  </tr>`).join('');

  const removedHtml = diff.removed.map(e => `
  <tr style="background:#4c0519;">
    <td style="padding:6px 10px; color:#fca5a5; font-weight:600;">ENTFALLEN</td>
    <td style="padding:6px 10px; text-decoration:line-through;">${formatEvent(e)}</td>
  </tr>`).join('');

  const changedHtml = diff.changed.map(e => `
  <tr style="background:#422006;">
    <td style="padding:6px 10px; color:#fbbf24; font-weight:600;">GEAENDERT</td>
    <td style="padding:6px 10px;">
      <del style="color:#9ca3af;">${formatEvent(e.before)}</del><br>
      <strong style="color:#fbbf24;">${formatEvent(e.after)}</strong>
    </td>
  </tr>`).join('');

  const html = `
<!DOCTYPE html>
<html lang="de">
<head><meta charset="UTF-8"></head>
<body style="background:#0a0a12; color:#e2e8f0; font-family:Arial,sans-serif; margin:0; padding:20px;">
  <div style="max-width:600px; margin:0 auto;">
    <div style="background:linear-gradient(135deg,#1a73e8,#8b5cf6); border-radius:12px; padding:24px; margin-bottom:20px;">
      <h1 style="margin:0; font-size:22px;">Stundenplan-Aenderungen</h1>
      <p style="margin:8px 0 0; opacity:0.8; font-size:14px;">
        ${new Date().toLocaleString('de-DE', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
      </p>
    </div>
    <div style="background:#13131f; border-radius:12px; padding:20px; margin-bottom:16px;">
      <p style="margin:0; color:#94a3b8;">
        Neue Aenderungen: 
        <strong style="color:#6ee7b7;">${diff.added.length} neu</strong> &middot;
        <strong style="color:#fbbf24;">${diff.changed.length} geaendert</strong> &middot;
        <strong style="color:#fca5a5;">${diff.removed.length} entfallen</strong>
      </p>
    </div>
    <table style="width:100%; border-collapse:collapse; background:#13131f; border-radius:12px; overflow:hidden;">
      <thead>
        <tr style="background:#1a1a28;">
          <th style="padding:10px; text-align:left; color:#94a3b8; width:100px;">Status</th>
          <th style="padding:10px; text-align:left; color:#94a3b8;">Veranstaltung</th>
        </tr>
      </thead>
      <tbody>
        ${addedHtml}${changedHtml}${removedHtml}
      </tbody>
    </table>
    <p style="color:#475569; font-size:11px; margin-top:16px; text-align:center;">
      TüTool &middot; Automatische Benachrichtigung
    </p>
  </div>
</body>
</html>`;

  try {
    // Aktuellen Wochenplan als PDF-Anhang generieren
    let attachments = [];
    try {
      const allEvents = loadTimetableCache() || [];
      const now = new Date();
      const dayOfWeek = now.getDay() === 0 ? 6 : now.getDay() - 1;
      const weekStart = new Date(now);
      weekStart.setDate(now.getDate() - dayOfWeek);
      weekStart.setHours(0, 0, 0, 0);
      const weekEnd = new Date(weekStart);
      weekEnd.setDate(weekStart.getDate() + 7);
      const weekEvents = allEvents.filter(e => {
        const d = new Date(e.date);
        return d >= weekStart && d < weekEnd;
      });
      const kw = Math.ceil((weekStart - new Date(weekStart.getFullYear(), 0, 1)) / 604800000) + 1;
      const weekLabel = `KW ${kw} · ${weekStart.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })} – ${new Date(weekEnd.getTime() - 86400000).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' })}`;
      const pdfBuffer = await generateWeeklyTimetablePDF(weekEvents, weekLabel);
      attachments = [{ filename: `Stundenplan_${weekStart.toLocaleDateString('de-DE').replace(/\./g, '-')}.pdf`, content: pdfBuffer }];
    } catch (pdfErr) {
      console.error('⚠️  PDF-Anhang Fehler (Änderungs-Mail):', pdfErr.message);
    }

    const { data, error } = await resend.emails.send({
      from: `Stundenplan App <${getSender()}>`,
      to: getRecipient(),
      subject: `Stundenplan-Aenderungen – ${new Date().toLocaleDateString('de-DE')}`,
      html,
      attachments
    });
    if (error) {
      console.error('Resend Error:', error);
      return false;
    }
    console.log(`✅ Aenderungs-Mail gesendet an ${getRecipient()}`);
    return true;
  } catch (err) {
    console.error('Resend Error Catch:', err);
    return false;
  }
}

/**
 * Sendet den Wochenausblick (Sonntag 16:00)
 */
async function sendWeeklyOverview(events) {
  if (!process.env.RESEND_API_KEY) {
    console.warn('⚠️  RESEND_API_KEY nicht konfiguriert – ueberspringe Wochenausblick.');
    return false;
  }

  // Nächste Woche ermitteln
  const today = new Date();
  const nextMonday = new Date(today);
  nextMonday.setDate(today.getDate() + (1 + 7 - today.getDay()) % 7 || 7);

  const weekEvents = events
    .filter(e => {
      if (!e.date) return false;
      const d = new Date(e.date);
      const diff = (d - nextMonday) / 86400000;
      return diff >= 0 && diff < 7;
    })
    .sort((a, b) => new Date(a.date) - new Date(b.date));

  const byDay = {};
  const DAYS = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
  weekEvents.forEach(e => {
    const d = new Date(e.date);
    const key = `${DAYS[d.getDay() === 0 ? 6 : d.getDay() - 1]} ${d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })}`;
    if (!byDay[key]) byDay[key] = [];
    byDay[key].push(e);
  });

  const daysHtml = Object.entries(byDay).map(([day, evts]) => `
  <div style="margin-bottom:16px;">
    <div style="background:#1a1a28; padding:8px 14px; border-radius:8px; font-weight:700; color:#5b8def; margin-bottom:8px;">${day}</div>
    ${evts.map(e => `
      <div style="background:#13131f; border-left:3px solid ${getSubjectColor(e.subject)}; padding:8px 12px; margin-bottom:6px; border-radius:0 8px 8px 0;">
        <div style="font-weight:600;">${e.title}${e.mandatory ? ' <span style="color:#ef4444; font-size:11px;">[PFLICHT]</span>' : ''}</div>
        <div style="color:#94a3b8; font-size:12px;">${e.timeFrom || ''} ${e.timeTo ? '– ' + e.timeTo : ''} &middot; ${e.location || ''} &middot; ${e.lecturer || ''}</div>
      </div>`).join('')}
  </div>`).join('');

  const html = `
<!DOCTYPE html>
<html lang="de">
<head><meta charset="UTF-8"></head>
<body style="background:#0a0a12; color:#e2e8f0; font-family:Arial,sans-serif; margin:0; padding:20px;">
  <div style="max-width:600px; margin:0 auto;">
    <div style="background:linear-gradient(135deg,#059669,#0d9488); border-radius:12px; padding:24px; margin-bottom:20px;">
      <h1 style="margin:0; font-size:22px;">Wochenausblick</h1>
      <p style="margin:8px 0 0; opacity:0.8; font-size:14px;">
        Woche vom ${nextMonday.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' })}
        &middot; ${weekEvents.length} Veranstaltungen
      </p>
    </div>
    ${daysHtml || '<p style="color:#64748b; text-align:center;">Keine Veranstaltungen naechste Woche.</p>'}
    <p style="color:#475569; font-size:11px; margin-top:20px; text-align:center;">
      TüTool &middot; Wochenausblick (automatisch jeden Sonntag 16:00 Uhr)
    </p>
  </div>
</body>
</html>`;

  try {
    // Nächste Woche als PDF-Anhang
    let attachments = [];
    try {
      const kw = Math.ceil((nextMonday - new Date(nextMonday.getFullYear(), 0, 1)) / 604800000) + 1;
      const nextSunday = new Date(nextMonday);
      nextSunday.setDate(nextMonday.getDate() + 6);
      const weekLabel = `KW ${kw} · ${nextMonday.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })} – ${nextSunday.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' })}`;
      const pdfBuffer = await generateWeeklyTimetablePDF(weekEvents, weekLabel);
      attachments = [{ filename: `Wochenausblick_${nextMonday.toLocaleDateString('de-DE').replace(/\./g, '-')}.pdf`, content: pdfBuffer }];
    } catch (pdfErr) {
      console.error('⚠️  PDF-Anhang Fehler (Wochenausblick):', pdfErr.message);
    }

    const { data, error } = await resend.emails.send({
      from: `Stundenplan App <${getSender()}>`,
      to: getRecipient(),
      subject: `Wochenausblick – ${nextMonday.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' })}`,
      html,
      attachments
    });

    if (error) {
      console.error('Resend Error:', error);
      return false;
    }

    console.log(`✅ Wochenausblick gesendet an ${getRecipient()}`);
    return true;
  } catch (err) {
    console.error('Resend catch Error:', err);
    return false;
  }
}

/**
 * Test-Mail senden (API-Endpunkt /api/timetable/test-mail)
 */
async function sendTestMail() {
  if (!process.env.RESEND_API_KEY) {
    throw new Error('RESEND_API_KEY fehlt! Bitte bei Railway eintragen.');
  }

  try {
    const { data, error } = await resend.emails.send({
      from: `Stundenplan App <${getSender()}>`,
      to: getRecipient(),
      subject: 'Test-Mail – Stundenplan App',
      html: '<p style="font-family:Arial;color:#333;">Test erfolgreich! Die Resend E-Mail-Verbindung funktioniert perfekt über HTTPS.</p>'
    });

    if (error) {
      console.error('Resend API Error:', error);
      throw new Error(error.message);
    }

    return true;
  } catch (err) {
    console.error('Resend catch:', err);
    throw new Error(err.message || 'Unbekannter Resend E-Mail-Fehler');
  }
}

// ─── Helpers ──────────────────────────────────────────────────────
function formatEvent(e) {
  if (!e) return 'Unbekannte Veranstaltung';
  const time = e.timeFrom ? `${e.timeFrom}${e.timeTo ? ' – ' + e.timeTo : ''}` : '';
  const date = e.date ? new Date(e.date).toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' }) : '';
  return [date, time, e.title, e.location, e.lecturer].filter(Boolean).join(' &middot; ');
}

const SUBJECT_COLORS = {
  'Anatomie': '#ef4444',
  'Physiologie': '#3b82f6',
  'Biochemie': '#22c55e',
  'Histologie': '#f97316',
  'Biologie': '#06b6d4',
  'Physik': '#a855f7',
  'Chemie': '#6366f1',
  'SIMED': '#ec4899',
  'Klinik': '#f59e0b',
};

function getSubjectColor(subject) {
  if (!subject) return '#64748b';
  for (const [key, color] of Object.entries(SUBJECT_COLORS)) {
    if (subject.toLowerCase().includes(key.toLowerCase())) return color;
  }
  return '#64748b';
}

module.exports = { sendChangeMail, sendWeeklyOverview, sendTestMail, getSubjectColor };
