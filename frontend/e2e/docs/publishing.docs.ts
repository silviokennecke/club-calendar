import { test, expect, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { API, createVerifiedUser, resourceUrl, seedClub } from "../helpers";
import { LANGS, prepare, shot, signIn, type Lang } from "./shots";

const EVENTS = [
  { name: "Training Luftgewehr", date: "2026-10-06", timeBegin: "19:00", timeEnd: "21:00" },
  { name: "Jugendtraining", date: "2026-10-08", timeBegin: "17:30", timeEnd: "19:00" },
  { name: "Vorstandssitzung", date: "2026-10-13", timeBegin: "20:00", timeEnd: "21:30" },
  { name: "Vereinsmeisterschaft", date: "2026-10-17", dateEnd: "2026-10-18", isAllDay: true },
  { name: "Training Luftgewehr", date: "2026-10-20", timeBegin: "19:00", timeEnd: "21:00" },
  { name: "Herbstfest", date: "2026-10-24", timeBegin: "15:00", timeEnd: "22:00" },
];

/** Inserts a holiday calendar straight into the e2e database (the backend must not fetch hosts). */
function insertHoliday(calendarId: string, name: string, entries: [string, string, string?][]) {
  const id = randomUUID();
  const now = "2026-10-01 08:00:00";
  const rows = entries
    .map(
      ([n, d, e]) =>
        `('${randomUUID()}','${randomUUID()}@docs','${n}','${d}',${e ? `'${e}'` : "NULL"},'${id}','${now}')`,
    )
    .join(",");
  const sql =
    `INSERT INTO holiday_calendar (id,name,url,last_fetched_at,calendar_id,updated_at) VALUES ('${id}','${name}','https://example.org/feiertage.ics','${now}','${calendarId}','${now}');` +
    `INSERT INTO holiday_event (id,uid,name,date,date_end,holiday_calendar_id,updated_at) VALUES ${rows};`;
  execFileSync("docker", [
    "exec",
    "cc-verify-mysql",
    "mysql",
    "-uroot",
    "-proot",
    "club_calendar_e2e",
    "-e",
    sql,
  ]);
}

async function seed(page: Page, lang: Lang) {
  const request = page.request;
  const email = await createVerifiedUser(request, "Max Mustermann");
  const { clubId, calendarId, headers } = await seedClub(request, email, "SV Musterstadt");
  const me = await request.patch(`${API}/api/auth/me`, { headers, data: { language: lang } });
  expect(me.ok()).toBeTruthy();
  const rename = await request.patch(`${API}/api/clubs/${clubId}/calendars/${calendarId}`, {
    headers,
    data: { name: "Schießbetrieb 2026" },
  });
  expect(rename.ok()).toBeTruthy();
  for (const name of ["Schüler", "Jugend", "Erwachsene"]) {
    const res = await request.post(resourceUrl(clubId, calendarId, "target-groups"), {
      headers,
      data: { name },
    });
    expect(res.ok(), await res.text()).toBeTruthy();
  }
  for (const ev of EVENTS) {
    const res = await request.post(resourceUrl(clubId, calendarId, "events"), {
      headers,
      data: { isDraft: false, timeBegin: "19:00", timeEnd: "21:00", ...ev },
    });
    expect(res.ok(), await res.text()).toBeTruthy();
  }
  insertHoliday(calendarId, "Feiertage und Ferien Bayern", [
    ["Tag der Deutschen Einheit", "2026-10-03"],
    ["Herbstferien", "2026-10-26", "2026-10-30"],
  ]);
  return { email, clubId, calendarId, headers };
}

for (const lang of LANGS) {
  test.describe(`docs screenshots publishing (${lang})`, () => {
    test.setTimeout(90000);
    test.use({ locale: lang === "de" ? "de-DE" : "en-US", timezoneId: "Europe/Berlin" });

    test("create-feed-form", async ({ page }) => {
      await prepare(page, lang, 1250);
      const s = await seed(page, lang);
      await signIn(page, lang, s.email);
      await page.goto(`/clubs/${s.clubId}/settings/feeds/new`);
      const name = page.getByLabel(/^Name/).first();
      await expect(name).toBeVisible();
      await name.fill(lang === "de" ? "Öffentlicher Kalender" : "Public calendar");
      await page.getByRole("button", { name: "Jugend" }).click();
      await shot(page, lang, "create-feed-form");
    });

    test("public-view-month", async ({ page }) => {
      await prepare(page, lang, 1150);
      const s = await seed(page, lang);
      const res = await page.request.post(`${API}/api/clubs/${s.clubId}/feeds`, {
        headers: s.headers,
        data: { name: "Schießbetrieb 2026", visibility: "PUBLIC", calendarIds: [s.calendarId] },
      });
      expect(res.ok(), await res.text()).toBeTruthy();
      const feed = (await res.json()) as { id: string };
      await page.goto(`/feed/${feed.id}`);
      await expect(page.getByText("Herbstfest").first()).toBeVisible();
      await shot(page, lang, "public-view-month");
    });
  });
}
