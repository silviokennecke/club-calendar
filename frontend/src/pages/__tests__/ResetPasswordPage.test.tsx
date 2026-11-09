import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { ApiError } from "@/lib/api";
import { OpaqueClientError } from "@/lib/opaque";
import ResetPasswordPage from "../ResetPasswordPage";

const apiPost = vi.fn();
vi.mock("@/lib/api", async (orig) => ({
  ...(await orig<typeof import("@/lib/api")>()),
  apiPost: (...a: unknown[]) => apiPost(...a),
}));

const opaqueReset = vi.fn();
vi.mock("@/lib/opaque/client", async (orig) => ({
  ...(await orig<typeof import("@/lib/opaque/client")>()),
  opaqueReset: (...a: unknown[]) => opaqueReset(...a),
}));

const TOKEN = "a".repeat(64);

function Probe() {
  const loc = useLocation();
  return <div data-testid="location">{loc.pathname + loc.search}</div>;
}

function renderReset(path = `/reset-password?token=${TOKEN}`) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route
          path="/reset-password"
          element={
            <>
              <ResetPasswordPage />
              <Probe />
            </>
          }
        />
        <Route path="*" element={<Probe />} />
      </Routes>
    </MemoryRouter>,
  );
}

async function fill(password: string, confirm = password) {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText(/^Neues Passwort/), password);
  await user.type(screen.getByLabelText(/^Passwort wiederholen/), confirm);
  await user.click(screen.getByRole("button", { name: "Passwort speichern" }));
  return user;
}

beforeEach(() => {
  apiPost.mockReset();
  apiPost.mockResolvedValue(undefined);
  // default: OPAQUE is off, so the legacy endpoint is used
  opaqueReset.mockReset();
  opaqueReset.mockRejectedValue(new ApiError("x", 503, "opaque_unavailable"));
});
afterEach(() => {
  document.head.querySelectorAll('meta[name="referrer"]').forEach((m) => m.remove());
});

describe("ResetPasswordPage", () => {
  it("removes the token from the address and sends no referrer", async () => {
    renderReset();
    expect(
      screen.getByRole("heading", { level: 1, name: "Neues Passwort festlegen" }),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByTestId("location")).toHaveTextContent(/^\/reset-password$/),
    );
    expect(document.title).not.toContain(TOKEN);
    expect(document.head.querySelector('meta[name="referrer"]')).toHaveAttribute(
      "content",
      "no-referrer",
    );
  });

  it("sets the new password with the token from the link and leads to the login", async () => {
    renderReset();
    await fill("new-password-1");
    await waitFor(() =>
      expect(apiPost).toHaveBeenCalledWith("/api/auth/reset-password", {
        token: TOKEN,
        password: "new-password-1",
      }),
    );
    expect(
      await screen.findByRole("heading", { level: 1, name: "Passwort gespeichert" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("auf allen Geräten abgemeldet");
    expect(screen.getByRole("link", { name: "Weiter zur Anmeldung" })).toHaveAttribute(
      "href",
      "/login",
    );
  });

  it("resets through OPAQUE when it is available", async () => {
    opaqueReset.mockResolvedValue(undefined);
    renderReset();
    await fill("new-password-1");
    expect(
      await screen.findByRole("heading", { level: 1, name: "Passwort gespeichert" }),
    ).toBeInTheDocument();
    expect(opaqueReset).toHaveBeenCalledWith(TOKEN, "new-password-1");
    expect(apiPost).not.toHaveBeenCalled();
  });

  it("shows an invalid link when the OPAQUE reset rejects the token", async () => {
    opaqueReset.mockRejectedValue(new ApiError("x", 400, "invalid_reset_token", "token"));
    renderReset();
    await fill("new-password-1");
    expect(await screen.findByRole("heading", { level: 1, name: /Link/ })).toBeInTheDocument();
    expect(apiPost).not.toHaveBeenCalled();
  });

  it("explains an unsupported browser and never falls back to the legacy endpoint", async () => {
    opaqueReset.mockRejectedValue(new OpaqueClientError("opaque_unsupported", "no wasm"));
    renderReset();
    await fill("new-password-1");
    expect(await screen.findByText(/unterstützt die sichere Anmeldung nicht/)).toBeInTheDocument();
    expect(apiPost).not.toHaveBeenCalled();
  });

  it("checks the password policy and the repetition before sending", async () => {
    renderReset();
    const user = await fill("short");
    expect(screen.getAllByText(/Das Passwort ist zu kurz/)[0]).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("noch nicht gespeichert");
    expect(screen.getByLabelText(/^Neues Passwort/)).toHaveFocus();
    await user.clear(screen.getByLabelText(/^Neues Passwort/));
    await user.type(screen.getByLabelText(/^Neues Passwort/), "a".repeat(129));
    await user.click(screen.getByRole("button", { name: "Passwort speichern" }));
    expect(screen.getAllByText(/Das Passwort ist zu lang/)[0]).toBeInTheDocument();
    await user.clear(screen.getByLabelText(/^Neues Passwort/));
    await user.type(screen.getByLabelText(/^Neues Passwort/), "new-password-1");
    await user.click(screen.getByRole("button", { name: "Passwort speichern" }));
    expect(screen.getAllByText(/Die Passwörter sind nicht gleich/)[0]).toBeInTheDocument();
    expect(apiPost).not.toHaveBeenCalled();
  });

  it("explains an invalid, used or expired link with a way to a new one", async () => {
    apiPost.mockRejectedValue(new ApiError("x", 400, "invalid_reset_token"));
    renderReset();
    await fill("new-password-1");
    expect(
      await screen.findByRole("heading", {
        level: 1,
        name: "Der Link ist ungültig oder abgelaufen",
      }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Neuen Link anfordern" })).toHaveAttribute(
      "href",
      "/forgot-password",
    );
  });

  it("shows the invalid state without a token", () => {
    renderReset("/reset-password");
    expect(
      screen.getByRole("heading", { level: 1, name: "Der Link ist ungültig oder abgelaufen" }),
    ).toBeInTheDocument();
  });

  it("keeps the form after a network error", async () => {
    apiPost.mockRejectedValue(new TypeError("Failed to fetch"));
    renderReset();
    await fill("new-password-1");
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Das Passwort konnte nicht gespeichert werden",
    );
    expect(screen.getByRole("button", { name: "Passwort speichern" })).toBeEnabled();
  });
});
