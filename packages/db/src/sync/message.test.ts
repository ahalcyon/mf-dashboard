import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import {
  buildPayloadKey,
  buildSyncMessage,
  decodeScrapedDataPayload,
  encodeScrapedDataPayload,
  parseSyncMessage,
  SYNC_MESSAGE_GROUP_ID,
  SYNC_MESSAGE_VERSION,
  type SyncMessage,
} from "./message";

const validMessage: SyncMessage = {
  version: SYNC_MESSAGE_VERSION,
  runId: "20260825T063000Z-abcdef",
  kind: "scraped-data",
  producedAt: "2026-08-25T06:30:00.000Z",
  payload: { bucket: "test-bucket", key: "payloads/20260825T063000Z-abcdef/scraped-data.json" },
};

describe("buildSyncMessage", () => {
  test("ペイロードのキーを runId から導出する", () => {
    const message = buildSyncMessage({
      bucket: "test-bucket",
      runId: "run-1",
      kind: "scraped-data",
      producedAt: "2026-08-25T06:30:00.000Z",
    });

    expect(message).toEqual({
      version: SYNC_MESSAGE_VERSION,
      runId: "run-1",
      kind: "scraped-data",
      producedAt: "2026-08-25T06:30:00.000Z",
      payload: { bucket: "test-bucket", key: "payloads/run-1/scraped-data.json" },
    });
  });

  test("producedAt を省略すると現在時刻を入れる", () => {
    const message = buildSyncMessage({
      bucket: "test-bucket",
      runId: "run-1",
      kind: "scraped-data",
    });

    expect(Number.isNaN(Date.parse(message.producedAt))).toBe(false);
  });
});

describe("buildPayloadKey", () => {
  test("run と種別でキーを分ける", () => {
    expect(buildPayloadKey("run-1", "scraped-data")).toBe("payloads/run-1/scraped-data.json");
  });
});

describe("parseSyncMessage", () => {
  test("往復できる", () => {
    expect(parseSyncMessage(JSON.stringify(validMessage))).toEqual(validMessage);
  });

  test("既知のフィールドだけを残す", () => {
    const parsed = parseSyncMessage(JSON.stringify({ ...validMessage, extra: "ignored" }));

    expect(parsed).toEqual(validMessage);
  });

  test.each([
    ["JSONではない", "{"],
    ["オブジェクトではない", '"string"'],
    ["nullである", "null"],
  ])("%s 場合は失敗する", (_label, raw) => {
    expect(() => parseSyncMessage(raw)).toThrow();
  });

  test("未知の種別は失敗する", () => {
    const raw = JSON.stringify({ ...validMessage, kind: "something-else" });

    expect(() => parseSyncMessage(raw)).toThrow("Unsupported sync payload kind: something-else");
  });

  test("種別が欠けていたら失敗する", () => {
    const raw = JSON.stringify({ ...validMessage, kind: undefined });

    expect(() => parseSyncMessage(raw)).toThrow();
  });

  test("版が違う場合は失敗する", () => {
    const raw = JSON.stringify({ ...validMessage, version: 2 });

    expect(() => parseSyncMessage(raw)).toThrow("Unsupported sync message version: 2");
  });

  test.each(["runId", "producedAt"])("%s が空文字なら失敗する", (field) => {
    const raw = JSON.stringify({ ...validMessage, [field]: "" });

    expect(() => parseSyncMessage(raw)).toThrow();
  });

  test.each(["bucket", "key"])("payload.%s が欠けていたら失敗する", (field) => {
    const payload = { ...validMessage.payload, [field]: undefined };
    const raw = JSON.stringify({ ...validMessage, payload });

    expect(() => parseSyncMessage(raw)).toThrow();
  });

  test("payload 自体が欠けていたら失敗する", () => {
    const raw = JSON.stringify({ ...validMessage, payload: undefined });

    expect(() => parseSyncMessage(raw)).toThrow("Sync message is missing payload");
  });
});

describe("encodeScrapedDataPayload / decodeScrapedDataPayload", () => {
  test("institutionCategories の Map を往復できる", () => {
    const institutionCategories = new Map([
      ["mf-1", "銀行"],
      ["mf-2", "証券"],
    ]);

    const encoded = encodeScrapedDataPayload({ groupOnlyData: [], institutionCategories });

    // JSON を経由しても失われないことまで確認する
    const decoded = decodeScrapedDataPayload(JSON.parse(JSON.stringify(encoded)));

    expect(encoded.institutionCategories).toEqual([
      ["mf-1", "銀行"],
      ["mf-2", "証券"],
    ]);
    expect(decoded.institutionCategories).toEqual(institutionCategories);
  });

  test("institutionCategories が無い場合はキー自体を作らない", () => {
    const encoded = encodeScrapedDataPayload({ groupOnlyData: [] });

    expect(encoded.kind).toBe("scraped-data");
    expect("institutionCategories" in encoded).toBe(false);
    expect("institutionCategories" in decodeScrapedDataPayload(encoded)).toBe(false);
    // decode 側は kind を落とし、saveScrapedDataBatch がそのまま受け取れる形にする
    expect("kind" in decodeScrapedDataPayload(encoded)).toBe(false);
  });

  test("その他のフィールドはそのまま保つ", () => {
    const encoded = encodeScrapedDataPayload({ cleanupGroupIds: ["1"], groupOnlyData: [] });

    expect(encoded.kind).toBe("scraped-data");
    expect(encoded.cleanupGroupIds).toEqual(["1"]);
  });
});

describe("SYNC_MESSAGE_GROUP_ID", () => {
  // 定数を再掲するだけでは、Terraform 側を書き換えたときに何も起きない。
  // 送信側と受信側で MessageGroupId がずれると SQS が直列化をやめ、
  // writer が 2 本同時にファイル全体を上書きして 1 回分のクロールが消える。
  // だから実物の .tf を読んで突き合わせる。
  const queueTfPath = path.resolve(import.meta.dirname, "../../../../terraform/aws/queue.tf");

  test("Terraform の write_message_group_id と一致する", () => {
    const queueTf = readFileSync(queueTfPath, "utf8");
    const match = queueTf.match(/write_message_group_id\s*=\s*"([^"]+)"/);

    // 定義が見つからないなら、突き合わせが成立していないので落とす
    expect(match?.[1]).toBeTypeOf("string");
    expect(SYNC_MESSAGE_GROUP_ID).toBe(match?.[1]);
  });

  test("キューが FIFO でなければ直列化が成立しない", () => {
    const queueTf = readFileSync(queueTfPath, "utf8");

    expect(queueTf).toMatch(/resource\s+"aws_sqs_queue"\s+"writes"[\s\S]*?fifo_queue\s*=\s*true/);
  });
});
