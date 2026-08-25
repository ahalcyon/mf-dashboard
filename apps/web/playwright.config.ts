import { resolve } from "node:path";
import { defineConfig, devices } from "@playwright/test";

const demoDbPath = resolve(__dirname, "../../data/demo.db");
const isCI = !!process.env.CI;
const serverCommand = isCI ? "node .next/standalone/apps/web/server.js" : "pnpm dev";
// デモ DB の確認はサーバーを起動する瞬間に行う。設定の読み込み時に落とすと、
// 設定を読むだけの knip のようなツールまで巻き込む。
const webServerCommand = `node scripts/require-demo-db.mjs && ${serverCommand}`;

// CI は事前ビルド済みの standalone サーバーを起動するため即座に応答するが、
// ローカルは `next dev` がリクエストを受けてから該当ルートをコンパイルする。
// 初回の待ち時間はマシンによっては 60 秒の既定値を超えるため、ローカルだけ緩める。
const webServerTimeout = isCI ? 60_000 : 180_000;
const expectTimeout = isCI ? 5_000 : 20_000;
// 1 つのテストの中でも初訪問のルートはその場でコンパイルされる。既定の 30 秒だと
// 遷移を数回挟むテストがコンパイル待ちだけで使い切るため、ローカルだけ延ばす。
const testTimeout = isCI ? 30_000 : 60_000;

// 既定は 3000。worktree を並べて複数の E2E を同時に走らせるとポートが衝突し、
// 先に立っていたサーバーが落とされるため、E2E_PORT で退避できるようにする。
const port = Number(process.env.E2E_PORT ?? 3000);
const baseURL = `http://localhost:${port}`;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  timeout: testTimeout,
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
