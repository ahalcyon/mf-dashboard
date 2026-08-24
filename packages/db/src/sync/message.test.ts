import { describe, expect, test } from "vitest";
import {
  buildPayloadKey,
  buildSyncMessage,
  decodeSyncPayload,
  encodeSyncPayload,
  parseSyncMessage,
  SYNC_MESSAGE_GROUP_ID,
  SYNC_MESSAGE_VERSION,
  type SyncMessage,
} from "./message";

const validMessage: SyncMessage = {
  version: SYNC_MESSAGE_VERSION,
  runId: "2026-08-25T063000Z-abcdef",
  producedAt: "2026-08-25T06:30:00.000Z",
  payload: { bucket: "test-bucket", key: "payloads/2026-08-25T063000Z-abcdef.json" },
};

describe("buildSyncMessage", () => {
  test("ペイロードのキーを runId から導出する", () => {
    const message = buildSyncMessage({
      bucket: "test-bucket",
      runId: "run-1",
      producedAt: "2026-08-25T06:30:00.000Z",
    });

    expect(message).toEqual({
      version: SYNC_MESSAGE_VERSION,
      runId: "run-1",
      producedAt: "2026-08-25T06:30:00.000Z",
      payload: { bucket: "test-bucket", key: "payloads/run-1.json" },
    });
  });

  test("producedAt を省略すると現在時刻を入れる", () => {
    const message = buildSyncMessage({ bucket: "test-bucket", runId: "run-1" });

    expect(Number.isNaN(Date.parse(message.producedAt))).toBe(false);
  });
});

describe("buildPayloadKey", () => {
  test("payloads 配下へ配置する", () => {
    expect(buildPayloadKey("run-1")).toBe("payloads/run-1.json");
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

describe("encodeSyncPayload / decodeSyncPayload", () => {
  test("institutionCategories の Map を往復できる", () => {
    const institutionCategories = new Map([
      ["mf-1", "銀行"],
      ["mf-2", "証券"],
    ]);

    const encoded = encodeSyncPayload({ groupOnlyData: [], institutionCategories });

    // JSON を経由しても失われないことまで確認する
    const decoded = decodeSyncPayload(JSON.parse(JSON.stringify(encoded)));

    expect(encoded.institutionCategories).toEqual([
      ["mf-1", "銀行"],
      ["mf-2", "証券"],
    ]);
    expect(decoded.institutionCategories).toEqual(institutionCategories);
  });

  test("institutionCategories が無い場合はキー自体を作らない", () => {
    const encoded = encodeSyncPayload({ groupOnlyData: [] });

    expect("institutionCategories" in encoded).toBe(false);
    expect("institutionCategories" in decodeSyncPayload(encoded)).toBe(false);
  });

  test("その他のフィールドはそのまま保つ", () => {
    const encoded = encodeSyncPayload({ cleanupGroupIds: ["1"], groupOnlyData: [] });

    expect(encoded.cleanupGroupIds).toEqual(["1"]);
  });
});

describe("SYNC_MESSAGE_GROUP_ID", () => {
  test("Terraform の write_message_group_id と一致する", () => {
    expect(SYNC_MESSAGE_GROUP_ID).toBe("sqlite-write");
  });
});
