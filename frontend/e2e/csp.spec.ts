import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { API, createVerifiedUser, login, resourceUrl, seedClub } from "./helpers";

// Regression guard for the Content-Security-Policy (see CLAUDE.md "Deployment"). Needs a PRODUCTION build
// served at PLAYWRIGHT_BASE_URL (the dev server injects inline styles by design). The policy under test is read
// from docker/Caddyfile and set on every document response; the build's API origin is appended to
// `connect-src` and `img-src` (static map images) when the API is not same-origin, as a split deployment must. Any `securitypolicyviolation` fails the test.
//
//   (cd frontend && VITE_API_URL=http://localhost:3001 npx vite build --outDir /tmp/e2e-dist && \
//    npx vite preview --outDir /tmp/e2e-dist --port 5199 --strictPort)
//   E2E_CSP=1 PLAYWRIGHT_BASE_URL=http://localhost:5199 npm run e2e -w frontend -- csp
test.skip(!process.env.E2E_CSP, "set E2E_CSP=1 with a production build at PLAYWRIGHT_BASE_URL");

test.setTimeout(180_000);
// A document rewritten by route.fulfill loses its address space: Chrome would then block the calls to the
// loopback API as "local network" requests (unrelated to the CSP under test).
test.use({
  locale: "de-DE",
  timezoneId: "Europe/Berlin",
  launchOptions: { args: ["--disable-features=LocalNetworkAccessChecks"] },
});

function policy(): string {
  const caddy = readFileSync(
    fileURLToPath(new URL("../../docker/Caddyfile", import.meta.url)),
    "utf8",
  );
  const csp = /Content-Security-Policy "([^"]+)"/.exec(caddy)?.[1];
  if (!csp) throw new Error("Content-Security-Policy not found in docker/Caddyfile");
  const apiOrigin = new URL(API).origin;
  return csp
    .replace(/connect-src ([^;]*)/, `connect-src $1 ${apiOrigin}`)
    .replace(/img-src ([^;]*)/, `img-src $1 ${apiOrigin}`);
}

async function enforce(page: Page) {
  const csp = policy();
  const violations: string[] = [];
  await page.context().route("**/*", async (route) => {
    if (route.request().resourceType() !== "document") return route.continue();
    const response = await route.fetch();
    await route.fulfill({
      response,
      headers: { ...response.headers(), "content-security-policy": csp },
    });
  });
  await page.exposeFunction("__cspReport", (text: string) => violations.push(text));
  await page.addInitScript(() => {
    document.addEventListener(
      "securitypolicyviolation",
      (e) => {
        const report = (window as unknown as { __cspReport: (t: string) => void }).__cspReport;
        report(`${e.violatedDirective} ${e.blockedURI} ${e.sample}`.slice(0, 200));
      },
      true,
    );
  });
  page.on("console", (m) => {
    if (/Content Security Policy|violates the following/i.test(m.text())) {
      violations.push(m.text().slice(0, 300));
    }
  });
  return () => [...new Set(violations)];
}

test("Seiten und Dialoge laufen unter der durchgesetzten CSP ohne Verstöße", async ({
  page,
  request,
}) => {
  const email = await createVerifiedUser(request, "CSP Nutzer");
  const { clubId, calendarId, headers } = await seedClub(request, email, "CSP Verein");
  const post = async (path: string, data: object) => {
    const res = await request.post(resourceUrl(clubId, calendarId, path), { headers, data });
    expect(res.ok(), `${path}: ${res.status()}`).toBeTruthy();
    return (await res.json()) as { id: string };
  };
  const adults = (await post("target-groups", { name: "Erwachsene" })).id;
  const place = (
    await post("locations", {
      name: "Vereinsheim",
      street: "Marktplatz 5",
      zip: "12345",
      city: "Musterstadt",
      latitude: 50.5,
      longitude: 8.25,
    })
  ).id;
  const prop = (await post("properties", { name: "Draußen", icon: "🌳" })).id;
  const date = new Date().toISOString().slice(0, 8) + "15";
  await post("events", {
    name: "Training",
    date,
    timeBegin: "19:00",
    timeEnd: "21:00",
    isDraft: false,
    timezone: "Europe/Berlin",
    locationId: place,
    propertyIds: [prop],
    targetGroupIds: [adults],
  });
  const feed = (await (
    await request.post(`${API}/api/clubs/${clubId}/feeds`, {
      headers,
      data: { name: "Öffentlich", visibility: "PUBLIC", calendarIds: [calendarId] },
    })
  ).json()) as { id: string };

  const collect = await enforce(page);
  const cal = `/clubs/${clubId}/calendars/${calendarId}`;
  const visit = async (path: string) => {
    await page.goto(path);
    await page.waitForLoadState("networkidle");
  };

  // Anonymous pages
  await visit("/login");
  await visit("/signup");
  await visit("/forgot-password");
  await visit("/privacy");
  // Every help page (callouts, tabs, screenshots, search)
  const slugs = [
    ...readFileSync(
      fileURLToPath(new URL("../src/docs/slugs.generated.ts", import.meta.url)),
      "utf8",
    ).matchAll(/^\s*"([^"]+)",?$/gm),
  ].map((m) => m[1]);
  expect(slugs.length).toBeGreaterThan(20);
  await visit("/help");
  for (const slug of slugs) {
    await page.goto(`/help/${slug.replace(/\/?index$/, "")}`);
    await page.waitForLoadState("domcontentloaded");
    await page.getByRole("heading", { level: 1 }).first().waitFor();
  }
  await visit(`/feed/${feed.id}`);
  await page.getByText("Training").first().click();
  await page.waitForLoadState("networkidle");

  // Signed in
  await login(page, email);
  await page.waitForURL(/\/clubs/);
  await visit(cal);
  await visit(`${cal}?view=week`);
  await visit(`${cal}/events/new/form`);
  await visit(cal);
  await visit(`${cal}/events`);
  await visit(`${cal}/templates`);
  await visit(`${cal}/import`);
  await visit(`${cal}/events/export`);
  await visit(`${cal}/more`);
  await visit(`${cal}/settings`);
  await visit(`/clubs/${clubId}`);
  await visit(`/clubs/${clubId}/settings/locations`);
  await visit(`/clubs/${clubId}/settings/target-groups`);
  await visit(`/clubs/${clubId}/settings/feeds`);
  await visit(`/clubs/${clubId}/settings/feeds/new`);
  await visit("/profile");

  // Emoji picker (emoji-mart, shadow DOM), toast
  await visit(`${cal}/settings/properties`);
  await page
    .getByRole("button", { name: /Weitere Symbole/ })
    .first()
    .click();
  await page.waitForTimeout(1000);
  await page.keyboard.press("Escape");

  // Toast (sonner)
  await page.getByLabel("Name").first().fill("Tracht");
  await page.getByRole("button", { name: "Besonderheit anlegen" }).click();
  await expect(page.getByText("Besonderheit „Tracht“ angelegt")).toBeVisible();

  expect(collect()).toEqual([]);
});
