import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { toast } from "sonner";
import { ApiError } from "@/lib/api";
import { announceBackupCodeUsed, dismissBackupCodeNotice } from "@/lib/backupCodeNotice";
import { BackupCodeNotice } from "./BackupCodeNotice";

const apiPost = vi.fn();
const login = vi.fn();
vi.mock("@/lib/api", async (orig) => ({
  ...(await orig<typeof import("@/lib/api")>()),
  apiPost: (...a: unknown[]) => apiPost(...a),
}));
vi.mock("@/lib/auth-context", () => ({ useAuth: () => ({ login }) }));

const tokens = { access_token: "a2", refresh_token: "r2", user: { id: "u" } };

function mount() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <BackupCodeNotice />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => act(() => dismissBackupCodeNotice()));

describe("BackupCodeNotice", () => {
  it("shows nothing without an announcement", () => {
    mount();
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("shows the remaining codes and signs out the other devices", async () => {
    apiPost.mockResolvedValue(tokens);
    const success = vi.spyOn(toast, "success");
    mount();
    act(() => announceBackupCodeUsed(4));
    expect(await screen.findByText(/Dir bleiben noch 4 Backup-Codes/)).toBeInTheDocument();
    expect(screen.queryByText(/keine Backup-Codes mehr/)).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Andere Geräte abmelden" }));
    await waitFor(() =>
      expect(apiPost).toHaveBeenCalledWith("/api/auth/sessions/sign-out-others", {}),
    );
    await waitFor(() => expect(login).toHaveBeenCalledWith("a2", "r2", tokens.user));
    expect(success).toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
  });

  it("keeps the other devices and does not come back", async () => {
    const { unmount } = mount();
    act(() => announceBackupCodeUsed(3));
    await userEvent.click(await screen.findByRole("button", { name: "Angemeldet lassen" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(apiPost).not.toHaveBeenCalled();
    unmount();
    mount();
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("warns when no codes are left", async () => {
    mount();
    act(() => announceBackupCodeUsed(0));
    expect(await screen.findByText(/Du hast keine Backup-Codes mehr/)).toBeInTheDocument();
    expect(screen.getByText(/Betreiber \(Admin\)/)).toBeInTheDocument();
  });

  it("shows the rate limit text when signing out fails", async () => {
    apiPost.mockRejectedValue(
      new ApiError("slow", 429, "rate_limited", undefined, { retryAfter: 120 }),
    );
    const error = vi.spyOn(toast, "error");
    mount();
    act(() => announceBackupCodeUsed(5));
    await userEvent.click(await screen.findByRole("button", { name: "Andere Geräte abmelden" }));
    await waitFor(() => expect(error).toHaveBeenCalledWith(expect.stringMatching(/2 Min\./)));
    expect(login).not.toHaveBeenCalled();
  });
});
