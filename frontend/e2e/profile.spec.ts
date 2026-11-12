import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
import {
  confirmStepUp,
  confirmStepUpIfAsked,
  forgetStepUp,
  stepUpDialog,
  API,
  PASSWORD,
  addVirtualAuthenticator,
  setPresenceSimulation,
  authHeaders,
  createVerifiedUser,
  login,
  seedClub,
} from "./helpers";

// ——— Profil (phase 7): Sprache, Darstellung, Datumsformat, MFA/Passkeys, Konto ———

async function seed(request: APIRequestContext, name: string) {
  const email = await createVerifiedUser(request, name);
  const club = await seedClub(request, email, `${name} Verein`);
  return { name, email, ...club };
}

/** Opens the calendar first (so the club is "last used" and the app shell shows), then the profile. */
async function openProfile(
  page: Page,
  s: { email: string; clubId: string; calendarId: string; headers: Record<string, string> },
  request: APIRequestContext,
) {
  await login(page, s.email);
  await page.waitForURL(/\/clubs/);
  await page.goto(`/clubs/${s.clubId}/calendars/${s.calendarId}`);
  // The calendar page stores the club as "last used" a moment after it opened; only then does
  // /profile (which has no club in its URL) render inside the app shell for good.
  await expect.poll(async () => (await me(request, s.headers)).lastClubId).toBe(s.clubId);
  await page
    .getByRole("complementary")
    .getByRole("link", { name: /Mein Profil/ })
    .click();
  await expect(page.getByRole("heading", { level: 1, name: "Profil" })).toBeVisible();
}

/** Opens "MFA-Methode hinzufügen" > Passkey (unless the proof step is open) and confirms with the step-up dialog. */
async function startPasskeySetup(page: Page) {
  const dialog = page.getByRole("dialog");
  const next = dialog.getByRole("button", { name: "Weiter" });
  if (!(await next.isVisible())) {
    await page.getByRole("button", { name: "MFA-Methode hinzufügen" }).click();
    await dialog.getByRole("button", { name: "Passkey", exact: true }).click();
  }
  await next.click();
  await confirmStepUpIfAsked(page);
}

/** Names the new passkey (step "Passkey benennen") and closes the dialog. */
async function nameAndFinish(page: Page, name: string) {
  const naming = page.getByRole("dialog", { name: "Passkey benennen" });
  await naming.getByLabel("Name").fill(name);
  await naming.getByRole("button", { name: "Namen speichern" }).click();
  await page
    .getByRole("dialog", { name: "Fertig" })
    .getByRole("button", { name: "Schließen" })
    .click();
}

const me = async (request: APIRequestContext, headers: Record<string, string>) =>
  (await request.get(`${API}/api/auth/me`, { headers })).json();

test.describe("Profil", () => {
  test.use({ locale: "de-DE", timezoneId: "Europe/Berlin" });

  test("zeigt Konto, Anmeldungen und Passkeys; Sidebar führt zum Profil", async ({
    page,
    request,
  }) => {
    const s = await seed(request, "Profil Kopf");
    await login(page, s.email);
    await page.waitForURL(/\/clubs/);
    await page.goto(`/clubs/${s.clubId}/calendars/${s.calendarId}`);
    await page
      .getByRole("complementary")
      .getByRole("link", { name: /Mein Profil/ })
      .click();
    await expect(page).toHaveURL(/\/profile$/);
    await expect(page.getByRole("heading", { level: 1, name: "Profil" })).toBeVisible();
    await expect(page.getByRole("heading", { level: 2, name: "Profil Kopf" })).toBeVisible();
    await expect(page.getByText(s.email).first()).toBeVisible();
    await expect(page.getByRole("region", { name: "Name und E-Mail-Adresse" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Passwort" })).toBeVisible();
    await expect(page.getByText("Du hast noch keine MFA-Methode eingerichtet.")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Verknüpfte Anmeldungen" })).toBeVisible();
  });

  test("Sprache wird am Konto gespeichert und gilt nach dem Neuladen", async ({
    page,
    request,
  }) => {
    const s = await seed(request, "Profil Sprache");
    await openProfile(page, s, request);
    const prefs = page.getByRole("region", { name: "Persönliche Einstellungen" });
    const lang = prefs.getByRole("group", { name: "Sprache" }).last();
    await expect(lang.getByRole("button", { name: "Deutsch" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await lang.getByRole("button", { name: "English" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Profile" })).toBeVisible();
    await expect(page.getByText("Saved", { exact: true })).toBeVisible();
    await expect.poll(async () => (await me(request, s.headers)).language).toBe("en");

    await page.reload();
    await expect(page.getByRole("heading", { level: 1, name: "Profile" })).toBeVisible();
    await page
      .getByRole("region", { name: "Personal settings" })
      .getByRole("group", { name: "Language" })
      .last()
      .getByRole("button", { name: "Deutsch" })
      .click();
    await expect(page.getByRole("heading", { level: 1, name: "Profil" })).toBeVisible();
    await expect.poll(async () => (await me(request, s.headers)).language).toBe("de");
  });

  test("Darstellung: Hell, Dunkel, System; bleibt im Browser erhalten", async ({
    page,
    request,
  }) => {
    const s = await seed(request, "Profil Theme");
    await openProfile(page, s, request);
    const group = page.getByRole("group", { name: "Darstellung" });
    const html = page.locator("html");
    await expect(group.getByRole("button", { name: "Wie System" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await group.getByRole("button", { name: "Dunkel" }).click();
    await expect(html).toHaveAttribute("data-theme", "dark");
    await expect(group.getByRole("button", { name: "Dunkel" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    // Kontrast: heller Text auf dunklem Grund
    // The theme switch fades colours for ~250ms (data-theme-transition): wait until they settled.
    const lum = (c: string) => {
      const [r, g, b] = (c.match(/\d+(\.\d+)?/g) ?? []).slice(0, 3).map(Number);
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    await expect
      .poll(async () => {
        const colors = await page.evaluate(() => {
          const cs = getComputedStyle(document.body);
          return { bg: cs.backgroundColor, fg: cs.color };
        });
        return lum(colors.bg) < lum(colors.fg);
      })
      .toBe(true);

    await page.reload();
    await expect(html).toHaveAttribute("data-theme", "dark");
    await group.getByRole("button", { name: "Hell" }).click();
    await expect(html).toHaveAttribute("data-theme", "light");
    await group.getByRole("button", { name: "Wie System" }).click();
    await expect(group.getByRole("button", { name: "Wie System" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    // Nur lokal: nichts davon liegt am Konto
    expect(Object.keys(await me(request, s.headers))).not.toContain("theme");
  });

  test("Datumsformat und erster Wochentag werden sofort gespeichert", async ({ page, request }) => {
    const s = await seed(request, "Profil Format");
    await openProfile(page, s, request);
    const prefs = page.getByRole("region", { name: "Persönliche Einstellungen" });
    await expect(prefs.getByRole("radio", { name: "31.12.2026" })).toBeChecked();
    await prefs.getByRole("radio", { name: "2026-12-31" }).check();
    await expect(page.getByText("Gespeichert", { exact: true })).toBeVisible();
    await expect.poll(async () => (await me(request, s.headers)).dateFormat).toBe("yyyy-MM-dd");
    await prefs.getByRole("button", { name: "Sonntag" }).click();
    await expect(prefs.getByRole("button", { name: "Sonntag" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect.poll(async () => (await me(request, s.headers)).firstDayOfWeek).toBe(0);
    await page.reload();
    await expect(prefs.getByRole("radio", { name: "2026-12-31" })).toBeChecked();
    await expect(prefs.getByRole("button", { name: "Sonntag" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  test("Passkey-Oberfläche: abgebrochen und fehlgeschlagen ohne Authenticator", async ({
    page,
    request,
  }) => {
    const s = await seed(request, "Profil Passkey");
    await openProfile(page, s, request);
    // Der Browser meldet "abgebrochen" (Nutzer schließt den Systemdialog).
    await page.evaluate(() => {
      navigator.credentials.create = () =>
        Promise.reject(new DOMException("The operation was cancelled", "NotAllowedError"));
    });
    await startPasskeySetup(page);
    const dialog = page.getByRole("dialog", { name: "Passkey hinzufügen" });
    await expect(dialog.getByText(/Der Passkey wurde nicht angelegt/)).toBeVisible();
    // Ein anderer Fehler: eigene Meldung als Alarm
    await page.evaluate(() => {
      navigator.credentials.create = () =>
        Promise.reject(new DOMException("Device not supported", "NotSupportedError"));
    });
    await startPasskeySetup(page);
    await expect(dialog.getByRole("alert")).toContainText(
      "Der Passkey konnte nicht angelegt werden.",
    );
    expect((await me(request, s.headers)).passkeys).toHaveLength(0);
  });

  test("Passkey hinzufügen und entfernen mit virtuellem Authenticator", async ({
    page,
    request,
  }) => {
    const s = await seed(request, "Profil Virtuell");
    await openProfile(page, s, request);
    await addVirtualAuthenticator(page);

    await startPasskeySetup(page);
    await nameAndFinish(page, "Test-Laptop");
    const list = page.getByRole("list", { name: "Deine MFA-Methoden" });
    await expect(list).toContainText("Test-Laptop");
    await expect(list).toContainText("hinzugefügt am");
    expect((await me(request, s.headers)).passkeys).toHaveLength(1);

    // Entfernen: Abbrechen ändert nichts, Bestätigen (Step-up-Bestätigung) entfernt
    await page.getByRole("button", { name: "Passkey „Test-Laptop“ entfernen" }).click();
    const dialog = page.getByRole("dialog", { name: "Passkey „Test-Laptop“ entfernen?" });
    await expect(dialog).toContainText("Bitte bestätige, dass du es bist.");
    await dialog.getByRole("button", { name: "Abbrechen" }).click();
    await expect(list).toContainText("Test-Laptop");
    await page.getByRole("button", { name: "Passkey „Test-Laptop“ entfernen" }).click();
    await dialog.getByRole("button", { name: "Passkey entfernen" }).click();
    await confirmStepUpIfAsked(page);
    await expect(page.getByText("Du hast noch keine MFA-Methode eingerichtet.")).toBeVisible();
    // deleting a passkey ends all sessions (token version), so the old access token is dead: sign in again
    expect((await me(request, await authHeaders(request, s.email))).passkeys).toHaveLength(0);
  });

  test("Anmelden mit Passkey (virtueller Authenticator), Wiederverwendung scheitert", async ({
    page,
    request,
  }) => {
    const s = await seed(request, "Profil Passkey Login");
    await openProfile(page, s, request);
    const { cdp, authenticatorId } = await addVirtualAuthenticator(page);
    await startPasskeySetup(page);
    await nameAndFinish(page, "Login-Laptop");
    await expect(page.getByRole("list", { name: "Deine MFA-Methoden" })).toContainText(
      "Login-Laptop",
    );

    // The login page asks for a passkey on its own (conditional request, answered by the virtual
    // authenticator); keep it silent until the listener for the request is in place.
    // Switching presence back on does not always answer a conditional request that is already
    // pending (the trace shows it hanging), so the button is the fallback: it starts a fresh ceremony.
    await setPresenceSimulation(cdp, authenticatorId, false);
    await page.getByRole("main").getByRole("button", { name: "Abmelden", exact: true }).click();
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByRole("button", { name: "Mit Passkey anmelden" })).toBeVisible();

    // Capture what the browser sends, to replay it afterwards.
    const verify = page.waitForRequest(
      (r) => r.url().endsWith("/api/auth/webauthn/authenticate/verify") && r.method() === "POST",
    );
    await setPresenceSimulation(cdp, authenticatorId, true);
    const fallback = page
      .waitForTimeout(2000)
      .then(() =>
        page.getByRole("button", { name: "Mit Passkey anmelden" }).click({ timeout: 3000 }),
      )
      .catch(() => {});
    const sent = (await verify).postData() ?? "";
    await fallback;
    await page.waitForURL(/\/clubs/);
    const { credentials } = await cdp.send("WebAuthn.getCredentials", { authenticatorId });
    expect(credentials[0].signCount).toBeGreaterThan(0);

    // The same signed response (and challenge token) is accepted only once.
    const replay = await request.post(`${API}/api/auth/webauthn/authenticate/verify`, {
      data: JSON.parse(sent),
    });
    expect(replay.status()).toBe(401);
  });

  test("Abmelden führt zur Anmeldung", async ({ page, request }) => {
    const s = await seed(request, "Profil Abmelden");
    await openProfile(page, s, request);
    await page.getByRole("main").getByRole("button", { name: "Abmelden", exact: true }).click();
    await expect(page).toHaveURL(/\/login/);
  });

  test("Konto löschen verlangt die Bestätigung", async ({ page, request }) => {
    const s = await seed(request, "Profil Löschen");
    await openProfile(page, s, request);
    await page.getByRole("button", { name: "Konto löschen" }).click();
    const dialog = page.getByRole("dialog", { name: "Konto löschen?" });
    await expect(dialog).toContainText("Du wirst abgemeldet.");
    const confirm = dialog.getByRole("button", { name: "Konto löschen" });
    // Wrong password in the step-up dialog: the account stays
    await forgetStepUp(page);
    await confirm.click();
    const stepUp = stepUpDialog(page);
    await confirmStepUp(page, { password: "falsches-Passwort-1" });
    await expect(stepUp.getByText("Das Passwort stimmt nicht.")).toBeVisible();
    // Cancelling the confirmation leaves the account alone
    await stepUp.getByRole("button", { name: "Abbrechen" }).click();
    await expect(stepUp).toHaveCount(0);
    // The only member of a club cannot delete the account (422 last_member_of_club): delete the club first
    const clubDeleted = await request.delete(`${API}/api/clubs/${s.clubId}`, {
      headers: s.headers,
    });
    expect(clubDeleted.ok()).toBeTruthy();
    // Activate by keyboard: the page unmounts as soon as the account is gone, which makes a mouse
    // click's "element detached" bookkeeping flaky.
    await confirm.focus();
    await page.keyboard.press("Enter");
    await confirmStepUp(page);
    await expect(page).toHaveURL(/\/login/);
    const res = await request.post(`${API}/api/auth/login`, {
      data: { email: s.email, password: PASSWORD },
    });
    expect(res.ok()).toBeFalsy();
  });
});
