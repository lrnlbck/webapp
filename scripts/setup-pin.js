#!/usr/bin/env node
/**
 * Setup-Skript: Setzt den App-PIN und speichert den Hash in .env
 * Aufruf: npm run setup-pin
 */
const readline = require('readline');
const { setPinInEnv } = require('../src/auth');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

function ask(question) {
    return new Promise(resolve => rl.question(question, resolve));
}

async function main() {
    console.log('\n🔐 Uni Tübingen Lernplan – PIN Setup\n');
    const pin = await ask('Gib deinen gewünschten PIN ein (nur Ziffern): ');

    if (!/^\d{4,8}$/.test(pin)) {
        console.error('❌ PIN muss 4-8 Ziffern lang sein!');
        process.exit(1);
    }

    const confirm = await ask('PIN bestätigen: ');
    if (pin !== confirm) {
        console.error('❌ PINs stimmen nicht überein!');
        process.exit(1);
    }

    const hash = await setPinInEnv(pin);
    console.log('\n✅ PIN erfolgreich gesetzt und verschlüsselt in .env gespeichert!');
    console.log('🚀 Starte die App mit: npm start\n');
    rl.close();
}

main().catch(err => {
    console.error('Fehler:', err);
    process.exit(1);
});
