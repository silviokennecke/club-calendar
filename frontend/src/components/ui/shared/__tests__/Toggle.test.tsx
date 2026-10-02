import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Toggle } from "..";

describe("Toggle", () => {
  it("is a labelled switch with a description", () => {
    render(<Toggle label="Termin veröffentlichen" hint="Gäste sehen veröffentlichte Termine." />);
    const sw = screen.getByRole("switch", { name: "Termin veröffentlichen" });
    expect(sw).toHaveAttribute("aria-checked", "false");
    expect(sw).toHaveAccessibleDescription("Gäste sehen veröffentlichte Termine.");
  });

  it("toggles uncontrolled state and reports changes", async () => {
    const onChange = vi.fn();
    render(<Toggle label="Ganztägig" onChange={onChange} />);
    const sw = screen.getByRole("switch", { name: "Ganztägig" });
    await userEvent.click(sw);
    expect(sw).toHaveAttribute("aria-checked", "true");
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it("respects the controlled value", async () => {
    const onChange = vi.fn();
    render(<Toggle label="Öffentlich" checked onChange={onChange} />);
    const sw = screen.getByRole("switch", { name: "Öffentlich" });
    await userEvent.click(sw);
    expect(onChange).toHaveBeenCalledWith(false);
    expect(sw).toHaveAttribute("aria-checked", "true");
  });

  it("can be operated with the keyboard", async () => {
    render(<Toggle label="Privat" />);
    const sw = screen.getByRole("switch", { name: "Privat" });
    sw.focus();
    await userEvent.keyboard(" ");
    expect(sw).toHaveAttribute("aria-checked", "true");
  });
});
