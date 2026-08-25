import { describe, expect, test } from "vitest";
import { hasActiveTask, isRefreshPath, toResponse } from "./result.js";

describe("toResponse", () => {
  test("起動できたら 202 とタスク ARN を返す", () => {
    const response = toResponse({ kind: "started", taskArn: "arn:aws:ecs:...:task/abc" });

    expect(response.statusCode).toBe(202);
    expect(JSON.parse(response.body)).toEqual({
      status: "started",
      taskArn: "arn:aws:ecs:...:task/abc",
    });
  });

  test("実行中なら 409 を返す", () => {
    expect(toResponse({ kind: "already-running" }).statusCode).toBe(409);
  });

  test("POST 以外は 405 を返す", () => {
    expect(toResponse({ kind: "method-not-allowed" }).statusCode).toBe(405);
  });

  test("起動に失敗したら 502 と理由を返す", () => {
    const response = toResponse({ kind: "failed", message: "RunTask denied" });

    expect(response.statusCode).toBe(502);
    expect(JSON.parse(response.body)).toEqual({ status: "failed", message: "RunTask denied" });
  });

  test("いずれの応答も保存させない", () => {
    for (const outcome of [
      { kind: "started", taskArn: "a" },
      { kind: "already-running" },
      { kind: "method-not-allowed" },
      { kind: "failed", message: "x" },
    ] as const) {
      expect(toResponse(outcome).headers["cache-control"]).toBe("no-store");
    }
  });
});

describe("hasActiveTask", () => {
  test.each(["PROVISIONING", "PENDING", "ACTIVATING", "RUNNING"])(
    "%s はまだ終わっていないとみなす",
    (status) => {
      expect(hasActiveTask([status])).toBe(true);
    },
  );

  test.each(["DEACTIVATING", "STOPPING", "DEPROVISIONING", "STOPPED"])(
    "%s は終了に向かっているので新しい起動を妨げない",
    (status) => {
      expect(hasActiveTask([status])).toBe(false);
    },
  );

  test("タスクが無ければ起動できる", () => {
    expect(hasActiveTask([])).toBe(false);
  });

  test("状態を取得できなかったタスクは判断材料にしない", () => {
    expect(hasActiveTask([undefined])).toBe(false);
  });

  test("1 つでも実行中なら起動しない", () => {
    expect(hasActiveTask(["STOPPED", "RUNNING"])).toBe(true);
  });
});

describe("isRefreshPath", () => {
  // CloudFront は /api/* をまとめてこの Lambda へ回す。静的エクスポートで
  // 落ちた他の /api/* への POST がクロールを起動しないことがここの要点。
  test.for(["/api/refresh", "/api/refresh/"])("%s は受け付ける", (path) => {
    expect(isRefreshPath(path)).toBe(true);
  });

  test.for(["/dashboard/api/refresh/", "/dashboard/api/refresh"])(
    "basePath 配下の %s も受け付ける",
    (path) => {
      expect(isRefreshPath(path)).toBe(true);
    },
  );

  test.for([
    "/api/bank-forecast/dismiss",
    "/api/bank-forecast/dismiss/",
    "/api/bank-forecast/manual-events/",
    "/api/",
    "/api/refresh/extra",
    "/api/refreshed",
    "/",
  ])("%s は拒否する", (path) => {
    expect(isRefreshPath(path)).toBe(false);
  });

  test("パスが無ければ拒否する", () => {
    expect(isRefreshPath(undefined)).toBe(false);
    expect(isRefreshPath("")).toBe(false);
  });
});

describe("not-found", () => {
  test("404 を返し、本文で理由を示す", () => {
    const response = toResponse({ kind: "not-found" });

    expect(response.statusCode).toBe(404);
    expect(JSON.parse(response.body)).toEqual({ status: "not-found" });
    expect(response.headers["cache-control"]).toBe("no-store");
  });
});
