import { test, expect, type Page } from "@playwright/test";
import { API, createVerifiedUser, login, seedClub } from "./helpers";

// ——— ICS import with recurrences: RRULE / EXDATE / RECURRENCE-ID are expanded in the browser into
// single events (one externalUid per instance), unsupported rules keep the first event ———

const ics = [
  "BEGIN:VCALENDAR",
  "VERSION:2.0",
  "PRODID:-//e2e//DE",
  // Weekly training, 4 dates, one cancelled (EXDATE), one moved (RECURRENCE-ID below)
  "BEGIN:VEVENT",
  "UID:training@e2e",
  "SUMMARY:Training Luftgewehr",
  "DTSTART;TZID=Europe/Berlin:20261005T190000",
  "DTEND;TZID=Europe/Berlin:20261005T210000",
  "RRULE:FREQ=WEEKLY;COUNT=4",
  "EXDATE;TZID=Europe/Berlin:20261012T190000",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "UID:training@e2e",
  "SUMMARY:Training Luftgewehr",
  "RECURRENCE-ID;TZID=Europe/Berlin:20261019T190000",
  "DTSTART;TZID=Europe/Berlin:20261020T180000",
  "DTEND;TZID=Europe/Berlin:20261020T200000",
  "END:VEVENT",
  // Last Friday of the month, all-day, three times
  "BEGIN:VEVENT",
  "UID:abschluss@e2e",
  "SUMMARY:Monatsabschluss",
  "DTSTART;VALUE=DATE:20261030",
  "RRULE:FREQ=MONTHLY;BYDAY=-1FR;COUNT=3",
  "END:VEVENT",
  // Not supported: only the first event
  "BEGIN:VEVENT",
  "UID:sitzung@e2e",
  "SUMMARY:Vorstandssitzung",
  "DTSTART;TZID=Europe/Berlin:20261007T193000",
  "DTEND;TZID=Europe/Berlin:20261007T213000",
  "RRULE:FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-1",
  "END:VEVENT",
  "END:VCALENDAR",
].join("\r\n");

const icsFile = () => ({
  name: "Wiederholungen.ics",
  mimeType: "text/calendar",
  buffer: Buffer.from(ics),
});

async function openImport(page: Page, email: string, base: string) {
  await login(page, email);
  await page.waitForURL(/\/clubs/);
  await page.goto(`${base}/import`);
  await expect(page.getByRole("heading", { level: 1, name: "Termine importieren" })).toBeVisible();
}

test.describe("Import mit Wiederholungen", () => {
  test.use({ locale: "de-DE", timezoneId: "Europe/Berlin" });

  test("RRULE ausschreiben, prüfen, importieren; Wiederimport legt nichts doppelt an", async ({
    page,
    request,
  }) => {
    const email = await createVerifiedUser(request, "Import Wiederholung");
    const { clubId, calendarId, headers } = await seedClub(request, email, "Wiederholung Verein");
    const base = `/clubs/${clubId}/calendars/${calendarId}`;
    await openImport(page, email, base);

    await page.locator("#ics-file").setInputFiles(icsFile());
    // 3 trainings (one cancelled, one moved) + 3 Monatsabschluss + 1 Vorstandssitzung
    await expect(page.getByText("Wiederholungen.ics: 7 Termine erkannt")).toBeVisible();
    await page.getByRole("button", { name: /Datei prüfen/ }).click();
    await expect(
      page.getByRole("heading", { level: 1, name: "Wiederholungen.ics: 7 Termine erkannt" }),
    ).toBeVisible();

    // Hints: expanded recurrences (single events, no series) and the unsupported rule
    await expect(page.getByText("Wiederholungen ausgeschrieben")).toBeVisible();
    await expect(page.getByText(/2 Wiederholungen ergeben 6 einzelne Termine/)).toContainText(
      "nicht als Terminreihe",
    );
    await expect(
      page.getByText("Wiederholung wird nicht unterstützt: nur der erste Termin wird importiert."),
    ).toBeVisible();
    await expect(page.getByText(/3 Termine · Wiederholung \(3 Termine\)/).first()).toBeVisible();

    // The moved training replaces its date, the cancelled one is missing
    const training = page.getByRole("table", { name: "Termine der Gruppe Training Luftgewehr" });
    await expect(training).toContainText("20.10.2026");
    await expect(training).toContainText("18:00 – 20:00");
    await expect(training).not.toContainText("12.10.2026");
    await expect(training).not.toContainText("19.10.2026");
    await expect(training.getByText("aus Wiederholung")).toHaveCount(3);

    const [imported] = await Promise.all([
      page.waitForResponse((r) => r.url().endsWith("/events/import")),
      page.getByRole("button", { name: "7 Termine importieren" }).click(),
    ]);
    expect(imported.status()).toBe(201);
    const body = imported.request().postDataJSON();
    expect(body.events.map((e: { externalUid: string }) => e.externalUid).sort()).toEqual([
      "abschluss@e2e#20261030",
      "abschluss@e2e#20261127",
      "abschluss@e2e#20261225",
      "sitzung@e2e",
      "training@e2e#20261005",
      "training@e2e#20261019",
      "training@e2e#20261026",
    ]);
    await expect(
      page.getByRole("heading", { level: 1, name: "7 Termine importiert" }),
    ).toBeVisible();

    // Single events in the calendar, no series
    const events = await (
      await request.get(`${API}/api/calendars/${calendarId}/events`, { headers })
    ).json();
    expect(events).toHaveLength(7);
    expect(events.every((e: { seriesId: string | null }) => e.seriesId === null)).toBe(true);
    await page.getByRole("link", { name: "Alle Termine ansehen" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Alle Termine" })).toBeVisible();
    await expect(page.getByRole("row").filter({ hasText: "27.11.2026" })).toContainText(
      "Monatsabschluss",
    );

    // The same file again: every instance is a duplicate (by its UID); skipDuplicates creates nothing
    await page.goto(`${base}/import`);
    await page.locator("#ics-file").setInputFiles(icsFile());
    await page.getByRole("button", { name: /Datei prüfen/ }).click();
    await expect(
      page.getByRole("status").filter({ hasText: "gibt es vielleicht schon" }),
    ).toContainText("7 Termine gibt es vielleicht schon");
    const again = await request.post(`${API}/api/calendars/${calendarId}/events/import`, {
      headers,
      data: { ...body, skipDuplicates: true },
    });
    expect(again.status()).toBe(201);
    expect(await again.json()).toMatchObject({ imported: 0, skipped: 7 });
    const after = await (
      await request.get(`${API}/api/calendars/${calendarId}/events`, { headers })
    ).json();
    expect(after).toHaveLength(7);
  });
  test("Hinweis zu den Grenzen: Aufzählungspunkte in der Liste des Banners", async ({
    page,
    request,
  }) => {
    const endless = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//e2e//DE",
      "BEGIN:VEVENT",
      "UID:endlos@e2e",
      "SUMMARY:Endlos",
      "DTSTART;TZID=Europe/Berlin:20261005T190000",
      "DTEND;TZID=Europe/Berlin:20261005T210000",
      "RRULE:FREQ=WEEKLY",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");
    const email = await createVerifiedUser(request, "Import Grenzen");
    const { clubId, calendarId } = await seedClub(request, email, "Grenzen Verein");
    await openImport(page, email, `/clubs/${clubId}/calendars/${calendarId}`);
    await page.locator("#ics-file").setInputFiles({
      name: "Endlos.ics",
      mimeType: "text/calendar",
      buffer: Buffer.from(endless),
    });
    await page.getByRole("button", { name: /Datei prüfen/ }).click();

    const banner = page.getByRole("status").filter({
      hasText: "Nicht alle Wiederholungen wurden ausgeschrieben",
    });
    const items = banner.getByRole("listitem");
    await expect(items.first()).toBeVisible();
    for (const li of await items.all()) {
      expect(await li.evaluate((el) => getComputedStyle(el).listStyleType)).toBe("disc");
    }
    const list = banner.getByRole("list");
    expect(
      await list.evaluate((el) => parseFloat(getComputedStyle(el).paddingLeft)),
    ).toBeGreaterThan(0);
  });
});
