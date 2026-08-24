import { afterEach, describe, expect, it } from "vitest";
import { withBasePath } from "./base-path";

const originalBasePath = process.env.NEXT_PUBLIC_BASE_PATH;

afterEach(() => {
  if (originalBasePath === undefined) {
    delete process.env.NEXT_PUBLIC_BASE_PATH;
  } else {
    process.env.NEXT_PUBLIC_BASE_PATH = originalBasePath;
  }
});

describe("withBasePath", () => {
  it("keeps root-relative paths for root deployments", () => {
    delete process.env.NEXT_PUBLIC_BASE_PATH;

    expect(withBasePath("/api/crawler/refresh")).toBe("/api/crawler/refresh");
  });

  it("prefixes paths for subpath deployments", () => {
    process.env.NEXT_PUBLIC_BASE_PATH = "/dashboard";

    expect(withBasePath("/api/crawler/refresh")).toBe("/dashboard/api/crawler/refresh");
  });
});
