import { beforeEach, describe, expect, test, vi } from "vitest";

const send = vi.fn<(command: unknown) => Promise<unknown>>();
const destroy = vi.fn<() => void>();
const lambdaSend = vi.fn<(command: unknown) => Promise<unknown>>();
const lambdaDestroy = vi.fn<() => void>();

// SDK のコマンドは new で組み立てられるので、アロー関数では代用できない
function command(type: string) {
  return class {
    readonly __type = type;
    constructor(readonly input: Record<string, unknown>) {}
  };
}

vi.mock("@aws-sdk/client-ecs", () => ({
  ECSClient: class {
    send = send;
    destroy = destroy;
  },
  ListTasksCommand: command("ListTasks"),
  DescribeTasksCommand: command("DescribeTasks"),
  RunTaskCommand: command("RunTask"),
}));

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

function commandTypes() {
  return send.mock.calls.map(([command]) => (command as { __type: string }).__type);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("ECS_CLUSTER", "mf-dashboard");
  vi.stubEnv(
    "CRAWLER_TASK_DEFINITION",
    "arn:aws:ecs:ap-northeast-1:000000000000:task-definition/mf-dashboard-crawler:1",
  );
  vi.stubEnv("SUBNET_IDS", "subnet-a,subnet-b");
  vi.stubEnv("SECURITY_GROUP_IDS", "sg-a");
  vi.stubEnv("BULK_REFRESH_FUNCTION", "mf-dashboard-bulk-refresh");
  lambdaSend.mockResolvedValue({});
});

// ボタンのラベルは「金融機関データを更新」。クロールを起動するだけでは、
// SKIP_REFRESH を焼き込んだ時点でその名前が嘘になる。
describe("一括更新の開始", () => {
  test("クロールと一緒に bulk-refresh を非同期で呼ぶ", async () => {
    send
      .mockResolvedValueOnce({ taskArns: [] })
      .mockResolvedValueOnce({ tasks: [{ taskArn: "arn:task/manual" }] });

    const response = await handler(buildEvent("/api/refresh/"));

    expect(response).toMatchObject({ statusCode: 202 });
    const [invoke] = lambdaSend.mock.calls[0] as [{ input: Record<string, unknown> }];
    expect(invoke.input).toMatchObject({
      FunctionName: "mf-dashboard-bulk-refresh",
      // 完了を待つと、外したはずの待ちがボタン経由で戻ってくる
      InvocationType: "Event",
    });
  });

  // 409 を返す場合にまで呼ぶと、押すたびに Money Forward へログインしてしまう
  test("実行中で 409 を返すときは呼ばない", async () => {
    send.mockResolvedValueOnce({ taskArns: ["arn:task/running"] }).mockResolvedValueOnce({
      tasks: [{ lastStatus: "RUNNING" }],
    });

    const response = await handler(buildEvent("/api/refresh/"));

    expect(response).toMatchObject({ statusCode: 409 });
    expect(lambdaSend).not.toHaveBeenCalled();
  });

  // 更新が始まらなくても、取り込みは前回の更新結果に対して成立する
  test("一括更新に失敗してもクロールは起動する", async () => {
    lambdaSend.mockRejectedValue(new Error("Lambda unavailable"));
    send
      .mockResolvedValueOnce({ taskArns: [] })
      .mockResolvedValueOnce({ tasks: [{ taskArn: "arn:task/manual" }] });

    const response = await handler(buildEvent("/api/refresh/"));

    expect(response).toMatchObject({ statusCode: 202 });
    expect(commandTypes()).toContain("RunTask");
  });

  test("Lambda クライアントも閉じる", async () => {
    send
      .mockResolvedValueOnce({ taskArns: [] })
      .mockResolvedValueOnce({ tasks: [{ taskArn: "arn:task/manual" }] });

    await handler(buildEvent("/api/refresh/"));

    expect(lambdaDestroy).toHaveBeenCalledOnce();
  });
});

describe("パスの検証", () => {
  // CloudFront は /api/* をまとめてこの Lambda へ回す。静的エクスポートで
  // route handler が落ちた他の /api/* への POST は、ここで止まらなければ
  // クロールを起動してしまう。
  test.for(["/api/bank-forecast/dismiss/", "/api/bank-forecast/manual-events/", "/api/"])(
    "%s への POST は 404 で、ECS を一切呼ばない",
    async (path) => {
      const response = await handler(buildEvent(path));

      expect(response).toMatchObject({ statusCode: 404 });
      expect(send).not.toHaveBeenCalled();
    },
  );

  test("/api/refresh/ への POST は ECS を呼ぶ", async () => {
    send
      .mockResolvedValueOnce({ taskArns: [] })
      .mockResolvedValueOnce({ tasks: [{ taskArn: "arn:aws:ecs:task/abc" }] });

    const response = await handler(buildEvent("/api/refresh/"));

    expect(response).toMatchObject({ statusCode: 202 });
    expect(commandTypes()).toEqual(["ListTasks", "RunTask"]);
  });
});

describe("メソッドの検証", () => {
  test.for(["GET", "PATCH", "DELETE"])("%s は 405 で、ECS を呼ばない", async (method) => {
    const response = await handler(buildEvent("/api/refresh/", method));

    expect(response).toMatchObject({ statusCode: 405 });
    expect(send).not.toHaveBeenCalled();
  });

  // パスが誤っていればメソッドを問わず 404。405 を返すと、そこに何かが
  // あるように読めてしまう。
  test("誤ったパスへの GET は 405 ではなく 404", async () => {
    const response = await handler(buildEvent("/api/bank-forecast/dismiss/", "GET"));

    expect(response).toMatchObject({ statusCode: 404 });
  });
});

describe("二重起動の抑止", () => {
  test("実行中のタスクがあれば 409 を返し、RunTask を呼ばない", async () => {
    send
      .mockResolvedValueOnce({ taskArns: ["arn:aws:ecs:task/running"] })
      .mockResolvedValueOnce({ tasks: [{ lastStatus: "RUNNING" }] });

    const response = await handler(buildEvent("/api/refresh/"));

    expect(response).toMatchObject({ statusCode: 409 });
    expect(commandTypes()).toEqual(["ListTasks", "DescribeTasks"]);
  });

  test("停止済みのタスクしか無ければ起動する", async () => {
    send
      .mockResolvedValueOnce({ taskArns: ["arn:aws:ecs:task/old"] })
      .mockResolvedValueOnce({ tasks: [{ lastStatus: "STOPPED" }] })
      .mockResolvedValueOnce({ tasks: [{ taskArn: "arn:aws:ecs:task/new" }] });

    const response = await handler(buildEvent("/api/refresh/"));

    expect(response).toMatchObject({ statusCode: 202 });
    expect(commandTypes()).toEqual(["ListTasks", "DescribeTasks", "RunTask"]);
  });
});

describe("タスクファミリーの導出", () => {
  // ここが壊れると ListTasks が空を返し、二重起動の抑止ごと素通りする
  test("完全な ARN からファミリー名だけを取り出して ListTasks に渡す", async () => {
    send
      .mockResolvedValueOnce({ taskArns: [] })
      .mockResolvedValueOnce({ tasks: [{ taskArn: "arn:aws:ecs:task/abc" }] });

    await handler(buildEvent("/api/refresh/"));

    const [listCommand] = send.mock.calls[0] as [{ input: { family?: string } }];
    expect(listCommand.input.family).toBe("mf-dashboard-crawler");
  });
});

describe("後始末", () => {
  test("どの経路でもクライアントを閉じる", async () => {
    send.mockRejectedValueOnce(new Error("ECS is unavailable"));

    const response = await handler(buildEvent("/api/refresh/"));

    expect(response).toMatchObject({ statusCode: 502 });
    expect(destroy).toHaveBeenCalledOnce();
  });
});
