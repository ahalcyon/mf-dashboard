import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { initDb, type Db } from "@mf-dashboard/db";
import { buildAccountIdMap } from "@mf-dashboard/db/repository/accounts";
import { saveScrapedDataBatch } from "@mf-dashboard/db/repository/save-scraped-data";
import {
  assertNonOverlappingTransactionRanges,
  hasCashFlowPeriod,
  saveTransactionsForMonths,
  type TransactionPeriodReplacement,
} from "@mf-dashboard/db/repository/transactions";
import { encodeScrapedDataPayload } from "@mf-dashboard/db/sync/message";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { loginWithAuthState } from "./auth/login.js";
import { hasAuthState } from "./auth/state.js";
import { createBrowserContext } from "./browser/context.js";
import { chromiumLaunchArgs } from "./browser/launch-args.js";
import {
  CRAWLER_STEPS,
  normalizeCrawlerError,
  type CrawlerProgressReporter,
} from "./crawler-progress.js";
import { buildScrapedData, buildGroupOnlyScrapedData } from "./data-builder.js";
import {
  getHistoryMaxMonthsFromAnchor,
  getHistoryMonth,
  getHistoryMonthFromAnchor,
} from "./history-months.js";
import { runHooks } from "./hooks/runner.js";
import { debug, error, info, log, phase, warn } from "./logger.js";
import { sendFailureNotifications, sendSuccessNotifications } from "./notification.js";
import { scrapeAllGroups, type GroupData, type ScrapeResult } from "./scraper.js";
import { scrapeCashFlowHistory } from "./scrapers/cash-flow-history.js";
import { isNoGroup, switchGroup, NO_GROUP_ID } from "./scrapers/group.js";
import { scrapeInstitutionCategories } from "./scrapers/institution-categories.js";
import type { SyncPublisher } from "./sync/publisher.js";

const DEFAULT_ENV_PATH = path.resolve(import.meta.dirname, "../../../.env");
const DEFAULT_DB_PATH = path.join(import.meta.dirname, "../../../data/moneyforward.db");
const DEBUG_DIR = path.resolve(import.meta.dirname, "../debug");

export interface CrawlerConfig {
  skipRefresh: boolean;
  cleanupGroups: boolean;
  authState: "configured" | "none";
  dbPath: string;
  dbExists: boolean;
  scrapeMode: string;
  isHistoryMode: boolean;
  isDebug: boolean;
  isHeaded: boolean;
}

export interface CrawlerRuntime {
  db: Db;
  browser: Browser;
  context: BrowserContext;
  page: Page;
}

export function runLoadPhase(): CrawlerConfig {
  phase("Load");
  loadEnvFile();

  const config = loadCrawlerConfig();
  logCrawlerOptions(config);
  return config;
}

function loadEnvFile(envPath = DEFAULT_ENV_PATH): void {
  try {
    process.loadEnvFile(envPath);
  } catch {
    // .env file not found (e.g., CI environment)
  }
}

export function loadCrawlerConfig(
  env: NodeJS.ProcessEnv = process.env,
  fileExists: (filePath: string) => boolean = existsSync,
  authStateExists: () => boolean = hasAuthState,
): CrawlerConfig {
  const skipRefresh = env.SKIP_REFRESH === "true";
  const cleanupGroups = env.CLEANUP_GROUPS === "true";
  const dbPath = env.DB_PATH || DEFAULT_DB_PATH;
  const dbExists = fileExists(dbPath);
  const scrapeMode = env.SCRAPE_MODE || (dbExists ? "month" : "history");

  return {
    skipRefresh,
    cleanupGroups,
    authState: authStateExists() ? "configured" : "none",
    dbPath,
    dbExists,
    scrapeMode,
    isHistoryMode: scrapeMode === "history",
    isDebug: env.DEBUG === "true",
    isHeaded: env.HEADED === "true",
  };
}

function logCrawlerOptions(config: CrawlerConfig): void {
  phase("Options");
  log(`SKIP_REFRESH:   ${config.skipRefresh}`);
  info(`CLEANUP_GROUPS: ${config.cleanupGroups}`);
  log(`SCRAPE_MODE:    ${config.scrapeMode} (DB exists: ${config.dbExists})`);
  log(`DEBUG:          ${config.isDebug}`);
  log(`HEADED:         ${config.isHeaded}`);
  log(`AUTH_STATE:     ${config.authState}`);
}

export async function runSetupPhase(config: CrawlerConfig): Promise<CrawlerRuntime> {
  phase("Setup");
  info("Initializing database");
  const db = await initDb();

  let browser: Browser | null = null;
  try {
    log("Launching browser");
    browser = await chromium.launch({
      headless: !config.isHeaded,
      args: chromiumLaunchArgs(),
    });

    const context = await createBrowserContext(browser, { useAuthState: true });
    const page = await context.newPage();

    return {
      db,
      browser,
      context,
      page,
    };
  } catch (err) {
    if (browser) {
      await browser.close();
    }
    throw err;
  }
}

export async function runAuthPhase(page: Page, context: BrowserContext): Promise<void> {
  phase("Auth");
  info("Authenticating");
  await loginWithAuthState(page, context);

  info("Running hooks");
  await runHooks(page);
}

export async function runScrapePhase(
  page: Page,
  config: Pick<CrawlerConfig, "skipRefresh">,
  progress: CrawlerProgressReporter,
): Promise<ScrapeResult> {
  phase("Scrape");
  const scrapeResult = await scrapeAllGroups(page, progress, {
    skipRefresh: config.skipRefresh,
  });

  info(`Scraped ${scrapeResult.groupDataList.length} groups`);
  for (const [groupIndex, groupData] of scrapeResult.groupDataList.entries()) {
    log(`  - Group ${groupIndex + 1}${isNoGroup(groupData.group.id) ? " (no group)" : ""}`);
  }

  return scrapeResult;
}

export async function runSavePhase(
  db: Db,
  page: Page,
  scrapeResult: ScrapeResult,
  historyMonths: TransactionPeriodReplacement[] = [],
  cleanupGroupIds?: string[],
  institutionCategories?: ReadonlyMap<string, string>,
  publisher: SyncPublisher | null = null,
): Promise<number[]> {
  phase("Save");
  const noGroupData = scrapeResult.groupDataList.find((groupData) => isNoGroup(groupData.group.id));
  let fullData: ReturnType<typeof buildScrapedData> | undefined;

  if (noGroupData) {
    info("Saving full data for no-group view");
    fullData = buildScrapedData(scrapeResult.globalData, noGroupData);
    debug("Full scraped data prepared");
  } else {
    warn("No no-group data found; skipped full data save");
  }

  const groupOnlyData = scrapeResult.groupDataList.filter(
    (groupData) => !isNoGroup(groupData.group.id),
  );

  const groupOnlyScrapedData = groupOnlyData.map((groupData, groupIndex) => {
    info(`Saving group-only data for group ${groupIndex + 1}`);
    return buildGroupOnlyScrapedData(groupData);
  });

  const batch = {
    cleanupGroupIds,
    fullData,
    groupOnlyData: groupOnlyScrapedData,
    historyMonths,
    institutionCategories,
  };

  // ローカルの複製へ先に適用する。
  const savedCounts = await saveScrapedDataBatch(db, batch);

  // S3 のデータベースへ適用するのは writer。
  await publisher?.publish("scraped-data", encodeScrapedDataPayload(batch));

  return savedCounts;
}

/**
 * 履歴の 1 か月ぶんだけを保存して発行する。
 *
 * 取引は口座名から account_id を引くので、口座が先に入っていることが前提。
 * 呼び出し側は runSavePhase を済ませてからここへ来ること。
 */
export async function publishHistoryMonth(
  db: Db,
  month: TransactionPeriodReplacement,
  publisher: SyncPublisher | null = null,
): Promise<number> {
  const batch = { groupOnlyData: [], historyMonths: [month] };

  const [savedCount] = await saveScrapedDataBatch(db, batch);
  await publisher?.publish("scraped-data", encodeScrapedDataPayload(batch));

  return savedCount ?? 0;
}

export async function runInstitutionCategoryPhase(page: Page): Promise<Map<string, string>> {
  phase("Institution Categories");
  await switchGroup(page, NO_GROUP_ID);
  log("Scraping institution categories");
  const categoryMap = await scrapeInstitutionCategories(page);
  info(`Scraped ${categoryMap.size} account categories`);
  return categoryMap;
}

export async function runCashFlowHistoryPhase(
  db: Db,
  page: Page,
  config: Pick<CrawlerConfig, "isHistoryMode"> & { activeAccountingMonth?: string },
  progress?: CrawlerProgressReporter,
  publishMonth: (month: TransactionPeriodReplacement) => Promise<number> = async (month) => {
    const accountIdMap = await buildAccountIdMap(db);
    const [savedCount] = await saveTransactionsForMonths(db, [month], accountIdMap);
    return savedCount ?? 0;
  },
): Promise<void> {
  phase("Cash Flow History");

  const now = new Date();
  const activeAccountingMonth = config.activeAccountingMonth ?? getHistoryMonth(now, 0);
  const maxMonths = getHistoryMaxMonthsFromAnchor(activeAccountingMonth);

  // Always refresh the current and previous periods so transactions posted late by an
  // institution are incorporated. History mode extends that window to the oldest gap.
  let monthsToFetch = Math.min(2, maxMonths);
  if (config.isHistoryMode) {
    for (let i = 2; i < maxMonths; i++) {
      const month = getHistoryMonthFromAnchor(activeAccountingMonth, i);
      if (!(await hasCashFlowPeriod(db, month))) {
        monthsToFetch = i + 1;
      }
    }
  }

  info(`Fetching ${monthsToFetch} months`);

  const monthSteps = new Map<string, string>();
  const setupMonth = activeAccountingMonth;
  let setupStepId: string | null = null;
  if (progress) {
    setupStepId = await progress.startStep(CRAWLER_STEPS.monthlyCashFlow, { month: setupMonth });
    monthSteps.set(setupMonth, setupStepId);
  }
  async function failRunningMonthSteps(failure: unknown): Promise<void> {
    if (!progress) return;

    const runningStepIds = new Set(
      progress
        .getState()
        .timeline.filter(({ status }) => status === "running")
        .map(({ id }) => id),
    );
    for (const stepId of monthSteps.values()) {
      if (runningStepIds.has(stepId)) {
        await progress.failStep(stepId, normalizeCrawlerError(failure, "monthly_cash_flow_failed"));
      }
    }
  }

  // 取り終えた月から順に保存する。期間の重なり検査は run 内の累積で行う。
  // 会計期間は暦月と一致しないことがある。
  const publishedMonths: TransactionPeriodReplacement[] = [];

  try {
    await switchGroup(page, NO_GROUP_ID);
    await scrapeCashFlowHistory(page, monthsToFetch, {
      onMonthStart: async (month) => {
        if (!progress) return;
        if (monthSteps.has(month)) {
          setupStepId = null;
          return;
        }
        if (setupStepId) {
          monthSteps.delete(setupMonth);
          monthSteps.set(month, setupStepId);
          await progress.updateStep(setupStepId, { month });
          setupStepId = null;
          return;
        }
        monthSteps.set(month, await progress.startStep(CRAWLER_STEPS.monthlyCashFlow, { month }));
      },
      onMonthScraped: async ({ month, progressMonth = month, data: monthData }) => {
        let stepId = monthSteps.get(progressMonth);
        if (progress && !stepId) {
          stepId = await progress.startStep(CRAWLER_STEPS.monthlyCashFlow, {
            month: progressMonth,
          });
          monthSteps.set(progressMonth, stepId);
        }

        const replacement: TransactionPeriodReplacement = {
          dateRange:
            monthData.periodStart && monthData.periodEnd
              ? { from: monthData.periodStart, to: monthData.periodEnd }
              : undefined,
          isComplete: monthData.isComplete,
          items: monthData.items,
          month,
        };
        assertNonOverlappingTransactionRanges([...publishedMonths, replacement]);

        const savedCount = await publishMonth(replacement);
        publishedMonths.push(replacement);
        log(`  ${month}: saved ${savedCount} transactions`);
        if (progress && stepId) await progress.completeStep(stepId);
      },
      onMonthFailure: async (month, failure) => {
        const stepId = monthSteps.get(month);
        if (progress && stepId) {
          await progress.failStep(
            stepId,
            normalizeCrawlerError(failure, "monthly_cash_flow_failed"),
          );
        }
      },
    });
  } catch (failure) {
    await failRunningMonthSteps(failure);
    throw failure;
  }
}

export async function runNotificationPhase(
  groupDataList: GroupData[],
  defaultGroup: ScrapeResult["defaultGroup"],
): Promise<Error | null> {
  phase("Notification");

  try {
    await sendSuccessNotifications(groupDataList, defaultGroup);
    return null;
  } catch (err) {
    error("Failed to send notification:", err);
    return err instanceof Error ? err : new Error(String(err));
  }
}

export async function handleCrawlerFailure(
  err: unknown,
  page: Page | undefined,
  config: Pick<CrawlerConfig, "isDebug">,
): Promise<void> {
  error("Error occurred:", err);

  if (config.isDebug && page) {
    try {
      const screenshotPath = await saveDebugScreenshot(page);
      info(`Debug screenshot saved to ${screenshotPath}`);
    } catch (screenshotError) {
      error("Failed to save debug screenshot:", screenshotError);
    }
  }

  const errorForNotification = err instanceof Error ? err : new Error(String(err));
  try {
    await sendFailureNotifications(errorForNotification);
  } catch (notificationError) {
    error("Failed to send error notification:", notificationError);
  }
}

async function saveDebugScreenshot(page: Page, timestamp = Date.now()): Promise<string> {
  const screenshotPath = getDebugScreenshotPath(timestamp);
  await mkdir(path.dirname(screenshotPath), { recursive: true });
  await page.screenshot({ path: screenshotPath, fullPage: true });
  return screenshotPath;
}

export function getDebugScreenshotPath(timestamp = Date.now(), debugDir = DEBUG_DIR): string {
  return path.join(debugDir, `error-${timestamp}.png`);
}
