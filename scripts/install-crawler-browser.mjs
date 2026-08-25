#!/usr/bin/env node
// crawler のスクレイピングとローカルの E2E で使う Chromium を用意する。
//
// CI では入れない。ブラウザーを実際に起動するのは web の E2E だけで、
// そのジョブは Playwright のコンテナイメージで動くため /ms-playwright に
// 同梱済みのものを使う。それでも root の postinstall で毎回落としていたため、
// node を使う全ジョブが 282MB のキャッシュ復元を払っていた。

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
