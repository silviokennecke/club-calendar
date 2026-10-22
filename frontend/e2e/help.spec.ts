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
