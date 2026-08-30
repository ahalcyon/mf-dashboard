import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { NoSuchKey } from "@aws-sdk/client-s3";
import {
  SYNC_MESSAGE_GROUP_ID,
  type SyncMessage,
  type SyncPayload,
} from "@mf-dashboard/db/sync/message";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { SyncConfig } from "./config.js";

/**
 * publisher は run.test.ts の対象外になっている。loadSyncConfig がテスト環境で
 * null を返すため、この経路が一度も実行されない。
 *
 * 壊れても静かなので、ここで直接押さえる。S3 の put と SQS の send を
 * 入れ替えると、writer が payload の無いキーを読みに行って DLQ へ落ちる。
 */

const { s3Send, sqsSend } = vi.hoisted(() => ({
  s3Send: vi.fn<(command: unknown) => Promise<unknown>>(),
  sqsSend: vi.fn<(command: unknown) => Promise<unknown>>(),
}));

vi.mock("@aws-sdk/client-s3", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@aws-sdk/client-s3")>();
  return {
    ...actual,
    S3Client: class {
      send = s3Send;
      destroy = vi.fn<() => void>();
    },
  };
});

vi.mock("@aws-sdk/client-sqs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@aws-sdk/client-sqs")>();
  return {
    ...actual,
    SQSClient: class {
      send = sqsSend;
      destroy = vi.fn<() => void>();
    },
  };
});

vi.mock("../logger.js", () => ({ info: vi.fn<() => void>(), warn: vi.fn<() => void>() }));

const { SyncPublisher } = await import("./publisher.js");

const config: SyncConfig = {
  bucket: "test-bucket",
  queueUrl: "https://sqs.example.invalid/queue.fifo",
  messageGroupId: SYNC_MESSAGE_GROUP_ID,
  databaseObjectKey: "db/moneyforward.db",
};

let workDir: string;

beforeEach(async () => {
  s3Send.mockReset();
  sqsSend.mockReset();
  workDir = await mkdtemp(path.join(tmpdir(), "publisher-test-"));
});

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

describe("downloadDatabase", () => {
  test("S3 に複製があれば書き出して true を返す", async () => {
    s3Send.mockResolvedValue({ Body: Readable.from([Buffer.from("sqlite-bytes")]) });
    const localPath = path.join(workDir, "nested", "moneyforward.db");

    const publisher = new SyncPublisher(config, "run-1");

    expect(await publisher.downloadDatabase(localPath)).toBe(true);
    expect(await readFile(localPath, "utf8")).toBe("sqlite-bytes");
  });

  // false はそのまま history モードを意味する。ここで true を返すと
  // 初回クロールが空の DB を「既存」とみなし、履歴を取り込まない。
  test("S3 に複製が無ければ false を返す", async () => {
    s3Send.mockRejectedValue(new NoSuchKey({ message: "missing", $metadata: {} }));

    const publisher = new SyncPublisher(config, "run-1");

    expect(await publisher.downloadDatabase(path.join(workDir, "moneyforward.db"))).toBe(false);
  });

  // 権限不足や通信断まで false にすると、既存の履歴がある状態で
  // history モードに落ちて全期間を取り直す。区別して投げる。
  test("NoSuchKey 以外の失敗は握りつぶさない", async () => {
    s3Send.mockRejectedValue(new Error("AccessDenied"));

    const publisher = new SyncPublisher(config, "run-1");

    await expect(publisher.downloadDatabase(path.join(workDir, "moneyforward.db"))).rejects.toThrow(
      "AccessDenied",
    );
  });

  test("本文が空なら失敗として扱う", async () => {
    s3Send.mockResolvedValue({ Body: undefined });

    const publisher = new SyncPublisher(config, "run-1");

    await expect(publisher.downloadDatabase(path.join(workDir, "moneyforward.db"))).rejects.toThrow(
      /empty database body/,
    );
  });

  // 前回のクロールが残した複製を消さないまま書き足すと、壊れた SQLite になる。
  test("既にファイルがあっても取り直した内容で置き換える", async () => {
    const localPath = path.join(workDir, "moneyforward.db");
    await writeFile(localPath, "stale-and-longer-than-the-new-body");
    s3Send.mockResolvedValue({ Body: Readable.from([Buffer.from("fresh")]) });

    const publisher = new SyncPublisher(config, "run-1");
    await publisher.downloadDatabase(localPath);

    expect(await readFile(localPath, "utf8")).toBe("fresh");
  });
});

describe("publish", () => {
  const payload: SyncPayload = { kind: "scraped-data", groupOnlyData: [] };

  test("ペイロードを S3 へ置いてからキューへ送る", async () => {
    const order: string[] = [];
    s3Send.mockImplementation(async () => {
      order.push("s3");
    });
    sqsSend.mockImplementation(async () => {
      order.push("sqs");
    });

    await new SyncPublisher(config, "run-1").publish("scraped-data", payload);

    expect(order).toEqual(["s3", "sqs"]);
  });

  test("S3 が失敗したらキューへ送らない", async () => {
    s3Send.mockRejectedValue(new Error("PutObject denied"));
    sqsSend.mockResolvedValue({});

    await expect(
      new SyncPublisher(config, "run-1").publish("scraped-data", payload),
    ).rejects.toThrow("PutObject denied");

    expect(sqsSend).not.toHaveBeenCalled();
  });

  // 分けると writer が並行して走り、S3 上の SQLite が read-modify-write で競合する。
  test("設定された MessageGroupId で送る", async () => {
    s3Send.mockResolvedValue({});
    sqsSend.mockResolvedValue({});

    await new SyncPublisher(config, "run-1").publish("scraped-data", payload);

    const [command] = sqsSend.mock.calls[0] as [{ input: { MessageGroupId: string } }];
    expect(command.input.MessageGroupId).toBe(SYNC_MESSAGE_GROUP_ID);
  });

  test("キューへ送る位置と S3 へ置いた位置が一致する", async () => {
    s3Send.mockResolvedValue({});
    sqsSend.mockResolvedValue({});

    await new SyncPublisher(config, "run-1").publish("scraped-data", payload);

    const [putCommand] = s3Send.mock.calls[0] as [{ input: { Bucket: string; Key: string } }];
    const [sendCommand] = sqsSend.mock.calls[0] as [{ input: { MessageBody: string } }];
    const message = JSON.parse(sendCommand.input.MessageBody) as SyncMessage;

    expect(message.payload).toEqual({ bucket: putCommand.input.Bucket, key: putCommand.input.Key });
  });

  // 履歴は月ごとに発行するので、1 回のクロールが何度も publish を呼ぶ。
  // キーが同じだと最後の中身で上書きされ、先に送ったメッセージが
  // 別の月のペイロードを指す。writer はそれを気付かずに適用する。
  test("同じ run で複数回発行してもキーが衝突しない", async () => {
    s3Send.mockResolvedValue({});
    sqsSend.mockResolvedValue({});
    const publisher = new SyncPublisher(config, "run-1");

    await publisher.publish("scraped-data", payload);
    await publisher.publish("scraped-data", payload);
    await publisher.publish("scraped-data", payload);

    const keys = s3Send.mock.calls.map(
      ([command]) => (command as { input: { Key: string } }).input.Key,
    );
    expect(new Set(keys).size).toBe(3);
  });

  test("複数回発行しても各メッセージが自分のペイロードを指す", async () => {
    s3Send.mockResolvedValue({});
    sqsSend.mockResolvedValue({});
    const publisher = new SyncPublisher(config, "run-1");

    await publisher.publish("scraped-data", payload);
    await publisher.publish("scraped-data", payload);

    const putKeys = s3Send.mock.calls.map(
      ([command]) => (command as { input: { Key: string } }).input.Key,
    );
    const messageKeys = sqsSend.mock.calls.map(([command]) => {
      const body = (command as { input: { MessageBody: string } }).input.MessageBody;
      return (JSON.parse(body) as SyncMessage).payload.key;
    });

    expect(messageKeys).toEqual(putKeys);
  });

  test("S3 へ置く本文は渡したペイロードそのもの", async () => {
    s3Send.mockResolvedValue({});
    sqsSend.mockResolvedValue({});

    await new SyncPublisher(config, "run-1").publish("scraped-data", payload);

    const [putCommand] = s3Send.mock.calls[0] as [{ input: { Body: string } }];
    expect(JSON.parse(putCommand.input.Body)).toEqual(payload);
  });
});

/**
 * 静的サイトの再ビルドはこの印を起点にする。送らなければ、適用済みの内容が
 * 次のクロールまでサイトに出ない。
 */
describe("publishCrawlComplete", () => {
  const payload: SyncPayload = { kind: "scraped-data", groupOnlyData: [] };

  test("発行済みなら crawl-complete を送る", async () => {
    s3Send.mockResolvedValue({});
    sqsSend.mockResolvedValue({});
    const publisher = new SyncPublisher(config, "run-1");

    await publisher.publish("scraped-data", payload);
    await publisher.publishCrawlComplete();

    const kinds = sqsSend.mock.calls.map(([command]) => {
      const body = (command as { input: { MessageBody: string } }).input.MessageBody;
      return (JSON.parse(body) as SyncMessage).kind;
    });
    expect(kinds).toEqual(["scraped-data", "crawl-complete"]);
  });

  // 何も書き戻していない run で再ビルドを起こしても、出る内容が変わらない。
  test("一度も発行していなければ送らない", async () => {
    s3Send.mockResolvedValue({});
    sqsSend.mockResolvedValue({});

    await new SyncPublisher(config, "run-1").publishCrawlComplete();

    expect(sqsSend).not.toHaveBeenCalled();
    expect(s3Send).not.toHaveBeenCalled();
  });

  // 連番を共有しないと、印のペイロードが直前の月を上書きする。
  test("ペイロードのキーが直前の発行と衝突しない", async () => {
    s3Send.mockResolvedValue({});
    sqsSend.mockResolvedValue({});
    const publisher = new SyncPublisher(config, "run-1");

    await publisher.publish("scraped-data", payload);
    await publisher.publishCrawlComplete();

    const keys = s3Send.mock.calls.map(
      ([command]) => (command as { input: { Key: string } }).input.Key,
    );
    expect(new Set(keys).size).toBe(2);
  });
});
