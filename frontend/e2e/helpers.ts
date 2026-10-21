import { expect, type APIRequestContext, type Page } from "@playwright/test";
import { spawnSync } from "node:child_process";
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

/** Password field of the login form (accessible name carries the required marker). */
export function loginPassword(page: Page) {
  return page.getByLabel(/^Passwort \(Pflicht\)/);
}

/** Signs in through the German login form. */
export async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("E-Mail").fill(email);
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
