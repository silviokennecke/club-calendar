import { beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import SetupPage from "../SetupPage";

const apiGet = vi.fn();
const apiPost = vi.fn();
const apiPatch = vi.fn();
const updateUser = vi.fn().mockResolvedValue(undefined);
const logout = vi.fn();

vi.mock("@/lib/api", () => ({
  apiGet: (...a: unknown[]) => apiGet(...a),
  apiPost: (...a: unknown[]) => apiPost(...a),
  apiPatch: (...a: unknown[]) => apiPatch(...a),
}));
vi.mock("@/lib/auth-context", () => ({ useAuth: () => ({ updateUser, logout }) }));

function Probe() {
  const loc = useLocation();
  return <div data-testid="location">{loc.pathname}</div>;
}

function renderSetup(path = "/setup") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/setup" element={<SetupPage />} />
          <Route path="*" element={<Probe />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const club = { id: "c1", name: "Waldblick", timezone: "Europe/Berlin" };

function current() {
  return screen
    .getAllByRole("listitem")
    .filter((li) => li.getAttribute("aria-current") === "step")
    .map((li) => li.textContent);
}

beforeEach(() => {
  vi.clearAllMocks();
  apiGet.mockImplementation((path: string) =>
    Promise.resolve(path === "/api/clubs" ? [] : path === "/api/clubs/c1" ? club : []),
  );
});

describe("SetupPage skipping", () => {
  it("lets a new user skip the club for now and lands on the club picker", async () => {
    renderSetup();
    await userEvent.click(await screen.findByRole("link", { name: "Vorerst überspringen" }));
    expect(await screen.findByTestId("location")).toHaveTextContent("/clubs");
    expect(apiPost).not.toHaveBeenCalled();
  });

  it("does not offer to skip when another club is created on purpose (?new=1)", async () => {
    renderSetup("/setup?new=1");
    await screen.findByRole("heading", { level: 1, name: "Willkommen bei Club Calendar" });
    expect(screen.queryByRole("link", { name: "Vorerst überspringen" })).not.toBeInTheDocument();
  });
});

describe("SetupPage step 1 (club)", () => {
  it("shows the stepper on step 1 and a labelled form", async () => {
    renderSetup();
    expect(
      await screen.findByRole("heading", { level: 1, name: "Willkommen bei Club Calendar" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("list", { name: "Fortschritt" })).toBeInTheDocument();
    expect(current()).toEqual(["1Verein"]);
    expect(screen.getByRole("form", { name: "Verein anlegen" })).toBeInTheDocument();
    expect(screen.getByText("Diesen Namen sehen alle Mitglieder.")).toBeInTheDocument();
  });

  it("reports an empty name and focuses the field", async () => {
    renderSetup();
    await userEvent.click(await screen.findByRole("button", { name: "Verein anlegen" }));
    const input = screen.getByLabelText(/Name deines Vereins/);
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("alert")).toHaveFocus();
    expect(screen.getByRole("alert")).toHaveTextContent("Der Verein ist noch nicht angelegt.");
    expect(screen.getAllByText("Bitte gib den Namen deines Vereins ein.")).toHaveLength(2);
    expect(apiPost).not.toHaveBeenCalled();
  });

  it("creates the club with the browser time zone and moves to step 2 with focus on the heading", async () => {
    apiPost.mockResolvedValueOnce(club);
    renderSetup();
    await userEvent.type(await screen.findByLabelText(/Name deines Vereins/), " Waldblick ");
    await userEvent.click(screen.getByRole("button", { name: "Verein anlegen" }));
    expect(apiPost).toHaveBeenCalledWith("/api/clubs", {
      name: "Waldblick",
      timezone: expect.any(String),
    });
    const heading = await screen.findByRole("heading", {
      level: 1,
      name: "Ersten Kalender anlegen",
    });
    expect(current()).toEqual(["2Kalender"]);
    await waitFor(() => expect(heading).toHaveFocus());
    expect(screen.getByRole("status")).toHaveTextContent(
      "Verein „Waldblick“ ist angelegt. Es fehlt noch der erste Kalender.",
    );
    expect(screen.getByText(/automatisch aus deinem Browser erkannt/)).toBeInTheDocument();
  });

  it("shows an alert and stays on step 1 when creating the club fails", async () => {
    apiPost.mockRejectedValueOnce(new Error("boom"));
    renderSetup();
    await userEvent.type(await screen.findByLabelText(/Name deines Vereins/), "Waldblick");
    await userEvent.click(screen.getByRole("button", { name: "Verein anlegen" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Das hat nicht geklappt");
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Willkommen");
  });

  it("signs out via the footer button", async () => {
    renderSetup();
    await userEvent.click(await screen.findByRole("button", { name: "Abmelden" }));
    expect(logout).toHaveBeenCalled();
  });
});

describe("SetupPage step 2 (calendar)", () => {
  async function toStep2() {
    apiPost.mockResolvedValueOnce(club);
    renderSetup();
    await userEvent.type(await screen.findByLabelText(/Name deines Vereins/), "Waldblick");
    await userEvent.click(screen.getByRole("button", { name: "Verein anlegen" }));
    await screen.findByRole("heading", { level: 1, name: "Ersten Kalender anlegen" });
  }

  it("suggests a calendar name, creates it, remembers it and opens the calendar", async () => {
    await toStep2();
    const input = screen.getByLabelText(/Name des Kalenders/);
    expect(input).toHaveValue(`Vereinstermine ${new Date().getFullYear()}`);
    apiPost.mockResolvedValueOnce({ id: "k1", clubId: "c1", name: "Saison" });
    await userEvent.clear(input);
    await userEvent.type(input, "Saison");
    await userEvent.click(screen.getByRole("button", { name: "Kalender anlegen" }));
    expect(apiPost).toHaveBeenLastCalledWith("/api/clubs/c1/calendars", { name: "Saison" });
    await waitFor(() =>
      expect(updateUser).toHaveBeenCalledWith({ lastClubId: "c1", lastCalendarId: "k1" }),
    );
    expect(await screen.findByTestId("location")).toHaveTextContent("/clubs/c1/calendars/k1");
  });

  it("rejects an empty calendar name", async () => {
    await toStep2();
    const input = screen.getByLabelText(/Name des Kalenders/);
    await userEvent.clear(input);
    await userEvent.click(screen.getByRole("button", { name: "Kalender anlegen" }));
    expect(screen.getAllByText("Bitte gib einen Namen für den Kalender ein.")).toHaveLength(2);
    expect(screen.getByRole("alert")).toHaveFocus();
    await userEvent.type(input, "x");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("goes back without creating a second club and renames it when changed", async () => {
    await toStep2();
    await userEvent.click(screen.getByRole("button", { name: "Zurück" }));
    const input = await screen.findByLabelText(/Name deines Vereins/);
    expect(input).toHaveValue("Waldblick");
    apiPatch.mockResolvedValueOnce({ ...club, name: "Waldblick 2" });
    await userEvent.type(input, " 2");
    await userEvent.click(screen.getByRole("button", { name: "Verein anlegen" }));
    expect(apiPatch).toHaveBeenCalledWith("/api/clubs/c1", { name: "Waldblick 2" });
    expect(apiPost).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole("status")).toHaveTextContent("Waldblick 2");
  });

  it("resumes at step 2 for an existing club without calendar and has no back button", async () => {
    renderSetup("/setup?clubId=c1");
    expect(
      await screen.findByRole("heading", { level: 1, name: "Ersten Kalender anlegen" }),
    ).toBeInTheDocument();
    expect(current()).toEqual(["2Kalender"]);
    expect(screen.queryByRole("button", { name: "Zurück" })).not.toBeInTheDocument();
    expect(screen.getByText("Zeitzone: Europe/Berlin")).toBeInTheDocument();
  });
});

describe("SetupPage with existing clubs", () => {
  it("starts at step 1 (new club) without parameters, even if the user has clubs", async () => {
    apiGet.mockImplementation((path: string) =>
      Promise.resolve(path === "/api/clubs" ? [club] : []),
    );
    renderSetup();
    expect(
      await screen.findByRole("heading", { level: 1, name: "Willkommen bei Club Calendar" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("Verein angelegt")).toBeNull();
    expect(apiGet).not.toHaveBeenCalledWith("/api/clubs");
  });

  it("continues at step 2 for the club in ?clubId=", async () => {
    apiGet.mockImplementation((path: string) =>
      Promise.resolve(path === "/api/clubs/c1" ? club : []),
    );
    renderSetup("/setup?clubId=c1");
    expect(
      await screen.findByRole("heading", { level: 1, name: "Ersten Kalender anlegen" }),
    ).toBeInTheDocument();
  });

  it("starts at step 1 for ?new=1 even if the user has clubs", async () => {
    apiGet.mockImplementation((path: string) =>
      Promise.resolve(path === "/api/clubs" ? [club] : []),
    );
    renderSetup("/setup?new=1");
    expect(
      await screen.findByRole("heading", { level: 1, name: "Willkommen bei Club Calendar" }),
    ).toBeInTheDocument();
    expect(apiGet).not.toHaveBeenCalledWith("/api/clubs");
  });
});

describe("SetupPage restricted club creation", () => {
  it("shows the operator notice instead of the club form", async () => {
    apiGet.mockImplementation((path: string) =>
      Promise.resolve(path === "/api/auth/registration" ? { clubCreationAllowed: false } : []),
    );
    renderSetup("/setup?new=1");
    expect(
      await screen.findByRole("heading", { level: 1, name: "Vereine legt der Betreiber an" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Verein anlegen" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Zu meinen Vereinen" })).toBeInTheDocument();
  });
});
