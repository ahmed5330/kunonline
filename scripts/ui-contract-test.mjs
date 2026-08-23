import { readFile } from 'node:fs/promises';

const index = await readFile(new URL('../public/v2/index.html', import.meta.url), 'utf8');
const css = await readFile(new URL('../public/v2/kun-v7.css', import.meta.url), 'utf8');
const js = await readFile(new URL('../public/v2/modules-v7.js', import.meta.url), 'utf8');

const must = (ok, message) => { if (!ok) throw new Error(message); };

for (const asset of ['/v2/kun-v7.css','/v2/modules-v7.js']) {
  must(index.includes(asset), `Missing ${asset} from v2 index`);
}
for (const theme of ['light','gray','dark']) {
  must(js.includes(`'${theme}'`) || js.includes(`\"${theme}\"`), `Theme ${theme} is missing from switcher`);
}
must(css.includes('body[data-theme="gray"]'), 'Gray theme CSS missing');
must(css.includes('body[data-theme="dark"]'), 'Dark theme CSS missing');
must(css.includes('@media(max-width:820px)'), 'Tablet/mobile breakpoint missing');
must(css.includes('@media(max-width:560px)'), 'Phone breakpoint missing');
must(css.includes('@media(max-width:360px)'), 'Very small screen breakpoint missing');
must(css.includes('prefers-reduced-motion'), 'Reduced motion accessibility support missing');
must(css.includes(':focus-visible'), 'Keyboard focus styles missing');
must(js.includes('mobileMenuBtn'), 'Mobile navigation control missing');
must(js.includes("localStorage.setItem(storageKey,theme)"), 'Theme persistence missing');
must(index.includes('viewport-fit=cover'), 'Safe-area capable viewport missing');

console.log('UI contract checks passed: responsive shell + light/gray/dark themes + accessibility hooks.');
