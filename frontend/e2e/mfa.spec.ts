import { test, expect, type Browser, type Page } from "@playwright/test";
import {
  PASSWORD,
  setPresenceSimulation,
  addVirtualAuthenticator,
  createVerifiedUser,
  login,
  submitPassword,
  totpCode,
  totpStep,
  typeDigits,
} from "./helpers";

// ——— Zwei-Faktor-Anmeldung (MFA): Authenticator-App, Backup-Codes, Passkeys ———

// Without a club the profile has no sidebar; the header button is first in both layouts.
const SIGN_OUT = (page: Page) =>
  page.getByRole("button", { name: "Abmelden", exact: true }).first();
const MFA_FORM = (page: Page) => page.getByRole("form", { name: "Bestätigung mit zweitem Faktor" });

async function openProfile(page: Page, email: string) {
  await login(page, email);
  await page.waitForURL(/\/clubs/);
  await page.goto("/profile");
  await expect(page.getByRole("heading", { level: 1, name: "Profil" })).toBeVisible();
}

/** Profile > MFA > authenticator app: manual key, code, backup codes (acknowledged), password, done. */
async function enableTotp(page: Page) {
  await page.getByRole("button", { name: "MFA-Methode hinzufügen" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Authenticator-App", exact: true }).click();
  const secret = await dialog.getByLabel("Einrichtungsschlüssel").inputValue();
  const step = totpStep();
  await typeDigits(page, totpCode(secret, step));
  await dialog.getByRole("button", { name: "Weiter" }).click();

  await expect(dialog.getByRole("heading", { name: "Deine Backup-Codes" })).toBeVisible();
  const backupCodes = await dialog.locator("ul.ap-code li").allTextContents();
  expect(backupCodes).toHaveLength(10);
  // Without the acknowledgement the dialog stays on the codes
  await dialog.getByRole("button", { name: "Weiter" }).click();
  await expect(
    dialog.getByText("Bitte bestätige, dass du die Backup-Codes aufbewahrt hast."),
  ).toBeVisible();
  await dialog.getByLabel("Ich habe die Backup-Codes aufbewahrt").check();
  await dialog.getByRole("button", { name: "Weiter" }).click();

  await dialog.getByLabel(/Dein Passwort/).fill(PASSWORD);
  await dialog.getByRole("button", { name: "Aktivieren" }).click();
  await expect(dialog.getByText("Die Authenticator-App ist jetzt aktiv.")).toBeVisible();
  await dialog.getByRole("button", { name: "Schließen" }).click();
  await expect(page.getByText("MFA ist eingeschaltet.")).toBeVisible();
  return { secret, step, backupCodes };
}

/** Password step, then the TOTP code of the step after `afterStep` (replays are refused). */
async function loginWithTotp(page: Page, email: string, secret: string, afterStep: number) {
  await submitPassword(page, email);
  await expect(MFA_FORM(page)).toBeVisible();
  await MFA_FORM(page)
    .getByLabel("Code aus der Authenticator-App")
    .fill(totpCode(secret, afterStep + 1));
  await MFA_FORM(page).getByRole("button", { name: "Bestätigen" }).click();
  await page.waitForURL(/\/clubs/);
}

async function secondContext(browser: Browser, baseURL: string | undefined) {
  const context = await browser.newContext({ baseURL, locale: "de-DE" });
  return { context, page: await context.newPage() };
}

test.describe("MFA", () => {
  test.use({ locale: "de-DE", timezoneId: "Europe/Berlin" });

  test("Authenticator-App einschalten, abmelden und mit Passwort + Code anmelden", async ({
    page,
    request,
  }) => {
    const email = await createVerifiedUser(request, "Mfa Totp");
    await openProfile(page, email);
    await expect(page.getByText("MFA ist ausgeschaltet.")).toBeVisible();

    const { secret, step } = await enableTotp(page);
    const list = page.getByRole("list", { name: "Deine MFA-Methoden" });
    await expect(list).toContainText("Authenticator-App");
    await expect(list).toContainText("noch 10 Codes übrig");

    await SIGN_OUT(page).click();
    await expect(page).toHaveURL(/\/login/);
    await submitPassword(page, email);
    await expect(MFA_FORM(page)).toBeVisible();
    // a wrong code is refused and keeps the step
    await MFA_FORM(page).getByLabel("Code aus der Authenticator-App").fill("000000");
    await MFA_FORM(page).getByRole("button", { name: "Bestätigen" }).click();
    await expect(MFA_FORM(page).getByText(/Der Code stimmt nicht/)).toBeVisible();
    await MFA_FORM(page)
      .getByLabel("Code aus der Authenticator-App")
      .fill(totpCode(secret, step + 1));
    await MFA_FORM(page).getByRole("button", { name: "Bestätigen" }).click();
    await page.waitForURL(/\/clubs/);
  });

  test("Anmeldung mit Backup-Code schaltet MFA aus und meldet andere Geräte ab", async ({
    page,
    browser,
    baseURL,
    request,
  }) => {
    const email = await createVerifiedUser(request, "Mfa Backup");
    await openProfile(page, email);
    const { secret, step, backupCodes } = await enableTotp(page);

    // a second device signed in with password + code
    const other = await secondContext(browser, baseURL);
    try {
      await loginWithTotp(other.page, email, secret, step);

      await SIGN_OUT(page).click();
      await submitPassword(page, email);
      await expect(MFA_FORM(page)).toBeVisible();
      await MFA_FORM(page).getByRole("button", { name: "Backup-Code verwenden" }).click();
      await MFA_FORM(page).getByLabel("Backup-Code", { exact: true }).fill(backupCodes[0]);
      await MFA_FORM(page).getByRole("button", { name: "Bestätigen" }).click();
      await page.waitForURL(/\/clubs/);
      await expect(page.getByText(/wurde ausgeschaltet und andere Geräte/)).toBeVisible();

      await page.goto("/profile");
      await expect(page.getByText("MFA ist ausgeschaltet.")).toBeVisible();
      await expect(
        page.getByText("Du hast noch keinen zweiten Faktor eingerichtet."),
      ).toBeVisible();

      // the other device lost its session
      await other.page.goto("/profile");
      await expect(other.page).toHaveURL(/\/login/);
    } finally {
      await other.context.close();
    }
  });

  test("MFA ausschalten verlangt das Passwort und meldet andere Geräte ab", async ({
    page,
    browser,
    baseURL,
    request,
  }) => {
    const email = await createVerifiedUser(request, "Mfa Aus");
    await openProfile(page, email);
    const { secret, step } = await enableTotp(page);

    const other = await secondContext(browser, baseURL);
    try {
      await loginWithTotp(other.page, email, secret, step);

      await page.getByRole("button", { name: "MFA ausschalten" }).click();
      const dialog = page.getByRole("dialog", { name: "MFA ausschalten?" });
      await expect(dialog).toContainText(
        "Die Authenticator-App und die Backup-Codes werden gelöscht.",
      );
      await expect(dialog).toContainText("Alle anderen Geräte werden abgemeldet.");
      await dialog.getByLabel(/Dein Passwort/).fill("falsches-Passwort-1");
      await dialog.getByRole("button", { name: "MFA ausschalten" }).click();
      await expect(dialog.getByText("Das Passwort stimmt nicht.")).toBeVisible();
      await dialog.getByLabel(/Dein Passwort/).fill(PASSWORD);
      await dialog.getByRole("button", { name: "MFA ausschalten" }).click();
      await expect(page.getByText("MFA ist ausgeschaltet.", { exact: true }).first()).toBeVisible();
      await expect(
        page.getByText("Du hast noch keinen zweiten Faktor eingerichtet."),
      ).toBeVisible();

      // the current session stays
      await page.reload();
      await expect(page.getByRole("heading", { level: 1, name: "Profil" })).toBeVisible();
      // the other one is signed out
      await other.page.goto("/profile");
      await expect(other.page).toHaveURL(/\/login/);
    } finally {
      await other.context.close();
    }
  });

  test("Passkey: MFA damit einschalten, mit Passkey bestätigen, letzten Passkey behalten", async ({
    page,
    request,
  }) => {
    const email = await createVerifiedUser(request, "Mfa Passkey");
    await openProfile(page, email);
    const { cdp, authenticatorId } = await addVirtualAuthenticator(page);

    // add a passkey (password proof, ceremony, name)
    await page.getByRole("button", { name: "MFA-Methode hinzufügen" }).click();
    const add = page.getByRole("dialog");
    await add.getByRole("button", { name: "Passkey", exact: true }).click();
    await add.getByLabel(/Dein Passwort/).fill(PASSWORD);
    await add.getByRole("button", { name: "Weiter" }).click();
    const naming = page.getByRole("dialog", { name: "Passkey benennen" });
    await naming.getByLabel("Name").fill("Büro-Laptop");
    await naming.getByRole("button", { name: "Namen speichern" }).click();
    await page
      .getByRole("dialog", { name: "Fertig" })
      .getByRole("button", { name: "Schließen" })
      .click();
    const list = page.getByRole("list", { name: "Deine MFA-Methoden" });
    await expect(list).toContainText("Büro-Laptop");
    await expect(page.getByText("MFA ist ausgeschaltet.")).toBeVisible();

    // enforce MFA with it: backup codes first, then the password
    await page.getByRole("button", { name: "MFA einschalten" }).click();
    const enforce = page.getByRole("dialog", { name: "MFA einschalten" });
    await expect(
      enforce.getByRole("list", { name: "Backup-Codes" }).getByRole("listitem"),
    ).toHaveCount(10);
    const next = enforce.getByRole("button", { name: "Weiter" });
    await expect(next).toBeDisabled();
    await enforce.getByLabel("Ich habe die Backup-Codes aufbewahrt.").check();
    await next.click();
    const proof = page.getByRole("dialog", { name: "MFA einschalten" });
    await proof.getByLabel(/Dein Passwort/).fill(PASSWORD);
    await proof.getByRole("button", { name: "MFA einschalten" }).click();
    await expect(page.getByText("MFA ist eingeschaltet.", { exact: true }).first()).toBeVisible();
    await expect(list).toContainText("noch 10 Codes übrig");

    // the last passkey cannot go while MFA is on and no authenticator app exists
    await page.getByRole("button", { name: "Passkey „Büro-Laptop“ entfernen" }).click();
    const remove = page.getByRole("dialog", { name: "Passkey „Büro-Laptop“ entfernen?" });
    await remove.getByLabel(/Dein Passwort/).fill(PASSWORD);
    await remove.getByRole("button", { name: "Passkey entfernen" }).click();
    await expect(
      remove.getByText(/Du kannst deinen letzten Passkey nicht entfernen/),
    ).toBeVisible();
    await remove.getByRole("button", { name: "Abbrechen" }).click();
    await expect(list).toContainText("Büro-Laptop");

    // sign in with password, then confirm with the passkey
    // the login page would sign in with the passkey on its own (first factor): stay silent until the MFA step
    await setPresenceSimulation(cdp, authenticatorId, false);
    await SIGN_OUT(page).click();
    await expect(page).toHaveURL(/\/login/);
    await submitPassword(page, email);
    await expect(MFA_FORM(page)).toBeVisible();
    await setPresenceSimulation(cdp, authenticatorId, true);
    await MFA_FORM(page).getByRole("button", { name: "Passkey verwenden" }).click();
    await page.waitForURL(/\/clubs/);
  });
});
