import { createServer, type ServerResponse } from "node:http";

const port = Number(process.env.MOCK_CRAWLER_PORT ?? 18_766);
const expectedToken = process.env.MOCK_CRAWLER_TOKEN ?? "e2e-refresh-token";
const clients = new Set<ServerResponse>();

const startedAt = "2026-01-01T00:00:00.000Z";
const finishedAt = "2026-01-01T00:00:10.000Z";

type MockState = Record<string, unknown> & { running: boolean };

let state: MockState = idleState();
let runCount = 0;

function idleState(): MockState {
  return { available: true, running: false };
}

function runningState(): MockState {
  return {
    running: true,
    version: 1,
    runId: `e2e-run-${runCount}`,
    runStatus: "running",
    source: "manual",
    startedAt,
    finishedAt: null,
    current: {
      timelineItemId: "authentication",
      label: "MoneyForward に認証",
      step: "authentication",
      metadata: null,
    },
    progress: { completed: 0, total: 1 },
    timeline: [
      {
        id: "authentication",
        label: "MoneyForward に認証",
        step: "authentication",
        metadata: null,
        status: "running",
        startedAt,
        finishedAt: null,
        reason: null,
      },
    ],
    reason: null,
  };
}

function completedState(): MockState {
  return {
    running: false,
    version: 1,
    runId: `e2e-run-${runCount}`,
    runStatus: "success",
    source: "manual",
    startedAt,
    finishedAt,
    current: null,
    progress: { completed: 1, total: 1 },
    timeline: [
      {
        id: "authentication",
        label: "MoneyForward に認証",
        step: "authentication",
        metadata: null,
        status: "done",
        startedAt,
        finishedAt,
        reason: null,
      },
    ],
    reason: null,
  };
}

function failedState(): MockState {
  const reason = { code: "auth_failed", message: "E2E用の認証エラー" };
  return {
    running: false,
    version: 1,
    runId: `e2e-run-${runCount}`,
    runStatus: "failed",
    source: "manual",
    startedAt,
    finishedAt,
    current: {
      timelineItemId: "authentication",
      label: "MoneyForward に認証",
      step: "authentication",
      metadata: null,
    },
    progress: null,
    timeline: [
      {
        id: "authentication",
        label: "MoneyForward に認証",
        step: "authentication",
        metadata: null,
        status: "failed",
        startedAt,
        finishedAt,
        reason,
      },
    ],
    reason,
  };
}

function writeJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

function broadcast(): void {
  const message = `data: ${JSON.stringify(state)}\n\n`;
  for (const client of clients) client.write(message);
}

function setState(nextState: MockState): void {
  state = nextState;
  broadcast();
}

const server = createServer((request, response) => {
  const url = new URL(request.url ?? "/", `http://127.0.0.1:${port}`);

  if (url.pathname === "/__test/health") {
    writeJson(response, 200, { ready: true });
    return;
  }

  if (url.pathname === "/__test/reset" && request.method === "POST") {
    runCount = 0;
    setState(idleState());
    writeJson(response, 200, state);
    return;
  }

  if (url.pathname === "/__test/complete" && request.method === "POST") {
    setState(completedState());
    writeJson(response, 200, state);
    return;
  }

  if (url.pathname === "/__test/fail" && request.method === "POST") {
    setState(failedState());
    writeJson(response, 200, state);
    return;
  }

  if (url.pathname === "/__test/state") {
    writeJson(response, 200, { runCount, state });
    return;
  }

  if (request.headers.authorization !== `Bearer ${expectedToken}`) {
    writeJson(response, 401, { error: "unauthorized" });
    return;
  }

  if (url.pathname === "/events" && request.method === "GET") {
    response.writeHead(200, {
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "content-type": "text/event-stream",
    });
    clients.add(response);
    response.write(`data: ${JSON.stringify(state)}\n\n`);
    request.once("close", () => clients.delete(response));
    return;
  }

  if (url.pathname === "/runs" && request.method === "POST") {
    if (state.running) {
      writeJson(response, 409, state);
      return;
    }

    runCount += 1;
    setState(runningState());
    writeJson(response, 202, state);
    return;
  }

  writeJson(response, 404, { error: "not found" });
});

server.listen(port, "127.0.0.1");

function close(): void {
  for (const client of clients) client.end();
  server.close(() => process.exit(0));
}

process.once("SIGINT", close);
process.once("SIGTERM", close);
