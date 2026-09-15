const sourceUrl=new URL('./browser-preview-mobile-qa.mjs',import.meta.url);

// Run the current mobile QA source as-is. The mobile script now owns its
// trusted-tap/tel interception logic directly, so this runner must not patch
// implementation text. A unique query keeps the one-retry wrapper honest by
// forcing Node to execute a fresh module instance on every attempt.
const runtimeUrl=new URL(sourceUrl);
runtimeUrl.searchParams.set('runtime',`${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`);
await import(runtimeUrl.href);
