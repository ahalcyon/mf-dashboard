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
  // 種別がずれていたら、意図しない適用になる前に止める
  if (message.kind !== payload.kind) {
    throw new Error(`Payload kind ${payload.kind} does not match message kind ${message.kind}`);
  }

  if (payload.kind === "crawl-complete") return false;

  await saveScrapedDataBatch(db, decodeScrapedDataPayload(payload));
  return true;
}

/**
 * クロール 1 回につき 1 回だけ、静的サイトの再ビルドを起こす。
 *
 * 以前は S3 の Object Created を起点にしていたため、書き戻すたびに走っていた。
 * 履歴を月ごとに送るようになってからは 1 回のクロールで 3 本、バックフィルなら
 * 21 本になっていた。
 */
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
 *
 * S3 には部分書き込みもロックも無いため、ファイル全体を取得して書き換え、
 * まとめて書き戻す。これが壊れないのは、FIFO キューと単一 MessageGroupId に
 * よって同時に走る書き込みが存在しないためで、どちらかを外すと後勝ちで
 * データが消える。予約同時実行数はその上に重ねる多重防御。
 */
export async function handler(event: SQSEvent): Promise<SQSBatchResponse> {
  const config = loadConfig();
  // packages/db は DB_PATH を見て接続先を決める
  process.env.DB_PATH = config.databaseLocalPath;

  const client = createS3Client();
  const messageIds = event.Records.map((record) => record.messageId);
  let firstFailureIndex = -1;
  let appliedCount = 0;
  // 書き戻しが要るかどうかは、データベースを変えたメッセージの数で決める。
  // crawl-complete だけのバッチで数 MB を上げ直す意味は無い。
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

    // 適用済みの分は書き戻す。saveScrapedDataBatch は upsert と月単位の
    // 置き換えで構成されているため、再配信で同じ内容が再適用されても問題ない。
    if (changedCount > 0) {
      await uploadDatabase(client, {
        bucket: config.dataBucket,
        key: config.databaseObjectKey,
        localPath: config.databaseLocalPath,
      });
    }

    // 書き戻してから知らせる。逆にすると site-builder が古いデータベースを読む。
    await announceCompletedRuns(config, completedRuns);
  } finally {
    closeDb();
    client.destroy();
  }

  console.info(`Applied ${appliedCount}/${event.Records.length} message(s)`);
  return { batchItemFailures: collectBatchItemFailures(messageIds, firstFailureIndex) };
}
