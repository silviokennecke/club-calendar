import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import CalendarSettingsPage from "../CalendarSettingsPage";
import { BASE, PATTERN, renderRoute } from "../../events/__tests__/testUtils";
import { mockApiGet } from "@/test/clubRole";

const apiGet = vi.fn();
const apiPost = vi.fn();
const apiPatch = vi.fn();
const apiDelete = vi.fn();

vi.mock("@/lib/api", () => ({
  apiGet: (...a: unknown[]) => apiGet(...a),
  apiPost: (...a: unknown[]) => apiPost(...a),
  apiPatch: (...a: unknown[]) => apiPatch(...a),
  apiDelete: (...a: unknown[]) => apiDelete(...a),
}));

let calendar: Record<string, unknown>;

const route = `${PATTERN}/settings`;
const url = `${BASE}/settings`;
const calPath = "/api/clubs/c1/calendars/k1";

beforeEach(() => {
  calendar = { id: "k1", clubId: "c1", name: "Schießbetrieb 2026", timezone: null };
  for (const fn of [apiGet, apiPost, apiPatch, apiDelete]) fn.mockReset();
  mockApiGet(apiGet, (path: string) => {
    if (path === calPath) return Promise.resolve(calendar);
    if (path.endsWith("/events")) return Promise.resolve([{}, {}, {}]);
    if (path.endsWith("/templates")) return Promise.resolve([{}]);
    if (path.endsWith("/feeds")) return Promise.resolve([{}, {}]);
    return Promise.resolve([]);
  });
  apiPatch.mockImplementation((_p: string, body: object) =>
    Promise.resolve({ ...calendar, ...body }),
  );
  apiPost.mockResolvedValue({ id: "k2", name: "Copy of Schießbetrieb 2026" });
  apiDelete.mockResolvedValue(undefined);
});

describe("CalendarSettingsPage", () => {
  it("shows name and time zone and the tabs of the settings", async () => {
    renderRoute(route, url, <CalendarSettingsPage />);
    expect(
      await screen.findByRole("heading", { level: 1, name: "Einstellungen" }),
    ).toBeInTheDocument();
    expect(await screen.findByLabelText(/^Kalendername/)).toHaveValue("Schießbetrieb 2026");
    const tabs = screen.getByRole("navigation", { name: "Einstellungen des Kalenders" });
    expect(within(tabs).getAllByRole("link")).toHaveLength(4);
    expect(within(tabs).queryByRole("link", { name: "Orte" })).not.toBeInTheDocument();
    expect(within(tabs).queryByRole("link", { name: "Gruppen" })).not.toBeInTheDocument();
    expect(within(tabs).getByRole("link", { name: "Allgemein" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("switch", { name: "Zeitzone des Vereins verwenden" })).toBeChecked();
    expect(screen.queryByLabelText("Zeitzone dieses Kalenders")).not.toBeInTheDocument();
  });

  it("validates the name, then saves name and an own time zone", async () => {
    const user = userEvent.setup();
    renderRoute(route, url, <CalendarSettingsPage />);
    const name = await screen.findByLabelText(/^Kalendername/);
    await user.clear(name);
    await user.click(screen.getByRole("switch"));
    await user.click(screen.getByRole("button", { name: "Einstellungen speichern" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Bitte einen Kalendernamen eingeben.");
    expect(apiPatch).not.toHaveBeenCalled();

    await user.type(name, "Winterprogramm");
    await user.selectOptions(screen.getByLabelText("Zeitzone dieses Kalenders"), "Europe/London");
    expect(
      screen.getByText(/Aktuelle Uhrzeit in Europe\/London: \d\d:\d\d Uhr/),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Einstellungen speichern" }));
    await waitFor(() =>
      expect(apiPatch).toHaveBeenCalledWith(calPath, {
        name: "Winterprogramm",
        timezone: "Europe/London",
      }),
    );
  });

  it("sends no time zone when the club's zone is used", async () => {
    calendar = { ...calendar, timezone: "Europe/Vienna" };
    const user = userEvent.setup();
    renderRoute(route, url, <CalendarSettingsPage />);
    await screen.findByLabelText(/^Kalendername/);
    expect(screen.getByLabelText("Zeitzone dieses Kalenders")).toHaveValue("Europe/Vienna");
    await user.click(screen.getByRole("switch", { name: "Zeitzone des Vereins verwenden" }));
    await user.click(screen.getByRole("button", { name: "Einstellungen speichern" }));
    await waitFor(() =>
      expect(apiPatch).toHaveBeenCalledWith(calPath, {
        name: "Schießbetrieb 2026",
        timezone: null,
      }),
    );
  });

  it("shows an error when saving fails and keeps the input", async () => {
    apiPatch.mockRejectedValue(new Error("x"));
    const user = userEvent.setup();
    renderRoute(route, url, <CalendarSettingsPage />);
    const name = await screen.findByLabelText(/^Kalendername/);
    await user.type(name, " neu");
    await user.click(screen.getByRole("button", { name: "Einstellungen speichern" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Die Einstellungen konnten nicht gespeichert werden.",
    );
    expect(name).toHaveValue("Schießbetrieb 2026 neu");
  });

  it("no longer manages the calendar here but points to the club page", async () => {
    renderRoute(route, url, <CalendarSettingsPage />);
    await screen.findByLabelText(/^Kalendername/);
    for (const name of ["Kalender archivieren", "Kalender duplizieren", "Kalender löschen"]) {
      expect(screen.queryByRole("button", { name })).not.toBeInTheDocument();
    }
    const link = screen.getByRole("link", { name: "Verein verwalten" });
    expect(link).toHaveAttribute("href", "/clubs/c1");
  });

  it("is read-only in an archived calendar and offers to restore it in the banner", async () => {
    calendar = { ...calendar, archivedAt: "2026-01-01T00:00:00+00:00" };
    const user = userEvent.setup();
    renderRoute(route, url, <CalendarSettingsPage />);
    const name = await screen.findByLabelText(/^Kalendername/);
    expect(name).toHaveAttribute("readonly");
    expect(screen.getByRole("switch", { name: "Zeitzone des Vereins verwenden" })).toBeDisabled();
    expect(
      screen.queryByRole("button", { name: "Einstellungen speichern" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("Archiviert, schreibgeschützt")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Archivierung aufheben" }));
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith(`${calPath}/unarchive`, {}));
  });
});
