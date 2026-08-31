import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createClient } from "@libsql/client";
import type { SQSEvent, SQSRecord } from "aws-lambda";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createFakeS3Client, FakeNoSuchKey, FakeS3 } from "./fake-s3.js";

const store = new FakeS3();

/** PutEvents に渡された Entries を溜める。送った回数と中身の両方を見たい。 */
const { putEvents } = vi.hoisted(() => ({
  putEvents: vi.fn<(input: unknown) => { FailedEntryCount: number }>(() => ({
    FailedEntryCount: 0,
  })),
}));

// s3.ts ごと差し替えず SDK を差し替える。NoSuchKey の扱いや
vi.mock("@aws-sdk/client-s3", () => ({
  S3Client: class {
    private readonly delegate = createFakeS3Client(store);
    send = (command: unknown) => this.delegate.send(command as never);
    destroy = () => {};
  },
  GetObjectCommand: class {
    readonly kind = "get";
    constructor(readonly input: { Bucket: string; Key: string }) {}
  },
  PutObjectCommand: class {
    readonly kind = "put";
    constructor(readonly input: { Bucket: string; Key: string; Body: Buffer }) {}
  },
  NoSuchKey: FakeNoSuchKey,
}));

vi.mock("@aws-sdk/client-eventbridge", () => ({
  EventBridgeClient: class {
    send = async (command: { input: unknown }) => putEvents(command.input);
    destroy = () => {};
  },
  PutEventsCommand: class {
    constructor(readonly input: unknown) {}
  },
}));

const { handler } = await import("./handler.js");

const BUCKET = "test-data-bucket";
const DB_KEY = "db/moneyforward.db";
const MIGRATIONS_DIR = path.resolve(import.meta.dirname, "../../../packages/db/drizzle");
const EVENT_BUS = "default";
const EVENT_SOURCE = "mf-dashboard.writer";
const EVENT_DETAIL_TYPE = "Crawl Completed";

let workDir: string;

function scrapedData(groupId: string, groupName: string, totalAssets: number) {
  return {
    summary: {
      totalAssets: String(totalAssets),
      dailyChange: "+0",
      dailyChangePercent: "+0%",
      monthlyChange: "+0",
      monthlyChangePercent: "+0%",
    },
    items: [],
    cashFlow: {
      month: "2026-07",
      isComplete: true,
      totalIncome: 0,
      totalExpense: 0,
      balance: 0,
      items: [],
    },
    portfolio: { totalAssets, items: [] },
    liabilities: { totalLiabilities: 0, items: [] },
    assetHistory: { points: [] },
    registeredAccounts: { accounts: [] },
    spendingTargets: null,
    currentGroup: { id: groupId, name: groupName, isCurrent: true },
    refreshResult: { completed: true, incompleteAccounts: [] },
    updatedAt: "2026-07-17T00:00:00.000Z",
  };
}

/** payload を S3 へ置き、それを指す SQS レコードを組み立てる。 */
function enqueue(
  messageId: string,
  runId: string,
  payload: unknown,
  kind = "scraped-data",
): SQSRecord {
  const key = `payloads/${runId}/${messageId}-${kind}.json`;
  store.put(key, JSON.stringify(payload));

  return {
    messageId,
    body: JSON.stringify({
      version: 1,
      runId,
      kind,
      producedAt: "2026-07-17T00:00:00.000Z",
      payload: { bucket: BUCKET, key },
    }),
  } as SQSRecord;
}

/** クロールの終わりを示す印。適用するデータを持たない。 */
function completeRecord(messageId: string, runId = messageId): SQSRecord {
  return enqueue(messageId, runId, { kind: "crawl-complete" }, "crawl-complete");
}

function goodRecord(messageId: string, groupId: string, groupName: string, totalAssets = 1000) {
  return enqueue(messageId, messageId, {
    kind: "scraped-data",
    groupOnlyData: [scrapedData(groupId, groupName, totalAssets)],
  });
}

/** kind が食い違うと handler が例外にする。適用失敗を作るのに使う。 */
function poisonRecord(messageId: string): SQSRecord {
  return enqueue(messageId, messageId, { kind: "unknown-kind" });
}

function asEvent(records: SQSRecord[]): SQSEvent {
  return { Records: records };
}

async function readGroupNames(): Promise<string[]> {
  const uploaded = store.get(DB_KEY);
  expect(uploaded).toBeInstanceOf(Buffer);

  const inspectPath = path.join(workDir, "inspect.db");
  writeFileSync(inspectPath, uploaded!);
  const client = createClient({ url: `file:${inspectPath}` });
  try {
    const result = await client.execute("select name from groups order by name");
    return result.rows.map((row) => String(row.name));
  } finally {
    client.close();
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  putEvents.mockReturnValue({ FailedEntryCount: 0 });
  store.objects.clear();
  store.puts.length = 0;
  workDir = mkdtempSync(path.join(tmpdir(), "mf-writer-"));

  vi.stubEnv("DATA_BUCKET", BUCKET);
  vi.stubEnv("DATABASE_OBJECT_KEY", DB_KEY);
  vi.stubEnv("DATABASE_LOCAL_PATH", path.join(workDir, "moneyforward.db"));
  vi.stubEnv("MIGRATIONS_DIR", MIGRATIONS_DIR);
  vi.stubEnv("EVENT_BUS_NAME", EVENT_BUS);
  vi.stubEnv("CRAWL_COMPLETED_SOURCE", EVENT_SOURCE);
  vi.stubEnv("CRAWL_COMPLETED_DETAIL_TYPE", EVENT_DETAIL_TYPE);
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "info").mockImplementation(() => {});
});

afterEach(() => {
  rmSync(workDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("初回クロール", () => {
  // 一度もクロールできない。
  test("S3 に DB が無くてもマイグレーションから作って書き戻す", async () => {
    const response = await handler(asEvent([goodRecord("m1", "g1", "Group A")]));

    expect(response.batchItemFailures).toEqual([]);
    expect(store.puts).toEqual([DB_KEY]);
    expect(await readGroupNames()).toEqual(["Group A"]);
  });
});

describe("最初の失敗で止める", () => {
  test("2 件目が失敗したら 2 件目以降を失敗として返す", async () => {
    const response = await handler(
      asEvent([
        goodRecord("m1", "g1", "Group A"),
        poisonRecord("m2"),
        goodRecord("m3", "g3", "Group C"),
      ]),
    );

    // break を continue に変えると m2 だけになり、m3 が成功扱いで消える
    expect(response.batchItemFailures).toEqual([
      { itemIdentifier: "m2" },
      { itemIdentifier: "m3" },
    ]);
  });

  test("失敗より後ろのメッセージは適用しない", async () => {
    await handler(
      asEvent([
        goodRecord("m1", "g1", "Group A"),
        poisonRecord("m2"),
        goodRecord("m3", "g3", "Group C"),
      ]),
    );

    expect(await readGroupNames()).toEqual(["Group A"]);
  });

  test("1 件目が失敗したら何も書き戻さない", async () => {
    const response = await handler(
      asEvent([poisonRecord("m1"), goodRecord("m2", "g2", "Group B")]),
    );

    expect(response.batchItemFailures).toEqual([
      { itemIdentifier: "m1" },
      { itemIdentifier: "m2" },
    ]);
    expect(store.puts).toEqual([]);
  });
});

describe("部分適用でも書き戻す", () => {
  // ここを「全部成功したときだけ書き戻す」に変えると、適用済みの分が
  // 消えたまま SQS からも削除され、その payload は二度と戻らない。
  test("途中で失敗しても適用済みの分はアップロードする", async () => {
    await handler(
      asEvent([
        goodRecord("m1", "g1", "Group A"),
        goodRecord("m2", "g2", "Group B"),
        poisonRecord("m3"),
      ]),
    );

    expect(store.puts).toEqual([DB_KEY]);
    expect(await readGroupNames()).toEqual(["Group A", "Group B"]);
  });

  test("アップロードは 1 回にまとめる", async () => {
    await handler(
      asEvent([
        goodRecord("m1", "g1", "Group A"),
        goodRecord("m2", "g2", "Group B"),
        goodRecord("m3", "g3", "Group C"),
      ]),
    );

    expect(store.puts).toEqual([DB_KEY]);
  });
});

describe("既存のデータベースを引き継ぐ", () => {
  test("2 回目の呼び出しは 1 回目の内容の上へ積む", async () => {
    await handler(asEvent([goodRecord("m1", "g1", "Group A")]));
    await handler(asEvent([goodRecord("m2", "g2", "Group B")]));

    expect(await readGroupNames()).toEqual(["Group A", "Group B"]);
  });

  // SQS の再配信で同じメッセージがもう一度届く。saveScrapedDataBatch が
  // upsert である前提に writer の部分失敗設計が乗っている。
  test("同じメッセージを 2 回適用しても内容が増えない", async () => {
    await handler(asEvent([goodRecord("m1", "g1", "Group A")]));
    const afterFirst = await readGroupNames();

    await handler(asEvent([goodRecord("m1", "g1", "Group A")]));

    expect(await readGroupNames()).toEqual(afterFirst);
  });
});

describe("再ビルドの合図", () => {
  test("印が届いたら 1 回だけ知らせる", async () => {
    await handler(
      asEvent([
        goodRecord("m1", "g1", "Group A"),
        goodRecord("m2", "g2", "Group B"),
        completeRecord("m3", "run-1"),
      ]),
    );

    expect(putEvents).toHaveBeenCalledTimes(1);
  });

  test("イベントの宛先と名前は設定どおり", async () => {
    await handler(asEvent([goodRecord("m1", "g1", "Group A"), completeRecord("m2", "run-1")]));

    const [input] = putEvents.mock.calls[0] as [{ Entries: Record<string, string>[] }];
    expect(input.Entries).toEqual([
      {
        EventBusName: EVENT_BUS,
        Source: EVENT_SOURCE,
        DetailType: EVENT_DETAIL_TYPE,
        Detail: JSON.stringify({ runId: "run-1" }),
      },
    ]);
  });

  // 印が来るまでは、その run がまだ続いているかもしれない。
  test("印が無ければ知らせない", async () => {
    await handler(asEvent([goodRecord("m1", "g1", "Group A")]));

    expect(putEvents).not.toHaveBeenCalled();
  });

  // ここを逆にすると site-builder が 1 世代前のデータベースを読んでビルドする。
  test("書き戻してから知らせる", async () => {
    let putsWhenAnnounced: string[] = [];
    putEvents.mockImplementation(() => {
      putsWhenAnnounced = [...store.puts];
      return { FailedEntryCount: 0 };
    });

    await handler(asEvent([goodRecord("m1", "g1", "Group A"), completeRecord("m2", "run-1")]));

    expect(putsWhenAnnounced).toEqual([DB_KEY]);
  });

  test("印より前で失敗したら知らせない", async () => {
    await handler(
      asEvent([goodRecord("m1", "g1", "Group A"), poisonRecord("m2"), completeRecord("m3")]),
    );

    expect(putEvents).not.toHaveBeenCalled();
  });

  // 直前のバッチで書き戻し済みの run。数 MB を上げ直す意味は無いが、
  // 再ビルドは起こさなければならない。
  test("印だけのバッチではデータベースを上げ直さない", async () => {
    await handler(asEvent([goodRecord("m1", "g1", "Group A")]));
    store.puts.length = 0;

    await handler(asEvent([completeRecord("m2", "run-1")]));

    expect(store.puts).toEqual([]);
    expect(putEvents).toHaveBeenCalledTimes(1);
  });

  // PutEvents はエントリが弾かれても HTTP 200 を返す。見逃すと再ビルドが
  // 起きないままメッセージが消え、サイトが黙って古いままになる。
  test("エントリが弾かれたら失敗として扱う", async () => {
    putEvents.mockReturnValue({ FailedEntryCount: 1 });

    await expect(
      handler(asEvent([goodRecord("m1", "g1", "Group A"), completeRecord("m2", "run-1")])),
    ).rejects.toThrow(/PutEvents rejected/);
  });
});
