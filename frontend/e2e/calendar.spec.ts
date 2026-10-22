import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
import { API, authHeaders, createVerifiedUser, login, seedClub } from "./helpers";

async function loginAdmin(page: Page) {
  await page.goto("/login");
  await page.getByLabel(/email/i).fill("admin@example.com");
  await page.getByLabel(/^Password \(required\)/).fill("password123");
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
    await page.getByRole("link", { name: /^(properties|besonderheiten)$/i }).click();
    await page.waitForURL("**/settings/properties");
  });

  test("clicking Create event opens the create choice", async ({ page }) => {
    await goToCalendar(page);
    // Split button in the page head (the empty state may offer the same action).
    await page
      .getByRole("button", { name: /^create event$/i })
      .first()
      .click();
    await page.waitForURL("**/events/new");
    await expect(page.getByRole("heading", { level: 2, name: "Create event" })).toBeVisible();
    await expect(page.getByRole("link", { name: /New event/ })).toBeVisible();
    await expect(page.getByRole("link", { name: /From template/ })).toBeVisible();
  });

  test("can create and see a new event", async ({ page }) => {
    await goToCalendar(page);
    // Split button in the page head (the empty state may offer the same action).
    await page
      .getByRole("button", { name: /^create event$/i })
      .first()
      .click();

    await page.getByRole("link", { name: /New event/ }).click();
    await page.getByLabel(/^Name/).fill("E2E Test Event");
    await page.getByLabel(/^Start date/).fill("2026-09-15");
    await page.getByRole("button", { name: "Published", exact: true }).click();
    await page.getByRole("button", { name: "Save event" }).click();
    // Back on the calendar page.
    await page.waitForURL(/\/calendars\/[^/]+$/, { timeout: 8000 });
    await expect(page.getByText("Event saved.")).toBeVisible();
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
        await request.post(`${API}/api/clubs/${clubId}/target-groups`, {
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

  test("Filter nach Gruppe und Suche", async ({ page, request }) => {
    const seeded = await seedCalendar(request, "Filter Suche");
    await openCalendar(page, seeded);
    await expect(page.getByTitle(/^Training Luftgewehr/)).toBeVisible();

    const chips = page.getByRole("group", { name: "Nach Gruppe filtern" });
    const youth = chips.getByRole("button", { name: "Jugend" });
    await youth.click();
    await expect(youth).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTitle(/^Training Luftgewehr/)).toHaveCount(0);
    await expect(page.getByTitle(/^Jugendtraining/)).toBeVisible();
    await page.getByRole("button", { name: "Filter zurücksetzen" }).click();
    await expect(youth).toHaveAttribute("aria-pressed", "false");
    await expect(page.getByTitle(/^Training Luftgewehr/)).toBeVisible();

    const search = page.getByRole("combobox", { name: "Termine suchen" });
    await search.fill("Sommerfest");
    await expect(page.getByText("Keine Termine zu „Sommerfest“ gefunden")).toBeVisible();
    await search.fill("Training Luftgewehr");
    await page
      .getByRole("option", { name: /Training Luftgewehr/ })
      .first()
      .click();
    await expect(page.getByRole("heading", { level: 2, name: "Termin bearbeiten" })).toBeVisible();
  });

  test("Termin anlegen, ansehen und löschen", async ({ page, request }) => {
    const seeded = await seedCalendar(request, "Termin Anlegen");
    await openCalendar(page, seeded);

    await page.getByRole("button", { name: "Termin anlegen", exact: true }).click();
    await expect(page.getByRole("heading", { level: 2, name: "Termin anlegen" })).toBeVisible();
    await page.getByRole("link", { name: /Neuer Termin/ }).click();
    await expect(page.getByRole("heading", { level: 2, name: "Neuer Termin" })).toBeVisible();
    await page.getByLabel("Name (Pflicht)").fill("E2E Herbstfest");
    await page.getByLabel("Startdatum (Pflicht)").fill("2026-10-24");
    await page.getByRole("button", { name: "Veröffentlicht", exact: true }).click();
    await page.getByRole("button", { name: "Termin speichern" }).click();
    await expect(page.getByText("Termin gespeichert.")).toBeVisible();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Oktober 2026");

    const chip = page.getByTitle(/^E2E Herbstfest, 19:00 bis 21:00 Uhr \(veröffentlicht\)$/);
    await expect(chip).toBeVisible();
    await chip.click();
    await expect(page.getByRole("heading", { level: 2, name: "Termin bearbeiten" })).toBeVisible();
    await expect(page.getByLabel("Name (Pflicht)")).toHaveValue("E2E Herbstfest");
    await page.getByRole("button", { name: "Termin löschen" }).click();
    const confirm = page.getByRole("alertdialog");
    await expect(confirm).toContainText("Termin „E2E Herbstfest“ löschen?");
    await expect(confirm).toContainText("Der Termin am Sa 24.10.2026 wird dauerhaft entfernt.");
    await confirm.getByRole("button", { name: "Termin löschen" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Oktober 2026");
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
    await expect(page.getByRole("link", { name: "Termine exportieren" })).toBeVisible();
    await page.getByTitle(/^Training Luftgewehr/).click();
    await expect(page.getByRole("heading", { level: 2, name: "Termin ansehen" })).toBeVisible();
    await expect(page.getByLabel("Name (Pflicht)")).toBeDisabled();
    await expect(page.getByRole("button", { name: "Termin löschen" })).toHaveCount(0);
    await page.getByRole("button", { name: "Schließen", exact: true }).last().click();

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
    await page.getByRole("link", { name: /Neuer Termin/ }).click();
    await expect(page.getByLabel("Startdatum (Pflicht)")).toHaveValue("2026-10-08");
  });
});

// ——— Event dialogs above the calendar (routed modals) ———

test.describe("Termin-Dialoge", () => {
  test.use({ locale: "de-DE", timezoneId: "Europe/Berlin" });

  test.beforeEach(async ({ page }) => {
    await page.clock.setFixedTime(new Date("2026-10-02T10:00:00+02:00"));
  });

  const focusInDialog = (page: Page) =>
    page.evaluate(() => {
      const dialog = document.querySelector('[role="dialog"]');
      return !!dialog && dialog.contains(document.activeElement);
    });

  test("Anlegen am Tag: Datum vorbelegt, Kalender bleibt inert im Hintergrund, Fokus zurück", async ({
    page,
    request,
  }) => {
    const seeded = await seedCalendar(request, "Dialog Tag");
    await openCalendar(page, seeded, "?date=2026-10-14");
    const grid = page.getByRole("grid", { name: "Oktober 2026" });
    await grid.getByRole("button", { name: /^14\. Oktober/ }).click();
    const create = page.getByRole("button", { name: "Termin an diesem Tag anlegen" });
    await create.click();
    await page.getByRole("link", { name: /Neuer Termin/ }).click();

    const dialog = page.getByRole("dialog", { name: "Neuer Termin" });
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAttribute("aria-modal", "true");
    await expect(page).toHaveURL(/\/events\/new\/form\?date=2026-10-14$/);
    await expect(
      dialog.getByText("Datum aus dem Kalender übernommen: Mi 14.10.2026."),
    ).toBeVisible();
    await expect(page.getByLabel("Startdatum (Pflicht)")).toHaveValue("2026-10-14");
    await expect(page.getByLabel("Name (Pflicht)")).toBeFocused();

    // The calendar stays visible below, but inert and hidden from assistive technology.
    await expect(page.locator("[inert] .cc-cal, [inert] [role=grid]").first()).toBeAttached();
    await expect(page.getByRole("grid")).toHaveCount(0);
    expect(
      await page.evaluate(
        () =>
          getComputedStyle(document.body).overflow === "hidden" ||
          document.documentElement.style.overflow === "hidden" ||
          getComputedStyle(document.documentElement).overflow === "hidden",
      ),
    ).toBe(true);

    // Focus trap: Tab and Shift+Tab stay in the dialog.
    for (let i = 0; i < 25; i++) {
      await page.keyboard.press("Tab");
      expect(await focusInDialog(page)).toBe(true);
    }
    for (let i = 0; i < 5; i++) {
      await page.keyboard.press("Shift+Tab");
      expect(await focusInDialog(page)).toBe(true);
    }

    // Escape without changes closes; focus returns to the trigger, the calendar is usable again.
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(page).toHaveURL(/\/calendars\/[^/]+\?date=2026-10-14$/);
    await expect(create).toBeFocused();
    await expect(page.getByRole("grid", { name: "Oktober 2026" })).toBeVisible();
  });

  test("Speichern schließt den Dialog und fokussiert den neuen Termin", async ({
    page,
    request,
  }) => {
    const seeded = await seedCalendar(request, "Dialog Speichern");
    await openCalendar(page, seeded, "?date=2026-10-14");
    await page
      .getByRole("grid", { name: "Oktober 2026" })
      .getByRole("button", { name: /^14\. Oktober/ })
      .click();
    await page.getByRole("button", { name: "Termin an diesem Tag anlegen" }).click();
    await page.getByRole("link", { name: /Neuer Termin/ }).click();
    await page.getByLabel("Name (Pflicht)").fill("Dialog Herbstfest");
    await page.getByRole("button", { name: "Veröffentlicht", exact: true }).click();
    await page.getByRole("button", { name: "Termin speichern" }).click();
    await expect(page.getByText("Termin gespeichert.")).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page).toHaveURL(/\/calendars\/[^/]+\?date=2026-10-14$/);
    const chip = page.getByTitle(/^Dialog Herbstfest/).first();
    await expect(chip).toBeVisible();
    await expect(page.locator("[data-event-id]:focus")).toContainText("Dialog Herbstfest");
  });

  test("Zurück im Browser schließt; Schritt zurück im Dialog; Deep-Link zeigt den Monat", async ({
    page,
    request,
  }) => {
    const seeded = await seedCalendar(request, "Dialog Zurueck");
    await openCalendar(page, seeded);

    // Chip opens the edit dialog above the calendar; the browser's back button closes it.
    await page.getByTitle(/^Training Luftgewehr/).click();
    const edit = page.getByRole("dialog", { name: "Termin bearbeiten" });
    await expect(edit).toBeVisible();
    await expect(edit).toContainText("Dialog Zurueck Verein Termine");
    await expect(edit.getByText("Veröffentlicht").first()).toBeVisible();
    await expect(edit.getByText("Änderungen sind sofort in den Feeds sichtbar.")).toBeVisible();
    await expect(edit.getByRole("button", { name: "Termin löschen" })).toBeVisible();
    const eventUrl = page.url();
    await page.goBack();
    await expect(edit).toHaveCount(0);
    await expect(page).toHaveURL(new RegExp(`${seeded.url}$`));

    // Steps replace each other: choice -> template picker -> back -> choice; back closes.
    await page.getByRole("button", { name: "Termin anlegen", exact: true }).click();
    const create = page.getByRole("dialog", { name: "Termin anlegen" });
    await create.getByRole("link", { name: /Aus Vorlage/ }).click();
    await expect(page.getByRole("dialog", { name: "Vorlage wählen" })).toBeVisible();
    await page.getByRole("link", { name: "Zurück" }).click();
    await expect(create).toBeVisible();
    await expect(create.getByRole("heading", { level: 2 })).toBeFocused();
    await page.goBack();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page).toHaveURL(new RegExp(`${seeded.url}$`));

    // A deep link opens the dialog above the calendar at the event's month.
    await page.goto(eventUrl.replace(/\?.*$/, ""));
    await expect(page.getByRole("dialog", { name: "Termin bearbeiten" })).toBeVisible();
    await expect(page.locator("[inert] h1")).toHaveText("Oktober 2026");
    await page.getByRole("button", { name: "Schließen, Änderungen verwerfen" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page).toHaveURL(/\?date=2026-10-08$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Oktober 2026");
  });

  test("Archiv: Termin schreibgeschützt im Dialog, Anlegen zeigt den Hinweis", async ({
    page,
    request,
  }) => {
    const seeded = await seedCalendar(request, "Dialog Archiv");
    const headers = await authHeaders(request, seeded.email);
    const res = await request.post(
      `${API}/api/clubs/${seeded.clubId}/calendars/${seeded.calendarId}/archive`,
      { headers },
    );
    expect(res.ok()).toBeTruthy();
    await openCalendar(page, seeded);

    await page.getByTitle(/^Training Luftgewehr/).click();
    const view = page.getByRole("dialog", { name: "Termin ansehen" });
    await expect(view).toBeVisible();
    await expect(view.getByRole("heading", { level: 2, name: "Termin ansehen" })).toBeFocused();
    await expect(view.getByLabel("Name (Pflicht)")).toBeDisabled();
    await expect(view.getByRole("button", { name: "Termin speichern" })).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(view).toHaveCount(0);

    await page.goto(`${seeded.url}/events/new/form?date=2026-10-20`);
    const notice = page.getByRole("dialog", { name: "Kalender archiviert" });
    await expect(notice).toBeVisible();
    await expect(notice.getByLabel("Name (Pflicht)")).toHaveCount(0);
    await notice.getByRole("button", { name: "Schließen", exact: true }).last().click();
    await expect(page).toHaveURL(/\?date=2026-10-20$/);
  });

  test("Mobil: Bottom-Sheet, Tap-Ziele, Kontrast hell und dunkel", async ({ page, request }) => {
    const seeded = await seedCalendar(request, "Dialog Mobil");
    await page.setViewportSize({ width: 390, height: 844 });
    // Reduced motion: the sheet appears without sliding in.
    await page.emulateMedia({ reducedMotion: "reduce" });
    await openCalendar(page, seeded);
    await page.locator(".ap-fab").click();
    const sheet = page.getByRole("dialog", { name: "Termin anlegen" });
    await expect(sheet).toBeVisible();
    const box = (await sheet.boundingBox())!;
    expect(Math.round(box.width)).toBe(390);
    expect(Math.round(box.y + box.height)).toBe(844);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    const close = (await sheet.getByRole("button", { name: "Schließen" }).boundingBox())!;
    expect(close.height).toBeGreaterThanOrEqual(44);
    expect(close.width).toBeGreaterThanOrEqual(44);

    await sheet.getByRole("link", { name: /Neuer Termin/ }).click();
    const form = page.getByRole("dialog", { name: "Neuer Termin" });
    // Long form: the dialog scrolls, head reachable, footer sticks to the bottom.
    const scrolls = await form.evaluate((el) => el.scrollHeight > el.clientHeight);
    expect(scrolls).toBe(true);
    const save = page.getByRole("button", { name: "Termin speichern" });
    await expect(save).toBeInViewport();
    const saveBox = (await save.boundingBox())!;
    expect(saveBox.height).toBeGreaterThanOrEqual(44);

    // Text and surface contrast of the dialog in light and dark mode (WCAG AA 4.5:1).
    const contrast = () =>
      form.evaluate((el) => {
        const rgb = (c: string) => (c.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
        const lum = (c: string) => {
          const [r, g, b] = rgb(c).map((v) => {
            const s = v / 255;
            return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
          });
          return 0.2126 * r + 0.7152 * g + 0.0722 * b;
        };
        const style = getComputedStyle(el);
        const h1 = getComputedStyle(el.querySelector("h2")!);
        const [a, b] = [lum(h1.color), lum(style.backgroundColor)].sort((x, y) => y - x);
        return (a + 0.05) / (b + 0.05);
      });
    expect(await contrast()).toBeGreaterThanOrEqual(4.5);
    await page.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));
    expect(await contrast()).toBeGreaterThanOrEqual(4.5);
  });
});
