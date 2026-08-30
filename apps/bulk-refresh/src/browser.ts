// playwright と crawler のモジュールは実行時に読む。init は 10 秒で打ち切られる。
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
 * ブラウザを開き、処理の後に必ず閉じる。
 *
 * playwright と crawler のモジュールはここから動的に読む。Lambda の init は
 * 10 秒で打ち切られる。
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
