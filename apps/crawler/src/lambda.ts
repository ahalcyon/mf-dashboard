/**
 * 定期クロールの入口。
 *
 * 一括更新の開始は bulk-refresh Lambda が受け持ち、こちらはその時点の状態を
 * 取り込むだけなので 1 分強で終わる。15 分の上限は制約にならない（#93）。
 *
 * CLI 版（src/index.ts）と同じ runCrawler を呼ぶ。バックフィルは同じイメージを
 * ECS で CLI として起動する。分けないのは、バックフィルと定期クロールが違う
 * Chromium で描画するのを避けるため。
 */

/** Lambda で書けるのは /tmp だけ。既定のパスはイメージの中で読み取り専用。 */
const LAMBDA_STATE_PATH = "/tmp/crawler-run-state.json";

export interface CrawlSummary {
  runId: string;
  status: "success";
}

export async function handler(): Promise<CrawlSummary> {
  // 重い import は init の 10 秒に収めるため実行時に読む。
  const [{ randomUUID }, { createCrawlerProgressReporter }, { loadCrawlerConfig }, { error }] =
    await Promise.all([
      import("node:crypto"),
      import("./crawler-progress.js"),
      import("./crawler-phases.js"),
      import("./logger.js"),
    ]);

  // history モードは 20 か月ぶんを取りに行く。ここへ落ちてくるのは
  // SCRAPE_MODE の指定が外れたか、S3 のデータベースを取得できなかったとき。
  // 走らせても 15 分で切れて何も残らないので、始める前に止める。
  const config = loadCrawlerConfig();
  if (config.isHistoryMode) {
    throw new Error(
      "Refusing to run history mode on Lambda. Run the backfill task on ECS instead.",
    );
  }

  const runId = randomUUID();
  const progress = await createCrawlerProgressReporter(
    process.env.CRAWLER_STATE_PATH ?? LAMBDA_STATE_PATH,
    {
      id: runId,
      source: process.env.CRAWLER_RUN_SOURCE ?? "scheduled",
      startedAt: new Date().toISOString(),
    },
  );

  const { runCrawler } = await import("./run.js");
  try {
    await runCrawler(progress);
    await progress.finish("success");
    return { runId, status: "success" };
  } catch (err) {
    error("Crawler failed:", err);
    try {
      await progress.finish("failed");
    } catch (finishError) {
      error("Failed to record the terminal crawler state:", finishError);
    }
    // CLI は exitCode で伝えるが、Lambda は throw しないと失敗として記録されない。
    throw err;
  }
}
