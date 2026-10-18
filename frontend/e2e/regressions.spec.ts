import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
import { API, authHeaders, createVerifiedUser, login, seedClub } from "./helpers";

// ——— Regressions of the redesign follow-up: table columns, club switch, foreign club, history focus ———

test.use({ locale: "de-DE", timezoneId: "Europe/Berlin" });

async function addCalendar(
  request: APIRequestContext,
  email: string,
  clubId: string,
  name: string,
) {
  const headers = await authHeaders(request, email);
  const res = await request.post(`${API}/api/clubs/${clubId}/calendars`, {
    headers,
    data: { name },
  });
  expect(res.ok()).toBeTruthy();
  return ((await res.json()) as { id: string }).id;
}

/** Number of text lines of a cell (client rects of its text). */
function lines(page: Page, label: string, row: number) {
  return page.evaluate(
    ([lab, r]) => {
      const rows = document.querySelectorAll(".ap-table tbody tr");
      const td = rows[r + 1]?.querySelector(`td[data-label="${lab}"]`);
      if (!td) return -1;
      const range = document.createRange();
      range.selectNodeContents(td);
      return new Set([...range.getClientRects()].map((x) => Math.round(x.top))).size;
    },
    [label, row] as const,
  );
}

test("Terminliste: Datum und Zeit brechen in keiner Breite um", async ({ page, request }) => {
  const email = await createVerifiedUser(request, "Spalten");
  const { clubId, calendarId, headers } = await seedClub(request, email, "Spalten Verein");
  const res = await request.post(`${API}/api/calendars/${calendarId}/events`, {
    headers,
    data: {
      name: "Herbstfest mit langem Namen im Schützenhaus Waldblick",
      date: "2026-10-24",
      dateEnd: "2026-10-25",
      timeBegin: "19:00",
      timeEnd: "21:00",
      isDraft: false,
    },
  });
  expect(res.ok()).toBeTruthy();
  await login(page, email);
  await page.waitForURL(/\/clubs/);
  await page.goto(`/clubs/${clubId}/calendars/${calendarId}/events`);
  await expect(page.getByRole("table")).toBeVisible();
  for (const width of [1440, 1200, 1024, 800, 721]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await lines(page, "Datum", 0), `Datum bei ${width}px`).toBe(1);
    expect(await lines(page, "Zeit", 0), `Zeit bei ${width}px`).toBe(1);
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth), {
        message: `Seitenüberlauf bei ${width}px`,
      })
      .toBeLessThanOrEqual(0);
  }
});

test("Vereinswechsel öffnet den zuletzt genutzten Kalender des Zielvereins", async ({
  page,
  request,
}) => {
  const email = await createVerifiedUser(request, "Wechsel");
  const a = await seedClub(request, email, "Wechsel Alpha");
  const b = await seedClub(request, email, "Wechsel Beta");
  const b2 = await addCalendar(request, email, b.clubId, "Beta Zweitkalender");
  await login(page, email);
  await page.waitForURL(/\/clubs/);
  // Beta: the second calendar becomes the remembered one
  await page.goto(`/clubs/${b.clubId}/calendars/${b2}`);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await page.goto(`/clubs/${a.clubId}/calendars/${a.calendarId}`);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

  await page.getByRole("button", { name: /^Verein/ }).click();
  await page
    .getByRole("region", { name: "Verein wechseln" })
    .getByRole("button", { name: /Beta/ })
    .click();
  await expect(page).toHaveURL(new RegExp(`/clubs/${b.clubId}/calendars/${b2}$`));
});

test("Fremder Verein: sofort 'Nicht verfügbar' statt dauerhaft 'Laden…'", async ({
  page,
  request,
}) => {
  const owner = await createVerifiedUser(request, "Besitzer");
  const foreign = await seedClub(request, owner, "Fremder Verein");
  const email = await createVerifiedUser(request, "Eindringling");
  await seedClub(request, email, "Eigener Verein");
  await login(page, email);
  await page.waitForURL(/\/clubs/);
  const start = Date.now();
  await page.goto(`/clubs/${foreign.clubId}/calendars/${foreign.calendarId}`);
  await expect(page.getByRole("link", { name: "Zur Vereinsauswahl" })).toBeVisible({
    timeout: 4000,
  });
  expect(Date.now() - start).toBeLessThan(4000);
  await expect(page.getByText("Nicht verfügbar").first()).toBeVisible();
  await expect(page.getByText("Laden…")).toHaveCount(0);
  await page.getByRole("link", { name: "Zur Vereinsauswahl" }).click();
  await expect(page).toHaveURL(/\/clubs\?select=1/);
});

test("/setup ohne Parameter startet bei Schritt 1, auch mit bestehendem Verein", async ({
  page,
  request,
}) => {
  const email = await createVerifiedUser(request, "Neuer Verein");
  await seedClub(request, email, "Bestehender Verein");
  await login(page, email);
  await page.waitForURL(/\/clubs/);
  await page.goto("/setup");
  await expect(
    page.getByRole("heading", { level: 1, name: "Willkommen bei Club Calendar" }),
  ).toBeVisible();
  await expect(page.getByText("Verein angelegt")).toHaveCount(0);
});

test("Browser-Zurück setzt den Fokus auf die Seitenüberschrift", async ({ page, request }) => {
  const email = await createVerifiedUser(request, "Verlauf Fokus");
  const { clubId, calendarId } = await seedClub(request, email, "Verlauf Fokus Verein");
  await login(page, email);
  await page.waitForURL(/\/clubs/);
  await page.goto(`/clubs/${clubId}/calendars/${calendarId}`);
  const heading = page.locator("main h1");
  await expect(heading).toBeVisible();
  await page.getByRole("link", { name: "Alle Termine" }).first().click();
  await expect(page).toHaveURL(/\/events$/);
  await expect(page.locator("main h1")).toHaveText("Alle Termine");
  await page.goBack();
  await expect(page).toHaveURL(new RegExp(`/calendars/${calendarId}$`));
  await expect(page.locator("main h1")).toBeFocused();
  await page.goForward();
  await expect(page.locator("main h1")).toHaveText("Alle Termine");
  await expect(page.locator("main h1")).toBeFocused();
});

test("Import: Reload auf der Prüfung führt nicht in einen veralteten Schritt zurück", async ({
  page,
  request,
}) => {
  const email = await createVerifiedUser(request, "Import Reload");
  const { clubId, calendarId } = await seedClub(request, email, "Import Reload Verein");
  await login(page, email);
  await page.waitForURL(/\/clubs/);
  const ics = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "BEGIN:VEVENT",
    "UID:reload-1@e2e",
    "SUMMARY:Reload Training",
    "DTSTART:20270201T190000",
    "DTEND:20270201T210000",
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
  const choose = async () => {
    await page.locator("#ics-file").setInputFiles({
      name: "reload.ics",
      mimeType: "text/calendar",
      buffer: Buffer.from(ics),
    });
    await page.getByRole("button", { name: /Datei prüfen/ }).click();
  };
  await page.goto(`/clubs/${clubId}/calendars/${calendarId}/import`);
  await choose();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("1 Termin erkannt");

  // The reload drops the parsed file: the file step shows, the stale step is gone from the history.
  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name: "Termine importieren" })).toBeVisible();
  await choose();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("1 Termin erkannt");
  await page.getByRole("button", { name: "Zurück" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Termine importieren" })).toBeVisible();
});

test("Orte: Koordinaten bleiben beim Tippen von Text sichtbar und blockieren das Speichern", async ({
  page,
  request,
}) => {
  const email = await createVerifiedUser(request, "Koordinaten");
  const { clubId, calendarId, headers } = await seedClub(request, email, "Koordinaten Verein");
  await request.post(`${API}/api/clubs/${clubId}/locations`, {
    headers,
    data: { name: "Schützenhaus", latitude: 48.1371, longitude: 11.5754 },
  });
  await login(page, email);
  await page.waitForURL(/\/clubs/);
  await page.goto(`/clubs/${clubId}/settings/locations`);
  await page
    .getByRole("button", { name: /Schützenhaus.*bearbeiten|bearbeiten.*Schützenhaus/ })
    .click();
  const lat = page.getByLabel("Breitengrad");
  await expect(lat).toBeVisible();
  await lat.fill("abc");
  await expect(lat).toBeVisible();
  await expect(lat).toHaveAttribute("aria-invalid", "true");
  await page.getByRole("button", { name: "Ort speichern" }).click();
  await expect(page.getByRole("alert")).toContainText("Bitte korrigiere die Koordinaten");
  await lat.fill("48,5");
  await page.getByRole("button", { name: "Ort speichern" }).click();
  await expect(page.getByText("Ort gespeichert")).toBeVisible();
});
