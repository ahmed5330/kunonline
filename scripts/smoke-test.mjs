const base = (process.argv[2] || '').replace(/\/$/, '');
if (!base) throw new Error('Usage: node scripts/smoke-test.mjs <base-url>');

async function fetchWithRetry(path) {
  let lastError;
  for (let attempt = 1; attempt <= 6; attempt += 1) {
    try {
      return await fetch(`${base}${path}`, { redirect: 'follow' });
    } catch (error) {
      lastError = error;
      if (attempt < 6) await new Promise((resolve) => setTimeout(resolve, attempt * 2000));
    }
  }
  throw lastError;
}

async function check(path, validate) {
  const response = await fetchWithRetry(path);
  const body = await response.text();
  if (!response.ok) throw new Error(`${path} returned ${response.status}: ${body}`);
  validate(body);
  console.log(`Smoke check passed: ${path}`);
}

await check('/healthz', (body) => {
  const data = JSON.parse(body);
  if (data.ok !== true || data.environment !== 'preview' || data.database !== 'reachable') {
    throw new Error(`Unexpected health response: ${body}`);
  }
});

await check('/v2/', (body) => {
  if (!body.trim()) throw new Error('/v2/ returned an empty response');
});

const sessionResponse = await fetchWithRetry('/api/me');
const sessionBody = await sessionResponse.text();
if (![200, 401].includes(sessionResponse.status) || /SESSION_SECRET/i.test(sessionBody)) {
  throw new Error(`Session configuration smoke check failed: ${sessionResponse.status} ${sessionBody}`);
}
console.log('Smoke check passed: SESSION_SECRET is configured');
