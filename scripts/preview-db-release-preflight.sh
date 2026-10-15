#!/usr/bin/env bash
# Fail-closed database release gate for the *shared, production-backed* Preview D1.
# Does not mutate the remote DB. No customer data is retained as a CI artifact.
set -euo pipefail
cd "$(dirname "$0")/.."

: "${GITHUB_SHA:?GitHub commit SHA is required}"
if [[ ! "$GITHUB_SHA" =~ ^[0-9a-f]{40}$ ]]; then
  echo "::error::Invalid release SHA"; exit 1
fi
if ! grep -Fq 'database_name = "kunonline-preview"' wrangler.preview.toml; then
  echo "::error::Unexpected Preview D1 binding"; exit 1
fi

# Use the same known-good fallback as preview.yml. Never guess a schema baseline.
stable_sha="$(git ls-remote origin refs/tags/preview-stable | awk '{print $1}')"
if [[ -z "$stable_sha" ]]; then
  stable_sha="05787d92d16d5b0da2bdf8dfcdd9a9cf54b875b5"
fi
git fetch --no-tags --depth=1 origin "$stable_sha" >/dev/null
git cat-file -e "${stable_sha}^{commit}"

changes="$(git diff --name-only "$stable_sha" "$GITHUB_SHA" -- migrations/ schema.sql migration_2026-08-23_commerce_os.sql)"
if [[ -z "$changes" ]]; then
  echo "No database schema file changes compared with verified Preview baseline $stable_sha."
  echo "apply_migrations=false" >> "${GITHUB_OUTPUT:-/dev/null}"
  exit 0
fi

# A push-triggered deploy must not silently migrate the production-backed Preview DB.
# Manual dispatch alone is insufficient: approval must be SHA-pinned and an
# independently retained backup's review reference must be provided.
if [[ "${GITHUB_EVENT_NAME:-}" != "workflow_dispatch" ]]; then
  echo "::error::Shared D1 schema changed. Automatic push release blocked; use reviewed manual dispatch."
  exit 1
fi
if [[ "${PREVIEW_D1_APPROVAL:-}" != "${GITHUB_SHA}:kunonline-preview" ]]; then
  echo "::error::Expected exact commit-specific approval: <SHA>:kunonline-preview"
  exit 1
fi
if [[ ! "${PREVIEW_D1_BACKUP_REF:-}" =~ ^(r2://|s3://|backup-ticket:)[A-Za-z0-9_./:@-]{8,}$ ]]; then
  echo "::error::Provide an independently retained and reviewed database backup reference."
  exit 1
fi

# Deletions or edits of previously existing migrations are not automatically safe.
# Only newly added additive migrations are eligible for SQL rehearsal here.
while IFS= read -r file; do
  if [[ "$file" == migrations/*.sql ]]; then
    change_type="$(git diff --name-status "$stable_sha" "$GITHUB_SHA" -- "$file" | cut -f1)"
    if [[ "$change_type" != "A" ]]; then
      echo "::error::Migration $file was changed or deleted. Requires separate migration plan."
      exit 1
    fi
  else
    echo "::error::Base schema changed ($file). Requires separate migration plan."
    exit 1
  fi
done <<< "$changes"

# Do not accidentally apply pending migrations from older branches that have
# never been rehearsed. Only newly added migration files in this reviewed diff
# are eligible for this release. A changed/unknown CLI format fails closed.
pending_log="$(npx wrangler d1 migrations list kunonline-preview --remote --config wrangler.preview.toml 2>&1)" || {
  echo "::error::Could not inspect actual pending remote D1 migrations"; exit 1
}
pending_files="$(printf '%s\n' "$pending_log" | grep -Eo '[0-9]{4}_[A-Za-z0-9._-]+\.sql' | sort -u || true)"
if [[ -z "$pending_files" ]] && ! grep -Eqi 'no migrations to apply|no migrations found|there are no migrations' <<< "$pending_log"; then
  echo "::error::Remote migration inventory is ambiguous; refusing any database mutation"; exit 1
fi
while IFS= read -r migration_name; do
  [[ -z "$migration_name" ]] && continue
  if ! grep -Fxq "migrations/$migration_name" <<< "$changes"; then
    echo "::error::Unreviewed pending remote D1 migration: $migration_name"; exit 1
  fi
done <<< "$pending_files"

scratch="$(mktemp -d)"
chmod 700 "$scratch"
trap 'rm -rf "$scratch"' EXIT
# D1 production storage exposes a Time Travel recovery bookmark.
npx wrangler d1 info kunonline-preview --json --config wrangler.preview.toml > "$scratch/info.json"
node -e '
const fs=require("node:fs");
const d=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));
if (d.version !== "production") throw new Error("D1 Time Travel recovery is not verified for this database");
' "$scratch/info.json"
npx wrangler d1 time-travel info kunonline-preview --config wrangler.preview.toml > "$scratch/bookmark.txt"
recovery_bookmark="$(grep -Eo '[0-9a-f]{8}-[0-9a-f-]{16,}' "$scratch/bookmark.txt" | head -n 1 || true)"
if [[ -z "$recovery_bookmark" ]]; then
  echo "::error::Cloudflare D1 recovery bookmark was not returned"; exit 1
fi

# D1 export can briefly make a busy production-backed database unavailable.
# Never export even the schema through the export endpoint during live release
# checks. Query sqlite_master via read-only execute instead, then replay ONLY
# SQL definitions and explicitly approved migrations in ephemeral Node SQLite.
# This copies no rows, account balances or user data to the CI runner.
mapfile -t reviewed_migrations <<< "$changes"
node scripts/preview-live-schema-rehearsal.mjs "${reviewed_migrations[@]}"

{
  echo "### Reviewed shared D1 release preflight"
  echo "- Commit: \`$GITHUB_SHA\`"
  echo "- Reviewed external backup reference: \`$PREVIEW_D1_BACKUP_REF\`"
  echo "- Stable comparison: \`$stable_sha\`"
  echo "- Read-only sqlite_master schema query (NO D1 export or customer rows), additive migrations rehearsed on ephemeral SQLite."
  echo "- D1 Time Travel recovery bookmark (before migration): \`$recovery_bookmark\` (restore requires a separate reviewed incident action)."
  echo "- **No remote database writes in this preflight.**"
} >> "${GITHUB_STEP_SUMMARY:-/dev/null}"
echo "apply_migrations=true" >> "${GITHUB_OUTPUT:-/dev/null}"
echo "Shared D1 preflight PASS: release approval, recovery point, export, integrity and migration rehearsal."
