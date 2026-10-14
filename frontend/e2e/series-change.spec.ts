import { test, expect } from "@playwright/test";
import { API, createVerifiedUser, login, seedClub } from "./helpers";

// ——— "Reihe ändern": new rule for an existing series; only future events change ———

/** ISO date `n` days from today (the browser and the calendar both use Europe/Berlin). */
function day(n: number): string {
  const now = new Date(new Date().toLocaleString("en-US", { timeZone: "Europe/Berlin" }));
  return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate() + n))
    .toISOString()
    .slice(0, 10);
}

const german = (iso: string) => iso.split("-").reverse().join(".");

test.describe("Terminreihe ändern", () => {
  test.use({ locale: "de-DE", timezoneId: "Europe/Berlin" });

  test("Regel verkürzen: Vorschau, Bestätigung, künftige Termine weg, vergangene bleiben", async ({
    page,
    request,
  }) => {
    const email = await createVerifiedUser(request, "Reihe Aendern");
    const { clubId, calendarId, headers } = await seedClub(request, email, "Reihe Verein");
    const base = `/clubs/${clubId}/calendars/${calendarId}`;
    // Weekly on tomorrow's weekday: 3 past events, 7 future ones
    const weekday = new Date(`${day(1)}T12:00:00Z`).getUTCDay();
    const created = await request.post(`${API}/api/calendars/${calendarId}/events/series`, {
      headers,
      data: {
        rule: { frequency: "weekly", weekday, startDate: day(-21), until: day(43) },
        event: { name: "Serientraining", timeBegin: "19:00", timeEnd: "21:00" },
        isDraft: false,
      },
    });
    expect(created.status()).toBe(201);
    const { events } = (await created.json()) as { events: { id: string; date: string }[] };
    expect(events).toHaveLength(10);
    const next = events.find((e) => e.date === day(1))!;

    await login(page, email);
    await page.waitForURL(/\/clubs/);
    await page.goto(`${base}/events/${next.id}`);
    await expect(page.getByText("Teil einer Terminreihe (10 Termine)")).toBeVisible();
    await page.getByRole("link", { name: "Reihe ändern" }).click();

    const dialog = page.getByRole("dialog", { name: "Terminreihe ändern" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel("Wochentag")).toBeFocused();
    await expect(dialog.getByText("Die Regel ist unverändert.", { exact: false })).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Reihe ändern" })).toBeDisabled();

    await dialog.getByLabel("Bis (Pflicht)").fill(day(15));
    const status = dialog
      .getByRole("status")
      .filter({ hasText: "künftige Termine werden gelöscht" });
    await expect(status).toContainText("4 künftige Termine werden gelöscht.");
    await expect(status).toContainText("3 künftige Termine bleiben unverändert.");
    await expect(status).toContainText("3 vergangene Termine bleiben, wie sie sind.");
    const deletions = dialog.getByRole("list", { name: "Diese 4 Termine werden gelöscht" });
    await expect(deletions.getByRole("listitem")).toHaveCount(4);
    await expect(deletions).toContainText(german(day(43)));

    // Keyboard: the confirmation starts on "Abbrechen", Escape keeps everything
    await dialog.getByRole("button", { name: "Reihe ändern" }).click();
    const confirm = page.getByRole("alertdialog");
    await expect(confirm).toContainText(
      "Löscht 4 künftige Termine, legt keine neuen an. Vergangene Termine bleiben.",
    );
    await expect(confirm.getByRole("button", { name: "Abbrechen" })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(confirm).toBeHidden();
    await expect(dialog).toBeVisible();

    await dialog.getByRole("button", { name: "Reihe ändern" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Reihe ändern" }).click();
    await expect(page.getByText("Terminreihe geändert: 0 angelegt, 4 gelöscht.")).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(0);

    const left = (await (
      await request.get(`${API}/api/calendars/${calendarId}/events`, { headers })
    ).json()) as { date: string }[];
    expect(left.map((e) => e.date)).toEqual([day(-20), day(-13), day(-6), day(1), day(8), day(15)]);
  });
});
