import {
  DescribeTasksCommand,
  ECSClient,
  ListTasksCommand,
  RunTaskCommand,
} from "@aws-sdk/client-ecs";
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
 * ダッシュボードから当日分のクロールを起動する。
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

  try {
    return toResponse(await startCrawl(client, config));
  } finally {
    client.destroy();
  }
}

async function startCrawl(
  client: ECSClient,
  config: ReturnType<typeof loadConfig>,
): Promise<RefreshOutcome> {
  try {
    if (await isCrawlInProgress(client, config)) {
      return { kind: "already-running" };
    }

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
