import { test, expect, type Locator, type Page } from "@playwright/test";
import { API, createVerifiedUser, login, seedClub } from "./helpers";

// ——— Import and templates by keyboard (phase 5): focus, live regions, dialogs, unsaved changes ———

const ics = [
  "BEGIN:VCALENDAR",
  "VERSION:2.0",
  "PRODID:-//e2e//DE",
  ...["20261008", "20261015", "20261022"].flatMap((day, i) => [
    "BEGIN:VEVENT",
    `UID:k${i}@e2e`,
    "SUMMARY:Training Luftgewehr",
    `DTSTART:${day}T190000`,
    `DTEND:${day}T210000`,
    "LOCATION:Schützenhaus Waldblick",
    "END:VEVENT",
  ]),
  "BEGIN:VEVENT",
  "UID:k9@e2e",
  "SUMMARY:Herbstfest",
  "DTSTART;VALUE=DATE:20261024",
  "END:VEVENT",
  "END:VCALENDAR",
].join("\r\n");

async function seed(request: Parameters<typeof createVerifiedUser>[0], name: string) {
  const email = await createVerifiedUser(request, name);
  const { clubId, calendarId, headers } = await seedClub(request, email, `${name} Verein`);
  const res = await request.post(`${API}/api/calendars/${calendarId}/locations`, {
    headers,
    data: { name: "Schützenhaus Waldblick" },
  });
  expect(res.ok()).toBeTruthy();
  return { email, base: `/clubs/${clubId}/calendars/${calendarId}` };
}

/** Presses Tab until `target` has focus (fails after `max` presses). */
async function tabTo(page: Page, target: Locator, max = 60) {
  for (let i = 0; i < max; i += 1) {
    if (await target.evaluate((el) => el === document.activeElement)) return;
    await page.keyboard.press("Tab");
  }
  await expect(target).toBeFocused();
}

/** Tab / Shift+Tab never leave `dialog`. */
async function expectFocusTrapped(page: Page, dialog: Locator) {
  // The focus guards of the dialog hand focus back asynchronously, so poll for a moment.
  const inside = () => dialog.evaluate((el) => el.contains(document.activeElement));
  for (let i = 0; i < 40; i += 1) {
    await page.keyboard.press("Tab");
    await expect.poll(inside, { message: `Tab ${i + 1} left the dialog` }).toBe(true);
  }
  for (let i = 0; i < 5; i += 1) {
    await page.keyboard.press("Shift+Tab");
    await expect.poll(inside, { message: `Shift+Tab ${i + 1} left the dialog` }).toBe(true);
  }
}

test.describe("Import und Vorlagen per Tastatur", () => {
  test.use({ locale: "de-DE", timezoneId: "Europe/Berlin" });

  test("Import: Datei, Prüfen, Dreifach-Checkbox, Dialoge, Ergebnis", async ({ page, request }) => {
    const seeded = await seed(request, "Tastatur Import");
    await login(page, seeded.email);
    await page.waitForURL(/\/clubs/);
    await page.goto(`${seeded.base}/import`);

    // Schritt 1: Überschrift hat den Fokus, Datei-Eingabe per Tab erreichbar
    const h1 = page.getByRole("heading", { level: 1, name: "Termine importieren" });
    await expect(h1).toBeFocused();
    const input = page.locator("#ics-file");
    await tabTo(page, input);
    await expect(input).toBeFocused();

    // Enter öffnet den Dateidialog
    const [chooser] = await Promise.all([
      page.waitForEvent("filechooser", { timeout: 5000 }),
      page.keyboard.press("Enter"),
    ]);
    await chooser.setFiles({
      name: "plan.ics",
      mimeType: "text/calendar",
      buffer: Buffer.from(ics),
    });
    await expect(page.getByRole("status").filter({ hasText: "plan.ics" })).toHaveText(
      "plan.ics: 4 Termine erkannt",
    );
    const next = page.getByRole("button", { name: /Datei prüfen/ });
    await tabTo(page, next);
    await page.keyboard.press("Enter");

    // Schritt 2: Fokus auf der Überschrift
    await expect(
      page.getByRole("heading", { level: 1, name: "plan.ics: 4 Termine erkannt" }),
    ).toBeFocused();
    await expect(page.getByRole("status").filter({ hasText: "ausgewählt" })).toHaveText(
      "4 von 4 ausgewählt",
    );

    // Dreifach-Checkbox der Gruppe: erst ganz, dann teilweise (mixed)
    const group = page.getByRole("checkbox", { name: /Training Luftgewehr.*(alle|ausgewählt)/ });
    await expect(group).toBeChecked();
    const table = page.getByRole("table", { name: "Termine der Gruppe Training Luftgewehr" });
    await expect(table).toBeVisible();
    const row = table.getByRole("checkbox", { name: /22\.10\.2026 auswählen/ });
    await row.focus();
    await page.keyboard.press("Space");
    await expect(row).not.toBeChecked();
    await expect(page.getByRole("status").filter({ hasText: "ausgewählt" })).toHaveText(
      "3 von 4 ausgewählt",
    );
    const mixed = page.getByRole("checkbox", { name: /Training Luftgewehr.*2 von 3/ });
    await expect(mixed).toBeChecked({ indeterminate: true });
    await expect(mixed).toMatchAriaSnapshot(`- checkbox [checked=mixed]`);
    // Leertaste auf dem gemischten Zustand wählt die ganze Gruppe aus, noch einmal ab
    await mixed.focus();
    await page.keyboard.press("Space");
    await expect(page.getByRole("status").filter({ hasText: "ausgewählt" })).toHaveText(
      "4 von 4 ausgewählt",
    );
    await page.keyboard.press("Space");
    await expect(page.getByRole("status").filter({ hasText: "ausgewählt" })).toHaveText(
      "1 von 4 ausgewählt",
    );
    await page.keyboard.press("Space");
    await expect(page.getByRole("status").filter({ hasText: "ausgewählt" })).toHaveText(
      "4 von 4 ausgewählt",
    );

    // Bündel-Dialog der Gruppe: Fokusfalle, Escape, Fokus zurück
    const edit = page.getByRole("button", { name: "Gruppe Training Luftgewehr bearbeiten" });
    await edit.focus();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", { name: "Gruppe bearbeiten: Training Luftgewehr" });
    await expect(dialog).toBeVisible();
    expect(await dialog.evaluate((el) => el.contains(document.activeElement))).toBe(true);
    await expectFocusTrapped(page, dialog);
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(edit).toBeFocused();

    // Einzeltermin-Dialog ebenso
    const editItem = page
      .getByRole("button", { name: /Termin Training Luftgewehr am .*08\.10\.2026 bearbeiten/ })
      .first();
    await editItem.focus();
    await page.keyboard.press("Space");
    const itemDialog = page.getByRole("dialog", { name: "Termin bearbeiten" });
    await expect(itemDialog).toBeVisible();
    await expectFocusTrapped(page, itemDialog);
    await page.keyboard.press("Escape");
    await expect(itemDialog).toBeHidden();
    await expect(editItem).toBeFocused();

    // Ungespeichert: App-Link, Escape bleibt, Verwerfen verlässt
    const away = page.getByRole("link", { name: "Vorlagen" }).first();
    await away.focus();
    await page.keyboard.press("Enter");
    const unsaved = page.getByRole("alertdialog");
    await expect(unsaved).toBeVisible();
    await expectFocusTrapped(page, unsaved);
    await page.keyboard.press("Escape");
    await expect(unsaved).toBeHidden();
    await expect(page).toHaveURL(/\/import$/);
    await expect(away).toBeFocused();
    await away.click();
    await page
      .getByRole("alertdialog")
      .getByRole("button", { name: "Änderungen verwerfen" })
      .click();
    await expect(page.getByRole("heading", { level: 1, name: "Vorlagen" })).toBeVisible();

    // Import durchführen: Fokus auf dem Ergebnis
    await page.goto(`${seeded.base}/import`);
    await page.locator("#ics-file").setInputFiles({
      name: "plan.ics",
      mimeType: "text/calendar",
      buffer: Buffer.from(ics),
    });
    await page.getByRole("button", { name: /Datei prüfen/ }).click();
    const importBtn = page.getByRole("button", { name: "4 Termine importieren" });
    await expect(importBtn).toBeEnabled();
    await importBtn.focus();
    await page.keyboard.press("Enter");
    await expect(
      page.getByRole("heading", { level: 1, name: "4 Termine importiert" }),
    ).toBeFocused();
  });

  test("Import: Leertaste öffnet den Dateidialog", async ({ page, request }) => {
    const seeded = await seed(request, "Tastatur Datei");
    await login(page, seeded.email);
    await page.waitForURL(/\/clubs/);
    await page.goto(`${seeded.base}/import`);
    const input = page.locator("#ics-file");
    await tabTo(page, input);
    const [chooser] = await Promise.all([
      page.waitForEvent("filechooser", { timeout: 5000 }),
      page.keyboard.press("Space"),
    ]);
    expect(chooser.isMultiple()).toBe(false);
  });

  test("Vorlagenformular: Ungespeichert per App-Link und Escape", async ({ page, request }) => {
    const seeded = await seed(request, "Tastatur Vorlage");
    await login(page, seeded.email);
    await page.waitForURL(/\/clubs/);
    await page.goto(`${seeded.base}/templates/new`);
    await expect(page.getByRole("heading", { level: 1, name: "Neue Vorlage" })).toBeVisible();
    await page.getByLabel(/^Name/).fill("Entwurf");

    const away = page.getByRole("link", { name: "Alle Termine" }).first();
    await away.focus();
    await page.keyboard.press("Enter");
    const unsaved = page.getByRole("alertdialog");
    await expect(unsaved).toBeVisible();
    await expectFocusTrapped(page, unsaved);
    await page.keyboard.press("Escape");
    await expect(unsaved).toBeHidden();
    await expect(page.getByLabel(/^Name/)).toHaveValue("Entwurf");
    await expect(page).toHaveURL(/templates\/new$/);
    await expect(away).toBeFocused();

    await page.keyboard.press("Enter");
    await page
      .getByRole("alertdialog")
      .getByRole("button", { name: "Änderungen verwerfen" })
      .click();
    await expect(page).not.toHaveURL(/templates\/new$/);
  });
});
