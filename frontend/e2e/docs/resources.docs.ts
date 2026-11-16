import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { API, createVerifiedUser, seedClub } from "../helpers";
import { LANGS, prepare, shot, signIn, type Lang } from "./shots";

const locales = Object.fromEntries(
  LANGS.map((l) => [
    l,
    JSON.parse(
      readFileSync(fileURLToPath(new URL(`../../src/locales/${l}.json`, import.meta.url)), "utf-8"),
    ),
  ]),
);

function t(lang: Lang, key: string): string {
  const v = key
    .split(".")
    .reduce((o: unknown, k) => (o as Record<string, unknown> | undefined)?.[k], locales[lang]);
  if (typeof v !== "string") throw new Error(`missing i18n key ${key}`);
  return v;
}

for (const lang of LANGS) {
  test.describe(`docs screenshots resources (${lang})`, () => {
    test.setTimeout(90000);
    test.use({ locale: lang === "de" ? "de-DE" : "en-US", timezoneId: "Europe/Berlin" });

    async function open(
      page: import("@playwright/test").Page,
      height?: number,
      target: (ids: { clubId: string; hallResourceId: string }) => string = (ids) =>
        `/clubs/${ids.clubId}/settings/resources`,
    ) {
      await prepare(page, lang, height);
      const email = await createVerifiedUser(page.request, "Max Mustermann");
      const { clubId, calendarId, headers } = await seedClub(
        page.request,
        email,
        "Schützenverein Musterstadt",
      );
      const me = await page.request.patch(`${API}/api/auth/me`, {
        headers,
        data: { language: lang },
      });
      expect(me.ok()).toBeTruthy();
      const post = async (path: string, data: object) => {
        const res = await page.request.post(`${API}/api/clubs/${clubId}/${path}`, {
          headers,
          data,
        });
        expect(res.ok(), `${path}: ${await res.text()}`).toBeTruthy();
        return (await res.json()) as { id: string };
      };
      const hall = await post("locations", {
        name: "Schützenhaus Waldblick",
        street: "Waldstraße 12",
        postalCode: "12345",
        city: "Musterstadt",
      });
      const room = await post("locations", {
        name: "Vereinsheim Nebenraum",
        street: "Marktplatz 5",
        city: "Musterstadt",
      });
      await post("locations", {
        name: "Gasthof Zur Linde",
        street: "Marktplatz 7",
        city: "Musterstadt",
      });
      await post("locations", {
        name: "Sporthalle Nord",
        street: "Parkweg 3",
        city: "Musterstadt",
      });
      const events: [string, string, string, string][] = [
        ["Training Luftgewehr", "2026-10-06", "18:00", "20:00"],
        ["Jugendtraining", "2026-10-08", "16:00", "17:30"],
        ["Vorstandssitzung", "2026-10-13", "19:00", "21:00"],
        ["Preisschießen", "2026-10-17", "10:00", "16:00"],
        ["Training Luftgewehr", "2026-10-20", "18:00", "20:00"],
      ];
      for (const [name, date, timeBegin, timeEnd] of events) {
        const res = await page.request.post(`${API}/api/calendars/${calendarId}/events`, {
          headers,
          data: { name, date, timeBegin, timeEnd, isDraft: false, locationId: hall.id },
        });
        expect(res.ok(), `event: ${await res.text()}`).toBeTruthy();
      }
      const hallResource = await post("resources", {
        locationId: hall.id,
        name: "Schützenhaus Waldblick",
        visibility: "members",
        allowDoubleBooking: false,
        bufferMinutes: 60,
      });
      await post("resources", {
        locationId: room.id,
        name: "Vereinsheim Nebenraum",
        visibility: "staff",
        allowDoubleBooking: true,
      });
      await signIn(page, lang, email);
      await page.goto(target({ clubId, hallResourceId: hallResource.id }));
    }

    test("resources-list", async ({ page }) => {
      await open(page);
      await expect(page.getByText("Vereinsheim Nebenraum").first()).toBeVisible();
      await shot(page, lang, "resources-list");
    });

    test("resources-calendar", async ({ page }) => {
      await open(
        page,
        undefined,
        (ids) => `/clubs/${ids.clubId}/resources/${ids.hallResourceId}/calendar`,
      );
      await expect(page.getByText(/Training Luftgewehr/).first()).toBeVisible();
      await shot(page, lang, "resources-calendar");
    });

    test("resources-form", async ({ page }) => {
      await open(page, 900);
      await page
        .getByRole("button", { name: t(lang, "settings.resources.create") })
        .first()
        .click();
      const dialog = page.getByRole("dialog");
      await expect(dialog).toBeVisible();
      await dialog
        .getByLabel(new RegExp(`^${t(lang, "settings.resources.location")}`))
        .selectOption({
          label: "Sporthalle Nord",
        });
      await shot(page, lang, "resources-form");
    });
  });
}
