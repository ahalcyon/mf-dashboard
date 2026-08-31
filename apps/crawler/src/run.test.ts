import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
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
} from "./crawler-phases.js";
import { CRAWLER_STEPS, createCrawlerProgressReporter } from "./crawler-progress.js";
import { runCrawler } from "./run.js";
import { createGroupScope } from "./scrapers/group.js";

vi.mock("@mf-dashboard/db", () => ({ closeDb: vi.fn<() => void>() }));
vi.mock("./crawler-phases.js", () => ({
  handleCrawlerFailure: vi.fn<() => void>(),
  publishHistoryMonth: vi.fn<() => Promise<number>>(),
  runAuthPhase: vi.fn<() => void>(),
  runCashFlowHistoryPhase: vi.fn<() => void>(),
  runInstitutionCategoryPhase: vi.fn<() => Map<string, string>>(),
  runLoadPhase: vi.fn<() => void>(),
  runNotificationPhase: vi.fn<() => void>(),
  runSavePhase: vi.fn<() => void>(),
  runScrapePhase: vi.fn<() => void>(),
  runSetupPhase: vi.fn<() => void>(),
}));
vi.mock("./scrapers/group.js", () => ({ createGroupScope: vi.fn<() => void>() }));

let tempDir: string;

beforeEach(async () => {
  vi.clearAllMocks();
  tempDir = await mkdtemp(path.join(os.tmpdir(), "crawler-run-progress-"));
  vi.mocked(runLoadPhase).mockReturnValue({
    skipRefresh: false,
    cleanupGroups: false,
    authState: "configured",
    dbPath: "/tmp/demo.db",
    dbExists: true,
    scrapeMode: "month",
    isHistoryMode: false,
    isDebug: false,
    isHeaded: false,
  });
  vi.mocked(runSetupPhase).mockResolvedValue({
    db: {} as never,
    browser: { close: vi.fn<() => Promise<void>>() } as never,
    context: {} as never,
    page: {} as never,
  });
  vi.mocked(createGroupScope).mockResolvedValue({
    originalGroup: null,
    [Symbol.asyncDispose]: vi.fn<() => Promise<void>>(),
  });
  vi.mocked(runNotificationPhase).mockResolvedValue(null);
  vi.mocked(runSavePhase).mockResolvedValue([]);
  vi.mocked(runInstitutionCategoryPhase).mockResolvedValue(new Map([["account-a", "銀行"]]));
  vi.mocked(publishHistoryMonth).mockResolvedValue(0);
  vi.mocked(runCashFlowHistoryPhase).mockResolvedValue(undefined);
  vi.mocked(runScrapePhase).mockImplementation(async (_page, _config, progress) => {
    for (const [step, metadata] of [
      [CRAWLER_STEPS.groupList],
      [CRAWLER_STEPS.refresh],
      [CRAWLER_STEPS.registeredAccounts],
      [CRAWLER_STEPS.portfolio],
      [CRAWLER_STEPS.liabilities],
      [CRAWLER_STEPS.monthlyCashFlow, { month: "2026-07" }],
      [CRAWLER_STEPS.groupData, { groupName: "Group A" }],
    ] as const) {
      const stepId = await progress.startStep(step, metadata);
      await progress.completeStep(stepId);
    }
    return {
      defaultGroup: null,
      globalData: {
        registeredAccounts: { accounts: [] },
        portfolio: { items: [], totalAssets: 0 },
        liabilities: { items: [], totalLiabilities: 0 },
        cashFlow: {
          month: "2026-07",
          totalIncome: 0,
          totalExpense: 0,
          balance: 0,
          items: [],
        },
        refreshResult: { completed: true, incompleteAccounts: [] },
      },
      groupDataList: [],
    };
  });
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe("runCrawler progress", () => {
  test("認証失敗時はスクレイプを開始しない", async () => {
    const authError = new Error("Login failed");
    vi.mocked(runAuthPhase).mockRejectedValueOnce(authError);
    const progress = await createCrawlerProgressReporter(path.join(tempDir, "state.json"), {
      id: "run-a",
      source: "test",
      startedAt: "2026-07-01T00:00:00.000Z",
    });

    await expect(runCrawler(progress)).rejects.toBe(authError);

    expect(runScrapePhase).not.toHaveBeenCalled();
    expect(createGroupScope).not.toHaveBeenCalled();
    expect(handleCrawlerFailure).toHaveBeenCalledWith(
      authError,
      expect.anything(),
      expect.anything(),
    );
  });

  test("atomic database save失敗を database save step に記録する", async () => {
    const progress = await createCrawlerProgressReporter(path.join(tempDir, "state.json"), {
      id: "run-a",
      source: "test",
      startedAt: "2026-07-01T00:00:00.000Z",
    });
    vi.mocked(runSavePhase).mockRejectedValueOnce(new Error("database cleanup failed"));

    await expect(runCrawler(progress)).rejects.toThrow("database cleanup failed");

    expect(progress.getState().timeline).toContainEqual(
      expect.objectContaining({ step: "database_save", status: "failed" }),
    );
  });

  test("通常成功でユーザー向けの全 step を順に記録する", async () => {
    const progress = await createCrawlerProgressReporter(path.join(tempDir, "state.json"), {
      id: "run-a",
      source: "test",
      startedAt: "2026-07-01T00:00:00.000Z",
    });

    await runCrawler(progress);
    await progress.finish("success");

    expect(progress.getState().runStatus).toBe("success");
    expect(progress.getState().timeline.map(({ step, status }) => ({ step, status }))).toEqual([
      { step: "authentication", status: "done" },
      { step: "group_list", status: "done" },
      { step: "moneyforward_refresh", status: "done" },
      { step: "registered_accounts", status: "done" },
      { step: "portfolio", status: "done" },
      { step: "liabilities", status: "done" },
      { step: "cash_flow_history", status: "done" },
      { step: "group_data", status: "done" },
      { step: "institution_categories", status: "done" },
      { step: "database_save", status: "done" },
      { step: "notification", status: "done" },
    ]);
    expect(runAuthPhase).toHaveBeenCalledOnce();
    expect(runSavePhase).toHaveBeenCalledOnce();
    expect(runInstitutionCategoryPhase).toHaveBeenCalledOnce();
    expect(runCashFlowHistoryPhase).toHaveBeenCalledOnce();
    expect(runCashFlowHistoryPhase).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ activeAccountingMonth: "2026-07" }),
      expect.anything(),
      expect.anything(),
    );
  });

  test("グループ復元を完了してから成功通知を送る", async () => {
    const dispose = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    vi.mocked(createGroupScope).mockResolvedValueOnce({
      originalGroup: null,
      [Symbol.asyncDispose]: dispose,
    });
    const progress = await createCrawlerProgressReporter(path.join(tempDir, "state.json"), {
      id: "run-a",
      source: "test",
      startedAt: "2026-07-01T00:00:00.000Z",
    });

    await runCrawler(progress);

    expect(dispose).toHaveBeenCalledOnce();
    expect(dispose.mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(runNotificationPhase).mock.invocationCallOrder[0]!,
    );
  });

  test("グループ復元に失敗した場合は成功通知を実行しない", async () => {
    const restoreError = new Error("Group switch timed out");
    vi.mocked(createGroupScope).mockResolvedValueOnce({
      originalGroup: null,
      [Symbol.asyncDispose]: vi.fn<() => Promise<void>>().mockRejectedValue(restoreError),
    });
    const progress = await createCrawlerProgressReporter(path.join(tempDir, "state.json"), {
      id: "run-a",
      source: "test",
      startedAt: "2026-07-01T00:00:00.000Z",
    });

    await expect(runCrawler(progress)).rejects.toThrow("Group switch timed out");

    expect(runNotificationPhase).not.toHaveBeenCalled();
    expect(handleCrawlerFailure).toHaveBeenCalledWith(
      restoreError,
      expect.anything(),
      expect.anything(),
    );
  });

  test("crawlとグループ復元が両方失敗した場合は元のcrawl errorを保持する", async () => {
    const crawlError = new Error("portfolio scrape failed");
    const restoreError = new Error("Group switch timed out");
    vi.mocked(runScrapePhase).mockRejectedValueOnce(crawlError);
    vi.mocked(createGroupScope).mockResolvedValueOnce({
      originalGroup: null,
      [Symbol.asyncDispose]: vi.fn<() => Promise<void>>().mockRejectedValue(restoreError),
    });
    const progress = await createCrawlerProgressReporter(path.join(tempDir, "state.json"), {
      id: "run-a",
      source: "test",
      startedAt: "2026-07-01T00:00:00.000Z",
    });

    await expect(runCrawler(progress)).rejects.toBe(crawlError);
    expect(handleCrawlerFailure).toHaveBeenCalledWith(
      crawlError,
      expect.anything(),
      expect.anything(),
    );
  });

  test("history replacementsをcurrent dataと同じsave phaseへ渡す", async () => {
    vi.mocked(runLoadPhase).mockReturnValue({
      skipRefresh: false,
      cleanupGroups: false,
      authState: "configured",
      dbPath: "/tmp/demo.db",
      dbExists: true,
      scrapeMode: "history",
      isHistoryMode: true,
      isDebug: false,
      isHeaded: false,
    });
    const historyMonth = { items: [], month: "2026-06" };
    vi.mocked(runCashFlowHistoryPhase).mockImplementation(
      async (_db, _page, _config, _progress, publishMonth) => {
        if (!publishMonth) throw new Error("publishMonth is required");
        await publishMonth(historyMonth);
      },
    );
    const progress = await createCrawlerProgressReporter(path.join(tempDir, "state.json"), {
      id: "run-a",
      source: "test",
      startedAt: "2026-07-01T00:00:00.000Z",
    });

    await runCrawler(progress);

    // 口座や残高は履歴とは別に、履歴の取得より先に保存する。
    expect(runSavePhase).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      [],
      undefined,
      new Map([["account-a", "銀行"]]),
      null,
    );
    // 履歴は月ごとに発行する。まとめてではない。
    expect(publishHistoryMonth).toHaveBeenCalledWith(expect.anything(), historyMonth, null);
  });
});
