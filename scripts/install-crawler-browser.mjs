#!/usr/bin/env node
// crawler のスクレイピングとローカルの E2E で使う Chromium を用意する。
// CI では Playwright のコンテナイメージに同梱のものを使う。

import { spawnSync } from "node:child_process";

if (process.env.CI) {
  process.exit(0);
}

const result = spawnSync(
  "pnpm",
  ["--filter", "@mf-dashboard/crawler", "exec", "playwright", "install", "chromium"],
  { stdio: "inherit", shell: process.platform === "win32" },
);

process.exit(result.status ?? 1);
