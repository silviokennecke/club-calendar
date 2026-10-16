import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CodeInput } from "../CodeInput";

const onComplete = vi.fn();

function Harness({ disabled, invalid }: { disabled?: boolean; invalid?: boolean }) {
  const [value, setValue] = useState("");
  return (
    <CodeInput
      label="Code"
      value={value}
      onChange={setValue}
      onComplete={onComplete}
      disabled={disabled}
      invalid={invalid}
    />
  );
}

const fields = () => screen.getAllByRole("textbox") as HTMLInputElement[];
const values = () =>
  fields()
    .map((f) => f.value)
    .join("");

describe("CodeInput", () => {
  it("renders six labelled digit fields in a named group with a dash between the triples", () => {
    const { container } = render(<Harness />);
    expect(screen.getByRole("group", { name: "Code" })).toBeInTheDocument();
    expect(fields()).toHaveLength(6);
    expect(fields()[0]).toHaveAccessibleName("Ziffer 1 von 6");
    expect(fields()[5]).toHaveAccessibleName("Ziffer 6 von 6");
    expect(fields()[0]).toHaveAttribute("autocomplete", "one-time-code");
    expect(fields()[1]).toHaveAttribute("autocomplete", "off");
    expect(fields()[0]).toHaveAttribute("inputmode", "numeric");
    expect(container.querySelectorAll('[aria-hidden="true"]')).toHaveLength(1);
    expect(fields()[3].previousElementSibling).toHaveTextContent("-");
  });

  it("advances while typing, ignores non-digits and submits when complete", async () => {
    const user = userEvent.setup();
    onComplete.mockClear();
    render(<Harness />);
    await user.click(fields()[0]);
    await user.keyboard("1a23");
    expect(values()).toBe("123");
    expect(fields()[3]).toHaveFocus();
    expect(onComplete).not.toHaveBeenCalled();
    await user.keyboard("456");
    expect(values()).toBe("123456");
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onComplete).toHaveBeenCalledWith("123456");
  });

  it("moves back and clears with backspace", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(fields()[0]);
    await user.keyboard("12");
    expect(fields()[2]).toHaveFocus();
    await user.keyboard("{Backspace}");
    expect(values()).toBe("1");
    expect(fields()[1]).toHaveFocus();
    await user.keyboard("{Backspace}");
    expect(values()).toBe("");
    expect(fields()[0]).toHaveFocus();
  });

  it("moves with the arrow keys", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(fields()[2]);
    await user.keyboard("{ArrowRight}");
    expect(fields()[3]).toHaveFocus();
    await user.keyboard("{ArrowLeft}{ArrowLeft}");
    expect(fields()[1]).toHaveFocus();
  });

  it.each(["123456", "123 456", "123-456", " 123 - 456 \n"])(
    "fills all fields from the paste %j",
    async (text) => {
      const user = userEvent.setup();
      onComplete.mockClear();
      render(<Harness />);
      await user.click(fields()[2]);
      await user.paste(text);
      expect(values()).toBe("123456");
      expect(onComplete).toHaveBeenCalledTimes(1);
      expect(onComplete).toHaveBeenCalledWith("123456");
    },
  );

  it("fills all fields from browser autofill into the first field", () => {
    onComplete.mockClear();
    render(<Harness />);
    fireEvent.change(fields()[0], { target: { value: "654321" } });
    expect(values()).toBe("654321");
    expect(onComplete).toHaveBeenCalledWith("654321");
  });

  it("replaces a digit typed over a filled field", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(fields()[0]);
    await user.keyboard("12");
    await user.click(fields()[0]);
    await user.keyboard("9");
    expect(values()).toBe("92");
  });

  it("marks the fields invalid and can be disabled", () => {
    const { rerender } = render(<Harness invalid />);
    for (const f of fields()) expect(f).toHaveAttribute("aria-invalid", "true");
    rerender(<Harness disabled />);
    for (const f of fields()) expect(f).toBeDisabled();
  });
});
