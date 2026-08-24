import { closeDb, getDb } from "@mf-dashboard/db";
import { saveScrapedDataBatch } from "@mf-dashboard/db/repository/save-scraped-data";
import {
  decodeSyncPayload,
  parseSyncMessage,
  type SyncPayload,
} from "@mf-dashboard/db/sync/message";
import type { SQSBatchResponse, SQSEvent } from "aws-lambda";
import { migrate } from "drizzle-orm/libsql/migrator";
import { collectBatchItemFailures } from "./batch";
import { loadConfig } from "./config";
import { createS3Client, downloadDatabase, readJsonObject, uploadDatabase } from "./s3";

/**
 * SQS から届いたクロール結果を、S3 上の SQLite へ適用する。
 *
 * S3 には部分書き込みもロックも無いため、ファイル全体を取得して書き換え、
 * まとめて書き戻す。これが壊れないのは、FIFO キュー・単一 MessageGroupId・
 * 予約同時実行数 1 によって同時に走る書き込みが存在しないためで、
 * どれか 1 つでも外すと後勝ちでデータが消える。
 */
export async function handler(event: SQSEvent): Promise<SQSBatchResponse> {
  const config = loadConfig();
  // packages/db は DB_PATH を見て接続先を決める
  process.env.DB_PATH = config.databaseLocalPath;

  const client = createS3Client();
  const messageIds = event.Records.map((record) => record.messageId);
  let firstFailureIndex = -1;
  let appliedCount = 0;

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
        await saveScrapedDataBatch(db, decodeSyncPayload(payload));
        appliedCount += 1;
      } catch (error) {
        console.error(`Failed to apply message ${record.messageId}:`, error);
        firstFailureIndex = index;
        break;
      }
    }

    // 適用済みの分は書き戻す。saveScrapedDataBatch は upsert と月単位の
    // 置き換えで構成されているため、再配信で同じ内容が再適用されても問題ない。
    if (appliedCount > 0) {
      await uploadDatabase(client, {
        bucket: config.dataBucket,
        key: config.databaseObjectKey,
        localPath: config.databaseLocalPath,
      });
    }
  } finally {
    closeDb();
    client.destroy();
  }

  console.info(`Applied ${appliedCount}/${event.Records.length} message(s)`);
  return { batchItemFailures: collectBatchItemFailures(messageIds, firstFailureIndex) };
}
