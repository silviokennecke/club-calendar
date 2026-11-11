import { expect, type Locator, type Page } from "@playwright/test";
import { PASSWORD, authHeaders, continueWithEmail } from "../helpers";

export const LANGS = ["de", "en"] as const;
export type Lang = (typeof LANGS)[number];

export const VIEWPORT = { width: 1280, height: 800 };
/** Fixed "today" so month titles and event dates never change between runs. */
export const FIXED_NOW = new Date("2026-10-02T10:00:00+02:00");

const HIDE_VOLATILE = `
  *, *::before, *::after { animation: none !important; transition: none !important; caret-color: transparent !important; }
  [data-sonner-toaster], [role="status"][data-toast], .toast { display: none !important; }
`;

export interface ShotOptions {
  mask?: Locator[];
  fullPage?: boolean;
}

/** Waits for network and fonts, hides volatile UI and checks docs/screenshots/<lang>/<id>.png. */
export async function shot(page: Page, lang: Lang, id: string, opts: ShotOptions = {}) {
  // The pointer stays where the last click was and would show a hover state (e.g. a day circle).
  await page.mouse.move(VIEWPORT.width - 2, 2);
  // A late client-side navigation can destroy the execution context once: retry.
  for (let i = 0; ; i++) {
    try {
      await page.waitForLoadState("networkidle");
      await page.addStyleTag({ content: HIDE_VOLATILE });
      break;
    } catch (e) {
      if (i >= 2) throw e;
    }
  }
  await page.waitForLoadState("networkidle");
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() => {
    // Playwright scrolls clicked controls into view (page, main and inner containers like tables).
    window.scrollTo(0, 0);
    for (const el of document.querySelectorAll("*")) {
      if (el.scrollLeft > 0 || el.scrollTop > 0) {
        if (!el.closest('[role="dialog"], [role="alertdialog"]')) el.scrollTo(0, 0);
      }
    }
  });
  // Compared against the committed PNG (pathTemplate in playwright.config.ts): renderer noise of a few
  // pixels keeps the file, a real change fails and is rewritten by `--update-snapshots` (npm script).
  await expect(page).toHaveScreenshot(`${id}.png`, {
    animations: "disabled",
    caret: "hide",
    mask: opts.mask,
    fullPage: opts.fullPage,
    maxDiffPixels: 50,
  });
}

/** Fixed clock, German or English UI, light theme. Call before the first navigation. */
export async function prepare(page: Page, lang: Lang, height = VIEWPORT.height) {
  await page.setViewportSize({ width: VIEWPORT.width, height });
  await page.clock.setFixedTime(FIXED_NOW);
  await page.addInitScript((l) => {
    localStorage.setItem("language", l);
    localStorage.setItem("theme", "light");
  }, lang);
}

/** Signs in through the email-first form in the given language. */
export async function signIn(page: Page, lang: Lang, email: string) {
  await page.goto("/login");
  await continueWithEmail(page, email);
  await page.getByLabel(lang === "de" ? /^Passwort$/ : /^Password$/).fill(PASSWORD);
  await page
    .getByRole("button", { name: lang === "de" ? "Anmelden" : /^sign in$/i, exact: lang === "de" })
    .click();
  await page.waitForURL(/\/clubs/);
}

export { authHeaders };
