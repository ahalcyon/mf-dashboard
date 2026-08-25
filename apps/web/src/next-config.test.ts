import { PHASE_DEVELOPMENT_SERVER, PHASE_PRODUCTION_BUILD } from "next/constants";
import { afterEach, describe, expect, it, vi } from "vitest";

const originalEnv = { ...process.env };

async function loadConfig(phase: string, env: Record<string, string | undefined> = {}) {
  vi.resetModules();
  process.env = { ...originalEnv, ...env };
  const mod = await import("../next.config");
  return mod.default(phase);
}

afterEach(() => {
  process.env = { ...originalEnv };
});

describe("next config", () => {
  it("excludes TypeScript route handlers from static export builds", async () => {
    const config = await loadConfig(PHASE_PRODUCTION_BUILD, { STATIC_EXPORT: "true" });

    expect(config.output).toBe("export");
    expect(config.pageExtensions).toEqual(["tsx"]);
  });

  it("keeps TypeScript route handlers available during development", async () => {
    const config = await loadConfig(PHASE_DEVELOPMENT_SERVER, { STATIC_EXPORT: "true" });

    expect(config.output).toBe("standalone");
    expect(config.pageExtensions).toEqual(["tsx", "ts"]);
  });

  it("does not switch to static export just because it is the demo", async () => {
    const config = await loadConfig(PHASE_PRODUCTION_BUILD, { DEMO_MODE: "true" });

    expect(config.output).toBe("standalone");
    expect(config.pageExtensions).toEqual(["tsx", "ts"]);
  });

  it("keeps TypeScript route handlers available for runtime server builds", async () => {
    const config = await loadConfig(PHASE_PRODUCTION_BUILD);

    expect(config.output).toBe("standalone");
    expect(config.outputFileTracingRoot).toBeDefined();
    expect(config.pageExtensions).toEqual(["tsx", "ts"]);
  });

  it("configures the documented deployment base path", async () => {
    const config = await loadConfig(PHASE_PRODUCTION_BUILD, {
      NEXT_PUBLIC_BASE_PATH: "/dashboard",
    });

    expect(config.basePath).toBe("/dashboard");
  });

  it("uses root deployment when the base path is empty", async () => {
    const config = await loadConfig(PHASE_PRODUCTION_BUILD, {
      NEXT_PUBLIC_BASE_PATH: "",
    });

    expect(config.basePath).toBeUndefined();
  });
});
