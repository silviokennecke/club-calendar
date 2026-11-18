import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import EventFormModal from "../EventFormModal";
import { BASE, PATTERN, groups, makeEvent, renderRoute } from "./testUtils";
import { mockApiGet } from "@/test/clubRole";

const apiGet = vi.fn();
const apiPost = vi.fn();
const apiPatch = vi.fn();
const apiDelete = vi.fn();

vi.mock("@/lib/api", async (orig) => ({
  ...(await orig<typeof import("@/lib/api")>()),
  apiGet: (...a: unknown[]) => apiGet(...a),
  apiPost: (...a: unknown[]) => apiPost(...a),
  apiPatch: (...a: unknown[]) => apiPatch(...a),
  apiDelete: (...a: unknown[]) => apiDelete(...a),
}));

const notice = makeEvent({
  id: "n1",
  name: "Schießstand geschlossen",
  date: "2026-10-24",
  isAllDay: true,
  type: "notice",
  isDraft: true,
});

beforeEach(() => {
  for (const fn of [apiGet, apiPost, apiPatch, apiDelete]) fn.mockReset();
  mockApiGet(apiGet, (path: string) => {
    if (path === "/api/clubs/c1/calendars/k1")
      return Promise.resolve({ id: "k1", clubId: "c1", name: "Kalender" });
    if (path.endsWith("/target-groups")) return Promise.resolve([...groups]);
    if (path === "/api/calendars/k1/events/n1") return Promise.resolve(notice);
    return Promise.resolve([]);
  });
  apiPost.mockResolvedValue({ id: "new" });
  apiPatch.mockResolvedValue({});
  apiDelete.mockResolvedValue(undefined);
});

function renderNew() {
  return renderRoute(
    `${PATTERN}/events/new/form`,
    `${BASE}/events/new/form?type=notice&date=2026-10-14`,
    <EventFormModal />,
  );
}

describe("event form in notice mode", () => {
  it("hides everything a notice cannot have", async () => {
    renderNew();
    expect(await screen.findByLabelText(/^Name/)).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Neuer Hinweis" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Ganztägig")).toBeNull();
    expect(screen.queryByLabelText(/Startzeit/)).toBeNull();
    expect(screen.queryByLabelText(/Endzeit/)).toBeNull();
    expect(screen.queryByRole("combobox", { name: /^Ort/ })).toBeNull();
    expect(screen.queryByText("Besonderheiten")).toBeNull();
    expect(screen.queryByText("Zusatzangebote")).toBeNull();
    expect(screen.getByRole("group", { name: "Gruppen" })).toBeInTheDocument();
    expect(screen.getByText("Ohne Auswahl gilt der Hinweis für alle.")).toBeInTheDocument();
  });

  it("sends only the fields a notice may carry", async () => {
    const user = userEvent.setup();
    renderNew();
    await user.type(await screen.findByLabelText(/^Name/), "Schießstand geschlossen");
    await user.click(screen.getByRole("button", { name: "Hinweis speichern" }));
    await waitFor(() =>
      expect(apiPost).toHaveBeenCalledWith("/api/calendars/k1/events", {
        name: "Schießstand geschlossen",
        date: "2026-10-14",
        dateEnd: null,
        isDraft: true,
        targetGroupIds: [],
        note: "",
        type: "notice",
      }),
    );
  });

  it("derives the mode from the event when editing and never sends the type", async () => {
    const user = userEvent.setup();
    renderRoute(`${PATTERN}/events/:eventId`, `${BASE}/events/n1`, <EventFormModal />);
    expect(await screen.findByLabelText(/^Name/)).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Hinweis bearbeiten" })).toBeInTheDocument();
    expect(screen.queryByLabelText(/Startzeit/)).toBeNull();
    await user.type(screen.getByLabelText(/^Name/), "!");
    await user.click(screen.getByRole("button", { name: "Hinweis speichern" }));
    await waitFor(() => expect(apiPatch).toHaveBeenCalled());
    const body = apiPatch.mock.calls[0][1] as Record<string, unknown>;
    expect(apiPatch.mock.calls[0][0]).toBe("/api/calendars/k1/events/n1");
    expect(body).not.toHaveProperty("type");
    for (const key of ["locationId", "propertyIds", "featureIds", "timeBegin", "isAllDay"])
      expect(body).not.toHaveProperty(key);
    expect(body.name).toBe("Schießstand geschlossen!");
  });

  it("deletes a notice with notice wording", async () => {
    const user = userEvent.setup();
    renderRoute(`${PATTERN}/events/:eventId`, `${BASE}/events/n1`, <EventFormModal />);
    await user.click(await screen.findByRole("button", { name: "Hinweis löschen" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent("Hinweis „Schießstand geschlossen“ löschen?");
    await user.click(screen.getAllByRole("button", { name: "Hinweis löschen" }).at(-1)!);
    await waitFor(() => expect(apiDelete).toHaveBeenCalledWith("/api/calendars/k1/events/n1"));
  });
});
