/**
 * Mail-Cleanup-Service
 * Löscht Mails im "Gesendet"-Ordner, die älter als 3 Monate sind.
 * Verbindet sich per IMAP mit dem Postfach stundenplan@lml-med.de.
 *
 * Benötigte Env-Variablen:
 *   IMAP_HOST  (default: mail.lml-med.de)
 *   IMAP_PORT  (default: 993)
 *   IMAP_USER  (default: stundenplan@lml-med.de)
 *   IMAP_PASS  (Passwort für das Postfach)
 */

const { ImapFlow } = require('imapflow');

async function cleanupSentFolder() {
    const host = process.env.IMAP_HOST || 'mail.lml-med.de';
    const port = parseInt(process.env.IMAP_PORT || '993');
    const user = process.env.IMAP_USER || 'stundenplan@lml-med.de';
    const pass = process.env.IMAP_PASS;

    if (!pass) {
        console.log('Mail-Cleanup: IMAP_PASS nicht konfiguriert, ueberspringe.');
        return;
    }

    const client = new ImapFlow({
        host,
        port,
        secure: port === 993,
        auth: { user, pass },
        logger: false
    });

    try {
        await client.connect();
        console.log(`Mail-Cleanup: Verbunden mit ${host}`);

        // Gesendet-Ordner suchen (verschiedene Bezeichnungen je Anbieter)
        const sentFolders = ['Sent', 'Gesendet', 'INBOX.Sent', 'Sent Messages', 'INBOX.Gesendet'];
        let sentFolder = null;

        for (const folder of sentFolders) {
            try {
                const status = await client.status(folder, { messages: true });
                if (status) { sentFolder = folder; break; }
            } catch { }
        }

        if (!sentFolder) {
            // Versuche alle Ordner zu listen und "sent" suchen
            const allFolders = [];
            for await (const folder of client.list()) {
                allFolders.push(folder.path);
            }
            sentFolder = allFolders.find(f =>
                f.toLowerCase().includes('sent') || f.toLowerCase().includes('gesendet')
            );
        }

        if (!sentFolder) {
            console.log('Mail-Cleanup: Kein Gesendet-Ordner gefunden.');
            await client.logout();
            return;
        }

        console.log(`Mail-Cleanup: Gesendet-Ordner gefunden: "${sentFolder}"`);
        await client.mailboxOpen(sentFolder);

        // Datum für "3 Monate vor heute"
        const threeMonthsAgo = new Date();
        threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);

        // Mails älter als 3 Monate suchen
        const uids = await client.search({ before: threeMonthsAgo });

        if (!uids || uids.length === 0) {
            console.log('Mail-Cleanup: Keine Mails aelter als 3 Monate gefunden.');
            await client.logout();
            return;
        }

        console.log(`Mail-Cleanup: ${uids.length} alte Mail(s) gefunden – werden geloescht.`);

        // In Papierkorb verschieben (falls vorhanden), sonst direkt loeschen
        const trashFolders = ['Trash', 'Geloeschte Elemente', 'INBOX.Trash', 'Deleted Messages', 'INBOX.Trash'];
        let trashFolder = null;

        for (const folder of trashFolders) {
            try {
                const status = await client.status(folder, { messages: true });
                if (status) { trashFolder = folder; break; }
            } catch { }
        }

        if (trashFolder) {
            await client.messageMove(uids, trashFolder, { uid: true });
            console.log(`Mail-Cleanup: ${uids.length} Mails in Papierkorb verschoben ("${trashFolder}").`);

            // Jetzt auch aus dem Papierkorb loeschen
            await client.mailboxOpen(trashFolder);
            const trashUids = await client.search({ before: threeMonthsAgo });
            if (trashUids && trashUids.length > 0) {
                await client.messageDelete(trashUids, { uid: true });
                console.log(`Mail-Cleanup: ${trashUids.length} Mails endgueltig aus Papierkorb geloescht.`);
            }
        } else {
            // Direkt als geloescht markieren und expungen
            await client.messageDelete(uids, { uid: true });
            console.log(`Mail-Cleanup: ${uids.length} Mails direkt geloescht (kein Papierkorb gefunden).`);
        }

        await client.logout();
        console.log('Mail-Cleanup: Abgeschlossen.');
    } catch (err) {
        console.warn(`Mail-Cleanup Fehler: ${err.message}`);
        try { await client.logout(); } catch { }
    }
}

module.exports = { cleanupSentFolder };
