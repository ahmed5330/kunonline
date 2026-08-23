import { readFile } from "node:fs/promises";

const configPath = "wrangler.production.toml";
const workflowPath = ".github/workflows/production.yml";

const [config, workflow] = await Promise.all([
  readFile(configPath, "utf8"),
  readFile(workflowPath, "utf8"),
]);

const requiredConfig = [
  ['Worker name', /^name\s*=\s*"kunonline"\s*$/m],
  ['Worker entry point', /^main\s*=\s*"src\/index\.js"\s*$/m],
  ['Production environment marker', /^APP_ENV\s*=\s*"production"\s*$/m],
  ['D1 binding', /^binding\s*=\s*"DB"\s*$/m],
  ['Production D1 name', /^database_name\s*=\s*"kunonline"\s*$/m],
  ['Production D1 ID', /^database_id\s*=\s*"c426601d-182f-486e-a5c1-bb1bca0ecb0b"\s*$/m],
];

for (const [label, pattern] of requiredConfig) {
  if (!pattern.test(config)) {
    throw new Error(`Production safety check failed: ${label} is missing or unexpected.`);
  }
}

if (/wrangler\s+d1|npm\s+run\s+db:|npx\s+wrangler\s+d1/i.test(workflow)) {
  throw new Error("Production safety check failed: the production workflow contains a database command.");
}

if (!/wrangler\s+deploy\s+--config\s+wrangler\.production\.toml/.test(workflow)) {
  throw new Error("Production safety check failed: deployment is not pinned to wrangler.production.toml.");
}

console.log("Production configuration safety checks passed. No database command is present.");
