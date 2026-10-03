import { beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ThemeProvider } from "@/lib/ThemeProvider";
import { MasterList } from "../MasterList";

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

let items: { id: string; name: string; icon?: string | null }[];
let events: unknown[];
let templates: unknown[];

function renderList(kind: "properties" | "features" | "audiences", readOnly = false) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <ThemeProvider>
      <QueryClientProvider client={client}>
        <MasterList kind={kind} calendarId="k1" readOnly={readOnly} />
      </QueryClientProvider>
    </ThemeProvider>,
  );
}

const apiPath = { properties: "properties", features: "features", audiences: "target-groups" };

beforeEach(() => {
  items = [
    { id: "p1", name: "Wettkampf", icon: "🏆" },
    { id: "p2", name: "Draußen", icon: null },
  ];
  events = [
    {
      properties: [{ property: { id: "p1" } }],
      features: [],
      targetGroups: [],
    },
    {
      properties: [{ property: { id: "p1" } }],
      features: [],
      targetGroups: [],
    },
  ];
  templates = [{ properties: [{ property: { id: "p1" } }], features: [], targetGroups: [] }];
  for (const fn of [apiGet, apiPost, apiPatch, apiDelete]) fn.mockReset();
  apiGet.mockImplementation((path: string) => {
    if (path.endsWith("/events")) return Promise.resolve(events);
    if (path.endsWith("/templates")) return Promise.resolve(templates);
    return Promise.resolve(items);
  });
  apiPost.mockResolvedValue({ id: "new" });
  apiPatch.mockResolvedValue({});
  apiDelete.mockResolvedValue(undefined);
});

describe("MasterList", () => {
  it("lists the items as a semantic list with counts and symbols", async () => {
    renderList("properties");
    const list = await screen.findByRole("list", { name: /Vorhandene Eigenschaften \(2\)/ });
    const rows = within(list).getAllByRole("listitem");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent("Wettkampf");
    expect(rows[0]).toHaveTextContent("🏆");
    expect(within(rows[1]).getByRole("button", { name: "Draußen bearbeiten" })).toBeInTheDocument();
    expect(apiGet).toHaveBeenCalledWith("/api/calendars/k1/properties");
  });

  it.each([
    ["features", "Feature anlegen", "features"],
    ["audiences", "Zielgruppe anlegen", "target-groups"],
  ] as const)("creates an item of kind %s without a symbol picker", async (kind, label, path) => {
    const user = userEvent.setup();
    renderList(kind);
    await screen.findByRole("list");
    expect(screen.queryByText("Symbol (optional)")).not.toBeInTheDocument();
    await user.type(screen.getByLabelText(/^Name/), "  Neu  ");
    await user.click(screen.getByRole("button", { name: label }));
    await waitFor(() =>
      expect(apiPost).toHaveBeenCalledWith(`/api/calendars/k1/${path}`, { name: "Neu" }),
    );
    expect(apiPath[kind]).toBe(path);
  });

  it("creates a property with its symbol", async () => {
    const user = userEvent.setup();
    renderList("properties");
    await screen.findByRole("list");
    await user.type(screen.getByLabelText(/^Name/), "Rollstuhlgerecht");
    await user.click(screen.getByRole("button", { name: "Barrierefrei" }));
    await user.click(screen.getByRole("button", { name: "Eigenschaft anlegen" }));
    await waitFor(() =>
      expect(apiPost).toHaveBeenCalledWith("/api/calendars/k1/properties", {
        name: "Rollstuhlgerecht",
        icon: "♿",
      }),
    );
  });

  it("explains empty and duplicate names in an error summary and at the field", async () => {
    const user = userEvent.setup();
    renderList("properties");
    await screen.findByRole("list");
    await user.click(screen.getByRole("button", { name: "Eigenschaft anlegen" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Bitte einen Namen eingeben.");
    expect(screen.getByLabelText(/^Name/)).toHaveAccessibleDescription(
      "Bitte einen Namen eingeben.",
    );
    await user.type(screen.getByLabelText(/^Name/), "wettkampf");
    await user.click(screen.getByRole("button", { name: "Eigenschaft anlegen" }));
    expect(
      await screen.findByText("Diesen Namen gibt es schon. Bitte einen anderen wählen.", {
        selector: "li a",
      }),
    ).toBeInTheDocument();
    expect(apiPost).not.toHaveBeenCalled();
  });

  it("shows an error when creating fails and keeps the input", async () => {
    apiPost.mockRejectedValue(new Error("boom"));
    const user = userEvent.setup();
    renderList("features");
    await screen.findByRole("list");
    await user.type(screen.getByLabelText(/^Name/), "Siegerehrung");
    await user.click(screen.getByRole("button", { name: "Feature anlegen" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Das Feature konnte nicht angelegt werden",
    );
    expect(screen.getByLabelText(/^Name/)).toHaveValue("Siegerehrung");
  });

  it("renames inline: Enter saves, focus returns to the edit button", async () => {
    const user = userEvent.setup();
    renderList("features");
    await screen.findByRole("list");
    await user.click(screen.getByRole("button", { name: "Draußen bearbeiten" }));
    const input = await screen.findByLabelText(/^Name/, { selector: "#ml-edit-p2" });
    expect(input).toHaveFocus();
    await user.clear(input);
    await user.type(input, "Im Freien{Enter}");
    await waitFor(() =>
      expect(apiPatch).toHaveBeenCalledWith("/api/calendars/k1/features/p2", { name: "Im Freien" }),
    );
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Draußen bearbeiten" })).toHaveFocus(),
    );
  });

  it("cancels an inline rename with Escape without saving", async () => {
    const user = userEvent.setup();
    renderList("features");
    await screen.findByRole("list");
    await user.click(screen.getByRole("button", { name: "Wettkampf bearbeiten" }));
    const input = await screen.findByLabelText(/^Name/, { selector: "#ml-edit-p1" });
    await user.type(input, "xyz");
    await user.keyboard("{Escape}");
    expect(screen.queryByLabelText(/^Name/, { selector: "#ml-edit-p1" })).not.toBeInTheDocument();
    expect(apiPatch).not.toHaveBeenCalled();
    expect(screen.getByText("Wettkampf")).toBeInTheDocument();
  });

  it("rejects a rename to an existing name", async () => {
    const user = userEvent.setup();
    renderList("features");
    await screen.findByRole("list");
    await user.click(screen.getByRole("button", { name: "Draußen bearbeiten" }));
    const input = await screen.findByLabelText(/^Name/, { selector: "#ml-edit-p2" });
    await user.clear(input);
    await user.type(input, "wettkampf{Enter}");
    expect(await screen.findByRole("alert")).toHaveTextContent("Diesen Namen gibt es schon");
    expect(apiPatch).not.toHaveBeenCalled();
  });

  it("saves the symbol of a property when renaming", async () => {
    const user = userEvent.setup();
    renderList("properties");
    await screen.findByRole("list");
    await user.click(screen.getByRole("button", { name: "Draußen bearbeiten" }));
    const form = await screen.findByRole("form", { name: "Eigenschaft bearbeiten: Draußen" });
    await user.click(within(form).getByRole("button", { name: "Draußen" }));
    await user.click(within(form).getByRole("button", { name: "Änderung speichern" }));
    await waitFor(() =>
      expect(apiPatch).toHaveBeenCalledWith("/api/calendars/k1/properties/p2", {
        name: "Draußen",
        icon: "🌳",
      }),
    );
  });

  it("names how many events and templates a delete affects", async () => {
    const user = userEvent.setup();
    renderList("properties");
    await user.click(await screen.findByRole("button", { name: "Wettkampf löschen" }));
    const dialog = await screen.findByRole("alertdialog", {
      name: "Eigenschaft „Wettkampf“ löschen?",
    });
    await waitFor(() =>
      expect(dialog).toHaveTextContent(
        "2 Termine verlieren die Zuordnung zu „Wettkampf“. Die Termine selbst bleiben erhalten. 1 Vorlage verliert die Zuordnung.",
      ),
    );
    expect(apiDelete).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole("button", { name: "Eigenschaft löschen" }));
    await waitFor(() => expect(apiDelete).toHaveBeenCalledWith("/api/calendars/k1/properties/p1"));
  });

  it("says so when an item is not in use, and falls back when the counts fail", async () => {
    const user = userEvent.setup();
    renderList("properties");
    await user.click(await screen.findByRole("button", { name: "Draußen löschen" }));
    const dialog = await screen.findByRole("alertdialog");
    await waitFor(() =>
      expect(dialog).toHaveTextContent(
        "„Draußen“ ist aktuell keinem Termin und keiner Vorlage zugeordnet.",
      ),
    );
  });

  it("falls back to a general consequence when the usage cannot be loaded", async () => {
    apiGet.mockImplementation((path: string) =>
      path.endsWith("/events") ? Promise.reject(new Error("x")) : Promise.resolve(items),
    );
    const user = userEvent.setup();
    renderList("properties");
    await user.click(await screen.findByRole("button", { name: "Wettkampf löschen" }));
    const dialog = await screen.findByRole("alertdialog");
    await waitFor(() =>
      expect(dialog).toHaveTextContent(
        "Termine und Vorlagen verlieren die Zuordnung zu „Wettkampf“.",
      ),
    );
  });

  it("shows the empty state with a way to create", async () => {
    items = [];
    const user = userEvent.setup();
    renderList("audiences");
    expect(
      await screen.findByRole("heading", { name: "Noch keine Zielgruppen" }),
    ).toBeInTheDocument();
    const empty = screen.getByRole("heading", { name: "Noch keine Zielgruppen" }).parentElement!;
    await user.click(within(empty).getByRole("button", { name: "Zielgruppe anlegen" }));
    expect(screen.getByLabelText(/^Name/)).toHaveFocus();
  });

  it("shows an error with retry when loading fails", async () => {
    apiGet.mockRejectedValue(new Error("API error 500"));
    renderList("features");
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Die Features konnten nicht geladen werden.",
    );
    expect(screen.getByRole("button", { name: "Erneut versuchen" })).toBeInTheDocument();
  });

  it("is a plain list in read-only mode", async () => {
    renderList("properties", true);
    await screen.findByRole("list");
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/^Name/)).not.toBeInTheDocument();
  });

  it("shows audiences as tags", async () => {
    items = [{ id: "g1", name: "Jugend" }];
    renderList("audiences");
    const row = (await screen.findAllByRole("listitem"))[0];
    expect(row).toHaveTextContent("Jugend");
    expect(row.querySelector(".cc-tag")).not.toBeNull();
  });
});
