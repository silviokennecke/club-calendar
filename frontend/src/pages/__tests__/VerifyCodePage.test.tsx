import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import VerifyCodePage from "../VerifyCodePage";
import { ApiError } from "@/lib/api";
import { renderAt } from "./authTestUtils";

const apiPost = vi.fn();
const exchange = vi.fn();
const login = vi.fn();
const toastSuccess = vi.fn();
const toastError = vi.fn();

vi.mock("@/lib/api", async () => ({
  ...(await vi.importActual<typeof import("@/lib/api")>("@/lib/api")),
  apiPost: (...a: unknown[]) => apiPost(...a),
  exchangeOneTimeToken: (...a: unknown[]) => exchange(...a),
}));
vi.mock("@/lib/auth-context", () => ({ useAuth: () => ({ login }) }));
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

const tokens = { access_token: "a", refresh_token: "r", user: { id: "u1" } };

function renderPage(path = "/verify-email?email=alex%40beispiel.de") {
  return renderAt(path, "/verify-email", <VerifyCodePage />);
}

async function enter(code: string) {
  const user = userEvent.setup();
  await user.click(screen.getByLabelText("Ziffer 1 von 6"));
  await user.keyboard(code);
  return user;
}

beforeEach(() => vi.clearAllMocks());

describe("VerifyCodePage", () => {
  it("shows the target address, six fields and a way back to the login", () => {
    renderPage();
    expect(
      screen.getByRole("heading", { level: 1, name: "E-Mail-Adresse bestätigen" }),
    ).toBeInTheDocument();
    expect(screen.getByText("alex@beispiel.de").tagName).toBe("STRONG");
    expect(screen.getAllByRole("textbox")).toHaveLength(6);
    expect(screen.getByRole("link", { name: "Zurück zur Anmeldung" })).toHaveAttribute(
      "href",
      "/login",
    );
  });

  it("goes to the login without an address", () => {
    renderPage("/verify-email");
    expect(screen.getByTestId("location")).toHaveTextContent("/login");
  });

  it("submits the complete code, exchanges the login token, signs in and continues", async () => {
    apiPost.mockResolvedValue({ loginToken: "lt", expiresIn: 30 });
    exchange.mockResolvedValue(tokens);
    renderPage();
    await enter("123456");
    await waitFor(() => expect(login).toHaveBeenCalledWith("a", "r", tokens.user));
    expect(apiPost).toHaveBeenCalledWith("/api/auth/verify-email", {
      email: "alex@beispiel.de",
      code: "123456",
    });
    expect(exchange).toHaveBeenCalledWith("lt");
    expect(await screen.findByTestId("location")).toHaveTextContent("/clubs");
  });

  it("shows a field error for a wrong code and clears the fields", async () => {
    apiPost.mockRejectedValue(new ApiError("x", 422, "invalid_verification_code", "code"));
    renderPage();
    await enter("111111");
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "falsch, abgelaufen oder aufgebraucht",
    );
    expect(screen.getByLabelText("Ziffer 1 von 6")).toHaveAttribute("aria-invalid", "true");
    expect(exchange).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByLabelText("Ziffer 1 von 6")).toHaveValue(""));
    expect(login).not.toHaveBeenCalled();
  });

  it("reports invalid_grant and returns to the login", async () => {
    apiPost.mockResolvedValue({ loginToken: "lt" });
    exchange.mockRejectedValue(new ApiError("x", 400, "invalid_grant"));
    renderPage();
    await enter("123456");
    expect(await screen.findByTestId("location")).toHaveTextContent("/login");
    expect(toastError).toHaveBeenCalled();
    expect(login).not.toHaveBeenCalled();
  });

  it("resends the code and confirms with a toast", async () => {
    apiPost.mockResolvedValue(undefined);
    renderPage();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Erneut senden" }));
    expect(apiPost).toHaveBeenCalledWith("/api/auth/resend-verification", {
      email: "alex@beispiel.de",
    });
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("Ein neuer Code wurde gesendet"));
  });

  it("names the time of the next permitted request when resending is too early", async () => {
    const retryAt = "2026-10-16T12:35:00Z";
    apiPost.mockRejectedValue(
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
    apiPost.mockRejectedValue(new ApiError("x", 429, "rate_limited"));
    renderPage();
    await userEvent.setup().click(screen.getByRole("button", { name: "Erneut senden" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Zu viele Anfragen");
  });
});
