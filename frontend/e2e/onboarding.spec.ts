import { test, expect } from "@playwright/test";
import { API, createVerifiedUser, login, seedClub } from "./helpers";

// Setup and context switching are tested in German (the design's source language).
test.use({ locale: "de-DE" });

test.describe("Erst-Einrichtung", () => {
  test("a new user creates a club and the first calendar", async ({ page, request }) => {
    const email = await createVerifiedUser(request, "Erika Einrichtung");
    await login(page, email);

    // No club yet: /clubs forwards to the setup.
    await page.waitForURL("**/setup");
    await expect(
      page.getByRole("heading", { level: 1, name: "Willkommen bei Club Calendar" }),
    ).toBeVisible();
    const steps = page.getByRole("list", { name: "Fortschritt" });
    await expect(steps.locator("[aria-current='step']")).toHaveText(/Verein/);

    // Empty name: error, focus stays in the field.
    await page.getByRole("button", { name: "Verein anlegen" }).click();
    const clubName = page.getByLabel(/^Name deines Vereins/);
    await expect(page.getByText("Bitte gib den Namen deines Vereins ein.")).toBeVisible();
    await expect(clubName).toBeFocused();
    await expect(clubName).toHaveAttribute("aria-invalid", "true");

    await clubName.fill("Schützenverein Waldblick E2E");
    await page.getByRole("button", { name: "Verein anlegen" }).click();

    // Step 2: stepper advances, focus moves to the heading, club name confirmed.
    const heading = page.getByRole("heading", { level: 1, name: "Ersten Kalender anlegen" });
    await expect(heading).toBeVisible();
    await expect(heading).toBeFocused();
    await expect(steps.locator("[aria-current='step']")).toHaveText(/Kalender/);
    await expect(page.getByRole("status").first()).toContainText(
      "Verein „Schützenverein Waldblick E2E“ ist angelegt",
    );
    const calendarName = page.getByLabel(/^Name des Kalenders/);
    await expect(calendarName).toHaveValue(/^Vereinstermine \d{4}$/);
    await expect(
      page.getByText(/^Zeitzone: .+ – automatisch aus deinem Browser erkannt/),
    ).toBeVisible();

    await calendarName.fill("Schießbetrieb E2E");
    await page.getByRole("button", { name: "Kalender anlegen" }).click();

    await page.waitForURL(/\/clubs\/[^/]+\/calendars\/[^/]+$/);
    const sidebar = page.getByRole("complementary", { name: "Seitenleiste" });
    await expect(
      sidebar.getByRole("button", { name: /Verein.*Schützenverein Waldblick E2E/ }),
    ).toBeVisible();
    await expect(
      sidebar.getByRole("button", { name: /Kalender.*Schießbetrieb E2E/ }),
    ).toBeVisible();

    // The last used club is remembered: a fresh visit of /clubs opens this calendar again.
    await page.goto("/clubs");
    await page.waitForURL(/\/calendars\//);
  });

  test("going back from step 2 does not create a second club", async ({ page, request }) => {
    const email = await createVerifiedUser(request, "Bernd Zurück");
    await login(page, email);
    await page.waitForURL("**/setup");
    await page.getByLabel(/^Name deines Vereins/).fill("Segelclub Zurück E2E");
    await page.getByRole("button", { name: "Verein anlegen" }).click();
    await page.getByRole("button", { name: "Zurück" }).click();
    await expect(page.getByLabel(/^Name deines Vereins/)).toHaveValue("Segelclub Zurück E2E");
    await page.getByLabel(/^Name deines Vereins/).fill("Segelclub Umbenannt E2E");
    await page.getByRole("button", { name: "Verein anlegen" }).click();
    await expect(page.getByRole("status").first()).toContainText("Segelclub Umbenannt E2E");

    await page.getByRole("button", { name: "Kalender anlegen" }).click();
    await page.waitForURL(/\/calendars\//);
    await page.goto("/clubs?select=1");
    await expect(page.getByRole("heading", { level: 2 })).toHaveCount(2); // one club + "new club" card
  });

  test("a new user can skip the club and reaches the picker with the option to create one", async ({
    page,
    request,
  }) => {
    const email = await createVerifiedUser(request, "Sven Später");
    await login(page, email);
    await page.waitForURL("**/setup");
    await page.getByRole("link", { name: "Vorerst überspringen" }).click();
    await page.waitForURL("**/clubs?select=1");
    await expect(
      page.getByRole("heading", { level: 2, name: "Du bist noch in keinem Verein" }),
    ).toBeVisible();
    await expect(page.getByRole("heading", { name: "Einladungen" })).toHaveCount(0);
    await page.getByRole("link", { name: "Neuen Verein anlegen" }).click();
    await expect(
      page.getByRole("heading", { level: 1, name: "Willkommen bei Club Calendar" }),
    ).toBeVisible();
  });

  test("a user with an invitation sees it instead of the forced club setup and accepts it", async ({
    page,
    request,
  }) => {
    const owner = await createVerifiedUser(request, "Olga Einladend");
    const club = await seedClub(request, owner, "Einladungsclub E2E");
    const email = await createVerifiedUser(request, "Ina Eingeladen");
    const invited = await request.post(`${API}/api/clubs/${club.clubId}/invitations`, {
      headers: club.headers,
      data: { email },
    });
    expect(invited.status()).toBe(204);

    await login(page, email);
    // Pending invitations keep the user on the picker (no redirect to /setup)
    await expect(page.getByRole("heading", { level: 2, name: "Einladungen" })).toBeVisible();
    await expect(page).toHaveURL(/\/clubs$/);
    const section = page.getByRole("region", { name: "Einladungen" });
    await expect(section).toContainText("Einladungsclub E2E");
    await expect(section).toContainText("Eingeladen von Olga Einladend");
    await expect(page.getByRole("link", { name: "Neuen Verein anlegen" })).toBeVisible();

    await section
      .getByRole("button", { name: "Einladung zum Verein Einladungsclub E2E annehmen" })
      .click();
    await page.waitForURL(`**/clubs/${club.clubId}/calendars/${club.calendarId}`);
  });

  test("signed-in users are redirected away from the login pages", async ({ page, request }) => {
    const email = await createVerifiedUser(request, "Clara Umleitung");
    await login(page, email);
    await page.waitForURL("**/setup");
    for (const path of ["/login", "/signup", "/forgot-password"]) {
      await page.goto(path);
      await page.waitForURL("**/setup");
    }
  });
});

test.describe("Vereinswechsel", () => {
  test("switches between clubs via the sidebar menu and the club picker", async ({
    page,
    request,
  }) => {
    const email = await createVerifiedUser(request, "Dora Wechsel");
    const a = await seedClub(request, email, "Club Alpha E2E");
    await login(page, email);

    // No last club yet: the picker is shown, the card opens the club's calendar.
    await expect(
      page.getByRole("heading", { level: 1, name: "Wähle deinen Verein" }),
    ).toBeVisible();
    await page.getByRole("link", { name: "Club Alpha E2E" }).click();
    await page.waitForURL(`**/clubs/${a.clubId}/calendars/${a.calendarId}`);

    const sidebar = page.getByRole("complementary", { name: "Seitenleiste" });

    // "Neuen Verein anlegen" from the switcher starts the onboarding at step 1, even with a club.
    await sidebar.getByRole("button", { name: /Verein.*Club Alpha E2E/ }).click();
    await page.getByRole("link", { name: "Neuen Verein anlegen" }).click();
    await expect(
      page.getByRole("heading", { level: 1, name: "Willkommen bei Club Calendar" }),
    ).toBeVisible();
    await page.getByLabel(/^Name deines Vereins/).fill("Club Beta E2E");
    await page.getByRole("button", { name: "Verein anlegen" }).click();
    await page.getByLabel(/^Name des Kalenders/).fill("Beta Termine");
    await page.getByRole("button", { name: "Kalender anlegen" }).click();
    await page.waitForURL(/\/clubs\/[^/]+\/calendars\/[^/]+$/);
    const betaUrl = page.url();
    expect(betaUrl).not.toContain(a.clubId);
    await expect(sidebar.getByRole("button", { name: /Verein.*Club Beta E2E/ })).toBeVisible();

    // Switch back to Alpha via the club menu (keyboard: arrow keys, Enter).
    const clubMenu = sidebar.getByRole("button", { name: /^Verein/ });
    await clubMenu.focus();
    await page.keyboard.press("ArrowDown");
    const panel = page.getByRole("region", { name: "Verein wechseln" });
    await expect(panel.getByRole("button", { name: /Club Alpha E2E/ })).toBeFocused();
    await page.keyboard.press("Enter");
    await page.waitForURL(`**/clubs/${a.clubId}/calendars/${a.calendarId}`);
    await expect(sidebar.getByRole("button", { name: /Verein.*Club Alpha E2E/ })).toBeVisible();

    // Escape closes the menu and returns focus to its button.
    await sidebar.getByRole("button", { name: /^Verein/ }).click();
    await expect(panel).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(panel).toBeHidden();
    await expect(sidebar.getByRole("button", { name: /^Verein/ })).toBeFocused();

    // "Alle Vereine anzeigen" lists both clubs with counts; the last used one is badged.
    await sidebar.getByRole("button", { name: /^Verein/ }).click();
    await page.getByRole("link", { name: "Alle Vereine anzeigen" }).click();
    await page.waitForURL("**/clubs?select=1");
    // The picker is a standalone page: no sidebar, a single main landmark.
    await expect(page.getByRole("complementary")).toHaveCount(0);
    await expect(page.getByRole("main")).toHaveCount(1);
    await expect(page.getByRole("link", { name: "Club Alpha E2E" })).toHaveAccessibleDescription(
      "1 Kalender · 1 Mitglied",
    );
    await expect(page.getByText("Zuletzt genutzt")).toHaveCount(1);
    await page.getByRole("link", { name: "Club Beta E2E" }).click();
    await page.waitForURL(betaUrl);
  });
});
