import type { Page } from "playwright";
import { describe, expect, test, vi } from "vitest";
import {
  getMaxWaitMinutes,
  getRefreshStatus,
  isPointerInterceptedError,
  navigateToAccountsPage,
  startBulkRefresh,
  summarizeRefreshRows,
  type RefreshStatusRow,
} from "./refresh.js";

describe("getMaxWaitMinutes", () => {
  test.each([undefined, "", "0", "-1", "Infinity", "NaN"])(
    "invalid MAX_WAIT_MINUTES=%s は default 値を返す",
    (value) => {
      expect(getMaxWaitMinutes({ MAX_WAIT_MINUTES: value })).toBe(20);
    },
  );

  test("有限の正数を返す", () => {
    expect(getMaxWaitMinutes({ MAX_WAIT_MINUTES: "12.5" })).toBe(12.5);
  });
});

describe("summarizeRefreshRows", () => {
  test.each<{
    expected: { incompleteAccounts: string[]; remainingCount: number };
    name: string;
    rows: RefreshStatusRow[];
  }>([
    {
      name: "更新中のアカウント名と件数を返す",
      rows: [
        { name: "Institution A", statuses: ["更新中"] },
        { name: "Institution B", statuses: ["正常"] },
        { name: "Institution C", statuses: ["更新中"] },
      ],
      expected: {
        incompleteAccounts: ["Institution A", "Institution C"],
        remainingCount: 2,
      },
    },
    {
      name: "複数の状態セルに更新中があれば1件として数える",
      rows: [{ name: "Institution A", statuses: ["更新中", "正常"] }],
      expected: { incompleteAccounts: ["Institution A"], remainingCount: 1 },
    },
    {
      name: "完全一致しない状態は更新中として数えない",
      rows: [
        { name: "Institution A", statuses: ["更新中 → 一時停止中"] },
        { name: "Institution B", statuses: ["再更新中"] },
      ],
      expected: { incompleteAccounts: [], remainingCount: 0 },
    },
    {
      name: "空の行一覧は0件を返す",
      rows: [],
      expected: { incompleteAccounts: [], remainingCount: 0 },
    },
    {
      name: "名称がない更新中行も件数には含める",
      rows: [{ name: null, statuses: [" 更新中 "] }],
      expected: { incompleteAccounts: [], remainingCount: 1 },
    },
    {
      name: "空白のみの名称は除外し更新中行を件数には含める",
      rows: [{ name: " \t ", statuses: ["更新中"] }],
      expected: { incompleteAccounts: [], remainingCount: 1 },
    },
  ])("$name", ({ rows, expected }) => {
    expect(summarizeRefreshRows(rows)).toEqual(expected);
  });
});

describe("getRefreshStatus", () => {
  test("service linkがない更新中行は先頭セルの名称を使う", async () => {
    const statusCells = {
      allTextContents: vi.fn<() => Promise<string[]>>().mockResolvedValue(["更新中"]),
    };
    const nameLink = {
      count: vi.fn<() => Promise<number>>().mockResolvedValue(0),
    };
    const firstCell = {
      textContent: vi.fn<() => Promise<string | null>>().mockResolvedValue(" Institution A "),
    };
    const allCells = {
      first: vi.fn<() => typeof firstCell>().mockReturnValue(firstCell),
    };
    const nameLinkLocator = {
      first: vi.fn<() => typeof nameLink>().mockReturnValue(nameLink),
    };
    const row = {
      locator: vi.fn<
        (selector: string) => typeof statusCells | typeof nameLinkLocator | typeof allCells
      >((selector) => {
        if (selector === "td.account-status") return statusCells;
        if (selector === "td.service a") return nameLinkLocator;
        return allCells;
      }),
    };
    const rows = {
      count: vi.fn<() => Promise<number>>().mockResolvedValue(1),
      nth: vi.fn<() => typeof row>().mockReturnValue(row),
    };
    const page = {
      locator: vi.fn<() => typeof rows>().mockReturnValue(rows),
    } as unknown as Page;

    await expect(getRefreshStatus(page)).resolves.toEqual({
      incompleteAccounts: ["Institution A"],
      remainingCount: 1,
    });
    expect(firstCell.textContent).toHaveBeenCalledOnce();
  });
});

describe("navigateToAccountsPage", () => {
  test.each([
    "page.goto: net::ERR_ABORTED at https://moneyforward.com/accounts",
    "page.goto: Timeout 30000ms exceeded.",
  ])("一時的な遷移エラーを1回だけ再試行する: %s", async (message) => {
    const goto = vi
      .fn<(...args: any[]) => any>()
      .mockRejectedValueOnce(new Error(message))
      .mockResolvedValueOnce(null);
    const isClosed = vi.fn<(...args: any[]) => any>().mockReturnValue(false);
    const retryPage = { goto, isClosed } as unknown as Page;

    await navigateToAccountsPage(retryPage, { retryDelayMs: 0 });

    expect(goto).toHaveBeenCalledTimes(2);
    expect(goto).toHaveBeenCalledWith(
      "https://moneyforward.com/accounts",
      expect.objectContaining({ timeout: 60000, waitUntil: "domcontentloaded" }),
    );
  });

  test("Page crashedは再試行せず元のエラーを返す", async () => {
    const error = new Error("page.goto: Page crashed");
    const goto = vi.fn<(...args: any[]) => any>().mockRejectedValue(error);
    const page = {
      goto,
      isClosed: vi.fn<(...args: any[]) => any>().mockReturnValue(false),
    } as unknown as Page;

    await expect(navigateToAccountsPage(page, { retryDelayMs: 0 })).rejects.toBe(error);
    expect(goto).toHaveBeenCalledOnce();
  });
});

const INTERCEPTED_CLICK_ERROR = `locator.click: Timeout 5000ms exceeded.
Call log:
  - waiting for locator('a:has-text("一括更新")').first()
  - attempting click action
    - <iframe title="Modal Message" class="ab-in-app-message"></iframe> from <div role="complementary" class="ab-iam-root v3 ab-show">…</div> subtree intercepts pointer events`;

describe("isPointerInterceptedError", () => {
  test.each([
    { name: "覆われたクリックのエラー", error: new Error(INTERCEPTED_CLICK_ERROR), expected: true },
    {
      name: "要素が見つからないタイムアウト",
      error: new Error("locator.click: Timeout 5000ms exceeded."),
      expected: false,
    },
    { name: "Errorではない値", error: "intercepts pointer events", expected: true },
    { name: "null", error: null, expected: false },
  ])("$name", ({ error, expected }) => {
    expect(isPointerInterceptedError(error)).toBe(expected);
  });
});

describe("startBulkRefresh", () => {
  function createPage(click: ReturnType<typeof vi.fn>) {
    const evaluate = vi.fn<(...args: any[]) => any>().mockResolvedValue(undefined);
    const page = {
      evaluate,
      goto: vi.fn<(...args: any[]) => any>().mockResolvedValue(null),
      locator: vi.fn<(...args: any[]) => any>().mockReturnValue({
        first: vi.fn<(...args: any[]) => any>().mockReturnValue({ click }),
      }),
      waitForLoadState: vi.fn<(...args: any[]) => any>().mockResolvedValue(undefined),
      waitForTimeout: vi.fn<(...args: any[]) => any>().mockResolvedValue(undefined),
    };
    return { evaluate, page: page as unknown as Page };
  }

  test("アプリ内メッセージに覆われたら取り除いて1回だけ再試行する", async () => {
    const click = vi
      .fn<(...args: any[]) => any>()
      .mockRejectedValueOnce(new Error(INTERCEPTED_CLICK_ERROR))
      .mockResolvedValueOnce(undefined);
    const { evaluate, page } = createPage(click);

    await startBulkRefresh(page);

    expect(click).toHaveBeenCalledTimes(2);
    expect(evaluate).toHaveBeenCalledWith(expect.any(Function), ".ab-iam-root");
  });

  test("覆われていなければ取り除かない", async () => {
    const click = vi.fn<(...args: any[]) => any>().mockResolvedValue(undefined);
    const { evaluate, page } = createPage(click);

    await startBulkRefresh(page);

    expect(click).toHaveBeenCalledOnce();
    expect(evaluate).not.toHaveBeenCalled();
  });

  test("他のクリック失敗は再試行せず元のエラーを返す", async () => {
    const error = new Error("locator.click: Timeout 5000ms exceeded.");
    const click = vi.fn<(...args: any[]) => any>().mockRejectedValue(error);
    const { evaluate, page } = createPage(click);

    await expect(startBulkRefresh(page)).rejects.toBe(error);
    expect(click).toHaveBeenCalledOnce();
    expect(evaluate).not.toHaveBeenCalled();
  });

  test("取り除いても覆われたままなら失敗させる", async () => {
    const error = new Error(INTERCEPTED_CLICK_ERROR);
    const click = vi.fn<(...args: any[]) => any>().mockRejectedValue(error);
    const { page } = createPage(click);

    await expect(startBulkRefresh(page)).rejects.toBe(error);
    expect(click).toHaveBeenCalledTimes(2);
  });
});
