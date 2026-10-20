import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Button } from "../Button";

describe("Button loading", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("sets aria-busy at once but shows the spinner only after the delay", () => {
    const { container } = render(<Button loading>Speichern</Button>);
    const button = screen.getByRole("button", { name: "Speichern" });
    expect(button).toHaveAttribute("aria-busy", "true");
    expect(button).toBeDisabled();
    expect(container.querySelector(".animate-spin")).toBeNull();
    act(() => vi.advanceTimersByTime(200));
    expect(container.querySelector(".animate-spin")).not.toBeNull();
  });
});
