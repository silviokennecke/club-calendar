import { test, expect } from "@playwright/test";
import { confirmStepUp, createVerifiedUser, login, seedClub } from "./helpers";
import { readFileSync } from "node:fs";

test.use({ locale: "de-DE", timezoneId: "Europe/Berlin" });

test("Daten herunterladen: Datei kommt an, zweiter Versuch in der Stunde wird begrenzt", async ({
  page,
  request,
}) => {
  const email = await createVerifiedUser(request, "Export Nutzer");
  const club = await seedClub(request, email, "Export Verein");
  await login(page, email);
  await page.waitForURL(/\/clubs/);
  await page.goto(`/clubs/${club.clubId}/calendars/${club.calendarId}`);
  await page
    .getByRole("complementary")
    .getByRole("link", { name: /Mein Profil/ })
    .click();
  await page
    .getByRole("navigation", { name: "Profilbereiche" })
    .getByRole("link", { name: "Datenschutz" })
    .click();

  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Daten herunterladen" }).click();
  await confirmStepUp(page);
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/^club-calendar-export-.+-\d{8}\.json$/);
  const data = JSON.parse(readFileSync((await file.path())!, "utf8"));
  expect(data.meta.schema).toBe("club-calendar-user-export");

  await page.getByRole("button", { name: "Daten herunterladen" }).click();
  await expect(page.getByText(/Du hast deine Daten gerade erst heruntergeladen/)).toBeVisible();
});
