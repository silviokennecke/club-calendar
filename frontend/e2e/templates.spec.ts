import { test, expect, type Page } from "@playwright/test";
import { API, createVerifiedUser, login, seedClub, resourceUrl } from "./helpers";

// ——— Templates (phase 5): create, edit, search, use in an event, delete ———

async function seed(request: Parameters<typeof createVerifiedUser>[0], name: string) {
  const email = await createVerifiedUser(request, name);
  const { clubId, calendarId, headers } = await seedClub(request, email, `${name} Verein`);
  const post = async (path: string, data: object) => {
    const res = await request.post(resourceUrl(clubId, calendarId, path), { headers, data });
    expect(res.ok(), `${path}: ${res.status()}`).toBeTruthy();
    return (await res.json()) as { id: string };
  };
  await post("locations", {
    name: "Schützenhaus Waldblick",
    street: "Waldstraße 12",
    city: "Musterstadt",
  });
  await post("locations", { name: "Vereinsheim Mitte" });
  await post("target-groups", { name: "Jugend" });
  await post("target-groups", { name: "Erwachsene" });
  await post("features", { name: "Bonusschießen" });
  return { email, calendarId, headers, base: `/clubs/${clubId}/calendars/${calendarId}` };
}

async function openTemplates(page: Page, email: string, base: string) {
  await login(page, email);
  await page.waitForURL(/\/clubs/);
  await page.goto(`${base}/templates`);
  await expect(page.getByRole("heading", { level: 1, name: "Vorlagen" })).toBeVisible();
}

test.describe("Vorlagen", () => {
  test.use({ locale: "de-DE", timezoneId: "Europe/Berlin" });

  test("Leerzustand, anlegen, bearbeiten, in Termin nutzen und löschen", async ({
    page,
    request,
  }) => {
    const seeded = await seed(request, "Vorlagen Ablauf");
    await openTemplates(page, seeded.email, seeded.base);

    // Leerzustand
    await expect(page.getByRole("heading", { name: "Noch keine Vorlagen" })).toBeVisible();

    // Anlegen mit Validierung
    await page.getByRole("link", { name: "Vorlage anlegen" }).first().click();
    await expect(page.getByRole("heading", { level: 1, name: "Neue Vorlage" })).toBeVisible();
    await page.getByRole("button", { name: "Vorlage speichern" }).click();
    await expect(page.getByRole("alert")).toContainText("Die Vorlage ist noch nicht vollständig.");
    await page.getByRole("alert").getByRole("link", { name: "Bitte gib einen Namen ein." }).click();
    await expect(page.getByLabel(/^Name/)).toBeFocused();

    await page.getByLabel(/^Name/).fill("Training Luftgewehr");
    await page.getByLabel("Startzeit").fill("19:00");
    await page.getByLabel("Endzeit").fill("21:00");
    await page.getByLabel(/Standardort/).selectOption({ label: "Schützenhaus Waldblick" });
    await page.getByRole("button", { name: "Erwachsene" }).click();
    await page.getByRole("button", { name: "Bonusschießen" }).click();
    await page.getByRole("button", { name: "Vorlage speichern" }).click();

    await expect(page.getByText("Vorlage gespeichert.")).toBeVisible();
    await expect(page.getByRole("heading", { level: 1, name: "Vorlagen" })).toBeVisible();
    const card = page.getByRole("listitem").filter({ hasText: "Training Luftgewehr" });
    await expect(card).toContainText("19:00 – 21:00");
    await expect(card).toContainText("Schützenhaus Waldblick");
    await expect(card).toContainText("Erwachsene");
    await expect(card).toContainText("Bonusschießen");

    // Bearbeiten
    await card.getByRole("link", { name: "Vorlage Training Luftgewehr bearbeiten" }).click();
    await expect(
      page.getByRole("heading", { level: 1, name: "Vorlage bearbeiten: Training Luftgewehr" }),
    ).toBeVisible();
    await expect(page.getByLabel(/^Name/)).toHaveValue("Training Luftgewehr");
    await expect(page.getByLabel(/Standardort/)).toHaveValue(/.+/);
    await page.getByLabel(/^Name/).fill("Training Luftgewehr (Halle)");
    await page.getByLabel("Endzeit").fill("21:30");
    await page.getByRole("button", { name: "Erwachsene" }).click(); // abwählen
    await page.getByRole("button", { name: "Jugend" }).click();
    await page.getByRole("button", { name: "Vorlage speichern" }).click();
    await expect(page.getByText("Vorlage gespeichert.")).toBeVisible();
    const edited = page.getByRole("listitem").filter({ hasText: "Training Luftgewehr (Halle)" });
    await expect(edited).toContainText("19:00 – 21:30");
    await expect(edited).toContainText("Jugend");
    await expect(edited).not.toContainText("Erwachsene");

    // Ungespeicherte Änderungen
    await edited.getByRole("link", { name: /bearbeiten/ }).click();
    await page.getByLabel(/^Name/).fill("Geändert");
    await page.getByRole("link", { name: "Abbrechen" }).click();
    await expect(page.getByRole("alertdialog")).toBeVisible();
    await page.getByRole("alertdialog").getByRole("button", { name: "Weiter bearbeiten" }).click();
    await expect(page.getByLabel(/^Name/)).toHaveValue("Geändert");
    await page.getByRole("link", { name: "Abbrechen" }).click();
    await page
      .getByRole("alertdialog")
      .getByRole("button", { name: "Änderungen verwerfen" })
      .click();
    await expect(page.getByRole("heading", { level: 1, name: "Vorlagen" })).toBeVisible();

    // Zweite Vorlage + Suche
    await page.getByRole("link", { name: "Vorlage anlegen" }).click();
    await page.getByLabel(/^Name/).fill("Vereinsabend");
    await page.getByLabel(/Standardort/).selectOption({ label: "Vereinsheim Mitte" });
    await page.getByRole("button", { name: "Vorlage speichern" }).click();
    await expect(page.getByRole("listitem")).toHaveCount(2);
    // Without times (optional, design: TemplateEdit) the template creates all-day events
    await expect(page.getByRole("listitem").filter({ hasText: "Vereinsabend" })).toContainText(
      "Ganztägig",
    );
    await page.getByRole("searchbox").fill("abend");
    await expect(page.getByRole("listitem")).toHaveCount(1);
    await expect(page.getByRole("heading", { name: "Vereinsabend" })).toBeVisible();
    await page.getByRole("searchbox").fill("gibtesnicht");
    await expect(page.getByRole("heading", { name: /Keine Treffer/ })).toBeVisible();
    await page.getByRole("button", { name: "Suche zurücksetzen" }).click();
    await expect(page.getByRole("listitem")).toHaveCount(2);

    // In einem Termin nutzen
    await page
      .getByRole("listitem")
      .filter({ hasText: "Training Luftgewehr (Halle)" })
      .getByRole("link", { name: "Termin aus Vorlage" })
      .click();
    // A dialog above the template list (which stays below, inert).
    const fromTemplate = page.getByRole("dialog", { name: "Termin aus Vorlage" });
    await expect(fromTemplate).toBeVisible();
    await expect(fromTemplate).toContainText("Training Luftgewehr (Halle)");
    await expect(page.locator("[inert] h1")).toBeAttached();
    await page.getByLabel("Datum (Pflicht)").fill("2026-10-22");
    await page.getByRole("button", { name: "1 Termin als Entwurf anlegen" }).click();
    await expect(page.getByText("Termin angelegt.")).toBeVisible();
    await expect(fromTemplate).toHaveCount(0);
    await expect(page).toHaveURL(/\/templates$/);
    await page.goto(`${seeded.base}/events`);
    const created = page.getByRole("row").filter({ hasText: "22.10.2026" });
    await expect(created).toContainText("Training Luftgewehr (Halle)");
    await expect(created).toContainText("19:00 – 21:30");
    await expect(created).toContainText("Schützenhaus Waldblick");
    await expect(created).toContainText("Jugend");

    // Löschen: Dialog nennt die Folge, Termin bleibt bestehen
    await page.goto(`${seeded.base}/templates`);
    await page.getByRole("button", { name: "Vorlage Vereinsabend löschen" }).click();
    const dialog = page.getByRole("alertdialog", { name: "Vorlage „Vereinsabend“ löschen?" });
    // eventCount from the API: nothing was created from this template yet
    await expect(dialog).toContainText("Aus dieser Vorlage wurden noch keine Termine erzeugt.");
    await dialog.getByRole("button", { name: "Vorlage löschen" }).click();
    await expect(page.getByText("Vorlage gelöscht.")).toBeVisible();
    await expect(page.getByRole("listitem")).toHaveCount(1);

    // Löschen aus dem Formular
    await page
      .getByRole("link", { name: /Vorlage Training Luftgewehr \(Halle\) bearbeiten/ })
      .click();
    await page.getByRole("button", { name: "Vorlage löschen" }).click();
    await expect(page.getByRole("alertdialog")).toContainText(
      "Der 1 bereits aus dieser Vorlage erzeugte Termin bleibt unverändert.",
    );
    await page.getByRole("alertdialog").getByRole("button", { name: "Vorlage löschen" }).click();
    await expect(page.getByRole("heading", { name: "Noch keine Vorlagen" })).toBeVisible();
    await page.goto(`${seeded.base}/events`);
    await expect(page.getByRole("row").filter({ hasText: "22.10.2026" })).toContainText(
      "Training Luftgewehr (Halle)",
    );
  });

  test("Vorlage mit Ort, Besonderheit, Zusatzangebot und Gruppen ergibt einen passenden Termin", async ({
    page,
    request,
  }) => {
    const seeded = await seed(request, "Vorlage Termin");
    const prop = await request.post(`${API}/api/calendars/${seeded.calendarId}/properties`, {
      headers: seeded.headers,
      data: { name: "Schützentracht", icon: "🎯" },
    });
    expect(prop.ok()).toBeTruthy();
    await openTemplates(page, seeded.email, seeded.base);

    await page.getByRole("link", { name: "Vorlage anlegen" }).first().click();
    await page.getByLabel(/^Name/).fill("Jahresschießen");
    await page.getByLabel("Startzeit").fill("10:00");
    await page.getByLabel("Endzeit").fill("16:30");
    await page.getByLabel(/Standardort/).selectOption({ label: "Vereinsheim Mitte" });
    await page.getByRole("button", { name: /Schützentracht/ }).click();
    await page.getByRole("button", { name: "Bonusschießen" }).click();
    await page.getByRole("button", { name: "Jugend" }).click();
    await page.getByRole("button", { name: "Erwachsene" }).click();
    await page.getByRole("button", { name: "Vorlage speichern" }).click();
    await expect(page.getByText("Vorlage gespeichert.")).toBeVisible();

    // Termin aus Vorlage
    await page
      .getByRole("listitem")
      .filter({ hasText: "Jahresschießen" })
      .getByRole("link", { name: "Termin aus Vorlage" })
      .click();
    await page.getByLabel("Datum (Pflicht)").fill("2026-11-14");
    await page.getByRole("button", { name: "1 Termin als Entwurf anlegen" }).click();
    await expect(page.getByText("Termin angelegt.")).toBeVisible();

    // Werte prüfen: API und Bearbeitungsformular
    const events = await (
      await request.get(`${API}/api/calendars/${seeded.calendarId}/events`, {
        headers: seeded.headers,
      })
    ).json();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      name: "Jahresschießen",
      timeBegin: "10:00",
      timeEnd: "16:30",
      isDraft: true,
    });
    expect(events[0].date).toContain("2026-11-14");
    expect(events[0].location?.name).toBe("Vereinsheim Mitte");
    expect(
      events[0].properties.map((p: { property: { name: string } }) => p.property.name),
    ).toEqual(["Schützentracht"]);
    expect(events[0].features.map((f: { feature: { name: string } }) => f.feature.name)).toEqual([
      "Bonusschießen",
    ]);
    expect(
      events[0].targetGroups
        .map((g: { targetGroup: { name: string } }) => g.targetGroup.name)
        .sort(),
    ).toEqual(["Erwachsene", "Jugend"]);

    await page.goto(`${seeded.base}/events`);
    await page.getByRole("link", { name: "Jahresschießen", exact: true }).click();
    await expect(page.getByRole("dialog").getByLabel(/^Name/)).toHaveValue("Jahresschießen");
    await expect(page.getByRole("textbox", { name: /^Startzeit/ })).toHaveValue("10:00");
    await expect(page.getByRole("textbox", { name: /^Endzeit/ })).toHaveValue("16:30");
    for (const name of [/Schützentracht/, "Bonusschießen", "Jugend", "Erwachsene"]) {
      await expect(page.getByRole("button", { name })).toHaveAttribute("aria-pressed", "true");
    }
    await expect(
      page
        .locator("select")
        .filter({ has: page.locator("option", { hasText: "Vereinsheim Mitte" }) })
        .first(),
    ).toHaveValue(events[0].location.id);
  });

  test("Mobile Breite: Vorlagenliste und Formular", async ({ page, request }) => {
    const seeded = await seed(request, "Vorlagen Mobil");
    const res = await request.post(`${API}/api/calendars/${seeded.calendarId}/templates`, {
      headers: seeded.headers,
      data: {
        name: "Jugendtraining",
        timezone: "Europe/Berlin",
        timeBegin: "18:00",
        timeEnd: "19:30",
      },
    });
    expect(res.ok()).toBeTruthy();
    await page.setViewportSize({ width: 390, height: 844 });
    await openTemplates(page, seeded.email, seeded.base);
    await expect(page.getByRole("heading", { name: "Jugendtraining" })).toBeVisible();
    await page.getByRole("link", { name: /bearbeiten/ }).click();
    await expect(page.getByLabel(/^Name/)).toHaveValue("Jugendtraining");
    const hasOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(hasOverflow).toBe(false);
  });

  test("Vorlage ohne Zeiten ergibt einen ganztägigen Termin", async ({ page, request }) => {
    const seeded = await seed(request, "Vorlage Ganztag");
    await openTemplates(page, seeded.email, seeded.base);
    await page.getByRole("link", { name: "Vorlage anlegen" }).first().click();
    await expect(page.getByLabel("Startzeit")).toHaveValue("");
    await page.getByLabel(/^Name/).fill("Vereinsfest");
    // Only one time: both or none
    await page.getByLabel("Startzeit").fill("15:00");
    await page.getByRole("button", { name: "Vorlage speichern" }).click();
    await expect(page.getByRole("alert")).toContainText(
      "Bitte gib auch eine Endzeit ein oder lass beide Zeiten leer.",
    );
    await page.getByLabel("Startzeit").fill("");
    await page.getByRole("button", { name: "Vorlage speichern" }).click();
    await expect(page.getByText("Vorlage gespeichert.")).toBeVisible();
    const card = page.getByRole("listitem").filter({ hasText: "Vereinsfest" });
    await expect(card).toContainText("Ganztägig");

    await card.getByRole("link", { name: "Termin aus Vorlage" }).click();
    const dialog = page.getByRole("dialog", { name: "Termin aus Vorlage" });
    await expect(dialog).toContainText("Ganztägig");
    await page.getByLabel("Datum (Pflicht)").fill("2026-09-12");
    await page.getByRole("button", { name: "1 Termin als Entwurf anlegen" }).click();
    await expect(page.getByText("Termin angelegt.")).toBeVisible();
    const events = await (
      await request.get(`${API}/api/calendars/${seeded.calendarId}/events`, {
        headers: seeded.headers,
      })
    ).json();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ name: "Vereinsfest", isAllDay: true });
  });
});
