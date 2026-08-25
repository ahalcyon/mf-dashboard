import { readFileSync } from "node:fs";
import path from "node:path";

const FUNCTION_PATH = path.resolve(
  import.meta.dirname,
  "../../../terraform/aws/functions/viewer-request.js",
);

// oxfmt が引用符を正規化するので、どちらの形でも拾えるようにしておく
const IMPORT_PATTERN = /^\s*import\s+cf\s+from\s+["']cloudfront["'];?\s*$/m;

export const DEFAULT_SESSION_COOKIE_MAX_AGE_SECONDS = 31536000;

interface CloudFrontValue {
  value: string;
}

export interface CloudFrontRequest {
  uri: string;
  querystring: Record<string, CloudFrontValue>;
  headers: Record<string, CloudFrontValue>;
  cookies: Record<string, CloudFrontValue>;
}

export interface CloudFrontResponse {
  statusCode: number;
  statusDescription: string;
  headers: Record<string, CloudFrontValue>;
  cookies?: Record<string, { value: string; attributes: string }>;
}

export type ViewerRequestResult = CloudFrontRequest | CloudFrontResponse;

export interface LoadOptions {
  /** KeyValueStore の中身。キーが無ければ get は「キー無し」として失敗する。 */
  store?: Record<string, string>;
  /** get 自体が投げる状況。KVS 未関連付けや障害を模す。 */
  failingKeys?: string[];
  sessionCookieMaxAgeSeconds?: number;
}

/**
 * デプロイされる viewer-request 関数をそのまま読み込んでテスト可能にする。
 *
 * 関数は CloudFront Functions の実行環境が注入する `cloudfront` モジュールへ
 * 依存していて Node には存在しない。そこで import 文だけを外し、`cf` を引数と
 * して渡す。置換対象が見つからなければ落とす。取りこぼしたまま素通りすると、
 * 実際に配信される中身とは別のものをテストしてしまう。
 */
export function loadViewerRequest(
  options: LoadOptions = {},
): (event: { request: CloudFrontRequest }) => Promise<ViewerRequestResult> {
  const source = readFileSync(FUNCTION_PATH, "utf8");

  if (!IMPORT_PATTERN.test(source)) {
    throw new Error(
      "viewer-request.js no longer imports cf from 'cloudfront'; update the test harness",
    );
  }

  const placeholder = "${session_cookie_max_age_seconds}";
  if (!source.includes(placeholder)) {
    throw new Error(`viewer-request.js no longer references ${placeholder}`);
  }

  // terraform の templatefile と同じ置換をここでも行う
  const rendered = source
    .replaceAll(
      placeholder,
      String(options.sessionCookieMaxAgeSeconds ?? DEFAULT_SESSION_COOKIE_MAX_AGE_SECONDS),
    )
    .replace(IMPORT_PATTERN, "");

  const store = options.store ?? {};
  const failingKeys = new Set(options.failingKeys ?? []);
  const cf = {
    kvs: () => ({
      get: async (key: string): Promise<string> => {
        if (failingKeys.has(key)) {
          throw new Error(`KeyValueStore lookup failed for ${key}`);
        }
        const value = store[key];
        // 実際の KVS も未登録キーでは reject する
        if (value === undefined) {
          throw new Error(`KeyValueStore has no key ${key}`);
        }
        return value;
      },
    }),
  };

  const factory = new Function("cf", `${rendered}\nreturn handler;`) as (
    injected: typeof cf,
  ) => (event: { request: CloudFrontRequest }) => Promise<ViewerRequestResult>;

  return factory(cf);
}

export function buildRequest(overrides: Partial<CloudFrontRequest> = {}): CloudFrontRequest {
  return {
    uri: "/",
    querystring: {},
    headers: {},
    cookies: {},
    ...overrides,
  };
}

export function isResponse(result: ViewerRequestResult): result is CloudFrontResponse {
  return "statusCode" in result;
}
