import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
import { API, createVerifiedUser, login, seedClub } from "./helpers";

// ——— Verein verwalten (phase 7): Name, Mitglieder, Kalender (duplizieren, archivieren, löschen), Gefahrenbereich ———

async function seed(request: APIRequestContext, name: string) {
  const email = await createVerifiedUser(request, name);
  const club = await seedClub(request, email, `${name} Verein`);
  return {
    name,
    email,
    ...club,
    clubName: `${name} Verein`,
    calendarName: `${name} Verein Termine`,
    base: () => `/clubs/${club.clubId}/calendars/${club.calendarId}`,
  };
}

async function openClub(page: Page, s: Awaited<ReturnType<typeof seed>>) {
  await login(page, s.email);
  await page.waitForURL(/\/clubs/);
  await page.goto(`/clubs/${s.clubId}`);
  await expect(page.getByRole("heading", { level: 1, name: "Verein verwalten" })).toBeVisible();
}

const calendars = async (request: APIRequestContext, s: Awaited<ReturnType<typeof seed>>) =>
  (
    await request.get(`${API}/api/clubs/${s.clubId}/calendars?includeArchived=true`, {
      headers: s.headers,
    })
  ).json() as Promise<{ id: string; name: string; archivedAt: string | null }[]>;

test.describe("Verein verwalten", () => {
  test.use({ locale: "de-DE", timezoneId: "Europe/Berlin" });

  test("Seite zeigt Vereinsname, Zeitzone, Mitglieder und Kalender; Name ändern", async ({
    page,
    request,
  }) => {
    const s = await seed(request, "Club Kopf");
    await login(page, s.email);
    await page.waitForURL(/\/clubs/);
    // Seitenleiste: "Verein verwalten"
    await page.goto(s.base());
    await page
      .getByRole("navigation", { name: "Bereiche" })
      .getByRole("link", { name: "Verein verwalten" })
      .click();
    await expect(page).toHaveURL(new RegExp(`/clubs/${s.clubId}$`));
    await expect(page.getByText(`${s.clubName} · Zeitzone Europe/Berlin`)).toBeVisible();
    await expect(page.getByLabel(/^Name des Vereins/)).toHaveValue(s.clubName);
    await expect(page.getByRole("link", { name: "Zu allen Vereinen" })).toHaveAttribute(
      "href",
      "/clubs?select=1",
    );

    // Validierung
    await page.getByLabel(/^Name des Vereins/).fill("   ");
    await page.getByRole("button", { name: "Namen speichern" }).click();
    await expect(page.getByRole("alert")).toContainText(
      "Bitte gib einen Namen für den Verein ein.",
    );
    // Ändern per Enter
    await page.getByLabel(/^Name des Vereins/).fill("Waldblick e. V.");
    await page.getByLabel(/^Name des Vereins/).press("Enter");
    await expect(page.getByText("Vereinsname gespeichert.")).toBeVisible();
    await expect(page.getByText("Waldblick e. V. · Zeitzone Europe/Berlin")).toBeVisible();
    const club = await (
      await request.get(`${API}/api/clubs/${s.clubId}`, { headers: s.headers })
    ).json();
    expect(club.name).toBe("Waldblick e. V.");
  });

  test("Mitglieder: hinzufügen mit Fehlern, entfernen mit Bestätigung", async ({
    page,
    request,
  }) => {
    const s = await seed(request, "Club Mitglieder");
    const otherEmail = await createVerifiedUser(request, "Mara Sommer");
    await openClub(page, s);

    const table = page.getByRole("table", { name: /Mitglieder des Vereins/ });
    await expect(table.getByRole("row")).toHaveCount(2);
    const own = table.getByRole("row").filter({ hasText: s.email });
    await expect(own).toContainText("Du");
    await expect(own.getByRole("button", { name: `Verein ${s.clubName} verlassen` })).toBeVisible();

    // Fehler: leer, ungültig, unbekannt
    const email = page.getByLabel(/^E-Mail-Adresse/);
    const add = page.getByRole("button", { name: "Mitglied hinzufügen" });
    await add.click();
    await expect(page.getByRole("alert")).toContainText("Bitte gib eine E-Mail-Adresse ein.");
    await email.fill("kein-mail");
    await add.click();
    await expect(page.getByRole("alert")).toContainText(
      "Bitte gib eine gültige E-Mail-Adresse ein.",
    );
    await email.fill("niemand@example.com");
    await add.click();
    await expect(page.getByRole("alert")).toContainText(
      "Zu dieser E-Mail-Adresse gibt es kein Konto.",
    );
    await expect(email).toHaveValue("niemand@example.com");
    await expect(email).toHaveAccessibleDescription(/kein Konto/);

    // Hinzufügen
    await email.fill(otherEmail);
    await add.click();
    await expect(page.getByText(`${otherEmail} wurde zum Verein hinzugefügt.`)).toBeVisible();
    await expect(email).toHaveValue("");
    await expect(table.getByRole("row")).toHaveCount(3);
    const row = table.getByRole("row").filter({ hasText: otherEmail });
    await expect(row).toContainText("Mara Sommer");
    // Schon Mitglied
    await email.fill(otherEmail.toUpperCase());
    await add.click();
    await expect(page.getByRole("alert")).toContainText(
      "Diese Person ist schon Mitglied im Verein.",
    );
    await email.fill("");

    // Entfernen: Abbrechen ändert nichts, Bestätigen entfernt
    await row.getByRole("button", { name: "Mara Sommer entfernen" }).click();
    const dialog = page.getByRole("alertdialog", { name: "Mara Sommer entfernen?" });
    await expect(dialog).toContainText("Ihr Konto bleibt bestehen.");
    await dialog.getByRole("button", { name: "Abbrechen" }).click();
    await expect(table.getByRole("row")).toHaveCount(3);
    await row.getByRole("button", { name: "Mara Sommer entfernen" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Mitglied entfernen" }).click();
    await expect(page.getByText("Mara Sommer wurde aus dem Verein entfernt.")).toBeVisible();
    await expect(table.getByRole("row")).toHaveCount(2);
    const members = await (
      await request.get(`${API}/api/clubs/${s.clubId}/members`, { headers: s.headers })
    ).json();
    expect(members).toHaveLength(1);
  });

  test("Kalender: anlegen, duplizieren, archivieren, wiederherstellen, löschen", async ({
    page,
    request,
  }) => {
    const s = await seed(request, "Club Kalender");
    await openClub(page, s);
    const active = page.getByRole("list").filter({ hasText: s.calendarName }).first();
    await expect(active.getByRole("listitem")).toHaveCount(1);
    await expect(active).toContainText("Zeitzone Europe/Berlin");

    // Anlegen: Formular klappt auf, Validierung, Fokus zurück zum Auslöser
    const toggle = page.getByRole("button", { name: "Kalender anlegen", expanded: false });
    await toggle.click();
    const form = page.getByRole("form", { name: "Kalender anlegen" });
    await expect(form.getByLabel(/^Name des Kalenders/)).toBeFocused();
    await form.getByRole("button", { name: "Kalender anlegen" }).click();
    await expect(page.getByRole("alert")).toContainText(
      "Bitte gib einen Namen für den Kalender ein.",
    );
    await form.getByLabel(/^Name des Kalenders/).fill("Jugend und Vereinsleben");
    await form.getByLabel(/^Name des Kalenders/).press("Enter");
    await expect(
      page.getByText("Kalender „Jugend und Vereinsleben“ wurde angelegt."),
    ).toBeVisible();
    await expect(form).toHaveCount(0);
    await expect(page).toHaveURL(new RegExp(`/clubs/${s.clubId}$`));
    await expect(
      page.getByRole("button", { name: "Kalender anlegen", expanded: false }),
    ).toBeFocused();
    expect(await calendars(request, s)).toHaveLength(2);

    // Duplizieren: bleibt auf der Seite, die Kopie erscheint mit eigenem Namen
    await page.getByRole("button", { name: `Kalender ${s.calendarName} duplizieren` }).click();
    await expect(
      page.getByText(`Kalender „Kopie von ${s.calendarName}“ wurde angelegt.`),
    ).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`/clubs/${s.clubId}$`));
    await expect(page.getByText(`Kopie von ${s.calendarName}`, { exact: true })).toBeVisible();
    expect(await calendars(request, s)).toHaveLength(3);

    // Archivieren: Bestätigung nennt die Folgen; danach unter "Archivierte Kalender"
    const copy = `Kopie von ${s.calendarName}`;
    await page.getByRole("button", { name: `Kalender ${copy} archivieren` }).click();
    const dialog = page.getByRole("alertdialog", { name: `Kalender „${copy}“ archivieren?` });
    await expect(dialog).toContainText(
      "Der Kalender wandert in die Liste der archivierten Kalender.",
    );
    await expect(dialog).toContainText("Niemand kann Termine anlegen, ändern oder löschen.");
    await dialog.getByRole("button", { name: "Abbrechen" }).click();
    expect((await calendars(request, s)).filter((c) => c.archivedAt)).toHaveLength(0);
    await page.getByRole("button", { name: `Kalender ${copy} archivieren` }).click();
    await page
      .getByRole("alertdialog")
      .getByRole("button", { name: "Kalender archivieren" })
      .click();
    await expect(page.getByText("Kalender archiviert.")).toBeVisible();
    const archived = page.getByRole("list", { name: "Archivierte Kalender" });
    await expect(archived).toContainText(copy);
    await expect(archived.locator(".ap-badge")).toHaveText("Archiviert");
    await expect(archived).toContainText("Archiviert am");
    await expect(archived.getByRole("link", { name: `Kalender ${copy} ansehen` })).toBeVisible();
    await expect(page.getByRole("button", { name: `Kalender ${copy} archivieren` })).toHaveCount(0);

    // Der archivierte Kalender ist schreibgeschützt (Banner in den Einstellungen)
    await archived.getByRole("link", { name: `Kalender ${copy} ansehen` }).click();
    await expect(page.getByText("Archiviert, schreibgeschützt").first()).toBeVisible();
    await page.goBack();

    // Wiederherstellen
    await page.getByRole("button", { name: `Archivierung von ${copy} aufheben` }).click();
    await expect(page.getByText("Archivierung aufgehoben.")).toBeVisible();
    await expect(page.getByRole("list", { name: "Archivierte Kalender" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: `Kalender ${copy} archivieren` })).toBeVisible();

    // Löschen: Folgen-Dialog mit Umfang (Dialogs.dc.html); Abbrechen löscht nichts
    await page.getByRole("button", { name: `Kalender ${copy} löschen` }).click();
    const del = page.getByRole("alertdialog", { name: `Kalender „${copy}“ löschen?` });
    await expect(del).toContainText("Der Kalender wird dauerhaft gelöscht.");
    await expect(del).toContainText(
      "Löscht den Kalender und seine Feeds unwiderruflich. Die Adressen der Feeds funktionieren danach nicht mehr.",
    );
    await del.getByRole("button", { name: "Abbrechen" }).click();
    expect(await calendars(request, s)).toHaveLength(3);
    await page.getByRole("button", { name: `Kalender ${copy} löschen` }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Kalender löschen" }).click();
    await expect(page.getByText("Kalender gelöscht.")).toBeVisible();
    await expect(page.getByText(copy, { exact: true })).toHaveCount(0);
    expect(await calendars(request, s)).toHaveLength(2);
  });

  test("Verein verlassen: der Verein verschwindet aus meiner Liste", async ({ page, request }) => {
    const s = await seed(request, "Club Verlassen");
    const otherEmail = await createVerifiedUser(request, "Bleibt Da");
    await request.post(`${API}/api/clubs/${s.clubId}/members`, {
      headers: s.headers,
      data: { email: otherEmail },
    });
    await openClub(page, s);
    await page.getByRole("button", { name: `Verein ${s.clubName} verlassen` }).click();
    const dialog = page.getByRole("alertdialog", { name: "Verein verlassen?" });
    await expect(dialog).toContainText("Die anderen Mitglieder behalten ihn.");
    await dialog.getByRole("button", { name: "Verein verlassen" }).click();
    await expect(page).toHaveURL(/\/clubs\?select=1$/);
    const clubs = await (await request.get(`${API}/api/clubs`, { headers: s.headers })).json();
    expect(clubs.map((c: { id: string }) => c.id)).not.toContain(s.clubId);
  });

  test("Verein löschen verlangt die Eingabe des Namens", async ({ page, request }) => {
    const s = await seed(request, "Club Löschen");
    await openClub(page, s);
    await expect(page.getByRole("heading", { name: "Gefahrenbereich" })).toBeVisible();
    await page.getByRole("button", { name: "Verein löschen" }).click();
    const dialog = page.getByRole("alertdialog", { name: `Verein „${s.clubName}“ löschen?` });
    await expect(dialog).toContainText("Alle Mitglieder verlieren den Zugriff.");
    const confirm = dialog.getByRole("button", { name: "Verein löschen" });
    await expect(confirm).toBeDisabled();
    const input = dialog.getByLabel("Vereinsname zur Bestätigung eingeben");
    await input.fill(s.clubName.slice(0, -1));
    await expect(confirm).toBeDisabled();
    await input.fill(s.clubName);
    await expect(confirm).toBeEnabled();
    await confirm.click();
    await expect(page).toHaveURL(/\/(clubs|setup)/);
    const res = await request.get(`${API}/api/clubs/${s.clubId}`, { headers: s.headers });
    expect(res.ok()).toBeFalsy();
  });

  test("Unbekannter Verein: Hinweis statt leerer Seite", async ({ page, request }) => {
    const s = await seed(request, "Club Fremd");
    await login(page, s.email);
    await page.waitForURL(/\/clubs/);
    await page.goto("/clubs/00000000-0000-0000-0000-000000000000");
    await expect(page.getByRole("heading", { name: "Verein nicht gefunden" })).toBeVisible();
  });
});
