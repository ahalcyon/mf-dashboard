import { closeDb } from "@mf-dashboard/db";
import { getDbPath } from "@mf-dashboard/db/db-path";
import { buildCleanupGroupIds } from "./cleanup-groups.js";
import {
  handleCrawlerFailure,
  publishHistoryMonth,
  runAuthPhase,
  runCashFlowHistoryPhase,
  runInstitutionCategoryPhase,
  runLoadPhase,
  runNotificationPhase,
  runSavePhase,
  runScrapePhase,
  runSetupPhase,
  type CrawlerRuntime,
} from "./crawler-phases.js";
import {
  CRAWLER_STEPS,
  normalizeCrawlerError,
  runCrawlerStep,
  type CrawlerProgressReporter,
} from "./crawler-progress.js";
import { info, warn } from "./logger.js";
import { createGroupScope } from "./scrapers/group.js";
import { destroySnsClient } from "./sns.js";
import { buildRunId, loadSyncConfig } from "./sync/config.js";
import { SyncPublisher } from "./sync/publisher.js";

async function disposeGroupScope(
  groupScope: Awaited<ReturnType<typeof createGroupScope>>,
  crawlFailed: boolean,
): Promise<void> {
  try {
    await groupScope[Symbol.asyncDispose]();
  } catch (restoreError) {
    if (!crawlFailed) throw restoreError;
    warn("Group restoration also failed after the crawl had already failed");
  }
}

/** 印の送信が失敗しても投げず、警告に留める。 */
async function publishCrawlCompleteQuietly(publisher: SyncPublisher | null): Promise<void> {
  try {
    await publisher?.publishCrawlComplete();
  } catch (error) {
    warn(`Failed to publish the crawl-complete marker: ${String(error)}`);
  }
}

export async function runCrawler(progress: CrawlerProgressReporter): Promise<void> {
  // S3 のデータベースの複製を落として読み書きし、書き込みは payload として発行する。
  // スクレイプモードはデータベースの有無から決まるため、設定を読む前に取得する。
  const syncConfig = loadSyncConfig();
  const publisher = syncConfig ? new SyncPublisher(syncConfig, buildRunId()) : null;
  if (publisher) {
    await publisher.downloadDatabase(getDbPath());
  }

  const config = runLoadPhase();
  let runtime: CrawlerRuntime | null = null;

  try {
    const activeRuntime = await runSetupPhase(config);
    runtime = activeRuntime;
    await runCrawlerStep(
      progress,
      CRAWLER_STEPS.authentication,
      () => runAuthPhase(activeRuntime.page, activeRuntime.context),
      { failureCode: "auth_failed" },
    );

    let scrapeResult: Awaited<ReturnType<typeof runScrapePhase>>;
    let originalGroup: Awaited<ReturnType<typeof createGroupScope>>["originalGroup"];
    const groupScope = await createGroupScope(activeRuntime.page);
    let crawlFailed = false;
    try {
      originalGroup = groupScope.originalGroup;
      scrapeResult = await runScrapePhase(activeRuntime.page, config, progress);
      const cleanupResult = config.cleanupGroups
        ? buildCleanupGroupIds(scrapeResult.groupDataList)
        : null;
      if (config.cleanupGroups && !cleanupResult) {
        warn(
          "Skipped group cleanup because no groups were scraped; group selector retrieval may have failed.",
        );
      }
      const institutionCategories = await runCrawlerStep(
        progress,
        CRAWLER_STEPS.institutionCategories,
        () => runInstitutionCategoryPhase(activeRuntime.page),
      );
      // 取引は口座名から account_id を引くため、残高と口座を先に保存する。
      await runCrawlerStep(progress, CRAWLER_STEPS.databaseSave, async () => {
        await runSavePhase(
          activeRuntime.db,
          activeRuntime.page,
          scrapeResult,
          [],
          cleanupResult?.ids,
          institutionCategories,
          publisher,
        );
        if (cleanupResult) info("Cleaned up groups not found in MoneyForward");
      });
      await runCashFlowHistoryPhase(
        activeRuntime.db,
        activeRuntime.page,
        {
          ...config,
          activeAccountingMonth: scrapeResult.globalData.cashFlow.month,
        },
        progress,
        (month) => publishHistoryMonth(activeRuntime.db, month, publisher),
      );
    } catch (err) {
      crawlFailed = true;
      throw err;
    } finally {
      await disposeGroupScope(groupScope, crawlFailed);
    }
    const notificationStep = await progress.startStep(CRAWLER_STEPS.notification);
    const notificationFailure = await runNotificationPhase(
      scrapeResult.groupDataList,
      originalGroup,
    );
    if (notificationFailure) {
      await progress.warnStep(
        notificationStep,
        normalizeCrawlerError(notificationFailure, "notification_failed"),
      );
    } else {
      await progress.completeStep(notificationStep);
    }

    info("Completed!");
  } catch (err) {
    await handleCrawlerFailure(err, runtime?.page, config);
    throw err;
  } finally {
    try {
      if (runtime) {
        await runtime.browser.close();
      }
    } finally {
      // クロール 1 回につき 1 回、静的サイトの再ビルドを起こす印。
      await publishCrawlCompleteQuietly(publisher);
      publisher?.destroy();
      // AWS SDK のクライアントを閉じる
      destroySnsClient();
      closeDb();
    }
  }
}
