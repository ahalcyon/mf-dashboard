import { closeDb, getDb, type Db } from "@mf-dashboard/db";
import { saveScrapedDataBatch } from "@mf-dashboard/db/repository/save-scraped-data";
import {
  decodeScrapedDataPayload,
  parseSyncMessage,
  type SyncMessage,
  type SyncPayload,
} from "@mf-dashboard/db/sync/message";
import type { SQSBatchResponse, SQSEvent } from "aws-lambda";
import { migrate } from "drizzle-orm/libsql/migrator";
import { collectBatchItemFailures } from "./batch";
import { loadConfig, type WriterConfig } from "./config";
import { createEventsClient, publishCrawlCompleted } from "./events";
import { createS3Client, downloadDatabase, readJsonObject, uploadDatabase } from "./s3";

/** データベースを変えたら true。crawl-complete は印だけなので false。 */
async function applyPayload(db: Db, message: SyncMessage, payload: SyncPayload): Promise<boolean> {
  // 種別がずれていたら適用せずに止める
  if (message.kind !== payload.kind) {
    throw new Error(`Payload kind ${payload.kind} does not match message kind ${message.kind}`);
  }

  if (payload.kind === "crawl-complete") return false;

  await saveScrapedDataBatch(db, decodeScrapedDataPayload(payload));
  return true;
}

/** クロール 1 回につき 1 回、静的サイトの再ビルドを起こす。 */
async function announceCompletedRuns(config: WriterConfig, runIds: string[]): Promise<void> {
  if (runIds.length === 0) return;

  const events = createEventsClient();
  try {
    for (const runId of runIds) {
      await publishCrawlCompleted(events, {
        busName: config.eventBusName,
        source: config.crawlCompletedSource,
        detailType: config.crawlCompletedDetailType,
        runId,
      });
      console.info(`Announced the completed crawl ${runId}`);
    }
  } finally {
    events.destroy();
  }
}

/**
 * SQS から届いたクロール結果を、S3 上の SQLite へ適用する。
 * ファイル全体を取得して書き換え、まとめて書き戻す。書き込みは FIFO キューと
 * 単一 MessageGroupId、および予約同時実行数 1 で直列化される。
 */
export async function handler(event: SQSEvent): Promise<SQSBatchResponse> {
  const config = loadConfig();
  // packages/db は DB_PATH を見て接続先を決める
  process.env.DB_PATH = config.databaseLocalPath;

  const client = createS3Client();
  const messageIds = event.Records.map((record) => record.messageId);
  let firstFailureIndex = -1;
  let appliedCount = 0;
  // データベースを変えたメッセージの数。0 なら書き戻さない。
  let changedCount = 0;
  const completedRuns: string[] = [];

  await downloadDatabase(client, {
    bucket: config.dataBucket,
    key: config.databaseObjectKey,
    localPath: config.databaseLocalPath,
  });

  try {
    const db = getDb();
    await migrate(db, { migrationsFolder: config.migrationsDir });

    for (const [index, record] of event.Records.entries()) {
      try {
        const message = parseSyncMessage(record.body);
        const payload = await readJsonObject<SyncPayload>(client, message.payload);
        if (await applyPayload(db, message, payload)) {
          changedCount += 1;
        } else {
          completedRuns.push(message.runId);
        }
        appliedCount += 1;
      } catch (error) {
        console.error(`Failed to apply message ${record.messageId}:`, error);
        firstFailureIndex = index;
        break;
      }
    }

    // 適用済みの分を書き戻す。
    if (changedCount > 0) {
      await uploadDatabase(client, {
        bucket: config.dataBucket,
        key: config.databaseObjectKey,
        localPath: config.databaseLocalPath,
      });
    }

    // 書き戻してから知らせる。
    await announceCompletedRuns(config, completedRuns);
  } finally {
    closeDb();
    client.destroy();
  }

  console.info(`Applied ${appliedCount}/${event.Records.length} message(s)`);
  return { batchItemFailures: collectBatchItemFailures(messageIds, firstFailureIndex) };
}
