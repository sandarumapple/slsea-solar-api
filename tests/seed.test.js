const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
test('seed generates complete, related national data with local daylight and a week of samples', async () => {
  const docs = {};
  const names = [
    'Province',
    'District',
    'GridSubstation',
    'SolarInstallation',
    'GenerationReading',
    'User'
  ];
  const models = Object.fromEntries(
    names.map((name) => [
      name,
      {
        init: async () => {},
        exists: async () => null,
        deleteMany: async () => {},
        insertMany: async (rows) => {
          docs[name] = rows.map((row, index) => ({
            ...row,
            _id: `${name}-${index}`
          }));
          return docs[name];
        }
      }
    ])
  );
  await new Promise((resolve, reject) =>
    vm.runInNewContext(
      fs.readFileSync(require.resolve('../scripts/seed.js'), 'utf8'),
      {
        require: (name) =>
          name === 'dotenv'
            ? { config() {} }
            : name === 'bcryptjs'
              ? { hash: async () => 'hash' }
              : name.includes('config/db')
                ? async () => {}
                : name.includes('config/env')
                  ? () => {}
                  : models,
        console: { log() {}, error: reject },
        Date,
        Math,
        process: {
          env: { SEED_PASSWORD: 'test-only-seed-password-123' },
          argv: [],
          exit: (code) =>
            code ? reject(new Error(`Seed exit ${code}`)) : resolve()
        }
      }
    )
  );
  for (const [name, count] of [
    ['Province', 9],
    ['District', 25],
    ['GridSubstation', 25],
    ['SolarInstallation', 200],
    ['GenerationReading', 134600],
    ['User', 203]
  ])
    assert.equal(docs[name].length, count, name);
  const ids = (name) => new Set(docs[name].map((row) => row._id));
  for (const [child, parent, field] of [
    ['District', 'Province', 'province'],
    ['GridSubstation', 'District', 'district'],
    ['SolarInstallation', 'GridSubstation', 'substation'],
    ['GenerationReading', 'SolarInstallation', 'installation']
  ]) {
    const parents = ids(parent);
    assert.ok(docs[child].every((row) => parents.has(row[field])));
  }
  const counts = new Map();
  for (const reading of docs.GenerationReading) {
    counts.set(
      reading.installation,
      (counts.get(reading.installation) || 0) + 1
    );
    const hour =
      (reading.timestamp.getUTCHours() +
        reading.timestamp.getUTCMinutes() / 60 +
        5.5) %
      24;
    if (hour < 6 || hour > 18) assert.equal(reading.powerKw, 0);
  }
  assert.ok([...counts.values()].every((count) => count === 673));
  const first = docs.GenerationReading.slice(0, 673);
  for (let index = 1; index < first.length; index++) {
    assert.equal(first[index].timestamp - first[index - 1].timestamp, 900000);
    assert.ok(
      first[index].cumulativeEnergyKwh >= first[index - 1].cumulativeEnergyKwh
    );
  }
  assert.equal(first.at(-1).timestamp - first[0].timestamp, 7 * 24 * 3600000);
  assert.ok(Date.now() - first.at(-1).timestamp < 900000);
});

test('seed refuses to delete existing data without explicit reset', async () => {
  let deleted = false;
  let reason;
  const model = {
    init: async () => {}, exists: async () => ({ _id: 'existing' }),
    deleteMany: async () => { deleted = true; }
  };
  const models = Object.fromEntries(['Province','District','GridSubstation','SolarInstallation','GenerationReading','User'].map(name => [name, model]));
  await new Promise(resolve => vm.runInNewContext(
    fs.readFileSync(require.resolve('../scripts/seed.js'), 'utf8'), {
      require: name => name === 'dotenv' ? { config() {} } : name === 'bcryptjs' ? {} : name.includes('config/db') ? async () => {} : name.includes('config/env') ? () => {} : models,
      console: { log() {}, error(error) { reason = error.message; } },
      process: { env: { SEED_PASSWORD: 'test-only-seed-password-123' }, argv: [], exit: resolve }
    }
  ));
  assert.equal(deleted, false);
  assert.match(reason, /Nothing was deleted/);
});

test('seed rejects missing, known default and short passwords before connecting', async () => {
  for (const password of ['', 'DemoPass123!', 'short']) {
    let connected = false;
    let reason;
    await new Promise(resolve => vm.runInNewContext(fs.readFileSync(require.resolve('../scripts/seed.js'), 'utf8'), {
      require: name => name === 'dotenv' ? { config() {} } : name.includes('config/db') ? async () => { connected = true; } : {},
      console: { error(error) { reason = error.message; } },
      process: { env: { SEED_PASSWORD: password }, argv: [], exit: resolve }
    }));
    assert.equal(connected, false);
    assert.match(reason, /private SEED_PASSWORD/);
  }
});
