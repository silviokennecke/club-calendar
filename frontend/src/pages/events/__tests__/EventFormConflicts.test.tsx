import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ApiError } from "@/lib/api";
import EventFormModal from "../EventFormModal";
import { BASE, PATTERN, makeEvent, renderRoute } from "./testUtils";
import { mockApiGet } from "@/test/clubRole";

const apiGet = vi.fn();
const apiPost = vi.fn();
const apiPatch = vi.fn();

vi.mock("@/lib/api", async (orig) => ({
  ...(await orig<typeof import("@/lib/api")>()),
  apiGet: (...a: unknown[]) => apiGet(...a),
  apiPost: (...a: unknown[]) => apiPost(...a),
  apiPatch: (...a: unknown[]) => apiPatch(...a),
}));

const conflict = {
  kind: "overlap",
  severity: "error",
  resourceId: "r1",
  resourceName: "Halle",
  calendarName: "Vorstand",
  date: "2026-10-24",
  dateEnd: null,
  timeBegin: "14:00",
  timeEnd: "16:00",
  isAllDay: false,
  isDraft: false,
  eventName: "Sitzung",
};
const withLocation = makeEvent({
  id: "e1",
  name: "Herbstfest",
  date: "2026-10-24",
  timeBegin: "15:00",
  timeEnd: "22:00",
  locationId: "l1",
});

beforeEach(() => {
  for (const fn of [apiGet, apiPost, apiPatch]) fn.mockReset();
  mockApiGet(apiGet, (path: string) => {
    if (path === "/api/clubs/c1/calendars/k1")
      return Promise.resolve({ id: "k1", clubId: "c1", name: "Kalender" });
    if (path === "/api/calendars/k1/events/e1") return Promise.resolve(withLocation);
    if (path.endsWith("/locations"))
      return Promise.resolve([{ id: "l1", clubId: "c1", name: "Halle" }]);
    return Promise.resolve([]);
  });
  apiPost.mockImplementation((path: string) =>
    path.endsWith("/conflicts")
      ? Promise.resolve({ conflicts: [conflict], blocking: true })
      : Promise.resolve({}),
  );
});

function renderEdit() {
  return renderRoute(`${PATTERN}/events/:eventId`, `${BASE}/events/e1`, <EventFormModal />);
}

describe("event form resource conflicts", () => {
  it("shows the live check under the location field", async () => {
    renderEdit();
    const alert = await screen.findByRole("alert", {}, { timeout: 3000 });
    expect(alert).toHaveTextContent("Vorstand");
    expect(alert).toHaveTextContent("Sitzung");
    expect(apiPost).toHaveBeenCalledWith(
      "/api/calendars/k1/events/conflicts",
      expect.objectContaining({ locationId: "l1", date: "2026-10-24", eventId: "e1" }),
    );
  });

  it("keeps the input and shows the conflicts of a refused save", async () => {
    apiPost.mockImplementation((path: string) =>
      path.endsWith("/conflicts")
        ? Promise.resolve({ conflicts: [], blocking: false })
        : Promise.resolve({}),
    );
    apiPatch.mockRejectedValue(
      new ApiError("conflict", 422, "resource_conflict", undefined, { conflicts: [conflict] }),
    );
    const user = userEvent.setup();
    renderEdit();
    const name = await screen.findByLabelText(/^Name/);
    await user.type(name, "!");
    await user.click(screen.getByRole("button", { name: /Termin speichern/ }));
    const alert = await screen.findByRole("alert");
    await waitFor(() => expect(alert).toHaveTextContent(/Nicht gespeichert/));
    expect(alert).toHaveTextContent("Vorstand");
    expect(screen.getByLabelText(/^Name/)).toHaveValue("Herbstfest!");
  });
});
