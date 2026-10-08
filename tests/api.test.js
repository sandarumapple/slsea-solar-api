const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const { MongoMemoryServer } = require('mongodb-memory-server');
process.env.JWT_SECRET = 'test-only-secret-with-at-least-32-characters';
process.env.NODE_ENV = 'test';
const app = require('../src/app');
const models = require('../src/models');
const {
  Province,
  District,
  GridSubstation,
  SolarInstallation,
  GenerationReading,
  User
} = models;
let memory, server, base;
let p1, p2, d1, d2, d3, s1, s2, s3, i1, i2, i3, r1;
const tokens = {};

async function request(
  path,
  { role = 'admin', method = 'GET', body, headers = {} } = {}
) {
  const response = await fetch(`${base}/api${path}`, {
    method,
    headers: {
      ...(tokens[role] ? { Authorization: `Bearer ${tokens[role]}` } : {}),
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...headers
    },
    ...(body !== undefined
      ? { body: typeof body === 'string' ? body : JSON.stringify(body) }
      : {})
  });
  const text = await response.text();
  require('./helpers/contract')(path, method, response.status, text ? JSON.parse(text) : null);
  return {
    status: response.status,
    headers: response.headers,
    text,
    body: text ? JSON.parse(text) : null
  };
}

before(
  async () => {
    memory = await MongoMemoryServer.create({
      instance: { dbName: 'coursework_integration_test' }
    });
    await mongoose.connect(memory.getUri());
    await Promise.all(Object.values(models).map((model) => model.init()));
    [p1, p2] = await Province.create([
      { name: 'Western', code: 'P1' },
      { name: 'Central', code: 'P2' }
    ]);
    [d1, d2, d3] = await District.create([
      { name: 'Colombo', province: p1._id },
      { name: 'Gampaha', province: p1._id },
      { name: 'Kandy', province: p2._id }
    ]);
    [s1, s2, s3] = await GridSubstation.create(
      [d1, d2, d3].map((d, i) => ({
        name: `Grid ${i}`,
        code: `SS${i}`,
        district: d._id
      }))
    );
    [i1, i2, i3] = await SolarInstallation.create(
      [s1, s2, s3].map((s, i) => ({
        installationId: `SL-${i}`,
        ownerName: `Owner ${i}`,
        meterId: `Meter-${i}`,
        capacityKw: 5,
        substation: s._id
      }))
    );
    const time = Date.now() - 3600000;
    [r1] = await GenerationReading.create(
      [i1, i2, i3].flatMap((ins, n) =>
        [0, 1, 2].map((q) => ({
          installation: ins._id,
          timestamp: new Date(time + q * 900000),
          powerKw: n + 1,
          cumulativeEnergyKwh: 100 + q,
          voltage: 230
        }))
      )
    );
    const passwordHash = await bcrypt.hash('TestPass123!', 4);
    await User.create(
      [
        {
          name: 'Admin',
          email: 'admin@test.lk',
          role: 'ADMIN',
          jurisdictionType: 'NATIONAL'
        },
        {
          name: 'Province',
          email: 'province@test.lk',
          role: 'PROVINCE_OFFICER',
          jurisdictionType: 'PROVINCE',
          jurisdictionRef: p1._id,
          jurisdictionModel: 'Province'
        },
        {
          name: 'District',
          email: 'district@test.lk',
          role: 'DISTRICT_OFFICER',
          jurisdictionType: 'DISTRICT',
          jurisdictionRef: d1._id,
          jurisdictionModel: 'District'
        },
        {
          name: 'Substation',
          email: 'substation@test.lk',
          role: 'SUBSTATION_OFFICER',
          jurisdictionType: 'SUBSTATION',
          jurisdictionRef: s1._id,
          jurisdictionModel: 'GridSubstation'
        },
        {
          name: 'Device',
          email: 'device@test.lk',
          role: 'DEVICE',
          jurisdictionType: 'INSTALLATION',
          jurisdictionRef: i1._id,
          jurisdictionModel: 'SolarInstallation'
        }
      ].map((user) => ({ ...user, passwordHash }))
    );
    server = await new Promise((resolve) => {
      const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
    });
    base = `http://127.0.0.1:${server.address().port}`;
    for (const role of [
      'admin',
      'province',
      'district',
      'substation',
      'device'
    ]) {
      const result = await request('/auth/login', {
        role: 'none',
        method: 'POST',
        body: { email: `${role}@test.lk`, password: 'TestPass123!' }
      });
      assert.equal(result.status, 200);
      tokens[role] = result.body.token;
    }
  },
  { timeout: 180000 }
);

after(async () => {
  if (server)
    await new Promise((resolve) => {
      server.close(resolve);
      server.closeAllConnections();
    });
  await mongoose.disconnect();
  if (memory) await memory.stop();
});

test('health, JSON specification and Swagger are available', async () => {
  assert.equal((await fetch(`${base}/health`)).status, 200);
  assert.equal((await fetch(`${base}/api/docs/`)).status, 200);
  assert.equal((await request('/openapi.json')).body.openapi, '3.0.3');
});
test('authentication rejects missing, bad and inactive tokens', async () => {
  assert.equal((await request('/provinces', { role: 'none' })).status, 401);
  assert.equal(
    (
      await request('/provinces', {
        headers: { Authorization: 'Bearer invalid' }
      })
    ).status,
    401
  );
  await User.updateOne({ email: 'district@test.lk' }, { active: false });
  assert.equal((await request('/provinces', { role: 'district' })).status, 401);
  await User.updateOne({ email: 'district@test.lk' }, { active: true });
});
test('invalid credentials and malformed input have consistent client errors', async () => {
  for (const [body, status] of [
    [{ email: 'admin@test.lk', password: 'wrong' }, 401],
    [{ email: 12, password: 'anything' }, 400],
    ['{"bad":', 400],
    [{}, 400]
  ]) {
    const result = await request('/auth/login', { method: 'POST', body });
    assert.equal(result.status, status);
    for (const key of ['code', 'message', 'detail'])
      assert.equal(typeof result.body[key], 'string');
  }
});
test('media negotiation and size limits return client errors', async () => {
  assert.equal(
    (await request('/provinces', { headers: { Accept: 'text/html' } })).status,
    406
  );
  assert.equal(
    (
      await request('/auth/login', {
        method: 'POST',
        body: 'hello',
        headers: { 'Content-Type': 'text/plain' }
      })
    ).status,
    415
  );
  assert.equal(
    (
      await request('/auth/login', {
        method: 'POST',
        body: { data: 'x'.repeat(110000) }
      })
    ).status,
    413
  );
});
test('district users cannot list sibling districts or access their resources', async () => {
  const districts = await request(`/provinces/${p1.id}/districts`, {
    role: 'district'
  });
  assert.deepEqual(
    districts.body.map((d) => d._id),
    [d1.id]
  );
  for (const path of [
    `/districts/${d2.id}`,
    `/districts/${d2.id}/substations`,
    `/districts/${d2.id}/generation-summary`,
    `/substations/${s2.id}`,
    `/installations/${i2.id}`,
    `/installations/${i2.id}/readings`
  ])
    assert.equal((await request(path, { role: 'district' })).status, 403);
});
test('province and substation users see exactly their hierarchy', async () => {
  assert.equal(
    (await request(`/provinces/${p1.id}/districts`, { role: 'province' })).body
      .length,
    2
  );
  assert.equal(
    (await request(`/installations/${i3.id}`, { role: 'province' })).status,
    403
  );
  assert.deepEqual(
    (await request('/provinces', { role: 'substation' })).body.map(
      (p) => p._id
    ),
    [p1.id]
  );
  assert.deepEqual(
    (
      await request(`/provinces/${p1.id}/districts`, { role: 'substation' })
    ).body.map((d) => d._id),
    [d1.id]
  );
  assert.equal(
    (await request(`/installations/${i1.id}`, { role: 'substation' })).status,
    200
  );
  assert.equal(
    (await request(`/installations/${i2.id}`, { role: 'substation' })).status,
    403
  );
});
test('devices cannot use any reader endpoint', async () => {
  for (const path of [
    '/provinces',
    '/readings',
    `/installations/${i1.id}`,
    `/installations/${i1.id}/last-reading`,
    `/installations/${i1.id}/readings`,
    `/installations/${i1.id}/readings/${r1.id}`
  ])
    assert.equal((await request(path, { role: 'device' })).status, 403);
});
test('readers cannot ingest and devices cannot write other installations', async () => {
  const body = {
    timestamp: new Date().toISOString(),
    powerKw: 2,
    cumulativeEnergyKwh: 110,
    voltage: 230
  };
  assert.equal(
    (
      await request(`/installations/${i1.id}/readings`, {
        method: 'POST',
        body
      })
    ).status,
    403
  );
  assert.equal(
    (
      await request(`/installations/${i2.id}/readings`, {
        role: 'device',
        method: 'POST',
        body
      })
    ).status,
    403
  );
});
test('ingestion creates retrievable Location; duplicate and mutation are rejected', async () => {
  const body = {
    timestamp: new Date().toISOString(),
    powerKw: 2,
    cumulativeEnergyKwh: 110,
    voltage: 230
  };
  const path = `/installations/${i1.id}/readings`;
  const created = await request(path, { role: 'device', method: 'POST', body });
  assert.equal(created.status, 201);
  const location = created.headers.get('location').replace(/^\/api/, '');
  assert.equal((await request(location)).body._id, created.body._id);
  assert.equal(
    (await request(`/installations/${i2.id}/readings/${created.body._id}`))
      .status,
    404
  );
  assert.equal(
    (await request(path, { role: 'device', method: 'POST', body })).status,
    409
  );
  for (const method of ['PUT', 'PATCH', 'DELETE'])
    assert.equal(
      (
        await request(location, {
          method,
          ...(method === 'DELETE' ? {} : { body: {} })
        })
      ).status,
      405
    );
});
test('reading validation and inactive installation protection', async () => {
  const body = {
    timestamp: new Date().toISOString(),
    powerKw: 2,
    cumulativeEnergyKwh: 110,
    voltage: 230
  };
  const path = `/installations/${i1.id}/readings`;
  for (const change of [
    { powerKw: 20 },
    { voltage: 20 },
    { cumulativeEnergyKwh: -1 },
    { powerKw: '2' },
    { timestamp: 'bad' },
    { timestamp: new Date(Date.now() + 86400000).toISOString() }
  ])
    assert.equal(
      (
        await request(path, {
          role: 'device',
          method: 'POST',
          body: { ...body, ...change }
        })
      ).status,
      400
    );
  await SolarInstallation.updateOne({ _id: i1._id }, { active: false });
  assert.equal(
    (await request(path, { role: 'device', method: 'POST', body })).status,
    403
  );
  await SolarInstallation.updateOne({ _id: i1._id }, { active: true });
});
test('history pagination, sorting, date windows and regional scopes', async () => {
  const path = `/installations/${i1.id}/readings`;
  const result = await request(`${path}?pageSize=2&order=asc`);
  assert.equal(result.body.data.length, 2);
  assert.ok(result.body.pagination.totalCount >= 3);
  assert.ok(result.body.links.next.includes('page=2'));
  assert.equal(result.body.links.previous, null);
  assert.ok(result.body.data[0].timestamp <= result.body.data[1].timestamp);
  const filtered = await request(
    `/readings?provinceId=${p1.id}&districtId=${d1.id}&substationId=${s1.id}`
  );
  assert.ok(filtered.body.data.every((r) => r.installation === i1.id));
  assert.ok(
    (await request('/readings', { role: 'district' })).body.data.every(
      (r) => r.installation === i1.id
    )
  );
  assert.equal(
    (await request(`/readings?districtId=${d2.id}`, { role: 'district' }))
      .status,
    403
  );
  const since = new Date(Date.now() - 1000).toISOString();
  const recent = await request(`${path}?from=${encodeURIComponent(since)}`);
  assert.ok(recent.body.data.every((r) => r.timestamp >= since));
});
test('invalid queries and identifiers return 400; missing resources return 404', async () => {
  for (const query of [
    'page=1.5',
    'page=Infinity',
    'page=-1',
    'pageSize=0',
    'order=wrong',
    'from=bad',
    'from=2026-10-02T00:00:00Z&to=2026-10-01T00:00:00Z',
    'unknown=1',
    'districtId=bad'
  ])
    assert.equal((await request(`/readings?${query}`)).status, 400, query);
  assert.equal((await request('/districts/bad')).status, 400);
  assert.equal(
    (await request(`/districts/${new mongoose.Types.ObjectId()}`)).status,
    404
  );
});
test('ETag conditional GET works for collections, composites, history, summary and latest reading', async () => {
  for (const path of [
    '/provinces',
    `/provinces/${p1.id}/districts`,
    `/installations/${i1.id}`,
    `/installations/${i1.id}/last-reading`,
    `/installations/${i1.id}/readings`,
    '/readings',
    `/districts/${d1.id}/generation-summary`
  ]) {
    const first = await request(path);
    assert.equal(first.status, 200, path);
    const second = await request(path, {
      headers: { 'If-None-Match': `"other", W/${first.headers.get('etag')}` }
    });
    assert.equal(second.status, 304, path);
    assert.equal(second.text, '');
  }
});
test('new reading invalidates composite and history ETags', async () => {
  const composite = `/installations/${i1.id}`;
  const history = `${composite}/readings`;
  const oldComposite = await request(composite);
  const oldHistory = await request(history);
  await GenerationReading.create({
    installation: i1._id,
    timestamp: new Date(Date.now() + 1000),
    powerKw: 3,
    cumulativeEnergyKwh: 111,
    voltage: 230
  });
  assert.equal(
    (
      await request(composite, {
        headers: { 'If-None-Match': oldComposite.headers.get('etag') }
      })
    ).status,
    200
  );
  assert.equal(
    (
      await request(history, {
        headers: { 'If-None-Match': oldHistory.headers.get('etag') }
      })
    ).status,
    200
  );
});
test('summary returns scoped power and explicitly estimated daily energy', async () => {
  const result = await request(`/districts/${d1.id}/generation-summary`);
  assert.equal(result.status, 200);
  assert.equal(result.body.activeInstallations, 1);
  assert.equal(result.body.timezone, 'Asia/Colombo');
  assert.ok(Number.isFinite(result.body.todayEstimatedEnergyKwh));
});
test('Swagger documents every explicit GET and POST route and its path parameters', async () => {
  const spec = require('../src/docs/swagger');
  await require('@apidevtools/swagger-parser').validate(
    JSON.parse(JSON.stringify(spec))
  );
  const router = require('../src/routes');
  for (const layer of router.stack) {
    if (!layer.route || layer.route.methods._all) continue;
    const path = layer.route.path.replace(/:(\w+)/g, '{$1}');
    for (const method of Object.keys(layer.route.methods)) {
      const operation = spec.paths[path]?.[method];
      assert.ok(operation, `${method} ${path}`);
      for (const match of path.matchAll(/\{(\w+)\}/g))
        assert.ok(
          [
            ...(spec.paths[path].parameters || []),
            ...(operation.parameters || [])
          ].some((p) => p.in === 'path' && p.name === match[1] && p.required)
        );
    }
  }
});

test('HTTP preconditions distinguish 412 from cache validation and duplicate conflicts', async () => {
  const path = `/installations/${i1.id}`;
  const first = await request(path);
  const etag = first.headers.get('etag');
  assert.equal((await request(path, { headers: { 'If-Match': etag } })).status, 200);
  for (const value of ['"stale"', `W/${etag}`]) {
    const rejected = await request(path, { headers: { 'If-Match': value, 'If-None-Match': etag } });
    assert.equal(rejected.status, 412);
    assert.equal(rejected.body.code, 'PRECONDITION_FAILED');
  }
  assert.equal((await request(path, { headers: { 'If-Unmodified-Since': 'Sat, 01 Jan 2000 00:00:00 GMT' } })).status, 412);
  assert.equal((await request(path, { headers: { 'If-Match': etag, 'If-Unmodified-Since': 'Sat, 01 Jan 2000 00:00:00 GMT' } })).status, 200);
});

test('bearer failures advertise the authentication scheme and never cache', async () => {
  const response = await request('/provinces', { role: 'none' });
  assert.equal(response.headers.get('www-authenticate'), 'Bearer realm="solar-api"');
  assert.equal(response.headers.get('cache-control'), 'no-store');
});

test('older ingestion preserves latest measurement and remains visible in history', async () => {
  const path = `/installations/${i1.id}`;
  const latest = await request(`${path}/last-reading`);
  const created = await request(`${path}/readings`, { role: 'device', method: 'POST', body: {
    timestamp: new Date(Date.now() - 86400000).toISOString(), powerKw: 1, cumulativeEnergyKwh: 50, voltage: 230
  } });
  assert.equal(created.status, 201);
  assert.equal((await request(`${path}/last-reading`)).body._id, latest.body._id);
  assert.equal((await request(created.headers.get('location').replace(/^\/api/, ''))).status, 200);
});

test('deployment verifier exercises login, protected history and conditional GET', async () => {
  const { promisify } = require('node:util');
  const { execFile } = require('node:child_process');
  const path = require('node:path');
  const { stdout } = await promisify(execFile)(process.execPath, ['scripts/smoke.js'], {
    cwd: path.resolve(__dirname, '..'),
    env: { ...process.env, API_BASE_URL: base, SMOKE_ALLOW_LOCAL_HTTP: 'true', SMOKE_EMAIL: 'admin@test.lk', SMOKE_PASSWORD: 'TestPass123!' }
  });
  assert.match(stdout, /PASS reader login, seeded provinces\/history and empty conditional 304/);
});

test('uppercase geographic filters preserve scope and match lowercase results', async () => {
  for (const [name, id, role] of [['provinceId', p1.id, 'province'], ['districtId', d1.id, 'district'], ['substationId', s1.id, 'substation']]) {
    const lower = await request(`/readings?${name}=${id}`, { role });
    const upper = await request(`/readings?${name}=${id.toUpperCase()}`, { role });
    assert.equal(upper.status, 200);
    assert.deepEqual(upper.body.data, lower.body.data);
  }
  assert.equal((await request(`/readings?districtId=${d2.id.toUpperCase()}`, { role: 'district' })).status, 403);
});

test('unknown routes use the common non-cacheable error contract', async () => {
  const result = await request('/does-not-exist');
  assert.equal(result.status, 404);
  assert.equal(result.headers.get('cache-control'), 'no-store');
  assert.deepEqual(Object.keys(result.body), ['code', 'message', 'detail']);
});

test('summary integrates irregular intervals, clips midnight and excludes stale/inactive/future samples', async (t) => {
  const offset = 330 * 60000;
  const start = Math.floor((Date.now() + offset) / 86400000) * 86400000 - offset;
  const now = start + 12 * 3600000;
  t.mock.method(Date, 'now', () => now);
  const admin = await User.findOne({ role: 'ADMIN' });
  const token = require('jsonwebtoken').sign({}, process.env.JWT_SECRET, { subject: admin.id, expiresIn: '1h' });
  const district = await District.create({ name: 'Summary fixture', province: p1._id });
  const sub = await GridSubstation.create({ name: 'Summary grid', code: 'SUMMARY-TEST', district: district._id });
  const installations = await SolarInstallation.create([0, 1, 2].map(n => ({
    installationId: `SUMMARY-${n}`, meterId: `SUMMARY-METER-${n}`, ownerName: 'Test', capacityKw: 10,
    substation: sub._id, active: n !== 2
  })));
  const [fresh, stale, inactive] = installations;
  const rows = [
    [fresh, start - 10 * 60000, 6], // Midnight clipping: 6 kW for 10 minutes = 1 kWh.
    [fresh, start + 10 * 60000, 2], // 30-minute cap = 1 kWh.
    [fresh, now - 20 * 60000, 3], // 10 minutes = 0.5 kWh.
    [fresh, now - 10 * 60000, 6], // 10 minutes to now = 1 kWh.
    [fresh, now + 60000, 10], // Future sample ignored.
    [stale, now - 2 * 3600000, 4], // Energy 2 kWh, no current power.
    [inactive, now - 10 * 60000, 10] // Completely excluded.
  ];
  await GenerationReading.create(rows.map(([installation, time, powerKw]) => ({
    installation: installation._id, timestamp: new Date(time), powerKw, cumulativeEnergyKwh: 100, voltage: 230
  })));
  try {
    const result = await request(`/districts/${district.id}/generation-summary`, { headers: { Authorization: `Bearer ${token}` } });
    assert.equal(result.status, 200);
    assert.equal(result.body.currentTotalPowerKw, 6);
    assert.equal(result.body.todayEstimatedEnergyKwh, 5.5);
    assert.equal(result.body.activeInstallations, 2);
    assert.equal(result.body.reportingInstallations, 1);
    assert.equal(result.headers.get('last-modified'), null);
  } finally {
    await GenerationReading.deleteMany({ installation: { $in: installations.map(i => i._id) } });
    await SolarInstallation.deleteMany({ substation: sub._id });
    await GridSubstation.deleteOne({ _id: sub._id });
    await District.deleteOne({ _id: district._id });
  }
});

test('history navigation covers first, middle, last, empty and out-of-range pages with combined filters', async () => {
  const rows = await GenerationReading.find({ installation: i2._id }).sort({ timestamp: 1 }).lean();
  assert.equal(rows.length, 3);
  const query = new URLSearchParams({ provinceId: p1.id, districtId: d2.id, substationId: s2.id,
    from: rows[0].timestamp.toISOString(), to: rows[2].timestamp.toISOString(), order: 'asc', pageSize: '1' });
  let path = `/readings?${query}`;
  for (let page = 1; page <= 3; page++) {
    const result = await request(path);
    assert.equal(result.status, 200);
    assert.deepEqual(result.body.pagination, { page, pageSize: 1, totalCount: 3, totalPages: 3 });
    assert.equal(result.body.data[0]._id, String(rows[page - 1]._id));
    assert.equal(result.body.links.previous === null, page === 1);
    assert.equal(result.body.links.next === null, page === 3);
    if (page > 1) {
      const previous = await request(result.body.links.previous.replace(/^\/api/, ''));
      assert.equal(previous.body.data[0]._id, String(rows[page - 2]._id));
    }
    if (page < 3) path = result.body.links.next.replace(/^\/api/, '');
  }
  query.set('order', 'desc'); query.set('pageSize', '3');
  const descending = await request(`/readings?${query}`);
  assert.deepEqual(descending.body.data.map(r => r._id), rows.map(r => String(r._id)).reverse());
  query.set('page', '2');
  const outside = await request(`/readings?${query}`);
  assert.equal(outside.status, 200);
  assert.deepEqual(outside.body.data, []);
  assert.equal(outside.body.links.next, null);
  query.set('page', '1'); query.set('from', '2000-01-01T00:00:00Z'); query.set('to', '2000-01-02T00:00:00Z');
  const empty = await request(`/readings?${query}`);
  assert.equal(empty.body.pagination.totalCount, 0);
  assert.deepEqual(empty.body.data, []);
  assert.equal(empty.body.links.next, null);
  assert.equal(empty.body.links.previous, null);
});

test('expired, wrong-signature and disallowed-algorithm JWTs cannot authenticate', async () => {
  const jwt = require('jsonwebtoken');
  const user = await User.findOne({ role: 'ADMIN' });
  const options = { subject: user.id, expiresIn: '1h' };
  for (const token of [
    jwt.sign({}, process.env.JWT_SECRET, { ...options, expiresIn: -1 }),
    jwt.sign({}, 'another-test-secret-with-at-least-32-characters', options),
    jwt.sign({}, process.env.JWT_SECRET, { ...options, algorithm: 'HS384' })
  ]) {
    const result = await request('/provinces', { headers: { Authorization: `Bearer ${token}` } });
    assert.equal(result.status, 401);
    assert.equal(result.headers.get('cache-control'), 'no-store');
    assert.match(result.headers.get('www-authenticate'), /Bearer/);
  }
});

test('dated resource validators return empty 304 and respect ETag precedence', async () => {
  const province = await Province.create({ name: 'Cache fixture', code: 'CACHE-TEST' });
  // Isolate an old persisted representation rather than sleeping on wall-clock seconds.
  await Province.collection.updateOne({ _id: province._id }, { $set: {
    createdAt: new Date('2020-01-01T00:00:00Z'), updatedAt: new Date('2020-01-01T00:00:00Z')
  } });
  try {
    const path = `/provinces/${province.id}`;
    const first = await request(path);
    assert.match(first.headers.get('content-type'), /application\/json/);
    assert.equal(first.headers.get('cache-control'), 'private, no-cache');
    assert.match(first.headers.get('vary'), /Authorization/);
    assert.match(first.headers.get('etag'), /^"[a-f0-9]{64}"$/);
    const headers = { 'If-Modified-Since': first.headers.get('last-modified') };
    const cached = await request(path, { headers });
    assert.equal(cached.status, 304); assert.equal(cached.text, '');
    const changed = await request(path, { headers: { ...headers, 'If-None-Match': '"different"' } });
    assert.equal(changed.status, 200);
  } finally { await Province.deleteOne({ _id: province._id }); }
});

test('summary handles an installation without data and recomputes after late observations', async (t) => {
  const offset = 330 * 60000;
  const midnight = Math.floor((Date.now() + offset) / 86400000) * 86400000 - offset;
  const now = midnight + 12 * 3600000;
  t.mock.method(Date, 'now', () => now);
  const user = await User.findOne({ role: 'ADMIN' });
  const token = require('jsonwebtoken').sign({}, process.env.JWT_SECRET, { subject: user.id, expiresIn: '1h' });
  const headers = { Authorization: `Bearer ${token}` };
  const district = await District.create({ name: 'Empty summary', province: p1._id });
  const sub = await GridSubstation.create({ name: 'Empty grid', code: 'EMPTY-SUMMARY', district: district._id });
  const installation = await SolarInstallation.create({ installationId: 'EMPTY-SUMMARY', meterId: 'EMPTY-SUMMARY', ownerName: 'Test', capacityKw: 10, substation: sub._id });
  const path = `/districts/${district.id}/generation-summary`;
  try {
    const empty = await request(path, { headers });
    assert.equal(empty.body.activeInstallations, 1);
    assert.equal(empty.body.reportingInstallations, 0);
    assert.equal(empty.body.currentTotalPowerKw, 0);
    assert.equal(empty.body.todayEstimatedEnergyKwh, 0);
    const add = (minutes, powerKw) => GenerationReading.create({ installation: installation._id,
      timestamp: new Date(now - minutes * 60000), powerKw, cumulativeEnergyKwh: 100, voltage: 230 });
    await add(10, 6);
    const latest = await request(path, { headers });
    assert.equal(latest.body.todayEstimatedEnergyKwh, 1);
    await add(20, 3);
    const late = await request(path, { headers: { ...headers, 'If-None-Match': latest.headers.get('etag') } });
    assert.equal(late.status, 200);
    assert.equal(late.body.currentTotalPowerKw, 6);
    assert.equal(late.body.todayEstimatedEnergyKwh, 1.5);
  } finally {
    await GenerationReading.deleteMany({ installation: installation._id });
    await SolarInstallation.deleteOne({ _id: installation._id });
    await GridSubstation.deleteOne({ _id: sub._id });
    await District.deleteOne({ _id: district._id });
  }
});

test('reader context derives assigned geography and ancestors without an ID or password fields', async () => {
  for (const [role, type, id] of [
    ['province', 'PROVINCE', p1.id],
    ['district', 'DISTRICT', d1.id],
    ['substation', 'SUBSTATION', s1.id]
  ]) {
    const result = await request('/me', { role });
    assert.equal(result.status, 200);
    assert.equal(result.body.jurisdiction.type, type);
    assert.equal(result.body.jurisdiction.resource._id, id);
    assert.deepEqual(Object.keys(result.body.user).sort(), ['id', 'jurisdictionType', 'name', 'role']);
    assert.ok(!JSON.stringify(result.body).includes('passwordHash'));
    assert.equal(result.body.links.districts, '/api/districts');
    if (role === 'district') assert.equal(result.body.jurisdiction.resource.province._id, p1.id);
    if (role === 'substation') {
      assert.equal(result.body.jurisdiction.resource.district._id, d1.id);
      assert.equal(result.body.jurisdiction.resource.district.province._id, p1.id);
    }
  }
  const national = await request('/me');
  assert.equal(national.body.jurisdiction.type, 'NATIONAL');
  assert.equal(national.body.jurisdiction.resource, null);
});

test('top-level geographic collections automatically intersect national, province, district and substation scopes', async () => {
  const expectations = {
    admin: [[p1.id, p2.id], [d1.id, d2.id, d3.id], [s1.id, s2.id, s3.id], [i1.id, i2.id, i3.id]],
    province: [[p1.id], [d1.id, d2.id], [s1.id, s2.id], [i1.id, i2.id]],
    district: [[p1.id], [d1.id], [s1.id], [i1.id]],
    substation: [[p1.id], [d1.id], [s1.id], [i1.id]]
  };
  for (const [role, expected] of Object.entries(expectations)) {
    for (const [index, path] of ['/provinces', '/districts', '/substations', '/installations'].entries()) {
      const result = await request(path, { role });
      assert.equal(result.status, 200, `${role} ${path}`);
      assert.deepEqual(result.body.map(item => item._id).sort(), [...expected[index]].sort(), `${role} ${path}`);
    }
  }
});

test('automatic scope endpoints require readers and reject attempted query overrides and mutation', async () => {
  for (const path of ['/me', '/districts', '/substations', '/installations']) {
    assert.equal((await request(path, { role: 'none' })).status, 401);
    assert.equal((await request(path, { role: 'device' })).status, 403);
    const overridden = await request(`${path}?districtId=${d2.id}`, { role: 'district' });
    assert.equal(overridden.status, 400);
    assert.equal(overridden.body.code, 'VALIDATION_ERROR');
    const mutation = await request(path, { method: 'POST', body: {} });
    assert.equal(mutation.status, 405);
    assert.match(mutation.headers.get('allow'), /GET/);
  }
  assert.equal((await request(`/districts/${d2.id}`, { role: 'district' })).status, 403);
});

test('automatic scope follows current account assignment instead of token role or jurisdiction claims', async () => {
  const user = await User.findOne({ email: 'district@test.lk' });
  const token = require('jsonwebtoken').sign({ role: 'ADMIN', jurisdictionType: 'NATIONAL', jurisdictionRef: d3.id },
    process.env.JWT_SECRET, { subject: user.id, expiresIn: '1h' });
  const headers = { Authorization: `Bearer ${token}` };
  const original = await request('/me', { headers });
  assert.equal(original.body.user.role, 'DISTRICT_OFFICER');
  assert.equal(original.body.jurisdiction.resource._id, d1.id);
  await User.updateOne({ _id: user._id }, { jurisdictionRef: d2._id });
  try {
    const changed = await request('/me', { headers: { ...headers, 'If-None-Match': original.headers.get('etag') } });
    assert.equal(changed.status, 200);
    assert.equal(changed.body.jurisdiction.resource._id, d2.id);
    assert.deepEqual((await request('/districts', { headers })).body.map(d => d._id), [d2.id]);
  } finally {
    await User.updateOne({ _id: user._id }, { jurisdictionRef: d1._id });
  }
});

test('reader context has empty conditional 304 and denies missing assigned jurisdictions', async () => {
  for (const role of ['admin', 'province', 'district', 'substation']) {
    const first = await request('/me', { role });
    const cached = await request('/me', { role, headers: { 'If-None-Match': first.headers.get('etag') } });
    assert.equal(cached.status, 304);
    assert.equal(cached.text, '');
    assert.equal(first.headers.get('cache-control'), 'private, no-cache');
  }
  await User.updateOne({ email: 'district@test.lk' }, { jurisdictionRef: new mongoose.Types.ObjectId() });
  try {
    const missing = await request('/me', { role: 'district' });
    assert.equal(missing.status, 403);
    assert.equal(missing.body.code, 'FORBIDDEN');
  } finally {
    await User.updateOne({ email: 'district@test.lk' }, { jurisdictionRef: d1._id });
  }
});
