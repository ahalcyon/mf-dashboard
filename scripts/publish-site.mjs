#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// S3 上のデータベースを取得し、その中身を焼き込んだ静的サイトを発行する。
// フロントは実行時の DB 接続を持たないため、データを変えるにはこの手順が要る。
//
// 接続先は環境変数を優先し、無ければ terraform output から読む。
// AWS 上の site-builder タスクはタスク定義から環境変数で受け取り、
// 手元から叩く場合は terraform output で解決される。

const projectDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const terraformDir = join(projectDir, "terraform", "aws");
const databasePath = join(projectDir, "data", "moneyforward.db");
const outDir = join(projectDir, "apps", "web", "out");

function run(command, args, options = {}) {
  execFileSync(command, args, { cwd: projectDir, stdio: "inherit", ...options });
}

function fromTerraform(name) {
  const value = execFileSync("terraform", [`-chdir=${terraformDir}`, "output", "-raw", name], {
    encoding: "utf8",
  }).trim();
  if (!value) throw new Error(`terraform output ${name} is empty`);
  return value;
}

function setting(variable, outputName) {
  return process.env[variable]?.trim() || fromTerraform(outputName);
}

const dataBucket = setting("DATA_BUCKET", "data_bucket");
const siteBucket = setting("SITE_BUCKET", "site_bucket");
const distributionId = setting("CLOUDFRONT_DISTRIBUTION_ID", "cloudfront_distribution_id");
const siteUrl = setting("SITE_URL", "site_url");

console.log(`Fetching the database from ${dataBucket}`);
mkdirSync(dirname(databasePath), { recursive: true });
run("aws", [
  "s3",
  "cp",
  `s3://${dataBucket}/db/moneyforward.db`,
  databasePath,
  "--only-show-errors",
]);

console.log("Building the static site");
run("pnpm", ["--filter", "@mf-dashboard/web", "build"], {
  env: {
    ...process.env,
    // apps/web を作業ディレクトリとして next build が走るため、そこからの相対パス
    DB_PATH: "../../data/moneyforward.db",
    // next.config.ts はこのフラグで output: "export" に切り替わる
    DEMO_MODE: "true",
    DASHBOARD_URL: siteUrl,
  },
});

console.log(`Publishing to ${siteBucket}`);
// ハッシュ付きのアセットだけ長期キャッシュにし、HTML は毎回検証させる
run("aws", [
  "s3",
  "sync",
  outDir,
  `s3://${siteBucket}`,
  "--delete",
  "--exclude",
  "_next/static/*",
  "--cache-control",
  "public, max-age=0, must-revalidate",
  "--only-show-errors",
]);
run("aws", [
  "s3",
  "sync",
  join(outDir, "_next", "static"),
  `s3://${siteBucket}/_next/static`,
  "--cache-control",
  "public, max-age=31536000, immutable",
  "--only-show-errors",
]);
run("aws", [
  "cloudfront",
  "create-invalidation",
  "--distribution-id",
  distributionId,
  "--paths",
  "/*",
  "--no-cli-pager",
  "--query",
  "Invalidation.Status",
  "--output",
  "text",
]);

console.log(`Published ${siteUrl}`);
