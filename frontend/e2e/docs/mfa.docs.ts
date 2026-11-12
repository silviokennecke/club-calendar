import { test, expect, type Page } from "@playwright/test";
import {
  API,
  PASSWORD,
  addVirtualAuthenticator,
  authHeaders,
  continueWithEmail,
  createVerifiedUser,
  seedClub,
  setPresenceSimulation,
  totpCode,
} from "../helpers";
import { LANGS, prepare, shot, signIn, type Lang } from "./shots";

const T = {
  de: {
    add: "MFA-Methode hinzufügen",
    totp: "Authenticator-App",
    passkey: "Passkey",
    next: /^Weiter$/,
    key: "Einrichtungsschlüssel",
    digit: /^Ziffer 1/,
    ack: "Ich habe die Backup-Codes aufbewahrt",
    password: /Dein Passwort/,
    activate: "Aktivieren",
    close: "Schließen",
    nameDialog: "Passkey benennen",
    name: "Name",
    saveName: "Namen speichern",
    done: "Fertig",
    password1: /^Passwort$/,
    signIn: "Anmelden",
  },
  en: {
    add: "Add MFA method",
    totp: "Authenticator app",
    passkey: "Passkey",
    next: /^(Next|Continue)$/,
    key: "Setup key",
    digit: /^Digit 1/,
    ack: "I stored the backup codes",
    password: /Your password/,
    activate: "Activate",
    close: "Close",
    nameDialog: "Name your passkey",
    name: "Name",
    saveName: "Save name",
    done: "Done",
    password1: /^Password$/,
    signIn: "Sign in",
  },
} as const;

/** The address contains a random id: show a fixed one. */
async function fixEmail(page: Page) {
  await page.evaluate(() => {
    const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = w.nextNode(); n; n = w.nextNode()) {
      if (/e2e-.*@example\.com/.test(n.textContent ?? ""))
        n.textContent = (n.textContent ?? "").replace(
          /e2e-\S*@example\.com/,
          "max.mustermann@example.com",
        );
    }
  });
}

for (const lang of LANGS) {
  test.describe(`docs screenshots mfa (${lang})`, () => {
    test.use({ locale: lang === "de" ? "de-DE" : "en-US", timezoneId: "Europe/Berlin" });

    test("mfa", async ({ page }) => {
      const t = T[lang as Lang];
      await prepare(page, lang);
      const email = await createVerifiedUser(page.request, "Max Mustermann");
      await seedClub(page.request, email, "SV Musterstadt");
      await page.request.patch(`${API}/api/auth/me`, {
        headers: await authHeaders(page.request, email),
        data: { language: lang },
      });
      const { cdp, authenticatorId } = await addVirtualAuthenticator(page);
      await setPresenceSimulation(cdp, authenticatorId, false);
      await signIn(page, lang, email);
      await page.goto("/profile/security");
      await expect(page.getByRole("button", { name: t.add })).toBeVisible();

      // 1. A passkey first, so the method choice shows it.
      await setPresenceSimulation(cdp, authenticatorId, true);
      await page.getByRole("button", { name: t.add }).click();
      let dialog = page.getByRole("dialog");
      await dialog.getByRole("button", { name: t.passkey, exact: true }).click();
      await dialog.getByLabel(t.password).fill(PASSWORD);
      await dialog.getByRole("button", { name: t.next }).click();
      const naming = page.getByRole("dialog", { name: t.nameDialog });
      await naming.getByLabel(t.name).fill(lang === "de" ? "Büro-PC" : "Office PC");
      await naming.getByRole("button", { name: t.saveName }).click();
      const done = page.getByRole("dialog");
      await done.getByRole("button", { name: t.close }).click();
      await expect(done).toHaveCount(0);
      await setPresenceSimulation(cdp, authenticatorId, false);

      await fixEmail(page);
      // 2. Method choice.
      await page.getByRole("button", { name: t.add }).click();
      dialog = page.getByRole("dialog");
      await expect(dialog.getByRole("button", { name: t.totp, exact: true })).toBeEnabled();
      await shot(page, lang, "mfa-add-method");

      // 3. Authenticator setup; QR code and key are random per run.
      await dialog.getByRole("button", { name: t.totp, exact: true }).click();
      const key = dialog.getByLabel(t.key);
      const secret = await key.inputValue();
      await page.evaluate(() => {
        const img = document.querySelector<HTMLImageElement>('[role="dialog"] img');
        if (img) {
          const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="192" height="192"><rect width="192" height="192" fill="#e6e6e6"/></svg>`;
          img.src = `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
        }
        const input = document.querySelector<HTMLInputElement>('[role="dialog"] input[readonly]');
        if (input) input.value = "ABCD EFGH IJKL MNOP";
      });
      await shot(page, lang, "mfa-totp-setup");
      await dialog.getByLabel(t.digit).first().click();
      await page.keyboard.type(totpCode(secret));
      await dialog.getByRole("button", { name: t.next }).click();

      // 4. Backup codes, values hidden.
      await expect(dialog.locator("ul.ap-code li")).toHaveCount(10);
      await page.evaluate(() => {
        for (const li of document.querySelectorAll("ul.ap-code li")) li.textContent = "XXXXX-XXXXX";
      });
      await shot(page, lang, "mfa-backup-codes");
      await dialog.getByLabel(t.ack).check();
      await dialog.getByRole("button", { name: t.next }).click();
      await dialog.getByLabel(t.password).fill(PASSWORD);
      await dialog.getByLabel(t.password).press("Enter");
      await dialog
        .getByRole("button", { name: t.close })
        .click({ timeout: 5000 })
        .catch(() => undefined);
      await expect(dialog).toHaveCount(0);

      // 5. Profile section with all three rows; the "added on" dates are the real server date.
      await page.evaluate(() => {
        const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        for (let n = w.nextNode(); n; n = w.nextNode()) {
          n.textContent = (n.textContent ?? "").replace(
            /\d{1,2}[./]\d{1,2}[./]\d{4}/g,
            "02.10.2026",
          );
        }
      });
      await fixEmail(page);
      // Show only the MFA section: hide the other profile sections.
      await page
        .getByRole("list", { name: lang === "de" ? "Deine MFA-Methoden" : "Your MFA methods" })
        .evaluate((list) => {
          const section = list.closest<HTMLElement>('[role="region"], section');
          if (!section) throw new Error("MFA section not found");
          for (const el of Array.from(section.parentElement?.children ?? []) as HTMLElement[]) {
            if (el === section) continue;
            el.style.display = "none";
          }
        });
      await shot(page, lang, "profile-mfa");

      // 6. Sign-in asks for the code.
      await page
        .getByRole("button", { name: lang === "de" ? "Abmelden" : "Sign out", exact: true })
        .first()
        .click();
      await expect(page).toHaveURL(/\/login/);
      await page.waitForLoadState("networkidle");
      await expect(async () => {
        await continueWithEmail(page, email);
        await expect(page.getByLabel(t.password1)).toBeVisible({ timeout: 3000 });
      }).toPass({ timeout: 20000 });
      await page.getByLabel(t.password1).fill(PASSWORD);
      await page.getByRole("button", { name: t.signIn, exact: true }).click();
      await expect(
        page.getByRole("form", {
          name: lang === "de" ? "Bestätigung mit MFA" : "MFA confirmation",
        }),
      ).toBeVisible();
      await page.evaluate(() => {
        const input = document.querySelector<HTMLInputElement>('input[readonly][value*="e2e-"]');
        if (input) input.value = "max.mustermann@example.com";
      });
      await shot(page, lang, "sign-in-mfa");
    });
  });
}
