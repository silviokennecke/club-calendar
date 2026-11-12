import { beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ApiError } from "@/lib/api";
import { MfaSection } from "./MfaSection";
import type { ProfileData } from "./profileTypes";

const apiPost = vi.fn();
const apiPatch = vi.fn();
const apiDelete = vi.fn();
const login = vi.fn();
vi.mock("@/lib/api", async (orig) => ({
  ...(await orig<typeof import("@/lib/api")>()),
  apiPost: (...a: unknown[]) => apiPost(...a),
  apiPatch: (...a: unknown[]) => apiPatch(...a),
  apiDelete: (...a: unknown[]) => apiDelete(...a),
}));
vi.mock("@/lib/auth-context", () => ({
  useAuth: () => ({ user: { dateFormat: "dd.MM.yyyy" }, login }),
}));
vi.mock("./MfaAddDialog", () => ({
  MfaAddDialog: ({ open }: { open: boolean }) => (open ? <div>add-dialog</div> : null),
}));

const tokens = { access_token: "a", refresh_token: "r", user: { id: "u" } };

function profile(over: Partial<ProfileData> = {}, mfa: Partial<ProfileData["mfa"]> = {}) {
  return {
    id: "u",
    name: "N",
    email: "n@example.org",
    hasPassword: true,
    pendingEmail: null,
    passkeys: [
      { id: "p1", deviceName: "Laptop", createdAt: "2026-10-01T10:00:00Z", lastUsedAt: null },
    ],
    oauthAccounts: [],
    mfa: { enforced: false, totp: null, backupCodes: null, canEnforce: true, ...mfa },
    ...over,
  } as ProfileData;
}

function renderSection(p: ProfileData) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MfaSection profile={p} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  apiPost.mockResolvedValue(undefined);
  apiPatch.mockResolvedValue(undefined);
  apiDelete.mockResolvedValue(tokens);
});

describe("MfaSection", () => {
  it("shows one row per method and always the add button", async () => {
    renderSection(
      profile(
        {},
        {
          enforced: true,
          totp: { createdAt: "2026-10-02T10:00:00Z" },
          backupCodes: { remaining: 7, createdAt: "2026-10-02T10:00:00Z" },
        },
      ),
    );
    expect(screen.getByText("Authenticator-App")).toBeInTheDocument();
    expect(screen.getByText("Laptop")).toBeInTheDocument();
    expect(screen.getByText("Backup-Codes")).toBeInTheDocument();
    expect(screen.getByText("noch 7 Codes übrig")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "MFA-Methode hinzufügen" }));
    expect(screen.getByText("add-dialog")).toBeInTheDocument();
  });

  it.each([
    [2, /Nur noch 2 Backup-Codes übrig/],
    [1, /Nur noch 1 Backup-Code übrig/],
    [0, /Keine Backup-Codes mehr.*Betreiber \(Admin\)/],
  ])("warns persistently when %i backup codes are left", async (remaining, text) => {
    renderSection(profile({}, { backupCodes: { remaining, createdAt: "2026-10-02T10:00:00Z" } }));
    const banner = screen.getByRole("status");
    expect(within(banner).getByText(text)).toBeInTheDocument();
    await userEvent.click(within(banner).getByRole("button", { name: "Neu erzeugen" }));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });

  it("shows no backup code warning with 3 codes left", () => {
    renderSection(
      profile({}, { backupCodes: { remaining: 3, createdAt: "2026-10-02T10:00:00Z" } }),
    );
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("offers enforcing only when not enforced and possible", () => {
    const { unmount } = renderSection(profile());
    expect(screen.getByRole("button", { name: "MFA einschalten" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "MFA ausschalten" })).toBeNull();
    unmount();
    renderSection(profile({}, { canEnforce: false }));
    expect(screen.queryByRole("button", { name: "MFA einschalten" })).toBeNull();
  });

  it("enforces with passkeys: codes, acknowledgement, enable request", async () => {
    apiPost.mockImplementation(async (path: string) =>
      path === "/api/auth/mfa/setup"
        ? { setupToken: "st", backupCodes: ["AAAA-BBBB-CCCC"] }
        : undefined,
    );
    renderSection(profile());
    await userEvent.click(screen.getByRole("button", { name: "MFA einschalten" }));
    expect(await screen.findByText("AAAA-BBBB-CCCC")).toBeInTheDocument();
    expect(apiPost).toHaveBeenCalledWith("/api/auth/mfa/setup", { method: "passkeys" });
    const next = screen.getByRole("button", { name: "Weiter" });
    expect(next).toBeDisabled();
    await userEvent.click(screen.getByLabelText("Ich habe die Backup-Codes aufbewahrt."));
    await userEvent.click(next);
    const dialog = await screen.findByRole("dialog");
    await userEvent.click(within(dialog).getByRole("button", { name: "MFA einschalten" }));
    await waitFor(() =>
      expect(apiPost).toHaveBeenCalledWith("/api/auth/mfa/enable", {
        setupToken: "st",
        method: "passkeys",
        backupCodes: ["AAAA-BBBB-CCCC"],
        backupCodesAcknowledged: true,
      }),
    );
  });

  it("disable replaces enforce, explains, disables and stores the tokens", async () => {
    apiPost.mockResolvedValue(tokens);
    renderSection(profile({}, { enforced: true, totp: { createdAt: "2026-10-02T10:00:00Z" } }));
    expect(screen.queryByRole("button", { name: "MFA einschalten" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "MFA ausschalten" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/Authenticator-App und die Backup-Codes/)).toBeInTheDocument();
    expect(within(dialog).getByText("Deine Passkeys bleiben erhalten.")).toBeInTheDocument();
    expect(within(dialog).getByText("Alle anderen Geräte werden abgemeldet.")).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole("button", { name: "MFA ausschalten" }));
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith("/api/auth/mfa/disable", {}));
    await waitFor(() => expect(login).toHaveBeenCalledWith("a", "r", tokens.user));
  });

  it("deleting a passkey (confirmation by step-up) and adopts the new tokens", async () => {
    renderSection(profile());
    await userEvent.click(screen.getByRole("button", { name: "Passkey „Laptop“ entfernen" }));
    const dialog = await screen.findByRole("dialog");
    await userEvent.click(within(dialog).getByRole("button", { name: "Passkey entfernen" }));
    await waitFor(() => expect(apiDelete).toHaveBeenCalledWith("/api/auth/webauthn/p1"));
    await waitFor(() => expect(login).toHaveBeenCalled());
  });

  it("shows a message for mfa_last_passkey", async () => {
    apiDelete.mockRejectedValue(new ApiError("x", 422, "mfa_last_passkey"));
    renderSection(profile());
    await userEvent.click(screen.getByRole("button", { name: "Passkey „Laptop“ entfernen" }));
    const dialog = await screen.findByRole("dialog");
    await userEvent.click(within(dialog).getByRole("button", { name: "Passkey entfernen" }));
    expect(await within(dialog).findByText(/letzten Passkey nicht entfernen/)).toBeInTheDocument();
  });

  it("renames a passkey without re-authentication", async () => {
    renderSection(profile());
    await userEvent.click(screen.getByRole("button", { name: "Passkey „Laptop“ umbenennen" }));
    const input = screen.getByLabelText("Name des Passkeys");
    await userEvent.clear(input);
    await userEvent.type(input, "Büro");
    await userEvent.click(screen.getByRole("button", { name: "Speichern" }));
    await waitFor(() =>
      expect(apiPatch).toHaveBeenCalledWith("/api/auth/webauthn/p1", { deviceName: "Büro" }),
    );
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("regenerates backup codes and shows them once", async () => {
    apiPost.mockResolvedValue({ backupCodes: ["1111-2222-3333"], mfa: {} });
    renderSection(
      profile(
        {},
        { enforced: true, backupCodes: { remaining: 3, createdAt: "2026-10-02T10:00:00Z" } },
      ),
    );
    await userEvent.click(screen.getByRole("button", { name: "Neu erzeugen" }));
    const dialog = await screen.findByRole("dialog");
    await userEvent.click(within(dialog).getByRole("button", { name: "Codes erzeugen" }));
    expect(await screen.findByText("1111-2222-3333")).toBeInTheDocument();
    expect(apiPost).toHaveBeenCalledWith("/api/auth/mfa/backup-codes", {});
  });
});
