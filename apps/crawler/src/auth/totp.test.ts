import { describe, test, expect } from "vitest";
import { decodeBase32, generateTotp, secondsUntilNextWindow } from "./totp.js";

// RFC 6238 Appendix B の共有シークレット "12345678901234567890" を Base32 で表したもの
const RFC_SECRET_SHA1 = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";

describe("decodeBase32", () => {
  test("decodes a known Base32 string to its ASCII bytes", () => {
    expect(decodeBase32(RFC_SECRET_SHA1).toString("ascii")).toBe("12345678901234567890");
  });

  test("ignores the spacing and padding that authenticator apps display", () => {
    const spaced = "GEZD GNBV GY3T QOJQ-GEZD GNBV GY3T QOJQ====";
    expect(decodeBase32(spaced)).toEqual(decodeBase32(RFC_SECRET_SHA1));
  });

  test("accepts lowercase input", () => {
    expect(decodeBase32(RFC_SECRET_SHA1.toLowerCase())).toEqual(decodeBase32(RFC_SECRET_SHA1));
  });

  test("rejects an empty secret", () => {
    expect(() => decodeBase32("   ")).toThrow("TOTP secret is empty");
  });

  test("rejects characters outside the Base32 alphabet", () => {
    // 1 と 8 は Base32 アルファベットに存在しない
    expect(() => decodeBase32("GEZDGNBV1")).toThrow("outside the Base32 alphabet");
  });
});

describe("generateTotp", () => {
  // RFC 6238 Appendix B, SHA-1 の期待値
  test.each([
    [59, "94287082"],
    [1111111109, "07081804"],
    [1111111111, "14050471"],
    [1234567890, "89005924"],
    [2000000000, "69279037"],
    [20000000000, "65353130"],
  ])("matches the RFC 6238 vector at T=%i", (seconds, expected) => {
    const code = generateTotp(RFC_SECRET_SHA1, {
      timestampMs: seconds * 1000,
      digits: 8,
    });

    expect(code).toBe(expected);
  });

  test("returns six digits by default", () => {
    const code = generateTotp(RFC_SECRET_SHA1, { timestampMs: 59_000 });

    expect(code).toBe("94287082".slice(-6));
    expect(code).toMatch(/^\d{6}$/);
  });

  test("pads codes shorter than the requested digit count", () => {
    // 07081804 の下 6 桁は 081804 で、先頭が 0 になる
    expect(generateTotp(RFC_SECRET_SHA1, { timestampMs: 1111111109_000 })).toBe("081804");
  });

  test("returns the same code for every instant inside one window", () => {
    const start = generateTotp(RFC_SECRET_SHA1, { timestampMs: 1111111110_000 });
    const end = generateTotp(RFC_SECRET_SHA1, { timestampMs: 1111111139_000 });

    expect(start).toBe(end);
  });

  test("returns a different code in the next window", () => {
    const current = generateTotp(RFC_SECRET_SHA1, { timestampMs: 1111111110_000 });
    const next = generateTotp(RFC_SECRET_SHA1, { timestampMs: 1111111140_000 });

    expect(current).not.toBe(next);
  });

  test("rejects an unusable digit count", () => {
    expect(() => generateTotp(RFC_SECRET_SHA1, { digits: 0 })).toThrow("digits must be");
    expect(() => generateTotp(RFC_SECRET_SHA1, { digits: 11 })).toThrow("digits must be");
  });

  test("rejects a non-positive period", () => {
    expect(() => generateTotp(RFC_SECRET_SHA1, { periodSeconds: 0 })).toThrow(
      "period must be positive",
    );
  });
});

describe("secondsUntilNextWindow", () => {
  test("reports a full period at a window boundary", () => {
    expect(secondsUntilNextWindow(1111111110_000)).toBe(30);
  });

  test("counts down inside a window", () => {
    expect(secondsUntilNextWindow(1111111111_000)).toBe(29);
    expect(secondsUntilNextWindow(1111111139_000)).toBe(1);
  });
});
