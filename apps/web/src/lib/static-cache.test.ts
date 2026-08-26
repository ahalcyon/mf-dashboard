import { afterEach, describe, expect, it, vi } from "vitest";
import { memoizeDuringStaticExport } from "./static-cache";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("memoizeDuringStaticExport", () => {
  it("静的エクスポート中は同じキーの呼び出しを 1 回にまとめる", async () => {
    vi.stubEnv("STATIC_EXPORT", "true");
    const load = vi.fn<(groupId?: string) => Promise<string>>(
      async (groupId?: string) => `loaded:${groupId ?? "default"}`,
    );
    const memoized = memoizeDuringStaticExport(load, (groupId) => groupId ?? "__default__");

    const results = await Promise.all([memoized("a"), memoized("a"), memoized(undefined)]);

    expect(results).toEqual(["loaded:a", "loaded:a", "loaded:default"]);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("静的エクスポートでなければ毎回呼ぶ", async () => {
    vi.stubEnv("STATIC_EXPORT", "");
    const load = vi.fn<(groupId?: string) => Promise<string>>(
      async (groupId?: string) => `loaded:${groupId ?? "default"}`,
    );
    const memoized = memoizeDuringStaticExport(load, (groupId) => groupId ?? "__default__");

    await memoized("a");
    await memoized("a");

    expect(load).toHaveBeenCalledTimes(2);
  });

  it("失敗した結果は残さず、次の呼び出しでやり直す", async () => {
    vi.stubEnv("STATIC_EXPORT", "true");
    const load = vi
      .fn<(groupId?: string) => Promise<string>>()
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce("loaded:a");
    const memoized = memoizeDuringStaticExport(load, (groupId) => groupId ?? "__default__");

    await expect(memoized("a")).rejects.toThrow("boom");
    await expect(memoized("a")).resolves.toBe("loaded:a");
    expect(load).toHaveBeenCalledTimes(2);
  });
});
