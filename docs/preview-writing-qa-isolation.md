# State-writing Preview QA isolation

All 22 D1-writing live/browser Preview entrypoints in
`scripts/isolated-preview-qa-entrypoints.json` now require a dedicated QA
configuration before making requests. This includes J&T authentication probes,
which insert/delete temporary users even though they are called diagnostics.
GET/SQL-read-only operational diagnostic scripts are separate.

Set `KUN_PREVIEW_QA_WRANGLER_CONFIG` and `KUN_PREVIEW_QA_D1_ID` for the isolated
target, and pass the exact QA Worker HTTPS origin as the script argument.
The Easy Orders legacy variable names remain accepted if they do not conflict.
The config cannot use either known customer D1, an environment override or a
service binding; its Worker name must match the URL's first hostname label.

This is a config safety floor, not Cloudflare isolation attestation. An approved
protected job must verify the deployed Worker actually binds the approved QA D1,
has no live service targets and uses only synthetic fixture provider credentials.
Never seed this QA database by restoring customer rows into it. A restoration
rehearsal needs a separate database with no app Worker bound to it.

## Release status

Do not merge this stack into develop yet. The current Preview workflow still
passes the live Preview URL to writing tests. These entrypoints intentionally
reject that invocation. A release-ready workflow must first provision/verify
isolated QA, seed fake fixtures, run every writing E2E against that target, and
keep deployed customer Preview checks read-only. Missing fixtures must be a
failure, never a skipped E2E pass. Cloudflare inventory, a recovery point and an
independent restoration rehearsal remain mandatory before application release.

The offline regression launches each entrypoint with a fetch trap and checks
both missing and customer-linked config rejection. It also checks the known
Production D1, wrong origin, service proxies, environment overrides and
conflicting settings. It does not contact Cloudflare or a provider.
