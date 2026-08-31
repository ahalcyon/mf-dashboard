/**
 * 定期クロールの入口。その時点の口座状態を取り込む。
 * CLI 版（src/index.ts）と同じ runCrawler を呼ぶ。
 */

/** Lambda の書き込み先。 */
const LAMBDA_STATE_PATH = "/tmp/crawler-run-state.json";

export interface CrawlSummary {
  runId: string;
  status: "success";
}

export interface CrawlEvent {
  source?: string;
}

export async function handler(event?: CrawlEvent): Promise<CrawlSummary> {
  // 重い import は実行時に読む。init は 10 秒で打ち切られる。
  const [
    { randomUUID },
    { createCrawlerProgressReporter },
    { loadCrawlerConfig },
    { error, info },
  ] = await Promise.all([
    import("node:crypto"),
    import("./crawler-progress.js"),
    import("./crawler-phases.js"),
    import("./logger.js"),
  ]);

  // history モードは ECS のバックフィルタスクが受け持つ。
  const config = loadCrawlerConfig();
  if (config.isHistoryMode) {
    throw new Error(
      "Refusing to run history mode on Lambda. Run the backfill task on ECS instead.",
    );
  }

  const runId = randomUUID();
  const source = event?.source ?? process.env.CRAWLER_RUN_SOURCE ?? "scheduled";
  info(`Crawl ${runId} started from ${source}`);

  const progress = await createCrawlerProgressReporter(
    process.env.CRAWLER_STATE_PATH ?? LAMBDA_STATE_PATH,
    { id: runId, source, startedAt: new Date().toISOString() },
  );

  const { runCrawler } = await import("./run.js");
  try {
    await runCrawler(progress);
    await progress.finish("success");
    info(`Crawl ${runId} finished from ${source}`);
    return { runId, status: "success" };
  } catch (err) {
    error(`Crawl ${runId} from ${source} failed:`, err);
    try {
      await progress.finish("failed");
    } catch (finishError) {
      error("Failed to record the terminal crawler state:", finishError);
    }
    // Lambda は throw しないと失敗として記録されない。
    throw err;
  }
}
