/**
 * Lambda の実行環境で Chromium を立てるための引数。
 *
 * - `--no-sandbox`: Lambda ではサンドボックスに必要なユーザー名前空間を作れない
 * - `--disable-dev-shm-usage`: /dev/shm がほとんど無いため、共有メモリではなく
 *   /tmp を使わせる
 * - `--no-zygote`: zygote による fork が Lambda の制約に引っかかる。既定のままだと
 *   ブラウザは起動できてもタブの生成が `Target crashed` になる
 * - `--disable-gpu`: GPU は無い。探しに行かせるだけ無駄
 *
 * `--single-process` は入れない。タブ 1 枚なら通るが、Playwright の CDP
 * セッション処理と噛み合わず、クロールのように複数のターゲットを扱うと
 * `Assertion error` で落ちる。
 *
 * Fargate では既定のままで動くので、この配列は Lambda 側だけの都合。
 */
export const LAMBDA_CHROMIUM_ARGS = [
  "--no-sandbox",
  "--disable-dev-shm-usage",
  "--no-zygote",
  "--disable-gpu",
];

/**
 * 実行環境に応じた Chromium の起動引数。
 *
 * `CHROMIUM_ARGS` を置けば上書きできる。イメージの再ビルドは 10 分かかるのに対し
 * Lambda の環境変数の更新は数秒で済むため、組み合わせを詰めるときに要る。
 */
export function chromiumLaunchArgs(env: NodeJS.ProcessEnv = process.env): string[] {
  const override = env.CHROMIUM_ARGS?.trim();
  if (override) {
    return override
      .split(",")
      .map((arg) => arg.trim())
      .filter(Boolean);
  }

  // Lambda かどうかは実行環境が必ず入れるこの変数で判る
  return env.AWS_LAMBDA_FUNCTION_NAME ? LAMBDA_CHROMIUM_ARGS : [];
}
