/**
 * クロール起動要求に対する応答の組み立て。
 *
 * HTTP と AWS SDK から切り離してあるのは、判断そのものを試験するため。
 */

export type RefreshOutcome =
  | { kind: "started"; taskArn: string }
  | { kind: "already-running" }
  | { kind: "method-not-allowed" }
  | { kind: "not-found" }
  | { kind: "failed"; message: string };

export interface RefreshResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
}

const JSON_HEADERS = {
  "content-type": "application/json",
  // 起動要求の結果を CloudFront にもブラウザーにも保持させない
  "cache-control": "no-store",
} as const;

export function toResponse(outcome: RefreshOutcome): RefreshResponse {
  switch (outcome.kind) {
    case "started":
      return json(202, { status: "started", taskArn: outcome.taskArn });
    case "already-running":
      // 二重に起動すると Money Forward へ同時にログインしてしまう
      return json(409, { status: "already-running" });
    case "method-not-allowed":
      return json(405, { status: "method-not-allowed" });
    case "not-found":
      return json(404, { status: "not-found" });
    case "failed":
      return json(502, { status: "failed", message: outcome.message });
  }
}

function json(statusCode: number, body: Record<string, unknown>): RefreshResponse {
  return { statusCode, headers: { ...JSON_HEADERS }, body: JSON.stringify(body) };
}

const REFRESH_PATH = "/api/refresh";

/**
 * この Lambda が応じてよいパスかどうか。
 *
 * CloudFront は /api/* をまとめてこのオリジンへ回すため、静的サイトから
 * 落ちた他の /api/* への POST もここへ届く。パスを見ないと、どの POST でも
 * クロールが起動してしまう。
 *
 * basePath 配下で配信する場合に前置きが付くので末尾で判定する。
 * 末尾のスラッシュは trailingSlash: true の設定で必ず付く。
 */
export function isRefreshPath(path: string | undefined): boolean {
  if (!path) return false;
  const normalized = path.endsWith("/") ? path.slice(0, -1) : path;
  return normalized === REFRESH_PATH || normalized.endsWith(REFRESH_PATH);
}

/** ECS の lastStatus のうち、まだ終わっていないとみなすもの。 */
const ACTIVE_TASK_STATUSES = new Set(["PROVISIONING", "PENDING", "ACTIVATING", "RUNNING"]);

export function hasActiveTask(lastStatuses: readonly (string | undefined)[]): boolean {
  return lastStatuses.some((status) => status !== undefined && ACTIVE_TASK_STATUSES.has(status));
}

/**
 * タスク定義からファミリー名を取り出す。
 *
 * ListTasks の family はこれで絞り込むため、外すと候補が空になり
 * 実行中のクロールを見落として二重起動する。hasActiveTask がどれだけ
 * 正確でも、ここで空振りすると呼ばれもしない。
 *
 * 受け取る形は 3 通りある。完全な ARN、`family:revision`、ファミリー名のみ。
 */
export function taskFamilyFromDefinition(taskDefinition: string): string | undefined {
  const lastSegment = taskDefinition.split("/").pop();
  if (!lastSegment) return undefined;

  const family = lastSegment.split(":")[0];
  return family === "" ? undefined : family;
}
