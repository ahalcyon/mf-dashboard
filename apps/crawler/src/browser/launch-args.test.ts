import { describe, expect, test } from "vitest";
import { chromiumLaunchArgs, LAMBDA_CHROMIUM_ARGS } from "./launch-args.js";

const LAMBDA_ENV = { AWS_LAMBDA_FUNCTION_NAME: "mf-dashboard-crawl" };

describe("chromiumLaunchArgs", () => {
  // Fargate では既定のままで動く。要らない引数を足して挙動を変えたくない。
  test("Lambda でなければ何も足さない", () => {
    expect(chromiumLaunchArgs({})).toEqual([]);
  });

  test("Lambda では既定の一式を渡す", () => {
    expect(chromiumLaunchArgs(LAMBDA_ENV)).toEqual(LAMBDA_CHROMIUM_ARGS);
  });

  // イメージの再ビルドは 10 分かかる。組み合わせを詰めるのに要る。
  test("CHROMIUM_ARGS で上書きできる", () => {
    expect(chromiumLaunchArgs({ ...LAMBDA_ENV, CHROMIUM_ARGS: "--a, --b" })).toEqual([
      "--a",
      "--b",
    ]);
  });

  test("空の CHROMIUM_ARGS は無視して既定に戻す", () => {
    expect(chromiumLaunchArgs({ ...LAMBDA_ENV, CHROMIUM_ARGS: "  " })).toEqual(
      LAMBDA_CHROMIUM_ARGS,
    );
  });
});

describe("LAMBDA_CHROMIUM_ARGS", () => {
  // 落とすとビルドもデプロイも通ったうえで、最初の invoke で初めて壊れる。
  test.each([
    // サンドボックスに要るユーザー名前空間を作れない
    "--no-sandbox",
    // /dev/shm がほとんど無い
    "--disable-dev-shm-usage",
    // zygote の fork が Lambda の制約に引っかかり Target crashed になる
    "--no-zygote",
  ])("%s を落とさない", (arg) => {
    expect(LAMBDA_CHROMIUM_ARGS).toContain(arg);
  });

  // タブ 1 枚なら通るが、複数のターゲットを扱うと Playwright の CDP
  // セッション処理が Assertion error で落ちる。実際にクロールで踏んだ。
  test("--single-process は入れない", () => {
    expect(LAMBDA_CHROMIUM_ARGS).not.toContain("--single-process");
  });
});
