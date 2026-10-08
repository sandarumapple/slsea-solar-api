// Read-only deployment check. Credentials, when supplied, are kept in memory.
require('dotenv').config({ quiet: true });
async function run() {
  const base = (process.env.API_BASE_URL || '').replace(/\/$/, '');
  if (!/^https?:\/\//.test(base)) throw new Error('Set API_BASE_URL to the server origin, without /api');
  const origin = new URL(base);
  const local = process.env.SMOKE_ALLOW_LOCAL_HTTP === 'true' &&
    ['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname);
  if (origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash)
    throw new Error('API_BASE_URL must be an origin without credentials, path, query or fragment');
  if (origin.protocol !== 'https:' && !(local && origin.protocol === 'http:'))
    throw new Error('Deployment verification requires HTTPS; local tests must opt in with SMOKE_ALLOW_LOCAL_HTTP=true');
  if (!process.env.SMOKE_EMAIL || !process.env.SMOKE_PASSWORD)
    throw new Error('SMOKE_EMAIL and SMOKE_PASSWORD are required for complete deployment verification');
  async function request(path, options = {}) {
    const response = await fetch(`${base}${path}`, { ...options, redirect: 'error', signal: AbortSignal.timeout(15000) });
    const text = await response.text();
    return { response, text, json: text && response.headers.get('content-type')?.includes('application/json') ? JSON.parse(text) : null };
  }
  for (const path of ['/health', '/api/docs/', '/api/openapi.json']) {
    const result = await request(path);
    if (result.response.status !== 200) throw new Error(`${path}: HTTP ${result.response.status}`);
    console.log(`PASS ${path}`);
  }
  const denied = await request('/api/provinces');
  if (denied.response.status !== 401) throw new Error('Protected resource did not require authentication');
  console.log('PASS unauthenticated access denied');
  const login = await request('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: process.env.SMOKE_EMAIL, password: process.env.SMOKE_PASSWORD }) });
  if (login.response.status !== 200 || !login.json?.token) throw new Error('Reader login failed');
  const headers = { Authorization: `Bearer ${login.json.token}` };
  const context = await request('/api/me', { headers });
  if (context.response.status !== 200 || context.json?.user?.id !== login.json.user?.id || !context.json?.jurisdiction?.type)
    throw new Error('Reader account context unavailable');
  const districts = await request('/api/districts', { headers });
  if (districts.response.status !== 200 || !Array.isArray(districts.json) || !districts.json.length)
    throw new Error('Automatic district scope unavailable or empty');
  console.log('PASS reader context and automatic district scope');
  const first = await request('/api/provinces', { headers });
  if (first.response.status !== 200 || !Array.isArray(first.json) || !first.json.length) throw new Error('Reader provinces unavailable or empty');
  const second = await request('/api/provinces', { headers: { ...headers, 'If-None-Match': first.response.headers.get('etag') } });
  if (second.response.status !== 304 || second.text !== '') throw new Error('Conditional GET failed');
  const history = await request('/api/readings?pageSize=2', { headers });
  if (history.response.status !== 200 || !history.json?.data?.length || !history.json.pagination?.totalCount) throw new Error('Seeded reading history unavailable');
  console.log('PASS reader login, seeded provinces/history and empty conditional 304');
}
run().catch(error => {
  console.error(`Smoke check failed: ${error.message}`);
  process.exitCode = 1;
});
