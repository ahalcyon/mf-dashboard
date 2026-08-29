/**
 * クロール起動要求に対する応答の組み立て。
 *
 * HTTP と AWS SDK から切り離してあるのは、判断そのものを試験するため。
 */

export type RefreshOutcome =
  | { kind: "started" }
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
      return json(202, { status: "started" });
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
