import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
import { createHash, randomBytes } from "node:crypto";
import { API, continueWithEmail, createVerifiedUser, loginPassword, PASSWORD } from "./helpers";

// MCP / OAuth: consent page and "Verbundene Apps". Needs the e2e backend started with an empty
// MCP_ALLOWED_CLIENTS=* (any https/loopback redirect URI; see docs/ops/E2E.md).

const REDIRECT = "http://127.0.0.1/callback";

test.use({ locale: "de-DE", timezoneId: "Europe/Berlin" });

async function registerClient(request: APIRequestContext, name: string) {
  const res = await request.post(`${API}/api/oauth/register`, {
    data: { client_name: name, redirect_uris: [REDIRECT], token_endpoint_auth_method: "none" },
  });
  expect(res.status()).toBe(201);
  return (await res.json()).client_id as string;
}

function authorizeUrl(clientId: string, state: string, scope = "mcp:read mcp:write") {
  const challenge = createHash("sha256").update(randomBytes(32)).digest("base64url");
  const q = new URLSearchParams({
    client_id: clientId,
    redirect_uri: REDIRECT,
    response_type: "code",
    code_challenge: challenge,
    code_challenge_method: "S256",
    scope,
    state,
  });
  return `${API}/api/oauth/authorize?${q}`;
}

/** The browser would leave for the (non-existent) loopback client: capture the redirect instead. */
async function captureCallback(page: Page) {
  const seen: URL[] = [];
  await page.route(`${REDIRECT}**`, async (route) => {
    seen.push(new URL(route.request().url()));
    await route.fulfill({ status: 200, contentType: "text/html", body: "callback" });
  });
  return seen;
}

async function signIn(page: Page, email: string) {
  await continueWithEmail(page, email);
  await loginPassword(page).fill(PASSWORD);
  await page.getByRole("button", { name: "Anmelden", exact: true }).click();
}

test("Anmeldung, Zustimmung, Weiterleitung mit Code, Trennen im Profil", async ({
  page,
  request,
}) => {
  const email = await createVerifiedUser(request, "MCP Nutzer");
  const clientId = await registerClient(request, "E2E Assistent");
  const seen = await captureCallback(page);

  // Signed out: the consent page sends to the login and back after it.
  await page.goto(authorizeUrl(clientId, "st-allow"));
  await expect(page).toHaveURL(/\/login/);
  await signIn(page, email);

  await expect(page.getByRole("heading", { level: 1, name: "App verbinden?" })).toBeVisible();
  // A self-declared name is only a claim; the identity is the redirect host plus the unverified notice.
  await expect(page.getByText("Unbekannte App", { exact: true })).toBeVisible();
  await expect(page.getByText(/Nennt sich „E2E Assistent“/)).toBeVisible();
  await expect(page.getByText("127.0.0.1", { exact: true })).toBeVisible();
  await expect(page.getByText("Nicht verifizierte App")).toBeVisible();
  await expect(page.getByText(/Terminentwürfe/)).toBeVisible();

  await page.getByRole("button", { name: "Erlauben" }).click();
  await expect.poll(() => seen.length).toBeGreaterThan(0);
  expect(seen[0].searchParams.get("state")).toBe("st-allow");
  expect(seen[0].searchParams.get("code")).toBeTruthy();

  await page.goto("/profile");
  const apps = page.getByRole("region", { name: "Verbundene Apps" });
  await expect(apps.getByText("Unbekannte App (127.0.0.1)")).toBeVisible();
  await expect(apps.getByText(/Nennt sich „E2E Assistent“/)).toBeVisible();
  await expect(apps.getByText("Noch nie genutzt")).toBeVisible();

  await apps.getByRole("button", { name: "Unbekannte App (127.0.0.1) trennen" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Trennen" }).click();
  await expect(apps.getByText("Keine verbundenen Apps")).toBeVisible();
});

test("Ablehnen leitet mit access_denied zurück, die Anfrage ist danach verbraucht", async ({
  page,
  request,
}) => {
  const email = await createVerifiedUser(request, "MCP Ablehner");
  const clientId = await registerClient(request, "E2E Ablehnung");
  const seen = await captureCallback(page);

  await page.goto("/login");
  await signIn(page, email);
  await expect(page).toHaveURL(/\/clubs|\/setup/);

  await page.goto(authorizeUrl(clientId, "st-deny", "mcp:read"));
  await expect(page.getByText(/Terminentwürfe/)).toHaveCount(0);
  const consentUrl = page.url();
  await page.getByRole("button", { name: "Ablehnen" }).click();
  await expect.poll(() => seen.length).toBeGreaterThan(0);
  expect(seen[0].searchParams.get("error")).toBe("access_denied");
  expect(seen[0].searchParams.get("state")).toBe("st-deny");

  await page.goto(consentUrl);
  await expect(page.getByRole("heading", { level: 1, name: "Anfrage abgelaufen" })).toBeVisible();
});
