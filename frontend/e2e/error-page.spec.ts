import { test, expect } from "@playwright/test";

// ——— Error page: unknown URL (404) and failed page chunk (after a deploy the old chunks are gone) ———

test.use({ locale: "de-DE", timezoneId: "Europe/Berlin" });

test("unbekannte URL zeigt die 404-Seite mit Navigation", async ({ page }) => {
  await page.goto("/gibt-es-nicht");
  const heading = page.getByRole("heading", { level: 1, name: "Seite nicht gefunden" });
  await expect(heading).toBeVisible();
  await expect(heading).toBeFocused();
  await expect(page.getByRole("main")).toBeVisible();
  await expect(page.getByText("Unexpected Application Error")).toHaveCount(0);

  // Deeper unknown paths end here as well.
  await page.goto("/clubs/abc/nichts/hier");
  await expect(heading).toBeVisible();

  await page.getByRole("link", { name: "Zur Startseite" }).click();
  await page.waitForURL(/\/login$/);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
});

test("die 404-Seite ist auch auf Englisch da und bietet Reload und Zurück", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("language", "en"));
  await page.goto("/login");
  await page.goto("/gibt-es-nicht");
  await expect(page.getByRole("heading", { level: 1, name: "Page not found" })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.getByRole("button", { name: "Reload page" })).toBeVisible();
  await page.getByRole("button", { name: "Back" }).click();
  await page.waitForURL(/\/login$/);
});

// A blocked page module must end on the error page and "Seite neu laden" must recover. Dev server:
// native module import (`src/pages/LoginPage.tsx`), rejects without reload. Production build
// (`vite preview`, CI): hashed chunk `assets/LoginPage-*.js`, one automatic reload, then the error
// page. Both URLs are blocked, whichever one the running server uses.
test("fehlgeschlagener Seiten-Import zeigt die Fehlerseite, 'Seite neu laden' stellt die Seite her", async ({
  page,
}) => {
  const patterns = ["**/src/pages/LoginPage.tsx*", "**/assets/LoginPage-*.js"];
  for (const pattern of patterns) await page.route(pattern, (route) => route.abort());
  const consoleErrors: string[] = [];
  page.on("pageerror", (error) => consoleErrors.push(error.message));
  await page.goto("/login");
  const heading = page.getByRole("heading", {
    level: 1,
    name: "Die Seite konnte nicht geladen werden",
  });
  await expect(heading).toBeVisible();
  await expect(heading).toBeFocused();
  await expect(
    page.getByText(/Möglicherweise wurde die Anwendung gerade aktualisiert/),
  ).toBeVisible();
  await expect(page.getByText("Unexpected Application Error")).toHaveCount(0);

  for (const pattern of patterns) await page.unroute(pattern);
  await page.getByRole("button", { name: "Seite neu laden" }).click();
  await expect(page.getByLabel("E-Mail")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Die Seite konnte nicht geladen werden" }),
  ).toHaveCount(0);
});

// Production build (`vite build` + `vite preview`, see docs/redesign/E2E.md): a missing page chunk
// triggers exactly one automatic reload per session, then the error page, never a loop.
test.describe("fehlender Chunk im Produktions-Build", () => {
  test.skip(!process.env.E2E_PREVIEW_URL, "Needs a production build: set E2E_PREVIEW_URL");
  test.use({ baseURL: process.env.E2E_PREVIEW_URL });

  test("ein Reload, dann Fehlerseite ohne Schleife; Reload-Aktion stellt die Seite her", async ({
    page,
  }) => {
    const pattern = "**/assets/LoginPage-*.js";
    await page.route(pattern, (route) => route.abort());
    let documents = 0;
    page.on("request", (request) => {
      if (request.resourceType() === "document") documents += 1;
    });
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));

    await page.goto("/login");
    const heading = page.getByRole("heading", {
      level: 1,
      name: "Die Seite konnte nicht geladen werden",
    });
    await expect(heading).toBeVisible();
    await expect(heading).toBeFocused();
    // Initial load + exactly one automatic reload; give a loop time to show itself.
    await page.waitForTimeout(1500);
    expect(documents).toBe(2);
    await expect(heading).toBeVisible();
    expect(pageErrors.filter((m) => m.includes("reading 'default'"))).toEqual([]);

    await page.unroute(pattern);
    await page.getByRole("button", { name: "Seite neu laden" }).click();
    await expect(page.getByLabel("E-Mail")).toBeVisible();
  });
});
