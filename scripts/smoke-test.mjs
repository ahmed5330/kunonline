const base = (process.argv[2] || '').replace(/\/$/, '');
if (!base) throw new Error('Usage: node scripts/smoke-test.mjs <base-url>');
async function check(path, validate) {
  let lastError;
  for (let attempt = 1; attempt <= 6; attempt += 1) {
    try {
      const response = await fetch(`${base}${path}`, { redirect: 'follow' });
      const body = await response.text();
      if (!response.ok) throw new Error(`${path} returned ${response.status}`);
      validate(body);
      console.log(`Smoke check passed: ${path}`);
      return;
    } catch (error) {
      lastError = error;
      if (attempt < 6) await new Promise((resolve) => setTimeout(resolve, attempt * 2000));
    }
  }
  throw lastError;
}
await check('/healthz', (body) => {
  const data = JSON.parse(body);
  if (data.ok !== true || data.environment !== 'preview' || data.database !== 'reachable') throw new Error(`Unexpected health response: ${body}`);
});
await check('/v2/', (body) => { if (!body.trim()) throw new Error('/v2/ returned an empty response'); });

