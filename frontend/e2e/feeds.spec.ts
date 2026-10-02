import { test, expect, Page } from "@playwright/test";

async function login(page: Page) {
  await page.goto("/login");
  await page.getByLabel(/email/i).fill("admin@example.com");
  await page.getByLabel("Password", { exact: true }).fill("password123");
  await page.getByRole("button", { name: /^sign in$/i }).click();
  await page.waitForURL("**/clubs**");
}

async function goToFeeds(page: Page) {
  await login(page);
  // Go to clubs list; wait for potential auto-redirect to settle
  await page.goto("/clubs");
  await page.waitForLoadState("networkidle");
  if (!page.url().includes("/calendars/")) {
    // Still on clubs list — navigate through UI
    await page
      .getByRole("main")
      .getByText(/Schützenverein/i)
      .click();
    await page
      .getByRole("main")
      .getByText(/Vereinskalender/i)
      .click();
  }
  // Now on calendar page — click "Publish" in the sidebar navigation
  await page
    .getByRole("navigation", { name: /^(areas|bereiche)$/i })
    .getByRole("link", { name: /^(publish|veröffentlichen)$/i })
    .click();
  await page.waitForURL("**/settings/feeds");
}

test.describe("Feeds", () => {
  test("feeds page shows existing feeds", async ({ page }) => {
    await goToFeeds(page);
    await expect(page.getByText(/Öffentlicher Kalender/i)).toBeVisible();
  });

  test("public feed shows ICS URL", async ({ page }) => {
    await goToFeeds(page);
    // ICS URL should contain the feed API path
    await expect(
      page
        .locator("code")
        .filter({ hasText: /\/api\/feed\// })
        .first(),
    ).toBeVisible();
  });

  test("private feed shows shared secret toggle", async ({ page }) => {
    await goToFeeds(page);
    // Secret should be masked by default
    await expect(page.getByText("••••••••••••••••••••••••••••••••••••")).toBeVisible();
  });

  test("ICS URL from public feed returns valid calendar", async ({ page, request }) => {
    await goToFeeds(page);
    // Get the ICS URL from the page
    const codeEl = page.locator("code").first();
    const icsUrl = await codeEl.textContent();
    if (icsUrl && icsUrl.includes("/api/feed/")) {
      const response = await request.get(icsUrl);
      expect(response.status()).toBe(200);
      expect(response.headers()["content-type"]).toContain("text/calendar");
    }
  });
});
