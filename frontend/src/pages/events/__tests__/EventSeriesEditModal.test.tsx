import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient } from "@tanstack/react-query";
import { ApiError } from "@/lib/api";
import EventSeriesEditModal from "../EventSeriesEditModal";
import EventFormModal from "../EventFormModal";
import { BASE, PATTERN, groups, makeEvent, renderRoute } from "./testUtils";

const apiGet = vi.fn();
const apiPost = vi.fn();
const apiPatch = vi.fn();

vi.mock("@/lib/api", async (orig) => ({
  ...(await orig<typeof import("@/lib/api")>()),
  apiGet: (...a: unknown[]) => apiGet(...a),
  apiPost: (...a: unknown[]) => apiPost(...a),
  apiPatch: (...a: unknown[]) => apiPatch(...a),
  apiDelete: vi.fn(),
}));
vi.mock("@/components/events/EventLocationMap", () => ({
  default: ({ label }: { label: string }) => <div role="region" aria-label={label} />,
}));

const rule = {
  frequency: "weekly" as const,
  weekday: 4,
  nth: null,
  startDate: "2026-10-01",
  until: "2026-11-26",
  count: null,
  skipHolidays: false,
};
const seriesEvent = makeEvent({
  id: "s2",
  name: "Training",
  date: "2026-10-22",
  seriesId: "ser1",
  series: { id: "ser1", templateId: null, eventCount: 9, rule },
});
const preview = {
  toCreate: [{ date: "2026-12-03" }],
  toDelete: [
    { id: "x1", date: "2026-11-19", name: "Training", isDraft: false },
    { id: "x2", date: "2026-11-26", name: "Sondertraining", isDraft: true },
  ],
  kept: 4,
  past: 3,
  skippedHolidays: [],
};

let calendar: Record<string, unknown>;

beforeEach(() => {
  calendar = { id: "k1", clubId: "c1", name: "Schießbetrieb 2026" };
  for (const fn of [apiGet, apiPost, apiPatch]) fn.mockReset();
  apiGet.mockImplementation((path: string) => {
    if (path === "/api/clubs/c1/calendars/k1") return Promise.resolve(calendar);
    if (path === "/api/calendars/k1/events/s2") return Promise.resolve(seriesEvent);
    if (path.endsWith("/target-groups")) return Promise.resolve(groups);
    return Promise.resolve([]);
  });
  apiPost.mockResolvedValue(preview);
  apiPatch.mockResolvedValue({
    series: { ...seriesEvent.series },
    created: 1,
    deleted: 2,
    kept: 4,
  });
});

const seriesRoute = `${PATTERN}/events/:eventId/series`;
const url = `${BASE}/events/s2/series`;

function renderSeries(state?: unknown) {
  return renderRoute(seriesRoute, url, <EventSeriesEditModal />, state);
}

async function changeEnd(user: ReturnType<typeof userEvent.setup>, value: string) {
  const to = await screen.findByLabelText(/^Bis/);
  await user.clear(to);
  await user.type(to, value);
}

/** Waits for the debounced preview, then opens the confirmation. */
async function submit(user: ReturnType<typeof userEvent.setup>) {
  const button = screen.getByRole("button", { name: "Reihe ändern" });
  await waitFor(() => expect(button).toBeEnabled(), { timeout: 3000 });
  await user.click(button);
  return screen.findByRole("alertdialog");
}

describe("EventFormModal – series action", () => {
  it("offers 'Reihe ändern' next to the series notice", async () => {
    const user = userEvent.setup();
    renderRoute(`${PATTERN}/events/:eventId`, `${BASE}/events/s2`, <EventFormModal />);
    const link = await screen.findByRole("link", { name: "Reihe ändern" });
    await user.click(link);
    expect(await screen.findByTestId("location")).toHaveTextContent(`${BASE}/events/s2/series`);
  });

  it("hides the action in an archived calendar", async () => {
    calendar = { ...calendar, archivedAt: "2026-01-01T00:00:00Z" };
    renderRoute(`${PATTERN}/events/:eventId`, `${BASE}/events/s2`, <EventFormModal />);
    expect(await screen.findByText("Teil einer Terminreihe (9 Termine)")).toBeVisible();
    expect(screen.queryByRole("link", { name: "Reihe ändern" })).toBeNull();
  });
});

describe("EventSeriesEditModal", () => {
  it("starts with the stored rule and nothing to change", async () => {
    renderSeries();
    expect(await screen.findByText("Bisherige Regel")).toBeVisible();
    const dialog = screen.getByRole("dialog", { name: "Terminreihe ändern" });
    expect(dialog).toHaveTextContent(/Wöchentlich am Donnerstag/);
    expect(dialog).toHaveTextContent("Vergangene Termine bleiben, wie sie sind.");
    expect(await screen.findByLabelText(/^Bis/)).toHaveValue("2026-11-26");
    expect(screen.getByLabelText(/^Von/)).toHaveValue("2026-10-01");
    expect(screen.getByLabelText("Wochentag")).toHaveValue("4");
    expect(screen.getByText(/Die Regel ist unverändert/)).toBeVisible();
    expect(screen.getByRole("button", { name: "Reihe ändern" })).toBeDisabled();
    // The weekday is the first field
    await waitFor(() => expect(screen.getByLabelText("Wochentag")).toHaveFocus());
    expect(apiPost).not.toHaveBeenCalled();
  });

  it("previews the change, confirms the consequences and applies it", async () => {
    const invalidate = vi.spyOn(QueryClient.prototype, "invalidateQueries");
    const user = userEvent.setup();
    renderSeries({ background: BASE });
    await changeEnd(user, "2026-12-03");

    await waitFor(() =>
      expect(apiPost).toHaveBeenCalledWith("/api/calendars/k1/event-series/ser1/preview-update", {
        rule: { ...rule, until: "2026-12-03" },
      }),
    );
    expect(
      await screen.findByText(
        "1 Termin kommt neu dazu. 2 künftige Termine werden gelöscht. 4 künftige Termine bleiben unverändert. 3 vergangene Termine bleiben, wie sie sind.",
      ),
    ).toHaveAttribute("role", "status");
    const deletions = screen.getByRole("list", { name: "Diese 2 Termine werden gelöscht" });
    expect(within(deletions).getAllByRole("listitem")).toHaveLength(2);
    expect(deletions).toHaveTextContent("Sondertraining");
    expect(deletions).toHaveTextContent("Entwurf");
    expect(screen.getByRole("list", { name: "Dieser Termin kommt neu dazu" })).toHaveTextContent(
      "03.12.2026",
    );

    await user.click(screen.getByRole("button", { name: "Reihe ändern" }));
    const confirm = await screen.findByRole("alertdialog");
    expect(confirm).toHaveTextContent("Terminreihe ändern?");
    expect(confirm).toHaveTextContent(
      "Löscht 2 künftige Termine, legt 1 neuen an. Vergangene Termine bleiben.",
    );
    expect(confirm).toHaveTextContent("Das lässt sich nicht rückgängig machen.");
    await waitFor(() =>
      expect(within(confirm).getByRole("button", { name: "Abbrechen" })).toHaveFocus(),
    );
    expect(apiPatch).not.toHaveBeenCalled();

    await user.click(within(confirm).getByRole("button", { name: "Reihe ändern" }));
    await waitFor(() =>
      expect(apiPatch).toHaveBeenCalledWith("/api/calendars/k1/event-series/ser1", {
        rule: { ...rule, until: "2026-12-03" },
      }),
    );
    expect(await screen.findByTestId("location")).toHaveTextContent(BASE);
    // Calendar and list below the dialog are refreshed (all event queries of the calendar)
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["events", "k1"] });
    invalidate.mockRestore();
  });

  it("keeps the dialog and explains a conflict", async () => {
    const user = userEvent.setup();
    apiPatch.mockRejectedValue(new ApiError("changed", 409, "series_changed"));
    renderSeries();
    await changeEnd(user, "2026-12-03");
    await user.click(within(await submit(user)).getByRole("button", { name: "Reihe ändern" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Die Reihe wurde inzwischen geändert.",
    );
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    // The preview is loaded again
    await waitFor(() => expect(apiPost.mock.calls.length).toBeGreaterThan(1));
    expect(screen.getByRole("dialog", { name: "Terminreihe ändern" })).toBeVisible();
  });

  it("names a forbidden change and a network error", async () => {
    const user = userEvent.setup();
    apiPatch.mockRejectedValueOnce(new ApiError("Forbidden", 403));
    apiPatch.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    renderSeries();
    await changeEnd(user, "2026-12-03");
    for (const text of ["Du darfst diese Reihe nicht ändern", "Es wurde nichts geändert. Bitte"]) {
      await user.click(within(await submit(user)).getByRole("button", { name: "Reihe ändern" }));
      expect(await screen.findByRole("alert")).toHaveTextContent(text);
    }
  });

  it("blocks the change above the limit and when no event would be left", async () => {
    const user = userEvent.setup();
    apiPost.mockRejectedValueOnce(new ApiError("too many", 422, "too_many_events"));
    renderSeries();
    await changeEnd(user, "2035-01-01");
    expect(
      await screen.findByText(/Eine Serie hat höchstens 366 Termine/, {}, { timeout: 3000 }),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "Reihe ändern" })).toBeDisabled();

    apiPost.mockRejectedValueOnce(new ApiError("no events", 422, "validation_failed"));
    await changeEnd(user, "2026-10-08");
    expect(
      await screen.findByText(/bliebe kein Termin in der Reihe/, {}, { timeout: 3000 }),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "Reihe ändern" })).toBeDisabled();
    expect(apiPatch).not.toHaveBeenCalled();
    // Only the changed rules were previewed, never the stored one
    for (const [, body] of apiPost.mock.calls) expect(body.rule.until).not.toBe("2026-11-26");
  });

  it("is read-only in an archived calendar", async () => {
    calendar = { ...calendar, archivedAt: "2026-01-01T00:00:00Z" };
    renderSeries();
    expect(await screen.findByText(/Der Kalender ist archiviert/)).toBeVisible();
    expect(screen.queryByLabelText(/^Bis/)).toBeNull();
  });
});
