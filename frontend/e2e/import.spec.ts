import { test, expect, type Page } from "@playwright/test";
import { API, createVerifiedUser, login, seedClub } from "./helpers";

// ——— ICS import (phase 5): choose file, review, import, result ———

const ics = [
  "BEGIN:VCALENDAR",
  "VERSION:2.0",
  "PRODID:-//e2e//DE",
  ...[
    ["a1", "Training Luftgewehr", "20261008T190000", "20261008T210000", "Schützenhaus Waldblick"],
    ["a2", "Training Luftgewehr", "20261015T190000", "20261015T210000", "Schützenhaus Waldblick"],
    ["a3", "Training Luftgewehr", "20261022T190000", "20261022T210000", "Schützenhaus Waldblick"],
  ].flatMap(([uid, name, start, end, place]) => [
    "BEGIN:VEVENT",
    `UID:${uid}@e2e`,
    `SUMMARY:${name}`,
    `DTSTART;TZID=Europe/Berlin:${start}`,
    `DTEND;TZID=Europe/Berlin:${end}`,
    `LOCATION:${place}`,
    "END:VEVENT",
  ]),
  "BEGIN:VEVENT",
  "UID:b1@e2e",
  "SUMMARY:Herbstfest",
  "DTSTART;VALUE=DATE:20261024",
  "DTEND;VALUE=DATE:20261026",
  "LOCATION:Gasthof Zur Linde",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "UID:b2@e2e",
  "SUMMARY:Vorstandssitzung",
  "DTSTART:20261007T193000",
  "DTEND:20261007T213000",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "SUMMARY:Ohne Datum",
  "END:VEVENT",
  "END:VCALENDAR",
].join("\r\n");

const icsFile = (content = ics, name = "Schiessplan-2026.ics") => ({
  name,
  mimeType: "text/calendar",
  buffer: Buffer.from(content),
});

async function seed(request: Parameters<typeof createVerifiedUser>[0], name: string) {
  const email = await createVerifiedUser(request, name);
  const { clubId, calendarId, headers } = await seedClub(request, email, `${name} Verein`);
  const res = await request.post(`${API}/api/calendars/${calendarId}/locations`, {
    headers,
    data: { name: "Schützenhaus Waldblick", street: "Waldstraße 12", city: "Musterstadt" },
  });
  expect(res.ok()).toBeTruthy();
  return { email, headers, calendarId, base: `/clubs/${clubId}/calendars/${calendarId}` };
}

async function openImport(page: Page, email: string, base: string) {
  await login(page, email);
  await page.waitForURL(/\/clubs/);
  await page.goto(`${base}/import`);
  await expect(page.getByRole("heading", { level: 1, name: "Termine importieren" })).toBeVisible();
}

test.describe("Import", () => {
  test.use({ locale: "de-DE", timezoneId: "Europe/Berlin" });

  test("Browser-Zurück und -Vor gehen die Import-Schritte durch", async ({ page, request }) => {
    const seeded = await seed(request, "Import Verlauf");
    await openImport(page, seeded.email, seeded.base);
    const importUrl = page.url();

    await page.locator("#ics-file").setInputFiles(icsFile());
    await expect(page.getByText("Schiessplan-2026.ics: 5 Termine erkannt")).toBeVisible();
    await page.getByRole("button", { name: /Datei prüfen/ }).click();
    const reviewHeading = page.getByRole("heading", {
      level: 1,
      name: "Schiessplan-2026.ics: 5 Termine erkannt",
    });
    await expect(reviewHeading).toBeVisible();
    expect(page.url()).toBe(importUrl);

    // Zurück aus der Prüfung: Warnung, "Weiter bearbeiten" bleibt in der Prüfung
    await page.goBack();
    const unsaved = page.getByRole("alertdialog");
    await expect(unsaved).toBeVisible();
    await unsaved.getByRole("button", { name: "Weiter bearbeiten" }).click();
    await expect(unsaved).toBeHidden();
    await expect(reviewHeading).toBeVisible();
    expect(page.url()).toBe(importUrl);

    // Verwerfen: Datei-Schritt, die Seite wurde nicht verlassen
    await page.goBack();
    await unsaved.getByRole("button", { name: "Änderungen verwerfen" }).click();
    await expect(
      page.getByRole("heading", { level: 1, name: "Termine importieren" }),
    ).toBeVisible();
    expect(page.url()).toBe(importUrl);

    // Vor: wieder die Prüfung (Datei und Auswahl sind noch da)
    await page.goForward();
    await expect(reviewHeading).toBeVisible();
    await expect(page.getByText("5 von 5 ausgewählt")).toBeVisible();

    // Importieren, dann Zurück: Datei-Schritt, kein zweiter Import der alten Auswahl
    await page.getByRole("button", { name: /Termine importieren$/ }).click();
    await expect(page.getByRole("heading", { level: 1, name: /importiert/ })).toBeVisible();
    await page.goBack();
    await expect(
      page.getByRole("heading", { level: 1, name: "Termine importieren" }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: /Datei prüfen/ })).toBeDisabled();
    expect(page.url()).toBe(importUrl);
    // Vor in den Ergebnis-Schritt zeigt nichts Altes
    await page.goForward();
    await expect(
      page.getByRole("heading", { level: 1, name: "Termine importieren" }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: /Datei prüfen/ })).toBeDisabled();
  });

  test("ICS hochladen, prüfen, importieren und Ergebnis", async ({ page, request }) => {
    const seeded = await seed(request, "Import Ablauf");
    await openImport(page, seeded.email, seeded.base);

    // Schritt 1: Datei – per Tastatur erreichbar, mit Label
    const input = page.locator("#ics-file");
    await expect(input).toHaveAccessibleName("Datei auswählen");
    await input.focus();
    await expect(input).toBeFocused();
    await expect(page.getByRole("button", { name: /Datei prüfen/ })).toBeDisabled();
    await input.setInputFiles(icsFile());
    await expect(page.getByText("Schiessplan-2026.ics: 5 Termine erkannt")).toBeVisible();
    await page.getByRole("button", { name: /Datei prüfen/ }).click();

    // Schritt 2: Prüfen
    await expect(
      page.getByRole("heading", { level: 1, name: "Schiessplan-2026.ics: 5 Termine erkannt" }),
    ).toBeVisible();
    await expect(page.getByRole("alert")).toContainText("Ein Termin wird übersprungen");
    await expect(page.getByText("Vorhandener Ort: Schützenhaus Waldblick")).toBeVisible();
    await expect(page.getByText("Mehrere Orte")).toBeVisible();
    await expect(page.getByText("5 von 5 ausgewählt")).toBeVisible();

    // Einzelnen Termin abwählen
    const table = page.getByRole("table", { name: "Termine der Gruppe Training Luftgewehr" });
    await table.getByRole("checkbox", { name: /22\.10\.2026 auswählen/ }).uncheck();
    await expect(page.getByText("4 von 5 ausgewählt")).toBeVisible();

    // Gruppe bearbeiten: Zielgruppe anlegen und zuweisen
    await page.getByRole("button", { name: "Gruppe Training Luftgewehr bearbeiten" }).click();
    const dialog = page.getByRole("dialog", { name: "Gruppe bearbeiten: Training Luftgewehr" });
    await dialog.getByRole("button", { name: "Neue Zielgruppe anlegen" }).click();
    await dialog.getByLabel("Name", { exact: true }).last().fill("Erwachsene");
    await dialog.getByRole("button", { name: "Anlegen und zuweisen" }).click();
    await expect(dialog.getByRole("button", { name: "Erwachsene" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await dialog.getByRole("button", { name: "Änderungen übernehmen" }).click();
    await expect(dialog).toBeHidden();

    // Vorstandssitzung veröffentlichen (Einzeltermin)
    await page.getByRole("button", { name: "Weitere Termine: Termine anzeigen" }).click();
    await expect(
      page.getByRole("table", { name: "Termine der Gruppe Weitere Termine" }),
    ).toContainText("Gasthof Zur Linde");
    await page
      .getByRole("button", { name: /Termin Vorstandssitzung am .*07\.10\.2026 bearbeiten/ })
      .click();
    const itemDialog = page.getByRole("dialog", { name: "Termin bearbeiten" });
    await itemDialog.getByRole("button", { name: "Veröffentlicht" }).click();
    await itemDialog.getByRole("button", { name: "Änderungen übernehmen" }).click();
    await expect(itemDialog).toBeHidden();

    await page.getByRole("button", { name: "4 Termine importieren" }).click();

    // Schritt 3: Fertig
    const done = page.getByRole("heading", { level: 1, name: "4 Termine importiert" });
    await expect(done).toBeVisible();
    await expect(done).toBeFocused();
    await expect(page.getByText("3 als Entwurf angelegt")).toBeVisible();
    await expect(page.getByText("1 veröffentlicht angelegt")).toBeVisible();
    await expect(page.getByText("1 neuer Ort angelegt: Gasthof Zur Linde")).toBeVisible();
    await expect(page.getByText("1 Termin übersprungen", { exact: true })).toBeVisible();
    await expect(page.getByText("1 Termin der Datei nicht lesbar")).toBeVisible();

    await page.getByRole("link", { name: "Alle Termine ansehen" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Alle Termine" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Training Luftgewehr", exact: true })).toHaveCount(
      2,
    );
    const fest = page.getByRole("row").filter({ hasText: "Herbstfest" });
    await expect(fest).toContainText("24.10.2026 – 25.10.2026");
    await expect(fest).toContainText("Gasthof Zur Linde");
    await expect(fest).toContainText("Entwurf");
    const training = page.getByRole("row").filter({ hasText: "08.10.2026" });
    await expect(training).toContainText("Schützenhaus Waldblick");
    await expect(training).toContainText("Erwachsene");
    await expect(training).toContainText("19:00 – 21:00");
    await expect(page.getByRole("row").filter({ hasText: "Vorstandssitzung" })).toContainText(
      "Veröffentlicht",
    );
    await expect(page.getByRole("row").filter({ hasText: "22.10.2026" })).toHaveCount(0);
  });

  test("falscher Dateityp und Datei ohne Termine", async ({ page, request }) => {
    const seeded = await seed(request, "Import Fehler");
    await openImport(page, seeded.email, seeded.base);
    const input = page.locator("#ics-file");

    await input.setInputFiles({
      name: "plan.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("x"),
    });
    await expect(page.getByRole("alert")).toContainText("Falscher Dateityp");
    await expect(page.getByRole("button", { name: /Datei prüfen/ })).toBeDisabled();

    await input.setInputFiles(icsFile("BEGIN:VCALENDAR\r\nEND:VCALENDAR", "leer.ics"));
    await expect(page.getByRole("alert")).toContainText("Keine Termine gefunden");
    await expect(page.getByRole("button", { name: /Datei prüfen/ })).toBeDisabled();
  });

  test("Zurück zur Datei, Auswahl bleibt erhalten, nichts ausgewählt sperrt den Import", async ({
    page,
    request,
  }) => {
    const seeded = await seed(request, "Import Zurueck");
    await openImport(page, seeded.email, seeded.base);
    await page.locator("#ics-file").setInputFiles(icsFile());
    await page.getByRole("button", { name: /Datei prüfen/ }).click();

    await page.getByRole("button", { name: "Auswahl aufheben" }).click();
    await expect(page.getByText("0 von 5 ausgewählt")).toBeVisible();
    await expect(page.getByRole("button", { name: "Termine importieren" })).toBeDisabled();
    await page.getByRole("button", { name: "Alle auswählen" }).click();

    await page.getByRole("button", { name: "Zurück", exact: true }).click();
    await expect(page.getByText("Schiessplan-2026.ics: 5 Termine erkannt")).toBeVisible();
    await page.getByRole("button", { name: /Datei prüfen/ }).click();
    await expect(page.getByText("5 von 5 ausgewählt")).toBeVisible();

    // Nichts wurde angelegt
    const events = await request.get(`${API}/api/calendars/${seeded.calendarId}/events`, {
      headers: seeded.headers,
    });
    expect(await events.json()).toEqual([]);
  });

  test("Mobile Breite: Karten und feste Leiste", async ({ page, request }) => {
    const seeded = await seed(request, "Import Mobil");
    await page.setViewportSize({ width: 390, height: 844 });
    await openImport(page, seeded.email, seeded.base);
    await page.locator("#ics-file").setInputFiles(icsFile());
    await page.getByRole("button", { name: /Datei prüfen/ }).click();
    await expect(page.getByRole("button", { name: "5 Termine importieren" })).toBeInViewport();
    const hasOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(hasOverflow).toBe(false);
  });
});
