import { test, expect, type Page } from "@playwright/test";
import { API, createVerifiedUser, login, resourceUrl, seedClub } from "./helpers";

// ——— Einstellungen (phase 6): Allgemein, Besonderheiten/Zusatzangebote/Gruppen, Orte, Archiv ———

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
      "Besonderheiten",
      "Zusatzangebote",
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
      scope: "calendar",
      tab: "Besonderheiten",
      path: "properties",
      list: "Vorhandene Besonderheiten",
      create: "Besonderheit anlegen",
      created: "Besonderheit „Rollstuhlgerecht“ angelegt",
      deleteTitle: "Besonderheit „Barrierefrei“ löschen?",
      deleteConfirm: "Besonderheit löschen",
      editTitle: "Besonderheit bearbeiten",
      empty: "Noch keine Besonderheiten",
    },
    {
      scope: "calendar",
      tab: "Zusatzangebote",
      path: "features",
      list: "Vorhandene Zusatzangebote",
      create: "Zusatzangebot anlegen",
      created: "Zusatzangebot „Rollstuhlgerecht“ angelegt",
      deleteTitle: "Zusatzangebot „Barrierefrei“ löschen?",
      deleteConfirm: "Zusatzangebot löschen",
      editTitle: "Zusatzangebot bearbeiten",
      empty: "Noch keine Zusatzangebote",
    },
    {
      scope: "club",
      tab: "Gruppen",
      path: "target-groups",
      list: "Vorhandene Gruppen",
      create: "Gruppe anlegen",
      created: "Gruppe „Rollstuhlgerecht“ angelegt",
      deleteTitle: "Gruppe „Barrierefrei“ löschen?",
      deleteConfirm: "Gruppe löschen",
      editTitle: "Gruppe bearbeiten",
      empty: "Noch keine Gruppen",
    },
  ];

  for (const k of kinds) {
    test(`${k.tab}: anlegen, umbenennen, löschen`, async ({ page, request }) => {
      const s = await seed(request, `Settings ${k.tab}`);
      if (k.scope === "club") {
        // Gruppen sind Vereinsdaten: Tab der Vereinseinstellungen, keine Kalender-ID in der Adresse
        await openSettings(
          page,
          s.email,
          `/clubs/${s.clubId}/settings/locations`,
          "Vereinseinstellungen",
        );
        await page
          .getByRole("navigation", { name: "Einstellungen des Vereins" })
          .getByRole("link", { name: k.tab })
          .click();
        await expect(page).toHaveURL(new RegExp(`/clubs/${s.clubId}/settings/${k.path}$`));
      } else {
        await openSettings(page, s.email, `${s.base}/settings`);
        await page
          .getByRole("navigation", { name: "Einstellungen des Kalenders" })
          .getByRole("link", { name: k.tab })
          .click();
        await expect(page).toHaveURL(new RegExp(`/settings/${k.path}$`));
      }

      // Leerzustand
      await expect(page.getByRole("heading", { name: k.empty })).toBeVisible();

      // Validierung
      await page.locator("form").getByRole("button", { name: k.create }).click();
      await expect(page.getByRole("alert")).toContainText("Bitte einen Namen eingeben.");

      // Anlegen (Besonderheiten mit Symbol)
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

      // Umbenennen im Dialog per Tastatur: Enter speichert, Fokus kehrt zum Auslöser zurück
      await page.getByRole("button", { name: "Rollstuhlgerecht bearbeiten" }).click();
      const editDialog = page.getByRole("dialog", { name: new RegExp(`^${k.editTitle}$`) });
      const edit = editDialog.getByLabel(/^Name/);
      await expect(edit).toBeFocused();
      await expect(edit).toHaveValue("Rollstuhlgerecht");
      // Leerer Name: Fehlerzusammenfassung im Dialog, Dialog bleibt offen
      await edit.fill("");
      await edit.press("Enter");
      await expect(editDialog.getByRole("alert")).toContainText("Bitte einen Namen eingeben.");
      await edit.fill("Barrierefrei");
      await edit.press("Enter");
      await expect(editDialog).toHaveCount(0);
      await expect(list).toContainText("Barrierefrei");
      await expect(list).not.toContainText("Rollstuhlgerecht");
      await expect(page.getByRole("button", { name: "Barrierefrei bearbeiten" })).toBeFocused();

      // Escape bricht ab, Fokus kehrt zurück
      await page.getByRole("button", { name: "Barrierefrei bearbeiten" }).click();
      await editDialog.getByLabel(/^Name/).fill("Verworfen");
      await page.keyboard.press("Escape");
      // Geänderter Name: der Unsaved-Changes-Guard fragt nach, erst "Änderungen verwerfen" bricht ab
      const unsaved = page.getByRole("alertdialog", { name: "Änderungen verwerfen?" });
      await expect(unsaved).toBeVisible();
      await unsaved.getByRole("button", { name: "Änderungen verwerfen" }).click();
      await expect(editDialog).toHaveCount(0);
      await expect(list).toContainText("Barrierefrei");
      await expect(list).not.toContainText("Verworfen");
      await expect(page.getByRole("button", { name: "Barrierefrei bearbeiten" })).toBeFocused();

      // Löschen mit Folgen
      await page.getByRole("button", { name: "Barrierefrei löschen" }).click();
      const dialog = page.getByRole("alertdialog", { name: k.deleteTitle });
      await expect(dialog).toContainText(
        "Barrierefrei“ ist aktuell keinem Termin und keiner Vorlage zugeordnet",
      );
      await dialog.getByRole("button", { name: k.deleteConfirm }).click();
      await expect(page.getByRole("heading", { name: k.empty })).toBeVisible();
      const items = await (
        await request.get(
          `${API}/api/${k.scope === "club" ? `clubs/${s.clubId}` : `calendars/${s.calendarId}`}/${k.path}`,
          { headers: s.headers },
        )
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
    // The backend rejects a duplicate name (case and spaces ignored) with a stable code
    const dup = await request.post(`${API}/api/calendars/${s.calendarId}/properties`, {
      headers: s.headers,
      data: { name: " draußen " },
    });
    expect(dup.status()).toBe(422);
    expect(await dup.json()).toMatchObject({ code: "duplicate_name", field: "name" });

    const listRequests: string[] = [];
    page.on("request", (req) => {
      if (/\/(events|templates)(\?|$)/.test(req.url())) listRequests.push(req.url());
    });
    await openSettings(page, s.email, `${s.base}/settings/properties`);
    await page.getByRole("button", { name: "Draußen löschen" }).click();
    // Names and counts come with the property list (usage), no event / template list is loaded
    await expect(page.getByRole("alertdialog")).toContainText(
      "Bei 2 Terminen (Termin 2026-10-10, Termin 2026-10-17) wird die Zuordnung entfernt.",
    );
    expect(listRequests).toEqual([]);
    await page.getByRole("button", { name: "Abbrechen" }).click();
    await expect(page.getByRole("alertdialog")).toHaveCount(0);
  });

  test("Orte: anlegen, bearbeiten, löschen ohne Karte", async ({ page, request }) => {
    const s = await seed(request, "Settings Orte");
    await openSettings(
      page,
      s.email,
      `/clubs/${s.clubId}/settings/locations`,
      "Vereinseinstellungen",
    );
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
      await request.get(`${API}/api/clubs/${s.clubId}/locations`, { headers: s.headers })
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

  test("Alte Kalender-Adressen für Orte, Gruppen und Feeds leiten zu den Vereinseinstellungen", async ({
    page,
    request,
  }) => {
    const s = await seed(request, "Settings Umleitung");
    await login(page, s.email);
    await page.waitForURL(/\/clubs/);
    for (const path of ["locations", "target-groups", "feeds"]) {
      await page.goto(`${s.base}/settings/${path}`);
      await expect(page).toHaveURL(new RegExp(`/clubs/${s.clubId}/settings/${path}$`));
    }
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
    // An address the server accepts but cannot fetch (422 ics_fetch_failed), not only one it rejects
    await page.getByLabel(/^ICS-Adresse/).fill("https://nicht-erreichbar.invalid/feiertage.ics");
    const failed = page.waitForResponse(
      (r) => r.url().endsWith("/holiday-calendars") && r.request().method() === "POST",
    );
    await page.getByRole("button", { name: "Hinzufügen und abrufen" }).click();
    expect(await (await failed).json()).toMatchObject({ status: 422, code: "ics_fetch_failed" });
    await expect(page.getByRole("alert")).toContainText(
      "Die Adresse konnte nicht abgerufen werden.",
    );
    await expect(page.getByRole("heading", { name: "Noch keine Feiertagskalender" })).toBeVisible();
  });

  test("Allgemein verweist für Kalender-Verwaltung auf die Vereinsseite", async ({
    page,
    request,
  }) => {
    const s = await seed(request, "Settings Verweis");
    await openSettings(page, s.email, `${s.base}/settings`);

    // Duplizieren, Archivieren und Löschen gibt es hier nicht mehr (Design: Verein verwalten).
    for (const name of ["Kalender archivieren", "Kalender duplizieren", "Kalender löschen"]) {
      await expect(page.getByRole("button", { name })).toHaveCount(0);
    }
    await page.getByRole("link", { name: "Verein verwalten" }).last().click();
    await expect(page).toHaveURL(new RegExp(`/clubs/${s.clubId}$`));
    await expect(page.getByRole("heading", { level: 1, name: "Verein verwalten" })).toBeVisible();
    await expect(
      page.getByRole("button", { name: `Kalender ${s.calendarName} duplizieren` }),
    ).toBeVisible();
  });

  test("Archivierter Kalender: alle Einstellungen nur lesbar", async ({ page, request }) => {
    const s = await seed(request, "Settings Readonly");
    const post = (path: string, data: object) =>
      request.post(resourceUrl(s.clubId, s.calendarId, path), { headers: s.headers, data });
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
      { link: "Besonderheiten", text: "Wettkampf", addForm: "Neue Besonderheit hinzufügen" },
      { link: "Zusatzangebote", text: "Bonusschießen", addForm: "Neues Zusatzangebot hinzufügen" },
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

    // Orte und Gruppen sind Vereinsdaten: ein archivierter Kalender sperrt sie nicht
    await page.goto(`/clubs/${s.clubId}/settings/target-groups`);
    await expect(page.getByText("Jugend").first()).toBeVisible();
    await expect(page.getByRole("heading", { name: "Neue Gruppe hinzufügen" })).toBeVisible();
    await expect(page.locator("#main").getByText("Archiviert, schreibgeschützt")).toHaveCount(0);
    await page.goto(`/clubs/${s.clubId}/settings/locations`);
    await expect(page.getByText("Vereinsheim Mitte").first()).toBeVisible();
    await expect(page.getByRole("heading", { name: "Neuen Ort anlegen" })).toBeVisible();
    await page.goto(`${s.base}/settings/holiday-calendars`);

    // Aufheben macht die Einstellungen wieder bearbeitbar
    await page.getByRole("button", { name: "Archivierung aufheben" }).click();
    await expect(page.getByText("Archivierung aufgehoben.")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Feiertagskalender hinzufügen" })).toBeVisible();
  });
});
