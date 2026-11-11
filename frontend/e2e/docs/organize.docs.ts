import { test, expect, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { API, createVerifiedUser, resourceUrl, seedClub } from "../helpers";
import { LANGS, prepare, shot, signIn, type Lang } from "./shots";

const locales = Object.fromEntries(
  LANGS.map((l) => [
    l,
    JSON.parse(
      readFileSync(fileURLToPath(new URL(`../../src/locales/${l}.json`, import.meta.url)), "utf-8"),
    ),
  ]),
);

/** Looks up a UI string of the locale file (`a.b.c`). */
function t(lang: Lang, key: string): string {
  const v = key
    .split(".")
    .reduce((o: unknown, k) => (o as Record<string, unknown> | undefined)?.[k], locales[lang]);
  if (typeof v !== "string") throw new Error(`missing i18n key ${key}`);
  return v;
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

interface Seed {
  email: string;
  clubId: string;
  calendarId: string;
  headers: Record<string, string>;
  base: string;
}

/** Sports club with locations, groups, properties, features, one template and a few events. */
async function seed(page: Page, lang: Lang): Promise<Seed> {
  const request = page.request;
  const email = await createVerifiedUser(request, "Max Mustermann");
  const { clubId, calendarId, headers } = await seedClub(
    request,
    email,
    "Schützenverein Musterstadt",
  );
  const me = await request.patch(`${API}/api/auth/me`, { headers, data: { language: lang } });
  expect(me.ok()).toBeTruthy();
  const post = async (path: string, data: object) => {
    const res = await request.post(resourceUrl(clubId, calendarId, path), { headers, data });
    expect(res.ok(), `${path}: ${await res.text()}`).toBeTruthy();
    return (await res.json()) as { id: string };
  };
  const youth = (await post("target-groups", { name: "Jugend" })).id;
  const adults = (await post("target-groups", { name: "Erwachsene" })).id;
  const place = (
    await post("locations", {
      name: "Schützenhaus Waldblick",
      street: "Waldstraße 12",
      postalCode: "12345",
      city: "Musterstadt",
    })
  ).id;
  await post("locations", {
    name: "Gasthof Zur Linde",
    street: "Marktplatz 5",
    city: "Musterstadt",
  });
  await post("properties", { name: "Schützentracht", icon: "👔" });
  await post("properties", { name: "Barrierefrei", icon: "♿" });
  await post("properties", { name: "Draußen", icon: "🌳" });
  await post("properties", { name: "Mit Verpflegung", icon: "🍽️" });
  await post("features", { name: "Bonusschießen" });
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
      date: "2026-10-06",
      timeBegin: "19:00",
      timeEnd: "21:00",
      locationId: place,
      targetGroupIds: [adults],
      isDraft: false,
    },
    {
      name: "Jugendtraining",
      date: "2026-10-08",
      timeBegin: "17:30",
      timeEnd: "19:00",
      locationId: place,
      targetGroupIds: [youth],
      isDraft: true,
    },
    {
      name: "Vorstandssitzung",
      date: "2026-10-13",
      timeBegin: "20:00",
      timeEnd: "21:30",
      isDraft: true,
    },
    {
      name: "Vereinsmeisterschaft",
      date: "2026-10-17",
      dateEnd: "2026-10-18",
      isAllDay: true,
      isDraft: true,
    },
    {
      name: "Training Luftgewehr",
      date: "2026-10-20",
      timeBegin: "19:00",
      timeEnd: "21:00",
      locationId: place,
      targetGroupIds: [adults],
      isDraft: false,
    },
    { name: "Herbstfest", date: "2026-10-24", timeBegin: "15:00", timeEnd: "22:00", isDraft: true },
  ];
  for (const ev of events) {
    await post("events", { timeBegin: "19:00", timeEnd: "21:00", ...ev });
  }
  return { email, clubId, calendarId, headers, base: `/clubs/${clubId}/calendars/${calendarId}` };
}

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
    `INSERT INTO holiday_calendar (id,name,url,last_fetched_at,calendar_id,updated_at) VALUES ('${id}','${name}','https://example.org/schulferien.ics','2026-10-01 08:00:00','${calendarId}','${now}');` +
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

const ICS = [
  "BEGIN:VCALENDAR",
  "VERSION:2.0",
  "PRODID:-//docs//DE",
  ...[
    ["a1", "Training Luftgewehr", "20261027T190000", "20261027T210000", "Schützenhaus Waldblick"],
    ["a2", "Training Luftgewehr", "20261103T190000", "20261103T210000", "Schützenhaus Waldblick"],
    ["a3", "Training Luftgewehr", "20261110T190000", "20261110T210000", "Schützenhaus Waldblick"],
    ["a4", "Training Luftgewehr", "20261006T190000", "20261006T210000", "Schützenhaus Waldblick"],
  ].flatMap(([uid, name, start, end, place]) => [
    "BEGIN:VEVENT",
    `UID:${uid}@docs`,
    `SUMMARY:${name}`,
    `DTSTART;TZID=Europe/Berlin:${start}`,
    `DTEND;TZID=Europe/Berlin:${end}`,
    `LOCATION:${place}`,
    "END:VEVENT",
  ]),
  "BEGIN:VEVENT",
  "UID:b1@docs",
  "SUMMARY:Weihnachtsfeier",
  "DTSTART;VALUE=DATE:20261212",
  "DTEND;VALUE=DATE:20261213",
  "LOCATION:Gasthof Zum Hirschen",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "UID:b2@docs",
  "SUMMARY:Vorstandssitzung",
  "DTSTART;TZID=Europe/Berlin:20261117T200000",
  "DTEND;TZID=Europe/Berlin:20261117T213000",
  "END:VEVENT",
  "END:VCALENDAR",
].join("\r\n");

for (const lang of LANGS) {
  test.describe(`docs screenshots organize (${lang})`, () => {
    test.setTimeout(90000);
    test.use({ locale: lang === "de" ? "de-DE" : "en-US", timezoneId: "Europe/Berlin" });

    async function open(page: Page, path: string, height?: number) {
      await prepare(page, lang, height);
      const s = await seed(page, lang);
      await signIn(page, lang, s.email);
      await page.goto(`${s.base}${path}`);
      return s;
    }

    const tr = (k: string) => t(lang, k);

    test("templates-form", async ({ page }) => {
      await open(page, "/templates/new", 1300);
      await expect(
        page.getByRole("heading", { level: 1, name: tr("templates.form.newTitle") }),
      ).toBeVisible();
      await page
        .getByLabel(new RegExp(`^${esc(tr("templates.form.name"))}`))
        .fill("Training Luftgewehr");
      await page.getByLabel(tr("templates.form.start")).fill("19:00");
      await page.getByLabel(tr("templates.form.end")).fill("21:00");
      await page
        .getByLabel(new RegExp(esc(tr("templates.form.place"))))
        .selectOption({ label: "Schützenhaus Waldblick" });
      await page
        .getByLabel(new RegExp(`^${esc(tr("templates.form.noteField"))}`))
        .fill(lang === "de" ? "Bitte Vereinsausweis mitbringen." : "Please bring your club card.");
      await page.getByRole("button", { name: "Schützentracht" }).click();
      await page.getByRole("button", { name: "Bonusschießen" }).click();
      await page.getByRole("button", { name: "Erwachsene" }).click();
      await page.evaluate(() => window.scrollTo(0, 0));
      await page
        .locator("main, #main")
        .first()
        .evaluate((e) => e.scrollTo(0, 0));
      await shot(page, lang, "templates-form");
    });

    test("locations-form", async ({ page }) => {
      const s = await open(page, "", 1050);
      await page.goto(`/clubs/${s.clubId}/settings/locations`);
      await page
        .getByRole("button", { name: tr("settings.places.create") })
        .first()
        .click();
      await expect(page.getByRole("heading", { name: tr("settings.places.newTitle") })).toBeVisible(
        {
          timeout: 15000,
        },
      );
      await page
        .getByLabel(new RegExp(`^${esc(tr("settings.places.nameLabel"))}`))
        .fill("Vereinsheim Mitte");
      await page
        .getByLabel(new RegExp(`^${esc(tr("settings.places.streetLabel"))}`))
        .fill("Marktplatz 5");
      await page.getByLabel(new RegExp(`^${esc(tr("settings.places.zipLabel"))}`)).fill("12345");
      await page
        .getByLabel(new RegExp(`^${esc(tr("settings.places.cityLabel"))}`))
        .fill("Musterstadt");
      await page.evaluate(() => document.querySelector("main")?.scrollTo(0, 0));
      await page.evaluate(() => window.scrollTo(0, 0));
      await shot(page, lang, "locations-form");
    });

    test("properties-list", async ({ page }) => {
      await open(page, "/settings/properties", 1150);
      await expect(page.getByText("Schützentracht").first()).toBeVisible();
      await shot(page, lang, "properties-list");
    });

    test("holidays-settings", async ({ page }) => {
      await prepare(page, lang);
      const s = await seed(page, lang);
      insertHoliday(s.calendarId, "Schulferien Bayern", [
        ["Herbstferien", "2026-10-26", "2026-10-30"],
        ["Weihnachtsferien", "2026-12-24", "2027-01-08"],
      ]);
      await signIn(page, lang, s.email);
      await page.goto(`${s.base}/settings/holiday-calendars`);
      await expect(page.getByText("Schulferien Bayern").first()).toBeVisible();
      await page.getByRole("radio", { name: tr("settings.holidays.modeIcs") }).check();
      await page
        .getByLabel(new RegExp(`^${esc(tr("settings.holidays.nameLabel"))}`))
        .fill(lang === "de" ? "Feiertage Bayern" : "Bavaria public holidays");
      await page
        .getByRole("textbox", { name: new RegExp(`^${esc(tr("settings.holidays.urlLabel"))}`) })
        .fill("https://example.org/feiertage.ics");
      await shot(page, lang, "holidays-settings");
    });

    test("series-create-preview", async ({ page }) => {
      const s = await prepare(page, lang, 1350).then(async () => {
        const seeded = await seed(page, lang);
        insertHoliday(seeded.calendarId, "Schulferien Bayern", [
          ["Herbstferien", "2026-10-26", "2026-10-30"],
        ]);
        await signIn(page, lang, seeded.email);
        return seeded;
      });
      await page.goto(`${s.base}/events/new/template`);
      await page.getByRole("radio", { name: /Training Luftgewehr/ }).check();
      await page.getByRole("button", { name: lang === "de" ? "Weiter" : "Next" }).click();
      await page.getByRole("button", { name: tr("events.series.series") }).click();
      await page.getByLabel(tr("events.series.weekday")).selectOption({ index: 3 });
      await page.getByLabel(/^(Von|From)/).fill("2026-10-08");
      await page.getByLabel(/^(Bis|To|Until)/).fill("2026-11-26");
      await expect(page.getByText(/(ausgelassen|skipped)/i).first()).toBeVisible();
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
      await shot(page, lang, "series-create-preview");
    });

    test("bulk-bar", async ({ page }) => {
      await open(page, "/events");
      const boxes = page.getByRole("row").getByRole("checkbox");
      await expect(boxes.first()).toBeVisible();
      for (const i of [1, 2, 3]) await boxes.nth(i).check();
      await expect(page.getByRole("region", { name: tr("events.list.bulk.region") })).toBeVisible();
      await shot(page, lang, "bulk-bar");
    });

    test("import-review", async ({ page }) => {
      await open(page, "/import", 1000);
      await page.locator("#ics-file").setInputFiles({
        name: "Schiessplan-2026.ics",
        mimeType: "text/calendar",
        buffer: Buffer.from(ICS),
      });
      await page.getByRole("button", { name: tr("import.upload.next") }).click();
      await expect(page.getByText(tr("import.review.bulk.title"))).toBeVisible();
      await expect(
        page.getByRole("button", { name: tr("import.review.duplicates.deselect") }),
      ).toBeVisible();
      await shot(page, lang, "import-review");
    });

    test("export-options", async ({ page }) => {
      await open(page, "/events/export", 1150);
      await expect(
        page.getByRole("heading", { level: 1, name: tr("events.export.title") }),
      ).toBeVisible();
      await page
        .getByRole("radio", { name: new RegExp(esc(tr("events.export.status.drafts"))) })
        .check();
      await expect(page.getByText(/\d+ (Termine|events)/).first()).toBeVisible();
      await shot(page, lang, "export-options");
    });
  });
}
