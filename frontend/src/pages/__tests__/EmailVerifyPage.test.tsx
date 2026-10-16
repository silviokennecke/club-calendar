import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import EmailVerifyPage from "../EmailVerifyPage";
import { renderAt } from "./authTestUtils";

function renderVerify(search = "") {
  return renderAt(`/auth/verify-email${search}`, "/auth/verify-email", <EmailVerifyPage />);
}

describe("EmailVerifyPage", () => {
  it("confirms a changed address and asks to sign in again", () => {
    renderVerify("?status=email_changed");
    expect(
      screen.getByRole("heading", { level: 1, name: "E-Mail-Adresse geändert" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/auf allen Geräten abgemeldet/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Zur Anmeldung" })).toHaveAttribute("href", "/login");
  });

  it.each([
    ["email_taken", "Die Adresse ist schon vergeben"],
    ["expired", "Der Link ist abgelaufen"],
    ["already_used", "Der Link ist ungültig"],
    ["invalid", "Der Link ist ungültig"],
  ])("explains a failed address change (%s) with a way to the profile", (reason, title) => {
    renderVerify(`?status=error&reason=${reason}&flow=email_change`);
    expect(screen.getByRole("heading", { level: 1, name: title })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Zum Profil" })).toHaveAttribute("href", "/profile");
    expect(screen.queryByText("Neue Bestätigungsmail anfordern")).not.toBeInTheDocument();
  });

  it("sends visitors of the old confirmation page to the code page", () => {
    renderVerify("?email=alex%40beispiel.de");
    expect(screen.getByTestId("location")).toHaveTextContent(
      "/verify-email?email=alex%40beispiel.de",
    );
  });

  it("sends visitors without an address to the login", () => {
    renderVerify("?status=error&reason=expired");
    expect(screen.getByTestId("location")).toHaveTextContent("/login");
  });
});
