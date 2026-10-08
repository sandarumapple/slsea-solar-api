const test = require('node:test');
const assert = require('node:assert/strict');
const { paginate } = require('../src/utils/http');
test('pagination clamps page size and produces navigation', () => {
  const req = {
    query: { page: '2', pageSize: '500', order: 'asc' },
    protocol: 'http',
    get: () => 'api.test',
    baseUrl: '/api',
    path: '/readings'
  };
  const p = paginate(req, 250);
  assert.equal(p.pageSize, 100);
  assert.equal(p.skip, 100);
  assert.equal(p.response.totalPages, 3);
  assert.match(p.links.next, /page=3/);
  assert.match(p.links.previous, /page=1/);
});

const {
  conditional,
  timestamp,
  latestModification
} = require('../src/utils/http');
const response = () => ({
  headers: {},
  set(key, value) {
    if (typeof key === 'object') Object.assign(this.headers, key);
    else this.headers[key] = value;
    return this;
  }
});
test('conditional headers handle weak/list ETags, precedence and second-precision dates', () => {
  const res = response();
  const modified = new Date(Date.now() - 10000);
  const body = { value: 1 };
  assert.equal(conditional({ headers: {} }, res, body, modified), false);
  const tag = res.headers.ETag;
  assert.equal(
    conditional(
      { headers: { 'if-none-match': `"other", W/${tag}` } },
      res,
      body,
      modified
    ),
    true
  );
  assert.equal(
    conditional({ headers: { 'if-none-match': '*' } }, res, body, modified),
    true
  );
  assert.equal(
    conditional(
      { headers: { 'if-modified-since': res.headers['Last-Modified'] } },
      res,
      body,
      modified
    ),
    true
  );
  assert.equal(
    conditional(
      {
        headers: {
          'if-none-match': '"stale"',
          'if-modified-since': res.headers['Last-Modified']
        }
      },
      res,
      body,
      modified
    ),
    false
  );
  assert.equal(
    conditional(
      { headers: { 'if-none-match': tag } },
      res,
      { value: 2 },
      modified
    ),
    false
  );
  assert.equal(
    conditional(
      { headers: { 'if-modified-since': 'invalid' } },
      res,
      body,
      modified
    ),
    false
  );
});
test('composite modification time includes nested readings and hierarchy', () => {
  assert.equal(
    latestModification({
      updatedAt: '2026-01-01',
      lastKnownReading: { createdAt: '2026-01-02' }
    }),
    Date.parse('2026-01-02')
  );
});
test('pagination rejects unsafe and non-integral values', () => {
  for (const value of [
    '1.5',
    'Infinity',
    '-1',
    '0',
    'abc',
    ['1'],
    '9007199254740991'
  ]) {
    assert.throws(
      () =>
        paginate(
          { query: { page: value }, baseUrl: '/api', path: '/readings' },
          1
        ),
      { status: 400 }
    );
  }
});
test('timestamps require real dates and explicit timezone', () => {
  assert.equal(
    timestamp('2026-10-01T10:00:00+05:30', 'from').toISOString(),
    '2026-10-01T04:30:00.000Z'
  );
  for (const value of [
    '2026-02-31T10:00:00Z',
    '2026-10-01',
    '2026-10-01T10:00:00',
    '2026-10-01T24:00:00Z',
    12,
    null
  ])
    assert.throws(() => timestamp(value, 'from'), { status: 400 });
});
