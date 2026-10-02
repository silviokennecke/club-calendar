import { expect, type APIRequestContext, type Page } from "@playwright/test";
import { spawnSync } from "node:child_process";

export const API = process.env.E2E_API_URL ?? "http://localhost:3001";
export const PASSWORD = "Sicheres-Passwort-1";

/**
 * Registers a user through the API and confirms the e-mail address directly in the database
 * (the e2e backend sends no mails). Needs a PHP CLI with pdo_mysql and the e2e database; set
 * E2E_DB_DSN / E2E_DB_USER / E2E_DB_PASSWORD to override the defaults (test MySQL, port 3360).
 */
export async function createVerifiedUser(request: APIRequestContext, name: string) {
  const email = `e2e-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;
  const res = await request.post(`${API}/api/auth/register`, {
    data: { name, email, password: PASSWORD, language: "de" },
  });
  expect(res.ok()).toBeTruthy();
  const php = `
    $p = new PDO(getenv('DSN'), getenv('DB_USER'), getenv('DB_PASSWORD'));
    $s = $p->prepare('UPDATE user SET is_email_verified = 1 WHERE email = ?');
    $s->execute([getenv('EMAIL')]);
    exit($s->rowCount() === 1 ? 0 : 1);`;
  const run = spawnSync("php", ["-r", php], {
    env: {
      ...process.env,
      DSN: process.env.E2E_DB_DSN ?? "mysql:host=127.0.0.1;port=3360;dbname=club_calendar_e2e",
      DB_USER: process.env.E2E_DB_USER ?? "root",
      DB_PASSWORD: process.env.E2E_DB_PASSWORD ?? "root",
      EMAIL: email,
    },
  });
  expect(run.status, run.stderr?.toString()).toBe(0);
  return email;
}

/** Signs in through the German login form. */
export async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("E-Mail").fill(email);
  await page.getByLabel("Passwort", { exact: true }).fill(PASSWORD);
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
