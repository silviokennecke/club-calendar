import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
import { API, createVerifiedUser, inviteAndAccept, login, resourceUrl, seedClub } from "./helpers";

// ——— Veröffentlichen (phase 7): Feedliste, Feed anlegen/bearbeiten, Geheimnis neu erzeugen, löschen ———

async function seed(request: APIRequestContext, name: string) {
  const email = await createVerifiedUser(request, name);
  const { clubId, calendarId, headers } = await seedClub(request, email, `${name} Verein`);
  const base = `/clubs/${clubId}/calendars/${calendarId}`;
  // Feeds are club data: the settings live below /clubs/:id/settings, no calendar in the address
  const feedsPath = `/clubs/${clubId}/settings/feeds`;
  const post = async (path: string, data: object) =>
    (await request.post(resourceUrl(clubId, calendarId, path), { headers, data })).json();
  const createFeed = async (data: object, query = "") =>
    (
      await request.post(`${API}/api/clubs/${clubId}/feeds${query}`, {
        headers,
        data: { calendarIds: [calendarId], ...data },
      })
    ).json();
  return {
    email,
    clubId,
    calendarId,
    headers,
    base,
    feedsPath,
    post,
    createFeed,
    clubName: `${name} Verein`,
    calendarName: `${name} Verein Termine`,
  };
}

async function openFeeds(page: Page, email: string, path: string) {
  await login(page, email);
  await page.waitForURL(/\/clubs/);
  await page.goto(path);
}

async function listFeeds(request: APIRequestContext, s: Awaited<ReturnType<typeof seed>>) {
  return (
    await request.get(`${API}/api/clubs/${s.clubId}/feeds?includeSecret=1`, {
      headers: s.headers,
    })
  ).json() as Promise<
    {
      id: string;
      name: string;
      visibility: string;
      indexable: boolean;
      sharedSecret: string;
      targetGroups: unknown[];
    }[]
  >;
}

test.describe("Veröffentlichen", () => {
  test.use({ locale: "de-DE", timezoneId: "Europe/Berlin" });

  test("Leerzustand führt zum Anlegen, Navigation und Tab-Leiste", async ({ page, request }) => {
    const s = await seed(request, "Feeds Leer");
    await login(page, s.email);
    await page.waitForURL(/\/clubs/);
    await page.goto(s.base);
    // Seitenleiste: "Veröffentlichen" öffnet die Feedliste
    await page
      .getByRole("navigation", { name: "Bereiche" })
      .getByRole("link", { name: "Veröffentlichen" })
      .click();
    await expect(page).toHaveURL(new RegExp(`${s.feedsPath}$`));
    await expect(page.getByRole("heading", { level: 1, name: "Veröffentlichen" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Noch kein Feed" })).toBeVisible();
    await expect(page.getByText(`${s.clubName} · 0 Feeds`)).toBeVisible();
    await page.getByRole("main").getByRole("link", { name: "Feed anlegen" }).first().click();
    await expect(page).toHaveURL(new RegExp(`/settings/feeds/new$`));
    await expect(page.getByRole("heading", { level: 1, name: "Feed anlegen" })).toBeFocused();
  });

  test("Feedliste: Sichtbarkeit als Wort, Link zur Seite, Geheimnis im Link", async ({
    page,
    request,
  }) => {
    const s = await seed(request, "Feeds Liste");
    const group = await s.post("target-groups", { name: "Jugend" });
    await s.createFeed({ name: "Öffentlicher Kalender", visibility: "PUBLIC" });
    await s.createFeed({
      name: "Vorstand intern",
      visibility: "PRIVATE",
      targetGroupIds: [group.id],
    });
    await openFeeds(page, s.email, `${s.feedsPath}`);
    await expect(page.getByText(`${s.clubName} · 2 Feeds`)).toBeVisible();

    const pub = page.getByRole("region", { name: "Öffentlicher Kalender" });
    const priv = page.getByRole("region", { name: "Vorstand intern" });
    // Sichtbarkeit: Wort + Icon, keine Emojis
    await expect(pub.locator(".ap-badge")).toHaveText("Öffentlich");
    await expect(priv.locator(".ap-badge")).toHaveText("Privat");
    await expect(pub.locator(".ap-badge svg")).toBeVisible();
    expect(await pub.innerText()).not.toMatch(/[\u{1F310}\u{1F512}]/u);
    await expect(pub).toContainText("Alle Gruppen");
    await expect(priv.getByRole("group", { name: "Gruppen von Vorstand intern" })).toContainText(
      "Jugend",
    );

    // Der erste Feed ist geöffnet, der zweite nicht
    const web = pub.getByLabel("Adresse der Webansicht");
    await expect(web).toBeVisible();
    await expect(priv.getByLabel("Adresse der Webansicht")).toHaveCount(0);
    const webUrl = await web.inputValue();
    expect(webUrl).toMatch(/\/feed\//);
    expect(webUrl).not.toContain("secret=");
    await expect(pub.getByLabel("ICS-Adresse")).toHaveCount(0);
    await expect(pub.getByLabel("Abo-Adresse (webcal)")).toHaveCount(0);

    // Privater Feed: der Link trägt das Geheimnis, dazu die Warnung
    await priv.getByRole("button", { name: "Zugänge anzeigen" }).click();
    await expect(priv.getByRole("textbox", { name: "Geheimnis" })).toHaveCount(0);
    await expect(priv.getByText(/Wer den Link kennt, kann den Feed lesen/)).toBeVisible();
    const privWeb = await priv.getByLabel("Adresse der Webansicht").inputValue();
    expect(privWeb).toMatch(/secret=[0-9a-f]{32}$/);

    // Kopieren: Rückmeldung sichtbar und per Statusmeldung angekündigt
    await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
    const webField = web.locator("xpath=ancestor::div[contains(@class,'ap-stack--sm')][1]");
    await webField.getByRole("button", { name: "Kopieren" }).click();
    await expect(webField.getByRole("button", { name: "Kopiert" })).toBeVisible();
    await expect(
      webField.getByRole("status").filter({ hasText: "wurde in die Zwischenablage kopiert" }),
    ).toHaveCount(1);
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(webUrl);
  });

  test("Feed anlegen: Validierung, privat mit Gruppe, danach geöffnet in der Liste", async ({
    page,
    request,
  }) => {
    const s = await seed(request, "Feeds Neu");
    await s.post("target-groups", { name: "Jugend" });
    await s.post("target-groups", { name: "Erwachsene" });
    await openFeeds(page, s.email, `${s.feedsPath}/new`);

    // Validierung mit Fehlerzusammenfassung
    await page.getByRole("button", { name: "Feed speichern" }).click();
    const alert = page.getByRole("alert");
    await expect(alert).toContainText("Bitte gib einen Namen für den Feed ein.");
    await alert.getByRole("link", { name: "Bitte gib einen Namen für den Feed ein." }).click();
    await expect(page.getByLabel(/^Name/)).toBeFocused();
    expect(await listFeeds(request, s)).toHaveLength(0);

    // Anlegen: privat, nur Jugend
    await page.getByLabel(/^Name/).fill("Jugend-Abo");
    await page.getByRole("radio", { name: /Privat/ }).check();
    await page.getByRole("button", { name: "Jugend" }).click();
    await expect(page.getByRole("button", { name: "Jugend" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await page.getByRole("button", { name: "Feed speichern" }).click();
    await expect(page).toHaveURL(new RegExp(`${s.feedsPath}$`));
    await expect(page.getByText("Feed „Jugend-Abo“ angelegt.")).toBeVisible();

    const feeds = await listFeeds(request, s);
    expect(feeds).toHaveLength(1);
    expect(feeds[0]).toMatchObject({ name: "Jugend-Abo", visibility: "PRIVATE" });
    expect(feeds[0].targetGroups).toHaveLength(1);

    // Der neue Feed ist aufgeklappt, mit Geheimnis
    const card = page.getByRole("region", { name: "Jugend-Abo" });
    await expect(card.locator(".ap-badge")).toHaveText("Privat");
    await expect(card.getByLabel("Adresse der Webansicht")).toHaveValue(/secret=/);
    await expect(card.getByRole("group", { name: "Gruppen von Jugend-Abo" })).toContainText(
      "Jugend",
    );
  });

  test("Feed bearbeiten: umbenennen, Sichtbarkeit und Gruppen ändern, Verwerfen-Dialog", async ({
    page,
    request,
  }) => {
    const s = await seed(request, "Feeds Edit");
    const group = await s.post("target-groups", { name: "Senioren" });
    const created = await s.createFeed({ name: "Alt", visibility: "PUBLIC" });
    await openFeeds(page, s.email, `${s.feedsPath}/${created.id}`);
    await expect(page.getByRole("heading", { level: 1, name: "Feed bearbeiten" })).toBeVisible();
    await expect(page.getByLabel(/^Name/)).toHaveValue("Alt");
    await expect(page.getByRole("radio", { name: /Öffentlich/ })).toBeChecked();
    // Öffentliche Feeds haben kein Geheimnis-Panel
    await expect(page.getByRole("heading", { name: "Geheimnis" })).toHaveCount(0);

    // Ungespeicherte Änderungen: Abbrechen fragt nach
    await page.getByLabel(/^Name/).fill("Neu");
    await page.getByRole("link", { name: "Abbrechen" }).click();
    const discard = page.getByRole("alertdialog", { name: "Änderungen verwerfen?" });
    await expect(discard).toBeVisible();
    await discard.getByRole("button", { name: "Weiter bearbeiten" }).click();
    await expect(page.getByLabel(/^Name/)).toHaveValue("Neu");

    await page.getByRole("radio", { name: /Privat/ }).check();
    await page.getByRole("button", { name: "Senioren" }).click();
    await page.getByRole("button", { name: "Feed speichern" }).click();
    await expect(page).toHaveURL(new RegExp(`${s.feedsPath}$`));
    const [saved] = await listFeeds(request, s);
    expect(saved).toMatchObject({ name: "Neu", visibility: "PRIVATE" });
    expect(saved.targetGroups).toEqual([{ feedId: created.id, targetGroupId: group.id }]);

    // Jetzt hat der Feed ein Geheimnis-Panel
    await page.getByRole("link", { name: "Feed „Neu“ bearbeiten" }).click();
    await expect(page.getByRole("heading", { name: "Geheimnis" })).toBeVisible();
  });

  test("Feed je Status anlegen: Standard nur per Link, Liste und Webansicht", async ({
    page,
    request,
  }) => {
    const s = await seed(request, "Feeds Status");
    await openFeeds(page, s.email, `${s.feedsPath}/new`);
    const group = page.getByRole("group", { name: "Sichtbarkeit" });

    // Standard: nur per Link
    await expect(group.getByRole("radio", { name: /^Nur per Link/ })).toBeChecked();
    await page.getByLabel(/^Name/).fill("Mitglieder");
    await page.getByRole("button", { name: "Feed speichern" }).click();
    await expect(page.getByText("Feed „Mitglieder“ angelegt.")).toBeVisible();

    // Öffentlich (von Suchmaschinen auffindbar)
    await page.getByRole("main").getByRole("link", { name: "Feed anlegen" }).first().click();
    await page.getByLabel(/^Name/).fill("Für alle");
    await group.getByRole("radio", { name: /^Öffentlich/ }).check();
    await page.getByRole("button", { name: "Feed speichern" }).click();
    await expect(page.getByText("Feed „Für alle“ angelegt.")).toBeVisible();

    // Privat
    await page.getByRole("main").getByRole("link", { name: "Feed anlegen" }).first().click();
    await page.getByLabel(/^Name/).fill("Vorstand");
    await group.getByRole("radio", { name: /^Öffentlich/ }).check();
    await group.getByRole("radio", { name: /^Privat \(geschützt\)/ }).check();
    await page.getByRole("button", { name: "Feed speichern" }).click();
    await expect(page.getByText("Feed „Vorstand“ angelegt.")).toBeVisible();

    const byName = Object.fromEntries((await listFeeds(request, s)).map((f) => [f.name, f]));
    expect(byName["Mitglieder"]).toMatchObject({ visibility: "CLUB", indexable: false });
    expect(byName["Für alle"]).toMatchObject({ visibility: "PUBLIC", indexable: true });
    expect(byName["Vorstand"]).toMatchObject({ visibility: "PRIVATE", indexable: false });

    // Liste: Wort + Icon je Status
    const badges = (name: string) => page.getByRole("region", { name }).locator(".ap-badge");
    await expect(badges("Mitglieder")).toHaveText(["Nur per Link"]);
    await expect(badges("Für alle")).toHaveText(["Öffentlich"]);
    await expect(badges("Vorstand")).toHaveText(["Privat"]);
    for (const name of ["Mitglieder", "Für alle", "Vorstand"])
      await expect(badges(name).locator("svg")).toHaveCount(1);

    // Adressen: nur per Link ohne, privat mit Geheimnis
    const club = page.getByRole("region", { name: "Mitglieder" });
    if ((await club.getByLabel("Adresse der Webansicht").count()) === 0)
      await club.getByRole("button", { name: "Zugänge anzeigen" }).click();
    const clubWeb = await club.getByLabel("Adresse der Webansicht").inputValue();
    expect(clubWeb).not.toContain("secret=");
    const priv = page.getByRole("region", { name: "Vorstand" });
    if ((await priv.getByLabel("Adresse der Webansicht").count()) === 0)
      await priv.getByRole("button", { name: "Zugänge anzeigen" }).click();
    await expect(priv.getByLabel("Adresse der Webansicht")).toHaveValue(/secret=[0-9a-f]{32}$/);

    // Webansicht: nur per Link noindex, öffentlich ohne
    await page.goto(new URL(clubWeb).pathname);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
    await page.goto(`/feed/${byName["Für alle"].id}`);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.locator('meta[name="robots"]')).toHaveCount(0);
    // Privat ohne Geheimnis: geschützt
    await page.goto(`/feed/${byName["Vorstand"].id}`);
    await expect(
      page.getByRole("heading", { level: 1, name: "Dieser Kalender ist privat" }),
    ).toBeVisible();
  });

  test("Wechsel privat → nur per Link verlangt eine Bestätigung, danach ohne Geheimnis erreichbar", async ({
    page,
    request,
  }) => {
    const s = await seed(request, "Feeds Wechsel");
    const created = await s.createFeed({ name: "Vorstand", visibility: "PRIVATE" });
    const openIcs = `${API}/api/feed/${created.id}/ics`;
    expect((await request.get(openIcs)).status()).toBe(403);

    await openFeeds(page, s.email, `${s.feedsPath}/${created.id}`);
    await expect(page.getByRole("heading", { name: "Geheimnis" })).toBeVisible();
    await page.getByRole("radio", { name: /^Nur per Link/ }).check();
    await page.getByRole("button", { name: "Feed speichern" }).click();
    const dialog = page.getByRole("alertdialog", { name: "Geheimnis nicht mehr verlangen?" });
    await expect(dialog).toContainText("„Vorstand“ wird auf „Nur per Link“ gestellt.");
    await expect(dialog).toContainText(
      "Danach kann jeder mit dem Link den Kalender sehen, auch wer den bisherigen Link mit Geheimnis nicht kennt.",
    );
    await expect(dialog.getByRole("button", { name: "Abbrechen" })).toBeFocused();
    await dialog.getByRole("button", { name: "Abbrechen" }).click();
    await expect(dialog).toHaveCount(0);
    expect((await listFeeds(request, s))[0].visibility).toBe("PRIVATE");

    await page.getByRole("button", { name: "Feed speichern" }).click();
    await page
      .getByRole("alertdialog")
      .getByRole("button", { name: "Ohne Geheimnis speichern" })
      .click();
    await expect(page).toHaveURL(new RegExp(`${s.feedsPath}$`));
    await expect(page.getByRole("region", { name: "Vorstand" }).locator(".ap-badge")).toHaveText(
      "Nur per Link",
    );
    expect((await listFeeds(request, s))[0]).toMatchObject({
      visibility: "CLUB",
      indexable: false,
    });
    expect((await request.get(openIcs)).status()).toBe(200);
    // Kein Geheimnis-Panel mehr
    await page.getByRole("link", { name: "Feed „Vorstand“ bearbeiten" }).click();
    await expect(page.getByLabel(/^Name/)).toHaveValue("Vorstand");
    await expect(page.getByRole("heading", { name: "Geheimnis" })).toHaveCount(0);
  });

  test("Geheimnis neu erzeugen: Bestätigung nennt die Folgen, alte Adresse funktioniert nicht mehr", async ({
    page,
    request,
  }) => {
    const s = await seed(request, "Feeds Geheimnis");
    const created = await s.createFeed(
      { name: "Intern", visibility: "PRIVATE" },
      "?includeSecret=1",
    );
    const oldIcs = `${API}/api/feed/${created.id}/ics?secret=${created.sharedSecret}`;
    expect((await request.get(oldIcs)).status()).toBe(200);

    await openFeeds(page, s.email, `${s.feedsPath}/${created.id}`);
    const secret = page.getByRole("textbox", { name: "Geheimnis" });
    await expect(secret).toHaveValue(/^•+$/);

    await page.getByRole("button", { name: "Geheimnis neu erzeugen" }).click();
    const dialog = page.getByRole("alertdialog", { name: "Geheimnis neu erzeugen?" });
    await expect(dialog).toContainText("Bestehende Abonnements werden unterbrochen.");
    // Fokus liegt im Dialog auf "Abbrechen"; Tab bleibt im Dialog (Fokusfalle)
    await expect(dialog.getByRole("button", { name: "Abbrechen" })).toBeFocused();
    for (let i = 0; i < 4; i++) {
      await page.keyboard.press("Tab");
      await expect
        .poll(() => dialog.evaluate((el) => el.contains(document.activeElement)))
        .toBe(true);
    }
    // Abbrechen ändert nichts
    await dialog.getByRole("button", { name: "Abbrechen" }).click();
    await expect(dialog).toHaveCount(0);
    expect((await listFeeds(request, s))[0].sharedSecret).toBe(created.sharedSecret);

    // Bestätigen
    await page.getByRole("button", { name: "Geheimnis neu erzeugen" }).click();
    await page
      .getByRole("alertdialog")
      .getByRole("button", { name: "Geheimnis neu erzeugen" })
      .click();
    await expect(page.getByText(/Neues Geheimnis erzeugt/)).toBeVisible();
    const [after] = await listFeeds(request, s);
    expect(after.sharedSecret).not.toBe(created.sharedSecret);
    // Die angezeigte Adresse gehört zum neuen Geheimnis, die alte ist ungültig
    await expect(page.getByLabel("Adresse der Webansicht")).toHaveValue(
      new RegExp(`secret=${after.sharedSecret}$`),
    );
    expect((await request.get(oldIcs)).status()).not.toBe(200);
    expect(
      (
        await request.get(`${API}/api/feed/${created.id}/ics?secret=${after.sharedSecret}`)
      ).status(),
    ).toBe(200);
  });

  test("Feed löschen aus der Liste und von der Bearbeiten-Seite", async ({ page, request }) => {
    const s = await seed(request, "Feeds Löschen");
    for (const name of ["Eins", "Zwei"]) {
      await s.createFeed({ name, visibility: "PUBLIC" });
    }
    await openFeeds(page, s.email, `${s.feedsPath}`);

    // Liste: Bestätigung mit Folgen, Abbrechen löscht nichts
    await page.getByRole("button", { name: "Feed „Eins“ löschen" }).click();
    const dialog = page.getByRole("alertdialog", { name: "Feed „Eins“ löschen?" });
    await expect(dialog).toContainText("Wer den Feed abonniert hat, bekommt keine Updates mehr.");
    await dialog.getByRole("button", { name: "Abbrechen" }).click();
    expect(await listFeeds(request, s)).toHaveLength(2);
    await page.getByRole("button", { name: "Feed „Eins“ löschen" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Feed löschen" }).click();
    await expect(page.getByText("Feed „Eins“ gelöscht.")).toBeVisible();
    await expect(page.getByRole("region", { name: "Eins" })).toHaveCount(0);
    expect(await listFeeds(request, s)).toHaveLength(1);

    // Bearbeiten-Seite
    await page.getByRole("link", { name: "Feed „Zwei“ bearbeiten" }).click();
    await page.getByRole("button", { name: "Feed löschen" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Feed löschen" }).click();
    await expect(page).toHaveURL(new RegExp(`${s.feedsPath}$`));
    await expect(page.getByRole("heading", { name: "Noch kein Feed" })).toBeVisible();
    expect(await listFeeds(request, s)).toHaveLength(0);
  });

  test("Feed über zwei Kalender: Webansicht und ICS enthalten beide, Feedname als Überschrift", async ({
    page,
    request,
  }) => {
    const s = await seed(request, "Feeds Zwei");
    const second = await (
      await request.post(`${API}/api/clubs/${s.clubId}/calendars`, {
        headers: s.headers,
        data: { name: "Jugendkalender" },
      })
    ).json();
    const addEvent = async (calendarId: string, name: string, date: string) => {
      const res = await request.post(`${API}/api/calendars/${calendarId}/events`, {
        headers: s.headers,
        data: {
          name,
          date,
          timeBegin: "19:00",
          timeEnd: "21:00",
          timezone: "Europe/Berlin",
          isDraft: false,
        },
      });
      expect(res.ok(), await res.text()).toBeTruthy();
    };
    await addEvent(s.calendarId, "Schießabend Hauptkalender", "2026-10-08");
    await addEvent(second.id, "Zeltlager Jugendkalender", "2026-10-15");
    // A third calendar the feed does not contain: its event must not appear
    const third = await (
      await request.post(`${API}/api/clubs/${s.clubId}/calendars`, {
        headers: s.headers,
        data: { name: "Intern" },
      })
    ).json();
    await addEvent(third.id, "Nur intern", "2026-10-20");

    // Anlegen im Formular: neue Feeds wählen alle aktiven Kalender vor, hier einen abwählen
    await openFeeds(page, s.email, `${s.feedsPath}/new`);
    const calendars = page.getByRole("group", { name: "Kalender" });
    await expect(calendars.getByRole("button", { name: s.calendarName })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(calendars.getByRole("button", { name: "Jugendkalender" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await calendars.getByRole("button", { name: "Intern" }).click();
    await expect(calendars.getByRole("button", { name: "Intern" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    await page.getByLabel(/^Name/).fill("Gesamtprogramm");
    await page.getByRole("radio", { name: /^Öffentlich/ }).check();
    await page.getByRole("button", { name: "Feed speichern" }).click();
    await expect(page.getByText("Feed „Gesamtprogramm“ angelegt.")).toBeVisible();

    const [feed] = await listFeeds(request, s);
    expect(feed.name).toBe("Gesamtprogramm");
    const card = page.getByRole("region", { name: "Gesamtprogramm" });
    await expect(card.getByRole("group", { name: "Kalender von Gesamtprogramm" })).toContainText(
      "Jugendkalender",
    );

    // Webansicht ohne Anmeldung: Feedname als Überschrift, Termine beider Kalender
    await page.goto(`/feed/${feed.id}?date=2026-10-08`);
    await expect(page.getByRole("heading", { level: 1, name: "Gesamtprogramm" })).toBeVisible();
    await expect(page.getByText("Zeige 2 von 2 Terminen")).toBeVisible();
    await expect(page.getByText("Schießabend Hauptkalender").first()).toBeVisible();
    await expect(page.getByText("Zeltlager Jugendkalender").first()).toBeVisible();
    await expect(page.getByText("Nur intern")).toHaveCount(0);

    // ICS: beide Termine, nicht der des dritten Kalenders
    const icsRes = await request.get(`${API}/api/feed/${feed.id}/ics`);
    expect(icsRes.status()).toBe(200);
    const ics = await icsRes.text();
    expect(ics).toContain("Schießabend Hauptkalender");
    expect(ics).toContain("Zeltlager Jugendkalender");
    expect(ics).not.toContain("Nur intern");
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(2);
  });

  test("Bearbeiter sehen Feeds nur lesbar, Betrachter gar nicht", async ({ page, request }) => {
    const s = await seed(request, "Feeds Rollen");
    await s.createFeed({ name: "Verbandsfeed", visibility: "PUBLIC" });
    const editor = await createVerifiedUser(request, "Feeds Bearbeiter");
    await inviteAndAccept(request, s.clubId, s.headers, editor, "editor");
    await openFeeds(page, editor, s.feedsPath);
    await expect(page.getByRole("region", { name: "Verbandsfeed" })).toBeVisible();
    await expect(
      page.getByText("Nur Vereins-Admins können Feeds anlegen oder ändern."),
    ).toBeVisible();
    await expect(page.getByRole("link", { name: "Feed anlegen" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /löschen/ })).toHaveCount(0);
    await expect(page.getByRole("link", { name: /bearbeiten/ })).toHaveCount(0);
    await expect(page.getByLabel("Adresse der Webansicht")).toBeVisible();

    const viewer = await createVerifiedUser(request, "Feeds Betrachter");
    await inviteAndAccept(request, s.clubId, s.headers, viewer, "viewer");
    await page.context().clearCookies();
    await page.evaluate(() => sessionStorage.clear());
    await openFeeds(page, viewer, s.feedsPath);
    await expect(
      page.getByRole("heading", { name: "Feeds sind für deine Rolle nicht verfügbar" }),
    ).toBeVisible();
  });
});
