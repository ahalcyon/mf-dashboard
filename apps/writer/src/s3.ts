import { createWriteStream } from "node:fs";
import { readFile, rm } from "node:fs/promises";
import type { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { GetObjectCommand, NoSuchKey, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

export function createS3Client(): S3Client {
  return new S3Client({});
}

/**
 * S3 上の SQLite をローカルへ取得する。
 * 初回クロール前はオブジェクトが存在しないため、その場合は false を返して
 * マイグレーションだけで新しいデータベースを作らせる。
 */
export async function downloadDatabase(
  client: S3Client,
  options: { bucket: string; key: string; localPath: string },
): Promise<boolean> {
  await rm(options.localPath, { force: true });

  try {
    const response = await client.send(
      new GetObjectCommand({ Bucket: options.bucket, Key: options.key }),
    );
    if (!response.Body) throw new Error("S3 returned an empty database body");

    await pipeline(response.Body as Readable, createWriteStream(options.localPath));
    return true;
  } catch (error) {
    if (error instanceof NoSuchKey) return false;
    throw error;
  }
}

export async function uploadDatabase(
  client: S3Client,
  options: { bucket: string; key: string; localPath: string },
): Promise<void> {
  await client.send(
    new PutObjectCommand({
      Bucket: options.bucket,
      Key: options.key,
      Body: await readFile(options.localPath),
      ContentType: "application/vnd.sqlite3",
    }),
  );
}

export async function readJsonObject<T>(
  client: S3Client,
  options: { bucket: string; key: string },
): Promise<T> {
  const response = await client.send(
    new GetObjectCommand({ Bucket: options.bucket, Key: options.key }),
  );
  if (!response.Body) throw new Error(`S3 object ${options.key} is empty`);

  return JSON.parse(await response.Body.transformToString()) as T;
}
