// 値としての import は init の 10 秒に収まらない。tsx が playwright と
// crawler のモジュールをまとめて変換するため、ハンドラの読み込みだけで
// 上限を超える。実行時まで遅らせる（詳細は withBrowser のコメント）。
import type { Browser, BrowserContext, Page } from "playwright";

export interface BrowserSession {
  context: BrowserContext;
  page: Page;
}

type Launch = () => Promise<Browser>;
type OpenSession = (browser: Browser) => Promise<BrowserSession>;

async function openSession(browser: Browser): Promise<BrowserSession> {
  const { createBrowserContext } = await import("@mf-dashboard/crawler/browser/context");
  const context = await createBrowserContext(browser, { useAuthState: true });
  return { context, page: await context.newPage() };
}

/**
 * ブラウザの後始末を呼び出し側に任せない。
 *
 * playwright と crawler のモジュールはここから動的に読む。Lambda の init は
 * 10 秒で打ち切られ、モジュールスコープで読むと超えてしまう。超えても Lambda は
 * invoke の中で init をやり直すので動きはするが、コールドスタートのたびに
 * 10 秒を捨てたうえでログに timeout が残る。
 *
 * Lambda のコンテナは呼び出しをまたいで生き残るので、閉じ忘れた Chromium は
 * 次の呼び出しまで残り、メモリを食ったまま積み上がる。失敗した場合ほど
 * 閉じる必要がある。
 */
export async function withBrowser<T>(
  run: (session: BrowserSession) => Promise<T>,
  deps: { launch?: Launch; open?: OpenSession } = {},
): Promise<T> {
  const launch =
    deps.launch ??
    (async () => {
      const [{ chromium }, { chromiumLaunchArgs }] = await Promise.all([
        import("playwright"),
        import("@mf-dashboard/crawler/browser/launch-args"),
      ]);
      return chromium.launch({ args: chromiumLaunchArgs() });
    });
  const open = deps.open ?? openSession;

  const browser = await launch();
  try {
    return await run(await open(browser));
  } finally {
    await browser.close();
  }
}
