import { expect, type APIRequestContext, type CDPSession, type Page } from "@playwright/test";
import { spawnSync } from "node:child_process";
import { createHmac } from "node:crypto";
import { fileURLToPath } from "node:url";

export const API = process.env.E2E_API_URL ?? "http://localhost:3001";
export const PASSWORD = "Sicheres-Passwort-1";

const BACKEND_DIR = fileURLToPath(new URL("../../backend/", import.meta.url));

/**
 * Runs a console command of the backend (`php bin/console …` in backend/) against the e2e database
 * (`E2E_DATABASE_URL`, default: club_calendar_e2e on the test MySQL, port 3360). Xdebug is off unless
 * XDEBUG_MODE is set (an IDE listening on port 9003 would make PHP wait). Returns stdout.
 */
export function backendConsole(...args: string[]): string {
  const run = spawnSync("php", ["bin/console", ...args, "--no-interaction"], {
    cwd: BACKEND_DIR,
    env: {
      ...process.env,
      XDEBUG_MODE: process.env.XDEBUG_MODE ?? "off",
      DATABASE_URL:
        process.env.E2E_DATABASE_URL ??
        "mysql://root:root@127.0.0.1:3360/club_calendar_e2e?serverVersion=8.0&charset=utf8mb4",
    },
  });
  expect(run.status, `${args.join(" ")}: ${run.stderr?.toString()}`).toBe(0);
  return run.stdout.toString();
}

/** A password reset link like the one of the mail (`app:user:reset-link`, the e2e backend sends no mails). */
export function resetLinkFor(email: string): string {
  return backendConsole("app:user:reset-link", email).trim();
}

/**
 * Registers a user through the API and confirms the e-mail address with `app:user:verify` (the e2e
 * backend sends no mails).
 */
export async function createVerifiedUser(request: APIRequestContext, name: string) {
  const email = `e2e-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;
  const res = await request.post(`${API}/api/auth/register`, {
    data: { name, email, password: PASSWORD, language: "de" },
  });
  expect(res.ok()).toBeTruthy();
  backendConsole("app:user:verify", email);
  return email;
}

/** Password field of the login form (no visible required marker). */
export function loginPassword(page: Page) {
  return page.getByLabel(/^Passwort$/);
}

/** Step 1 of the email-first flow: enters the address and presses Continue ("Weiter" / "Continue"). */
export async function continueWithEmail(page: Page, email: string) {
  await page.getByLabel(/^E-Mail|^Email/).fill(email);
  await page.getByRole("button", { name: /^(Weiter|Continue)$/ }).click();
}

/** Signs in through the German email-first form. */
export async function login(page: Page, email: string) {
  await page.goto("/login");
  await continueWithEmail(page, email);
  await loginPassword(page).fill(PASSWORD);
  await page.getByRole("button", { name: "Anmelden", exact: true }).click();
}

/** Authorization headers for direct API calls as the given user. */
export async function authHeaders(request: APIRequestContext, email: string) {
  const auth = await request.post(`${API}/api/auth/login`, { data: { email, password: PASSWORD } });
  const { access_token } = await auth.json();
  return { Authorization: `Bearer ${access_token}` };
}

/** Creates a club with one calendar through the API (as the logged-in browser user would). */
export async function seedClub(request: APIRequestContext, email: string, clubName: string) {
  const headers = await authHeaders(request, email);
  const club = await (
    await request.post(`${API}/api/clubs`, {
      headers,
      data: { name: clubName, timezone: "Europe/Berlin" },
    })
  ).json();
  const calendar = await (
    await request.post(`${API}/api/clubs/${club.id}/calendars`, {
      headers,
      data: { name: `${clubName} Termine` },
    })
  ).json();
  return { clubId: club.id as string, calendarId: calendar.id as string, headers };
}

/**
 * API URL of a resource below a club or calendar: locations, target groups and feeds belong to the club
 * (`/api/clubs/:id/…`), everything else (events, templates, properties, features, holiday calendars) to the
 * calendar (`/api/calendars/:id/…`). `path` may carry a sub path or query (`feeds?includeSecret=1`).
 */
export function resourceUrl(clubId: string, calendarId: string, path: string) {
  const kind = path.split(/[/?]/)[0];
  const clubLevel = ["locations", "target-groups", "feeds"].includes(kind);
  return clubLevel
    ? `${API}/api/clubs/${clubId}/${path}`
    : `${API}/api/calendars/${calendarId}/${path}`;
}

/**
 * Invites `inviteeEmail` to a club (as the member whose headers are given) and accepts the invitation as that
 * user through the API. The mail token is not available to the tests, so the invitee answers by id
 * (`GET /api/invitations`).
 */
export async function inviteAndAccept(
  request: APIRequestContext,
  clubId: string,
  memberHeaders: Record<string, string>,
  inviteeEmail: string,
  role?: "viewer" | "editor" | "admin",
) {
  const invited = await request.post(`${API}/api/clubs/${clubId}/invitations`, {
    headers: memberHeaders,
    data: role ? { email: inviteeEmail, role } : { email: inviteeEmail },
  });
  expect(invited.status()).toBe(204);
  const headers = await authHeaders(request, inviteeEmail);
  const list = (await (await request.get(`${API}/api/invitations`, { headers })).json()) as {
    id: string;
  }[];
  expect(list).toHaveLength(1);
  const accepted = await request.post(`${API}/api/invitations/${list[0].id}/accept`, { headers });
  expect(accepted.ok()).toBeTruthy();
}

/**
 * Presses `key` and waits for the file chooser it opens.
 *
 * `page.waitForEvent("filechooser")` only starts intercepting the dialog once the browser has processed
 * the (fire-and-forget) "intercept file chooser" command. With `Promise.all([waitForEvent, press])` the key
 * press can overtake it: the click on the input still happens, but the native dialog opens
 * un-intercepted and no `filechooser` event ever arrives (a failure in roughly every 20th run). The
 * round trip in between guarantees the interception is active before the key is pressed.
 */
export async function pressForFileChooser(page: Page, key: string) {
  const chooser = page.waitForEvent("filechooser", { timeout: 5000 });
  await page.evaluate(() => undefined);
  await page.keyboard.press(key);
  return chooser;
}

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/** RFC 6238 time step (30 s) of `ms`, default now. */
export function totpStep(ms = Date.now()) {
  return Math.floor(ms / 1000 / 30);
}

/** RFC 6238 TOTP (HMAC-SHA1, 6 digits, 30 s) of a base32 secret for `step` (default: the current one). */
export function totpCode(base32: string, step = totpStep()) {
  const clean = base32.replace(/[\s=-]/g, "").toUpperCase();
  let bits = "";
  for (const ch of clean) bits += BASE32.indexOf(ch).toString(2).padStart(5, "0");
  const key = Buffer.from((bits.match(/.{8}/g) ?? []).map((b) => parseInt(b, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const hash = createHmac("sha1", key).update(counter).digest();
  const offset = hash[hash.length - 1] & 0x0f;
  const bin = hash.readUInt32BE(offset) & 0x7fffffff;
  return String(bin % 1_000_000).padStart(6, "0");
}

/** Adds a CDP virtual authenticator (resident keys, user verification) to the page. */
export async function addVirtualAuthenticator(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  const { authenticatorId } = await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      transport: "internal",
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });
  return { cdp, authenticatorId };
}

/** Email-first sign-in up to and including the password step (no waiting for the target page). */
export async function submitPassword(page: Page, email: string) {
  await page.goto("/login");
  await continueWithEmail(page, email);
  await loginPassword(page).fill(PASSWORD);
  await page.getByRole("button", { name: "Anmelden", exact: true }).click();
}

/** Types a 6-digit code into the CodeInput group (first field focused, digits auto-advance). */
export async function typeDigits(page: Page, code: string) {
  await page.getByLabel("Ziffer 1 von 6").click();
  await page.keyboard.type(code);
}

/** The step-up confirmation dialog (the MFA setup step has the same title, so it is found by its button). */
export function stepUpDialog(page: Page) {
  return page
    .getByRole("dialog")
    .filter({ has: page.getByRole("button", { name: "Bestätigen", exact: true }) });
}

/**
 * Drops the stored step-up token so the next sensitive action asks for the confirmation again. Reloads
 * the page: the app keeps a copy in memory that only a reload clears, and open dialogs are lost.
 */
export async function forgetStepUp(page: Page) {
  await page.evaluate(() => sessionStorage.removeItem("cc_step_up"));
  await page.reload();
}

/** Fills the step-up dialog (password, optional authenticator code) and confirms. The dialog must open. */
export async function confirmStepUp(
  page: Page,
  options: { password?: string; totp?: string } = {},
) {
  const dialog = stepUpDialog(page);
  await dialog.getByLabel(/Dein Passwort/).fill(options.password ?? PASSWORD);
  if (options.totp) {
    await dialog.getByLabel("Ziffer 1 von 6").click();
    await page.keyboard.type(options.totp);
  }
  await dialog.getByRole("button", { name: "Bestätigen", exact: true }).click();
}

/** Confirms the step-up dialog when it opens within a few seconds (a still valid confirmation skips it). */
export async function confirmStepUpIfAsked(
  page: Page,
  options: { password?: string; totp?: string } = {},
) {
  try {
    await stepUpDialog(page).waitFor({ state: "visible", timeout: 3_000 });
  } catch {
    return false;
  }
  await confirmStepUp(page, options);
  await expect(stepUpDialog(page)).toHaveCount(0);
  return true;
}

/**
 * Profile > MFA > add a passkey (German UI): step-up confirmation, ceremony (needs a virtual authenticator),
 * naming, close. Expects the profile page to be open.
 */
export async function addPasskeyInProfile(page: Page, deviceName: string) {
  await page.getByRole("button", { name: "MFA-Methode hinzufügen" }).click();
  const dialog = page.getByRole("dialog", { name: "MFA-Methode hinzufügen" });
  await dialog.getByRole("button", { name: "Passkey", exact: true }).click();
  await dialog.getByRole("button", { name: "Weiter" }).click();
  await confirmStepUpIfAsked(page);
  const naming = page.getByRole("dialog", { name: "Passkey benennen" });
  await naming.getByLabel("Name").fill(deviceName);
  await naming.getByRole("button", { name: "Namen speichern" }).click();
  const done = page.getByRole("dialog", { name: "Fertig" });
  await done.getByRole("button", { name: "Schließen" }).click();
  await expect(done).toHaveCount(0);
}

/**
 * The login page starts a conditional passkey request, which a virtual authenticator with automatic presence
 * simulation answers at once (the page signs in on its own). Turn the simulation off while a password
 * sign-in has to be typed, on again for the passkey ceremony.
 */
export async function setPresenceSimulation(
  cdp: CDPSession,
  authenticatorId: string,
  enabled: boolean,
) {
  await cdp.send("WebAuthn.setAutomaticPresenceSimulation", { authenticatorId, enabled });
}
