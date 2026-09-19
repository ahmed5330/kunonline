# Kun Online v27 GitHub Overlay

هذه الملفات مصممة لتُنسخ فوق Repository `ahmed5330/kunonline` على فرع `develop/ux-system-upgrade` فقط.

## قبل الرفع
1. تأكد أن الـbase هو SHA `8c1829738722679077ff785d19f925889b7efbf3` أو راجع diff إذا تقدم الفرع.
2. لا ترفع على `main`.
3. لا تغيّر `wrangler.production.toml`.
4. لا تضع API keys/tokens في الملفات.

## الملفات الجديدة
- `migrations/0014_platform_control_wallet_marketing.sql`
- `src/index-commerce-v27.js`
- `src/feature-entitlements.js`
- `src/wallet-billing.js`
- `src/order-events.js`
- `src/order-routing.js`
- `src/marketing-intelligence.js`
- `src/ai-provider.js`
- `src/ad-studio.js`
- `src/ad-provider-adapters.js`
- `src/admin-control.js`
- `public/v2/modules-v22.js`
- `public/v2/kun-v9.css`
- `scripts/platform-v27-contract-test.mjs`
- `scripts/platform-v27-sql-test.mjs`
- `docs/PRODUCT_VISION_V27.md`
- `docs/V27_RELEASE_AND_QA.md`

## الملفات التي تستبدل نسختها الحالية
- `src/access-control.js`
- `src/store-scope.js`
- `src/provider-registry.js`
- `src/execution-runner.js`
- `public/v2/index.html`
- `wrangler.preview.toml`
- `package.json`

## التطبيق
انسخ محتويات مجلد الحزمة إلى جذر الـrepo مع الاحتفاظ بنفس المسارات. ثم شغّل:

```bash
npm install --ignore-scripts
npm run test:v27-contract
npm run test:v27-sql
npm test
npm run check:preview-config
npm run check:production-config
```

بعد نجاحها، Commit/Push إلى `develop/ux-system-upgrade`. Preview CI/CD هو الذي يطبق migration `0014` على Preview D1 ثم ينشر ويشغّل smoke test.

## Secrets اختيارية/خارج GitHub
- `OPENAI_API_KEY` لتفعيل AI enrichment؛ بدونه يعمل Rule Engine.
- `OPENAI_TEXT_MODEL` مطلوب مع `OPENAI_API_KEY` لتفعيل AI enrichment؛ إذا لم يُضبط يستمر Rule Engine بدل تخمين Model name.
- `INTEGRATION_ENCRYPTION_KEY` كما هو متطلب النظام الحالي.
- `META_GRAPH_API_VERSION` اختياري لموصل Meta.
- Provider OAuth/API credentials تحفظ عبر integration secret storage، لا في GitHub.
