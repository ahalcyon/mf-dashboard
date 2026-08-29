import { createWriteStream } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import type { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { GetObjectCommand, NoSuchKey, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { SendMessageCommand, SQSClient } from "@aws-sdk/client-sqs";
import {
  buildSyncMessage,
  type SyncPayload,
  type SyncPayloadKind,
} from "@mf-dashboard/db/sync/message";
import { info, warn } from "../logger.js";
import type { SyncConfig } from "./config.js";

/**
 * crawler は authoritative なデータベースを持たない。
 * S3 上の複製を作業用に落として読み書きし、書き込みは payload として発行する。
 * 実際に S3 のデータベースへ適用するのは writer だけ。
 */
export class SyncPublisher {
  private readonly s3 = new S3Client({});
  private readonly sqs = new SQSClient({});

  // 履歴は月ごとに発行するため、1 回のクロールが何度も publish を呼ぶ。
  // payload のキーを run 内で一意にするための連番。
  private sequence = 0;

  constructor(
    private readonly config: SyncConfig,
    private readonly runId: string,
  ) {}

  /** 作業用の複製を取得する。存在しなければ false を返し、履歴モードで走らせる。 */
  async downloadDatabase(localPath: string): Promise<boolean> {
    await mkdir(path.dirname(localPath), { recursive: true });
    await rm(localPath, { force: true });

    try {
      const response = await this.s3.send(
        new GetObjectCommand({ Bucket: this.config.bucket, Key: this.config.databaseObjectKey }),
      );
      if (!response.Body) throw new Error("S3 returned an empty database body");

      await pipeline(response.Body as Readable, createWriteStream(localPath));
      info("Downloaded the working database copy from S3");
      return true;
    } catch (error) {
      if (error instanceof NoSuchKey) {
        warn("No database in S3 yet; the crawl will produce the initial history");
        return false;
      }
      throw error;
    }
  }

  async publish(kind: SyncPayloadKind, payload: SyncPayload): Promise<void> {
    this.sequence += 1;
    const message = buildSyncMessage({
      bucket: this.config.bucket,
      runId: this.runId,
      kind,
      sequence: this.sequence,
    });

    await this.s3.send(
      new PutObjectCommand({
        Bucket: message.payload.bucket,
        Key: message.payload.key,
        Body: JSON.stringify(payload),
        ContentType: "application/json",
      }),
    );

    await this.sqs.send(
      new SendMessageCommand({
        QueueUrl: this.config.queueUrl,
        MessageBody: JSON.stringify(message),
        // 分けると writer が並行して走り、read-modify-write が競合する
        MessageGroupId: this.config.messageGroupId,
      }),
    );

    info(`Published ${kind} #${this.sequence} for run ${this.runId}`);
  }

  destroy(): void {
    this.s3.destroy();
    this.sqs.destroy();
  }
}
