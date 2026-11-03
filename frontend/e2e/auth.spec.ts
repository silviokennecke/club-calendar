import { test, expect } from "@playwright/test";
import { API, continueWithEmail, loginPassword } from "./helpers";

// The auth pages are tested in German (the design's source language).
test.use({ locale: "de-DE" });

const PASSWORD = "Sicheres-Passwort-1";

test.describe("Login", () => {
  test("login page is accessible", async ({ page }) => {
    await page.goto("/login");
    await expect(
      page.getByRole("heading", { level: 1, name: "Anmelden oder Konto erstellen" }),
    ).toBeVisible();
    await expect(page.getByLabel(/^E-Mail \(Pflicht\)/)).toBeVisible();
    await expect(loginPassword(page)).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Mit Passkey anmelden" })).toBeVisible();

    // an existing address leads to the password step; SSO and passkey disappear, Back returns
    await continueWithEmail(page, "admin@example.com");
    await expect(page.getByRole("heading", { level: 1, name: "Anmelden" })).toBeVisible();
    await expect(loginPassword(page)).toBeFocused();
    await expect(page.getByRole("link", { name: "Passwort vergessen?" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Mit Passkey anmelden" })).toHaveCount(0);
    await page.getByRole("button", { name: "Zurück" }).click();
    await expect(page.getByLabel(/^E-Mail \(Pflicht\)/)).toHaveValue("admin@example.com");
    await expect(page.getByRole("button", { name: "Mit Passkey anmelden" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Zum Inhalt springen" })).toBeAttached();
    await expect(page.locator("main#main")).toBeVisible();
  });

  test("password can be shown and hidden", async ({ page }) => {
    await page.goto("/login");
    await continueWithEmail(page, "admin@example.com");
    const input = loginPassword(page);
    const toggle = page.getByRole("button", { name: "Passwort anzeigen" });
    await input.fill("geheim");
    await expect(input).toHaveAttribute("type", "password");
    await toggle.click();
    await expect(input).toHaveAttribute("type", "text");
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
    await toggle.click();
    await expect(input).toHaveAttribute("type", "password");
  });

  test("language can be switched", async ({ page }) => {
    await page.goto("/login");
    await page.getByRole("button", { name: "English" }).click();
    await expect(
      page.getByRole("heading", { level: 1, name: "Sign in or create an account" }),
    ).toBeVisible();
  });

  test("wrong credentials show an error banner with focus", async ({ page }) => {
    await page.goto("/login");
    await continueWithEmail(page, "admin@example.com");
    await loginPassword(page).fill("wrongpassword");
    await page.getByRole("button", { name: "Anmelden", exact: true }).click();
    const alert = page.getByRole("alert");
    await expect(alert).toContainText("E-Mail oder Passwort stimmt nicht");
    await expect(alert.locator("xpath=..")).toBeFocused();
    await expect(page).toHaveURL(/\/login/);
    await alert.getByRole("link", { name: "Passwort zurücksetzen" }).click();
    await expect(page).toHaveURL(/\/forgot-password/);
  });

  test("failed SSO shows an explanation on the login page", async ({ page }) => {
    await page.goto("/auth/callback?error=oauth_failed");
    await expect(page).toHaveURL(/\/login\?error=/);
    await expect(page.getByRole("alert")).toContainText(
      "Anmeldung mit Google oder Microsoft nicht möglich",
    );
  });

  test("an SSO login code without a verifier from this tab is rejected", async ({ page }) => {
    await page.goto("/auth/callback?code=invalid");
    await expect(page).toHaveURL(/\/login\?error=invalid_code_verifier/);
    expect(page.url()).not.toContain("code=invalid");
    await expect(page.getByRole("alert")).toContainText("in einem anderen Browser oder Tab");
  });

  test("an invalid SSO login code is explained and never stays in the URL", async ({ page }) => {
    await page.goto("/login");
    await page.evaluate(() => sessionStorage.setItem("sso_code_verifier", "x".repeat(64)));
    await page.goto("/auth/callback?code=invalid");
    await expect(page).toHaveURL(/\/login\?error=invalid_login_code/);
    expect(page.url()).not.toContain("code=invalid");
    await expect(page.getByRole("alert")).toContainText(
      "Die Anmeldung ist abgelaufen oder wurde bereits verwendet",
    );
  });

  const ssoTexts: Record<string, string> = {
    invalid_state:
      "Die Anmeldung ist abgelaufen oder wurde in einem anderen Browserfenster begonnen.",
    account_exists: "Zu dieser E-Mail-Adresse gibt es schon ein Konto.",
    email_missing: "Der Anbieter hat uns keine E-Mail-Adresse übermittelt.",
    provider_denied: "Du hast die Anmeldung beim Anbieter abgebrochen.",
    provider_error: "Der Anbieter hat die Anmeldung nicht abgeschlossen.",
    email_unverified_at_provider: "Deine E-Mail-Adresse ist beim Anbieter noch nicht bestätigt.",
  };
  for (const [code, text] of Object.entries(ssoTexts)) {
    test(`SSO error code ${code} shows its own explanation`, async ({ page }) => {
      await page.goto(`/auth/callback?error=${code}`);
      await expect(page).toHaveURL(new RegExp(`/login\\?error=${code}`));
      const alert = page.getByRole("alert");
      await expect(alert).toContainText("Anmeldung mit Google oder Microsoft nicht möglich");
      await expect(alert).toContainText(text);
    });
  }

  test("SSO callback without the browser's state is rejected by the API", async ({ page }) => {
    // Login CSRF: a callback URL that was not started in this browser must not sign in.
    await page.goto(`${API}/api/auth/oauth/google/callback?code=x&state=forged`);
    await expect(page).toHaveURL(/\/login\?error=invalid_state/);
    await expect(page.getByRole("alert")).toContainText(
      "Anmeldung mit Google oder Microsoft nicht möglich",
    );
  });

  test("login with correct credentials redirects to clubs", async ({ page }) => {
    await page.goto("/login");
    await continueWithEmail(page, "admin@example.com");
    await loginPassword(page).fill("password123");
    await page.getByRole("button", { name: "Anmelden", exact: true }).click();
    await page.waitForURL("**/clubs**");
    await expect(page).toHaveURL(/\/clubs/);
  });

  test("unauthenticated user is redirected to login", async ({ page }) => {
    await page.goto("/clubs");
    await page.waitForURL("**/login");
    await expect(page).toHaveURL(/\/login/);
  });
});

test.describe("Registration", () => {
  test("registers into a restricted session, asks to confirm the email and gates the app until confirmed", async ({
    page,
  }) => {
    const email = `e2e-${Date.now()}@example.com`;
    await page.goto("/login");
    await continueWithEmail(page, email);
    await expect(page.getByRole("heading", { level: 1, name: "Konto erstellen" })).toBeVisible();

    await page.getByLabel(/^Name/).fill("Erika E2E");
    await page.getByLabel(/^Passwort \(Pflicht\)/).fill(PASSWORD);
    await page.getByLabel(/^Passwort wiederholen/).fill(PASSWORD);
    await page.getByRole("button", { name: "Konto erstellen", exact: true }).click();

    // No mail is sent in e2e (the code cannot be read): check the page and the failure paths
    await expect(page).toHaveURL(/\/verify-email$/);
    await expect(
      page.getByRole("heading", { level: 1, name: "E-Mail-Adresse bestätigen" }),
    ).toBeVisible();
    await expect(page.getByText(email)).toBeVisible();
    // the labelled field and the digit group inside it share the name
    await expect(page.getByRole("group", { name: "Bestätigungscode" }).first()).toBeVisible();

    await page.getByLabel("Ziffer 1 von 6").click();
    await page.keyboard.type("000000");
    await expect(page.getByRole("alert")).toContainText("falsch, abgelaufen oder aufgebraucht");
    await expect(page.getByLabel("Ziffer 1 von 6")).toHaveAttribute("aria-invalid", "true");

    // right after the registration a new code is either refused ("too early") or sent
    await page.getByRole("button", { name: "Erneut senden" }).click();
    await expect(
      page.getByText(
        /Du kannst um .* Uhr einen neuen Code anfordern|Ein neuer Code wurde gesendet/,
      ),
    ).toBeVisible();

    // the session is restricted: every app page leads back to the code page
    await page.goto("/clubs");
    await expect(page).toHaveURL(/\/verify-email$/);

    await page.getByRole("button", { name: "Abmelden" }).click();
    await expect(
      page.getByRole("heading", { level: 1, name: "Anmelden oder Konto erstellen" }),
    ).toBeVisible();
    await continueWithEmail(page, email);
    await loginPassword(page).fill(PASSWORD);
    await page.getByRole("button", { name: "Anmelden", exact: true }).click();
    await expect(page).toHaveURL(/\/verify-email$/);
    await expect(page.getByText(email)).toBeVisible();
  });

  test("mismatching passwords are reported", async ({ page }) => {
    await page.goto("/signup");
    await continueWithEmail(page, `erika-${Date.now()}@example.com`);
    await page.getByLabel(/^Name/).fill("Erika E2E");
    await page.getByLabel(/^Passwort \(Pflicht\)/).fill(PASSWORD);
    await page.getByLabel(/^Passwort wiederholen/).fill("etwas-anderes-123");
    await page.getByRole("button", { name: "Konto erstellen", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText("Das Konto wurde noch nicht erstellt");
    await expect(page.getByLabel(/^Passwort wiederholen/)).toHaveAttribute("aria-invalid", "true");
    await expect(page).toHaveURL(/\/signup/);
  });

  test("an existing email address leads to the password step instead of the signup", async ({
    page,
  }) => {
    await page.goto("/signup");
    await continueWithEmail(page, "admin@example.com");
    await expect(page.getByRole("heading", { level: 1, name: "Anmelden" })).toBeVisible();
    await expect(loginPassword(page)).toBeVisible();
    await expect(page.getByLabel(/^Passwort wiederholen/)).toHaveCount(0);
  });
});

test.describe("Forgot password and email confirmation", () => {
  test("forgot password answers the same for unknown addresses ('Prüfe dein Postfach')", async ({
    page,
  }) => {
    await page.goto("/login");
    await continueWithEmail(page, "admin@example.com");
    await page.getByRole("link", { name: "Passwort vergessen?" }).click();
    await expect(page).toHaveURL(/\/forgot-password/);
    await expect(
      page.getByRole("heading", { level: 1, name: "Passwort vergessen?" }),
    ).toBeVisible();
    await expect(page.getByText("Bald verfügbar")).toHaveCount(0);
    await page.getByLabel(/^E-Mail/).fill(`nobody-${Date.now()}@example.com`);
    await page.getByRole("button", { name: "Link zum Zurücksetzen senden" }).click();
    await expect(
      page.getByRole("heading", { level: 1, name: "Prüfe dein Postfach" }),
    ).toBeVisible();
    await expect(page.getByRole("status")).toContainText("nobody-");
    await page.getByRole("link", { name: "Zurück zur Anmeldung" }).click();
    await expect(page).toHaveURL(/\/login/);
  });

  test("the code page without a session leads to the login", async ({ page }) => {
    await page.goto("/verify-email");
    await expect(page).toHaveURL(/\/login/);
  });

  test("the outcomes of the e-mail change link are explained", async ({ page }) => {
    await page.goto("/auth/verify-email?status=email_changed");
    await expect(
      page.getByRole("heading", { level: 1, name: "E-Mail-Adresse geändert" }),
    ).toBeVisible();
    await page.goto("/auth/verify-email?status=error&reason=expired&flow=email_change");
    await expect(
      page.getByRole("heading", { level: 1, name: "Der Link ist abgelaufen" }),
    ).toBeVisible();
    await page.goto("/auth/verify-email?status=error&reason=invalid&flow=email_change");
    await expect(
      page.getByRole("heading", { level: 1, name: "Der Link ist ungültig" }),
    ).toBeVisible();
  });
});
