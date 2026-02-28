const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');

const ENV_PATH = path.join(__dirname, '..', '.env');

async function hashPin(pin) {
  const salt = await bcrypt.genSalt(12);
  return bcrypt.hash(pin, salt);
}

async function verifyPin(pin, hash) {
  if (process.env.APP_PIN && process.env.APP_PIN.trim() !== '') {
    return pin === process.env.APP_PIN;
  }
  if (!hash) return false;
  return bcrypt.compare(pin, hash);
}

async function setPinInEnv(pin) {
  const hash = await hashPin(pin);
  let envContent = '';
  if (fs.existsSync(ENV_PATH)) {
    envContent = fs.readFileSync(ENV_PATH, 'utf8');
  }

  if (envContent.includes('PIN_HASH=')) {
    envContent = envContent.replace(/PIN_HASH=.*/g, `PIN_HASH=${hash}`);
  } else {
    envContent += `\nPIN_HASH=${hash}`;
  }

  fs.writeFileSync(ENV_PATH, envContent);
  process.env.PIN_HASH = hash;
  return hash;
}

module.exports = { hashPin, verifyPin, setPinInEnv };
