import { test, expect } from "@playwright/test";

// ——— Public help page "So abonnierst du den Kalender": no sign-in, tab switch changes the guide ———

test.use({ locale: "de-DE", timezoneId: "Europe/Berlin" });

test("die Hilfeseite lädt ohne Anmeldung und wechselt die Anleitung per Tab", async ({ page }) => {
  await page.goto("/help/subscribe?app=ios");
  await expect(
    page.getByRole("heading", { level: 1, name: "So abonnierst du den Kalender" }),
  ).toBeVisible();
  await expect(page.getByRole("tab", { name: "iPhone / iPad" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(page.getByRole("tabpanel")).toContainText("Kalenderabo hinzufügen");

  await page.getByRole("tab", { name: "Google Kalender" }).click();
  await expect(page).toHaveURL(/app=google/);
  await expect(page.getByRole("tabpanel")).toContainText("Per URL");
  await expect(page.getByRole("tabpanel")).not.toContainText("Kalenderabo hinzufügen");
});

// ——— Help center /help: public, searchable, linked from the footer ———

test("das Hilfezentrum ist ohne Anmeldung erreichbar und durchsuchbar", async ({ page }) => {
  await page.goto("/help");
  await expect(page.getByRole("navigation", { name: "Hilfe-Navigation" })).toBeVisible();

  await page.keyboard.press("/");
  const search = page.getByRole("combobox", { name: /Hilfe durchsuchen/ });
  await expect(search).toBeFocused();
  await search.fill("Verein");
  await page
    .getByRole("option", { name: /Erste Schritte/ })
    .first()
    .click();
  await expect(page).toHaveURL(/\/help\/getting-started\/first-steps/);
  await expect(page.getByRole("heading", { level: 1, name: /Erste Schritte/ })).toBeVisible();

  await page.goto("/help/does-not-exist");
  await expect(page.getByRole("heading", { level: 1, name: "Seite nicht gefunden" })).toBeVisible();
});

test("/help/ und Ordner-URLs lösen auf: Startseite bzw. Standard-Inhaltsverzeichnis", async ({
  page,
}) => {
  for (const url of ["/help", "/help/", "/help/index"]) {
    await page.goto(url);
    await expect(page.getByRole("heading", { level: 1, name: "Willkommen" })).toBeVisible();
  }

  for (const url of ["/help/getting-started", "/help/getting-started/"]) {
    await page.goto(url);
    await expect(page.getByRole("heading", { level: 1, name: "Getting started" })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Hilfe-Navigation" })).toBeVisible();
    await page
      .getByRole("main")
      .getByRole("link", { name: /Erste Schritte/ })
      .click();
    await expect(page).toHaveURL(/\/help\/getting-started\/first-steps$/);
  }

  await page.goto("/help/getting-started/first-steps/");
  await expect(page.getByRole("heading", { level: 1, name: /Erste Schritte/ })).toBeVisible();
});

test("der Hilfe-Link im Footer der Anmeldeseite führt ins Hilfezentrum", async ({ page }) => {
  await page.goto("/login");
  await page.getByRole("link", { name: "Hilfe", exact: true }).click();
  await expect(page).toHaveURL(/\/help$/);
  await expect(page.getByRole("navigation", { name: "Hilfe-Navigation" })).toBeVisible();
});
