import { resolve } from "node:path";
import { defineConfig, devices } from "@playwright/test";

const demoDbPath = resolve(__dirname, "../../data/demo.db");
const webServerCommand = process.env.CI ? "node .next/standalone/apps/web/server.js" : "pnpm dev";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 2,
  reporter: process.env.CI ? "blob" : "html",
  use: {
    baseURL: "http://localhost:3000",
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
      url: "http://localhost:3000",
      env: {
        DB_PATH: demoDbPath,
        DEMO_MODE: "true",
        HOSTNAME: "127.0.0.1",
        PORT: "3000",
      },
      reuseExistingServer: false,
    },
  ],
});
