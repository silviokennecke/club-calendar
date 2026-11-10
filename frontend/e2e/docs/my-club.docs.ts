import { test, expect, type Page } from "@playwright/test";
import { API, PASSWORD, authHeaders, backendConsole, inviteAndAccept, seedClub } from "../helpers";
import { LANGS, prepare, shot, signIn, type Lang } from "./shots";

const MEMBER_EMAIL = "anna.beispiel@example.com";

const EVENTS: [string, string, string, string, string[]][] = [
  ["Training Luftgewehr", "2026-10-06", "19:00", "21:00", ["Erwachsene"]],
  ["Jugendtraining", "2026-10-08", "17:30", "19:00", ["Jugend"]],
  ["Schülertreff", "2026-10-10", "15:00", "16:30", ["Schüler"]],
  ["Vorstandssitzung", "2026-10-13", "20:00", "21:30", ["Erwachsene"]],
  ["Jugendtraining", "2026-10-15", "17:30", "19:00", ["Jugend"]],
  ["Training Luftgewehr", "2026-10-20", "19:00", "21:00", ["Erwachsene"]],
  ["Herbstfest", "2026-10-24", "15:00", "22:00", ["Schüler", "Jugend", "Erwachsene"]],
];

/** Club with Gruppen, events and a feed; a plain member (fixed fake address) who subscribed to Jugend. */
async function seed(page: Page, lang: Lang) {
  const request = page.request;
  const admin = `e2e-docs-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;
  const reg = await request.post(`${API}/api/auth/register`, {
    data: { name: "Max Mustermann", email: admin, password: PASSWORD, language: lang },
  });
  expect(reg.ok()).toBeTruthy();
  backendConsole("app:user:verify", admin);
  const { clubId, calendarId, headers } = await seedClub(request, admin, "SV Musterstadt");
  const post = async (path: string, data: object) => {
    const res = await request.post(`${API}${path}`, { headers, data });
    expect(res.ok(), `${path}: ${await res.text()}`).toBeTruthy();
    return (await res.json()) as { id: string };
  };
  const rename = await request.patch(`${API}/api/clubs/${clubId}/calendars/${calendarId}`, {
    headers,
    data: { name: "Schießbetrieb 2026" },
  });
  expect(rename.ok()).toBeTruthy();
  const groups: Record<string, string> = {};
  for (const name of ["Schüler", "Jugend", "Erwachsene"])
    groups[name] = (await post(`/api/clubs/${clubId}/target-groups`, { name })).id;
  for (const [name, date, timeBegin, timeEnd, g] of EVENTS)
    await post(`/api/calendars/${calendarId}/events`, {
      name,
      date,
      timeBegin,
      timeEnd,
      isDraft: false,
      targetGroupIds: g.map((n) => groups[n]),
    });
  const feed = await post(`/api/clubs/${clubId}/feeds`, {
    name: "Schießbetrieb 2026",
    visibility: "CLUB",
    calendarIds: [calendarId],
  });

  // The member account is created once; the second language reuses it.
  const known = await request.post(`${API}/api/auth/register`, {
    data: { name: "Anna Beispiel", email: MEMBER_EMAIL, password: PASSWORD, language: lang },
  });
  if (known.ok()) backendConsole("app:user:verify", MEMBER_EMAIL);
  const memberHeaders = await authHeaders(request, MEMBER_EMAIL);
  const lng = await request.patch(`${API}/api/auth/me`, {
    headers: memberHeaders,
    data: { language: lang },
  });
  expect(lng.ok()).toBeTruthy();
  await inviteAndAccept(request, clubId, headers, MEMBER_EMAIL, "member" as never);
  const sub = await request.put(`${API}/api/clubs/${clubId}/my-subscription`, {
    headers: memberHeaders,
    data: { feedIds: [feed.id], targetGroupIds: [groups["Jugend"]] },
  });
  expect(sub.ok(), await sub.text()).toBeTruthy();
  return { clubId };
}

for (const lang of LANGS) {
  test.describe(`docs screenshots my club (${lang})`, () => {
    test.setTimeout(90000);
    test.use({ locale: lang === "de" ? "de-DE" : "en-US", timezoneId: "Europe/Berlin" });

    test("my-club", async ({ page }) => {
      await prepare(page, lang, 900);
      const s = await seed(page, lang);
      await signIn(page, lang, MEMBER_EMAIL);

      await page.goto(`/clubs/${s.clubId}/me`);
      await expect(page.getByText("Jugendtraining").first()).toBeVisible();
      await shot(page, lang, "my-club-calendar");

      await page.setViewportSize({ width: 1280, height: 1000 });
      await page.goto(`/clubs/${s.clubId}/me?tab=subscription`);
      const link = page.locator("#mysub-address");
      await expect(link).toBeVisible();
      // The address carries a random id and secret: show a fixed fake one.
      await link.evaluate((el) => {
        (el as HTMLInputElement).value =
          "https://kalender.example.org/api/feed/me/0000/ics?secret=BEISPIEL";
      });
      await shot(page, lang, "my-club-subscription");
    });
  });
}
