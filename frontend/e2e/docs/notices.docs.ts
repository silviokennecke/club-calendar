import { test, expect } from "@playwright/test";
import { API, createVerifiedUser, seedClub } from "../helpers";
import { LANGS, prepare, shot, signIn, type Lang } from "./shots";

const NOTICES = [
  { name: "Schießstand geschlossen", date: "2026-10-12", dateEnd: "2026-10-14" },
  { name: "Herbstferien: kein Training", date: "2026-10-26", dateEnd: "2026-10-30" },
];
const EVENTS = [
  { name: "Training Luftgewehr", date: "2026-10-13", timeBegin: "19:00", timeEnd: "21:00" },
  { name: "Herbstfest", date: "2026-10-24", timeBegin: "15:00", timeEnd: "22:00" },
];

async function seed(request: import("@playwright/test").APIRequestContext, lang: Lang) {
  const email = await createVerifiedUser(request, "Anna Beispiel");
  const { clubId, calendarId, headers } = await seedClub(request, email, "SV Waldblick");
  await request.patch(`${API}/api/auth/me`, { headers, data: { language: lang } });
  await request.patch(`${API}/api/clubs/${clubId}/calendars/${calendarId}`, {
    headers,
    data: { name: "Jahreskalender" },
  });
  const items = [
    ...EVENTS.map((e) => ({ ...e, isDraft: false })),
    ...NOTICES.map((n, i) => ({ ...n, type: "notice", isDraft: i === 1 })),
  ];
  for (const data of items) {
    const res = await request.post(`${API}/api/calendars/${calendarId}/events`, { headers, data });
    expect(res.ok(), await res.text()).toBeTruthy();
  }
  return { email, url: `/clubs/${clubId}/calendars/${calendarId}` };
}

for (const lang of LANGS) {
  test.describe(`docs notices (${lang})`, () => {
    test.use({ locale: lang === "de" ? "de-DE" : "en-US", timezoneId: "Europe/Berlin" });
    const de = lang === "de";

    test("notice-split-button", async ({ page }) => {
      await prepare(page, lang);
      const s = await seed(page.request, lang);
      await signIn(page, lang, s.email);
      await page.goto(`${s.url}/events`);
      await page
        .getByRole("button", {
          name: de ? "Weitere Wege, Termine anzulegen" : "More ways to create events",
        })
        .click();
      await expect(
        page.getByRole("button", { name: de ? /Hinweis anlegen/ : /Create notice/ }),
      ).toBeVisible();
      await shot(page, lang, "notice-split-button");
    });

    test("notice-form", async ({ page }) => {
      await prepare(page, lang);
      const s = await seed(page.request, lang);
      await signIn(page, lang, s.email);
      await page.goto(`${s.url}/events/new/form?type=notice&date=2026-10-22`);
      const dialog = page.getByRole("dialog", { name: de ? "Neuer Hinweis" : "New notice" });
      await expect(dialog).toBeVisible();
      await shot(page, lang, "notice-form");
    });

    test("notice-month", async ({ page }) => {
      await prepare(page, lang);
      const s = await seed(page.request, lang);
      await signIn(page, lang, s.email);
      await page.goto(`${s.url}?view=month&date=2026-10-12`);
      await expect(page.getByText("Schießstand geschlossen").first()).toBeVisible();
      await shot(page, lang, "notice-month");
    });

    test("notice-list", async ({ page }) => {
      await prepare(page, lang);
      const s = await seed(page.request, lang);
      await signIn(page, lang, s.email);
      await page.goto(`${s.url}/events?type=notice`);
      await expect(page.getByText("Schießstand geschlossen").first()).toBeVisible();
      await shot(page, lang, "notice-list");
    });
  });
}
