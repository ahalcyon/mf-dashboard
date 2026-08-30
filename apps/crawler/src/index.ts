import { randomUUID } from "node:crypto";
import { createCrawlerProgressReporter } from "./crawler-progress.js";
import { getCrawlerRunStatePath } from "./crawler-run-state.js";
import { error } from "./logger.js";
import { runCrawler } from "./run.js";

// 同時実行は ECS 側で防ぐ。
async function main() {
  const progress = await createCrawlerProgressReporter(
    process.env.CRAWLER_STATE_PATH ?? getCrawlerRunStatePath(),
    {
      id: randomUUID(),
      source: process.env.CRAWLER_RUN_SOURCE ?? "cli",
      startedAt: new Date().toISOString(),
    },
  );

  try {
    await runCrawler(progress);
    await progress.finish("success");
  } catch (err) {
    error("Crawler failed:", err);
    process.exitCode = 1;

    try {
      await progress.finish("failed");
    } catch (finishError) {
      error("Failed to record the terminal crawler state:", finishError);
    }
  }
}

void main();
