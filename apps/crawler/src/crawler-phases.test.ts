import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { buildAccountIdMap } from "@mf-dashboard/db/repository/accounts";
import { saveScrapedDataBatch } from "@mf-dashboard/db/repository/save-scraped-data";
import {
  hasCashFlowPeriod,
  saveTransactionsForMonths,
  type TransactionPeriodReplacement,
} from "@mf-dashboard/db/repository/transactions";
import type { CashFlowSummary } from "@mf-dashboard/db/types";
import { beforeEach, describe, expect, test, vi } from "vitest";
import {
  getDebugScreenshotPath,
  loadCrawlerConfig,
  runCashFlowHistoryPhase,
  runInstitutionCategoryPhase,
  runSavePhase,
} from "./crawler-phases.js";
import { createCrawlerProgressReporter } from "./crawler-progress.js";
import { buildGroupOnlyScrapedData, buildScrapedData } from "./data-builder.js";
import { getHistoryMaxMonths } from "./history-months.js";
import type { ScrapeResult } from "./scraper.js";
import { scrapeCashFlowHistory } from "./scrapers/cash-flow-history.js";
import { switchGroup } from "./scrapers/group.js";
import { scrapeInstitutionCategories } from "./scrapers/institution-categories.js";

vi.mock("./data-builder.js", () => ({
  buildScrapedData: vi.fn<() => { kind: string }>(() => ({ kind: "full" })),
  buildGroupOnlyScrapedData: vi.fn<() => { kind: string }>(() => ({ kind: "group-only" })),
}));

vi.mock("@mf-dashboard/db/repository/accounts", () => ({
  buildAccountIdMap: vi.fn<() => Promise<Map<string, number>>>(),
  updateAccountCategory: vi.fn<() => Promise<void>>(),
}));

vi.mock("@mf-dashboard/db/repository/save-scraped-data", () => ({
  saveScrapedDataBatch: vi.fn<() => Promise<number[]>>(),
}));

// assertNonOverlappingTransactionRanges は純粋関数で、月ごとの保存が
// 期間の重なりを見逃さないことを確かめたいので本物を使う。
vi.mock("@mf-dashboard/db/repository/transactions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@mf-dashboard/db/repository/transactions")>()),
  hasCashFlowPeriod: vi.fn<() => Promise<boolean>>(),
  saveTransactionsForMonths: vi.fn<() => Promise<number[]>>(),
}));

vi.mock("./scrapers/cash-flow-history.js", () => ({
  scrapeCashFlowHistory: vi.fn<() => Promise<Array<{ month: string; data: CashFlowSummary }>>>(),
}));

vi.mock("./scrapers/group.js", () => ({
  NO_GROUP_ID: "0",
  isNoGroup: (groupId: string) => groupId === "0",
  switchGroup: vi.fn<() => Promise<void>>(),
}));

vi.mock("./scrapers/institution-categories.js", () => ({
  scrapeInstitutionCategories: vi.fn<() => Promise<Map<string, string>>>(),
}));

function cashFlow(month: string, description: string): CashFlowSummary {
  return {
    month,
    totalIncome: 0,
    totalExpense: 1200,
    balance: -1200,
    items: [
      {
        mfId: `${month}-${description}`,
        date: `${month}-01`,
        amount: 1200,
        type: "expense",
        accountName: "Account A",
        description,
        category: "未分類",
        subCategory: null,
        isTransfer: false,
        isExcludedFromCalculation: false,
      },
    ],
  };
}

beforeEach(() => {
  vi.mocked(buildScrapedData).mockClear();
  vi.mocked(buildGroupOnlyScrapedData).mockClear();
  vi.mocked(buildAccountIdMap).mockReset();
  vi.mocked(saveScrapedDataBatch).mockReset();
  vi.mocked(saveScrapedDataBatch).mockResolvedValue([]);
  vi.mocked(hasCashFlowPeriod).mockReset();
  vi.mocked(saveTransactionsForMonths).mockReset();
  vi.mocked(saveTransactionsForMonths).mockResolvedValue([]);
  vi.mocked(scrapeCashFlowHistory).mockReset();
  vi.mocked(scrapeInstitutionCategories).mockReset();
  vi.mocked(switchGroup).mockReset();
});

describe("runInstitutionCategoryPhase", () => {
  test("全口座の公式カテゴリを取得するためグループ未選択へ切り替える", async () => {
    const page = {};
    const categoryMap = new Map([["account-a", "銀行"]]);
    vi.mocked(scrapeInstitutionCategories).mockResolvedValue(categoryMap);

    await expect(
      runInstitutionCategoryPhase(page as Parameters<typeof runInstitutionCategoryPhase>[0]),
    ).resolves.toBe(categoryMap);

    expect(switchGroup).toHaveBeenCalledWith(page, "0");
    expect(scrapeInstitutionCategories).toHaveBeenCalledWith(page);
    expect(vi.mocked(switchGroup).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(scrapeInstitutionCategories).mock.invocationCallOrder[0]!,
    );
  });
});

describe("loadCrawlerConfig", () => {
  test("DBがある場合はmonth modeを既定にする", () => {
    const config = loadCrawlerConfig(
      {},
      () => true,
      () => true,
    );

    expect(config.scrapeMode).toBe("month");
    expect(config.isHistoryMode).toBe(false);
    expect(config.authState).toBe("configured");
  });

  test("DBがない場合はhistory modeを既定にする", () => {
    const config = loadCrawlerConfig(
      {},
      () => false,
      () => false,
    );

    expect(config.scrapeMode).toBe("history");
    expect(config.isHistoryMode).toBe(true);
    expect(config.authState).toBe("none");
  });

  test("環境変数の指定を優先する", () => {
    const env: NodeJS.ProcessEnv = {
      CLEANUP_GROUPS: "true",
      DB_PATH: "/tmp/test.db",
      DEBUG: "true",
      HEADED: "true",
      SCRAPE_MODE: "history",
      SKIP_REFRESH: "true",
    };

    const config = loadCrawlerConfig(
      env,
      (filePath) => filePath === "/tmp/test.db",
      () => false,
    );

    expect(config.skipRefresh).toBe(true);
    expect(config.cleanupGroups).toBe(true);
    expect(config.dbPath).toBe("/tmp/test.db");
    expect(config.dbExists).toBe(true);
    expect(config.scrapeMode).toBe("history");
    expect(config.isHistoryMode).toBe(true);
    expect(config.isDebug).toBe(true);
    expect(config.isHeaded).toBe(true);
  });
});

describe("getDebugScreenshotPath", () => {
  test("debug directory配下のerror画像パスを返す", () => {
    const debugDir = path.join("/tmp", "apps", "crawler", "debug");

    expect(getDebugScreenshotPath(1234567890, debugDir)).toBe(
      path.join(debugDir, "error-1234567890.png"),
    );
  });
});

describe("runSavePhase", () => {
  function scrapeResultWithNoGroup(): ScrapeResult {
    return {
      globalData: {} as ScrapeResult["globalData"],
      groupDataList: [
        { group: { id: "0", name: "グループ選択なし" } },
      ] as unknown as ScrapeResult["groupDataList"],
      defaultGroup: null,
    } as ScrapeResult;
  }

  test("ローカルへ保存したものと同じ内容を同期キューへ発行する", async () => {
    vi.mocked(saveScrapedDataBatch).mockResolvedValue([3]);
    const publisher = { publish: vi.fn<() => Promise<void>>().mockResolvedValue(undefined) };

    const savedCounts = await runSavePhase(
      {} as Parameters<typeof runSavePhase>[0],
      {} as Parameters<typeof runSavePhase>[1],
      scrapeResultWithNoGroup(),
      [],
      undefined,
      undefined,
      publisher as unknown as Parameters<typeof runSavePhase>[6],
    );

    expect(savedCounts).toEqual([3]);
    const [, savedBatch] = vi.mocked(saveScrapedDataBatch).mock.calls[0];
    expect(publisher.publish).toHaveBeenCalledWith("scraped-data", {
      kind: "scraped-data",
      ...savedBatch,
    });
  });

  // ローカルへ先に適用してから発行する、という順序が要点。逆にすると
  // 後続の分析フェーズが古い複製を読む。publisher を渡さない形では
  // 「発行しない」ことを観測できないので、順序はここで見る。
  test("ローカルへ適用してから同期キューへ発行する", async () => {
    const order: string[] = [];
    vi.mocked(saveScrapedDataBatch).mockImplementation(async () => {
      order.push("save");
      return [1];
    });
    const publisher = {
      publish: vi.fn<() => Promise<void>>(async () => {
        order.push("publish");
      }),
    };

    await runSavePhase(
      {} as Parameters<typeof runSavePhase>[0],
      {} as Parameters<typeof runSavePhase>[1],
      scrapeResultWithNoGroup(),
      [],
      undefined,
      undefined,
      publisher as unknown as Parameters<typeof runSavePhase>[6],
    );

    expect(order).toEqual(["save", "publish"]);
  });

  test("同期経路が無効でもローカルへの保存は行う", async () => {
    vi.mocked(saveScrapedDataBatch).mockResolvedValue([]);

    await expect(
      runSavePhase(
        {} as Parameters<typeof runSavePhase>[0],
        {} as Parameters<typeof runSavePhase>[1],
        scrapeResultWithNoGroup(),
      ),
    ).resolves.toEqual([]);

    expect(saveScrapedDataBatch).toHaveBeenCalledOnce();
  });
});

describe("runCashFlowHistoryPhase", () => {
  test("month modeでも遅延反映を取り込むため当月と直前期間を再取得する", async () => {
    vi.mocked(scrapeCashFlowHistory).mockResolvedValue([]);
    const publishMonth = vi.fn<() => Promise<number>>().mockResolvedValue(0);

    await runCashFlowHistoryPhase(
      {} as Parameters<typeof runCashFlowHistoryPhase>[0],
      {} as Parameters<typeof runCashFlowHistoryPhase>[1],
      { isHistoryMode: false },
      undefined,
      publishMonth,
    );

    expect(scrapeCashFlowHistory).toHaveBeenCalledWith(expect.anything(), 2, expect.anything());
    expect(hasCashFlowPeriod).not.toHaveBeenCalled();
    expect(publishMonth).not.toHaveBeenCalled();
  });

  test("history modeで既存期間が揃っていても当月と直前期間を再取得する", async () => {
    vi.mocked(hasCashFlowPeriod).mockResolvedValue(true);
    vi.mocked(scrapeCashFlowHistory).mockResolvedValue([]);

    await runCashFlowHistoryPhase({} as never, {} as never, { isHistoryMode: true });

    expect(scrapeCashFlowHistory).toHaveBeenCalledWith({}, 2, expect.any(Object));
  });

  test("締め日後は現在の会計期間月を起点に未取得期間を探す", async () => {
    vi.mocked(hasCashFlowPeriod).mockImplementation(async (_db, month) => month !== "2026-07");
    vi.mocked(scrapeCashFlowHistory).mockResolvedValue([]);

    await runCashFlowHistoryPhase({} as never, {} as never, {
      isHistoryMode: true,
      activeAccountingMonth: "2026-09",
    });

    expect(hasCashFlowPeriod).toHaveBeenCalledWith({}, "2026-07");
    expect(scrapeCashFlowHistory).toHaveBeenCalledWith({}, 3, expect.any(Object));
  });

  test("history modeでは未取得の最古会計期間まで取得する", async () => {
    const now = new Date("2026-08-31T14:59:59.000Z");
    vi.useFakeTimers();
    vi.setSystemTime(now);
    vi.mocked(hasCashFlowPeriod).mockResolvedValue(false);
    vi.mocked(scrapeCashFlowHistory).mockResolvedValue([]);

    try {
      await runCashFlowHistoryPhase({} as never, {} as never, { isHistoryMode: true });
      expect(scrapeCashFlowHistory).toHaveBeenCalledWith(
        {},
        getHistoryMaxMonths(now),
        expect.any(Object),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  test("初期 navigation 失敗を対象月 step に記録する", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "crawler-history-setup-failure-"));
    try {
      const progress = await createCrawlerProgressReporter(path.join(tempDir, "state.json"), {
        id: "run-a",
        source: "test",
        startedAt: "2026-07-01T00:00:00.000Z",
      });
      vi.mocked(buildAccountIdMap).mockResolvedValue(new Map());
      vi.mocked(hasCashFlowPeriod).mockResolvedValue(true);
      vi.mocked(switchGroup).mockRejectedValueOnce(new Error("navigation failed"));

      await expect(
        runCashFlowHistoryPhase({} as never, {} as never, { isHistoryMode: true }, progress),
      ).rejects.toThrow("navigation failed");

      expect(progress.getState().timeline).toEqual([
        expect.objectContaining({
          step: "cash_flow_history",
          status: "failed",
          metadata: expect.objectContaining({
            kind: "month",
            month: expect.stringMatching(/^\d{4}-\d{2}$/),
          }),
        }),
      ]);
      expect(scrapeCashFlowHistory).not.toHaveBeenCalled();
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  test("表示月と抽出月が異なっても開始済み month step を完了する", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "crawler-history-month-key-"));
    try {
      const progress = await createCrawlerProgressReporter(path.join(tempDir, "state.json"), {
        id: "run-a",
        source: "test",
        startedAt: "2026-07-01T00:00:00.000Z",
      });
      const monthData = cashFlow("2026-05", "Service A");
      vi.mocked(buildAccountIdMap).mockResolvedValue(new Map());
      vi.mocked(hasCashFlowPeriod).mockResolvedValue(true);
      vi.mocked(scrapeCashFlowHistory).mockImplementation(async (_page, _months, callbacks) => {
        const result = { month: "2026-05", progressMonth: "2026-06", data: monthData };
        await callbacks?.onMonthStart?.("2026-06");
        await callbacks?.onMonthScraped?.(result);
        return [result];
      });
      vi.mocked(saveTransactionsForMonths).mockResolvedValue([1]);

      await runCashFlowHistoryPhase({} as never, {} as never, { isHistoryMode: true }, progress);

      expect(progress.getState().timeline).toEqual([
        expect.objectContaining({
          status: "done",
          metadata: { kind: "month", month: "2026-06" },
        }),
      ]);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  test("後続月の取得失敗時に未保存の月 step をすべて failed にする", async () => {
    const page = {};
    const db = {};
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "crawler-history-later-failure-"));
    try {
      const progress = await createCrawlerProgressReporter(path.join(tempDir, "state.json"), {
        id: "run-a",
        source: "test",
        startedAt: "2026-07-01T00:00:00.000Z",
      });
      vi.mocked(buildAccountIdMap).mockResolvedValue(new Map());
      vi.mocked(hasCashFlowPeriod).mockResolvedValue(false);
      vi.mocked(scrapeCashFlowHistory).mockImplementation(async (_page, _months, callbacks) => {
        await callbacks?.onMonthStart?.("2026-06");
        await callbacks?.onMonthComplete?.("2026-06");
        await callbacks?.onMonthStart?.("2026-05");
        const failure = new Error("history page unavailable");
        await callbacks?.onMonthFailure?.("2026-05", failure);
        throw failure;
      });

      await expect(
        runCashFlowHistoryPhase(
          db as Parameters<typeof runCashFlowHistoryPhase>[0],
          page as Parameters<typeof runCashFlowHistoryPhase>[1],
          { isHistoryMode: true },
          progress,
        ),
      ).rejects.toThrow("history page unavailable");

      expect(progress.getState().timeline).toEqual([
        expect.objectContaining({
          status: "failed",
          metadata: { kind: "month", month: "2026-06" },
        }),
        expect.objectContaining({
          status: "failed",
          metadata: { kind: "month", month: "2026-05" },
        }),
      ]);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  test("履歴月の保存失敗を対象月の failed step にする", async () => {
    const page = {};
    const db = {};
    const monthData = cashFlow("2026-06", "Service A");
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "crawler-history-failure-"));
    try {
      const progress = await createCrawlerProgressReporter(path.join(tempDir, "state.json"), {
        id: "run-a",
        source: "test",
        startedAt: "2026-07-01T00:00:00.000Z",
      });
      vi.mocked(buildAccountIdMap).mockResolvedValue(new Map());
      vi.mocked(hasCashFlowPeriod).mockResolvedValue(true);
      vi.mocked(scrapeCashFlowHistory).mockImplementation(async (_page, _months, callbacks) => {
        const result = { month: "2026-06", data: monthData };
        await callbacks?.onMonthStart?.("2026-06");
        await callbacks?.onMonthScraped?.(result);
        return [result];
      });
      vi.mocked(saveTransactionsForMonths).mockRejectedValue(new Error("database unavailable"));

      await expect(
        runCashFlowHistoryPhase(
          db as Parameters<typeof runCashFlowHistoryPhase>[0],
          page as Parameters<typeof runCashFlowHistoryPhase>[1],
          { isHistoryMode: true },
          progress,
        ),
      ).rejects.toThrow("database unavailable");

      expect(progress.getState().timeline).toEqual([
        expect.objectContaining({
          step: "cash_flow_history",
          status: "failed",
          metadata: { kind: "month", month: "2026-06" },
        }),
      ]);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  test("後続月で失敗しても、取り終えた月はすでに保存されている", async () => {
    // まとめて保存していた頃は、途中で落ちると 1 か月も残らなかった。
    // データベースが空のままなので次回もまた history モードで同じ月数を
    // 取りに行き、同じところで落ちる。
    const publishMonth = vi.fn<(month: TransactionPeriodReplacement) => Promise<number>>();
    publishMonth.mockResolvedValue(1);
    vi.mocked(hasCashFlowPeriod).mockResolvedValue(false);
    vi.mocked(scrapeCashFlowHistory).mockImplementation(async (_page, _months, callbacks) => {
      await callbacks?.onMonthStart?.("2026-06");
      await callbacks?.onMonthScraped?.({ month: "2026-06", data: cashFlow("2026-06", "A") });
      await callbacks?.onMonthStart?.("2026-05");
      throw new Error("history page unavailable");
    });

    await expect(
      runCashFlowHistoryPhase(
        {} as never,
        {} as never,
        { isHistoryMode: true },
        undefined,
        publishMonth,
      ),
    ).rejects.toThrow("history page unavailable");

    expect(publishMonth).toHaveBeenCalledTimes(1);
    expect(publishMonth).toHaveBeenCalledWith(expect.objectContaining({ month: "2026-06" }));
  });

  test("期間が重なる月は保存せずに止める", async () => {
    // 会計期間は暦月と一致しないことがある。重なったまま置き換えると、
    // 直前に保存した月の取引が消える。1 回のバッチで見ていた検査を、
    // 月ごとの保存では run 内の累積で維持する。
    const publishMonth = vi.fn<(month: TransactionPeriodReplacement) => Promise<number>>();
    publishMonth.mockResolvedValue(1);
    vi.mocked(hasCashFlowPeriod).mockResolvedValue(false);
    vi.mocked(scrapeCashFlowHistory).mockImplementation(async (_page, _months, callbacks) => {
      const june = cashFlow("2026-06", "A");
      const may = cashFlow("2026-05", "B");
      await callbacks?.onMonthScraped?.({
        month: "2026-06",
        data: { ...june, periodStart: "2026-05-25", periodEnd: "2026-06-24" },
      });
      await callbacks?.onMonthScraped?.({
        month: "2026-05",
        data: { ...may, periodStart: "2026-04-25", periodEnd: "2026-05-26" },
      });
      return [];
    });

    await expect(
      runCashFlowHistoryPhase(
        {} as never,
        {} as never,
        { isHistoryMode: true },
        undefined,
        publishMonth,
      ),
    ).rejects.toThrow("Overlapping transaction date ranges");

    // 重なりを見つけた月は保存しない。先に入れた月は残る。
    expect(publishMonth).toHaveBeenCalledTimes(1);
    expect(publishMonth).toHaveBeenCalledWith(expect.objectContaining({ month: "2026-06" }));
  });

  test("history mode の各対象月を YYYY-MM metadata として記録する", async () => {
    const page = {};
    const db = {};
    const monthData = cashFlow("2026-06", "Service A");
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "crawler-history-progress-"));
    try {
      const progress = await createCrawlerProgressReporter(path.join(tempDir, "state.json"), {
        id: "run-a",
        source: "test",
        startedAt: "2026-07-01T00:00:00.000Z",
      });
      vi.mocked(buildAccountIdMap).mockResolvedValue(new Map());
      vi.mocked(hasCashFlowPeriod).mockResolvedValue(true);
      vi.mocked(scrapeCashFlowHistory).mockImplementation(async (_page, _months, callbacks) => {
        const result = { month: "2026-06", data: monthData };
        await callbacks?.onMonthStart?.("2026-06");
        await callbacks?.onMonthScraped?.(result);
        await callbacks?.onMonthComplete?.("2026-06");
        return [result];
      });
      vi.mocked(saveTransactionsForMonths).mockResolvedValue([1]);

      await runCashFlowHistoryPhase(
        db as Parameters<typeof runCashFlowHistoryPhase>[0],
        page as Parameters<typeof runCashFlowHistoryPhase>[1],
        { isHistoryMode: true },
        progress,
      );

      expect(progress.getState().timeline).toEqual([
        expect.objectContaining({
          step: "cash_flow_history",
          status: "done",
          metadata: { kind: "month", month: "2026-06" },
        }),
      ]);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});
