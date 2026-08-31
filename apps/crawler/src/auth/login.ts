import { mfUrls } from "@mf-dashboard/meta/urls";
import type { BrowserContext, Page } from "playwright";
import { debug, info } from "../logger.js";
import { navigateToAccountsPage } from "../scrapers/refresh.js";
import { getCredentials, getOTP } from "./credentials.js";
import { hasAuthState, saveAuthState } from "./state.js";

const TIMEOUTS = {
  redirect: 2000,
  short: 5000,
  medium: 10000,
  long: 15000,
  login: 30000,
};

const MONEY_FORWARD_ME_ORIGIN = new URL(mfUrls.home).origin;
const AUTHENTICATED_PATHNAME = new URL(mfUrls.accounts).pathname;
const MFID_ORIGIN = new URL(mfUrls.auth.signIn).origin;
const MFID_AUTH_PATHNAMES = ["/sign_in", "/two_factor_auth", "/webauthn"];

const SELECTORS = {
  mfidEmail: 'input[name="mfid_user[email]"]',
  mfidPassword: 'input[name="mfid_user[password]"]',
  mfidSubmit: "#submitto",
  mfidOtpInput: 'input[autocomplete="one-time-code"], input[name*="otp"], input[name*="code"]',
  mfidOtpSubmit: '#submitto, button:text-is("認証する"), button:text-is("Verify")',
  mePassword: 'input[type="password"]',
  meSignIn: 'button:has-text("Sign in")',
};

type AuthStep =
  | "session-probe"
  | "mfid-sign-in"
  | "email"
  | "password"
  | "otp"
  | "mfid-complete"
  | "me-redirect"
  | "account-selector"
  | "me-password"
  | "accounts-probe";

/** 認証情報が載らないよう、URL は origin と pathname だけを残す。 */
export function pageLocation(url: string): string {
  try {
    const { origin, pathname } = new URL(url);
    return `${origin}${pathname}`;
  } catch {
    return "about:blank";
  }
}

/** Playwright は call log に画面上の文字列を載せる。1 行目だけを取り、秘密は伏せる。 */
export function describeFailure(error: unknown, secrets: string[]): string {
  const raw = error instanceof Error ? error.message : String(error);
  const firstLine = raw.split("\n")[0] ?? "";
  return secrets.reduce(
    (text, secret) => (secret ? text.split(secret).join("[redacted]") : text),
    firstLine,
  );
}

async function step<T>(
  name: AuthStep,
  page: Page,
  secrets: string[],
  run: () => Promise<T>,
): Promise<T> {
  try {
    const value = await run();
    info(`Auth ${name}: at ${pageLocation(page.url())}`);
    return value;
  } catch (error) {
    throw new Error(
      `Login failed at ${name} (at ${pageLocation(page.url())}): ${describeFailure(error, secrets)}`,
      { cause: error },
    );
  }
}

/** MFID の認証フロー配下かどうか。ここを離れて初めて認証が終わる。 */
export function isMfidAuthUrl(url: string): boolean {
  try {
    const { origin, pathname } = new URL(url);
    return (
      origin === MFID_ORIGIN &&
      MFID_AUTH_PATHNAMES.some((base) => pathname === base || pathname.startsWith(`${base}/`))
    );
  } catch {
    return false;
  }
}

function isLoggedInUrl(url: string): boolean {
  try {
    const currentUrl = new URL(url);
    return (
      currentUrl.origin === MONEY_FORWARD_ME_ORIGIN &&
      (currentUrl.pathname === AUTHENTICATED_PATHNAME ||
        currentUrl.pathname.startsWith(`${AUTHENTICATED_PATHNAME}/`))
    );
  } catch {
    return false;
  }
}

function buildAccountSelector(username: string): string {
  return `button:has-text("${username}"), button:has-text("メールアドレスでログイン"), button:has-text("Sign in with email")`;
}

async function waitForUrlChange(page: Page, timeout: number = TIMEOUTS.redirect): Promise<void> {
  const initialUrl = page.url();
  try {
    await page.waitForURL((url) => url.toString() !== initialUrl, { timeout });
  } catch {}
}

async function handleOtp(page: Page): Promise<void> {
  const otpInput = page.locator(SELECTORS.mfidOtpInput).first();

  try {
    await otpInput.waitFor({ state: "visible", timeout: TIMEOUTS.short });
  } catch {
    info("Auth otp: not requested");
    return;
  }

  info("Auth otp: requested");
  await otpInput.fill(await getOTP());
  await page.locator(SELECTORS.mfidOtpSubmit).first().click();
  info("Auth otp: submitted");

  try {
    await otpInput.waitFor({ state: "hidden", timeout: TIMEOUTS.long });
  } catch {
    throw new Error("the code was refused; the one-time code form is still on screen");
  }

  info("Auth otp: accepted");
}

async function isSessionValid(page: Page): Promise<boolean> {
  try {
    await navigateToAccountsPage(page);
    await waitForUrlChange(page);

    if (isLoggedInUrl(page.url())) {
      info(`Auth session-probe: reusing the saved session at ${pageLocation(page.url())}`);
      return true;
    }

    info(`Auth session-probe: saved session rejected at ${pageLocation(page.url())}`);
    return false;
  } catch (error) {
    info(`Auth session-probe: failed with ${describeFailure(error, [])}`);
    return false;
  }
}

export async function loginWithAuthState(page: Page, context: BrowserContext): Promise<void> {
  if (hasAuthState()) {
    if (await isSessionValid(page)) return;
  } else {
    info("Auth session-probe: no saved session");
  }

  await login(page);

  await saveAuthState(context);
}

export async function login(page: Page): Promise<void> {
  const { username, password } = await getCredentials();
  const secrets = [username, password];

  await step("mfid-sign-in", page, secrets, () =>
    page.goto(mfUrls.auth.signIn, { waitUntil: "domcontentloaded" }),
  );

  await step("email", page, secrets, async () => {
    const emailInput = page.locator(SELECTORS.mfidEmail);
    await emailInput.waitFor({ state: "visible", timeout: TIMEOUTS.medium });
    await emailInput.fill(username);
    await page.locator(SELECTORS.mfidSubmit).click();
  });

  await step("password", page, secrets, async () => {
    const passwordInput = page.locator(SELECTORS.mfidPassword);
    await passwordInput.waitFor({ state: "visible", timeout: TIMEOUTS.medium });
    await passwordInput.fill(password);
    await page.locator(SELECTORS.mfidSubmit).click();
  });

  await step("otp", page, secrets, () => handleOtp(page));

  await step("mfid-complete", page, secrets, () =>
    page.waitForURL((url) => !isMfidAuthUrl(url.toString()), { timeout: TIMEOUTS.login }),
  );

  let currentUrl = await step("me-redirect", page, secrets, async () => {
    await page.goto(mfUrls.signIn);
    await waitForUrlChange(page);

    if (page.url().startsWith(mfUrls.signIn)) {
      await page.waitForURL(/id\.moneyforward\.com/, { timeout: TIMEOUTS.long });
    }
    return page.url();
  });

  if (isLoggedInUrl(currentUrl)) {
    info("Login successful!");
    return;
  }

  if (currentUrl.includes("account_selector")) {
    currentUrl = await step("account-selector", page, secrets, async () => {
      const accountButton = page.locator(buildAccountSelector(username)).first();
      await accountButton.waitFor({ state: "visible", timeout: TIMEOUTS.short });
      await accountButton.click();

      await page.waitForURL(/id\.moneyforward\.com\/sign_in\/password|moneyforward\.com\//, {
        timeout: TIMEOUTS.long,
      });
      return page.url();
    });
  }

  if (currentUrl.includes(mfUrls.auth.password)) {
    await step("me-password", page, secrets, async () => {
      const mePasswordInput = page.locator(SELECTORS.mePassword).first();
      await mePasswordInput.waitFor({ state: "visible", timeout: TIMEOUTS.medium });
      await mePasswordInput.fill(password);
      await page.locator(SELECTORS.meSignIn).click();

      await page.waitForURL(`${mfUrls.home}**`, { timeout: TIMEOUTS.login });
    });
  } else {
    debug("Already redirected to ME (session exists)");
  }

  // Recheck against an authenticated-only page. moneyforward.com/ itself is
  // publicly accessible and therefore cannot be used as proof of login.
  await step("accounts-probe", page, secrets, async () => {
    await navigateToAccountsPage(page);
    await waitForUrlChange(page);

    if (!isLoggedInUrl(page.url())) {
      throw new Error("the browser did not reach Money Forward ME");
    }
  });

  info("Login successful!");
}
