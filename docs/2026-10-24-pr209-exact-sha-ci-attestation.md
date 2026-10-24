# PR #209 exact-head regression attestation gate — 2026-10-24

The prior workflow `.github/workflows/pr209-full-offline-regression.yml` ran on dependent pull requests **into** the audit branch. GitHub's squash merge created a **different exact audit-branch SHA**, which could not be claimed as itself tested.

The workflow now also triggers on **every push to exactly** `fix/audit-critical-findings-20261023` (including squash merges and documentation-only changes), without paths exclusions. Both Linux and Windows suites run for those pushes. Each suite asserts the allowed branch/event combination to prevent accidental runs on `main` or `develop/ux-system-upgrade`; manual dispatch is permitted **only on the audit branch**. A dependent PR still gets its own pre-merge verification.

### CI proof and limitations

- Linux: Node 22, no Cloudflare account variables or API tokens, `npm install --ignore-scripts`, full `npm test`, source-only release blockers, local Wrangler/workerd and ephemeral local D1 integration; no Production or Preview probes.
- Windows: Node 22, no Cloudflare account variables or API tokens, in-memory SQLite/auth/password/bridge regression.
- No workflow step creates Cloudflare resources, deploys or migrates remote D1, publishes Android or touches customer data.
- The exact SHA is in the Action's `head_sha`; release evidence must link a **completed successful run for that SHA**. A green dependent-PR SHA must not be represented as proof of the eventual squash SHA.
- Full green CI is **never** release authorization. The `main` auth conflict, live D1 migration ledger and effective Production/Preview Worker bindings, remote sandbox and backup/rollback approval remain independent manual gates.

Expected first post-squash audit SHA test: check Actions workflow `PR209 full offline regression (no deploy)` for its run `head_sha` equal to the final audit PR HEAD. There are no conditions under which this workflow should deploy.
