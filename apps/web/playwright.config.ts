import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig, devices } from "@playwright/test";

const demoDbPath = resolve(__dirname, "../../data/demo.db");
const isCI = !!process.env.CI;
const webServerCommand = isCI ? "node .next/standalone/apps/web/server.js" : "pnpm dev";

// CI は事前ビルド済みの standalone サーバーを起動するため即座に応答するが、
// ローカルは `next dev` がリクエストを受けてから該当ルートをコンパイルする。
// 初回の待ち時間はマシンによっては 60 秒の既定値を超えるため、ローカルだけ緩める。
const webServerTimeout = isCI ? 60_000 : 180_000;
const expectTimeout = isCI ? 5_000 : 20_000;

// 既定は 3000。worktree を並べて複数の E2E を同時に走らせるとポートが衝突し、
// 先に立っていたサーバーが落とされるため、E2E_PORT で退避できるようにする。
const port = Number(process.env.E2E_PORT ?? 3000);
const baseURL = `http://localhost:${port}`;

if (!existsSync(demoDbPath)) {
  throw new Error(
    [
      `デモデータベースが見つかりません: ${demoDbPath}`,
      "E2E は `pnpm test:e2e:web` から実行してください。turbo の `^build:demo` が data/demo.db を生成します。",
      "`playwright test` を直接起動すると生成が飛ばされ、全ページが `no such table: groups` で 500 になります。",
    ].join("\n"),
  );
}

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  workers: 2,
  reporter: isCI ? "blob" : "html",
  expect: { timeout: expectTimeout },
  use: {
    baseURL,
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "mobile-chrome",
      use: { ...devices["Pixel 7"] },
    },
  ],
  webServer: [
    {
      command: webServerCommand,
      url: baseURL,
      env: {
        DB_PATH: demoDbPath,
        DEMO_MODE: "true",
        HOSTNAME: "127.0.0.1",
        PORT: String(port),
      },
      reuseExistingServer: false,
      timeout: webServerTimeout,
    },
  ],
});
