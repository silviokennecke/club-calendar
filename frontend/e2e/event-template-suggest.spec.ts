import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
import { createVerifiedUser, login, resourceUrl, seedClub } from "./helpers";

// ——— Template suggestions in the name field of the create-event form (AutocompleteInput) ———

interface Seeded {
  email: string;
  base: string;
}

async function seed(request: APIRequestContext, name: string): Promise<Seeded> {
  const email = await createVerifiedUser(request, name);
  const { clubId, calendarId, headers } = await seedClub(request, email, `${name} Verein`);
  const post = async (path: string, data: object) => {
    const res = await request.post(resourceUrl(clubId, calendarId, path), { headers, data });
    expect(res.ok(), `${path}: ${res.status()}`).toBeTruthy();
    return (await res.json()) as { id: string };
  };
  const youth = (await post("target-groups", { name: "Jugend" })).id;
  await post("target-groups", { name: "Erwachsene" });
  const place = (
    await post("locations", {
      name: "Schützenhaus Waldblick",
      street: "Waldstraße 12",
      city: "Musterstadt",
    })
  ).id;
  await post("locations", {
    name: "Vereinsheim Mitte",
    street: "Hauptstraße 1",
    city: "Musterstadt",
  });
  const prop = (await post("properties", { name: "Schützentracht", icon: "🎯" })).id;
  const feature = (await post("features", { name: "Bonusschießen" })).id;
  // "Jugendtraining" is created first: it only contains the query, the other two start with it.
  await post("templates", { name: "Jugendtraining", timezone: "Europe/Berlin" });
  await post("templates", {
    name: "Training Luftgewehr",
    timezone: "Europe/Berlin",
    timeBegin: "19:00",
    timeEnd: "21:00",
    locationId: place,
    propertyIds: [prop],
    featureIds: [feature],
    targetGroupIds: [youth],
    note: "Bitte Hausschuhe mitbringen.",
  });
  await post("templates", { name: "Training Pistole", timezone: "Europe/Berlin" });
  return { email, base: `/clubs/${clubId}/calendars/${calendarId}` };
}

const nameField = (page: Page) => page.getByRole("combobox", { name: /^Name/ });
const suggestions = (page: Page) => page.getByRole("listbox");
const options = (page: Page) => suggestions(page).getByRole("option");
const luftgewehr = (page: Page) => options(page).filter({ hasText: "Training Luftgewehr" });

async function openForm(page: Page, seeded: Seeded) {
  await login(page, seeded.email);
  await page.waitForURL(/\/clubs/);
  await page.goto(`${seeded.base}/events/new/form?date=2026-10-24`);
  await expect(page.getByRole("dialog", { name: "Neuer Termin" })).toBeVisible();
  await expect(nameField(page)).toBeFocused();
}

async function expectTemplateApplied(page: Page) {
  await expect(nameField(page)).toHaveValue("Training Luftgewehr");
  await expect(page.getByRole("textbox", { name: "Startzeit (Pflicht)" })).toHaveValue("19:00");
  await expect(page.getByRole("textbox", { name: "Endzeit (Pflicht)" })).toHaveValue("21:00");
  await expect(page.getByRole("combobox", { name: /^Ort/ })).toHaveValue("Schützenhaus Waldblick");
  await expect(
    page
      .getByRole("group", { name: "Besonderheiten" })
      .getByRole("button", { name: /Schützentracht/ }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(
    page
      .getByRole("group", { name: "Zusatzangebote" })
      .getByRole("button", { name: "Bonusschießen" }),
  ).toHaveAttribute("aria-pressed", "true");
  const groups = page.getByRole("group", { name: "Gruppen" });
  await expect(groups.getByRole("button", { name: "Jugend" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(groups.getByRole("button", { name: "Erwachsene" })).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: /^Notiz/ })).toHaveValue(
    "Bitte Hausschuhe mitbringen.",
  );
  await expect(page.getByLabel("Startdatum (Pflicht)")).toHaveValue("2026-10-24");
  await expect(options(page)).toHaveCount(0);
}

test.describe("Vorlagenvorschläge im Termin-Formular", () => {
  test.use({ locale: "de-DE", timezoneId: "Europe/Berlin" });
  let seeded: Seeded;

  test.beforeEach(async ({ page, request }) => {
    await page.clock.setFixedTime(new Date("2026-10-02T10:00:00+02:00"));
    seeded = await seed(request, "Vorlagenvorschlag");
    await openForm(page, seeded);
  });

  test("Vorschläge erst ab 3 Zeichen, Präfix-Treffer zuerst", async ({ page }) => {
    await nameField(page).pressSequentially("tr");
    await expect(options(page)).toHaveCount(0);
    await expect(nameField(page)).toHaveAttribute("aria-expanded", "false");

    await nameField(page).pressSequentially("ai");
    await expect(nameField(page)).toHaveAttribute("aria-expanded", "true");
    await expect(page.getByRole("listbox")).toBeVisible();
    await expect(options(page)).toHaveCount(3);
    await expect(options(page).last()).toContainText("Jugendtraining");
    await expect(luftgewehr(page)).toBeVisible();
    await expect(options(page).filter({ hasText: "Training Pistole" })).toBeVisible();

    await nameField(page).fill("pistol");
    await expect(options(page)).toHaveCount(1);
    await expect(options(page).first()).toContainText("Training Pistole");
  });

  test("Pfeil runter + Enter übernimmt die Vorlage, ohne zu speichern", async ({ page }) => {
    await nameField(page).fill("luftge");
    await expect(luftgewehr(page)).toBeVisible();
    await page.keyboard.press("ArrowDown");
    await expect(luftgewehr(page)).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("Enter");

    await expectTemplateApplied(page);
    await expect(page.getByRole("dialog", { name: "Neuer Termin" })).toBeVisible();
    await expect(page).toHaveURL(/\/events\/new\/form/);
    await expect(page.getByText("Termin gespeichert.")).toHaveCount(0);
  });

  test("Pfeil runter + Tab übernimmt die Vorlage, der Fokus wandert weiter", async ({ page }) => {
    await nameField(page).fill("luftge");
    await expect(luftgewehr(page)).toBeVisible();
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Tab");

    await expectTemplateApplied(page);
    await expect(nameField(page)).not.toBeFocused();
    await expect(page.getByLabel("Startdatum (Pflicht)")).toBeFocused();
  });

  test("Mausklick auf einen Vorschlag übernimmt die Vorlage", async ({ page }) => {
    await nameField(page).fill("luftge");
    await luftgewehr(page).click();
    await expectTemplateApplied(page);
    await expect(page.getByRole("dialog", { name: "Neuer Termin" })).toBeVisible();
  });

  test("Überschreiben: Vorlagenwerte ersetzen, fehlende Werte bleiben", async ({ page }) => {
    await page.getByRole("textbox", { name: /^Notiz/ }).fill("Eigene Notiz");
    await page.getByRole("textbox", { name: "Startzeit (Pflicht)" }).fill("08:15");
    await page.getByRole("textbox", { name: "Endzeit (Pflicht)" }).fill("09:45");

    await nameField(page).fill("luftge");
    await luftgewehr(page).click();
    await expect(page.getByRole("textbox", { name: /^Notiz/ })).toHaveValue(
      "Bitte Hausschuhe mitbringen.",
    );
    await expect(page.getByRole("textbox", { name: "Startzeit (Pflicht)" })).toHaveValue("19:00");
    await expect(page.getByRole("textbox", { name: "Endzeit (Pflicht)" })).toHaveValue("21:00");

    await page.getByRole("textbox", { name: /^Notiz/ }).fill("Zweite Notiz");
    await page.getByRole("textbox", { name: "Startzeit (Pflicht)" }).fill("10:00");
    await page.getByRole("textbox", { name: "Endzeit (Pflicht)" }).fill("11:00");
    await nameField(page).fill("pistol");
    await options(page).filter({ hasText: "Training Pistole" }).click();
    await expect(nameField(page)).toHaveValue("Training Pistole");
    await expect(page.getByRole("textbox", { name: /^Notiz/ })).toHaveValue("Zweite Notiz");
    await expect(page.getByRole("textbox", { name: "Startzeit (Pflicht)" })).toHaveValue("10:00");
    await expect(page.getByRole("textbox", { name: "Endzeit (Pflicht)" })).toHaveValue("11:00");
  });

  test("Tab ohne Auswahl, Klick daneben und Escape ändern nichts", async ({ page }) => {
    await page.getByRole("textbox", { name: /^Notiz/ }).fill("Eigene Notiz");
    await page.getByRole("textbox", { name: "Startzeit (Pflicht)" }).fill("08:15");
    await page.getByRole("textbox", { name: "Endzeit (Pflicht)" }).fill("09:45");
    const unchanged = async () => {
      await expect(page.getByRole("textbox", { name: /^Notiz/ })).toHaveValue("Eigene Notiz");
      await expect(page.getByRole("textbox", { name: "Startzeit (Pflicht)" })).toHaveValue("08:15");
      await expect(page.getByRole("textbox", { name: "Endzeit (Pflicht)" })).toHaveValue("09:45");
      await expect(
        page.getByRole("group", { name: "Gruppen" }).getByRole("button", { name: "Jugend" }),
      ).toHaveCount(0);
    };

    await nameField(page).fill("training");
    await expect(options(page).first()).toBeVisible();
    await page.keyboard.press("Tab");
    await expect(options(page)).toHaveCount(0);
    await expect(nameField(page)).toHaveValue("training");
    await unchanged();

    await nameField(page).fill("");
    await nameField(page).fill("training");
    await expect(options(page).first()).toBeVisible();
    await page.getByRole("heading", { level: 2, name: "Neuer Termin" }).click();
    await expect(options(page)).toHaveCount(0);
    await expect(nameField(page)).toHaveValue("training");
    await unchanged();

    // Escape: first closes the list only, the second closes the dialog.
    await nameField(page).fill("");
    await nameField(page).fill("training");
    await expect(options(page).first()).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(options(page)).toHaveCount(0);
    await expect(page.getByRole("dialog", { name: "Neuer Termin" })).toBeVisible();
    await expect(nameField(page)).toBeFocused();
    await unchanged();

    await page.keyboard.press("Escape");
    // The form is dirty: closing asks before discarding.
    const unsaved = page.getByRole("alertdialog", { name: "Änderungen verwerfen?" });
    await expect(unsaved).toBeVisible();
    await unsaved.getByRole("button", { name: "Änderungen verwerfen" }).click();
    await expect(page.getByRole("dialog", { name: "Neuer Termin" })).toHaveCount(0);
  });

  test("Speichern legt den Termin mit den Vorlagenwerten an; Bearbeiten ohne Vorschläge", async ({
    page,
  }) => {
    await nameField(page).fill("luftge");
    await luftgewehr(page).click();
    await expectTemplateApplied(page);
    await page.getByRole("button", { name: "Termin speichern" }).click();
    await expect(page.getByText("Termin gespeichert.")).toBeVisible();

    await page.goto(`${seeded.base}/events`);
    const row = page
      .getByRole("row")
      .filter({ has: page.getByRole("link", { name: "Training Luftgewehr", exact: true }) });
    await expect(row).toContainText("24.10.2026");
    await expect(row).toContainText("19:00");
    await row.getByRole("link", { name: "Training Luftgewehr", exact: true }).click();

    await expect(page.getByRole("heading", { level: 2, name: "Termin bearbeiten" })).toBeVisible();
    await expect(page.getByRole("textbox", { name: "Startzeit (Pflicht)" })).toHaveValue("19:00");
    await expect(page.getByRole("textbox", { name: "Endzeit (Pflicht)" })).toHaveValue("21:00");
    await expect(page.getByRole("textbox", { name: /^Notiz/ })).toHaveValue(
      "Bitte Hausschuhe mitbringen.",
    );
    await expect(page.getByRole("combobox", { name: /^Ort/ })).toHaveValue(
      "Schützenhaus Waldblick",
    );
    await expect(
      page.getByRole("group", { name: "Gruppen" }).getByRole("button", { name: "Jugend" }),
    ).toHaveAttribute("aria-pressed", "true");

    // Edit dialog: plain input, no suggestions.
    await expect(page.getByRole("combobox", { name: /^Name/ })).toHaveCount(0);
    const input = page.getByRole("textbox", { name: /^Name/ });
    await input.fill("Training Pistole");
    await expect(options(page)).toHaveCount(0);
    await expect(page.getByRole("listbox")).toHaveCount(0);
  });
});
