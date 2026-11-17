import { test, expect } from "@playwright/test";
import {
  API,
  PASSWORD,
  authHeaders,
  backendConsole,
  createVerifiedUser,
  inviteAndAccept,
  seedClub,
} from "../helpers";
import { LANGS, prepare, shot, signIn } from "./shots";

const PEOPLE: [string, string][] = [
  ["Anna Beispiel", "anna.beispiel@example.com"],
  ["Ben Muster", "ben.muster@example.com"],
  ["Clara Lehmann", "clara.lehmann@example.com"],
];

for (const lang of LANGS) {
  test.describe(`docs screenshots calendar permissions (${lang})`, () => {
    test.setTimeout(90000);
    test.use({ locale: lang === "de" ? "de-DE" : "en-US", timezoneId: "Europe/Berlin" });

    test("calendar-permissions", async ({ page }) => {
      await prepare(page, lang);
      const request = page.request;
      const admin = await createVerifiedUser(request, "Max Mustermann");
      const { clubId, calendarId, headers } = await seedClub(request, admin, "SV Musterstadt");
      const me = await request.patch(`${API}/api/auth/me`, { headers, data: { language: lang } });
      expect(me.ok()).toBeTruthy();
      const rename = await request.patch(`${API}/api/clubs/${clubId}/calendars/${calendarId}`, {
        headers,
        data: { name: "Jugendgruppe" },
      });
      expect(rename.ok()).toBeTruthy();

      const ids: string[] = [];
      for (const [name, email] of PEOPLE) {
        const known = await request.post(`${API}/api/auth/register`, {
          data: { name, email, password: PASSWORD, language: lang },
        });
        if (known.ok()) backendConsole("app:user:verify", email);
        const memberHeaders = await authHeaders(request, email);
        await inviteAndAccept(request, clubId, headers, email, "member" as never);
        const profile = await request.get(`${API}/api/auth/me`, { headers: memberHeaders });
        ids.push(((await profile.json()) as { id: string }).id);
      }
      for (const id of ids.slice(0, 2)) {
        const added = await request.post(`${API}/api/calendars/${calendarId}/members`, {
          headers,
          data: { userId: id },
        });
        expect(added.ok(), await added.text()).toBeTruthy();
      }

      await signIn(page, lang, admin);
      await page.goto(`/clubs/${clubId}/calendars/${calendarId}/settings/permissions`);
      await expect(page.getByText("ben.muster@example.com")).toBeVisible();
      await shot(page, lang, "calendar-permissions");
    });
  });
}
