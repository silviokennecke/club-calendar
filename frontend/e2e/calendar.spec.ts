import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
import { API, authHeaders, createVerifiedUser, login, seedClub } from "./helpers";

async function loginAdmin(page: Page) {
  await page.goto("/login");
  await page.getByLabel(/email/i).fill("admin@example.com");
  await page.getByLabel("Password", { exact: true }).fill("password123");
  await page.getByRole("button", { name: /^sign in$/i }).click();
  await page.waitForURL("**/clubs**");
}

async function goToCalendar(page: Page) {
  await loginAdmin(page);
  // Go to clubs list; wait for potential auto-redirect to settle
  await page.goto("/clubs");
  await page.waitForLoadState("networkidle");
  if (!page.url().includes("/calendars/")) {
    // The club card opens the club's (last used or first) calendar directly.
    await page
      .getByRole("main")
      .getByText(/Schützenverein/i)
      .click();
    await page.waitForURL("**/calendars/**");
  }
  // Month grid, or the empty state when the seeded calendar has no events yet.
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible({ timeout: 10000 });
}

test.describe("Calendar", () => {
  test("clubs page shows seeded club", async ({ page }) => {
    await loginAdmin(page);
    await page.goto("/clubs");
    await page.waitForLoadState("networkidle");
    if (!page.url().includes("/calendars/")) {
      await expect(page.getByText(/Schützenverein/i).first()).toBeVisible();
    }
  });

  test("can navigate to calendar view", async ({ page }) => {
    await goToCalendar(page);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
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

  test("clicking Create event opens modal", async ({ page }) => {
    await goToCalendar(page);
    // Split button in the page head (the empty state may offer the same action).
    await page
      .getByRole("button", { name: /^create event$/i })
      .first()
      .click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page.getByRole("heading", { name: /new event/i })).toBeVisible();
  });

  test("can create and see a new event", async ({ page }) => {
    await goToCalendar(page);
    // Split button in the page head (the empty state may offer the same action).
    await page
      .getByRole("button", { name: /^create event$/i })
      .first()
      .click();

    const dialog = page.getByRole("dialog");
    await dialog.getByLabel(/name \*/i).fill("E2E Test Event");
    await dialog.getByLabel(/start date/i).fill("2026-09-15");
    // Uncheck draft — switch to published
    await dialog.getByRole("switch", { name: /published/i }).click();

    await dialog.getByRole("button", { name: /^create$/i }).click();
    await expect(dialog).not.toBeVisible({ timeout: 8000 });
  });
});

// ——— Redesigned calendar (German, own seeded data, fixed date) ———

interface Seeded {
  email: string;
  clubId: string;
  calendarId: string;
  url: string;
}

async function seedCalendar(request: APIRequestContext, name: string): Promise<Seeded> {
  const email = await createVerifiedUser(request, name);
  const { clubId, calendarId, headers } = await seedClub(request, email, `${name} Verein`);
  const group = async (groupName: string) =>
    (
      await (
        await request.post(`${API}/api/calendars/${calendarId}/target-groups`, {
          headers,
          data: { name: groupName },
        })
      ).json()
    ).id as string;
  const youth = await group("Jugend");
  const adults = await group("Erwachsene");
  const events = [
    { name: "Training Luftgewehr", date: "2026-10-08", targetGroupIds: [adults], isDraft: false },
    {
      name: "Jugendtraining",
      date: "2026-10-08",
      timeBegin: "18:00",
      timeEnd: "19:30",
      targetGroupIds: [youth],
      isDraft: false,
    },
    { name: "Vorstandssitzung", date: "2026-10-07", targetGroupIds: [adults], isDraft: true },
    {
      name: "Vereinsmeisterschaft",
      date: "2026-10-10",
      dateEnd: "2026-10-11",
      isAllDay: true,
      targetGroupIds: [youth, adults],
      isDraft: false,
    },
  ];
  for (const ev of events) {
    const res = await request.post(`${API}/api/calendars/${calendarId}/events`, {
      headers,
      data: { timeBegin: "19:00", timeEnd: "21:00", ...ev },
    });
    expect(res.ok()).toBeTruthy();
  }
  return { email, clubId, calendarId, url: `/clubs/${clubId}/calendars/${calendarId}` };
}

async function openCalendar(page: Page, seeded: Seeded, query = "") {
  await login(page, seeded.email);
  await page.waitForURL(/\/clubs/);
  await page.goto(seeded.url + query);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
}

test.describe("Kalender (Redesign)", () => {
  test.use({ locale: "de-DE", timezoneId: "Europe/Berlin" });

  test.beforeEach(async ({ page }) => {
    // Fixed "today" for stable month titles; timers keep running.
    await page.clock.setFixedTime(new Date("2026-10-02T10:00:00+02:00"));
  });

  test("Monatsnavigation, Tastatur und Tagesdetails", async ({ page, request }) => {
    const seeded = await seedCalendar(request, "Monat Navigation");
    await openCalendar(page, seeded);

    const title = page.getByRole("heading", { level: 1 });
    await expect(title).toHaveText("Oktober 2026");
    await expect(title).toHaveAttribute("aria-live", "polite");
    const grid = page.getByRole("grid", { name: "Oktober 2026" });
    await expect(grid.getByRole("button", { name: "8. Oktober, 2 Termine" })).toBeVisible();
    await expect(grid.getByRole("button", { name: /^2\. Oktober, heute/ })).toHaveAttribute(
      "aria-current",
      "date",
    );
    await expect(page.getByTitle(/^Vorstandssitzung.*\(Entwurf\)/)).toContainText("Entwurf");

    await page.getByRole("button", { name: "Nächster Monat" }).click();
    await expect(title).toHaveText("November 2026");
    await expect(page).toHaveURL(/date=2026-11-02/);
    await page.getByRole("button", { name: "Vorheriger Monat" }).click();
    await page.getByRole("button", { name: "Vorheriger Monat" }).click();
    await expect(title).toHaveText("September 2026");
    await page.getByRole("button", { name: "Heute", exact: true }).click();
    await expect(title).toHaveText("Oktober 2026");
    // Previous / next / today create history entries: back returns to the month before.
    await page.goBack();
    await expect(title).toHaveText("September 2026");
    await page.goForward();
    await expect(title).toHaveText("Oktober 2026");

    // Tap targets of the navigation are at least 44px.
    for (const name of ["Vorheriger Monat", "Heute", "Nächster Monat"]) {
      const box = await page.getByRole("button", { name, exact: true }).boundingBox();
      expect(box!.height).toBeGreaterThanOrEqual(44);
      expect(box!.width).toBeGreaterThanOrEqual(44);
    }

    // Keyboard: arrows move the roving focus, Enter opens the day, Escape closes it.
    await grid.getByRole("button", { name: /^2\. Oktober/ }).focus();
    await page.keyboard.press("ArrowDown");
    await expect(grid.getByRole("button", { name: /^9\. Oktober/ })).toBeFocused();
    await page.keyboard.press("ArrowLeft");
    await expect(grid.getByRole("button", { name: "8. Oktober, 2 Termine" })).toBeFocused();
    await page.keyboard.press("Enter");
    const dayHeading = page.getByRole("heading", { level: 2, name: "Donnerstag, 8. Oktober" });
    await expect(dayHeading).toBeFocused();
    await expect(page.getByRole("button", { name: "Jugendtraining" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dayHeading).toBeHidden();
    await expect(grid.getByRole("button", { name: "8. Oktober, 2 Termine" })).toBeFocused();
  });

  test("Wochenansicht", async ({ page, request }) => {
    const seeded = await seedCalendar(request, "Woche Ansicht");
    await openCalendar(page, seeded, "?date=2026-10-08");
    await page
      .getByRole("navigation", { name: "Ansicht wechseln" })
      .getByRole("link", { name: "Woche" })
      .click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(/^KW 41 · /);
    await expect(
      page
        .getByRole("navigation", { name: "Ansicht wechseln" })
        .getByRole("link", { name: "Woche", exact: true }),
    ).toHaveAttribute("aria-current", "page");
    const thursday = page.getByRole("region", { name: "Do 08.10." });
    await expect(thursday.getByRole("button", { name: /Training Luftgewehr/ })).toBeVisible();
    await expect(page.getByRole("region", { name: "Sa 10.10." })).toContainText(
      "Vereinsmeisterschaft",
    );
    await expect(page.getByRole("region", { name: "So 11.10." })).toContainText(
      "Vereinsmeisterschaft",
    );
    await page.getByRole("button", { name: "Nächste Woche" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(/^KW 42 · /);
    await expect(page).toHaveURL(/view=week/);
  });

  test("Filter nach Zielgruppe und Suche", async ({ page, request }) => {
    const seeded = await seedCalendar(request, "Filter Suche");
    await openCalendar(page, seeded);
    await expect(page.getByTitle(/^Training Luftgewehr/)).toBeVisible();

    const chips = page.getByRole("group", { name: "Nach Zielgruppe filtern" });
    const youth = chips.getByRole("button", { name: "Jugend" });
    await youth.click();
    await expect(youth).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTitle(/^Training Luftgewehr/)).toHaveCount(0);
    await expect(page.getByTitle(/^Jugendtraining/)).toBeVisible();
    await page.getByRole("button", { name: "Filter zurücksetzen" }).click();
    await expect(youth).toHaveAttribute("aria-pressed", "false");
    await expect(page.getByTitle(/^Training Luftgewehr/)).toBeVisible();

    await page.getByLabel("Termine suchen").fill("Sommerfest");
    await expect(
      page.getByRole("heading", { name: "Keine Termine zu „Sommerfest“ gefunden" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Suche zurücksetzen" }).click();
    await expect(page.getByRole("grid")).toBeVisible();
  });

  test("Termin anlegen, ansehen und löschen", async ({ page, request }) => {
    const seeded = await seedCalendar(request, "Termin Anlegen");
    await openCalendar(page, seeded);

    await page.getByRole("button", { name: "Termin anlegen", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("heading", { name: "Neuer Termin" })).toBeVisible();
    await dialog.getByLabel("Name *").fill("E2E Herbstfest");
    await dialog.getByLabel("Startdatum *").fill("2026-10-24");
    await dialog.getByRole("switch", { name: /Veröffentlicht/ }).click();
    await dialog.getByRole("button", { name: "Erstellen" }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByText("Gespeichert.")).toBeVisible();

    const chip = page.getByTitle(/^E2E Herbstfest, 19:00 bis 21:00 Uhr \(veröffentlicht\)$/);
    await expect(chip).toBeVisible();
    await chip.click();
    await expect(dialog.getByRole("heading", { name: "Termin bearbeiten" })).toBeVisible();
    await expect(dialog.getByLabel("Name *")).toHaveValue("E2E Herbstfest");
    await dialog.getByRole("button", { name: "Löschen" }).click();
    const confirm = page.getByRole("alertdialog");
    await expect(confirm).toContainText("Der Termin „E2E Herbstfest“ wird gelöscht.");
    await confirm.getByRole("button", { name: "Löschen" }).click();
    await expect(page.getByTitle(/^E2E Herbstfest/)).toHaveCount(0);
  });

  test("Archivierter Kalender ist schreibgeschützt", async ({ page, request }) => {
    const seeded = await seedCalendar(request, "Archiv Kalender");
    const headers = await authHeaders(request, seeded.email);
    const archived = await request.post(
      `${API}/api/clubs/${seeded.clubId}/calendars/${seeded.calendarId}/archive`,
      { headers },
    );
    expect(archived.ok()).toBeTruthy();
    await openCalendar(page, seeded);

    await expect(page.getByText("Archiviert, schreibgeschützt").first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Termin anlegen", exact: true })).toHaveCount(0);
    await page.getByTitle(/^Training Luftgewehr/).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("heading", { name: "Termin ansehen" })).toBeVisible();
    await expect(dialog.getByLabel("Name *")).toBeDisabled();
    await expect(dialog.getByRole("button", { name: "Löschen" })).toHaveCount(0);
    await dialog.getByRole("button", { name: "Schließen" }).last().click();

    await page.getByRole("button", { name: "Archivierung aufheben" }).click();
    await expect(
      page.getByText("Kalender ist wieder aktiv. Du kannst Termine bearbeiten."),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Termin anlegen", exact: true })).toBeVisible();
  });

  test("Mobile Breite: kompaktes Raster und Tagesliste", async ({ page, request }) => {
    const seeded = await seedCalendar(request, "Mobil Ansicht");
    await page.setViewportSize({ width: 390, height: 900 });
    await openCalendar(page, seeded);

    const grid = page.getByRole("grid", { name: "Oktober 2026" });
    await expect(grid).toHaveClass(/cc-grid/);
    await expect(page.getByRole("navigation", { name: "Ansicht wechseln" })).toBeHidden();
    await expect(
      page.getByRole("heading", { level: 2, name: "Freitag, 2. Oktober" }),
    ).toBeVisible();

    const day8 = grid.getByRole("button", { name: "8. Oktober, 2 Termine" });
    const box = await day8.boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(44);
    await day8.click();
    await expect(
      page.getByRole("heading", { level: 2, name: "Donnerstag, 8. Oktober" }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Training Luftgewehr" })).toBeVisible();

    const fab = page.locator(".ap-fab");
    await expect(fab).toBeVisible();
    await fab.click();
    await expect(page.getByRole("dialog").getByLabel("Startdatum *")).toHaveValue("2026-10-08");
  });
});
