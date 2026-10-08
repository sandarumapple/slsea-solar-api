const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const createLoginLimit = require('../src/middleware/loginLimit');
const { errorHandler } = require('../src/middleware/error');

test('login throttling returns 429, Retry-After and the error contract', async () => {
  const app = express();
  app.post('/login', createLoginLimit({ limit: 2 }), (req, res) => res.json({ ok: true }));
  app.use(errorHandler);
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  try {
    const url = `http://127.0.0.1:${server.address().port}/login`;
    assert.equal((await fetch(url, { method: 'POST' })).status, 200);
    assert.equal((await fetch(url, { method: 'POST' })).status, 200);
    const response = await fetch(url, { method: 'POST' });
    assert.equal(response.status, 429);
    assert.ok(Number(response.headers.get('retry-after')) > 0);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal((await response.json()).code, 'RATE_LIMITED');
  } finally { await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }); }
});
