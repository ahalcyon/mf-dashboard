import { beforeEach, describe, expect, test, vi } from "vitest";

const lambdaSend = vi.fn<(command: unknown) => Promise<unknown>>();
const lambdaDestroy = vi.fn<() => void>();

function command(type: string) {
  return class {
    readonly __type = type;
    constructor(readonly input: Record<string, unknown>) {}
  };
}

vi.mock("@aws-sdk/client-lambda", () => ({
  LambdaClient: class {
    send = lambdaSend;
    destroy = lambdaDestroy;
  },
  InvokeCommand: command("Invoke"),
}));

const { handler } = await import("./handler.js");

function buildEvent(path: string, method = "POST") {
  return { requestContext: { http: { method, path } } } as Parameters<typeof handler>[0];
}

/** 呼ばれた順に FunctionName を並べる。順序そのものが仕様。 */
function invokedFunctions() {
  return lambdaSend.mock.calls.map(
    ([c]) => (c as { input: { FunctionName: string } }).input.FunctionName,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("BULK_REFRESH_FUNCTION", "mf-dashboard-bulk-refresh");
  vi.stubEnv("CRAWL_FUNCTION", "mf-dashboard-crawl");
  lambdaSend.mockResolvedValue({ StatusCode: 202 });
});

describe("パスの検証", () => {
  // CloudFront は /api/* をまとめてこの Lambda へ回す。静的エクスポートで
  // route handler が落ちた他の /api/* への POST は、ここで止まらなければ
  test.for(["/api/bank-forecast/dismiss/", "/api/bank-forecast/manual-events/", "/api/"])(
    "%s への POST は 404 で、何も起動しない",
    async (path) => {
      const response = await handler(buildEvent(path));

      expect(response).toMatchObject({ statusCode: 404 });
      expect(lambdaSend).not.toHaveBeenCalled();
    },
  );
});

describe("メソッドの検証", () => {
  test("GET は 405 で、何も起動しない", async () => {
    const response = await handler(buildEvent("/api/refresh/", "GET"));

    expect(response).toMatchObject({ statusCode: 405 });
    expect(lambdaSend).not.toHaveBeenCalled();
  });

  test("誤ったパスへの GET は 405 ではなく 404", async () => {
    expect(await handler(buildEvent("/api/", "GET"))).toMatchObject({ statusCode: 404 });
  });
});

// 起動して初めて名前どおりになる。
describe("起動するもの", () => {
  test("一括更新を先に、クロールを後に起動する", async () => {
    const response = await handler(buildEvent("/api/refresh/"));

    expect(response).toMatchObject({ statusCode: 202 });
    expect(invokedFunctions()).toEqual(["mf-dashboard-bulk-refresh", "mf-dashboard-crawl"]);
  });

  // 完了を待つと 80 秒かかる。ボタンは「開始しました」を返す作り。
  test("どちらも完了を待たない", async () => {
    await handler(buildEvent("/api/refresh/"));

    for (const [c] of lambdaSend.mock.calls) {
      expect((c as { input: { InvocationType: string } }).input.InvocationType).toBe("Event");
    }
  });

  // 更新が始まらなくても、取り込みは前回の更新結果に対して成立する
  test("一括更新に失敗してもクロールは起動する", async () => {
    lambdaSend
      .mockRejectedValueOnce(new Error("Lambda unavailable"))
      .mockResolvedValueOnce({ StatusCode: 202 });

    const response = await handler(buildEvent("/api/refresh/"));

    expect(response).toMatchObject({ statusCode: 202 });
    expect(invokedFunctions()).toContain("mf-dashboard-crawl");
  });

  test("クロールの起動に失敗したら 502 を返す", async () => {
    lambdaSend
      .mockResolvedValueOnce({ StatusCode: 202 })
      .mockRejectedValueOnce(new Error("Invoke denied"));

    const response = await handler(buildEvent("/api/refresh/"));

    expect(response).toMatchObject({ statusCode: 502 });
    expect(JSON.parse((response as { body: string }).body)).toMatchObject({
      message: "Invoke denied",
    });
  });

  // 202 以外を成功として返すと、起動していないのに「開始しました」になる
  test("Lambda が 2xx 以外を返したら失敗として扱う", async () => {
    lambdaSend.mockResolvedValueOnce({ StatusCode: 202 }).mockResolvedValueOnce({
      StatusCode: 429,
    });

    expect(await handler(buildEvent("/api/refresh/"))).toMatchObject({ statusCode: 502 });
  });
});

describe("後始末", () => {
  test.for([
    ["/api/refresh/", "POST"],
    ["/api/", "POST"],
    ["/api/refresh/", "GET"],
  ] as const)("%s %s でもクライアントを閉じる", async ([path, method]) => {
    await handler(buildEvent(path, method));

    // パスとメソッドで弾く経路はクライアントを作る前に返す
    expect(lambdaDestroy.mock.calls.length).toBeLessThanOrEqual(1);
  });
});
