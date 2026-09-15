# Claude Bridge for Kun Online

This bridge runs Claude Code headlessly on the VPS and exposes a tiny authenticated local HTTP API for an orchestrator/reviewer.

## Safety model

- Binds to `127.0.0.1` by default; do not expose it publicly without a reverse proxy, TLS, and access control.
- Requires a bearer token for `/task`.
- Never uses `--dangerously-skip-permissions`.
- Execute mode uses Claude Code `auto` permission mode for unattended execution with safety classification.
- Review mode runs in `plan` mode and only gets read/git-inspection permissions.
- The embedded task policy explicitly forbids Production D1 writes, migrations/resets, and pushes to `main`.
- Run the service from a non-production feature/development branch checkout.

## Requirements

- Node.js 20+
- Claude Code CLI installed and authenticated on the VPS
- A checkout of this repository on a feature/development branch

Verify Claude first:

```bash
claude -p "Reply only with OK" --output-format json
```

## Configure

```bash
cd /path/to/kunonline/openclaw/claude-bridge
export CLAUDE_BRIDGE_TOKEN="$(openssl rand -hex 32)"
export CLAUDE_BRIDGE_REPO_DIR="/path/to/kunonline"
export CLAUDE_BRIDGE_MAX_BUDGET_USD=5
node server.mjs
```

Keep the generated token in a secret manager or protected environment file, never in Git.

## Health check

```bash
curl http://127.0.0.1:8789/health
```

## Execute a task

```bash
curl -sS http://127.0.0.1:8789/task \
  -H "Authorization: Bearer $CLAUDE_BRIDGE_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"mode":"execute","task":"Inspect the current branch, fix the failing preview test, run the relevant tests, and summarize the changes. Do not touch production."}'
```

## Review only

```bash
curl -sS http://127.0.0.1:8789/task \
  -H "Authorization: Bearer $CLAUDE_BRIDGE_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"mode":"review","task":"Review the current diff for bugs, security issues, and production-data risk. Do not modify files."}'
```

## Intended orchestration loop

1. Orchestrator sends a scoped task to `/task` in `execute` mode.
2. Claude Code inspects and edits the feature/development checkout, then runs narrow tests.
3. Claude returns structured JSON including its session/result metadata.
4. Orchestrator inspects the Git diff/commit and CI through GitHub.
5. If review finds problems, the orchestrator sends a correction task.
6. Only after review passes should a human-controlled PR be merged toward production.

## Important

This bridge controls Claude Code running on the VPS. It does not remote-control mouse/keyboard interactions inside the Claude Desktop/CoWork UI. Claude Code and Desktop share project configuration, and Claude Code also supports remote-control/web-session features separately, but this bridge intentionally uses the documented headless `claude -p` path because it is scriptable and reviewable.
