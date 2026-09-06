# Kun Online v27 — Release / QA Notes

## Base revision
هذه الحزمة Overlay مبنية فوق:
- Repository: `ahmed5330/kunonline`
- Branch: `develop/ux-system-upgrade`
- Expected base HEAD: `8c1829738722679077ff785d19f925889b7efbf3`
- PR #1 يجب أن يظل Draft.

إذا تحرك HEAD قبل تطبيق الحزمة، اعمل diff/merge على أحدث development branch ولا تستخدم force-push.

## ما تعالجه v27
### مشاكل مؤكدة/سابقة
- يحافظ على إصلاح Order POST بدون `date` الموجود في v26؛ لا يرجع إلى entrypoint أقدم.
- Store isolation يبقى فعالًا ويتم توسيعه للمسارات الجديدة.
- Unknown APIs لا تتحول إلى `200 []`.
- لا يكسر Bearer/INGEST routes القديمة المستخدمة بواسطة OpenClaw / WhatsApp order ingestion / tracking / ad-spend.

### مشاكل متوقعة تمت حمايتها
1. **Double wallet charge / race:** ledger idempotency + D1 batch transaction.
2. **Retroactive billing:** `billing_start_rowid` يمنع خصم رسوم على Orders الموجودة قبل تفعيل v27 للعميل.
3. **Negative/corrupt wallet on failed charge:** DB CHECK + transaction rollback + pending_insufficient.
4. **Double top-up approval:** idempotency + request state guard.
5. **UI-only feature hiding:** backend feature gate + filtering legacy `/api/state` payload.
6. **Cross-store leakage in new APIs:** v27 store scope added to timeline, attribution, marketing intelligence, AI brief وAd Studio.
7. **Secret leakage:** Ad adapters decrypt server-side only; secrets never returned to UI/AI.
8. **Unverified external execution:** providers not truly connected fail closed instead of synthetic success.
9. **AI outage/key missing:** deterministic rule-based fallback keeps the app operational.
10. **Oversized transfer screenshots:** browser compression + server size/type validation.
11. **Orders arriving outside UI:** scheduled wallet reconciliation covers integration/import paths after v27 billing activation.

## Migration policy
`0014_platform_control_wallet_marketing.sql` additive only. لا تعمل Reset/Drop. طبقها على `kunonline-preview` فقط من Preview CI/CD قبل أي Production discussion.

## Mandatory automated gates
- Existing full suite.
- `npm run test:v27-contract`
- `npm run test:v27-sql`
- `npm run check:preview-config`
- `npm run check:production-config`
- Preview dry-run/deploy/smoke.

## Mandatory live QA after deploy
1. `/api/preview/version` = `preview-v27-2026-08-27` / `index-commerce-v27.js`.
2. Re-test Store B Order without `date`; must succeed and stay isolated from Store A.
3. Create a v27 wallet-enabled QA client or migrate the existing QA tenant only if intentionally testing billing.
4. Create one new Order: exactly one wallet deduction.
5. Retry/re-send same Order: no second deduction.
6. Insufficient balance: Order still records; billing becomes pending_insufficient; no partial debit.
7. Submit proof screenshot → Pending → Admin approve → exact credit once.
8. Disable a module → nav hidden + direct API returns `403 FEATURE_DISABLED` or filtered state.
9. Order drawer: status, WhatsApp queue, phone contact logging, note and actor/timestamp timeline.
10. Marketing performance: verify platform metrics separately from real/confirmed/delivered orders.
11. Ad Studio: create draft → generate variants → approval request. Do not publish to a real ad account during QA.
12. Light / Gray / Dark at 1440×900, 1366×768, 768×1024, 390×844, 360×800.
13. Console: no critical app errors. Network: no unexpected 404/500.
14. PR Validation + Preview CI/CD + Smoke all green.

## Important limitation
الكود يجهز Control/Approval/Execution layer للإعلانات والتكاملات، ويضيف Meta campaign control عندما يكون Meta Ads connection `connected` فعليًا. لا يمكن اعتبار Google/TikTok/WhatsApp/TikTok Messaging أو أي شركة شحن "Connected" من الكود وحده؛ يلزم OAuth/API credentials وvendor permissions الحقيقية لكل حساب. هذا مقصود حتى لا يوجد نجاح وهمي أو صرف إعلاني غير مصرح به.

## Production
لا Merge، لا تغيير `main`، لا Production migration/deploy، ولا كتابة على Production D1 ضمن هذه الحزمة.
