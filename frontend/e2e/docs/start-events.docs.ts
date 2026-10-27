import { test, expect } from "@playwright/test";
import { LANGS, prepare, shot, signIn, type Lang } from "./shots";
import {
  API,
  PASSWORD,
  authHeaders,
  continueWithEmail,
  createVerifiedUser,
  inviteAndAccept,
  seedClub,
} from "../helpers";
import type { APIRequestContext } from "@playwright/test";

const CLUB = "SV Waldblick";

const EVENTS = [
  { name: "Training Luftgewehr", date: "2026-10-06", timeBegin: "19:00", timeEnd: "21:00" },
  { name: "Jugendtraining", date: "2026-10-08", timeBegin: "17:30", timeEnd: "19:00" },
  {
    name: "Vorstandssitzung",
    date: "2026-10-13",
    timeBegin: "20:00",
    timeEnd: "21:30",
    isDraft: true,
  },
  { name: "Vereinsmeisterschaft", date: "2026-10-17", dateEnd: "2026-10-18", isAllDay: true },
  { name: "Training Luftgewehr", date: "2026-10-20", timeBegin: "19:00", timeEnd: "21:00" },
  { name: "Herbstfest", date: "2026-10-24", timeBegin: "15:00", timeEnd: "22:00" },
  { name: "Schießabend", date: "2026-10-22", timeBegin: "18:00", timeEnd: "20:00" },
  {
    name: "Helferabend Herbstfest",
    date: "2026-10-22",
    timeBegin: "19:30",
    timeEnd: "21:00",
    isDraft: true,
  },
];

/** Admin plus editor in one club; returns the editor's login. */
async function seed(request: APIRequestContext, lang: Lang, role: "admin" | "editor") {
  const adminEmail = await createVerifiedUser(request, "Anna Beispiel");
  const { clubId, calendarId, headers } = await seedClub(request, adminEmail, CLUB);
  await request.patch(`${API}/api/auth/me`, { headers, data: { language: lang } });
  await request.patch(`${API}/api/clubs/${clubId}/calendars/${calendarId}`, {
    headers,
    data: { name: "Jahreskalender" },
  });
  const loc = await request.post(`${API}/api/clubs/${clubId}/locations`, {
    headers,
    data: { name: "Schützenhaus", street: "Waldweg 3", zip: "12345", city: "Musterstadt" },
  });
  const locationId = loc.ok() ? (await loc.json()).id : undefined;
  for (const ev of EVENTS) {
    const res = await request.post(`${API}/api/calendars/${calendarId}/events`, {
      headers,
      data: { isDraft: false, locationId, timeBegin: "19:00", timeEnd: "21:00", ...ev },
    });
    expect(res.ok(), await res.text()).toBeTruthy();
  }
  let email = adminEmail;
  if (role === "editor") {
    email = await createVerifiedUser(request, "Ben Beispiel");
    await inviteAndAccept(request, clubId, headers, email, "editor");
    const h = await authHeaders(request, email);
    await request.patch(`${API}/api/auth/me`, { headers: h, data: { language: lang } });
  }
  return { email, url: `/clubs/${clubId}/calendars/${calendarId}` };
}

for (const lang of LANGS) {
  test.describe(`docs start+events (${lang})`, () => {
    test.use({ locale: lang === "de" ? "de-DE" : "en-US", timezoneId: "Europe/Berlin" });

    test("sign-up-email-step", async ({ page }) => {
      await prepare(page, lang);
      await page.goto("/signup");
      await expect(page.getByRole("button", { name: /^(Weiter|Continue)$/ })).toBeVisible();
      await shot(page, lang, "sign-up-email-step");
    });

    test("set-up-club-step", async ({ page }) => {
      await prepare(page, lang);
      const email = await createVerifiedUser(page.request, "Anna Beispiel");
      await page.request.patch(`${API}/api/auth/me`, {
        headers: await authHeaders(page.request, email),
        data: { language: lang },
      });
      // A user without a club lands on /setup, not /clubs, so signIn() cannot be used.
      await page.goto("/login");
      await continueWithEmail(page, email);
      await page
        .getByLabel(lang === "de" ? /^Passwort \(Pflicht\)/ : /^Password \(required\)/)
        .fill(PASSWORD);
      await page
        .getByRole("button", {
          name: lang === "de" ? "Anmelden" : /^sign in$/i,
          exact: lang === "de",
        })
        .click();
      await page.waitForURL(/\/setup/);
      const input = page.getByLabel(lang === "de" ? /^Name deines Vereins/ : /^Name of your club/i);
      await input.fill(CLUB);
      await expect(input).toHaveValue(CLUB);
      await shot(page, lang, "set-up-club-step");
    });

    test("tour-sidebar", async ({ page }) => {
      await prepare(page, lang);
      const seeded = await seed(page.request, lang, "admin");
      await signIn(page, lang, seeded.email);
      await page.goto(seeded.url);
      await expect(page.getByText("Herbstfest").first()).toBeVisible();
      await shot(page, lang, "tour-sidebar");
    });

    test("tour-mobile-tabbar", async ({ page }) => {
      await prepare(page, lang);
      const seeded = await seed(page.request, lang, "admin");
      await signIn(page, lang, seeded.email);
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(seeded.url);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await page.waitForTimeout(1000);
      await shot(page, lang, "tour-mobile-tabbar");
    });

    test("first-event-form", async ({ page }) => {
      await prepare(page, lang);
      const seeded = await seed(page.request, lang, "editor");
      await signIn(page, lang, seeded.email);
      await page.goto(`${seeded.url}/events/new/form?date=2026-10-30`);
      await page.getByLabel(/^Name/).first().fill("Kegelabend");
      await shot(page, lang, "first-event-form");
    });

    test("views-month-day-panel", async ({ page }) => {
      await prepare(page, lang, 1000);
      const seeded = await seed(page.request, lang, "editor");
      await signIn(page, lang, seeded.email);
      await page.goto(seeded.url);
      await page.locator('[role="grid"] [data-date="2026-10-22"]').first().click();
      await shot(page, lang, "views-month-day-panel");
    });

    test("search-filter-calendar-search", async ({ page }) => {
      await prepare(page, lang);
      const seeded = await seed(page.request, lang, "editor");
      await signIn(page, lang, seeded.email);
      await page.goto(seeded.url);
      await page.getByRole("combobox").first().fill("Herbst");
      await expect(page.getByRole("option").first()).toBeVisible();
      await shot(page, lang, "search-filter-calendar-search");
    });

    test("event-list-overview", async ({ page }) => {
      await prepare(page, lang);
      const seeded = await seed(page.request, lang, "editor");
      await signIn(page, lang, seeded.email);
      await page.goto(`${seeded.url}/events`);
      await expect(page.getByText("Herbstfest").first()).toBeVisible();
      await shot(page, lang, "event-list-overview");
    });
  });
}
