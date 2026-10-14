import { test, expect, type Page } from "@playwright/test";
import { API, createVerifiedUser, login, seedClub } from "./helpers";

// Dialogs on top of the event dialog (delete, series scope, unsaved changes): focus trap, inert
// background, Escape closes only the top dialog, focus returns to the opener.

async function seed(request: Parameters<typeof createVerifiedUser>[0], name: string) {
  const email = await createVerifiedUser(request, name);
  const { clubId, calendarId, headers } = await seedClub(request, email, `${name} Verein`);
  const post = async (path: string, data: object) => {
    const res = await request.post(`${API}/api/calendars/${calendarId}/${path}`, { headers, data });
    expect(res.ok(), `${path}: ${res.status()}`).toBeTruthy();
    return (await res.json()) as { id: string };
  };
  await post("events", {
    name: "Einzeltermin",
    date: "2026-10-05",
    timeBegin: "19:00",
    timeEnd: "21:00",
    isDraft: false,
  });
  const template = await post("templates", {
    name: "Reihe",
    timezone: "Europe/Berlin",
    timeBegin: "19:00",
    timeEnd: "21:00",
  });
  await post("events/series", {
    templateId: template.id,
    isDraft: false,
    rule: {
      frequency: "weekly",
      weekday: 4,
      nth: null,
      startDate: "2026-11-01",
      until: "2026-11-30",
      count: null,
      skipHolidays: false,
    },
  });
  return { email, base: `/clubs/${clubId}/calendars/${calendarId}` };
}

/** Index (0-based) of the focused element inside `selector`, -1 when focus is outside. */
const focusIn = (page: Page, selector: string) =>
  page.evaluate(
    (sel) => !!document.activeElement && !!document.activeElement.closest(sel),
    selector,
  );

/** Tab / Shift+Tab through the top dialog: focus never leaves it, the dialog below is unreachable. */
async function expectTrapped(page: Page, selector: string, behindField: string) {
  // Record every element that takes focus outside the dialog (Base UI's own focus guards excepted).
  await page.evaluate((sel) => {
    const w = window as unknown as { __strays: string[] };
    w.__strays = [];
    document.addEventListener(
      "focusin",
      (e) => {
        const t = e.target as HTMLElement;
        if (!t.closest(sel) && !t.hasAttribute("data-base-ui-focus-guard"))
          w.__strays.push(
            `${t.tagName} ${t.getAttribute("aria-label") ?? t.textContent?.slice(0, 30)}`,
          );
      },
      true,
    );
  }, selector);
  for (const key of ["Tab", "Shift+Tab"]) {
    for (let i = 0; i < 7; i++) {
      await page.keyboard.press(key);
      // (focus may rest on a focus guard for a moment before it wraps around)
      await expect
        .poll(() => focusIn(page, selector), { message: `${key} #${i + 1} left the dialog` })
        .toBe(true);
    }
  }
  expect(
    await page.evaluate(() => (window as unknown as { __strays: string[] }).__strays),
    "focus visited elements outside the dialog",
  ).toEqual([]);
  // The dialog below and the page behind it cannot take focus (inert) ...
  await page
    .locator(behindField)
    .first()
    .evaluate((el) => (el as HTMLElement).focus());
  expect(await focusIn(page, selector), "a field behind the dialog took focus").toBe(true);
  // ... and are hidden from assistive technology.
  expect(
    await page
      .locator(behindField)
      .first()
      .evaluate((el) => !!el.closest("[inert], [aria-hidden='true']")),
  ).toBe(true);
}

test.describe("Dialoge über dem Termin-Dialog", () => {
  test.use({ locale: "de-DE", timezoneId: "Europe/Berlin" });

  test.beforeEach(async ({ page }) => {
    await page.clock.setFixedTime(new Date("2026-10-02T10:00:00+02:00"));
  });

  async function openEvent(
    page: Page,
    request: Parameters<typeof seed>[0],
    name: string,
    ev: string,
  ) {
    const seeded = await seed(request, name);
    await login(page, seeded.email);
    await page.waitForURL(/\/clubs/);
    await page.goto(`${seeded.base}/events`);
    await page.getByRole("link", { name: ev, exact: true }).first().click();
    await expect(page.getByRole("dialog", { name: "Termin bearbeiten" })).toBeVisible();
  }

  test("Löschen-Dialog hält den Fokus, Escape schließt nur ihn", async ({ page, request }) => {
    await openEvent(page, request, "Stapel Loeschen", "Einzeltermin");
    const trigger = page.getByRole("button", { name: "Termin löschen" });
    await trigger.click();
    const confirm = page.getByRole("alertdialog");
    await expect(confirm.getByRole("button", { name: "Abbrechen" })).toBeFocused();
    await expectTrapped(page, "[role=alertdialog]", "[role=dialog] input");
    await page.keyboard.press("Escape");
    await expect(confirm).toHaveCount(0);
    await expect(page.getByRole("dialog", { name: "Termin bearbeiten" })).toBeVisible();
    await expect(trigger).toBeFocused();
  });

  test("Serien-Dialog (Speichern und Löschen) hält den Fokus", async ({ page, request }) => {
    await openEvent(page, request, "Stapel Serie", "Reihe");
    await page.getByLabel("Name (Pflicht)").fill("Reihe neu");
    const save = page.getByRole("button", { name: "Termin speichern" });
    await save.click();
    const scope = page.getByRole("alertdialog");
    await expect(scope).toContainText("Änderungen für die Terminreihe speichern?");
    await expectTrapped(page, "[role=alertdialog]", "[role=dialog] input");
    await page.keyboard.press("Escape");
    await expect(scope).toHaveCount(0);
    await expect(page.getByRole("dialog", { name: "Termin bearbeiten" })).toBeVisible();
    await expect(save).toBeFocused();

    const del = page.getByRole("button", { name: "Termin löschen" });
    await del.click();
    await expect(scope).toContainText("Terminreihe");
    await expectTrapped(page, "[role=alertdialog]", "[role=dialog] input");
    await page.keyboard.press("Escape");
    await expect(scope).toHaveCount(0);
    await expect(del).toBeFocused();
  });

  test("Ungespeichert-Dialog hält den Fokus", async ({ page, request }) => {
    await openEvent(page, request, "Stapel Ungespeichert", "Einzeltermin");
    await page.getByLabel("Name (Pflicht)").fill("Geändert");
    const close = page.getByRole("button", { name: "Schließen, Änderungen verwerfen" });
    await close.click();
    const unsaved = page.getByRole("alertdialog");
    await expect(unsaved).toContainText("Änderungen verwerfen?");
    await expectTrapped(page, "[role=alertdialog]", "[role=dialog] input");
    await page.keyboard.press("Escape");
    await expect(unsaved).toHaveCount(0);
    await expect(page.getByRole("dialog", { name: "Termin bearbeiten" })).toBeVisible();
    await expect(close).toBeFocused();
  });
});
