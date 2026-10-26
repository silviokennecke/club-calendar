import { test, expect } from "@playwright/test";
import { LANGS, prepare, seedDocs, shot, signIn } from "./shots";

for (const lang of LANGS) {
  test.describe(`docs screenshots (${lang})`, () => {
    test.use({ locale: lang === "de" ? "de-DE" : "en-US", timezoneId: "Europe/Berlin" });

    test("sign-in", async ({ page }) => {
      await prepare(page, lang);
      await page.goto("/login");
      await expect(page.getByRole("button", { name: /^(Weiter|Continue)$/ })).toBeVisible();
      await shot(page, lang, "sign-in");
    });

    test("calendar-month", async ({ page }) => {
      // Tall enough for all six week rows of the month grid.
      await prepare(page, lang, 1000);
      const seed = await seedDocs(page, lang);
      await signIn(page, lang, seed.email);
      await page.goto(seed.url);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await expect(page.getByText("Herbstfest").first()).toBeVisible();
      await shot(page, lang, "calendar-month");
    });
  });
}
