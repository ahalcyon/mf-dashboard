import type { Browser } from "playwright";
import { describe, expect, test, vi } from "vitest";
import { LAMBDA_CHROMIUM_ARGS, withBrowser, type BrowserSession } from "./browser.js";

function fakeBrowser(): Browser & { close: ReturnType<typeof vi.fn> } {
  const close = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
  return { close } as unknown as Browser & { close: typeof close };
}

const open = async (): Promise<BrowserSession> => ({}) as BrowserSession;

describe("withBrowser", () => {
  test("処理の戻り値をそのまま返す", async () => {
    const browser = fakeBrowser();

    const result = await withBrowser(async () => "done", {
      launch: async () => browser,
      open,
    });

    expect(result).toBe("done");
    expect(browser.close).toHaveBeenCalledOnce();
  });

  // Lambda のコンテナは呼び出しをまたいで生き残る。閉じ忘れた Chromium は
  // 次の呼び出しまで残り、メモリを食ったまま積み上がる。
  test("処理が失敗してもブラウザを閉じる", async () => {
    const browser = fakeBrowser();

    await expect(
      withBrowser(
        async () => {
          throw new Error("login failed");
        },
        { launch: async () => browser, open },
      ),
    ).rejects.toThrow("login failed");

    expect(browser.close).toHaveBeenCalledOnce();
  });

  test("セッションを開けなくてもブラウザを閉じる", async () => {
    const browser = fakeBrowser();
    const run = vi.fn<() => Promise<void>>();

    await expect(
      withBrowser(run, {
        launch: async () => browser,
        open: async () => {
          throw new Error("context creation failed");
        },
      }),
    ).rejects.toThrow("context creation failed");

    expect(browser.close).toHaveBeenCalledOnce();
    expect(run).not.toHaveBeenCalled();
  });
});

describe("LAMBDA_CHROMIUM_ARGS", () => {
  // どれも Lambda では外せない。落とすとビルドもデプロイも通ったうえで、
  // 最初の invoke で初めて壊れる。
  test.each([
    // サンドボックスに要るユーザー名前空間を作れない
    "--no-sandbox",
    // /dev/shm がほとんど無い
    "--disable-dev-shm-usage",
    // 子プロセスを生成できず、タブの生成が Target crashed になる
    "--single-process",
    "--no-zygote",
  ])("%s を落とさない", (arg) => {
    expect(LAMBDA_CHROMIUM_ARGS).toContain(arg);
  });
});
