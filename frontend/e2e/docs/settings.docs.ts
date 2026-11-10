import { test, expect, type Page } from "@playwright/test";
import {
  API,
  PASSWORD,
  backendConsole,
  createVerifiedUser,
  inviteAndAccept,
  seedClub,
} from "../helpers";
import { LANGS, prepare, shot, signIn, type Lang } from "./shots";

/** Club with three calendars (one archived), a feed and a few events. */
async function seed(page: Page, lang: Lang) {
  const request = page.request;
  const email = await createVerifiedUser(request, "Max Mustermann");
  const { clubId, calendarId, headers } = await seedClub(request, email, "SV Musterstadt");
  const post = async (path: string, data?: object) => {
    const res = await request.post(`${API}${path}`, { headers, data });
    expect(res.ok(), `${path}: ${await res.text()}`).toBeTruthy();
    return res.status() === 204 ? {} : ((await res.json()) as { id: string });
  };
  const me = await request.patch(`${API}/api/auth/me`, { headers, data: { language: lang } });
  expect(me.ok()).toBeTruthy();
  const rename = await request.patch(`${API}/api/clubs/${clubId}/calendars/${calendarId}`, {
    headers,
    data: { name: "Schießbetrieb" },
  });
  expect(rename.ok()).toBeTruthy();
  for (const [name, date] of [
    ["Training Luftgewehr", "2026-10-06"],
    ["Vorstandssitzung", "2026-10-13"],
    ["Herbstfest", "2026-10-24"],
  ])
    await post(`/api/calendars/${calendarId}/events`, {
      name,
      date,
      isDraft: false,
      timeBegin: "19:00",
      timeEnd: "21:00",
    });
  const youth = (await post(`/api/clubs/${clubId}/calendars`, { name: "Jugendabteilung" })) as {
    id: string;
  };
  await post(`/api/calendars/${youth.id}/events`, {
    name: "Jugendtraining",
    date: "2026-10-15",
    isDraft: false,
    timeBegin: "17:30",
    timeEnd: "19:00",
  });
  const old = (await post(`/api/clubs/${clubId}/calendars`, { name: "Saison 2025" })) as {
    id: string;
  };
  await post(`/api/clubs/${clubId}/calendars/${old.id}/archive`);
  await post(`/api/clubs/${clubId}/feeds`, {
    name: "Alle Termine",
    visibility: "PUBLIC",
    calendarIds: [calendarId],
  });
  // Fixed fake members; the account is created once, the second language reuses it.
  for (const [name, memberEmail, role] of [
    ["Anna Beispiel", "anna.beispiel@example.com", "editor"],
    ["Ben Beispiel", "ben.beispiel@example.com", "viewer"],
  ] as const) {
    const known = await request.post(`${API}/api/auth/register`, {
      data: { name, email: memberEmail, password: PASSWORD, language: lang },
    });
    if (known.ok()) backendConsole("app:user:verify", memberEmail);
    await inviteAndAccept(request, clubId, headers, memberEmail, role);
  }
  return { email, clubId, calendarId };
}

for (const lang of LANGS) {
  test.describe(`docs screenshots settings (${lang})`, () => {
    test.use({ locale: lang === "de" ? "de-DE" : "en-US", timezoneId: "Europe/Berlin" });

    test("settings", async ({ page }) => {
      await prepare(page, lang);
      const s = await seed(page, lang);
      await signIn(page, lang, s.email);

      await page.goto(`/clubs/${s.clubId}?tab=calendars`);
      await expect(page.getByText("Jugendabteilung").first()).toBeVisible();
      await expect(page.getByText("Saison 2025").first()).toBeVisible();
      // The archive date is the real server date: pin it to a fixed one.
      await page.evaluate(
        (fixed) => {
          const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
          for (let n = w.nextNode(); n; n = w.nextNode()) {
            if (/Archiv/.test(n.textContent ?? "")) {
              n.textContent = (n.textContent ?? "").replace(/\d{1,2}[./]\d{1,2}[./]\d{4}/, fixed);
            }
          }
        },
        lang === "de" ? "01.10.2026" : "10/01/2026",
      );
      await shot(page, lang, "calendars-list");

      await page.goto(`/clubs/${s.clubId}/calendars/${s.calendarId}/settings`);
      await expect(page.getByRole("switch")).toBeVisible();
      await expect(page.getByText(/\d\d:\d\d/).first()).toBeVisible();
      await shot(page, lang, "calendar-settings-general");

      await page.goto(`/clubs/${s.clubId}?tab=members`);
      await expect(page.getByText("anna.beispiel@example.com").first()).toBeVisible();
      await expect(page.getByText("ben.beispiel@example.com").first()).toBeVisible();
      // The admin's address is random per run: show a fixed fake one.
      await page.evaluate(() => {
        const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        for (let n = w.nextNode(); n; n = w.nextNode()) {
          if (/^e2e-.*@example\.com$/.test((n.textContent ?? "").trim()))
            n.textContent = "max.mustermann@example.com";
        }
      });
      await shot(page, lang, "club-members-list");

      await page.setViewportSize({ width: 1280, height: 1000 });
      await page.goto(`/clubs/${s.clubId}?tab=general`);
      await expect(page.getByRole("radio").first()).toBeVisible();
      await shot(page, lang, "club-feed-signup");
      await page.setViewportSize({ width: 1280, height: 800 });
      await page.goto(`/clubs/${s.clubId}?tab=general`);
      const del = page.getByRole("button", {
        name: lang === "de" ? "Verein löschen" : "Delete club",
      });
      await expect(del).toBeVisible();
      await expect(async () => {
        await del.click();
        await expect(page.getByRole("alertdialog")).toBeVisible({ timeout: 2000 });
      }).toPass({ timeout: 15000 });
      await shot(page, lang, "delete-club-confirm");
    });
  });
}
