import {
  DescribeTasksCommand,
  ECSClient,
  ListTasksCommand,
  RunTaskCommand,
} from "@aws-sdk/client-ecs";
import { InvokeCommand, LambdaClient } from "@aws-sdk/client-lambda";
import type { LambdaFunctionURLEvent, LambdaFunctionURLResult } from "aws-lambda";
import { loadConfig } from "./config.js";
import {
  hasActiveTask,
  isRefreshPath,
  taskFamilyFromDefinition,
  toResponse,
  type RefreshOutcome,
} from "./result.js";

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
  const client = new ECSClient({});
  const lambda = new LambdaClient({});

  try {
    return toResponse(await startRefresh(client, lambda, config));
  } finally {
    client.destroy();
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

async function startRefresh(
  client: ECSClient,
  lambda: LambdaClient,
  config: ReturnType<typeof loadConfig>,
): Promise<RefreshOutcome> {
  try {
    if (await isCrawlInProgress(client, config)) {
      return { kind: "already-running" };
    }

    // 多重起動を弾いたあとに投げる。先に投げると、409 を返す場合にも
    // Money Forward へログインしてしまう。
    await startBulkRefresh(lambda, config);

    const result = await client.send(
      new RunTaskCommand({
        cluster: config.cluster,
        taskDefinition: config.taskDefinition,
        launchType: "FARGATE",
        count: 1,
        networkConfiguration: {
          awsvpcConfiguration: {
            subnets: config.subnets,
            securityGroups: config.securityGroups,
            assignPublicIp: "ENABLED",
          },
        },
        overrides: {
          containerOverrides: [
            { name: "crawler", environment: [{ name: "CRAWLER_RUN_SOURCE", value: "manual" }] },
          ],
        },
      }),
    );

    const taskArn = result.tasks?.[0]?.taskArn;
    if (!taskArn) {
      const reason = result.failures?.[0]?.reason ?? "ECS did not start a task";
      return { kind: "failed", message: reason };
    }

    console.info(`Started a manual crawl: ${taskArn}`);
    return { kind: "started", taskArn };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to start the crawler";
    console.error("Failed to start a manual crawl:", error);
    return { kind: "failed", message };
  }
}

/**
 * 二重起動を防ぐ。Money Forward へ同時にログインすると、
 * 一括更新の待ち合わせが互いに干渉する。
 */
async function isCrawlInProgress(
  client: ECSClient,
  config: ReturnType<typeof loadConfig>,
): Promise<boolean> {
  const family = taskFamilyFromDefinition(config.taskDefinition);
  const listed = await client.send(
    new ListTasksCommand({
      cluster: config.cluster,
      family,
      desiredStatus: "RUNNING",
    }),
  );

  if (!listed.taskArns || listed.taskArns.length === 0) return false;

  const described = await client.send(
    new DescribeTasksCommand({ cluster: config.cluster, tasks: listed.taskArns }),
  );

  return hasActiveTask((described.tasks ?? []).map((task) => task.lastStatus));
}
