import type { TransactionPeriodReplacement } from "../repositories/transactions";
import type { ScrapedData } from "../types";

/**
 * crawler（producer）と writer（consumer）の間の契約。
 *
 * S3 上の SQLite はファイル全体を書き換えるしかないため、書き込みは
 * FIFO キューと単一 MessageGroupId で直列化する。
 * このモジュールはその経路を流れるメッセージの形だけを定義する。
 */

export const SYNC_MESSAGE_VERSION = 1;

/** 送信側は必ずこの MessageGroupId を使う。分けると書き込みが並行して走る。 */
export const SYNC_MESSAGE_GROUP_ID = "sqlite-write";

/** SQS の 1 メッセージ上限は 256 KiB で、全履歴クロールは容易に超える。 */
export const SQS_MESSAGE_MAX_BYTES = 256 * 1024;

/**
 * キューを流れるメッセージ本体。
 * 実データは S3 に置き、ここにはその位置だけを載せる。
 *
 * crawl-complete は「この run が送るものはこれで終わり」を伝えるだけの印。
 * 適用するデータを持たない。writer はこれを見て静的サイトの再ビルドを
 * 1 回だけ起こす。同じ MessageGroupId で送るため、FIFO の順序保証により
 * 必ず同じ run の scraped-data すべてより後に届く。
 */
export const SYNC_PAYLOAD_KINDS = ["scraped-data", "crawl-complete"] as const;

export type SyncPayloadKind = (typeof SYNC_PAYLOAD_KINDS)[number];

export interface SyncMessage {
  version: typeof SYNC_MESSAGE_VERSION;
  /** 1 回のクロールを識別する。ペイロードのキーにも使う */
  runId: string;
  kind: SyncPayloadKind;
  producedAt: string;
  payload: { bucket: string; key: string };
}

/**
 * S3 に置く実データ。saveScrapedDataBatch の引数と 1 対 1 で対応する。
 * Map は JSON にできないため、institutionCategories だけ entries 配列で持つ。
 */
export interface ScrapedDataPayload {
  kind: "scraped-data";
  cleanupGroupIds?: string[];
  fullData?: ScrapedData;
  groupOnlyData: ScrapedData[];
  historyMonths?: TransactionPeriodReplacement[];
  institutionCategories?: [string, string][];
}

/** データを持たない。runId と kind だけで意味が完結する。 */
export interface CrawlCompletePayload {
  kind: "crawl-complete";
}

export type SyncPayload = ScrapedDataPayload | CrawlCompletePayload;

/** saveScrapedDataBatch がそのまま受け取れる形 */
export interface SyncBatch {
  cleanupGroupIds?: string[];
  fullData?: ScrapedData;
  groupOnlyData: ScrapedData[];
  historyMonths?: TransactionPeriodReplacement[];
  institutionCategories?: ReadonlyMap<string, string>;
}

/**
 * 1 回のクロールは複数の payload を発行する。履歴は月ごとに送るため、
 * runId と kind だけではキーが衝突し、先に送ったメッセージが後から
 * 上書きされた中身を指すことになる。run 内の連番で区別する。
 */
export function buildPayloadKey(runId: string, kind: SyncPayloadKind, sequence: number): string {
  return `payloads/${runId}/${String(sequence).padStart(4, "0")}-${kind}.json`;
}

export function encodeScrapedDataPayload(batch: SyncBatch): ScrapedDataPayload {
  const { institutionCategories, ...rest } = batch;
  return institutionCategories
    ? { kind: "scraped-data", ...rest, institutionCategories: [...institutionCategories] }
    : { kind: "scraped-data", ...rest };
}

export function decodeScrapedDataPayload(payload: ScrapedDataPayload): SyncBatch {
  const { kind: _kind, institutionCategories, ...rest } = payload;
  return institutionCategories
    ? { ...rest, institutionCategories: new Map(institutionCategories) }
    : rest;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

/**
 * キューから受け取った文字列を検証する。
 * 送信側は自分たちのコードだが、再配信や版ずれで壊れた値が届きうるため、
 * writer が S3 を触る前にここで弾く。
 */
export function parseSyncMessage(raw: string): SyncMessage {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error("Sync message is not valid JSON");
  }

  if (typeof value !== "object" || value === null) {
    throw new Error("Sync message must be an object");
  }

  const message = value as Record<string, unknown>;
  if (message.version !== SYNC_MESSAGE_VERSION) {
    throw new Error(
      `Unsupported sync message version: ${String(message.version)} (expected ${SYNC_MESSAGE_VERSION})`,
    );
  }
  if (!isNonEmptyString(message.runId)) throw new Error("Sync message is missing runId");
  if (!isNonEmptyString(message.producedAt)) throw new Error("Sync message is missing producedAt");
  if (!SYNC_PAYLOAD_KINDS.includes(message.kind as SyncPayloadKind)) {
    throw new Error(`Unsupported sync payload kind: ${String(message.kind)}`);
  }

  const payload = message.payload;
  if (typeof payload !== "object" || payload === null) {
    throw new Error("Sync message is missing payload");
  }
  const { bucket, key } = payload as Record<string, unknown>;
  if (!isNonEmptyString(bucket)) throw new Error("Sync message payload is missing bucket");
  if (!isNonEmptyString(key)) throw new Error("Sync message payload is missing key");

  return {
    version: SYNC_MESSAGE_VERSION,
    runId: message.runId,
    kind: message.kind as SyncPayloadKind,
    producedAt: message.producedAt,
    payload: { bucket, key },
  };
}

export function buildSyncMessage(options: {
  bucket: string;
  runId: string;
  kind: SyncPayloadKind;
  sequence: number;
  producedAt?: string;
}): SyncMessage {
  return {
    version: SYNC_MESSAGE_VERSION,
    runId: options.runId,
    kind: options.kind,
    producedAt: options.producedAt ?? new Date().toISOString(),
    payload: {
      bucket: options.bucket,
      key: buildPayloadKey(options.runId, options.kind, options.sequence),
    },
  };
}
