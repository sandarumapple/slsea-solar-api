const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
test('deployment check refuses public HTTP and incomplete authentication settings', () => {
  for (const [base, email, expected] of [
    ['http://example.invalid', 'reader', /requires HTTPS/],
    ['https://example.invalid', '', /SMOKE_EMAIL and SMOKE_PASSWORD are required/],
    ['https://example.invalid/api', 'reader', /must be an origin/]
  ]) {
    const result = spawnSync(process.execPath, ['scripts/smoke.js'], { encoding: 'utf8', env: {
      ...process.env, API_BASE_URL: base, SMOKE_EMAIL: email, SMOKE_PASSWORD: 'test-only', SMOKE_ALLOW_LOCAL_HTTP: 'false'
    } });
    assert.equal(result.status, 1);
    assert.match(result.stderr, expected);
  }
});
