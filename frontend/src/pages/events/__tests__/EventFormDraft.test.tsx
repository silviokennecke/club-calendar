import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import EventFormModal from "../EventFormModal";
import { BASE, PATTERN, renderRoute } from "./testUtils";
import { mockApiGet } from "@/test/clubRole";
import { AuthContext, type AuthContextValue } from "@/lib/auth-context";
import { DRAFT_MAX_AGE_MS, clearDrafts, draftKey } from "@/lib/events";
import type { User } from "@/lib/types";

const apiGet = vi.fn();
const apiPost = vi.fn();

vi.mock("@/lib/api", async (orig) => ({
  ...(await orig<typeof import("@/lib/api")>()),
  apiGet: (...a: unknown[]) => apiGet(...a),
  apiPost: (...a: unknown[]) => apiPost(...a),
}));
vi.mock("@/components/events/EventLocationMap", () => ({
  default: () => <div />,
}));

const KEY = draftKey("u1", "k1", null);
const stored = {
  name: "Sommerfest",
  date: "2026-07-01",
  dateEnd: "",
  isAllDay: false,
  timeBegin: "19:00",
  timeEnd: "21:00",
  status: "draft",
  locationId: "gone",
  propertyIds: ["p1", "deleted"],
  featureIds: [],
  targetGroupIds: [],
  eventTemplateId: null,
  note: "Grill",
};
const put = (values: unknown, savedAt = Date.now()) =>
  localStorage.setItem(KEY, JSON.stringify({ savedAt, values }));

function renderForm() {
  const auth = { user: { id: "u1" } as User } as AuthContextValue;
  return renderRoute(
    `${PATTERN}/events/new/form`,
    `${BASE}/events/new/form`,
    <AuthContext.Provider value={auth}>
      <EventFormModal />
    </AuthContext.Provider>,
  );
}

beforeEach(() => {
  localStorage.clear();
  apiGet.mockReset();
  apiPost.mockReset().mockResolvedValue({ id: "new" });
  mockApiGet(apiGet, (path: string) => {
    if (path === "/api/clubs/c1/calendars/k1")
      return Promise.resolve({ id: "k1", clubId: "c1", name: "Kalender" });
    if (path.endsWith("/properties"))
      return Promise.resolve([{ id: "p1", calendarid: "k1", name: "Wettkampf", icon: "🏆" }]);
    return Promise.resolve([]);
  });
});
afterEach(() => vi.restoreAllMocks());

describe("event form draft", () => {
  it("saves a debounced draft once the user changed something", async () => {
    const user = userEvent.setup();
    renderForm();
    const name = await screen.findByLabelText(/^Name/);
    vi.useFakeTimers({ shouldAdvanceTime: true });
    await user.type(name, "Fest");
    expect(localStorage.getItem(KEY)).toBeNull();
    act(() => void vi.advanceTimersByTime(1100));
    vi.useRealTimers();
    expect(JSON.parse(localStorage.getItem(KEY)!).values.name).toBe("Fest");
  });

  it("does not save an untouched form", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    renderForm();
    await screen.findByLabelText(/^Name/);
    act(() => void vi.advanceTimersByTime(3000));
    vi.useRealTimers();
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it("offers a stored draft, restores it and drops unknown references", async () => {
    const user = userEvent.setup();
    put(stored);
    renderForm();
    expect(await screen.findByText("Entwurf wiederherstellen?")).toBeInTheDocument();
    expect(screen.getByLabelText(/^Name/)).toHaveValue("");
    const restore = screen.getByRole("button", { name: "Wiederherstellen" });
    await waitFor(() => expect(restore).toBeEnabled());
    await user.click(restore);
    expect(screen.getByLabelText(/^Name/)).toHaveValue("Sommerfest");
    expect(screen.getByLabelText(/^Startdatum/)).toHaveValue("2026-07-01");
    expect(screen.queryByText("Entwurf wiederherstellen?")).not.toBeInTheDocument();
  });

  it("deletes the draft on discard without touching the form", async () => {
    const user = userEvent.setup();
    put(stored);
    renderForm();
    await user.click(await screen.findByRole("button", { name: "Verwerfen" }));
    expect(localStorage.getItem(KEY)).toBeNull();
    expect(screen.getByLabelText(/^Name/)).toHaveValue("");
  });

  it("deletes the draft after a successful save", async () => {
    const user = userEvent.setup();
    put(stored);
    renderForm();
    const restore = await screen.findByRole("button", { name: "Wiederherstellen" });
    await waitFor(() => expect(restore).toBeEnabled());
    await user.click(restore);
    await user.click(screen.getByRole("button", { name: /Termin speichern/ }));
    await waitFor(() => expect(apiPost).toHaveBeenCalled());
    await waitFor(() => expect(localStorage.getItem(KEY)).toBeNull());
  });

  it("deletes the draft when the unsaved-changes dialog discards", async () => {
    const user = userEvent.setup();
    renderForm();
    const name = await screen.findByLabelText(/^Name/);
    vi.useFakeTimers({ shouldAdvanceTime: true });
    await user.type(name, "Fest");
    act(() => void vi.advanceTimersByTime(1100));
    vi.useRealTimers();
    expect(localStorage.getItem(KEY)).not.toBeNull();
    await user.click(screen.getByRole("button", { name: "Schließen, Termin verwerfen" }));
    await user.click(await screen.findByRole("button", { name: "Änderungen verwerfen" }));
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it("ignores and removes an expired draft", async () => {
    put(stored, Date.now() - DRAFT_MAX_AGE_MS - 1000);
    renderForm();
    await screen.findByLabelText(/^Name/);
    expect(screen.queryByText("Entwurf wiederherstellen?")).not.toBeInTheDocument();
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it("ignores and removes a draft with a different schema", async () => {
    put({ ...stored, propertyIds: "p1" });
    renderForm();
    await screen.findByLabelText(/^Name/);
    expect(screen.queryByText("Entwurf wiederherstellen?")).not.toBeInTheDocument();
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it("works with unavailable storage", async () => {
    const boom = () => {
      throw new Error("denied");
    };
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(boom);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(boom);
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(boom);
    const user = userEvent.setup();
    renderForm();
    const name = await screen.findByLabelText(/^Name/);
    vi.useFakeTimers({ shouldAdvanceTime: true });
    await user.type(name, "Fest");
    act(() => void vi.advanceTimersByTime(1100));
    vi.useRealTimers();
    expect(name).toHaveValue("Fest");
    expect(() => clearDrafts()).not.toThrow();
  });
});
