import { test, expect, type Page } from "@playwright/test";
import {
  API,
  PASSWORD,
  apiLogin,
  authHeaders,
  backendConsole,
  continueWithEmail,
  createLegacyUser,
  createVerifiedUser,
  login,
  loginPassword,
  resetLinkFor,
} from "./helpers";

// ——— OPAQUE password protocol: the password never leaves the browser (docs/ops/OPAQUE-PLAN.md) ———

test.use({ locale: "de-DE", timezoneId: "Europe/Berlin" });
// The Argon2id key stretching (64 MiB) runs in the browser: several rounds per test.
test.setTimeout(90_000);

const NEW_PASSWORD = "Neues-Passwort-2";

/** Records every request (URL and body) so a test can assert that no password was ever sent. */
function recordRequests(page: Page) {
  const seen: { url: string; body: string }[] = [];
  page.on("request", (r) => {
    seen.push({ url: r.url(), body: r.postData() ?? "" });
  });
  return {
    seen,
    leaks(...secrets: string[]) {
      return seen.filter((r) => secrets.some((s) => r.url.includes(s) || r.body.includes(s)));
    },
    hit(path: string) {
      return seen.some((r) => r.url.includes(path));
    },
  };
}

async function me(request: Parameters<typeof authHeaders>[0], email: string) {
  const headers = await authHeaders(request, email);
  return (await request.get(`${API}/api/auth/me`, { headers })).json();
}

test.describe("OPAQUE", () => {
  test("signup, confirmation and login never send the password; a wrong password is reported", async ({
    page,
    request,
  }) => {
    const rec = recordRequests(page);
    const email = `e2e-opaque-${Date.now()}@example.com`;

    await page.goto("/login");
    await continueWithEmail(page, email);
    await expect(page.getByRole("heading", { level: 1, name: "Konto erstellen" })).toBeVisible();
    await page.getByLabel(/^Name/).fill("Opaque Nutzer");
    await page.getByLabel(/^Passwort \(Pflicht\)/).fill(PASSWORD);
    await page.getByLabel(/^Passwort wiederholen/).fill(PASSWORD);
    await page.getByRole("button", { name: "Konto erstellen", exact: true }).click();
    await expect(page).toHaveURL(/\/verify-email$/);
    expect(rec.hit("/api/auth/opaque/register/start")).toBe(true);
    expect(rec.hit("/api/auth/opaque/register/finish")).toBe(true);

    // The mail code is not readable in e2e: confirm the address like the other helpers do.
    backendConsole("app:user:verify", email);
    await page.getByRole("button", { name: "Abmelden" }).click();

    await login(page, email);
    await page.waitForURL(/\/clubs/);
    expect(rec.hit("/api/auth/opaque/login/start")).toBe(true);
    expect(rec.hit("/api/auth/opaque/login/finish")).toBe(true);
    expect(rec.hit("/api/auth/login")).toBe(false);
    expect(rec.leaks(PASSWORD)).toEqual([]);
    expect((await me(request, email)).passwordProtocol).toBe("opaque");

    // Wrong password: same message as before, still no password on the wire.
    await page.evaluate(() => sessionStorage.clear());
    await page.goto("/login");
    await continueWithEmail(page, email);
    await loginPassword(page).fill("falsches-Passwort-9");
    await page.getByRole("button", { name: "Anmelden", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText("E-Mail oder Passwort stimmt nicht");
    expect(rec.leaks(PASSWORD, "falsches-Passwort-9")).toEqual([]);
  });

  test("a legacy account signs in with its password and is upgraded in the background", async ({
    page,
    request,
  }) => {
    const email = await createLegacyUser(request, "Legacy Nutzer");
    const rec = recordRequests(page);

    await login(page, email);
    await page.waitForURL(/\/clubs/);
    expect(rec.hit("/api/auth/login")).toBe(true);

    // The upgrade runs after the navigation; poll until the record exists.
    await expect
      .poll(
        async () => {
          const auth = await apiLogin(request, email);
          if (auth.status !== 200) return "none";
          const m = await request.get(`${API}/api/auth/me`, {
            headers: { Authorization: `Bearer ${auth.body.access_token}` },
          });
          return (await m.json()).passwordProtocol;
        },
        { timeout: 30_000 },
      )
      .toBe("opaque");
    expect((await apiLogin(request, email)).status).toBe(200);

    // Next sign-in goes over OPAQUE.
    await page.evaluate(() => sessionStorage.clear());
    const rec2 = recordRequests(page);
    await login(page, email);
    await page.waitForURL(/\/clubs/);
    expect(rec2.hit("/api/auth/opaque/login/finish")).toBe(true);
    expect(rec2.leaks(PASSWORD)).toEqual([]);
  });

  test("password reset sets a new OPAQUE password without sending it", async ({
    page,
    request,
  }) => {
    const email = await createVerifiedUser(request, "Reset Opaque");
    const link = new URL(resetLinkFor(email));
    const rec = recordRequests(page);

    await page.goto(link.pathname + link.search);
    await page.getByLabel(/^Neues Passwort/).fill(NEW_PASSWORD);
    await page.getByLabel(/^Passwort wiederholen/).fill(NEW_PASSWORD);
    await page.getByRole("button", { name: "Passwort speichern" }).click();
    await expect(
      page.getByRole("heading", { level: 1, name: "Passwort gespeichert" }),
    ).toBeVisible();
    expect(rec.hit("/api/auth/opaque/register/finish")).toBe(true);
    expect(rec.leaks(NEW_PASSWORD)).toEqual([]);

    expect((await apiLogin(request, email, PASSWORD)).status).toBe(401);
    expect((await apiLogin(request, email, NEW_PASSWORD)).status).toBe(200);
  });

  test("changing the password and deleting the account use re-authentication tickets", async ({
    page,
    request,
  }) => {
    const email = await createVerifiedUser(request, "Profil Opaque");
    const rec = recordRequests(page);
    await login(page, email);
    await page.waitForURL(/\/clubs/);
    await page.goto("/profile");

    const password = page.getByRole("region", { name: "Passwort" });
    await password.getByLabel(/^Aktuelles Passwort/).fill("falsch-falsch");
    await password.getByLabel(/^Neues Passwort/).fill(NEW_PASSWORD);
    await password.getByLabel(/^Passwort wiederholen/).fill(NEW_PASSWORD);
    await password.getByRole("button", { name: "Passwort ändern" }).click();
    await expect(password.getByText("Das Passwort stimmt nicht.")).toBeVisible();
    await password.getByLabel(/^Aktuelles Passwort/).fill(PASSWORD);
    await password.getByRole("button", { name: "Passwort ändern" }).click();
    await expect(page.getByText(/Passwort geändert/)).toBeVisible();
    expect(rec.hit("/api/auth/opaque/reauth/start")).toBe(true);
    expect(rec.hit("/api/auth/change-password")).toBe(false);
    expect((await apiLogin(request, email, NEW_PASSWORD)).status).toBe(200);
    expect((await apiLogin(request, email, PASSWORD)).status).toBe(401);

    await page.getByRole("button", { name: "Konto löschen" }).click();
    const dialog = page.getByRole("dialog", { name: "Konto löschen?" });
    await dialog.getByLabel(/Zur Bestätigung dein Passwort/).fill(NEW_PASSWORD);
    const confirm = dialog.getByRole("button", { name: "Konto löschen" });
    await confirm.focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/login/);
    expect(rec.leaks(PASSWORD, NEW_PASSWORD)).toEqual([]);
    expect((await apiLogin(request, email, NEW_PASSWORD)).status).toBe(401);
  });
});
