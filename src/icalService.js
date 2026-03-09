/**
 * iCal Feed Generator
 * Erzeugt einen .ics-Feed für Apple Kalender / Google Calendar / Outlook
 * Enthält Stundenplan + Lernplan-Prüfungen
 */

function escIcal(str = '') {
    return String(str)
        .replace(/\\/g, '\\\\')
        .replace(/;/g, '\\;')
        .replace(/,/g, '\\,')
        .replace(/\n/g, '\\n');
}

function dtFormat(dateStr, timeStr) {
    // dateStr: ISO string  timeStr: 'HH:MM'
    const d = new Date(dateStr);
    if (timeStr && /^\d{2}:\d{2}$/.test(timeStr)) {
        const [h, m] = timeStr.split(':').map(Number);
        d.setHours(h, m, 0, 0);
    }
    // Format: 20260420T090000Z  (UTC)
    const pad = n => String(n).padStart(2, '0');
    return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}00Z`;
}

function uid(event) {
    const base = (event.id || event.title || '') + (event.date || '');
    return base.replace(/[^a-zA-Z0-9]/g, '') + '@tuetool.app';
}

/**
 * Generate iCal (.ics) string from timetable events + exam events
 */
function generateIcal(timetableEvents = [], lernplanExams = []) {
    const lines = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//TüTool//Uni Tübingen//DE',
        'X-WR-CALNAME:TüTool – Stundenplan',
        'X-WR-TIMEZONE:Europe/Berlin',
        'CALSCALE:GREGORIAN',
        'METHOD:PUBLISH',
    ];

    const addEvent = ({ id, date, timeFrom, timeTo, title, location, lecturer, mandatory, description, url }) => {
        const dtstart = dtFormat(date, timeFrom);
        const dtend = timeTo ? dtFormat(date, timeTo) : dtFormat(date, timeFrom);
        const desc = [
            location ? `Ort: ${location}` : '',
            lecturer ? `Dozent: ${lecturer}` : '',
            mandatory ? 'Pflichtveranstaltung' : '',
            description || ''
        ].filter(Boolean).join(' | ');

        lines.push(
            'BEGIN:VEVENT',
            `UID:${uid({ id, date, title })}`,
            `DTSTAMP:${dtFormat(new Date().toISOString(), null)}`,
            `DTSTART:${dtstart}`,
            `DTEND:${dtend}`,
            `SUMMARY:${escIcal(title)}`,
            location ? `LOCATION:${escIcal(location)}` : null,
            url ? `URL:${url}` : null,
            desc ? `DESCRIPTION:${escIcal(desc)}` : null,
            mandatory ? 'CATEGORIES:Pflicht' : null,
            'END:VEVENT'
        ).filter(x => x !== null);
    };

    // Stundenplan events
    for (const e of timetableEvents) {
        try { addEvent(e); } catch { }
    }

    // Lernplan: Prüfungstermine
    for (const exam of lernplanExams) {
        if (exam.status !== 'upcoming') continue;
        try {
            const mapsUrl = exam.location
                ? `https://maps.google.com/maps?q=${encodeURIComponent(exam.location)}`
                : null;
            addEvent({
                id: exam.id,
                date: exam.examDate,
                timeFrom: '08:00',
                timeTo: '12:00',
                title: `Pruefung: ${exam.subject}`,
                location: exam.location || '',
                url: mapsUrl,
                description: `Themen: ${(exam.selectedTopics || []).join(', ')}`,
                mandatory: true
            });
        } catch { }

        // Lernblöcke
        for (const block of (exam.learnBlocks || [])) {
            try {
                addEvent({
                    id: block.id,
                    date: block.date,
                    timeFrom: block.timeFrom,
                    timeTo: block.timeTo,
                    title: block.title,
                    description: (block.topics || []).join(', ')
                });
            } catch { }
        }
    }

    lines.push('END:VCALENDAR');
    return lines.join('\r\n');
}

module.exports = { generateIcal };
