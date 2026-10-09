import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { API, createVerifiedUser, login, seedClub } from "./helpers";

// ——— Events (phase 4): list, create, edit, publish, delete, template, export, mobile ———

interface Seeded {
  email: string;
  calendarId: string;
  base: string;
}

async function seedEvents(request: APIRequestContext, name: string): Promise<Seeded> {
  const email = await createVerifiedUser(request, name);
  const { clubId, calendarId, headers } = await seedClub(request, email, `${name} Verein`);
  const post = async (path: string, data: object) => {
    const res = await request.post(`${API}/api/calendars/${calendarId}/${path}`, { headers, data });
    expect(res.ok(), `${path}: ${res.status()}`).toBeTruthy();
    return (await res.json()) as { id: string };
  };
  const youth = (await post("target-groups", { name: "Jugend" })).id;
  const adults = (await post("target-groups", { name: "Erwachsene" })).id;
  const place = (
    await post("locations", {
      name: "Schützenhaus Waldblick",
      street: "Waldstraße 12",
      city: "Musterstadt",
    })
  ).id;
  await post("templates", {
    name: "Training Luftgewehr",
    timezone: "Europe/Berlin",
    timeBegin: "19:00",
    timeEnd: "21:00",
    locationId: place,
    targetGroupIds: [adults],
  });
  const events = [
    {
      name: "Training Luftgewehr",
      date: "2026-10-01",
      targetGroupIds: [adults],
      isDraft: false,
      locationId: place,
    },
    {
      name: "Jugendtraining",
      date: "2026-10-05",
      timeBegin: "18:00",
      timeEnd: "19:30",
      targetGroupIds: [youth],
      isDraft: false,
    },
    { name: "Vorstandssitzung", date: "2026-10-07", targetGroupIds: [adults], isDraft: true },
    {
      name: "Arbeitsdienst",
      date: "2026-10-17",
      timeBegin: "09:00",
      timeEnd: "13:00",
      isDraft: true,
    },
  ];
  for (const ev of events) await post("events", { timeBegin: "19:00", timeEnd: "21:00", ...ev });
  return { email, calendarId, base: `/clubs/${clubId}/calendars/${calendarId}` };
}

async function openList(page: Page, seeded: Seeded) {
  await login(page, seeded.email);
  await page.waitForURL(/\/clubs/);
  await page.goto(`${seeded.base}/events`);
  await expect(page.getByRole("heading", { level: 1, name: "Alle Termine" })).toBeVisible();
  await expect(page.getByRole("table")).toBeVisible();
}

const rowLink = (page: Page, name: string) => page.getByRole("link", { name, exact: true });

test.describe("Termine", () => {
  test.use({ locale: "de-DE", timezoneId: "Europe/Berlin" });

  test.beforeEach(async ({ page }) => {
    await page.clock.setFixedTime(new Date("2026-10-02T10:00:00+02:00"));
  });

  test("Liste: Tabs, Suche und Zielgruppenfilter", async ({ page, request }) => {
    const seeded = await seedEvents(request, "Liste Filter");
    await openList(page, seeded);

    const tabs = page.getByRole("group", { name: "Nach Status filtern" });
    await expect(tabs.getByRole("button", { name: "Alle 4" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await tabs.getByRole("button", { name: "Entwurf 2" }).click();
    await expect(page).toHaveURL(/status=draft/);
    await expect(rowLink(page, "Vorstandssitzung")).toBeVisible();
    await expect(rowLink(page, "Jugendtraining")).toHaveCount(0);
    await tabs.getByRole("button", { name: "Alle 4" }).click();

    await page.getByRole("searchbox", { name: "Termine nach Namen suchen" }).fill("training");
    await expect(page.getByText("2 von 4 Terminen")).toBeVisible();
    await page.getByRole("searchbox").fill("Schwimmen");
    await expect(
      page.getByRole("heading", { name: "Keine Treffer für „Schwimmen“" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Suche zurücksetzen" }).click();

    await page
      .getByRole("group", { name: "Nach Zielgruppe filtern" })
      .getByRole("button", { name: "Jugend" })
      .click();
    await expect(rowLink(page, "Jugendtraining")).toBeVisible();
    await expect(rowLink(page, "Training Luftgewehr")).toHaveCount(0);
  });

  test("Termin anlegen mit Validierung", async ({ page, request }) => {
    const seeded = await seedEvents(request, "Anlegen Validierung");
    await openList(page, seeded);

    await page.getByRole("link", { name: "Termin anlegen" }).first().click();
    const choice = page.getByRole("dialog", { name: "Termin anlegen" });
    await expect(choice).toBeVisible();
    await expect(choice.getByRole("heading", { level: 1 })).toBeFocused();
    await choice.getByRole("link", { name: /Neuer Termin/ }).click();
    // Same dialog, next step: the form starts in its first field.
    const dialog = page.getByRole("dialog", { name: "Neuer Termin" });
    await expect(dialog).toHaveAttribute("aria-modal", "true");
    await expect(page.getByLabel("Name (Pflicht)")).toBeFocused();
    await expect(page).toHaveURL(/\/events\/new\/form$/);

    await page.getByRole("button", { name: "Termin speichern" }).click();
    const summary = page
      .getByRole("alert")
      .filter({ hasText: "Der Termin ist noch nicht vollständig." });
    await expect(summary).toBeFocused();
    await summary.getByRole("link", { name: "Bitte gib einen Namen ein." }).click();
    await expect(page.getByLabel("Name (Pflicht)")).toBeFocused();

    await page.getByLabel("Name (Pflicht)").fill("Herbstfest");
    await page.getByLabel("Startdatum (Pflicht)").fill("2026-10-24");
    await page.getByLabel("Enddatum").fill("2026-10-25");
    await page.getByRole("checkbox", { name: /Ganztägig/ }).check();
    await expect(page.getByLabel("Startzeit")).toHaveCount(0);
    await page
      .getByRole("combobox", { name: /^Ort/ })
      .selectOption({ label: "Schützenhaus Waldblick" });
    await page
      .getByRole("group", { name: "Zielgruppen" })
      .getByRole("button", { name: "Jugend" })
      .click();
    await page.getByRole("button", { name: "Termin speichern" }).click();

    await expect(page.getByText("Termin gespeichert.")).toBeVisible();
    await expect(page.getByRole("heading", { level: 1, name: "Alle Termine" })).toBeVisible();
    const row = page.getByRole("row").filter({ has: rowLink(page, "Herbstfest") });
    await expect(row).toContainText("24.10.2026 – 25.10.2026");
    await expect(row).toContainText("Ganztägig");
    await expect(row).toContainText("Entwurf");
  });

  test("Termin bearbeiten, veröffentlichen und löschen", async ({ page, request }) => {
    const seeded = await seedEvents(request, "Bearbeiten");
    await openList(page, seeded);

    await rowLink(page, "Vorstandssitzung").click();
    await expect(page.getByRole("heading", { level: 1, name: "Termin bearbeiten" })).toBeVisible();
    await expect(page.getByLabel("Name (Pflicht)")).toHaveValue("Vorstandssitzung");
    await page.getByLabel("Name (Pflicht)").fill("Vorstandssitzung Herbst");
    await page.getByRole("button", { name: "Veröffentlicht", exact: true }).click();
    await expect(page.getByText("Änderungen sind sofort in den Feeds sichtbar.")).toBeVisible();
    await page.getByRole("button", { name: "Termin speichern" }).click();
    await expect(page.getByText("Termin gespeichert.")).toBeVisible();
    const row = page.getByRole("row").filter({ has: rowLink(page, "Vorstandssitzung Herbst") });
    await expect(row).toContainText("Veröffentlicht");

    await rowLink(page, "Vorstandssitzung Herbst").click();
    await page.getByRole("button", { name: "Termin löschen" }).click();
    const confirm = page.getByRole("alertdialog");
    await expect(confirm).toContainText("Termin „Vorstandssitzung Herbst“ löschen?");
    await expect(confirm).toContainText("verschwindet aus dem Kalender und aus allen Feeds");
    await confirm.getByRole("button", { name: "Termin löschen" }).click();
    await expect(page.getByText("Termin gelöscht.")).toBeVisible();
    await expect(rowLink(page, "Vorstandssitzung Herbst")).toHaveCount(0);
  });

  test("Sammelaktionen: veröffentlichen und löschen", async ({ page, request }) => {
    const seeded = await seedEvents(request, "Sammelaktionen");
    await openList(page, seeded);

    await page.getByRole("checkbox", { name: "Vorstandssitzung am 07.10.2026 auswählen" }).check();
    await page.getByRole("checkbox", { name: "Arbeitsdienst am 17.10.2026 auswählen" }).check();
    const bar = page.getByRole("region", { name: "Sammelaktionen" });
    await expect(bar).toContainText("2 ausgewählt");
    await bar.getByRole("button", { name: "Veröffentlichen" }).click();
    await expect(page.getByText("2 Termine veröffentlicht.")).toBeVisible();
    await expect(
      page
        .getByRole("group", { name: "Nach Status filtern" })
        .getByRole("button", { name: "Entwurf 0" }),
    ).toBeVisible();

    await page.getByRole("checkbox", { name: "Arbeitsdienst am 17.10.2026 auswählen" }).check();
    await page
      .getByRole("region", { name: "Sammelaktionen" })
      .getByRole("button", { name: "Löschen" })
      .click();
    const confirm = page.getByRole("alertdialog");
    await expect(confirm).toContainText("1 Termin löschen?");
    await expect(confirm).toContainText("Arbeitsdienst (17.10.)");
    await confirm.getByRole("button", { name: "1 Termin löschen" }).click();
    await expect(rowLink(page, "Arbeitsdienst")).toHaveCount(0);
  });

  test("Termin aus Vorlage, Serie nur als Vorschau", async ({ page, request }) => {
    const seeded = await seedEvents(request, "Vorlage Serie");
    await openList(page, seeded);

    await page.getByRole("link", { name: "Termin anlegen" }).first().click();
    await page.getByRole("link", { name: /Aus Vorlage/ }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Vorlage wählen" })).toBeVisible();
    await expect(page.getByRole("radio", { name: /Training Luftgewehr/ })).toBeChecked();
    await page.getByRole("button", { name: "Weiter" }).click();

    await expect(page.getByRole("heading", { level: 1, name: "Termin aus Vorlage" })).toBeVisible();
    await page.getByRole("button", { name: "Terminserie" }).click();
    await expect(page.getByText("Bald verfügbar", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: /Termine als Entwurf anlegen/ })).toBeDisabled();

    await page.getByRole("button", { name: "Einzelner Termin" }).click();
    await page.getByLabel("Datum (Pflicht)").fill("2026-10-22");
    await expect(page.getByText("1 Termin wird angelegt.")).toBeVisible();
    await page.getByRole("button", { name: "1 Termin als Entwurf anlegen" }).click();
    await expect(page.getByText("Termin angelegt.")).toBeVisible();

    const created = page.getByRole("row").filter({ hasText: "22.10.2026" });
    await expect(created).toContainText("Training Luftgewehr");
    await expect(created).toContainText("19:00 – 21:00");
    await expect(created).toContainText("Schützenhaus Waldblick");
    await expect(created).toContainText("Erwachsene");
  });

  test("Ungespeicherte Änderungen und Export", async ({ page, request }) => {
    const seeded = await seedEvents(request, "Export Warnung");
    await openList(page, seeded);

    await rowLink(page, "Jugendtraining").click();
    await page.getByLabel("Name (Pflicht)").fill("Jugendtraining neu");
    // Escape asks first.
    await page.keyboard.press("Escape");
    const dialog = page.getByRole("alertdialog");
    await expect(dialog).toContainText("Änderungen verwerfen?");
    await dialog.getByRole("button", { name: "Weiter bearbeiten" }).click();
    await expect(page.getByLabel("Name (Pflicht)")).toHaveValue("Jugendtraining neu");
    // So does the browser's back button; the dialog stays open.
    await page.goBack();
    await expect(page.getByRole("alertdialog")).toContainText("Änderungen verwerfen?");
    await page.getByRole("alertdialog").getByRole("button", { name: "Weiter bearbeiten" }).click();
    await expect(page.getByRole("dialog", { name: "Termin bearbeiten" })).toBeVisible();
    await expect(page).toHaveURL(/\/events\/[0-9a-f-]{36}$/);
    await expect(page.getByLabel("Name (Pflicht)")).toHaveValue("Jugendtraining neu");
    await page.getByRole("button", { name: "Schließen, Änderungen verwerfen" }).click();
    await page
      .getByRole("alertdialog")
      .getByRole("button", { name: "Änderungen verwerfen" })
      .click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByRole("heading", { level: 1, name: "Alle Termine" })).toBeVisible();
    await expect(rowLink(page, "Jugendtraining")).toBeVisible();
    await expect(rowLink(page, "Jugendtraining")).toBeFocused();

    // The list page has no export link anymore; the export page stays reachable by its URL.
    await page.goto(new URL("events/export", `${page.url().replace(/events.*$/, "")}`).toString());
    await expect(
      page.getByRole("heading", { level: 1, name: "Termine exportieren" }),
    ).toBeVisible();
    await expect(page.getByText("2 Termine werden exportiert")).toBeVisible();
    await page.getByRole("radio", { name: /Auch Entwürfe/ }).check();
    await expect(page.getByText("4 Termine werden exportiert")).toBeVisible();
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: "ICS-Datei laden" }).click(),
    ]);
    expect(download.suggestedFilename()).toBe("export-warnung-verein-termine.ics");
    const ics = readFileSync((await download.path())!, "utf-8");
    expect(ics).toContain("BEGIN:VCALENDAR");
    expect(ics).toContain("SUMMARY:Jugendtraining");
    expect(ics).toContain("DTSTART:20261005T160000Z");
    await expect(page.getByText("Datei wurde erstellt.")).toBeVisible();
  });

  test("Mobile Breite: Karten, FAB und Formular", async ({ page, request }) => {
    const seeded = await seedEvents(request, "Mobil Termine");
    await page.setViewportSize({ width: 390, height: 900 });
    await openList(page, seeded);

    // The table turns into cards: no visible column headers, labels per field.
    await expect(page.getByRole("columnheader", { name: "Datum" })).not.toBeInViewport();
    const box = await page
      .getByRole("checkbox", { name: "Jugendtraining am 05.10.2026 auswählen" })
      .locator("..")
      .boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(44);
    expect(box!.width).toBeGreaterThanOrEqual(44);

    const fab = page.locator(".ap-fab");
    await expect(fab).toBeVisible();
    await fab.click();
    await page.getByRole("link", { name: /Neuer Termin/ }).click();
    // Bottom sheet: full width, anchored at the bottom, no horizontal scrolling.
    const sheet = await page.getByRole("dialog", { name: "Neuer Termin" }).boundingBox();
    expect(sheet!.width).toBeCloseTo(390, 0);
    expect(sheet!.y + sheet!.height).toBeCloseTo(900, 0);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await page.getByLabel("Name (Pflicht)").fill("Mobil angelegt");
    await page.getByLabel("Startdatum (Pflicht)").fill("2026-10-09");
    const save = page.getByRole("button", { name: "Termin speichern" });
    const saveBox = await save.boundingBox();
    expect(saveBox!.height).toBeGreaterThanOrEqual(44);
    await save.click();
    await expect(rowLink(page, "Mobil angelegt")).toBeVisible();
  });
});
