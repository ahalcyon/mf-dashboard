import { mfUrls } from "@mf-dashboard/meta/urls";
import type { BrowserContext, Page } from "playwright";
import { log, debug, info } from "../logger.js";
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

const SELECTORS = {
  mfidEmail: 'input[name="mfid_user[email]"]',
  mfidPassword: 'input[name="mfid_user[password]"]',
  mfidSubmit: "#submitto",
  mfidOtpInput: 'input[autocomplete="one-time-code"], input[name*="otp"], input[name*="code"]',
  mfidOtpSubmit: '#submitto, button:text-is("認証する"), button:text-is("Verify")',
  mePassword: 'input[type="password"]',
  meSignIn: 'button:has-text("Sign in")',
};

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

async function maybeHandleOtp(
  page: Page,
  {
    inputSelector,
    submitSelector,
    label,
    timeout = TIMEOUTS.short,
  }: {
    inputSelector: string;
    submitSelector: string;
    label: string;
    timeout?: number;
  },
): Promise<void> {
  const otpInput = page.locator(inputSelector).first();

  try {
    await otpInput.waitFor({ state: "visible", timeout });
  } catch {
    debug(`${label} OTP not required`);
    return;
  }

  info(`${label} OTP required`);
  const otp = await getOTP();
  await otpInput.fill(otp);
  await page.locator(submitSelector).first().click();

  try {
    await otpInput.waitFor({ state: "hidden", timeout: TIMEOUTS.long });
  } catch {
    throw new Error(`${label} OTP was rejected`);
  }

  info(`${label} OTP accepted`);
}

/**
 * Check if the current session is valid by navigating to Money Forward
 * and checking if we're redirected to login page
 */
async function isSessionValid(page: Page): Promise<boolean> {
  debug("Checking if session is valid...");

  try {
    await navigateToAccountsPage(page);

    await waitForUrlChange(page);

    const currentUrl = page.url();
    debug("Current URL after navigation:", currentUrl);

    if (isLoggedInUrl(currentUrl)) {
      log("Session is valid!");
      return true;
    }

    debug("Session is invalid, need to login");
    return false;
  } catch (err) {
    debug("Error checking session:", err);
    return false;
  }
}

/**
 * Login with auth state if available, otherwise perform full login
 */
export async function loginWithAuthState(page: Page, context: BrowserContext): Promise<void> {
  if (hasAuthState()) {
    debug("Auth state found, checking session validity...");

    const valid = await isSessionValid(page);
    if (valid) {
      debug("Using existing session from auth state");
      return;
    }

    debug("Session expired, performing full login...");
  } else {
    debug("No auth state found, performing full login...");
  }

  await login(page);

  await saveAuthState(context);
}

export async function login(page: Page): Promise<void> {
  const { username, password } = await getCredentials();

  debug("Navigating to login page...");
  await page.goto(mfUrls.auth.signIn, {
    waitUntil: "domcontentloaded",
  });

  debug("Entering email...");
  const emailInput = page.locator(SELECTORS.mfidEmail);
  await emailInput.waitFor({ state: "visible", timeout: TIMEOUTS.medium });
  await emailInput.fill(username);

  debug("Clicking Sign in button...");
  await page.locator(SELECTORS.mfidSubmit).click();

  debug("Waiting for password page...");
  const passwordInput = page.locator(SELECTORS.mfidPassword);
  await passwordInput.waitFor({ state: "visible", timeout: TIMEOUTS.medium });

  debug("Entering password...");
  await passwordInput.fill(password);
  debug("Clicking Sign in button...");
  await page.locator(SELECTORS.mfidSubmit).click();

  await maybeHandleOtp(page, {
    inputSelector: SELECTORS.mfidOtpInput,
    submitSelector: SELECTORS.mfidOtpSubmit,
    label: "MFID",
  });

  debug("Waiting for login to complete...");
  await page.waitForURL((url) => !url.toString().startsWith(mfUrls.auth.password), {
    timeout: TIMEOUTS.login,
  });

  debug("Navigating to Money Forward ME...");
  await page.goto(mfUrls.signIn);

  await waitForUrlChange(page);

  let currentUrl = page.url();
  debug("URL after initial wait:", currentUrl);
  if (currentUrl.startsWith(mfUrls.signIn)) {
    debug("Waiting for MFID redirect...");
    await page.waitForURL(/id\.moneyforward\.com/, {
      timeout: TIMEOUTS.long,
    });
    currentUrl = page.url();
  }

  debug("Current URL:", currentUrl);

  if (isLoggedInUrl(currentUrl)) {
    debug("Already logged in to ME!");
    return;
  }

  if (currentUrl.includes("account_selector")) {
    debug("Account selector found, clicking account...");
    const accountButton = page.locator(buildAccountSelector(username)).first();
    await accountButton.waitFor({ state: "visible", timeout: TIMEOUTS.short });

    debug("Clicking account and waiting for navigation...");
    await accountButton.click();

    await page.waitForURL(/id\.moneyforward\.com\/sign_in\/password|moneyforward\.com\//, {
      timeout: TIMEOUTS.long,
    });
    currentUrl = page.url();
  }

  if (currentUrl.includes(mfUrls.auth.password)) {
    debug("Waiting for ME password page...");
    const mePasswordInput = page.locator(SELECTORS.mePassword).first();
    await mePasswordInput.waitFor({ state: "visible", timeout: TIMEOUTS.medium });

    debug("Entering ME password...");
    await mePasswordInput.fill(password);

    debug("Clicking Sign in button...");
    await page.locator(SELECTORS.meSignIn).click();

    debug("Waiting for ME redirect...");
    await page.waitForURL(`${mfUrls.home}**`, { timeout: TIMEOUTS.login });
  } else {
    debug("Already redirected to ME (session exists)");
  }

  // Recheck against an authenticated-only page. moneyforward.com/ itself is
  // publicly accessible and therefore cannot be used as proof of login.
  await navigateToAccountsPage(page);
  await waitForUrlChange(page);

  if (!isLoggedInUrl(page.url())) {
    throw new Error("Login failed: browser did not reach Money Forward ME");
  }

  log("Login successful!");
}
