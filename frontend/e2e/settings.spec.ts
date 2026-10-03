import { test, expect, type Page } from "@playwright/test";
import { API, createVerifiedUser, login, seedClub } from "./helpers";

// ——— Einstellungen (phase 6): Allgemein, Eigenschaften/Features/Zielgruppen, Orte, Archiv ———

async function seed(request: Parameters<typeof createVerifiedUser>[0], name: string) {
  const email = await createVerifiedUser(request, name);
  const { clubId, calendarId, headers } = await seedClub(request, email, `${name} Verein`);
  const base = `/clubs/${clubId}/calendars/${calendarId}`;
  return { email, clubId, calendarId, headers, base, calendarName: `${name} Verein Termine` };
}

async function openSettings(page: Page, email: string, url: string, heading = "Einstellungen") {
  await login(page, email);
  await page.waitForURL(/\/clubs/);
  await page.goto(url);
  await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
}

test.describe("Einstellungen", () => {
  test.use({ locale: "de-DE", timezoneId: "Europe/Berlin" });

  test("Allgemein: Name und Zeitzone ändern, Validierung, Tabs", async ({ page, request }) => {
    const s = await seed(request, "Settings Allgemein");
    await openSettings(page, s.email, `${s.base}/settings`);

    // Tabs: gleiche Reihenfolge wie im Design, aktueller Tab markiert
    const tabs = page.getByRole("navigation", { name: "Einstellungen des Kalenders" });
    await expect(tabs.getByRole("link")).toHaveText([
      "Allgemein",
      "Eigenschaften",
      "Features",
      "Zielgruppen",
      "Orte",
      "Feiertage",
    ]);
    await expect(tabs.getByRole("link", { name: "Allgemein" })).toHaveAttribute(
      "aria-current",
      "page",
    );

    const name = page.getByLabel(/^Kalendername/);
    await expect(name).toHaveValue(s.calendarName);
    await expect(
      page.getByRole("switch", { name: "Zeitzone des Vereins verwenden" }),
    ).toBeChecked();

    // Validierung
    await name.fill("");
    await page.getByRole("button", { name: "Einstellungen speichern" }).click();
    await expect(page.getByRole("alert")).toContainText("Bitte einen Kalendernamen eingeben.");
    await page
      .getByRole("alert")
      .getByRole("link", { name: "Bitte einen Kalendernamen eingeben." })
      .click();
    await expect(name).toBeFocused();

    // Ändern: Name + eigene Zeitzone
    await name.fill("Winterprogramm 2027");
    await page.getByRole("switch", { name: "Zeitzone des Vereins verwenden" }).click();
    await page.getByLabel("Zeitzone dieses Kalenders").selectOption("Europe/London");
    await expect(page.getByText(/Aktuelle Uhrzeit in Europe\/London: \d\d:\d\d Uhr/)).toBeVisible();
    await page.getByRole("button", { name: "Einstellungen speichern" }).click();
    await expect(page.getByText("Gespeichert", { exact: true })).toBeVisible();

    const saved = await (
      await request.get(`${API}/api/clubs/${s.clubId}/calendars/${s.calendarId}`, {
        headers: s.headers,
      })
    ).json();
    expect(saved.name).toBe("Winterprogramm 2027");
    expect(saved.timezone).toBe("Europe/London");

    // Nach dem Neuladen steht es noch da; der Kopf nennt den neuen Namen
    await page.reload();
    await expect(page.getByLabel(/^Kalendername/)).toHaveValue("Winterprogramm 2027");
    await expect(page.getByLabel("Zeitzone dieses Kalenders")).toHaveValue("Europe/London");
    await expect(
      page.getByRole("heading", { level: 1, name: "Einstellungen" }).locator(".."),
    ).toContainText("Winterprogramm 2027");

    // Zurück auf die Vereinszeitzone
    await page.getByRole("switch", { name: "Zeitzone des Vereins verwenden" }).click();
    await page.getByRole("button", { name: "Einstellungen speichern" }).click();
    await expect(page.getByText("Gespeichert", { exact: true })).toBeVisible();
    const reset = await (
      await request.get(`${API}/api/clubs/${s.clubId}/calendars/${s.calendarId}`, {
        headers: s.headers,
      })
    ).json();
    expect(reset.timezone).toBeNull();
  });

  const kinds = [
    {
      tab: "Eigenschaften",
      path: "properties",
      list: "Vorhandene Eigenschaften",
      create: "Eigenschaft anlegen",
      created: "Eigenschaft „Rollstuhlgerecht“ angelegt",
      deleteTitle: "Eigenschaft „Barrierefrei“ löschen?",
      deleteConfirm: "Eigenschaft löschen",
      empty: "Noch keine Eigenschaften",
    },
    {
      tab: "Features",
      path: "features",
      list: "Vorhandene Features",
      create: "Feature anlegen",
      created: "Feature „Rollstuhlgerecht“ angelegt",
      deleteTitle: "Feature „Barrierefrei“ löschen?",
      deleteConfirm: "Feature löschen",
      empty: "Noch keine Features",
    },
    {
      tab: "Zielgruppen",
      path: "target-groups",
      list: "Vorhandene Zielgruppen",
      create: "Zielgruppe anlegen",
      created: "Zielgruppe „Rollstuhlgerecht“ angelegt",
      deleteTitle: "Zielgruppe „Barrierefrei“ löschen?",
      deleteConfirm: "Zielgruppe löschen",
      empty: "Noch keine Zielgruppen",
    },
  ];

  for (const k of kinds) {
    test(`${k.tab}: anlegen, umbenennen, löschen`, async ({ page, request }) => {
      const s = await seed(request, `Settings ${k.tab}`);
      await openSettings(page, s.email, `${s.base}/settings`);
      await page
        .getByRole("navigation", { name: "Einstellungen des Kalenders" })
        .getByRole("link", { name: k.tab })
        .click();
      await expect(page).toHaveURL(new RegExp(`/settings/${k.path}$`));

      // Leerzustand
      await expect(page.getByRole("heading", { name: k.empty })).toBeVisible();

      // Validierung
      await page.locator("form").getByRole("button", { name: k.create }).click();
      await expect(page.getByRole("alert")).toContainText("Bitte einen Namen eingeben.");

      // Anlegen (Eigenschaften mit Symbol)
      await page.getByLabel(/^Name/).fill("Rollstuhlgerecht");
      if (k.path === "properties") await page.getByRole("button", { name: "Barrierefrei" }).click();
      await page.locator("form").getByRole("button", { name: k.create }).click();
      await expect(page.getByText(k.created)).toBeVisible();
      const list = page.getByRole("list", { name: new RegExp(`${k.list} \\(1\\)`) });
      await expect(list.getByRole("listitem")).toHaveCount(1);
      await expect(list).toContainText("Rollstuhlgerecht");
      if (k.path === "properties") await expect(list).toContainText("♿");

      // Doppelter Name
      await page.getByLabel(/^Name/).fill("rollstuhlgerecht");
      await page.locator("form").getByRole("button", { name: k.create }).click();
      await expect(page.getByRole("alert")).toContainText("Diesen Namen gibt es schon.");
      await page.getByLabel(/^Name/).fill("");

      // Umbenennen inline per Tastatur: Enter speichert
      await page.getByRole("button", { name: "Rollstuhlgerecht bearbeiten" }).click();
      const edit = page.locator('input[id^="ml-edit-"]');
      await expect(edit).toBeFocused();
      await edit.fill("Barrierefrei");
      await edit.press("Enter");
      await expect(list).toContainText("Barrierefrei");
      await expect(list).not.toContainText("Rollstuhlgerecht");
      await expect(page.getByRole("button", { name: "Barrierefrei bearbeiten" })).toBeFocused();

      // Escape bricht ab
      await page.getByRole("button", { name: "Barrierefrei bearbeiten" }).click();
      await page.locator('input[id^="ml-edit-"]').fill("Verworfen");
      await page.keyboard.press("Escape");
      await expect(list).toContainText("Barrierefrei");
      await expect(list).not.toContainText("Verworfen");

      // Löschen mit Folgen
      await page.getByRole("button", { name: "Barrierefrei löschen" }).click();
      const dialog = page.getByRole("alertdialog", { name: k.deleteTitle });
      await expect(dialog).toContainText(
        "Barrierefrei“ ist aktuell keinem Termin und keiner Vorlage zugeordnet",
      );
      await dialog.getByRole("button", { name: k.deleteConfirm }).click();
      await expect(page.getByRole("heading", { name: k.empty })).toBeVisible();
      const items = await (
        await request.get(`${API}/api/calendars/${s.calendarId}/${k.path}`, { headers: s.headers })
      ).json();
      expect(items).toHaveLength(0);
    });
  }

  test("Löschen nennt die betroffenen Termine", async ({ page, request }) => {
    const s = await seed(request, "Settings Folgen");
    const prop = await (
      await request.post(`${API}/api/calendars/${s.calendarId}/properties`, {
        headers: s.headers,
        data: { name: "Draußen", icon: "🌳" },
      })
    ).json();
    for (const date of ["2026-10-10", "2026-10-17"]) {
      const res = await request.post(`${API}/api/calendars/${s.calendarId}/events`, {
        headers: s.headers,
        data: {
          name: `Termin ${date}`,
          date,
          timeBegin: "10:00",
          timeEnd: "12:00",
          timezone: "Europe/Berlin",
          propertyIds: [prop.id],
        },
      });
      expect(res.ok(), await res.text()).toBeTruthy();
    }
    await openSettings(page, s.email, `${s.base}/settings/properties`);
    await page.getByRole("button", { name: "Draußen löschen" }).click();
    await expect(page.getByRole("alertdialog")).toContainText(
      "2 Termine verlieren die Zuordnung zu „Draußen“",
    );
    await page.getByRole("button", { name: "Abbrechen" }).click();
    await expect(page.getByRole("alertdialog")).toHaveCount(0);
  });

  test("Orte: anlegen, bearbeiten, löschen ohne Karte", async ({ page, request }) => {
    const s = await seed(request, "Settings Orte");
    await openSettings(page, s.email, `${s.base}/settings/locations`);
    await expect(page.getByRole("heading", { name: "Noch keine Orte" })).toBeVisible();

    // Validierung: Name oder Straße
    await page.getByRole("button", { name: "Ort speichern" }).click();
    await expect(page.getByRole("alert")).toContainText(
      "Bitte mindestens einen Namen oder eine Straße eingeben.",
    );

    // Anlegen von Hand (Adresssuche braucht einen Geocoder, hier nicht erreichbar)
    await page.getByLabel(/^Name/).fill("Schützenhaus Waldblick");
    await page.getByLabel("Straße").fill("Waldstraße 12");
    await page.getByLabel("PLZ").fill("12345");
    await page.getByLabel("Stadt").fill("Musterstadt");
    // Position per Tastatur
    await page.getByText("Koordinaten von Hand eingeben").click();
    await page.getByLabel("Breitengrad").fill("48.1371");
    await page.getByLabel("Längengrad").fill("11.5754");
    await page.getByRole("button", { name: "Ort speichern" }).click();
    await expect(page.getByText("Ort gespeichert")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Ort bearbeiten" })).toBeVisible();

    const list = page.getByRole("heading", { name: "Alle Orte (1)" });
    await expect(list).toBeVisible();
    const row = page.getByRole("listitem").filter({ hasText: "Schützenhaus Waldblick" });
    await expect(row).toContainText("Waldstraße 12, 12345 Musterstadt");
    const saved = await (
      await request.get(`${API}/api/calendars/${s.calendarId}/locations`, { headers: s.headers })
    ).json();
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({
      name: "Schützenhaus Waldblick",
      latitude: 48.1371,
      longitude: 11.5754,
    });

    // Kartenalternative: Region mit Namen und Beschreibung
    await expect(page.getByRole("region", { name: "Übersichtskarte mit 1 Ort" })).toBeVisible();
    await expect(page.getByText(/Die Karte zeigt 1 Ort mit Position/)).toBeAttached();

    // Zweiter Ort ohne Position
    await page.getByRole("button", { name: "Ort anlegen" }).first().click();
    await expect(page.getByRole("heading", { name: "Neuen Ort anlegen" })).toBeFocused();
    await page.getByLabel(/^Name/).fill("Vereinsheim Mitte");
    await page.getByRole("button", { name: "Ort speichern" }).click();
    await expect(page.getByRole("heading", { name: "Alle Orte (2)" })).toBeVisible();
    await expect(page.getByRole("listitem").filter({ hasText: "Vereinsheim Mitte" })).toContainText(
      "Keine Position",
    );

    // Bearbeiten
    await page.getByRole("button", { name: "Vereinsheim Mitte bearbeiten" }).click();
    await page.getByLabel(/^Name/).fill("Vereinsheim");
    await page.getByRole("button", { name: "Ort speichern" }).click();
    await expect(
      page.getByRole("listitem").filter({ hasText: "Vereinsheim" }).first(),
    ).toBeVisible();

    // Löschen
    await page.getByRole("button", { name: "Ort löschen" }).click();
    const dialog = page.getByRole("alertdialog", { name: "Ort „Vereinsheim“ löschen?" });
    await expect(dialog).toContainText(
      "Aktuell findet kein Termin und keine Vorlage an diesem Ort statt.",
    );
    await dialog.getByRole("button", { name: "Ort löschen" }).click();
    await expect(page.getByRole("heading", { name: "Alle Orte (1)" })).toBeVisible();
  });

  test("Feiertage: Leerzustand, Validierung und Fehler beim Abrufen", async ({ page, request }) => {
    const s = await seed(request, "Settings Feiertage");
    await openSettings(page, s.email, `${s.base}/settings/holiday-calendars`);
    await expect(page.getByRole("heading", { name: "Noch keine Feiertagskalender" })).toBeVisible();
    await page.getByRole("button", { name: "Hinzufügen und abrufen" }).click();
    await expect(page.getByRole("alert")).toContainText("Bitte eine ICS-Adresse eingeben.");
    await page.getByLabel(/^Name/).fill("Feiertage Test");
    await page.getByLabel(/^ICS-Adresse/).fill("https://127.0.0.1:9/nicht-erreichbar.ics");
    await page.getByRole("button", { name: "Hinzufügen und abrufen" }).click();
    await expect(page.getByRole("alert")).toContainText(
      "Die Adresse konnte nicht abgerufen werden.",
    );
    await expect(page.getByLabel(/^Name/)).toHaveValue("Feiertage Test");
  });

  test("Kalender archivieren, wieder aufheben und duplizieren", async ({ page, request }) => {
    const s = await seed(request, "Settings Archiv");
    await openSettings(page, s.email, `${s.base}/settings`);

    // Archivieren mit Bestätigung
    await page.getByRole("button", { name: "Kalender archivieren" }).click();
    const dialog = page.getByRole("alertdialog", {
      name: `Kalender „${s.calendarName}“ archivieren?`,
    });
    await expect(dialog).toContainText("nur lesbar");
    await dialog.getByRole("button", { name: "Kalender archivieren" }).click();
    await expect(page.getByText("Kalender archiviert.")).toBeVisible();
    await expect(page.getByText("Archiviert, schreibgeschützt").first()).toBeVisible();
    await expect(page.getByLabel(/^Kalendername/)).not.toBeEditable();
    await expect(page.getByRole("button", { name: "Einstellungen speichern" })).toHaveCount(0);

    // Wieder aufheben über das Banner
    await page.getByRole("status").getByRole("button", { name: "Archivierung aufheben" }).click();
    await expect(page.getByText("Archivierung aufgehoben.")).toBeVisible();
    await expect(page.getByLabel(/^Kalendername/)).toBeEnabled();
    await expect(page.getByRole("button", { name: "Kalender archivieren" })).toBeVisible();

    // Duplizieren: die Kopie öffnet sich mit eigenem Namen
    await page.getByRole("button", { name: "Kalender duplizieren" }).click();
    await expect(page.getByText("Kalender dupliziert.")).toBeVisible();
    await expect(page.getByLabel(/^Kalendername/)).toHaveValue(`Kopie von ${s.calendarName}`);
    await expect(page).not.toHaveURL(new RegExp(`${s.calendarId}`));

    // Die Kopie löschen: Bestätigung mit Folgen, danach Vereinsseite
    await page.getByRole("button", { name: "Kalender löschen" }).click();
    const del = page.getByRole("alertdialog", {
      name: `Kalender „Kopie von ${s.calendarName}“ löschen?`,
    });
    await expect(del).toContainText("Termine (0)");
    await del.getByRole("button", { name: "Kalender löschen" }).click();
    await expect(page).toHaveURL(new RegExp(`/clubs/${s.clubId}$`));
    const calendars = await (
      await request.get(`${API}/api/clubs/${s.clubId}/calendars`, { headers: s.headers })
    ).json();
    expect(calendars).toHaveLength(1);
    expect(calendars[0].id).toBe(s.calendarId);
  });

  test("Archivierter Kalender: alle Einstellungen nur lesbar", async ({ page, request }) => {
    const s = await seed(request, "Settings Readonly");
    const post = (path: string, data: object) =>
      request.post(`${API}/api/calendars/${s.calendarId}/${path}`, { headers: s.headers, data });
    await post("properties", { name: "Wettkampf", icon: "🏆" });
    await post("features", { name: "Bonusschießen" });
    await post("target-groups", { name: "Jugend" });
    await post("locations", { name: "Vereinsheim Mitte", street: "Marktplatz 5" });
    const archive = await request.post(
      `${API}/api/clubs/${s.clubId}/calendars/${s.calendarId}/archive`,
      { headers: s.headers, data: {} },
    );
    expect(archive.ok()).toBeTruthy();

    await openSettings(page, s.email, `${s.base}/settings`);
    await expect(page.getByLabel(/^Kalendername/)).not.toBeEditable();

    const cases = [
      { link: "Eigenschaften", text: "Wettkampf", addForm: "Neue Eigenschaft hinzufügen" },
      { link: "Features", text: "Bonusschießen", addForm: "Neues Feature hinzufügen" },
      { link: "Zielgruppen", text: "Jugend", addForm: "Neue Zielgruppe hinzufügen" },
      { link: "Orte", text: "Vereinsheim Mitte", addForm: "Neuen Ort anlegen" },
      {
        link: "Feiertage",
        text: "Noch keine Feiertagskalender",
        addForm: "Feiertagskalender hinzufügen",
      },
    ];
    const tabs = page.getByRole("navigation", { name: "Einstellungen des Kalenders" });
    for (const c of cases) {
      await tabs.getByRole("link", { name: c.link }).click();
      await expect(page.getByText(c.text).first()).toBeVisible();
      await expect(page.locator("#main").getByText("Archiviert, schreibgeschützt")).toBeVisible();
      await expect(page.getByRole("heading", { name: c.addForm })).toHaveCount(0);
      await expect(
        page.getByRole("button", { name: /bearbeiten|löschen|anlegen|speichern/ }),
      ).toHaveCount(0);
    }

    // Aufheben macht die Einstellungen wieder bearbeitbar
    await page.getByRole("button", { name: "Archivierung aufheben" }).click();
    await expect(page.getByText("Archivierung aufgehoben.")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Feiertagskalender hinzufügen" })).toBeVisible();
  });
});
