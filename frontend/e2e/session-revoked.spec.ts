import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
import { API, PASSWORD, createVerifiedUser, login, resetLinkFor, seedClub } from "./helpers";

// ——— Ended session (backend raised user.token_version): one refresh attempt, then the login page ———

/**
 * Ends all sessions of the user the way a password reset does (raises user.token_version): a reset link
 * from `app:user:reset-link`, used with the same password, so later sign-ins keep working.
 */
async function revokeSessions(request: APIRequestContext, email: string) {
  const token = new URL(resetLinkFor(email)).searchParams.get("token");
  const res = await request.post(`${API}/api/auth/reset-password`, {
    data: { token, password: PASSWORD },
  });
  expect(res.status()).toBe(204);
}

/** Counts refresh calls and browser dialogs (a "leave page?" prompt would hold the redirect). */
function watch(page: Page) {
  const seen = { refreshes: 0, dialogs: [] as string[] };
  page.on("request", (r) => {
    if (r.url().endsWith("/api/auth/token")) seen.refreshes++;
  });
  page.on("dialog", (d) => {
    seen.dialogs.push(d.type());
    void d.dismiss();
  });
  return seen;
}

async function expectSettledOnLogin(page: Page, seen: { refreshes: number; dialogs: string[] }) {
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole("button", { name: "Anmelden", exact: true })).toBeVisible();
  const refreshes = seen.refreshes;
  // No loop: the login page stays and makes no further refresh attempts.
  await page.waitForTimeout(1500);
  await expect(page).toHaveURL(/\/login$/);
  expect(seen.refreshes).toBe(refreshes);
  expect(seen.dialogs).toEqual([]);
  expect(await page.evaluate(() => sessionStorage.getItem("refresh_token"))).toBeNull();
}

test.describe("Beendete Sitzung", () => {
  test.use({ locale: "de-DE", timezoneId: "Europe/Berlin" });

  test("Seite mit ungespeicherten Änderungen: Speichern führt ohne Rückfrage zur Anmeldung", async ({
    page,
    request,
  }) => {
    const email = await createVerifiedUser(request, "Sitzung Seite");
    const { clubId, calendarId } = await seedClub(request, email, "Sitzung Seite Verein");
    await login(page, email);
    await page.waitForURL(/\/clubs/);
    await page.goto(`/clubs/${clubId}/calendars/${calendarId}/settings`);
    await expect(page.getByRole("heading", { level: 1, name: "Einstellungen" })).toBeVisible();
    await page.getByLabel(/^Kalendername/).fill("Ungespeicherter Name");

    const seen = watch(page);
    await revokeSessions(request, email);
    await page.getByRole("button", { name: "Einstellungen speichern" }).click();

    await expectSettledOnLogin(page, seen);
    // One attempt per rejected request (requests running in parallel each try once), no retry loop.
    expect(seen.refreshes).toBeGreaterThanOrEqual(1);
  });

  test("Termin-Dialog mit ungespeicherten Änderungen: Speichern führt zur Anmeldung", async ({
    page,
    request,
  }) => {
    const email = await createVerifiedUser(request, "Sitzung Dialog");
    const { clubId, calendarId } = await seedClub(request, email, "Sitzung Dialog Verein");
    await login(page, email);
    await page.waitForURL(/\/clubs/);
    await page.goto(`/clubs/${clubId}/calendars/${calendarId}/events/new/form`);
    await expect(page.getByRole("dialog", { name: "Neuer Termin" })).toBeVisible();
    await page.getByLabel("Name (Pflicht)").fill("Ungespeicherter Termin");
    await page.getByLabel("Startdatum (Pflicht)").fill("2026-10-24");

    const seen = watch(page);
    await revokeSessions(request, email);
    await page.getByRole("button", { name: "Termin speichern" }).click();

    await expectSettledOnLogin(page, seen);
    // One attempt per rejected request (requests running in parallel each try once), no retry loop.
    expect(seen.refreshes).toBeGreaterThanOrEqual(1);
  });

  test("Neuladen mit beendeter Sitzung führt zur Anmeldung, erneute Anmeldung funktioniert", async ({
    page,
    request,
  }) => {
    const email = await createVerifiedUser(request, "Sitzung Neuladen");
    const { clubId, calendarId } = await seedClub(request, email, "Sitzung Neuladen Verein");
    await login(page, email);
    await page.waitForURL(/\/clubs/);

    const seen = watch(page);
    await revokeSessions(request, email);
    await page.goto(`/clubs/${clubId}/calendars/${calendarId}/settings`);
    await expectSettledOnLogin(page, seen);
    expect(seen.refreshes).toBeGreaterThanOrEqual(1);

    await login(page, email);
    await page.waitForURL(/\/clubs/);
    await page.goto(`/clubs/${clubId}/calendars/${calendarId}/settings`);
    await expect(page.getByRole("heading", { level: 1, name: "Einstellungen" })).toBeVisible();
  });
});
