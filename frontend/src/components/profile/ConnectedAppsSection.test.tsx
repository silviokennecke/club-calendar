import { beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ConnectedAppsSection } from "./ConnectedAppsSection";

const apiGet = vi.fn();
const apiDelete = vi.fn();
vi.mock("@/lib/api", async (orig) => ({
  ...(await orig<typeof import("@/lib/api")>()),
  apiGet: (...a: unknown[]) => apiGet(...a),
  apiDelete: (...a: unknown[]) => apiDelete(...a),
}));
vi.mock("@/lib/auth-context", () => ({
  useAuth: () => ({ user: { dateFormat: "dd.MM.yyyy" } }),
}));

const grants = [
  {
    id: "g1",
    clientName: "Claude",
    family: "claude",
    scopes: ["mcp:read", "mcp:write"],
    createdAt: "2026-10-01T10:00:00Z",
    lastUsedAt: "2026-10-20T10:00:00Z",
  },
  {
    id: "g2",
    clientName: "Skript",
    family: null,
    scopes: ["mcp:read"],
    createdAt: "2026-10-02T10:00:00Z",
    lastUsedAt: null,
  },
];

function renderSection() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ConnectedAppsSection />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  apiGet.mockResolvedValue(grants);
  apiDelete.mockResolvedValue(undefined);
});

describe("ConnectedAppsSection", () => {
  it("lists grants with rights and last use", async () => {
    renderSection();
    expect(await screen.findByText("Claude")).toBeInTheDocument();
    expect(apiGet).toHaveBeenCalledWith("/api/auth/mcp-grants");
    expect(screen.getByText("Lesen und Entwürfe")).toBeInTheDocument();
    expect(screen.getByText("Nur lesen")).toBeInTheDocument();
    expect(screen.getByText(/Zuletzt genutzt am 20\.10\.2026/)).toBeInTheDocument();
    expect(screen.getByText(/Noch nie genutzt/)).toBeInTheDocument();
  });

  it("shows an empty state", async () => {
    apiGet.mockResolvedValue([]);
    renderSection();
    expect(await screen.findByText("Keine verbundenen Apps")).toBeInTheDocument();
  });

  it("shows an error with retry", async () => {
    apiGet.mockRejectedValueOnce(new Error("x"));
    renderSection();
    await userEvent.click(await screen.findByRole("button", { name: "Erneut versuchen" }));
    expect(await screen.findByText("Claude")).toBeInTheDocument();
  });

  it("revokes after confirmation", async () => {
    renderSection();
    await userEvent.click(await screen.findByRole("button", { name: "Claude trennen" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(apiDelete).not.toHaveBeenCalled();
    await userEvent.click(within(dialog).getByRole("button", { name: "Trennen" }));
    await waitFor(() => expect(apiDelete).toHaveBeenCalledWith("/api/auth/mcp-grants/g1"));
  });
});
