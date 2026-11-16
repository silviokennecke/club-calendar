import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ResourcesPage from "../ResourcesPage";
import { CLUB_BASE, CLUB_PATTERN, renderRoute } from "../../events/__tests__/testUtils";
import { mockApiGet } from "@/test/clubRole";
import type { ClubRole } from "@/lib/types";

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

const route = `${CLUB_PATTERN}/settings/resources`;
const url = `${CLUB_BASE}/settings/resources`;

const halle = { id: "l1", clubId: "c1", name: "Halle" };
const raum = { id: "l2", clubId: "c1", name: "Raum 2" };
const garten = { id: "l3", clubId: "c1", name: "Garten" };
const res = {
  id: "r1",
  clubId: "c1",
  type: "location",
  name: "Große Halle",
  locationId: "l1",
  visibility: "staff",
  allowDoubleBooking: false,
  bufferMinutes: 120,
  updatedAt: 1,
};

let resources: unknown[];

function setup(role: ClubRole = "admin") {
  mockApiGet(
    apiGet,
    (path: string) => {
      if (path === "/api/clubs/c1/resources") return Promise.resolve(resources);
      if (path === "/api/clubs/c1/locations") return Promise.resolve([halle, raum, garten]);
      return Promise.resolve([]);
    },
    role,
  );
  renderRoute(route, url, <ResourcesPage />);
}

beforeEach(() => {
  apiGet.mockReset();
  apiPost.mockReset().mockResolvedValue({});
  apiPatch.mockReset().mockResolvedValue({});
  apiDelete.mockReset().mockResolvedValue({ ok: true });
  resources = [res];
});

describe("ResourcesPage", () => {
  it("lists resources with the buffer in hours and the tab as current", async () => {
    setup();
    expect(await screen.findByText("Große Halle")).toBeInTheDocument();
    expect(screen.getByText("2 Std. Puffer")).toBeInTheDocument();
    const tabs = screen.getByRole("navigation", { name: "Einstellungen des Vereins" });
    expect(within(tabs).getByRole("link", { name: "Ressourcen" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("creates a resource from a free location with the buffer converted to minutes", async () => {
    setup();
    const user = userEvent.setup();
    await screen.findByText("Große Halle");
    await user.click(await screen.findByRole("button", { name: "Ressource anlegen" }));
    const dialog = await screen.findByRole("dialog");
    const select = within(dialog).getByLabelText(/Ort/);
    expect(within(select).queryByRole("option", { name: "Halle" })).not.toBeInTheDocument();
    await user.selectOptions(select, "l2");
    expect(within(dialog).getByLabelText(/Name/)).toHaveValue("Raum 2");
    await user.click(within(dialog).getByRole("switch", { name: "Doppelbelegung erlauben" }));
    const buffer = within(dialog).getByLabelText("Pufferzeit in Stunden");
    await user.clear(buffer);
    await user.type(buffer, "3");
    await user.click(within(dialog).getByRole("button", { name: "Speichern" }));
    await waitFor(() =>
      expect(apiPost).toHaveBeenCalledWith("/api/clubs/c1/resources", {
        locationId: "l2",
        name: "Raum 2",
        visibility: "staff",
        allowDoubleBooking: true,
        bufferMinutes: 180,
      }),
    );
  });

  it("rejects a buffer outside 0..24 without calling the API", async () => {
    setup();
    const user = userEvent.setup();
    await screen.findByText("Große Halle");
    await user.click(await screen.findByRole("button", { name: "Ressource anlegen" }));
    const dialog = await screen.findByRole("dialog");
    await user.selectOptions(within(dialog).getByLabelText(/Ort/), "l3");
    const buffer = within(dialog).getByLabelText("Pufferzeit in Stunden");
    await user.clear(buffer);
    await user.type(buffer, "25");
    await user.click(within(dialog).getByRole("button", { name: "Speichern" }));
    expect((await within(dialog).findAllByText(/ganze Zahl von 0 bis 24/)).length).toBeGreaterThan(
      0,
    );
    expect(apiPost).not.toHaveBeenCalled();
  });

  it("shows duplicate_resource as a field error", async () => {
    apiPost.mockRejectedValue(
      Object.assign(new Error("dup"), { status: 422, code: "duplicate_resource" }),
    );
    setup();
    const user = userEvent.setup();
    await screen.findByText("Große Halle");
    await user.click(await screen.findByRole("button", { name: "Ressource anlegen" }));
    const dialog = await screen.findByRole("dialog");
    await user.selectOptions(within(dialog).getByLabelText(/Ort/), "l3");
    await user.click(within(dialog).getByRole("button", { name: "Speichern" }));
    expect((await within(dialog).findAllByText(/bereits eine Ressource/)).length).toBeGreaterThan(
      0,
    );
  });

  it("edits without touching the buffer when the hours stay the same", async () => {
    setup();
    const user = userEvent.setup();
    await user.click(
      await screen.findByRole("button", { name: "Ressource Große Halle bearbeiten" }),
    );
    const dialog = await screen.findByRole("dialog");
    const name = within(dialog).getByLabelText(/Name/);
    await user.clear(name);
    await user.type(name, "Turnhalle");
    await user.click(within(dialog).getByRole("button", { name: "Speichern" }));
    await waitFor(() =>
      expect(apiPatch).toHaveBeenCalledWith("/api/clubs/c1/resources/r1", {
        name: "Turnhalle",
        visibility: "staff",
        allowDoubleBooking: false,
      }),
    );
  });

  it("deletes after confirmation", async () => {
    setup();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Ressource Große Halle löschen" }));
    await user.click(await screen.findByRole("button", { name: "Ressource löschen" }));
    await waitFor(() => expect(apiDelete).toHaveBeenCalledWith("/api/clubs/c1/resources/r1"));
  });

  it("is read-only for viewers", async () => {
    setup("viewer");
    expect(await screen.findByText("Große Halle")).toBeInTheDocument();
    expect(await screen.findByText(/erlaubt nur das Ansehen/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Ressource anlegen" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /bearbeiten|löschen/ })).not.toBeInTheDocument();
  });
});
