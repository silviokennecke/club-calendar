import { test, expect } from "@playwright/test";
import { createVerifiedUser, login, seedClub } from "./helpers";

test.describe("Hinweise", () => {
  test.use({ locale: "de-DE", timezoneId: "Europe/Berlin" });

  test("Hinweis über den Split-Button anlegen", async ({ page, request }) => {
    const email = await createVerifiedUser(request, "Hinweis Anlegen");
    const { clubId, calendarId } = await seedClub(request, email, "Hinweis Verein");
    await login(page, email);
    await page.waitForURL(/\/clubs/);
    await page.goto(`/clubs/${clubId}/calendars/${calendarId}/events`);

    await page.getByRole("button", { name: "Weitere Wege, Termine anzulegen" }).click();
    await page.getByRole("button", { name: /Hinweis anlegen/ }).click();

    const dialog = page.getByRole("dialog", { name: "Neuer Hinweis" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel(/Beginn|Startzeit/)).toHaveCount(0);
    await expect(dialog.getByRole("combobox", { name: /^Ort/ })).toHaveCount(0);

    await dialog.getByLabel(/^Name/).fill("Schießstand geschlossen");
    await dialog.getByLabel(/^Startdatum/).fill("2026-10-22");
    await dialog.getByRole("button", { name: "Hinweis speichern" }).click();
    await expect(page.getByText("Hinweis gespeichert.")).toBeVisible();
  });
});
