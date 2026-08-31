import { mfUrls } from "@mf-dashboard/meta/urls";
import type { Page } from "playwright";
import { beforeEach, describe, expect, test, vi } from "vitest";

const { debug, getCredentials, getOTP, info, log } = vi.hoisted(() => ({
  debug: vi.fn<(...args: unknown[]) => void>(),
  getCredentials: vi.fn<() => Promise<{ password: string; username: string }>>(),
  getOTP: vi.fn<() => Promise<string>>(),
  info: vi.fn<(...args: unknown[]) => void>(),
  log: vi.fn<(...args: unknown[]) => void>(),
}));

vi.mock("../logger.js", () => ({ debug, info, log }));
vi.mock("./credentials.js", () => ({ getCredentials, getOTP }));

import { describeFailure, login, pageLocation } from "./login.js";

type OtpBehaviour = "none" | "accepted" | "rejected";

function createPage(
  finalUrl: string,
  {
    abortAccountsOnce = false,
    otp = "none",
    viaPassword = false,
  }: { abortAccountsOnce?: boolean; otp?: OtpBehaviour; viaPassword?: boolean } = {},
): Page {
  let currentUrl: string = mfUrls.auth.signIn;
  let accountsNavigationAborted = false;
  const locator = {
    click: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    fill: vi.fn<(value: string) => Promise<void>>().mockResolvedValue(undefined),
    first: vi.fn<() => unknown>(),
    waitFor: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
  };
  locator.first.mockReturnValue(locator);

  const otpLocator = {
    ...locator,
    first: vi.fn<() => unknown>(),
    waitFor: vi.fn<(options: { state: string }) => Promise<void>>(async ({ state }) => {
      if (state === "visible" && otp === "none") {
        throw new Error("OTP input is not visible");
      }
      if (state === "hidden" && otp === "rejected") {
        throw new Error("OTP input is still visible");
      }
    }),
  };
  otpLocator.first.mockReturnValue(otpLocator);

  return {
    goto: vi.fn<(url: string) => Promise<null>>().mockImplementation(async (url) => {
      if (url === mfUrls.signIn) {
        currentUrl = viaPassword ? mfUrls.auth.password : finalUrl;
      } else if (url === mfUrls.accounts) {
        if (abortAccountsOnce && !accountsNavigationAborted) {
          accountsNavigationAborted = true;
          throw new Error("page.goto: net::ERR_ABORTED");
        }
        currentUrl = finalUrl;
      }
      return null;
    }),
    isClosed: vi.fn<() => boolean>(() => false),
    locator: vi.fn<(selector: string) => unknown>((selector) =>
      selector.includes("one-time-code") ? otpLocator : locator,
    ),
    url: vi.fn<() => string>(() => currentUrl),
    waitForLoadState: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    waitForTimeout: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    waitForURL: vi.fn<(matcher: unknown) => Promise<void>>((matcher) => {
      if (typeof matcher === "function") {
        return (matcher as (url: URL) => boolean)(new URL(currentUrl))
          ? Promise.resolve()
          : Promise.reject(new Error("URL did not match"));
      }
      if (typeof matcher === "string") {
        currentUrl = finalUrl;
      }
      return Promise.resolve();
    }),
  } as unknown as Page;
}

describe("login", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getCredentials.mockResolvedValue({
      username: "user-a@example.com",
      password: "test-password",
    });
    getOTP.mockResolvedValue("123456");
  });

  test("rejects when the browser remains on the MFID sign-in page", async () => {
    const page = createPage("https://id.moneyforward.com/sign_in");

    await expect(login(page)).rejects.toThrow("Login failed");
    expect(info).not.toHaveBeenCalledWith("Login successful!");
  });

  test("resolves when the browser reaches Money Forward ME", async () => {
    const page = createPage(mfUrls.accounts, { viaPassword: true });

    await expect(login(page)).resolves.toBeUndefined();
    expect(info).toHaveBeenCalledWith("Login successful!");
  });

  test("rejects the public Money Forward home page", async () => {
    const page = createPage(mfUrls.home);

    await expect(login(page)).rejects.toThrow("Login failed");
    expect(info).not.toHaveBeenCalledWith("Login successful!");
  });

  test("retries the authenticated-page probe after aborted navigation", async () => {
    const page = createPage(mfUrls.accounts, {
      abortAccountsOnce: true,
      viaPassword: true,
    });

    await expect(login(page)).resolves.toBeUndefined();
    expect(info).toHaveBeenCalledWith("Login successful!");
  });

  test("submits the one-time code and waits for the form to go away", async () => {
    const page = createPage(mfUrls.accounts, { otp: "accepted", viaPassword: true });

    await expect(login(page)).resolves.toBeUndefined();
    expect(info.mock.calls.flat()).toEqual(
      expect.arrayContaining(["Auth otp: requested", "Auth otp: submitted", "Auth otp: accepted"]),
    );
  });

  // 認証の送信中に遷移すると、二段階認証は成立しないまま打ち切られる
  test("stops before leaving the page when the one-time code is refused", async () => {
    const page = createPage(mfUrls.accounts, { otp: "rejected", viaPassword: true });

    await expect(login(page)).rejects.toThrow(
      "Login failed at otp (at https://id.moneyforward.com/sign_in): " +
        "the code was refused; the one-time code form is still on screen",
    );
    expect(page.url()).toBe(mfUrls.auth.signIn);
  });

  test("names the step and the page it stopped on", async () => {
    const page = createPage("https://id.moneyforward.com/sign_in");

    await expect(login(page)).rejects.toThrow(
      "Login failed at accounts-probe (at https://id.moneyforward.com/sign_in): " +
        "the browser did not reach Money Forward ME",
    );
  });

  test("records every step it passed", async () => {
    const page = createPage(mfUrls.accounts, { otp: "accepted", viaPassword: true });

    await login(page);

    expect(info.mock.calls.flat()).toEqual(
      expect.arrayContaining([
        "Auth mfid-sign-in: at https://id.moneyforward.com/sign_in",
        "Auth email: at https://id.moneyforward.com/sign_in",
        "Auth password: at https://id.moneyforward.com/sign_in",
        "Auth mfid-complete: at https://id.moneyforward.com/sign_in",
        "Auth me-redirect: at https://id.moneyforward.com/sign_in/password",
        "Auth me-password: at https://moneyforward.com/accounts",
        "Auth accounts-probe: at https://moneyforward.com/accounts",
      ]),
    );
  });

  test("rejects a lookalike Money Forward origin", async () => {
    const page = createPage("https://moneyforward.com.attacker.example/");

    await expect(login(page)).rejects.toThrow("Login failed");
    expect(info).not.toHaveBeenCalledWith("Login successful!");
  });
});

describe("pageLocation", () => {
  test("keeps the origin and the path", () => {
    expect(pageLocation("https://id.moneyforward.com/sign_in/password")).toBe(
      "https://id.moneyforward.com/sign_in/password",
    );
  });

  // クエリや fragment に識別子が載りうる
  test("drops the query and the fragment", () => {
    expect(pageLocation("https://moneyforward.com/accounts?token=abc#frag")).toBe(
      "https://moneyforward.com/accounts",
    );
  });

  test("falls back when the URL cannot be parsed", () => {
    expect(pageLocation("")).toBe("about:blank");
  });
});

describe("describeFailure", () => {
  // Playwright は call log に画面の文字列を並べる
  test("keeps only the first line", () => {
    const error = new Error("Timeout 5000ms exceeded.\nCall log:\n  - waiting for locator");

    expect(describeFailure(error, [])).toBe("Timeout 5000ms exceeded.");
  });

  test("hides the credentials", () => {
    const error = new Error('waiting for button:has-text("user-a@example.com")');

    expect(describeFailure(error, ["user-a@example.com", "test-password"])).toBe(
      'waiting for button:has-text("[redacted]")',
    );
  });

  test("accepts a value that is not an Error", () => {
    expect(describeFailure("plain failure", [])).toBe("plain failure");
  });
});
