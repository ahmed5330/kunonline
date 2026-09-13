import http from 'node:http';
import { spawn } from 'node:child_process';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { existsSync } from 'node:fs';

const PORT = Number(process.env.CLAUDE_BRIDGE_PORT || 8789);
const HOST = process.env.CLAUDE_BRIDGE_HOST || '127.0.0.1';
const TOKEN = process.env.CLAUDE_BRIDGE_TOKEN || '';
const REPO_DIR = process.env.CLAUDE_BRIDGE_REPO_DIR || process.cwd();
const CLAUDE_BIN = process.env.CLAUDE_BIN || 'claude';
const MAX_BODY = Number(process.env.CLAUDE_BRIDGE_MAX_BODY || 1024 * 1024);
const MAX_TURNS = Number(process.env.CLAUDE_BRIDGE_MAX_TURNS || 20);
const MAX_BUDGET_USD = process.env.CLAUDE_BRIDGE_MAX_BUDGET_USD || '';

if (!TOKEN) {
  console.error('CLAUDE_BRIDGE_TOKEN is required');
  process.exit(1);
}
if (!existsSync(REPO_DIR)) {
  console.error(`CLAUDE_BRIDGE_REPO_DIR does not exist: ${REPO_DIR}`);
  process.exit(1);
}

function json(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
  });
  res.end(body);
}

function authorized(req) {
  const header = req.headers.authorization || '';
  const supplied = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!supplied) return false;
  const a = Buffer.from(supplied);
  const b = Buffer.from(TOKEN);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function readBody(req) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw new Error('body_too_large');
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function buildPrompt(task) {
  const guardrails = `You are working in the Kun Online repository as an implementation agent.\n\nHard rules:\n- Never modify or reset the production D1 database named kunonline.\n- Never run migrations, db:init, or destructive database commands against remote/production.\n- Never push to main. Work only in the current feature/development branch.\n- Prefer the preview database/preview worker for tests.\n- Before making changes, inspect the relevant files and git status.\n- After changes, run the narrowest relevant tests/checks and summarize exactly what changed, what was tested, and any remaining risk.\n- Do not expose secrets or tokens in output, commits, or files.\n`;
  return `${guardrails}\nTask from orchestrator:\n${task}`;
}

function runClaude({ task, mode = 'execute' }) {
  return new Promise((resolve) => {
    const id = randomUUID();
    const args = ['-p', buildPrompt(task), '--output-format', 'json', '--max-turns', String(MAX_TURNS)];

    if (MAX_BUDGET_USD) args.push('--max-budget-usd', MAX_BUDGET_USD);

    if (mode === 'review') {
      args.push('--permission-mode', 'plan', '--tools', 'Read,Bash');
      args.push('--allowedTools', 'Bash(git status *),Bash(git diff *),Bash(git log *),Bash(git branch *)');
    } else {
      // Auto mode is designed for unattended runs while retaining safety classification.
      args.push('--permission-mode', 'auto');
      args.push('--tools', 'Read,Edit,Write,Bash,Glob,Grep');
      args.push('--allowedTools',
        'Bash(git status *)',
        'Bash(git diff *)',
        'Bash(git log *)',
        'Bash(git branch *)',
        'Bash(git add *)',
        'Bash(git commit *)',
        'Bash(npm test *)',
        'Bash(npm run test *)',
        'Bash(node tests.mjs *)'
      );
    }

    const child = spawn(CLAUDE_BIN, args, {
      cwd: REPO_DIR,
      env: { ...process.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });

    child.on('error', (err) => resolve({ id, ok: false, error: err.message }));
    child.on('close', (code) => {
      let parsed = null;
      try { parsed = JSON.parse(stdout); } catch {}
      resolve({
        id,
        ok: code === 0,
        exit_code: code,
        result: parsed ?? stdout,
        stderr: stderr || undefined,
      });
    });
  });
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/health') {
    return json(res, 200, { ok: true, repo: REPO_DIR, claude_bin: CLAUDE_BIN });
  }

  if (!authorized(req)) return json(res, 401, { ok: false, error: 'unauthorized' });

  if (req.method === 'POST' && req.url === '/task') {
    try {
      const body = await readBody(req);
      if (typeof body.task !== 'string' || body.task.trim().length < 3) {
        return json(res, 400, { ok: false, error: 'task_required' });
      }
      const mode = body.mode === 'review' ? 'review' : 'execute';
      const result = await runClaude({ task: body.task.trim(), mode });
      return json(res, result.ok ? 200 : 500, result);
    } catch (err) {
      return json(res, err.message === 'body_too_large' ? 413 : 400, { ok: false, error: err.message });
    }
  }

  return json(res, 404, { ok: false, error: 'not_found' });
});

server.listen(PORT, HOST, () => {
  console.log(`Claude bridge listening on http://${HOST}:${PORT}`);
});
