import { expect, test } from "@playwright/test";

test.describe("Web app manifest", () => {
  test("links the manifest so credentials travel with the request", async ({ page }) => {
    await page.goto("/");

    const links = page.locator('link[rel="manifest"]');

    // metadata からも出すと link が 2 つになり、どちらが使われるか読めなくなる
    await expect(links).toHaveCount(1);
    await expect(links).toHaveAttribute("crossorigin", "use-credentials");
    await expect(links).toHaveAttribute("href", /\/manifest\.webmanifest$/);
  });

  test("serves the linked manifest", async ({ page, request }) => {
    await page.goto("/");

    const href = await page.locator('link[rel="manifest"]').getAttribute("href");
    expect(href).not.toBeNull();

    const response = await request.get(new URL(href!, page.url()).toString());

    expect(response.status()).toBe(200);
    expect(await response.json()).toMatchObject({ name: "MoneyForward Me Dashboard" });
  });
});
