import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";

type AnyMock = (...args: any[]) => any;

const { mockSend, mockDestroy, mockGetParametersCommand } = vi.hoisted(() => {
  const mockSend = vi.fn<AnyMock>();
  const mockDestroy = vi.fn<AnyMock>();
  const mockGetParametersCommand = vi.fn<AnyMock>();
  return { mockSend, mockDestroy, mockGetParametersCommand };
});

// SDK 側は new で生成されるため、モックもコンストラクタとして呼べる必要がある
vi.mock("@aws-sdk/client-ssm", () => ({
  SSMClient: class {
    send = mockSend;
    destroy = mockDestroy;
  },
  GetParametersCommand: class {
    constructor(input: unknown) {
      mockGetParametersCommand(input);
    }
  },
}));

import { getCredentials, getOTP, _resetCredentialsCache } from "./credentials.js";
import { generateTotp } from "./totp.js";

// RFC 6238 Appendix B の共有シークレット
const TOTP_SECRET = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";

function ssmResponse(values: Record<string, string>) {
  return {
    Parameters: Object.entries(values).map(([Name, Value]) => ({ Name, Value })),
    InvalidParameters: [],
  };
}

describe("credentials", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    _resetCredentialsCache();
    process.env = { ...originalEnv };
    delete process.env.MF_EMAIL;
    delete process.env.MF_PASSWORD;
    delete process.env.MF_TOTP_SECRET;
    delete process.env.SSM_PARAMETER_PREFIX;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe("getCredentials", () => {
    test("prefers environment variables and never calls SSM", async () => {
      process.env.MF_EMAIL = "user-a@example.com";
      process.env.MF_PASSWORD = "test-password";

      const result = await getCredentials();

      expect(result).toEqual({ username: "user-a@example.com", password: "test-password" });
      expect(mockSend).not.toHaveBeenCalled();
    });

    test("trims surrounding whitespace from environment values", async () => {
      process.env.MF_EMAIL = "  user-a@example.com  ";
      process.env.MF_PASSWORD = "  test-password  ";

      await expect(getCredentials()).resolves.toEqual({
        username: "user-a@example.com",
        password: "test-password",
      });
    });

    test("falls back to SSM when environment variables are absent", async () => {
      mockSend.mockResolvedValue(
        ssmResponse({
          "/mf-dashboard/email": "user-a@example.com",
          "/mf-dashboard/password": "test-password",
        }),
      );

      const result = await getCredentials();

      expect(result).toEqual({ username: "user-a@example.com", password: "test-password" });
      expect(mockGetParametersCommand).toHaveBeenCalledWith({
        Names: ["/mf-dashboard/email", "/mf-dashboard/password"],
        WithDecryption: true,
      });
    });

    test("requests only the values missing from the environment", async () => {
      process.env.MF_EMAIL = "user-a@example.com";
      mockSend.mockResolvedValue(ssmResponse({ "/mf-dashboard/password": "test-password" }));

      await getCredentials();

      expect(mockGetParametersCommand).toHaveBeenCalledWith({
        Names: ["/mf-dashboard/password"],
        WithDecryption: true,
      });
    });

    test("honours a custom parameter prefix", async () => {
      process.env.SSM_PARAMETER_PREFIX = "/custom/path/";
      mockSend.mockResolvedValue(
        ssmResponse({
          "/custom/path/email": "user-a@example.com",
          "/custom/path/password": "test-password",
        }),
      );

      await getCredentials();

      expect(mockGetParametersCommand).toHaveBeenCalledWith({
        Names: ["/custom/path/email", "/custom/path/password"],
        WithDecryption: true,
      });
    });

    test("reports which parameters are missing", async () => {
      mockSend.mockResolvedValue({
        Parameters: [{ Name: "/mf-dashboard/email", Value: "user-a@example.com" }],
        InvalidParameters: ["/mf-dashboard/password"],
      });

      await expect(getCredentials()).rejects.toThrow("/mf-dashboard/password");
    });

    test("releases the SSM client even when the lookup fails", async () => {
      mockSend.mockRejectedValue(new Error("AccessDeniedException"));

      await expect(getCredentials()).rejects.toThrow("AccessDeniedException");
      expect(mockDestroy).toHaveBeenCalled();
    });

    test("caches resolved values so a second call skips SSM", async () => {
      mockSend.mockResolvedValue(
        ssmResponse({
          "/mf-dashboard/email": "user-a@example.com",
          "/mf-dashboard/password": "test-password",
        }),
      );

      await getCredentials();
      await getCredentials();

      expect(mockSend).toHaveBeenCalledTimes(1);
    });
  });

  describe("getOTP", () => {
    test("generates a six digit code from the environment secret", async () => {
      process.env.MF_TOTP_SECRET = TOTP_SECRET;

      const otp = await getOTP();

      expect(otp).toMatch(/^\d{6}$/);
      expect(otp).toBe(generateTotp(TOTP_SECRET));
      expect(mockSend).not.toHaveBeenCalled();
    });

    test("generates a code from the secret stored in SSM", async () => {
      mockSend.mockResolvedValue(ssmResponse({ "/mf-dashboard/totp-secret": TOTP_SECRET }));

      const otp = await getOTP();

      expect(otp).toBe(generateTotp(TOTP_SECRET));
      expect(mockGetParametersCommand).toHaveBeenCalledWith({
        Names: ["/mf-dashboard/totp-secret"],
        WithDecryption: true,
      });
    });

    test("fails with a clear message when the secret is not stored anywhere", async () => {
      mockSend.mockResolvedValue({
        Parameters: [],
        InvalidParameters: ["/mf-dashboard/totp-secret"],
      });

      await expect(getOTP()).rejects.toThrow("/mf-dashboard/totp-secret");
    });

    test("rejects a secret that is not valid Base32", async () => {
      process.env.MF_TOTP_SECRET = "not-a-valid-secret!";

      await expect(getOTP()).rejects.toThrow("outside the Base32 alphabet");
    });
  });
});
