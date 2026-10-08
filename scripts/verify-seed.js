// Full-size verification uses only a new disposable database, never Atlas.
const { MongoMemoryServer } = require('mongodb-memory-server');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { randomBytes } = require('node:crypto');
const run = promisify(execFile);
(async () => {
  const memory = await MongoMemoryServer.create();
  try {
    const env = {
      ...process.env, NODE_ENV: 'test',
      MONGODB_URI: memory.getUri('full_seed_verification'),
      JWT_SECRET: randomBytes(32).toString('hex'),
      SEED_PASSWORD: randomBytes(24).toString('hex')
    };
    for (const script of ['scripts/seed.js', 'scripts/verify-database.js']) {
      const { stdout } = await run(process.execPath, [script], { env, timeout: 180000 });
      process.stdout.write(stdout);
    }
  } finally { await memory.stop(); }
})().catch(error => {
  console.error(`Disposable seed verification failed (${error.name}).`);
  process.exitCode = 1;
});
