import { test, expect, type APIRequestContext } from "@playwright/test";
import { API, createVerifiedUser, login, seedClub } from "./helpers";

// The backend rejects unknown ids (422) since it checks that assignments belong to the calendar.
// A form that was loaded before a property / target group / location was deleted elsewhere must
// still save: deleted assignments are dropped instead of failing the whole save.

test.use({ locale: "de-DE", timezoneId: "Europe/Berlin" });

async function post<T>(request: APIRequestContext, url: string, headers: object, data: object) {
  const res = await request.post(`${API}${url}`, {
    headers: headers as Record<string, string>,
    data,
  });
  expect(res.ok(), await res.text()).toBeTruthy();
  return (await res.json()) as T;
}

async function seed(request: APIRequestContext, label: string) {
  const email = await createVerifiedUser(request, label);
  const { clubId, calendarId, headers } = await seedClub(request, email, `${label} Verein`);
  const base = `/api/calendars/${calendarId}`;
  const [keep, gone] = [
    await post<{ id: string }>(request, `${base}/properties`, headers, { name: "Bleibt" }),
    await post<{ id: string }>(request, `${base}/properties`, headers, { name: "Wird gelöscht" }),
  ];
  const group = await post<{ id: string }>(request, `${base}/target-groups`, headers, {
    name: "Jugend",
  });
  const location = await post<{ id: string }>(request, `${base}/locations`, headers, {
    name: "Halle",
  });
  const del = async () => {
    for (const path of [
      `properties/${gone.id}`,
      `target-groups/${group.id}`,
      `locations/${location.id}`,
    ]) {
      const res = await request.delete(`${API}${base}/${path}`, { headers });
      expect(res.ok()).toBeTruthy();
    }
  };
  return { email, clubId, calendarId, headers, base, keep, gone, group, location, del };
}

test("Termin speichern, nachdem zugeordnete Daten anderswo gelöscht wurden", async ({
  page,
  request,
}) => {
  const s = await seed(request, "Veraltet Termin");
  const event = await post<{ id: string }>(request, `${s.base}/events`, s.headers, {
    name: "Training",
    date: "2026-10-01",
    timeBegin: "19:00",
    timeEnd: "21:00",
    locationId: s.location.id,
    propertyIds: [s.keep.id, s.gone.id],
    targetGroupIds: [s.group.id],
  });
  await login(page, s.email);
  await page.waitForURL(/\/clubs/);
  // Let the sign-in redirects settle before opening the page directly
  await page.waitForLoadState("networkidle");
  await page.goto(`/clubs/${s.clubId}/calendars/${s.calendarId}/events/${event.id}`);
  await expect(page.getByLabel("Name (Pflicht)")).toHaveValue("Training", { timeout: 15_000 });

  await s.del(); // e.g. in another tab or by another member

  await page.getByLabel("Name (Pflicht)").fill("Training neu");
  await page.getByRole("button", { name: "Termin speichern" }).click();
  await expect(page.getByText("Termin gespeichert.")).toBeVisible();

  const saved = await (
    await request.get(`${API}${s.base}/events/${event.id}`, { headers: s.headers })
  ).json();
  expect(saved.name).toBe("Training neu");
  expect(saved.properties.map((p: { property: { id: string } }) => p.property.id)).toEqual([
    s.keep.id,
  ]);
  expect(saved.targetGroups).toEqual([]);
  expect(saved.locationId).toBeNull();
});

test("Vorlage speichern, nachdem zugeordnete Daten anderswo gelöscht wurden", async ({
  page,
  request,
}) => {
  const s = await seed(request, "Veraltet Vorlage");
  const tpl = await post<{ id: string }>(request, `${s.base}/templates`, s.headers, {
    name: "Übungsabend",
    timezone: "Europe/Berlin",
    timeBegin: "19:00",
    timeEnd: "21:00",
    locationId: s.location.id,
    propertyIds: [s.keep.id, s.gone.id],
    targetGroupIds: [s.group.id],
  });
  await login(page, s.email);
  await page.waitForURL(/\/clubs/);
  // Let the sign-in redirects settle before opening the page directly
  await page.waitForLoadState("networkidle");
  await page.goto(`/clubs/${s.clubId}/calendars/${s.calendarId}/templates/${tpl.id}`);
  await expect(page.getByLabel("Name (Pflicht)")).toHaveValue("Übungsabend", { timeout: 15_000 });

  await s.del();

  await page.getByLabel("Name (Pflicht)").fill("Übungsabend neu");
  await page.getByRole("button", { name: "Vorlage speichern" }).click();
  await expect(page.getByText("Vorlage gespeichert.")).toBeVisible();

  const list = await (
    await request.get(`${API}${s.base}/templates`, { headers: s.headers })
  ).json();
  const saved = list.find((x: { id: string }) => x.id === tpl.id);
  expect(saved.name).toBe("Übungsabend neu");
  expect(saved.properties.map((p: { property: { id: string } }) => p.property.id)).toEqual([
    s.keep.id,
  ]);
  expect(saved.targetGroups).toEqual([]);
});

test("Feed speichern, nachdem eine Gruppe anderswo gelöscht wurde", async ({ page, request }) => {
  const s = await seed(request, "Veraltet Feed");
  const other = await post<{ id: string }>(request, `${s.base}/target-groups`, s.headers, {
    name: "Senioren",
  });
  const feed = await post<{ id: string }>(request, `${s.base}/feeds`, s.headers, {
    name: "Jugendfeed",
    visibility: "PUBLIC",
    targetGroupIds: [s.group.id, other.id],
  });
  await login(page, s.email);
  await page.waitForURL(/\/clubs/);
  // Let the sign-in redirects settle before opening the page directly
  await page.waitForLoadState("networkidle");
  await page.goto(`/clubs/${s.clubId}/calendars/${s.calendarId}/settings/feeds/${feed.id}`);
  await expect(page.getByLabel(/^Name/)).toHaveValue("Jugendfeed", { timeout: 15_000 });

  await s.del();

  await page.getByLabel(/^Name/).fill("Jugendfeed neu");
  await page.getByRole("button", { name: "Feed speichern" }).click();
  await expect(page.getByText("Feed „Jugendfeed neu“ gespeichert.")).toBeVisible();

  const list = await (await request.get(`${API}${s.base}/feeds`, { headers: s.headers })).json();
  const saved = list.find((x: { id: string }) => x.id === feed.id);
  expect(saved.targetGroups.map((g: { targetGroupId: string }) => g.targetGroupId)).toEqual([
    other.id,
  ]);
});
