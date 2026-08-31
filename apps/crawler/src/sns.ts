import { PublishCommand, SNSClient } from "@aws-sdk/client-sns";
import { formatJstDateTimeForDisplay } from "@mf-dashboard/date-utils";
import { getDashboardUrl } from "./dashboard-url.js";
import { error, info, log } from "./logger.js";
import type { ScrapedData } from "./types.js";

// SNS の Subject は ASCII の印字可能文字のみ、100 文字以内。件名は ASCII で組み立てる。
const SUBJECT_MAX_LENGTH = 100;

let client: SNSClient | null = null;

function getClient(): SNSClient | null {
  const topicArn = process.env.NOTIFICATION_TOPIC_ARN;
  if (!topicArn) return null;

  client ??= new SNSClient({});
  return client;
}

export function destroySnsClient(): void {
  client?.destroy();
  client = null;
}

/** ASCII 以外と制御文字を落とし、SNS が受け付ける件名にする。 */
export function toSubject(text: string): string {
  // 改行やタブは落とすのではなく空白へ倒す。落とすと語が繋がって読めなくなる。
  const singleLine = text.replace(/\s+/g, " ");
  const ascii = singleLine.replace(/[^\x20-\x7E]/g, "").trim();
  const collapsed = ascii.replace(/\s+/g, " ");
  const fallback = collapsed === "" ? "Money Forward update" : collapsed;
  return fallback.slice(0, SUBJECT_MAX_LENGTH);
}

/** 「1,234,567円」から通貨記号を外して件名に載せられる形にする。 */
function toAsciiAmount(amount: string): string {
  return toSubject(amount.replace(/円/g, " JPY"));
}

export function buildSuccessMessage(data: ScrapedData): string {
  const { summary, items, updatedAt, groupName } = data;

  // 前日比は資産内訳の「合計」行が持つ。
  const totalItem = items.find((item) => item.name === "合計");
  const dailyChange = totalItem?.change || "-";
  const breakdown = items.filter((item) => item.name !== "合計");

  const lines = [
    groupName ? `Money Forward 更新レポート (${groupName})` : "Money Forward 更新レポート",
    "",
    `総資産: ${summary.totalAssets}`,
    `前日比: ${dailyChange}`,
    `今月比: ${summary.monthlyChange}${
      summary.monthlyChangePercent ? ` (${summary.monthlyChangePercent})` : ""
    }`,
  ];

  if (breakdown.length > 0) {
    lines.push("", "資産内訳");
    for (const item of breakdown) {
      lines.push(`  ${item.name}: ${item.balance} (${item.change})`);
    }
  }

  if (data.accountIssues && data.accountIssues.length > 0) {
    lines.push("", "アカウント状態");
    for (const issue of data.accountIssues) {
      const statusLabel = issue.status === "updating" ? "更新中" : "エラー";
      const detail =
        issue.status === "error" && issue.errorMessage ? `: ${issue.errorMessage}` : "";
      lines.push(`  ${issue.name} (${statusLabel}${detail})`);
    }
  }

  lines.push("", `更新日時: ${updatedAt}`);

  const dashboardUrl = getDashboardUrl();
  if (dashboardUrl) lines.push(dashboardUrl);

  return lines.join("\n");
}

export function buildErrorMessage(message: string, timestamp: string): string {
  return ["Money Forward の更新に失敗しました", "", message, "", `発生日時: ${timestamp}`].join(
    "\n",
  );
}

export async function sendSnsNotification(data: ScrapedData): Promise<void> {
  const sns = getClient();
  if (!sns) {
    log("NOTIFICATION_TOPIC_ARN is not set, skipping SNS notification");
    return;
  }

  const message = buildSuccessMessage(data);

  if (process.env.DRY_RUN === "true") {
    log("DRY_RUN mode: skipping SNS notification");
    log("Message would be:", message);
    return;
  }

  await sns.send(
    new PublishCommand({
      TopicArn: process.env.NOTIFICATION_TOPIC_ARN,
      Subject: toAsciiAmount(`Money Forward update - total ${data.summary.totalAssets}`),
      Message: message,
    }),
  );

  info("SNS notification sent successfully!");
}

export async function sendSnsErrorNotification(err: Error): Promise<void> {
  const sns = getClient();
  if (!sns) {
    error("NOTIFICATION_TOPIC_ARN is not set, cannot send SNS error notification");
    return;
  }

  if (process.env.DRY_RUN === "true") {
    log("DRY_RUN mode: skipping SNS error notification");
    return;
  }

  await sns.send(
    new PublishCommand({
      TopicArn: process.env.NOTIFICATION_TOPIC_ARN,
      Subject: "Money Forward update failed",
      Message: buildErrorMessage(err.message, formatJstDateTimeForDisplay()),
    }),
  );
}
