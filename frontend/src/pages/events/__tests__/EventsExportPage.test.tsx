import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Toaster } from "@/components/ui/shared";
import EventsExportPage from "../EventsExportPage";
import { BASE, PATTERN, groups, makeEvent, renderRoute } from "./testUtils";
import { mockApiGet } from "@/test/clubRole";

const apiGet = vi.fn();
const apiFetch = vi.fn();
const downloadBlob = vi.fn();

vi.mock("@/lib/api", async (orig) => ({
  ...(await orig<typeof import("@/lib/api")>()),
  apiGet: (...a: unknown[]) => apiGet(...a),
  apiFetch: (...a: unknown[]) => apiFetch(...a),
}));
vi.mock("@/lib/events/ics", async (orig) => ({
  ...(await orig<typeof import("@/lib/events/ics")>()),
  downloadBlob: (...a: unknown[]) => downloadBlob(...a),
}));

function problem(status: number, body: object, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify({ detail: "irrelevant", ...body }), { status, headers });
}

let events: ReturnType<typeof makeEvent>[];

beforeEach(() => {
  for (const fn of [apiGet, apiFetch, downloadBlob]) fn.mockReset();
  events = [makeEvent({ id: "1", name: "Training", date: new Date().toISOString().slice(0, 10) })];
  mockApiGet(apiGet, (path: string) => {
    if (path === "/api/clubs/c1/calendars/k1")
      return Promise.resolve({ id: "k1", clubId: "c1", name: "Schießbetrieb 2026" });
    if (path.endsWith("/target-groups")) return Promise.resolve(groups);
    if (path === "/api/calendars/k1/events") return Promise.resolve(events);
    return Promise.resolve([]);
  });
  apiFetch.mockImplementation(() => Promise.resolve(new Response("x")));
});

function renderExport() {
  return renderRoute(
    `${PATTERN}/events/export`,
    `${BASE}/events/export`,
    <>
      <EventsExportPage />
      <Toaster />
    </>,
  );
}

describe("EventsExportPage", () => {
  it("offers the whole calendar and no PDF options for ICS, and downloads the ICS", async () => {
    const user = userEvent.setup();
    renderExport();
    expect(screen.getByRole("radio", { name: /Ganzer Kalender/ })).toBeVisible();
    expect(screen.queryByRole("radio", { name: /^Monatsraster/ })).toBeNull();
    const button = await screen.findByRole("button", { name: "ICS-Datei laden" });
    await waitFor(() => expect(button).toBeEnabled());
    await user.click(button);
    await waitFor(() => expect(apiFetch).toHaveBeenCalled());
    expect(apiFetch).toHaveBeenCalledWith("/api/calendars/k1/events.ics", {
      headers: { Accept: "text/calendar" },
    });
    expect(downloadBlob).toHaveBeenCalledWith(expect.anything(), "schiessbetrieb-2026.ics");
  });

  it("offers the ranges in order with year hints for ICS and PDF and downloads next year", async () => {
    const user = userEvent.setup();
    const year = Number(new Date().toISOString().slice(0, 4));
    events.push(makeEvent({ id: "2", name: "Neujahr", date: `${year + 1}-03-01` }));
    renderExport();
    const labels = () =>
      Array.from(document.querySelectorAll('input[name="range"]')).map(
        (r) => r.closest("label")!.textContent ?? "",
      );
    expect(labels()).toHaveLength(5);
    expect(labels()[0]).toMatch(/^Ganzer Kalender/);
    expect(labels()[2]).toContain(`Dieses Jahr${year}`);
    expect(labels()[3]).toContain(`Nächstes Jahr${year + 1}`);
    expect(labels()[4]).toMatch(/^Von – bis/);
    await user.click(screen.getByRole("radio", { name: /Nächstes Jahr/ }));
    const button = await screen.findByRole("button", { name: "ICS-Datei laden" });
    await waitFor(() => expect(button).toBeEnabled());
    await user.click(button);
    await waitFor(() => expect(apiFetch).toHaveBeenCalled());
    expect(apiFetch.mock.calls[0][0]).toBe(
      `/api/calendars/k1/events.ics?from=${year + 1}-01-01&to=${year + 1}-12-31`,
    );

    await user.click(screen.getByRole("radio", { name: /^PDF/ }));
    expect(labels()).toHaveLength(4);
    expect(labels()[1]).toContain("Dieses Jahr");
    expect(labels()[2]).toContain(`Nächstes Jahr${year + 1}`);
    await user.click(screen.getByRole("radio", { name: /Nächstes Jahr/ }));
    expect(screen.getByRole("radio", { name: /Jahresübersicht/ })).toBeEnabled();
    const pdfButton = screen.getByRole("button", { name: "PDF-Datei laden" });
    await waitFor(() => expect(pdfButton).toBeEnabled());
    apiFetch.mockClear();
    await user.click(pdfButton);
    await waitFor(() => expect(apiFetch).toHaveBeenCalled());
    expect(apiFetch.mock.calls[0][0]).toContain(`from=${year + 1}-01-01&to=${year + 1}-12-31`);
  });

  it("switches to PDF: hides whole calendar, shows options, disables unavailable layouts", async () => {
    const user = userEvent.setup();
    renderExport();
    await user.click(screen.getByRole("radio", { name: /^PDF/ }));
    expect(screen.queryByRole("radio", { name: /Ganzer Kalender/ })).toBeNull();
    expect(screen.getByRole("radio", { name: /Dieses Jahr/ })).toBeVisible();
    expect(screen.getByRole("radio", { name: /Dieser Monat/ })).toBeChecked();
    expect(screen.getByRole("radio", { name: /^Monatsraster/ })).toBeChecked();
    expect(screen.getByRole("radio", { name: /Jahresübersicht/ })).toBeDisabled();
    expect(screen.getByRole("radio", { name: /Quartalsübersicht/ })).toBeDisabled();
    await user.click(screen.getByRole("radio", { name: /Dieses Jahr/ }));
    expect(screen.getByRole("radio", { name: /Jahresübersicht/ })).toBeEnabled();
    expect(screen.getByRole("radio", { name: /Quartalsübersicht/ })).toBeEnabled();
  });

  it("requests the PDF with layout, paper and orientation and falls back to month grid", async () => {
    const user = userEvent.setup();
    renderExport();
    await user.click(screen.getByRole("radio", { name: /^PDF/ }));
    await user.click(screen.getByRole("radio", { name: /Dieses Jahr/ }));
    await user.click(screen.getByRole("radio", { name: /Jahresübersicht/ }));
    await user.selectOptions(screen.getByLabelText("Papierformat"), "a3");
    await user.selectOptions(screen.getByLabelText("Ausrichtung"), "landscape");
    await user.click(screen.getByRole("radio", { name: /Dieser Monat/ }));
    expect(screen.getByRole("radio", { name: /^Monatsraster/ })).toBeChecked();
    await user.click(screen.getByRole("radio", { name: /Dieses Jahr/ }));
    await user.click(screen.getByRole("radio", { name: /Jahresübersicht/ }));
    const button = await screen.findByRole("button", { name: "PDF-Datei laden" });
    await waitFor(() => expect(button).toBeEnabled());
    await user.click(button);
    await waitFor(() => expect(apiFetch).toHaveBeenCalled());
    const [url, init] = apiFetch.mock.calls[0] as [string, RequestInit];
    expect(init.headers).toEqual({ Accept: "application/pdf" });
    expect(url).toMatch(/^\/api\/calendars\/k1\/events\.pdf\?from=\d{4}-01-01&to=\d{4}-12-31&/);
    expect(url).toContain("layout=annual-overview");
    expect(url).toContain("paper=a3");
    expect(url).toContain("orientation=landscape");
    expect(downloadBlob).toHaveBeenCalledWith(expect.anything(), "schiessbetrieb-2026.pdf");
  });

  it("maps PDF errors by code", async () => {
    const user = userEvent.setup();
    renderExport();
    await user.click(screen.getByRole("radio", { name: /^PDF/ }));
    const button = await screen.findByRole("button", { name: "PDF-Datei laden" });
    await waitFor(() => expect(button).toBeEnabled());

    apiFetch.mockResolvedValueOnce(problem(422, { code: "too_many_events", field: "to" }));
    await user.click(button);
    expect(await screen.findByText(/höchstens 2000 Termine/)).toBeVisible();

    apiFetch.mockResolvedValueOnce(
      problem(429, { code: "rate_limited" }, { "Retry-After": "125" }),
    );
    await user.click(button);
    expect(await screen.findByText(/in 3 Min\. erneut/)).toBeVisible();

    apiFetch.mockResolvedValueOnce(problem(500, {}));
    await user.click(button);
    expect(await screen.findByText(/prüfe deine Verbindung/)).toBeVisible();
  });

  it("blocks a custom PDF period longer than 366 days", async () => {
    const user = userEvent.setup();
    renderExport();
    await user.click(screen.getByRole("radio", { name: /^PDF/ }));
    await user.click(screen.getByRole("radio", { name: /Von – bis/ }));
    const from = screen.getByLabelText("Von");
    const to = screen.getByLabelText("Bis");
    await user.clear(from);
    await user.type(from, "2020-01-01");
    await user.clear(to);
    await user.type(to, "2022-01-01");
    expect(await screen.findByText(/höchstens 366 Tage/)).toBeVisible();
    expect(screen.getByRole("button", { name: "PDF-Datei laden" })).toBeDisabled();
  });
});
