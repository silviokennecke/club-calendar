import { beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
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
  isDuplicateNameError: (e: { status?: number; code?: string } | null) =>
    e?.status === 422 && e?.code === "duplicate_name",
}));

interface Usage {
  events: number;
  templates: number;
  feeds?: number;
  eventNames: string[];
}
let items: { id: string; name: string; icon?: string | null; usage?: Usage }[];

function renderList(kind: "properties" | "features" | "audiences", readOnly = false) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <ThemeProvider>
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <MasterList kind={kind} clubId="club1" calendarId="k1" readOnly={readOnly} />
        </MemoryRouter>
      </QueryClientProvider>
    </ThemeProvider>,
  );
}

const apiPath = { properties: "properties", features: "features", audiences: "target-groups" };

beforeEach(() => {
  items = [
    // usage as the list endpoint counts it (names only up to three events)
    {
      id: "p1",
      name: "Wettkampf",
      icon: "🏆",
      usage: {
        events: 2,
        templates: 1,
        eventNames: ["Arbeitsdienst Schießstand", "Herbstfest"],
      },
    },
    { id: "p2", name: "Draußen", icon: null, usage: { events: 0, templates: 0, eventNames: [] } },
  ];
  for (const fn of [apiGet, apiPost, apiPatch, apiDelete]) fn.mockReset();
  apiGet.mockImplementation(() => Promise.resolve(items));
  apiPost.mockResolvedValue({ id: "new" });
  apiPatch.mockResolvedValue({});
  apiDelete.mockResolvedValue(undefined);
});

describe("MasterList", () => {
  it("lists the items as a semantic list with counts and symbols", async () => {
    renderList("properties");
    const list = await screen.findByRole("list", { name: /Vorhandene Besonderheiten \(2\)/ });
    const rows = within(list).getAllByRole("listitem");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent("Wettkampf");
    expect(rows[0]).toHaveTextContent("🏆");
    expect(within(rows[1]).getByRole("button", { name: "Draußen bearbeiten" })).toBeInTheDocument();
    expect(apiGet).toHaveBeenCalledWith("/api/calendars/k1/properties");
  });

  it.each([
    ["features", "Zusatzangebot anlegen", "features"],
    ["audiences", "Gruppe anlegen", "target-groups"],
  ] as const)("creates an item of kind %s without a symbol picker", async (kind, label, path) => {
    const user = userEvent.setup();
    renderList(kind);
    await screen.findByRole("list");
    expect(screen.queryByText("Symbol (optional)")).not.toBeInTheDocument();
    await user.type(screen.getByLabelText(/^Name/), "  Neu  ");
    await user.click(screen.getByRole("button", { name: label }));
    await waitFor(() =>
      expect(apiPost).toHaveBeenCalledWith(
        `/api/${kind === "audiences" ? "clubs/club1" : "calendars/k1"}/${path}`,
        { name: "Neu" },
      ),
    );
    expect(apiPath[kind]).toBe(path);
  });

  it("creates a property with its symbol", async () => {
    const user = userEvent.setup();
    renderList("properties");
    await screen.findByRole("list");
    await user.type(screen.getByLabelText(/^Name/), "Rollstuhlgerecht");
    await user.click(screen.getByRole("button", { name: "Barrierefrei" }));
    await user.click(screen.getByRole("button", { name: "Besonderheit anlegen" }));
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
    await user.click(screen.getByRole("button", { name: "Besonderheit anlegen" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Bitte einen Namen eingeben.");
    expect(screen.getByLabelText(/^Name/)).toHaveAccessibleDescription(
      "Bitte einen Namen eingeben.",
    );
    await user.type(screen.getByLabelText(/^Name/), "wettkampf");
    await user.click(screen.getByRole("button", { name: "Besonderheit anlegen" }));
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
    await user.click(screen.getByRole("button", { name: "Zusatzangebot anlegen" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Das Zusatzangebot konnte nicht angelegt werden",
    );
    expect(screen.getByLabelText(/^Name/)).toHaveValue("Siegerehrung");
  });

  it("renames in a dialog: Enter saves, focus returns to the edit button", async () => {
    const user = userEvent.setup();
    renderList("features");
    await screen.findByRole("list");
    await user.click(screen.getByRole("button", { name: "Draußen bearbeiten" }));
    const dialog = await screen.findByRole("dialog", { name: "Zusatzangebot bearbeiten" });
    const input = within(dialog).getByLabelText(/^Name/);
    expect(input).toHaveValue("Draußen");
    // The dialog moves the focus after opening (async)
    await waitFor(() => expect(input).toHaveFocus());
    await user.clear(input);
    await user.type(input, "Im Freien{Enter}");
    await waitFor(() =>
      expect(apiPatch).toHaveBeenCalledWith("/api/calendars/k1/features/p2", { name: "Im Freien" }),
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Draußen bearbeiten" })).toHaveFocus(),
    );
  });

  it("cancels the rename dialog with Escape without saving and returns focus", async () => {
    const user = userEvent.setup();
    renderList("features");
    await screen.findByRole("list");
    const trigger = screen.getByRole("button", { name: "Wettkampf bearbeiten" });
    await user.click(trigger);
    const dialog = await screen.findByRole("dialog", { name: "Zusatzangebot bearbeiten" });
    await user.type(within(dialog).getByLabelText(/^Name/), "xyz");
    await user.keyboard("{Escape}");
    // Typed text is unsaved: the discard question comes first.
    const ask = await screen.findByRole("alertdialog");
    await user.click(within(ask).getByRole("button", { name: "Änderungen verwerfen" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(apiPatch).not.toHaveBeenCalled();
    expect(screen.getByText("Wettkampf")).toBeInTheDocument();
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it("cancels the rename dialog with the cancel button", async () => {
    const user = userEvent.setup();
    renderList("features");
    await screen.findByRole("list");
    await user.click(screen.getByRole("button", { name: "Wettkampf bearbeiten" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Abbrechen" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(apiPatch).not.toHaveBeenCalled();
  });

  it("closes the rename dialog directly when nothing was typed", async () => {
    const user = userEvent.setup();
    renderList("features");
    await screen.findByRole("list");
    await user.click(screen.getByRole("button", { name: "Wettkampf bearbeiten" }));
    await screen.findByRole("dialog");
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("rejects a rename to an existing name with an error summary in the dialog", async () => {
    const user = userEvent.setup();
    renderList("features");
    await screen.findByRole("list");
    await user.click(screen.getByRole("button", { name: "Draußen bearbeiten" }));
    const dialog = await screen.findByRole("dialog");
    const input = within(dialog).getByLabelText(/^Name/);
    await user.clear(input);
    await user.type(input, "wettkampf{Enter}");
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "Diesen Namen gibt es schon",
    );
    expect(input).toHaveAccessibleDescription(/Diesen Namen gibt es schon/);
    expect(apiPatch).not.toHaveBeenCalled();
    // The dialog stays open so the name can be fixed.
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("shows an error in the dialog when saving fails and keeps the input", async () => {
    apiPatch.mockRejectedValue(new Error("boom"));
    const user = userEvent.setup();
    renderList("features");
    await screen.findByRole("list");
    await user.click(screen.getByRole("button", { name: "Draußen bearbeiten" }));
    const dialog = await screen.findByRole("dialog");
    const input = within(dialog).getByLabelText(/^Name/);
    await user.clear(input);
    await user.type(input, "Neu{Enter}");
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "Die Änderung konnte nicht gespeichert werden",
    );
    expect(input).toHaveValue("Neu");
  });

  it("saves the symbol of a property when renaming", async () => {
    const user = userEvent.setup();
    renderList("properties");
    await screen.findByRole("list");
    await user.click(screen.getByRole("button", { name: "Draußen bearbeiten" }));
    const dialog = await screen.findByRole("dialog", { name: "Besonderheit bearbeiten" });
    await user.click(within(dialog).getByRole("button", { name: "Draußen" }));
    await user.click(within(dialog).getByRole("button", { name: "Änderung speichern" }));
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
      name: "Besonderheit „Wettkampf“ löschen?",
    });
    await waitFor(() =>
      expect(dialog).toHaveTextContent(
        "Bei 2 Terminen (Arbeitsdienst Schießstand, Herbstfest) wird die Zuordnung entfernt. Die Termine selbst bleiben bestehen. 1 Vorlage verliert die Zuordnung.",
      ),
    );
    // No event or template lists: the counts come with the list (reloaded when the dialog opens)
    expect(apiGet.mock.calls.every(([path]) => path === "/api/calendars/k1/properties")).toBe(true);
    expect(apiGet.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(apiDelete).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole("button", { name: "Besonderheit löschen" }));
    await waitFor(() => expect(apiDelete).toHaveBeenCalledWith("/api/calendars/k1/properties/p1"));
  });

  it("uses the design wording for audiences: count without names, feeds lose the audience", async () => {
    items = [
      { id: "g1", name: "Senioren", usage: { events: 5, templates: 0, feeds: 2, eventNames: [] } },
    ];
    const user = userEvent.setup();
    renderList("audiences");
    await user.click(await screen.findByRole("button", { name: "Senioren löschen" }));
    const dialog = await screen.findByRole("alertdialog", {
      name: "Gruppe „Senioren“ löschen?",
    });
    expect(dialog).toHaveAccessibleDescription(
      expect.stringContaining("Die Gruppe wird aus allen Kalendern des Vereins entfernt."),
    );
    await waitFor(() =>
      expect(dialog).toHaveTextContent(
        "Bei 5 Terminen wird die Zuordnung entfernt. Feeds, die diese Gruppe ausgewählt haben, verlieren sie aus ihrer Auswahl.",
      ),
    );
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

  it("leaves the feed sentence out when no feed uses the audience", async () => {
    items = [
      {
        id: "g1",
        name: "Senioren",
        usage: { events: 1, templates: 0, feeds: 0, eventNames: ["Fest"] },
      },
    ];
    const user = userEvent.setup();
    renderList("audiences");
    await user.click(await screen.findByRole("button", { name: "Senioren löschen" }));
    const dialog = await screen.findByRole("alertdialog");
    await waitFor(() =>
      expect(dialog).toHaveTextContent("Bei 1 Termin (Fest) wird die Zuordnung entfernt."),
    );
    expect(dialog).not.toHaveTextContent("Feeds, die diese Gruppe");
  });

  it("shows the backend's duplicate check at the field", async () => {
    apiPost.mockRejectedValue(
      Object.assign(new Error("dup"), { status: 422, code: "duplicate_name" }),
    );
    const user = userEvent.setup();
    renderList("features");
    await screen.findByRole("list");
    await user.type(screen.getByLabelText(/^Name/), "Siegerehrung");
    await user.click(screen.getByRole("button", { name: "Zusatzangebot anlegen" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Diesen Namen gibt es schon");
  });

  it("falls back to a general consequence when the usage is unknown", async () => {
    items = items.map(({ usage: _usage, ...rest }) => rest);
    const user = userEvent.setup();
    renderList("properties");
    await user.click(await screen.findByRole("button", { name: "Wettkampf löschen" }));
    const dialog = await screen.findByRole("alertdialog");
    await waitFor(() =>
      expect(dialog).toHaveTextContent(
        "Bei allen Terminen und Vorlagen mit „Wettkampf“ wird die Zuordnung entfernt. Die Termine selbst bleiben bestehen.",
      ),
    );
  });

  it("shows the empty state with a way to create", async () => {
    items = [];
    const user = userEvent.setup();
    renderList("audiences");
    expect(await screen.findByRole("heading", { name: "Noch keine Gruppen" })).toBeInTheDocument();
    const empty = screen.getByRole("heading", { name: "Noch keine Gruppen" }).parentElement!;
    const emptyAdd = within(empty).getByRole("button", { name: "Gruppe anlegen" });
    expect(emptyAdd).toHaveClass("cc-btn--secondary");
    await user.click(emptyAdd);
    expect(screen.getByLabelText(/^Name/)).toHaveFocus();
  });

  it("shows an error with retry when loading fails", async () => {
    apiGet.mockRejectedValue(new Error("API error 500"));
    renderList("features");
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Die Zusatzangebote konnten nicht geladen werden.",
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
