import { existsSync } from "node:fs";
import { join } from "node:path";
import { loadEnvFile } from "node:process";
import type { NextConfig } from "next";
import { PHASE_PRODUCTION_BUILD } from "next/constants";

const rootEnvPath = join(import.meta.dirname, "../../.env");

if (existsSync(rootEnvPath)) {
  loadEnvFile(rootEnvPath);
}

export default function createNextConfig(phase: string): NextConfig {
  // DEMO_MODE は混ぜない
  const isStaticExport = process.env.STATIC_EXPORT === "true" && phase === PHASE_PRODUCTION_BUILD;
  const basePath = process.env.NEXT_PUBLIC_BASE_PATH || undefined;

  return {
    basePath,
    output: isStaticExport ? "export" : "standalone",
    outputFileTracingRoot: join(import.meta.dirname, "../.."),
    outputFileTracingIncludes: {
      "/*": ["../../node_modules/@swc/helpers/**/*"],
    },
    pageExtensions: isStaticExport ? ["tsx"] : ["tsx", "ts"],
    typedRoutes: true,
    images: {
      unoptimized: true,
    },
    trailingSlash: true,
    reactCompiler: true,
    experimental: {
      typedEnv: true,
      useTypeScriptCli: true,
    },
  };
}
