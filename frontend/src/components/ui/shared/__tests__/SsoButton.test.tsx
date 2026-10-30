import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SsoButton } from "../SsoButton";

describe("SsoButton", () => {
  it.each([
    ["google", "Google", "Mit Google anmelden"],
    ["microsoft", "Microsoft", "Mit Microsoft anmelden"],
    ["apple", "Apple", "Mit Apple anmelden"],
  ])("renders the %s brand link with logo hidden from AT", (id, name, text) => {
    const { container } = render(<SsoButton provider={id} name={name} href="/x" />);
    const link = screen.getByRole("link", { name: text });
    expect(link).toHaveAttribute("href", "/x");
    expect(link).toHaveClass(`cc-sso--${id}`);
    expect(container.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
  });

  it("falls back to a generic button for unknown providers", () => {
    render(<SsoButton provider="other" name="Other" href="/y" />);
    expect(screen.getByRole("link", { name: "Mit Other anmelden" })).toHaveAttribute("href", "/y");
  });
});
