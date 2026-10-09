// Explicit offline provisioning: never called by startup or seed; never resets data.
require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const { User } = require('../src/models');
async function provision({ name, email, password }) {
  if (!name?.trim() || !email?.trim() || !password || password.length < 16)
    throw new Error('Provide name, email and a unique password of at least 16 characters');
  // create only: a duplicate email fails instead of elevating an existing account.
  return User.create({ name: name.trim(), email: email.trim(), passwordHash: await bcrypt.hash(password, 12), role: 'SYSTEM_ADMIN', jurisdictionType: 'NATIONAL' });
}
async function main() {
  require('../src/config/env')({ requireDatabase: true });
  const { Writable } = require('node:stream');
  const readline = require('node:readline/promises');
  if (!process.stdin.isTTY) throw new Error('Run interactively in a trusted terminal');
  let muted = false;
  const output = new Writable({ write(chunk, encoding, callback) { if (!muted) process.stdout.write(chunk); callback(); } });
  const prompt = readline.createInterface({ input: process.stdin, output, terminal: true });
  let name, email, password;
  try {
    name = await prompt.question('Management account name: ');
    email = await prompt.question('New account email: ');
    process.stdout.write('New unique password (hidden, minimum 16 characters): ');
    muted = true;
    password = await prompt.question('');
  } finally { muted = false; prompt.close(); process.stdout.write('\n'); }
  await mongoose.connect(process.env.MONGODB_URI);
  try { await provision({ name, email, password }); process.stdout.write('SYSTEM_ADMIN account created. Existing accounts and data preserved.\n'); }
  finally { await mongoose.disconnect(); }
}
if (require.main === module) main().catch(() => { console.error('Provisioning failed. Check input, connection and whether the email already exists.'); process.exitCode = 1; });
module.exports = { provision };
