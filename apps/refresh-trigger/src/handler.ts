import { InvokeCommand, LambdaClient } from "@aws-sdk/client-lambda";
import type { LambdaFunctionURLEvent, LambdaFunctionURLResult } from "aws-lambda";
import { loadConfig } from "./config.js";
import { isRefreshPath, toResponse, type RefreshOutcome } from "./result.js";

/**
 * ダッシュボードの「金融機関データを更新」に応じる。
 *
 * ボタンの名前どおり 2 つのことをする。金融機関の一括更新を始めることと、
 * その時点の状態を取り込むクロールを走らせること。クロールは更新の完了を
 * 待たない（#93）ため、押した直後に見えるのは「すでに更新が終わっていた分」で、
 * 残りは次のスケジュール実行が拾う。
 *
 * 認証は CloudFront の viewer-request 関数が担うため、ここでは扱わない。
 * Function URL は OAC で CloudFront からのみ到達できるようにしてある。
 */
export async function handler(event: LambdaFunctionURLEvent): Promise<LambdaFunctionURLResult> {
  // CloudFront は /api/* をまとめてこのオリジンへ回す。静的エクスポートで
  // 落ちた他の /api/* への要求もここへ届くため、パスを先に確かめる。
  if (!isRefreshPath(event.requestContext.http.path)) {
    return toResponse({ kind: "not-found" });
  }

  if (event.requestContext.http.method !== "POST") {
    return toResponse({ kind: "method-not-allowed" });
  }

  const config = loadConfig();
  const lambda = new LambdaClient({});

  try {
    return toResponse(await startRefresh(lambda, config));
  } finally {
    lambda.destroy();
  }
}

/**
 * 一括更新を非同期で開始する。応答も完了も待たない。
 *
 * ここで失敗してもクロールは続ける。取り込まれる値が前回の更新のままに
 * なるだけで、何も見えなくなるよりはよい。
 */
async function startBulkRefresh(
  lambda: LambdaClient,
  config: ReturnType<typeof loadConfig>,
): Promise<void> {
  try {
    await lambda.send(
      new InvokeCommand({
        FunctionName: config.bulkRefreshFunction,
        InvocationType: "Event",
      }),
    );
    console.info("Requested the bulk account refresh");
  } catch (error) {
    console.error("Failed to request the bulk account refresh:", error);
  }
}

/**
 * 一括更新を投げてからクロールを起動する。
 *
 * ECS の頃は ListTasks で実行中を調べて 409 を返していたが、Lambda には
 * 同じ問い合わせが無い。予約同時実行数で止める手も、このアカウントの
 * クォータ 10 では使えない（crawl.tf 参照）。
 *
 * 二重起動しても壊れはしない。データベースへの書き込みは FIFO キューと
 * 単一 MessageGroupId が直列化しており、クロール自体も 21 分から 80 秒に
 * 縮んで重なる余地が小さい。押下中の再押下は画面側が抑止している。
 */
async function startRefresh(
  lambda: LambdaClient,
  config: ReturnType<typeof loadConfig>,
): Promise<RefreshOutcome> {
  try {
    await startBulkRefresh(lambda, config);

    const result = await lambda.send(
      new InvokeCommand({
        FunctionName: config.crawlFunction,
        // 完了を待つと 80 秒かかる。ボタンは「開始しました」を返す作り。
        InvocationType: "Event",
      }),
    );

    const accepted = result.StatusCode !== undefined && result.StatusCode < 300;
    if (!accepted) {
      return { kind: "failed", message: `Lambda answered ${String(result.StatusCode)}` };
    }

    console.info("Started a manual crawl");
    return { kind: "started" };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to start the crawler";
    console.error("Failed to start a manual crawl:", error);
    return { kind: "failed", message };
  }
}
