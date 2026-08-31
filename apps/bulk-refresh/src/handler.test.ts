import { loginWithAuthState } from "@mf-dashboard/crawler/auth/login";
import {
  getRefreshStatus,
  navigateToAccountsPage,
  startBulkRefresh,
} from "@mf-dashboard/crawler/scrapers/refresh";
import { beforeEach, describe, expect, test, vi } from "vitest";
import type { BrowserSession } from "./browser.js";
import { runBulkRefresh } from "./handler.js";

vi.mock("@mf-dashboard/crawler/auth/login", () => ({
  loginWithAuthState: vi.fn<() => Promise<void>>(),
}));
vi.mock("@mf-dashboard/crawler/logger", () => ({
  error: vi.fn<() => void>(),
  info: vi.fn<() => void>(),
}));
vi.mock("@mf-dashboard/crawler/scrapers/refresh", () => ({
  getRefreshStatus:
    vi.fn<() => Promise<{ incompleteAccounts: string[]; remainingCount: number }>>(),
  navigateToAccountsPage: vi.fn<() => Promise<void>>(),
  startBulkRefresh: vi.fn<() => Promise<void>>(),
}));

const session = {} as BrowserSession;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getRefreshStatus).mockResolvedValue({ incompleteAccounts: [], remainingCount: 3 });
});

describe("runBulkRefresh", () => {
  test("ログインしてから一括更新を開始する", async () => {
    const order: string[] = [];
    vi.mocked(loginWithAuthState).mockImplementation(async () => {
      order.push("login");
    });
    vi.mocked(startBulkRefresh).mockImplementation(async () => {
      order.push("refresh");
    });

    await runBulkRefresh(session);

    expect(order).toEqual(["login", "refresh"]);
  });

  test("完了を待たない", async () => {
    await runBulkRefresh(session);

    expect(navigateToAccountsPage).toHaveBeenCalledOnce();
    expect(getRefreshStatus).toHaveBeenCalledOnce();
  });

  test("動き出した口座数を返す", async () => {
    const result = await runBulkRefresh(session);

    expect(result.updatingCount).toBe(3);
    expect(Number.isNaN(Date.parse(result.startedAt))).toBe(false);
  });

  test("1 件も動き出さなくても失敗にはしない", async () => {
    vi.mocked(getRefreshStatus).mockResolvedValue({ incompleteAccounts: [], remainingCount: 0 });

    await expect(runBulkRefresh(session)).resolves.toMatchObject({ updatingCount: 0 });
  });

  test("ログインに失敗したら一括更新をクリックしない", async () => {
    vi.mocked(loginWithAuthState).mockRejectedValue(new Error("auth failed"));

    await expect(runBulkRefresh(session)).rejects.toThrow("auth failed");
    expect(startBulkRefresh).not.toHaveBeenCalled();
  });
});
