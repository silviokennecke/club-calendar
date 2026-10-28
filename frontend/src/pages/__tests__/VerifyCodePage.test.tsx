import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import userEvent from "@testing-library/user-event";
import VerifyCodePage from "../VerifyCodePage";
import { ApiError } from "@/lib/api";
import { renderAt } from "./authTestUtils";

const verifyEmail = vi.fn();
const resendVerification = vi.fn();
const login = vi.fn();
const logout = vi.fn();
const toastSuccess = vi.fn();
const toastError = vi.fn();
let auth: { user: unknown; loading: boolean };

vi.mock("@/lib/api", async () => ({
  ...(await vi.importActual<typeof import("@/lib/api")>("@/lib/api")),
  verifyEmail: (...a: unknown[]) => verifyEmail(...a),
  resendVerification: (...a: unknown[]) => resendVerification(...a),
}));
vi.mock("@/lib/auth-context", () => ({
  useAuth: () => ({ ...auth, login, logout }),
}));
vi.mock("@/components/ui/shared", async () => {
  const actual =
    await vi.importActual<typeof import("@/components/ui/shared")>("@/components/ui/shared");
  return {
    ...actual,
    toast: {
      success: (...a: unknown[]) => toastSuccess(...a),
      error: (...a: unknown[]) => toastError(...a),
    },
  };
});

const restricted = { id: "u1", email: "alex@beispiel.de", emailVerificationRequired: true };
const tokens = { access_token: "a2", refresh_token: "r2", user: { id: "u1" } };

function renderPage() {
  return renderAt(
    "/verify-email",
    "/verify-email",
    <QueryClientProvider client={new QueryClient()}>
      <VerifyCodePage />
    </QueryClientProvider>,
  );
}

async function enter(code: string) {
  const user = userEvent.setup();
  await user.click(screen.getByLabelText("Ziffer 1 von 6"));
  await user.keyboard(code);
  return user;
}

beforeEach(() => {
  vi.clearAllMocks();
  auth = { user: restricted, loading: false };
});

describe("VerifyCodePage", () => {
  it("shows the address of the signed-in user, six fields and a sign-out button", () => {
    renderPage();
    expect(
      screen.getByRole("heading", { level: 1, name: "E-Mail-Adresse bestätigen" }),
    ).toBeInTheDocument();
    expect(screen.getByText("alex@beispiel.de").tagName).toBe("STRONG");
    expect(screen.getAllByRole("textbox")).toHaveLength(6);
    expect(screen.getByRole("button", { name: "Abmelden" })).toBeInTheDocument();
  });

  it("goes to the login when not signed in", () => {
    auth = { user: null, loading: false };
    renderPage();
    expect(screen.getByTestId("location")).toHaveTextContent("/login");
  });

  it("goes to the app when the address is already confirmed", () => {
    auth = { user: { ...restricted, emailVerificationRequired: false }, loading: false };
    renderPage();
    expect(screen.getByTestId("location")).toHaveTextContent("/clubs");
  });

  it("signs out and returns to the login", async () => {
    renderPage();
    await userEvent.setup().click(screen.getByRole("button", { name: "Abmelden" }));
    expect(logout).toHaveBeenCalled();
    expect(await screen.findByTestId("location")).toHaveTextContent("/login");
  });

  it("submits the complete code, stores the new token pair and continues", async () => {
    verifyEmail.mockResolvedValue(tokens);
    renderPage();
    await enter("123456");
    await waitFor(() =>
      expect(login).toHaveBeenCalledWith("a2", "r2", {
        ...restricted,
        ...tokens.user,
        emailVerificationRequired: false,
      }),
    );
    expect(verifyEmail).toHaveBeenCalledWith("123456");
    expect(await screen.findByTestId("location")).toHaveTextContent("/clubs");
  });

  it("shows a field error for a wrong code and clears the fields", async () => {
    verifyEmail.mockRejectedValue(new ApiError("x", 422, "invalid_verification_code", "code"));
    renderPage();
    await enter("111111");
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "falsch, abgelaufen oder aufgebraucht",
    );
    expect(screen.getByLabelText("Ziffer 1 von 6")).toHaveAttribute("aria-invalid", "true");
    await waitFor(() => expect(screen.getByLabelText("Ziffer 1 von 6")).toHaveValue(""));
    expect(login).not.toHaveBeenCalled();
  });

  it("resends the code and confirms with a toast", async () => {
    resendVerification.mockResolvedValue(undefined);
    renderPage();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Erneut senden" }));
    expect(resendVerification).toHaveBeenCalledWith();
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("Ein neuer Code wurde gesendet"));
  });

  it("names the time of the next permitted request when resending is too early", async () => {
    const retryAt = "2026-10-16T12:35:00Z";
    resendVerification.mockRejectedValue(
      new ApiError("x", 429, "verification_resend_too_early", undefined, { retryAt }),
    );
    renderPage();
    await userEvent.setup().click(screen.getByRole("button", { name: "Erneut senden" }));
    const time = new Intl.DateTimeFormat("de", { hour: "2-digit", minute: "2-digit" }).format(
      new Date(retryAt),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      `Du kannst um ${time} Uhr einen neuen Code anfordern.`,
    );
    expect(toastSuccess).not.toHaveBeenCalled();
  });

  it("shows a generic message for rate_limited when resending", async () => {
    resendVerification.mockRejectedValue(new ApiError("x", 429, "rate_limited"));
    renderPage();
    await userEvent.setup().click(screen.getByRole("button", { name: "Erneut senden" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Zu viele Anfragen");
  });
});
