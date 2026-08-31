import type { BrowserSession } from "./browser.js";

export interface BulkRefreshResult {
  /** 一括更新をクリックした時刻 */
  startedAt: string;
  /** クリック直後に「更新中」だった口座の数。完了を待たないので参考値 */
  updatingCount: number;
}

/**
 * 金融機関の一括更新を開始する。完了は待たない。
 * 取り込みは後続のクロールが、その時点の状態に対して行う。
 */
export async function runBulkRefresh(session: BrowserSession): Promise<BulkRefreshResult> {
  const [{ loginWithAuthState }, { info }, refresh] = await Promise.all([
    import("@mf-dashboard/crawler/auth/login"),
    import("@mf-dashboard/crawler/logger"),
    import("@mf-dashboard/crawler/scrapers/refresh"),
  ]);
  const { context, page } = session;

  await loginWithAuthState(page, context);
  await refresh.startBulkRefresh(page);
  const startedAt = new Date().toISOString();

  await refresh.navigateToAccountsPage(page);
  const { remainingCount } = await refresh.getRefreshStatus(page);
  info(`Bulk refresh started; ${remainingCount} account(s) updating`);

  return { startedAt, updatingCount: remainingCount };
}

export async function handler(): Promise<BulkRefreshResult> {
  const { withBrowser } = await import("./browser.js");
  try {
    return await withBrowser(runBulkRefresh);
  } catch (err) {
    const { error } = await import("@mf-dashboard/crawler/logger");
    error("Bulk refresh failed:", err);
    throw err;
  }
}
