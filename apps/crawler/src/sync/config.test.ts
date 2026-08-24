import { describe, expect, test } from "vitest";
import { buildRunId, loadSyncConfig } from "./config.js";

describe("loadSyncConfig", () => {
  test("必要な2つが揃ったときだけ有効になる", () => {
    expect(loadSyncConfig({ DATA_BUCKET: "b", WRITE_QUEUE_URL: "q" })).not.toBeNull();
  });

  test.each([
    ["キューだけ", { WRITE_QUEUE_URL: "q" }],
    ["バケットだけ", { DATA_BUCKET: "b" }],
    ["どちらも無い", {}],
    ["空文字", { DATA_BUCKET: " ", WRITE_QUEUE_URL: "q" }],
  ])("%s の場合は無効", (_label, env) => {
    expect(loadSyncConfig(env)).toBeNull();
  });

  test("省略可能な値には既定を使う", () => {
    const config = loadSyncConfig({ DATA_BUCKET: "b", WRITE_QUEUE_URL: "q" });

    expect(config).toMatchObject({
      messageGroupId: "sqlite-write",
      databaseObjectKey: "db/moneyforward.db",
    });
  });

  test("指定があればそれを使う", () => {
    const config = loadSyncConfig({
      DATA_BUCKET: "b",
      WRITE_QUEUE_URL: "q",
      WRITE_MESSAGE_GROUP_ID: "custom",
      DATABASE_OBJECT_KEY: "other.db",
    });

    expect(config).toMatchObject({ messageGroupId: "custom", databaseObjectKey: "other.db" });
  });
});

describe("buildRunId", () => {
  test("S3 キーに使える文字だけで構成する", () => {
    expect(buildRunId(new Date("2026-08-25T06:30:00.000Z"))).toMatch(
      /^20260825T063000Z-[a-z0-9]{1,6}$/,
    );
  });

  test("同じ時刻でも衝突しにくい", () => {
    const at = new Date("2026-08-25T06:30:00.000Z");

    expect(buildRunId(at)).not.toBe(buildRunId(at));
  });
});
