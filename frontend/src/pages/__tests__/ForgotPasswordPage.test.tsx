import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ForgotPasswordPage from "../ForgotPasswordPage";
import { renderAt } from "./authTestUtils";

describe("ForgotPasswordPage", () => {
  it("shows the form with a disabled submit and a 'coming soon' notice", async () => {
    const user = userEvent.setup();
    renderAt("/forgot-password", "/forgot-password", <ForgotPasswordPage />);
    expect(
      screen.getByRole("heading", { level: 1, name: "Passwort vergessen?" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Bald verfügbar");
    const submit = screen.getByRole("button", { name: "Link zum Zurücksetzen senden" });
    expect(submit).toBeDisabled();
    expect(submit).toHaveAccessibleDescription(/noch nicht freigeschaltet/);
    await user.type(screen.getByLabelText(/^E-Mail/), "alex@beispiel.de");
    expect(submit).toBeDisabled();
    expect(screen.getByRole("link", { name: "Zurück zur Anmeldung" })).toHaveAttribute(
      "href",
      "/login",
    );
  });
});
