import { test, expect } from "@playwright/test";

// The auth pages are tested in German (the design's source language).
test.use({ locale: "de-DE" });

const PASSWORD = "Sicheres-Passwort-1";

test.describe("Login", () => {
  test("login page is accessible", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByRole("heading", { level: 1, name: "Anmelden" })).toBeVisible();
    await expect(page.getByLabel("E-Mail")).toBeVisible();
    await expect(page.getByLabel("Passwort", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Mit Passkey anmelden" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Passwort vergessen?" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Zum Inhalt springen" })).toBeAttached();
    await expect(page.locator("main#main")).toBeVisible();
  });

  test("password can be shown and hidden", async ({ page }) => {
    await page.goto("/login");
    const input = page.getByLabel("Passwort", { exact: true });
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
    await expect(page.getByRole("heading", { level: 1, name: "Sign in" })).toBeVisible();
  });

  test("wrong credentials show an error banner with focus", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("E-Mail").fill("wrong@example.com");
    await page.getByLabel("Passwort", { exact: true }).fill("wrongpassword");
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

  test("login with correct credentials redirects to clubs", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("E-Mail").fill("admin@example.com");
    await page.getByLabel("Passwort", { exact: true }).fill("password123");
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
  test("registers, asks to confirm the email and blocks login until confirmed", async ({
    page,
  }) => {
    const email = `e2e-${Date.now()}@example.com`;
    await page.goto("/login");
    await page.getByRole("link", { name: "Konto erstellen" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Konto erstellen" })).toBeVisible();

    await page.getByLabel(/^Name/).fill("Erika E2E");
    await page.getByLabel(/^E-Mail/).fill(email);
    await page.getByLabel(/^Passwort \(Pflicht\)/).fill(PASSWORD);
    await page.getByLabel(/^Passwort wiederholen/).fill(PASSWORD);
    await page.getByRole("button", { name: "Konto erstellen", exact: true }).click();

    await expect(
      page.getByRole("heading", { level: 1, name: "Bitte bestätige deine E-Mail-Adresse" }),
    ).toBeVisible();
    await expect(page.getByText(email)).toBeVisible();
    await page.getByRole("button", { name: "Bestätigungsmail erneut senden" }).click();
    await expect(page.getByText("Wir haben dir eine neue E-Mail geschickt.")).toBeVisible();

    await page.getByRole("link", { name: "Zur Anmeldung" }).click();
    await page.getByLabel("E-Mail").fill(email);
    await page.getByLabel("Passwort", { exact: true }).fill(PASSWORD);
    await page.getByRole("button", { name: "Anmelden", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("E-Mail-Adresse noch nicht bestätigt");
    await page.getByRole("button", { name: "Bestätigungsmail erneut senden" }).click();
    await expect(page.getByText("Bestätigungsmail gesendet")).toBeVisible();
  });

  test("mismatching passwords are reported", async ({ page }) => {
    await page.goto("/signup");
    await page.getByLabel(/^Name/).fill("Erika E2E");
    await page.getByLabel(/^E-Mail/).fill("erika@example.com");
    await page.getByLabel(/^Passwort \(Pflicht\)/).fill(PASSWORD);
    await page.getByLabel(/^Passwort wiederholen/).fill("etwas-anderes-123");
    await page.getByRole("button", { name: "Konto erstellen", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText("Das Konto wurde noch nicht erstellt");
    await expect(page.getByLabel(/^Passwort wiederholen/)).toHaveAttribute("aria-invalid", "true");
    await expect(page).toHaveURL(/\/signup/);
  });

  test("an existing email address points to the login", async ({ page }) => {
    await page.goto("/signup");
    await page.getByLabel(/^Name/).fill("Admin Zwei");
    await page.getByLabel(/^E-Mail/).fill("admin@example.com");
    await page.getByLabel(/^Passwort \(Pflicht\)/).fill(PASSWORD);
    await page.getByLabel(/^Passwort wiederholen/).fill(PASSWORD);
    await page.getByRole("button", { name: "Konto erstellen", exact: true }).click();
    const alert = page.getByRole("alert");
    await expect(alert).toContainText("schon ein Konto");
    await alert.getByRole("link", { name: "Zur Anmeldung" }).click();
    await expect(page).toHaveURL(/\/login/);
  });
});

test.describe("Forgot password and email confirmation", () => {
  test("forgot password page is reachable and its action is disabled", async ({ page }) => {
    await page.goto("/login");
    await page.getByRole("link", { name: "Passwort vergessen?" }).click();
    await expect(page).toHaveURL(/\/forgot-password/);
    await expect(
      page.getByRole("heading", { level: 1, name: "Passwort vergessen?" }),
    ).toBeVisible();
    await expect(page.getByRole("status")).toContainText("Bald verfügbar");
    await page.getByLabel(/^E-Mail/).fill("alex@beispiel.de");
    await expect(page.getByRole("button", { name: "Link zum Zurücksetzen senden" })).toBeDisabled();
    await page.getByRole("link", { name: "Zurück zur Anmeldung" }).click();
    await expect(page).toHaveURL(/\/login/);
  });

  test("verification link outcomes are explained", async ({ page }) => {
    await page.goto("/auth/verify-email?status=success");
    await expect(
      page.getByRole("heading", { level: 1, name: "E-Mail-Adresse bestätigt" }),
    ).toBeVisible();
    await page.goto("/auth/verify-email?status=error&reason=expired");
    await expect(
      page.getByRole("heading", { level: 1, name: "Der Link ist abgelaufen" }),
    ).toBeVisible();
    await page.goto("/auth/verify-email?status=error&reason=already_used");
    await expect(
      page.getByRole("heading", { level: 1, name: "Der Link wurde schon benutzt" }),
    ).toBeVisible();
    await page.goto("/auth/verify-email?status=error&reason=invalid");
    await expect(
      page.getByRole("heading", { level: 1, name: "Der Link ist ungültig" }),
    ).toBeVisible();
  });
});
