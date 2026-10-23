# Kun Online — ChatGPT MCP plugin (draft)

MCP: `https://app.kun-online.com/mcp` (Streamable HTTP).
OAuth: `https://app.kun-online.com/oauth/authorize`, `/oauth/token`; CIMD, S256 PKCE, `kun:read`.

## What currently works

- Read-only, single-store consent: order totals, states and cancellation/return rates, highest-volume products, and store-specific imported Meta adset spending.
- Short-lived, user/store-scoped OAuth access tokens, rotating refresh tokens, authorization-code replay prevention, revocation from the Integrations page.
- No API key from OpenAI, no paid generation from the Kun Online server, and no order mutation tools.
- Mock OAuth and MCP regression tests, public endpoint/authentication smoke test through GitHub Actions.

## Review prerequisites — NOT completed by this repository

1. A verified OpenAI plugin developer must upload this ZIP at the official plugin submission portal, verify `app.kun-online.com` by serving the unique challenge issued for the verified developer, and run **Scan Tools**.
2. Publish verified and reviewed **privacy policy** and **terms of service** URLs on the company's domain. Add their working HTTPS URLs to `plugin.json` (fields `privacyPolicyURL` and `termsOfServiceURL`) **only after** legal/business review. The current draft intentionally omits them; do not submit as final.
3. Verify support operations at `https://kun-online.com/contact/`; provide a test store/account for reviewer sign-in via the private review portal without including credentials in code or the ZIP.
4. Test full OAuth consent and tool invocation from an eligible ChatGPT developer workspace, including a revoked grant and store-isolation checks. CI mocks are not a live ChatGPT installation test.
5. Complete real positive/negative test cases, recording, pricing/availability disclosures, translations as necessary, and any review comments.

## Build

`node scripts/build-kun-chatgpt-plugin.mjs` generates `dist/kun-online-chatgpt-plugin-draft.zip` using `public/logo.png`.

Not yet listed or approved in the public ChatGPT directory. Custom MCP servers cannot be added directly by individual ChatGPT Plus accounts; broad Plus access would depend on publication and the account's plugin availability.
