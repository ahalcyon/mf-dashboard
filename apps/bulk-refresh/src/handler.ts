import type { BrowserSession } from "./browser.js";

export interface BulkRefreshResult {
  /** 一括更新をクリックした時刻 */
  startedAt: string;
  /** クリック直後に「更新中」だった口座の数。完了を待たないので参考値 */
  updatingCount: number;
}

/**
 * 金融機関の一括更新を開始する。完了は待たない。
 *
 * 待たないことがこのジョブの要点。更新にかかる時間は Money Forward と
 * 金融機関しだいで、1 口座が 14 分残ることもある。取り込み側がそれに
 * 付き合う理由は無いので、開始だけを別のジョブに切り出している。
 * 取り込みは後続のクロールが、その時点の状態に対して行う。
 */
export async function runBulkRefresh(session: BrowserSession): Promise<BulkRefreshResult> {
  // 値の import はすべて実行時に。init の 10 秒に収めるため（browser.ts 参照）。
  const [{ loginWithAuthState }, { info }, refresh] = await Promise.all([
    import("@mf-dashboard/crawler/auth/login"),
    import("@mf-dashboard/crawler/logger"),
    import("@mf-dashboard/crawler/scrapers/refresh"),
  ]);
  const { context, page } = session;

  await loginWithAuthState(page, context);
  await refresh.startBulkRefresh(page);
  const startedAt = new Date().toISOString();

  // 何口座が動き出したかだけ記録する。0 なら更新が始まっていない疑いがある。
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
    // 失敗しても後続のクロールは動く。取り込まれる値が前回の更新のままになるだけ。
    const { error } = await import("@mf-dashboard/crawler/logger");
    error("Bulk refresh failed:", err);
    throw err;
  }
}
