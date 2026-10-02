import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { StatusBadge, type Status } from "..";

const CASES: Array<[Status, string]> = [
  ["published", "Veröffentlicht"],
  ["draft", "Entwurf"],
  ["holiday", "Feiertag"],
  ["archived", "Archiviert"],
  ["new", "Neu"],
  ["private", "Privat"],
  ["public", "Öffentlich"],
  ["danger", "Fehler"],
];

describe("StatusBadge", () => {
  it.each(CASES)("shows %s as a word plus a decorative icon", (status, word) => {
    const { container } = render(<StatusBadge status={status} />);
    const badge = screen.getByText(word);
    expect(badge).toHaveClass("ap-badge", `ap-badge--${status}`);
    const svg = container.querySelector("svg");
    expect(svg).not.toBeNull();
    expect(svg).toHaveAttribute("aria-hidden", "true");
  });

  it("accepts a custom label", () => {
    render(<StatusBadge status="archived" label="Archiviert, schreibgeschützt" />);
    expect(screen.getByText("Archiviert, schreibgeschützt")).toBeInTheDocument();
  });
});
