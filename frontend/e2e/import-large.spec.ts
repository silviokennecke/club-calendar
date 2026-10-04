import { test, expect, type Page } from "@playwright/test";
import { createVerifiedUser, login, seedClub } from "./helpers";

// ——— Import review with very many events (5000): the page must stay responsive ———

const GROUPS = 50;
const PER_GROUP = 100;

function bigIcs(groups = GROUPS, perGroup = PER_GROUP) {
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//e2e//DE"];
  for (let g = 0; g < groups; g += 1) {
    for (let i = 0; i < perGroup; i += 1) {
      const d = new Date(Date.UTC(2027, 0, 1 + i));
      const day = d.toISOString().slice(0, 10).replace(/-/g, "");
      lines.push(
        "BEGIN:VEVENT",
        `UID:g${g}-${i}@e2e`,
        `SUMMARY:Gruppe ${String(g + 1).padStart(2, "0")}`,
        `DTSTART:${day}T190000`,
        `DTEND:${day}T210000`,
        "END:VEVENT",
      );
    }
  }
  lines.push("END:VCALENDAR");
  return lines.join("\r\n");
}

/** Time until the next frame after `action`, i.e. how long the main thread was busy. */
async function measure(page: Page, action: () => Promise<unknown>) {
  const start = Date.now();
  await action();
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r(null))));
  return Date.now() - start;
}

test.use({ locale: "de-DE", timezoneId: "Europe/Berlin" });

test("Import-Prüfung mit 5000 Terminen bleibt flüssig", async ({ page, request }) => {
  test.setTimeout(120_000);
  const email = await createVerifiedUser(request, "Gross Import");
  const { clubId, calendarId } = await seedClub(request, email, "Gross Import Verein");
  await login(page, email);
  await page.waitForURL(/\/clubs/);
  await page.goto(`/clubs/${clubId}/calendars/${calendarId}/import`);

  await page.addInitScript(() => undefined);
  await page.evaluate(() => {
    const w = window as unknown as { __long: number[] };
    w.__long = [];
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) w.__long.push(e.duration);
    }).observe({ entryTypes: ["longtask"] });
  });

  const upload = await measure(page, async () => {
    await page.locator("#ics-file").setInputFiles({
      name: "gross.ics",
      mimeType: "text/calendar",
      buffer: Buffer.from(bigIcs()),
    });
    await expect(page.getByRole("status").filter({ hasText: "5000 Termine erkannt" })).toBeVisible({
      timeout: 60_000,
    });
  });
  const render = await measure(page, async () => {
    await page.getByRole("button", { name: /Datei prüfen/ }).click();
    await expect(page.getByRole("heading", { level: 1, name: /5000 Termine erkannt/ })).toBeVisible(
      {
        timeout: 60_000,
      },
    );
  });

  // Toggle one event of the first (open) group
  const firstGroupBox = page.getByRole("checkbox", { name: /auswählen$/ }).first();
  const toggle = await measure(page, () => firstGroupBox.click());
  await expect(page.getByRole("status").filter({ hasText: "ausgewählt" })).toHaveText(
    "4999 von 5000 ausgewählt",
  );

  // Open another group
  const expand = await measure(page, async () => {
    await page.getByRole("button", { name: "Gruppe 02: Termine anzeigen" }).click();
    await expect(page.getByRole("table", { name: "Termine der Gruppe Gruppe 02" })).toBeVisible();
  });

  // Select / deselect a whole group
  const groupToggle = await measure(page, () =>
    page.getByRole("checkbox", { name: /^Gruppe 03/ }).click(),
  );
  const long = await page.evaluate(() => (window as unknown as { __long: number[] }).__long);
  const maxLong = Math.max(0, ...long);
  console.log(
    `MEASURE upload=${upload}ms render=${render}ms toggle=${toggle}ms expand=${expand}ms groupToggle=${groupToggle}ms maxLongTask=${Math.round(maxLong)}ms`,
  );
  expect(toggle).toBeLessThan(200);
  expect(expand).toBeLessThan(200);
  expect(groupToggle).toBeLessThan(200);
  expect(maxLong).toBeLessThan(500);
});

test("Import-Prüfung: eine Gruppe mit 5000 Terminen (ungünstigster Fall)", async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  const email = await createVerifiedUser(request, "Eine Gruppe");
  const { clubId, calendarId } = await seedClub(request, email, "Eine Gruppe Verein");
  await login(page, email);
  await page.waitForURL(/\/clubs/);
  await page.goto(`/clubs/${clubId}/calendars/${calendarId}/import`);
  await page.evaluate(() => {
    const w = window as unknown as { __long: number[] };
    w.__long = [];
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) w.__long.push(e.duration);
    }).observe({ entryTypes: ["longtask"] });
  });
  await page.locator("#ics-file").setInputFiles({
    name: "eine.ics",
    mimeType: "text/calendar",
    buffer: Buffer.from(bigIcs(1, 5000)),
  });
  await expect(page.getByRole("status").filter({ hasText: "5000 Termine erkannt" })).toBeVisible({
    timeout: 60_000,
  });
  const render = await measure(page, async () => {
    await page.getByRole("button", { name: /Datei prüfen/ }).click();
    await expect(page.getByRole("table", { name: "Termine der Gruppe Gruppe 01" })).toBeVisible({
      timeout: 60_000,
    });
  });
  const one = page.getByRole("checkbox", { name: /auswählen$/ }).first();
  const toggle = await measure(page, () => one.click());
  const none = await measure(page, () =>
    page.getByRole("button", { name: "Auswahl aufheben" }).click(),
  );
  const all = await measure(page, () =>
    page.getByRole("button", { name: "Alle auswählen" }).click(),
  );
  const collapse = await measure(page, () =>
    page.getByRole("button", { name: "Gruppe 01: Termine ausblenden" }).click(),
  );
  const expand = await measure(page, () =>
    page.getByRole("button", { name: "Gruppe 01: Termine anzeigen" }).click(),
  );
  const long = await page.evaluate(() => (window as unknown as { __long: number[] }).__long);
  const maxLong = Math.max(0, ...long);
  console.log(
    `MEASURE-ONE render=${render}ms toggle=${toggle}ms none=${none}ms all=${all}ms collapse=${collapse}ms expand=${expand}ms maxLongTask=${Math.round(maxLong)}ms`,
  );
  for (const ms of [toggle, none, all, collapse, expand]) expect(ms).toBeLessThan(200);
  expect(maxLong).toBeLessThan(500);
});
