import type { TransactionPeriodReplacement } from "../repositories/transactions";
import type { ScrapedData } from "../types";

/**
 * crawler（producer）と writer（consumer）の間の契約。
 *
 * S3 上の SQLite はファイル全体を書き換えるしかないため、書き込みは
 * FIFO キュー・単一 MessageGroupId・予約同時実行数 1 の writer で直列化する。
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
 */
export interface SyncMessage {
  version: typeof SYNC_MESSAGE_VERSION;
  /** 1 回のクロールを識別する。ペイロードのキーにも使う */
  runId: string;
  producedAt: string;
  payload: { bucket: string; key: string };
}

/**
 * S3 に置く実データ。saveScrapedDataBatch の引数と 1 対 1 で対応する。
 * Map は JSON にできないため、institutionCategories だけ entries 配列で持つ。
 */
export interface SyncPayload {
  cleanupGroupIds?: string[];
  fullData?: ScrapedData;
  groupOnlyData: ScrapedData[];
  historyMonths?: TransactionPeriodReplacement[];
  institutionCategories?: [string, string][];
}

/** saveScrapedDataBatch がそのまま受け取れる形 */
export interface SyncBatch {
  cleanupGroupIds?: string[];
  fullData?: ScrapedData;
  groupOnlyData: ScrapedData[];
  historyMonths?: TransactionPeriodReplacement[];
  institutionCategories?: ReadonlyMap<string, string>;
}

export function buildPayloadKey(runId: string): string {
  return `payloads/${runId}.json`;
}

export function encodeSyncPayload(batch: SyncBatch): SyncPayload {
  const { institutionCategories, ...rest } = batch;
  return institutionCategories
    ? { ...rest, institutionCategories: [...institutionCategories] }
    : rest;
}

export function decodeSyncPayload(payload: SyncPayload): SyncBatch {
  const { institutionCategories, ...rest } = payload;
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
    producedAt: message.producedAt,
    payload: { bucket, key },
  };
}

export function buildSyncMessage(options: {
  bucket: string;
  runId: string;
  producedAt?: string;
}): SyncMessage {
  return {
    version: SYNC_MESSAGE_VERSION,
    runId: options.runId,
    producedAt: options.producedAt ?? new Date().toISOString(),
    payload: { bucket: options.bucket, key: buildPayloadKey(options.runId) },
  };
}
