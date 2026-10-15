import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
import { API, createVerifiedUser, login, seedClub } from "./helpers";

// ——— Veröffentlichen (phase 7): Feedliste, Feed anlegen/bearbeiten, Geheimnis neu erzeugen, löschen ———

async function seed(request: APIRequestContext, name: string) {
  const email = await createVerifiedUser(request, name);
  const { clubId, calendarId, headers } = await seedClub(request, email, `${name} Verein`);
  const base = `/clubs/${clubId}/calendars/${calendarId}`;
  const post = async (path: string, data: object) =>
    (await request.post(`${API}/api/calendars/${calendarId}/${path}`, { headers, data })).json();
  return { email, clubId, calendarId, headers, base, post, calendarName: `${name} Verein Termine` };
}

async function openFeeds(page: Page, email: string, path: string) {
  await login(page, email);
  await page.waitForURL(/\/clubs/);
  await page.goto(path);
}

async function listFeeds(request: APIRequestContext, s: Awaited<ReturnType<typeof seed>>) {
  return (
    await request.get(`${API}/api/calendars/${s.calendarId}/feeds`, { headers: s.headers })
  ).json() as Promise<
    {
      id: string;
      name: string;
      visibility: string;
      searchable: boolean;
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
    await expect(page).toHaveURL(new RegExp(`${s.base}/settings/feeds$`));
    await expect(page.getByRole("heading", { level: 1, name: "Veröffentlichen" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Noch kein Feed" })).toBeVisible();
    await expect(page.getByText(`${s.calendarName} · 0 Feeds`)).toBeVisible();
    await page.getByRole("main").getByRole("link", { name: "Feed anlegen" }).first().click();
    await expect(page).toHaveURL(new RegExp(`/settings/feeds/new$`));
    await expect(page.getByRole("heading", { level: 1, name: "Feed anlegen" })).toBeFocused();
  });

  test("Feedliste: Sichtbarkeit als Wort, Zugänge, maskiertes Geheimnis, ICS-Abruf", async ({
    page,
    request,
  }) => {
    const s = await seed(request, "Feeds Liste");
    const group = await s.post("target-groups", { name: "Jugend" });
    await request.post(`${API}/api/calendars/${s.calendarId}/feeds`, {
      headers: s.headers,
      data: { name: "Öffentlicher Kalender", visibility: "PUBLIC" },
    });
    await request.post(`${API}/api/calendars/${s.calendarId}/feeds`, {
      headers: s.headers,
      data: { name: "Vorstand intern", visibility: "PRIVATE", targetGroupIds: [group.id] },
    });
    await openFeeds(page, s.email, `${s.base}/settings/feeds`);
    await expect(page.getByText(`${s.calendarName} · 2 Feeds`)).toBeVisible();

    const pub = page.getByRole("region", { name: "Öffentlicher Kalender" });
    const priv = page.getByRole("region", { name: "Vorstand intern" });
    // Sichtbarkeit: Wort + Icon, keine Emojis
    await expect(pub.locator(".ap-badge")).toHaveText("Öffentlich");
    await expect(priv.locator(".ap-badge")).toHaveText("Privat");
    await expect(pub.locator(".ap-badge svg")).toBeVisible();
    expect(await pub.innerText()).not.toMatch(/[\u{1F310}\u{1F512}]/u);
    await expect(pub).toContainText("Alle Zielgruppen");
    await expect(
      priv.getByRole("group", { name: "Zielgruppen von Vorstand intern" }),
    ).toContainText("Jugend");

    // Der erste Feed ist geöffnet, der zweite nicht
    const ics = pub.getByLabel("ICS-Adresse");
    await expect(ics).toBeVisible();
    await expect(priv.getByLabel("ICS-Adresse")).toHaveCount(0);
    const icsUrl = await ics.inputValue();
    expect(icsUrl).toContain("/api/feed/");
    expect(icsUrl).not.toContain("secret=");
    await expect(pub.getByLabel("Abo-Adresse (webcal)")).toHaveValue(/^webcal:\/\//);
    await expect(pub.getByLabel("Adresse der Webansicht")).toHaveValue(/\/feed\//);
    const res = await request.get(icsUrl);
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toContain("text/calendar");

    // Privater Feed: Geheimnis ist maskiert und nur auf Wunsch sichtbar
    await priv.getByRole("button", { name: "Zugänge anzeigen" }).click();
    const secret = priv.getByRole("textbox", { name: "Geheimnis" });
    await expect(secret).toHaveValue(/^•{16,}$/);
    await priv.getByRole("button", { name: "Geheimnis anzeigen" }).click();
    const secretValue = await secret.inputValue();
    expect(secretValue).toMatch(/^[0-9a-f]{32}$/);
    await expect(priv.getByRole("button", { name: "Geheimnis verbergen" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(priv.getByText(/Wer das Geheimnis kennt, kann den Feed lesen/)).toBeVisible();
    const privIcs = await priv.getByLabel("ICS-Adresse").inputValue();
    expect(privIcs).toContain(`secret=${secretValue}`);
    expect((await request.get(privIcs)).status()).toBe(200);
    expect((await request.get(privIcs.replace(secretValue, "falsch"))).status()).not.toBe(200);

    // Kopieren: Rückmeldung sichtbar und per Statusmeldung angekündigt
    await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
    await pub.getByRole("button", { name: "Kopieren" }).first().click();
    await expect(pub.getByRole("button", { name: "Kopiert" })).toBeVisible();
    await expect(
      pub.getByRole("status").filter({ hasText: "wurde in die Zwischenablage kopiert" }),
    ).toHaveCount(1);
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(icsUrl);
  });

  test("Feed anlegen: Validierung, privat mit Zielgruppe, danach geöffnet in der Liste", async ({
    page,
    request,
  }) => {
    const s = await seed(request, "Feeds Neu");
    await s.post("target-groups", { name: "Jugend" });
    await s.post("target-groups", { name: "Erwachsene" });
    await openFeeds(page, s.email, `${s.base}/settings/feeds/new`);

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
    await expect(page).toHaveURL(new RegExp(`${s.base}/settings/feeds$`));
    await expect(page.getByText("Feed „Jugend-Abo“ angelegt.")).toBeVisible();

    const feeds = await listFeeds(request, s);
    expect(feeds).toHaveLength(1);
    expect(feeds[0]).toMatchObject({ name: "Jugend-Abo", visibility: "PRIVATE" });
    expect(feeds[0].targetGroups).toHaveLength(1);

    // Der neue Feed ist aufgeklappt, mit Geheimnis
    const card = page.getByRole("region", { name: "Jugend-Abo" });
    await expect(card.locator(".ap-badge")).toHaveText("Privat");
    await expect(card.getByLabel("ICS-Adresse")).toHaveValue(/secret=/);
    await expect(card.getByRole("group", { name: "Zielgruppen von Jugend-Abo" })).toContainText(
      "Jugend",
    );
  });

  test("Feed bearbeiten: umbenennen, Sichtbarkeit und Zielgruppen ändern, Verwerfen-Dialog", async ({
    page,
    request,
  }) => {
    const s = await seed(request, "Feeds Edit");
    const group = await s.post("target-groups", { name: "Senioren" });
    const created = await (
      await request.post(`${API}/api/calendars/${s.calendarId}/feeds`, {
        headers: s.headers,
        data: { name: "Alt", visibility: "PUBLIC" },
      })
    ).json();
    await openFeeds(page, s.email, `${s.base}/settings/feeds/${created.id}`);
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
    await expect(page).toHaveURL(new RegExp(`${s.base}/settings/feeds$`));
    const [saved] = await listFeeds(request, s);
    expect(saved).toMatchObject({ name: "Neu", visibility: "PRIVATE" });
    expect(saved.targetGroups).toEqual([{ feedId: created.id, targetGroupId: group.id }]);

    // Jetzt hat der Feed ein Geheimnis-Panel
    await page.getByRole("link", { name: "Feed „Neu“ bearbeiten" }).click();
    await expect(page.getByRole("heading", { name: "Geheimnis" })).toBeVisible();
  });

  test("Feed je Status anlegen: Standard nur per Link, Suchoption nur bei öffentlich, Liste und Webansicht", async ({
    page,
    request,
  }) => {
    const s = await seed(request, "Feeds Status");
    await openFeeds(page, s.email, `${s.base}/settings/feeds/new`);
    const group = page.getByRole("group", { name: "Sichtbarkeit" });
    const searchable = page.getByRole("switch", { name: "Für Suchmaschinen auffindbar" });

    // Standard: nur per Link, keine Suchoption
    await expect(group.getByRole("radio", { name: /^Nur per Link/ })).toBeChecked();
    await expect(searchable).toHaveCount(0);
    await page.getByLabel(/^Name/).fill("Mitglieder");
    await page.getByRole("button", { name: "Feed speichern" }).click();
    await expect(page.getByText("Feed „Mitglieder“ angelegt.")).toBeVisible();

    // Öffentlich und auffindbar
    await page.getByRole("main").getByRole("link", { name: "Feed anlegen" }).first().click();
    await page.getByLabel(/^Name/).fill("Für alle");
    await group.getByRole("radio", { name: /^Öffentlich/ }).check();
    await expect(searchable).toHaveAttribute("aria-checked", "false");
    await searchable.click();
    await expect(searchable).toHaveAttribute("aria-checked", "true");
    await page.getByRole("button", { name: "Feed speichern" }).click();
    await expect(page.getByText("Feed „Für alle“ angelegt.")).toBeVisible();

    // Privat: Schalter verschwindet
    await page.getByRole("main").getByRole("link", { name: "Feed anlegen" }).first().click();
    await page.getByLabel(/^Name/).fill("Vorstand");
    await group.getByRole("radio", { name: /^Öffentlich/ }).check();
    await expect(searchable).toBeVisible();
    await group.getByRole("radio", { name: /^Privat \(geschützt\)/ }).check();
    await expect(searchable).toHaveCount(0);
    await page.getByRole("button", { name: "Feed speichern" }).click();
    await expect(page.getByText("Feed „Vorstand“ angelegt.")).toBeVisible();

    const byName = Object.fromEntries((await listFeeds(request, s)).map((f) => [f.name, f]));
    expect(byName["Mitglieder"]).toMatchObject({ visibility: "CLUB", searchable: false });
    expect(byName["Für alle"]).toMatchObject({ visibility: "PUBLIC", searchable: true });
    expect(byName["Vorstand"]).toMatchObject({ visibility: "PRIVATE", searchable: false });

    // Liste: Wort + Icon je Status, "Auffindbar" nur beim öffentlichen Feed mit Suchoption
    const badges = (name: string) => page.getByRole("region", { name }).locator(".ap-badge");
    await expect(badges("Mitglieder")).toHaveText(["Nur per Link"]);
    await expect(badges("Für alle")).toHaveText(["Öffentlich", "Auffindbar"]);
    await expect(badges("Vorstand")).toHaveText(["Privat"]);
    for (const name of ["Mitglieder", "Für alle", "Vorstand"])
      await expect(badges(name).locator("svg")).toHaveCount(name === "Für alle" ? 2 : 1);

    // Adressen: nur per Link ohne, privat mit Geheimnis
    const club = page.getByRole("region", { name: "Mitglieder" });
    if ((await club.getByLabel("ICS-Adresse").count()) === 0)
      await club.getByRole("button", { name: "Zugänge anzeigen" }).click();
    const clubWeb = await club.getByLabel("Adresse der Webansicht").inputValue();
    expect(clubWeb).not.toContain("secret=");
    expect((await request.get(await club.getByLabel("ICS-Adresse").inputValue())).status()).toBe(
      200,
    );
    const priv = page.getByRole("region", { name: "Vorstand" });
    if ((await priv.getByLabel("ICS-Adresse").count()) === 0)
      await priv.getByRole("button", { name: "Zugänge anzeigen" }).click();
    await expect(priv.getByLabel("ICS-Adresse")).toHaveValue(/secret=[0-9a-f]{32}$/);

    // Webansicht: nur per Link noindex, öffentlich + auffindbar ohne
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
    const created = await (
      await request.post(`${API}/api/calendars/${s.calendarId}/feeds`, {
        headers: s.headers,
        data: { name: "Vorstand", visibility: "PRIVATE" },
      })
    ).json();
    const openIcs = `${API}/api/feed/${created.id}/ics`;
    expect((await request.get(openIcs)).status()).toBe(403);

    await openFeeds(page, s.email, `${s.base}/settings/feeds/${created.id}`);
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
    await expect(page).toHaveURL(new RegExp(`${s.base}/settings/feeds$`));
    await expect(page.getByRole("region", { name: "Vorstand" }).locator(".ap-badge")).toHaveText(
      "Nur per Link",
    );
    expect((await listFeeds(request, s))[0]).toMatchObject({
      visibility: "CLUB",
      searchable: false,
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
    const created = await (
      await request.post(`${API}/api/calendars/${s.calendarId}/feeds`, {
        headers: s.headers,
        data: { name: "Intern", visibility: "PRIVATE" },
      })
    ).json();
    const oldIcs = `${API}/api/feed/${created.id}/ics?secret=${created.sharedSecret}`;
    expect((await request.get(oldIcs)).status()).toBe(200);

    await openFeeds(page, s.email, `${s.base}/settings/feeds/${created.id}`);
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
    await expect(page.getByLabel("ICS-Adresse")).toHaveValue(
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
      await request.post(`${API}/api/calendars/${s.calendarId}/feeds`, {
        headers: s.headers,
        data: { name, visibility: "PUBLIC" },
      });
    }
    await openFeeds(page, s.email, `${s.base}/settings/feeds`);

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
    await expect(page).toHaveURL(new RegExp(`${s.base}/settings/feeds$`));
    await expect(page.getByRole("heading", { name: "Noch kein Feed" })).toBeVisible();
    expect(await listFeeds(request, s)).toHaveLength(0);
  });

  test("Archivierter Kalender: Feeds nur lesbar", async ({ page, request }) => {
    const s = await seed(request, "Feeds Archiv");
    await request.post(`${API}/api/calendars/${s.calendarId}/feeds`, {
      headers: s.headers,
      data: { name: "Archivfeed", visibility: "PUBLIC" },
    });
    const archive = await request.post(
      `${API}/api/clubs/${s.clubId}/calendars/${s.calendarId}/archive`,
      { headers: s.headers, data: {} },
    );
    expect(archive.ok()).toBeTruthy();
    await openFeeds(page, s.email, `${s.base}/settings/feeds`);
    await expect(page.getByText("Archiviert, schreibgeschützt").first()).toBeVisible();
    await expect(page.getByRole("link", { name: "Feed anlegen" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /löschen/ })).toHaveCount(0);
    await expect(page.getByLabel("ICS-Adresse")).toBeVisible();
    await page.getByRole("button", { name: "Archivierung aufheben" }).click();
    await expect(page.getByText("Archivierung aufgehoben.")).toBeVisible();
    await expect(page.getByRole("link", { name: "Feed anlegen" }).first()).toBeVisible();
  });
});
