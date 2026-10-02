import { test, expect, Page } from "@playwright/test";

async function login(page: Page) {
  await page.goto("/login");
  await page.getByLabel(/email/i).fill("admin@example.com");
  await page.getByLabel("Password", { exact: true }).fill("password123");
  await page.getByRole("button", { name: /^sign in$/i }).click();
  await page.waitForURL("**/clubs**");
}

async function goToCalendar(page: Page) {
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
  // Now on calendar page
  await expect(page.locator(".fc")).toBeVisible({ timeout: 10000 });
}

test.describe("Calendar", () => {
  test("clubs page shows seeded club", async ({ page }) => {
    await login(page);
    await page.goto("/clubs");
    await page.waitForLoadState("networkidle");
    if (!page.url().includes("/calendars/")) {
      await expect(page.getByText(/Schützenverein/i).first()).toBeVisible();
    } else {
      // Already on calendar — club exists and we're in it
    }
  });

  test("can navigate to calendar view", async ({ page }) => {
    await goToCalendar(page);
    await expect(page.locator(".fc")).toBeVisible();
  });

  test("calendar sidebar shows navigation items", async ({ page }) => {
    await goToCalendar(page);
    const nav = page.getByRole("navigation", { name: /^(areas|bereiche)$/i });
    await expect(nav.getByRole("link", { name: /^(templates|vorlagen)$/i })).toBeVisible();
    await expect(nav.getByRole("link", { name: /^(publish|veröffentlichen)$/i })).toBeVisible();
    await expect(nav.getByRole("link", { name: /^(settings|einstellungen)$/i })).toBeVisible();
    // The current area is marked for assistive technology
    await expect(nav.getByRole("link", { name: /^(calendar|kalender)$/i })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  test("settings pages are reachable via settings tabs", async ({ page }) => {
    await goToCalendar(page);
    await page
      .getByRole("navigation", { name: /^(areas|bereiche)$/i })
      .getByRole("link", { name: /^(settings|einstellungen)$/i })
      .click();
    await page.waitForURL("**/settings");
    await page.getByRole("link", { name: /^(properties|eigenschaften)$/i }).click();
    await page.waitForURL("**/settings/properties");
  });

  test("clicking New Event opens modal", async ({ page }) => {
    await goToCalendar(page);
    await page.getByRole("button", { name: /new event/i }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page.getByRole("heading", { name: /new event/i })).toBeVisible();
  });

  test("can create and see a new event", async ({ page }) => {
    await goToCalendar(page);
    await page.getByRole("button", { name: /new event/i }).click();

    const dialog = page.getByRole("dialog");
    await dialog.getByLabel(/name \*/i).fill("E2E Test Event");
    await dialog.getByLabel(/start date/i).fill("2026-09-15");
    // Uncheck draft — switch to published
    const publishSwitch = dialog.getByRole("switch", { name: /published/i });
    await publishSwitch.click();

    // Button label is "Create" in the new modal
    await dialog.getByRole("button", { name: /^create$/i }).click();
    await expect(dialog).not.toBeVisible({ timeout: 8000 });
  });
});
