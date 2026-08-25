import { afterEach, describe, expect, it, vi } from "vitest";

const connectionMock = vi.fn<() => Promise<void>>(() => Promise.resolve());

vi.mock("next/server", () => ({
  connection: connectionMock,
}));

const originalEnv = { ...process.env };
const { waitForRuntimeData } = await import("./runtime-rendering");

afterEach(() => {
  process.env = { ...originalEnv };
  connectionMock.mockClear();
});

describe("waitForRuntimeData", () => {
  it("waits for a runtime request outside static export builds", async () => {
    delete process.env.STATIC_EXPORT;

    await waitForRuntimeData();

    expect(connectionMock).toHaveBeenCalledTimes(1);
  });

  it("does not force runtime rendering for static export builds", async () => {
    process.env.STATIC_EXPORT = "true";

    await waitForRuntimeData();

    expect(connectionMock).not.toHaveBeenCalled();
  });
});
