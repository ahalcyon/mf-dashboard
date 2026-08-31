#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { closeSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import { dirname, join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

// Terraform の local-exec から呼ばれ、イメージをビルドして ECR へ push する。

const projectDir = join(dirname(fileURLToPath(import.meta.url)), "..");

const { values } = parseArgs({
  options: {
    dockerfile: { type: "string" },
    repository: { type: "string" },
    tag: { type: "string" },
    cli: { type: "string", default: "docker" },
    region: { type: "string", default: "ap-northeast-1" },
  },
});

for (const name of ["dockerfile", "repository", "tag"]) {
  if (!values[name]) {
    process.stderr.write(`publish-image: --${name} is required\n`);
    process.exit(1);
  }
}

const { cli, dockerfile, region, repository, tag } = values;
const registry = repository.split("/")[0];
const image = `${repository}:${tag}`;

function run(command, args, options = {}) {
  execFileSync(command, args, { cwd: projectDir, stdio: "inherit", ...options });
}

// Terraform は同じ apply の中で複数のイメージを並行して作ろうとするが、
// WSL Container CLI は同時ビルドを捌けずに失敗する。ここで直列化する。
const lockPath = join(os.tmpdir(), "mf-dashboard-image-build.lock");
const LOCK_TIMEOUT_MS = 45 * 60 * 1000;

function isRunning(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}

async function acquireLock() {
  const deadline = Date.now() + LOCK_TIMEOUT_MS;

  while (Date.now() < deadline) {
    try {
      closeSync(openSync(lockPath, "wx"));
      writeFileSync(lockPath, String(process.pid));
      return () => rmSync(lockPath, { force: true });
    } catch (error) {
      if (error.code !== "EEXIST") throw error;

      // ビルドが異常終了して残ったロックを掴んだままにしない
      const owner = Number(readFileSync(lockPath, "utf8").trim());
      if (!Number.isInteger(owner) || !isRunning(owner)) {
        rmSync(lockPath, { force: true });
        continue;
      }
      await sleep(2000);
    }
  }

  throw new Error(`Timed out waiting for another image build to finish (${lockPath})`);
}

// WSL Container CLI はログインを registry のサブコマンドに置いている
const loginCommand = cli.includes("wslc") ? ["registry", "login"] : ["login"];

const releaseLock = await acquireLock();
try {
  console.log(`Logging in to ${registry}`);
  const password = execFileSync("aws", ["ecr", "get-login-password", "--region", region], {
    encoding: "utf8",
  }).trim();
  run(cli, [...loginCommand, "--username", "AWS", "--password-stdin", registry], {
    input: password,
    stdio: ["pipe", "inherit", "inherit"],
  });

  console.log(`Building ${image}`);
  run(cli, ["build", "-f", dockerfile, "-t", image, "."]);

  console.log(`Pushing ${image}`);
  run(cli, ["push", image]);

  console.log(`Published ${image}`);
} finally {
  releaseLock();
}
