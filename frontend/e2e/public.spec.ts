import { test, expect, type APIRequestContext } from "@playwright/test";
import { API, createVerifiedUser, seedClub } from "./helpers";

// ——— Öffentlicher Zugriff (phase 8): Feed ohne Anmeldung, privater Feed mit Geheimnis, Termin-Detail ———

interface PublicSeed {
  /** PUBLIC with the search engine option: the only indexable kind. */
  publicFeedId: string;
  /** CLUB ("Nur per Link"): open by link, noindex. */
  clubFeedId: string;
  privateFeedId: string;
  secret: string;
  draftEventId: string;
  herbstfestId: string;
  feedName: string;
  /** The page header shows club and calendar (design: Public), the feed name is the page title. */
  clubName: string;
  calendarName: string;
}

async function seedPublic(request: APIRequestContext, name: string): Promise<PublicSeed> {
  const email = await createVerifiedUser(request, name);
  const { calendarId, headers } = await seedClub(request, email, `${name} Verein`);
  const post = async (path: string, data: object) => {
    const res = await request.post(`${API}/api/calendars/${calendarId}/${path}`, { headers, data });
    expect(res.ok(), `${path}: ${res.status()}`).toBeTruthy();
    return (await res.json()) as { id: string };
  };
  const youth = (await post("target-groups", { name: "Jugend" })).id;
  const adults = (await post("target-groups", { name: "Erwachsene" })).id;
  const draftMarker = (await post("properties", { name: "Draußen", icon: "🌳" })).id;
  const feature = (await post("features", { name: "Getränkeverkauf" })).id;
  const place = (
    await post("locations", {
      name: "Vereinsheim Mitte",
      street: "Marktplatz 5",
      zip: "12345",
      city: "Musterstadt",
      latitude: 50.5,
      longitude: 8.25,
    })
  ).id;
  const base = {
    timeBegin: "19:00",
    timeEnd: "21:00",
    isDraft: false,
    timezone: "Europe/Berlin",
  };
  await post("events", {
    ...base,
    name: "Training Luftgewehr",
    date: "2026-10-08",
    targetGroupIds: [adults],
  });
  await post("events", {
    ...base,
    name: "Jugendtraining",
    date: "2026-10-08",
    timeBegin: "18:00",
    timeEnd: "19:30",
    targetGroupIds: [youth],
  });
  const herbstfest = await post("events", {
    ...base,
    name: "Herbstfest",
    date: "2026-10-24",
    timeBegin: "15:00",
    timeEnd: "22:00",
    locationId: place,
    propertyIds: [draftMarker],
    featureIds: [feature],
    targetGroupIds: [youth, adults],
  });
  const draft = await post("events", {
    ...base,
    name: "Geheimer Entwurf",
    date: "2026-10-12",
    isDraft: true,
    targetGroupIds: [adults],
  });
  const publicFeed = (await (
    await request.post(`${API}/api/calendars/${calendarId}/feeds`, {
      headers,
      data: { name: "Schießbetrieb 2026", visibility: "PUBLIC", searchable: true },
    })
  ).json()) as { id: string };
  const clubFeed = (await (
    await request.post(`${API}/api/calendars/${calendarId}/feeds`, {
      headers,
      data: { name: "Mitglieder", visibility: "CLUB" },
    })
  ).json()) as { id: string };
  const privateFeed = (await (
    await request.post(`${API}/api/calendars/${calendarId}/feeds`, {
      headers,
      data: { name: "Vorstand intern", visibility: "PRIVATE" },
    })
  ).json()) as { id: string };
  const feeds = (await (
    await request.get(`${API}/api/calendars/${calendarId}/feeds?includeSecret=1`, { headers })
  ).json()) as { id: string; sharedSecret: string }[];
  const secret = feeds.find((f) => f.id === privateFeed.id)!.sharedSecret;
  return {
    publicFeedId: publicFeed.id,
    clubFeedId: clubFeed.id,
    privateFeedId: privateFeed.id,
    secret,
    draftEventId: draft.id,
    herbstfestId: herbstfest.id,
    feedName: "Schießbetrieb 2026",
    clubName: `${name} Verein`,
    calendarName: `${name} Verein Termine`,
  };
}

let seed: PublicSeed;

test.describe("Öffentlicher Kalender", () => {
  test.use({ locale: "de-DE", timezoneId: "Europe/Berlin" });

  test.beforeAll(async ({ playwright }) => {
    const request = await playwright.request.newContext();
    seed = await seedPublic(request, "Public");
    await request.dispose();
  });

  test("öffentlicher Feed ohne Anmeldung: Kopf, Abo, Monat, Fußzeile, keine App-Navigation", async ({
    page,
  }) => {
    await page.goto(`/feed/${seed.publicFeedId}?date=2026-10-08`);
    await expect(page.getByRole("heading", { level: 1, name: seed.clubName })).toBeVisible();
    await expect(page.getByRole("heading", { level: 2, name: "Oktober 2026" })).toBeVisible();
    // Header from the API: club, calendar, zone of the calendar / club
    await expect(page.getByText(seed.calendarName, { exact: true })).toBeVisible();
    await expect(
      page.getByText("Alle Uhrzeiten gelten in der Zeitzone Europe/Berlin."),
    ).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Bereiche" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Anmelden" })).toHaveCount(0);
    await expect(page).toHaveURL(new RegExp(`/feed/${seed.publicFeedId}`));
    const sub = page.getByRole("link", { name: "Kalender abonnieren" });
    await expect(sub).toHaveAttribute("href", /^webcal:\/\/.*\/api\/feed\/.*\/ics$/);
    await expect(page.getByRole("link", { name: "Als ICS-Datei laden" })).toHaveAttribute(
      "href",
      /^https?:\/\/.*\/api\/feed\/.*\/ics$/,
    );
    await expect(page.getByText("Bereitgestellt mit Club Calendar")).toBeVisible();
    await expect(page.getByRole("grid")).toBeVisible();
    await expect(page.getByText("Zeige 3 von 3 Terminen")).toBeVisible();
    // Abo-Adresse zum Kopieren
    await page.getByText("Abo-Adresse anzeigen").click();
    await expect(page.getByLabel("Adresse zum Abonnieren (ICS)")).toHaveValue(
      /\/api\/feed\/.*\/ics$/,
    );
    // Öffentlich und auffindbar: indexierbar, aber nie mit Referrer
    await expect(page.locator('meta[name="referrer"]')).toHaveAttribute("content", "no-referrer");
    await expect(page.locator('meta[name="robots"]')).toHaveCount(0);
    await expect(page).toHaveTitle(`${seed.feedName} – Öffentlicher Kalender`);
  });

  test("Suchmaschinen: nur öffentlich + auffindbar ist indexierbar (Meta und X-Robots-Tag)", async ({
    page,
    request,
  }) => {
    // Nur per Link: ohne Geheimnis erreichbar, aber noindex
    await page.goto(`/feed/${seed.clubFeedId}?date=2026-10-08`);
    await expect(page.getByRole("heading", { level: 1, name: seed.clubName })).toBeVisible();
    await expect(page.getByText("Zeige 3 von 3 Terminen")).toBeVisible();
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
    await expect(page.getByRole("link", { name: "Kalender abonnieren" })).toHaveAttribute(
      "href",
      /\/api\/feed\/.*\/ics$/,
    );
    // Termin eines nur per Link erreichbaren Feeds: ebenfalls noindex
    await page.goto(`/feed/${seed.clubFeedId}/events/${seed.herbstfestId}`);
    await expect(page.getByRole("heading", { level: 1, name: "Herbstfest" })).toBeVisible();
    await expect(page.locator('meta[name="robots"]').last()).toHaveAttribute("content", /noindex/);
    // Termin eines indexierbaren Feeds: kein noindex
    await page.goto(`/feed/${seed.publicFeedId}/events/${seed.herbstfestId}`);
    await expect(page.getByRole("heading", { level: 1, name: "Herbstfest" })).toBeVisible();
    await expect(page.locator('meta[name="robots"]')).toHaveCount(0);

    // Die Feed-API entscheidet gleich (X-Robots-Tag), Referrer-Policy immer
    const header = async (path: string) => {
      const res = await request.get(`${API}/api/feed/${path}`);
      return [res.status(), res.headers()["x-robots-tag"], res.headers()["referrer-policy"]];
    };
    for (const path of ["events", "ics", `events/${seed.herbstfestId}`]) {
      expect(await header(`${seed.publicFeedId}/${path}`)).toEqual([200, undefined, "no-referrer"]);
      expect(await header(`${seed.clubFeedId}/${path}`)).toEqual([200, "noindex", "no-referrer"]);
      expect(await header(`${seed.privateFeedId}/${path}`)).toEqual([
        403,
        "noindex",
        "no-referrer",
      ]);
      expect(await header(`${seed.privateFeedId}/${path}?secret=${seed.secret}`)).toEqual([
        200,
        "noindex",
        "no-referrer",
      ]);
    }
    expect(await header("unbekannt/events")).toEqual([404, "noindex", "no-referrer"]);
  });

  test("lädt nur den sichtbaren Monat und den geöffneten Termin einzeln", async ({ page }) => {
    const apiCalls: string[] = [];
    page.on("request", (req) => {
      if (req.url().includes("/api/feed/")) apiCalls.push(req.url());
    });
    await page.goto(`/feed/${seed.publicFeedId}?date=2026-10-08&view=list`);
    await expect(page.getByRole("heading", { level: 1, name: seed.clubName })).toBeVisible();
    expect(apiCalls.some((u) => u.includes("/events?from=2026-09-28&to=2026-11-01"))).toBe(true);
    await page
      .getByRole("region", { name: "Termine im Oktober 2026" })
      .getByRole("button", { name: "Herbstfest" })
      .click();
    await expect(page.getByRole("dialog", { name: "Herbstfest" })).toBeVisible();
    await expect
      .poll(() => apiCalls.some((u) => u.includes(`/events/${seed.herbstfestId}`)))
      .toBe(true);
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Nächster Monat" }).click();
    await expect(page.getByRole("heading", { level: 2, name: "November 2026" })).toBeVisible();
    await expect
      .poll(() => apiCalls.some((u) => u.includes("/events?from=2026-10-26&to=2026-12-06")))
      .toBe(true);
  });

  test("Entwürfe sind nirgends sichtbar (Monat, Liste, Suche, Detailadresse)", async ({
    page,
    request,
  }) => {
    await page.goto(`/feed/${seed.publicFeedId}?date=2026-10-12`);
    await expect(page.getByRole("heading", { level: 1, name: seed.clubName })).toBeVisible();
    await expect(page.getByText("Zeige 3 von 3 Terminen")).toBeVisible();
    await expect(page.locator("body")).not.toContainText("Geheimer Entwurf");
    await page.getByRole("button", { name: "Liste" }).click();
    await expect(page.getByRole("region", { name: "Termine im Oktober 2026" })).toBeVisible();
    await expect(page.locator("body")).not.toContainText("Geheimer Entwurf");
    await page.getByRole("searchbox", { name: "Termine suchen" }).fill("Entwurf");
    await expect(page.getByRole("heading", { name: /Keine Termine zu „Entwurf“/ })).toBeVisible();
    // auch nicht über die API und nicht über die Detailadresse
    const res = await request.get(`${API}/api/feed/${seed.publicFeedId}/events`);
    expect(JSON.stringify(await res.json())).not.toContain("Geheimer Entwurf");
    await page.goto(`/feed/${seed.publicFeedId}/events/${seed.draftEventId}`);
    await expect(
      page.getByRole("heading", { level: 1, name: "Termin nicht gefunden" }),
    ).toBeVisible();
  });

  test("Zielgruppenfilter und Suche: Zähler, Abo übernimmt die Auswahl, Zurücksetzen", async ({
    page,
  }) => {
    await page.goto(`/feed/${seed.publicFeedId}?date=2026-10-08`);
    await expect(page.getByText("Zeige 3 von 3 Terminen")).toBeVisible();
    const chip = page.getByRole("button", { name: "Jugend", exact: true });
    await expect(chip).toHaveAttribute("aria-pressed", "false");
    await chip.click();
    await expect(chip).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByText("Zeige 2 von 3 Terminen")).toBeVisible();
    await expect(page.getByText("Dein Abo übernimmt diese Auswahl.")).toBeVisible();
    await expect(page.getByRole("link", { name: "Kalender abonnieren" })).toHaveAttribute(
      "href",
      /targetGroupIds=/,
    );
    await page.getByRole("searchbox", { name: "Termine suchen" }).fill("herbst");
    await expect(page.getByText("Zeige 1 von 3 Terminen")).toBeVisible();
    await page.getByRole("button", { name: "Filter zurücksetzen" }).click();
    await expect(page.getByText("Zeige 3 von 3 Terminen")).toBeVisible();
    await expect(chip).toHaveAttribute("aria-pressed", "false");
  });

  test("Monatsnavigation, Heute und Tastatur im Raster", async ({ page }) => {
    await page.goto(`/feed/${seed.publicFeedId}?date=2026-10-08`);
    await page.getByRole("button", { name: "Nächster Monat" }).click();
    await expect(page.getByRole("heading", { level: 2, name: "November 2026" })).toBeVisible();
    await expect(
      page.getByText("In diesem Monat gibt es keine veröffentlichten Termine."),
    ).toBeVisible();
    await page.getByRole("button", { name: "Heute" }).click();
    await expect(page).toHaveURL(/date=/);
    await page.goto(`/feed/${seed.publicFeedId}?date=2026-10-08`);
    // Enter auf dem Tag öffnet die Tagesliste mit beiden Terminen
    await page
      .getByRole("grid")
      .getByLabel(/^8\. Oktober/)
      .focus();
    await page.keyboard.press("Enter");
    const day = page.getByRole("region", { name: /Donnerstag, 8\. Oktober/ });
    await expect(day.getByRole("button", { name: "Training Luftgewehr" })).toBeVisible();
    await expect(day.getByRole("button", { name: "Jugendtraining" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(day).toHaveCount(0);
  });

  test("Termin-Detail: Datum, Ort, Eigenschaften, Kalender-Datei, Zurück mit Auswahl", async ({
    page,
  }) => {
    await page.goto(`/feed/${seed.publicFeedId}?date=2026-10-24&view=list&groups=`);
    await page.getByRole("button", { name: "Erwachsene", exact: true }).click();
    await page
      .getByRole("region", { name: "Termine im Oktober 2026" })
      .getByRole("button", { name: "Herbstfest" })
      .click();
    await expect(page).toHaveURL(
      new RegExp(`/feed/${seed.publicFeedId}/events/${seed.herbstfestId}`),
    );
    // Details open as a dialog above the feed (design: PublicEvent).
    const dialog = page.getByRole("dialog", { name: "Herbstfest" });
    await expect(dialog).toHaveAttribute("aria-modal", "true");
    await expect(dialog.getByRole("heading", { level: 1, name: "Herbstfest" })).toBeFocused();
    await expect(page.locator("[inert]").getByText(seed.clubName).first()).toBeAttached();
    // Subtitle as in the design: "Verein · Kalender"
    await expect(dialog.getByText(`${seed.clubName} · ${seed.calendarName}`)).toBeVisible();
    await expect(dialog.getByText("Sa 24.10.2026")).toBeVisible();
    await expect(dialog.getByText("15:00 bis 22:00 Uhr")).toBeVisible();
    const place = dialog.getByRole("region", { name: "Ort" });
    await expect(place.getByText("Vereinsheim Mitte")).toBeVisible();
    await expect(place.getByText(/Marktplatz 5, 12345 Musterstadt/)).toBeVisible();
    await expect(place.getByRole("link", { name: "In Karten-App öffnen" })).toHaveAttribute(
      "href",
      /openstreetmap\.org/,
    );
    await expect(dialog.getByRole("region", { name: "Eigenschaften" })).toContainText("Draußen");
    await expect(dialog.getByRole("region", { name: "Features" })).toContainText("Getränkeverkauf");
    await expect(dialog.getByRole("region", { name: "Zielgruppen" })).toContainText("Jugend");
    // Einzeltermin als ICS
    const download = page.waitForEvent("download");
    await dialog.getByRole("button", { name: "Zum Kalender hinzufügen" }).click();
    const file = await download;
    expect(file.suggestedFilename()).toBe("herbstfest.ics");
    const path = await file.path();
    const text = (await import("node:fs")).readFileSync(path, "utf8");
    expect(text).toContain(`UID:event-${seed.herbstfestId}@club-calendar`);
    expect(text).toContain("DTSTART:20261024T130000Z");
    expect(text.match(/BEGIN:VEVENT/g)).toHaveLength(1);
    // Schließen: Monat, Ansicht und Filter bleiben, Fokus zurück auf den Termin in der Liste
    await dialog.getByRole("button", { name: "Schließen" }).last().click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole("heading", { level: 1, name: seed.clubName })).toBeVisible();
    await expect(
      page
        .getByRole("region", { name: "Termine im Oktober 2026" })
        .getByRole("button", { name: "Herbstfest" }),
    ).toBeFocused();
    await expect(page.getByRole("button", { name: "Liste" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(page.getByRole("button", { name: "Erwachsene", exact: true })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    // Escape und Zurück im Browser schließen ebenfalls.
    await page
      .getByRole("region", { name: "Termine im Oktober 2026" })
      .getByRole("button", { name: "Herbstfest" })
      .click();
    await expect(dialog).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await page
      .getByRole("region", { name: "Termine im Oktober 2026" })
      .getByRole("button", { name: "Herbstfest" })
      .click();
    await expect(dialog).toBeVisible();
    await page.goBack();
    await expect(dialog).toHaveCount(0);
    await expect(page).toHaveURL(/view=list/);
  });

  test("Zustände: unbekannter Feed, privat ohne und mit falschem Geheimnis", async ({ page }) => {
    await page.goto("/feed/gibt-es-nicht");
    await expect(
      page.getByRole("heading", { level: 1, name: "Kalender nicht gefunden" }),
    ).toBeVisible();
    await expect(page.getByRole("grid")).toHaveCount(0);

    await page.goto(`/feed/${seed.privateFeedId}`);
    await expect(
      page.getByRole("heading", { level: 1, name: "Dieser Kalender ist privat" }),
    ).toBeVisible();
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);

    await page.goto(`/feed/${seed.privateFeedId}?secret=falsch`);
    await expect(
      page.getByRole("heading", { level: 1, name: "Dieser Kalender ist privat" }),
    ).toBeVisible();
    // Sprache und Theme sind auch hier ohne Anmeldung erreichbar
    await expect(page.getByRole("button", { name: "English" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Dunkel" })).toBeVisible();
  });

  test("Ladefehler (offline) mit Erneut versuchen", async ({ page }) => {
    let fail = true;
    await page.route("**/api/feed/**/events**", (route) =>
      fail ? route.abort("failed") : route.continue(),
    );
    await page.goto(`/feed/${seed.publicFeedId}?date=2026-10-08`);
    await expect(page.getByRole("alert")).toContainText(
      "Der Kalender konnte nicht geladen werden.",
    );
    await expect(
      page.getByRole("heading", { level: 1, name: "Kalender nicht verfügbar" }),
    ).toBeVisible();
    fail = false;
    await page.getByRole("button", { name: "Erneut versuchen" }).click();
    await expect(page.getByRole("heading", { level: 1, name: seed.clubName })).toBeVisible();
  });

  test("geteilter Link auf einen Termin: Dialog über dem Feed im Monat des Termins", async ({
    page,
  }) => {
    await page.goto(
      `/feed/${seed.privateFeedId}/events/${seed.herbstfestId}?secret=${seed.secret}`,
    );
    const dialog = page.getByRole("dialog", { name: "Herbstfest" });
    await expect(dialog).toBeVisible();
    await expect(page.locator('meta[name="robots"]').last()).toHaveAttribute("content", /noindex/);
    expect(await page.title()).not.toContain(seed.secret);
    // The feed below shows the event's month; history state never holds the secret.
    await expect(
      page
        .locator("[inert]")
        .getByRole("heading", { level: 2, name: "Oktober 2026", includeHidden: true }),
    ).toBeAttached();
    expect(JSON.stringify(await page.evaluate(() => window.history.state))).not.toContain(
      seed.secret,
    );
    await dialog.getByRole("button", { name: "Schließen" }).first().click();
    await expect(dialog).toHaveCount(0);
    await expect(page).toHaveURL(
      new RegExp(`/feed/${seed.privateFeedId}\\?date=2026-10-24&secret=${seed.secret}$`),
    );
    await expect(page.getByRole("heading", { level: 1, name: seed.clubName })).toBeVisible();

    // Unknown (or draft) event: "not found" in the dialog, the feed stays below.
    await page.goto(`/feed/${seed.privateFeedId}/events/unbekannt?secret=${seed.secret}`);
    const missing = page.getByRole("dialog", { name: "Termin nicht gefunden" });
    await expect(missing).toBeVisible();
    await missing.getByRole("button", { name: "Zum Kalender" }).click();
    await expect(page).toHaveURL(
      new RegExp(`/feed/${seed.privateFeedId}\\?secret=${seed.secret}$`),
    );
  });

  test("privater Feed mit Geheimnis: Inhalt, Adresse mit Geheimnis, kein Leak (Titel, Referrer, Dritte)", async ({
    page,
  }) => {
    const hosts = new Set<string>();
    const referers: string[] = [];
    page.on("request", (req) => {
      const url = new URL(req.url());
      if (url.protocol.startsWith("http")) hosts.add(url.host);
      const referer = req.headers()["referer"];
      if (referer) referers.push(`${req.url()} <- ${referer}`);
    });
    await page.goto(`/feed/${seed.privateFeedId}?secret=${seed.secret}&date=2026-10-08`);
    await expect(page.getByRole("heading", { level: 1, name: seed.clubName })).toBeVisible();
    await expect(page.getByRole("grid")).toBeVisible();
    await expect(page.getByRole("link", { name: "Kalender abonnieren" })).toHaveAttribute(
      "href",
      new RegExp(`secret=${seed.secret}`),
    );
    await expect(page).toHaveTitle(/^Vorstand intern – Öffentlicher Kalender$/);
    expect(await page.title()).not.toContain(seed.secret);
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
    await expect(page.locator('meta[name="referrer"]')).toHaveAttribute("content", "no-referrer");
    // Detailseite behält das Geheimnis in der Adresse, aber nicht im Titel
    await page.getByRole("button", { name: "Liste" }).click();
    await page
      .getByRole("region", { name: "Termine im Oktober 2026" })
      .getByRole("button", { name: "Herbstfest" })
      .click();
    await expect(page.getByRole("dialog", { name: "Herbstfest" })).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`secret=${seed.secret}`));
    expect(await page.title()).not.toContain(seed.secret);
    // Router-State (history.state) trägt das Geheimnis nicht; der Rückweg setzt es aus der Adresse wieder ein
    expect(JSON.stringify(await page.evaluate(() => window.history.state))).not.toContain(
      seed.secret,
    );
    await page.getByRole("dialog").getByRole("button", { name: "Schließen" }).last().click();
    await expect(page).toHaveURL(
      new RegExp(`/feed/${seed.privateFeedId}\\?.*secret=${seed.secret}`),
    );
    await expect(
      page.getByRole("grid").or(page.getByRole("region", { name: /Termine im/ })),
    ).toBeVisible();
    // Focus returns to the list item that opened the dialog.
    await expect(page.getByRole("button", { name: "Herbstfest" })).toBeFocused();
    await page.waitForTimeout(500);
    // Kein Request an eine andere Herkunft (API, Karten-Proxy) trägt die Seitenadresse als Referer;
    // gleiche Herkunft (die App selbst vor dem ersten Rendern) ist unkritisch.
    const leaks = referers.filter((r) => {
      const [url, referer] = r.split(" <- ");
      return new URL(url).origin !== new URL(referer).origin && referer.includes(seed.secret);
    });
    expect(leaks).toEqual([]);
    expect(referers.some((r) => r.startsWith("http://localhost:3001/api/feed/"))).toBe(false);
    const appHosts = new Set([
      "localhost:5199",
      "localhost:3001",
      "127.0.0.1:3001",
      "127.0.0.1:5199",
    ]);
    expect([...hosts].filter((h) => !appHosts.has(h))).toEqual([]);
  });

  test("Sprache und Theme ohne Anmeldung, auch nach Neuladen", async ({ page }) => {
    await page.goto(`/feed/${seed.publicFeedId}?date=2026-10-08`);
    await expect(page.getByRole("link", { name: "Kalender abonnieren" })).toBeVisible();
    await page.getByRole("button", { name: "English" }).click();
    await expect(page.getByRole("link", { name: "Subscribe to calendar" })).toBeVisible();
    await expect(page.getByRole("heading", { level: 2, name: "October 2026" })).toBeVisible();
    await expect(page.getByText("Showing 3 of 3 events")).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await page
      .getByRole("button", { name: "Dunkel" })
      .or(page.getByRole("button", { name: "Dark" }))
      .click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await expect(page.getByRole("link", { name: "Subscribe to calendar" })).toBeVisible();
    await page.getByRole("button", { name: "Deutsch" }).click();
    await page.getByRole("button", { name: "Hell" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    // Detailseite folgt der Wahl
    await page.goto(`/feed/${seed.publicFeedId}/events/${seed.herbstfestId}`);
    await expect(page.getByRole("heading", { level: 1, name: "Herbstfest" })).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  });

  test("Skip-Link ist der erste Tabstopp und springt zum Inhalt", async ({ page }) => {
    await page.goto(`/feed/${seed.publicFeedId}?date=2026-10-08`);
    await expect(page.getByRole("heading", { level: 1, name: seed.clubName })).toBeVisible();
    await page.keyboard.press("Tab");
    const skip = page.getByRole("link", { name: "Zum Inhalt springen" });
    await expect(skip).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/#main$/);
    await expect(page.getByRole("main")).toBeFocused();
  });

  test.describe("mobil", () => {
    test.use({ viewport: { width: 390, height: 844 } });

    test("kompaktes Raster mit Tagesliste, kein horizontales Scrollen, Tap-Ziele", async ({
      page,
    }) => {
      await page.goto(`/feed/${seed.publicFeedId}?date=2026-10-08`);
      await expect(page.getByRole("heading", { level: 1, name: seed.clubName })).toBeVisible();
      const noOverflow = () =>
        page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
      expect(await noOverflow()).toBe(true);
      // Tagesliste unter dem Raster
      await expect(
        page.getByRole("heading", { level: 2, name: "Donnerstag, 8. Oktober" }),
      ).toBeVisible();
      await expect(page.getByRole("button", { name: "Training Luftgewehr" })).toBeVisible();
      for (const name of ["Kalender abonnieren", "Als ICS-Datei laden"]) {
        const box = await page.getByRole("link", { name }).boundingBox();
        expect(box!.height).toBeGreaterThanOrEqual(44);
      }
      for (const name of ["Vorheriger Monat", "Nächster Monat", "Heute"]) {
        const box = await page.getByRole("button", { name, exact: true }).boundingBox();
        expect(box!.height).toBeGreaterThanOrEqual(44);
        expect(box!.width).toBeGreaterThanOrEqual(44);
      }
      // Liste und Detail ohne Überlauf
      await page.getByRole("button", { name: "Liste" }).click();
      expect(await noOverflow()).toBe(true);
      await page
        .getByRole("region", { name: "Termine im Oktober 2026" })
        .getByRole("button", { name: "Herbstfest" })
        .click();
      const sheet = page.getByRole("dialog", { name: "Herbstfest" });
      await expect(sheet).toBeVisible();
      expect(await noOverflow()).toBe(true);
      // Bottom sheet: full width, at the bottom of the screen.
      await expect
        .poll(async () => {
          const b = (await sheet.boundingBox())!;
          return [Math.round(b.width), Math.round(b.y + b.height)];
        })
        .toEqual([390, 844]);
      for (const target of [
        sheet.getByRole("link", { name: "In Karten-App öffnen" }),
        sheet.getByRole("button", { name: "Zum Kalender hinzufügen" }),
        ...(await sheet.getByRole("button", { name: "Schließen" }).all()),
      ]) {
        const box = (await target.boundingBox())!;
        expect(box.height).toBeGreaterThanOrEqual(44);
        expect(box.width).toBeGreaterThanOrEqual(44);
      }
      await sheet.getByRole("button", { name: "Schließen" }).first().click();
      await expect(sheet).toHaveCount(0);
      // Dunkel
      await page.getByRole("button", { name: "Dunkel" }).click();
      expect(await noOverflow()).toBe(true);
    });
  });
});
