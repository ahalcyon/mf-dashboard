/**
 * Lambda で Chromium を立てるための引数。
 *
 * `--single-process` を加えると、複数のターゲットを扱ったときに Playwright が
 * `Assertion error` で落ちる。
 */
export const LAMBDA_CHROMIUM_ARGS = [
  "--no-sandbox",
  "--disable-dev-shm-usage",
  "--no-zygote",
  "--disable-gpu",
];

/**
 * 実行環境に応じた Chromium の起動引数。`CHROMIUM_ARGS` で上書きできる。
 */
export function chromiumLaunchArgs(env: NodeJS.ProcessEnv = process.env): string[] {
  const override = env.CHROMIUM_ARGS?.trim();
  if (override) {
    return override
      .split(",")
      .map((arg) => arg.trim())
      .filter(Boolean);
  }

  return env.AWS_LAMBDA_FUNCTION_NAME ? LAMBDA_CHROMIUM_ARGS : [];
}
