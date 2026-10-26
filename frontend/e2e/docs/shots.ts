import { expect, type Locator, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  API,
  PASSWORD,
  authHeaders,
  continueWithEmail,
  createVerifiedUser,
  seedClub,
} from "../helpers";

export const LANGS = ["de", "en"] as const;
export type Lang = (typeof LANGS)[number];

export const VIEWPORT = { width: 1280, height: 800 };
/** Fixed "today" so month titles and event dates never change between runs. */
export const FIXED_NOW = new Date("2026-10-02T10:00:00+02:00");

const OUT_DIR = fileURLToPath(new URL("../../docs/screenshots/", import.meta.url));

const HIDE_VOLATILE = `
  *, *::before, *::after { animation: none !important; transition: none !important; caret-color: transparent !important; }
  [data-sonner-toaster], [role="status"][data-toast], .toast { display: none !important; }
`;

export interface ShotOptions {
  mask?: Locator[];
  fullPage?: boolean;
}

/** Waits for network and fonts, hides volatile UI and writes docs/screenshots/<lang>/<id>.png. */
export async function shot(page: Page, lang: Lang, id: string, opts: ShotOptions = {}) {
  await page.addStyleTag({ content: HIDE_VOLATILE });
  await page.waitForLoadState("networkidle");
  await page.evaluate(() => document.fonts.ready);
  mkdirSync(`${OUT_DIR}${lang}`, { recursive: true });
  await page.screenshot({
    path: `${OUT_DIR}${lang}/${id}.png`,
    animations: "disabled",
    caret: "hide",
    mask: opts.mask,
    fullPage: opts.fullPage,
  });
}

/** Fixed clock, German or English UI, light theme. Call before the first navigation. */
export async function prepare(page: Page, lang: Lang) {
  await page.setViewportSize(VIEWPORT);
  await page.clock.setFixedTime(FIXED_NOW);
  await page.addInitScript((l) => {
    localStorage.setItem("language", l);
    localStorage.setItem("theme", "light");
  }, lang);
}

const EVENTS = [
  { name: "Training Luftgewehr", date: "2026-10-06", timeBegin: "19:00", timeEnd: "21:00" },
  { name: "Jugendtraining", date: "2026-10-08", timeBegin: "17:30", timeEnd: "19:00" },
  { name: "Vorstandssitzung", date: "2026-10-13", timeBegin: "20:00", timeEnd: "21:30" },
  { name: "Vereinsmeisterschaft", date: "2026-10-17", dateEnd: "2026-10-18", isAllDay: true },
  { name: "Training Luftgewehr", date: "2026-10-20", timeBegin: "19:00", timeEnd: "21:00" },
  { name: "Herbstfest", date: "2026-10-24", timeBegin: "15:00", timeEnd: "22:00" },
];

export interface DocsSeed {
  email: string;
  url: string;
}

/** User with a club, one calendar and a few published events in October 2026. */
export async function seedDocs(page: Page, lang: Lang): Promise<DocsSeed> {
  const request = page.request;
  const email = await createVerifiedUser(request, "Max Mustermann");
  const { clubId, calendarId, headers } = await seedClub(
    request,
    email,
    "Schützenverein Musterstadt",
  );
  const me = await request.patch(`${API}/api/auth/me`, { headers, data: { language: lang } });
  expect(me.ok()).toBeTruthy();
  for (const ev of EVENTS) {
    const res = await request.post(`${API}/api/calendars/${calendarId}/events`, {
      headers,
      data: { isDraft: false, timeBegin: "19:00", timeEnd: "21:00", ...ev },
    });
    expect(res.ok(), await res.text()).toBeTruthy();
  }
  return { email, url: `/clubs/${clubId}/calendars/${calendarId}` };
}

/** Signs in through the email-first form in the given language. */
export async function signIn(page: Page, lang: Lang, email: string) {
  await page.goto("/login");
  await continueWithEmail(page, email);
  await page
    .getByLabel(lang === "de" ? /^Passwort \(Pflicht\)/ : /^Password \(required\)/)
    .fill(PASSWORD);
  await page
    .getByRole("button", { name: lang === "de" ? "Anmelden" : /^sign in$/i, exact: lang === "de" })
    .click();
  await page.waitForURL(/\/clubs/);
}

export { authHeaders };
