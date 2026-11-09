import { test, expect, type APIRequestContext } from "@playwright/test";
import {
  API,
  PASSWORD,
  apiLogin,
  createVerifiedUser,
  login,
  resetLinkFor,
  seedClub,
} from "./helpers";

// ——— Konto (Backend-Paket 3): Passwort zurücksetzen, Profil bearbeiten, letzter Kalender je Verein ———

const NEW_PASSWORD = "Neues-Passwort-2";

async function signIn(request: APIRequestContext, email: string, password: string) {
  return apiLogin(request, email, password);
}

test.describe("Passwort zurücksetzen", () => {
  test.use({ locale: "de-DE", timezoneId: "Europe/Berlin" });

  test("Link aus der Mail: Token verschwindet aus der Adresse, neues Passwort gilt, Link nur einmal", async ({
    page,
    request,
  }) => {
    const email = await createVerifiedUser(request, "Reset Nutzer");
    await page.goto("/forgot-password");
    await page.getByLabel(/^E-Mail/).fill(email);
    await page.getByRole("button", { name: "Link zum Zurücksetzen senden" }).click();
    await expect(
      page.getByRole("heading", { level: 1, name: "Prüfe dein Postfach" }),
    ).toBeVisible();
    await expect(page.getByRole("status")).toContainText(email);

    // The e2e backend sends no mails: the same kind of link from the console command.
    const link = resetLinkFor(email);
    const token = new URL(link).searchParams.get("token")!;
    await page.goto(new URL(link).pathname + new URL(link).search);
    await expect(page).toHaveURL(/\/reset-password$/);
    expect(await page.title()).not.toContain(token);
    await expect(page.locator('meta[name="referrer"]')).toHaveAttribute("content", "no-referrer");

    await page.getByLabel(/^Neues Passwort/).fill(NEW_PASSWORD);
    await page.getByLabel(/^Passwort wiederholen/).fill(NEW_PASSWORD);
    await page.getByRole("button", { name: "Passwort speichern" }).click();
    await expect(
      page.getByRole("heading", { level: 1, name: "Passwort gespeichert" }),
    ).toBeVisible();
    await page.getByRole("link", { name: "Weiter zur Anmeldung" }).click();
    await expect(page).toHaveURL(/\/login$/);

    expect((await signIn(request, email, PASSWORD)).status).toBe(401);
    expect((await signIn(request, email, NEW_PASSWORD)).status).toBe(200);

    // The same link a second time: invalid, with a way to a new one.
    await page.goto(`/reset-password?token=${token}`);
    await page.getByLabel(/^Neues Passwort/).fill("Noch-ein-Passwort-3");
    await page.getByLabel(/^Passwort wiederholen/).fill("Noch-ein-Passwort-3");
    await page.getByRole("button", { name: "Passwort speichern" }).click();
    await expect(
      page.getByRole("heading", { level: 1, name: "Der Link ist ungültig oder abgelaufen" }),
    ).toBeVisible();
    await expect(page.getByRole("link", { name: "Neuen Link anfordern" })).toHaveAttribute(
      "href",
      "/forgot-password",
    );
  });
});

test.describe("Profil bearbeiten", () => {
  test.use({ locale: "de-DE", timezoneId: "Europe/Berlin" });

  test("Name, Passwort und E-Mail-Adresse ändern; die eigene Sitzung läuft weiter", async ({
    page,
    request,
  }) => {
    const email = await createVerifiedUser(request, "Profil Alt");
    const { clubId, calendarId } = await seedClub(request, email, "Profil Bearbeiten Verein");
    await login(page, email);
    await page.waitForURL(/\/clubs/);
    await page.goto(`/clubs/${clubId}/calendars/${calendarId}`);
    await page.goto("/profile");

    const account = page.getByRole("region", { name: "Name und E-Mail-Adresse" });
    await account.getByRole("textbox", { name: /^Name/ }).fill("Profil Neu");
    await account.getByRole("button", { name: "Name speichern" }).click();
    await expect(page.getByText("Name gespeichert")).toBeVisible();
    await expect(page.getByRole("heading", { level: 2, name: "Profil Neu" })).toBeVisible();

    const password = page.getByRole("region", { name: "Passwort" });
    await password.getByLabel(/^Aktuelles Passwort/).fill("falsch-falsch");
    await password.getByLabel(/^Neues Passwort/).fill(NEW_PASSWORD);
    await password.getByLabel(/^Passwort wiederholen/).fill(NEW_PASSWORD);
    await password.getByRole("button", { name: "Passwort ändern" }).click();
    await expect(password.getByText("Das Passwort stimmt nicht.")).toBeVisible();
    await password.getByLabel(/^Aktuelles Passwort/).fill(PASSWORD);
    await password.getByRole("button", { name: "Passwort ändern" }).click();
    await expect(page.getByText(/Passwort geändert/)).toBeVisible();
    // This session continues with the new tokens (also after a reload).
    await page.reload();
    await expect(page.getByRole("heading", { level: 2, name: "Profil Neu" })).toBeVisible();
    expect((await signIn(request, email, NEW_PASSWORD)).status).toBe(200);

    const newEmail = `neu-${Date.now()}@example.com`;
    await account.getByLabel(/^Neue E-Mail-Adresse/).fill(newEmail);
    await account.getByLabel(/^Aktuelles Passwort/).fill(NEW_PASSWORD);
    await account.getByRole("button", { name: "Bestätigungslink senden" }).click();
    await expect(account.getByText("Neue Adresse wartet auf Bestätigung")).toBeVisible();
    await expect(account.getByText(newEmail)).toBeVisible();
    await account.getByRole("button", { name: "Änderung verwerfen" }).click();
    await expect(account.getByText("Neue Adresse wartet auf Bestätigung")).toHaveCount(0);
  });

  test("Ergebnis einer Verknüpfung wird einmal gezeigt und aus der Adresse entfernt", async ({
    page,
    request,
  }) => {
    const email = await createVerifiedUser(request, "Profil Verknuepfung");
    await login(page, email);
    await page.waitForURL(/\/(clubs|setup)/);
    await page.goto("/profile?link_error=account_in_use");
    await expect(page.getByText("Das Konto wurde nicht verknüpft")).toBeVisible();
    await expect(
      page.getByText("Dieses Konto ist schon mit einem anderen Club-Calendar-Konto verknüpft."),
    ).toBeVisible();
    await expect(page).toHaveURL(/\/profile$/);
  });
});

test.describe("Letzter Kalender je Verein", () => {
  test.use({ locale: "de-DE", timezoneId: "Europe/Berlin" });

  test("wird am Konto gespeichert und gilt auf einem anderen Gerät", async ({
    page,
    request,
    browser,
  }) => {
    const email = await createVerifiedUser(request, "Letzter Kalender");
    const { clubId, headers } = await seedClub(request, email, "Letzter Kalender Verein");
    const second = await (
      await request.post(`${API}/api/clubs/${clubId}/calendars`, {
        headers,
        data: { name: "Zweiter Kalender" },
      })
    ).json();
    await seedClub(request, email, "Anderer Verein");

    await login(page, email);
    await page.waitForURL(/\/clubs/);
    await page.goto(`/clubs/${clubId}/calendars/${second.id}`);
    await expect
      .poll(async () => {
        const clubs = await (await request.get(`${API}/api/clubs`, { headers })).json();
        return clubs.find((c: { id: string }) => c.id === clubId)?.lastCalendarId;
      })
      .toBe(second.id);

    // Another device (fresh browser context, no local storage): the club opens the second calendar.
    const other = await browser.newContext({ locale: "de-DE" });
    const device = await other.newPage();
    await login(device, email);
    await device.waitForURL(/\/clubs\//);
    await device.goto("/clubs?select=1");
    await expect(device.getByRole("link", { name: "Letzter Kalender Verein" })).toHaveAttribute(
      "href",
      `/clubs/${clubId}/calendars/${second.id}`,
    );
    await other.close();
  });
});
