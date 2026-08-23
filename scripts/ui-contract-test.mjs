import { readFile } from 'node:fs/promises';

const index = await readFile(new URL('../public/v2/index.html', import.meta.url), 'utf8');
const css = await readFile(new URL('../public/v2/kun-v7.css', import.meta.url), 'utf8');
const themeJs = await readFile(new URL('../public/v2/modules-v7.js', import.meta.url), 'utf8');
const auditJs = await readFile(new URL('../public/v2/modules-v8.js', import.meta.url), 'utf8');
const opsJs = await readFile(new URL('../public/v2/modules-v10.js', import.meta.url), 'utf8');

const must = (ok, message) => { if (!ok) throw new Error(message); };
for (const asset of ['/v2/kun-v7.css','/v2/modules-v7.js','/v2/modules-v8.js','/v2/modules-v10.js']) must(index.includes(asset), `Missing ${asset} from v2 index`);
for (const theme of ['light','gray','dark']) must(themeJs.includes(`'${theme}'`) || themeJs.includes(`\"${theme}\"`), `Theme ${theme} is missing from switcher`);
must(css.includes('body[data-theme="gray"]'), 'Gray theme CSS missing');
must(css.includes('body[data-theme="dark"]'), 'Dark theme CSS missing');
must(css.includes('@media(max-width:820px)'), 'Tablet/mobile breakpoint missing');
must(css.includes('@media(max-width:560px)'), 'Phone breakpoint missing');
must(css.includes('@media(max-width:360px)'), 'Very small screen breakpoint missing');
must(css.includes('prefers-reduced-motion'), 'Reduced motion accessibility support missing');
must(css.includes(':focus-visible'), 'Keyboard focus styles missing');
must(themeJs.includes('mobileMenuBtn'), 'Mobile navigation control missing');
must(themeJs.includes("localStorage.setItem(storageKey,theme)"), 'Theme persistence missing');
must(index.includes('viewport-fit=cover'), 'Safe-area capable viewport missing');
must(index.includes('data-view="audit"'), 'Audit navigation entry missing');
must(index.includes('data-view="ops"'), 'Operations center navigation entry missing');
must(auditJs.includes('/api/audit-log'), 'Audit UI must use audit API');
must(auditJs.includes('/api/access/snapshot'), 'Audit UI must show effective access snapshot');
must(opsJs.includes('/api/system-status'), 'Operations UI must use system status API');
must(opsJs.includes('/api/execution-jobs'), 'Operations UI must show execution queue');
must(opsJs.includes('/api/notifications'), 'Operations UI must show notifications');
console.log('UI contract checks passed: responsive themes, accessibility, audit, access and operations center.');
