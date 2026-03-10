/**
 * Automatischer Scheduler – Lernplan & Stundenplan
 * 
 * Lernplan:  täglich 07:00
 * Stundenplan: 3× täglich (07:00, 13:00, 19:00)
 * Änderungs-Mail: 2× täglich (06:00, 21:00) – nur bei Änderungen
 * Wochenausblick: Sonntag 16:00
 */
const schedule = require('node-schedule');
const { runFullRefresh } = require('./refreshService');
const { runTimetableRefresh, loadTimetableCache } = require('./timetableService');
const { sendChangeMail, sendWeeklyOverview } = require('./emailService');

const jobs = [];

function startScheduler() {
    // ── Lernplan: täglich 07:00 ──────────────────────────────────
    jobs.push(schedule.scheduleJob('0 7 * * *', async () => {
        console.log(`\n⏰ [07:00] Lernplan-Aktualisierung: ${new Date().toLocaleString('de-DE')}`);
        try { await runFullRefresh(); } catch (e) { console.error('❌ Lernplan-Fehler:', e.message); }
    }));

    // ── Stundenplan: 3× täglich ───────────────────────────────────
    ['0 7 * * *', '0 13 * * *', '0 19 * * *'].forEach(cron => {
        jobs.push(schedule.scheduleJob(cron, async () => {
            console.log(`\n⏰ Stundenplan-Refresh: ${new Date().toLocaleString('de-DE')}`);
            try { await runTimetableRefresh(false); /* Mail separat */ }
            catch (e) { console.error('❌ Stundenplan-Fehler:', e.message); }
        }));
    });

    // ── Änderungs-Check: 06:00 & 21:00 ───────────────────────────
    ['0 6 * * *', '0 21 * * *'].forEach(cron => {
        jobs.push(schedule.scheduleJob(cron, async () => {
            console.log(`\n📧 Änderungs-Check: ${new Date().toLocaleString('de-DE')}`);
            try {
                const result = await runTimetableRefresh(true); // true = Mail senden wenn Änderung
                if (result?.diff) {
                    const { added, changed, removed } = result.diff;
                    const total = added.length + changed.length + removed.length;
                    if (total > 0) console.log(`📧 Mail gesendet (${total} Änderungen)`);
                    else console.log('📧 Keine Änderungen – keine Mail gesendet');
                }
            } catch (e) { console.error('❌ Änderungs-Check-Fehler:', e.message); }
        }));
    });

    // ── Wochenausblick: Sonntag 16:00 ────────────────────────────
    jobs.push(schedule.scheduleJob('0 16 * * 0', async () => {
        console.log(`\n📧 Wochenausblick-Mail: ${new Date().toLocaleString('de-DE')}`);
        try {
            const events = loadTimetableCache() || [];
            await sendWeeklyOverview(events);
        } catch (e) { console.error('❌ Wochenausblick-Fehler:', e.message); }
    }));

    console.log('Scheduler aktiv:');
    console.log('   Lernplan:       taeglich 07:00');
    console.log('   Stundenplan:    07:00 / 13:00 / 19:00');
    console.log('   Aenderungs-Mail: 06:00 / 21:00 (bei Aenderungen)');
    console.log('   Wochenausblick: Sonntag 16:00');
}

function stopScheduler() {
    jobs.forEach(j => j && j.cancel());
    jobs.length = 0;
}

module.exports = { startScheduler, stopScheduler };
