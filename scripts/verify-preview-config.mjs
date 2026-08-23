import { readFileSync } from 'node:fs';

const config = readFileSync(new URL('../wrangler.preview.toml', import.meta.url), 'utf8');
const d1Block = config.match(/\[\[d1_databases\]\]([\s\S]*?)(?=\n\[|$)/)?.[1] || '';
const expected = {
  worker: 'kunonline-preview',
  database: 'kunonline-preview',
  databaseId: '31cd5cdf-fc01-42d7-ba1e-571f3dd58495',
  binding: 'DB',
};
const value = (source, key) => source.match(new RegExp(`^\\s*${key}\\s*=\\s*"([^"]+)"`, 'm'))?.[1];
const actual = {
  worker: value(config, 'name'),
  database: value(d1Block, 'database_name'),
  databaseId: value(d1Block, 'database_id'),
  binding: value(d1Block, 'binding'),
};
for (const [key, expectedValue] of Object.entries(expected)) {
  if (actual[key] !== expectedValue) throw new Error(`Preview safety check failed: ${key} must be ${expectedValue}; got ${actual[key] ?? 'missing'}`);
}
if (/database_name\s*=\s*"kunonline"/m.test(config) || /^name\s*=\s*"kunonline"/m.test(config)) {
  throw new Error('Preview safety check failed: production resource detected');
}
console.log('Preview config safety check passed.');
