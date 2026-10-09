const { test } = require('node:test');
const assert = require('node:assert/strict');
const models = require('../src/models');
const c = require('../src/controllers/resourceController');
const auth = require('../src/middleware/auth');
const { errorHandler } = require('../src/middleware/error');
function res() {
  return {
    headers: {},
    statusCode: 200,
    set(k, v) {
      if (typeof k === 'object') Object.assign(this.headers, k);
      else this.headers[k] = v;
      return this;
    },
    status(v) {
      this.statusCode = v;
      return this;
    },
    json(v) {
      this.body = v;
      return this;
    },
    end() {
      return this;
    }
  };
}
function query(value) {
  return {
    select() {
      return this;
    },
    populate() {
      return this;
    },
    sort() {
      return this;
    },
    lean: async () => value
  };
}
test('district collection applies the authorized district filter', async (t) => {
  t.mock.method(require('../src/utils/managementCache'), 'modified', async () => 0);
  let filter;
  t.mock.method(models.District, 'find', (q) => {
    filter = q;
    return query([{ _id: 'own' }]);
  });
  const response = res();
  await c.districts(
    {
      params: { provinceId: 'province' },
      scope: { districts: ['own'] },
      headers: {}
    },
    response
  );
  assert.deepEqual(filter, { province: 'province', _id: { $in: ['own'] } });
  assert.equal(response.statusCode, 200);
});
test('substation user resolves only its parent and own substation', async (t) => {
  t.mock.method(models.GridSubstation, 'findById', () =>
    query({ _id: 's1', district: 'd1' })
  );
  t.mock.method(models.District, 'find', (filter) => {
    assert.equal(filter._id, 'd1');
    return query([{ _id: 'd1', province: 'p1' }]);
  });
  t.mock.method(models.GridSubstation, 'find', (filter) => {
    assert.equal(filter._id, 's1');
    return query([{ _id: 's1' }]);
  });
  const req = {
    auth: {
      role: 'SUBSTATION_OFFICER',
      jurisdictionType: 'SUBSTATION',
      jurisdictionRef: 's1'
    }
  };
  let error;
  await auth.readUser(req, res(), (e) => {
    error = e;
  });
  assert.equal(error, undefined);
  assert.deepEqual(req.scope, {
    provinces: ['p1'],
    districts: ['d1'],
    substations: ['s1']
  });
});
test('device read access is rejected before querying the database', async () => {
  let error;
  await auth.readUser({ auth: { role: 'DEVICE' } }, res(), (e) => {
    error = e;
  });
  assert.equal(error.status, 403);
});
test('device must match installation and jurisdiction type', async () => {
  assert.equal(
    await auth.canAccessInstallation(
      {
        role: 'DEVICE',
        jurisdictionType: 'INSTALLATION',
        jurisdictionRef: 'i1'
      },
      { _id: 'i1' }
    ),
    true
  );
  assert.equal(
    await auth.canAccessInstallation(
      {
        role: 'DEVICE',
        jurisdictionType: 'INSTALLATION',
        jurisdictionRef: 'i1'
      },
      { _id: 'i2' }
    ),
    false
  );
  assert.equal(
    await auth.canAccessInstallation(
      { role: 'DEVICE', jurisdictionType: 'DISTRICT', jurisdictionRef: 'i1' },
      { _id: 'i1' }
    ),
    false
  );
});
test('malformed JSON retains 400 with all error fields', () => {
  const response = res();
  errorHandler(
    Object.assign(new SyntaxError('bad'), {
      status: 400,
      type: 'entity.parse.failed'
    }),
    {},
    response,
    () => {}
  );
  assert.equal(response.statusCode, 400);
  assert.deepEqual(Object.keys(response.body), ['code', 'message', 'detail']);
  assert.equal(response.body.code, 'INVALID_JSON');
});
test('non-string login credentials fail validation without querying', async () => {
  let error;
  await require('../src/controllers/authController').login(
    { body: { email: 12, password: 'test' } },
    res(),
    (e) => {
      error = e;
    }
  );
  assert.equal(error.status, 400);
});
test('history rejects outside-scope regional filters', async () => {
  await assert.rejects(
    c.readings(
      {
        query: { districtId: '507f1f77bcf86cd799439011' },
        scope: { districts: [], provinces: [], substations: [] },
        headers: {},
        baseUrl: '/api',
        path: '/readings'
      },
      res()
    ),
    { status: 403 }
  );
});
test('new reading changes composite validator and modification date', async (t) => {
  t.mock.method(models.SolarInstallation, 'findById', () =>
    query({ _id: 'i1', updatedAt: new Date('2026-01-01') })
  );
  let latest = { powerKw: 1, createdAt: new Date('2026-01-02') };
  t.mock.method(models.GenerationReading, 'findOne', () => query(latest));
  const req = { params: { installationId: 'i1' }, headers: {} };
  const first = res();
  await c.installation(req, first);
  latest = { powerKw: 2, createdAt: new Date('2026-01-03') };
  const second = res();
  await c.installation(
    { ...req, headers: { 'if-none-match': first.headers.ETag } },
    second
  );
  assert.equal(second.statusCode, 200);
  assert.notEqual(first.headers.ETag, second.headers.ETag);
  assert.equal(
    second.headers['Last-Modified'],
    new Date('2026-01-03').toUTCString()
  );
});
