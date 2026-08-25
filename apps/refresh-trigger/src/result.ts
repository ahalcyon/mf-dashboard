/**
 * クロール起動要求に対する応答の組み立て。
 *
 * HTTP と AWS SDK から切り離してあるのは、判断そのものを試験するため。
 */

export type RefreshOutcome =
  | { kind: "started"; taskArn: string }
  | { kind: "already-running" }
  | { kind: "method-not-allowed" }
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
    case "failed":
      return json(502, { status: "failed", message: outcome.message });
  }
}

function json(statusCode: number, body: Record<string, unknown>): RefreshResponse {
  return { statusCode, headers: { ...JSON_HEADERS }, body: JSON.stringify(body) };
}

/** ECS の lastStatus のうち、まだ終わっていないとみなすもの。 */
const ACTIVE_TASK_STATUSES = new Set(["PROVISIONING", "PENDING", "ACTIVATING", "RUNNING"]);

export function hasActiveTask(lastStatuses: readonly (string | undefined)[]): boolean {
  return lastStatuses.some((status) => status !== undefined && ACTIVE_TASK_STATUSES.has(status));
}
