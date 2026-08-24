#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const projectDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const envFile = join(projectDir, ".env");
const prefix = (process.env.SSM_PARAMETER_PREFIX || "/mf-dashboard").replace(/\/$/, "");

// Docker Compose が起動時の変数展開で必要とする値だけを .env へ書き出す。
// MF_EMAIL / MF_PASSWORD / MF_TOTP_SECRET は crawler が実行時に SSM から解決するため空のままにする。
const MANAGED = [["REFRESH_TOKEN", "refresh-token"]];

const TEMPLATE = `# Local-only setup. Cloudflare/Terraform values are intentionally omitted.

# --- MoneyForward credentials ---
# Leave a value empty to resolve it from AWS SSM Parameter Store instead.
MF_EMAIL=
MF_PASSWORD=
MF_TOTP_SECRET=

# SSM parameter prefix (defaults to /mf-dashboard)
# SSM_PARAMETER_PREFIX=/mf-dashboard

# --- Required: web -> crawler refresh auth ---
REFRESH_TOKEN=

# --- Optional: shorten the first test run ---
# MAX_WAIT_MINUTES=20
`;

const names = MANAGED.map(([, suffix]) => `${prefix}/${suffix}`);
console.log(`Fetching ${names.length} parameter(s) from ${prefix}/*`);

const response = JSON.parse(
  execFileSync(
    "aws",
    ["ssm", "get-parameters", "--with-decryption", "--output", "json", "--names", ...names],
    { encoding: "utf8" },
  ),
);

if (response.InvalidParameters?.length > 0) {
  console.error(`error: SSM parameters not found: ${response.InvalidParameters.join(", ")}`);
  process.exit(1);
}

const byName = new Map(response.Parameters.map((p) => [p.Name, p.Value]));
const values = new Map();
for (const [key, suffix] of MANAGED) {
  const value = byName.get(`${prefix}/${suffix}`);
  if (value === undefined) {
    continue;
  }
  if (/[\r\n]/.test(value)) {
    console.error(`error: ${key} contains a newline and cannot be written to .env`);
    process.exit(1);
  }
  values.set(key, value);
}

const existed = existsSync(envFile);
const lines = (existed ? readFileSync(envFile, "utf8") : TEMPLATE).split("\n");
const written = new Set();

// 既存行は位置とコメントを保ったまま値だけ差し替える
const merged = lines.map((line) => {
  const key = /^\s*([A-Za-z_][A-Za-z0-9_]*)=/.exec(line)?.[1];
  if (key === undefined || !values.has(key)) {
    return line;
  }
  written.add(key);
  return `${key}=${values.get(key)}`;
});

while (merged.length > 0 && merged.at(-1).trim() === "") {
  merged.pop();
}
for (const [key, value] of values) {
  if (!written.has(key)) {
    merged.push(`${key}=${value}`);
  }
}

writeFileSync(envFile, `${merged.join("\n")}\n`, { mode: 0o600 });
chmodSync(envFile, 0o600);

console.log(
  `${existed ? "Updated" : "Created"} .env with ${values.size} secret(s) (mode 600). ` +
    `MF_* stay empty and resolve from ${prefix}/* at runtime.`,
);
