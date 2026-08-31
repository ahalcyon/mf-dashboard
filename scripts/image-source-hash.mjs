#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Terraform の external データソースとして呼ばれ、指定パス配下のソースから
// 決定的なハッシュを返す。イメージのタグに使う。
//
// ファイルの列挙は git が行い、--others --exclude-standard により
// まだ add していない新規ファイルも含む。

const projectDir = join(dirname(fileURLToPath(import.meta.url)), "..");

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

let query;
try {
  query = JSON.parse(readFileSync(0, "utf8"));
} catch {
  fail("image-source-hash: expected a JSON query on stdin");
}

const paths = (query.paths ?? "")
  .split(",")
  .map((path) => path.trim())
  .filter(Boolean);
if (paths.length === 0) fail("image-source-hash: paths must not be empty");

const files = execFileSync(
  "git",
  ["ls-files", "--cached", "--others", "--exclude-standard", "-z", "--", ...paths],
  { cwd: projectDir, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
)
  .split("\0")
  .filter(Boolean)
  .sort();

if (files.length === 0) fail(`image-source-hash: no files matched ${paths.join(", ")}`);

// パスも混ぜる。ファイルの移動や削除でもハッシュが変わる。
const digest = createHash("sha256");
for (const file of files) {
  digest.update(file);
  digest.update("\0");
  digest.update(
    createHash("sha256")
      .update(readFileSync(join(projectDir, file)))
      .digest(),
  );
}

process.stdout.write(JSON.stringify({ hash: digest.digest("hex").slice(0, 16) }));
