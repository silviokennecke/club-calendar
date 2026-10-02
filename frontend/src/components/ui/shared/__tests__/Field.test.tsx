import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Field, TextInput } from "..";

describe("Field", () => {
  it("links label, hint and control", () => {
    render(
      <Field label="Gerätename" hint="Optional. Hilft dir beim Wiedererkennen.">
        <TextInput />
      </Field>,
    );
    const input = screen.getByLabelText("Gerätename");
    expect(input).toHaveAccessibleDescription("Optional. Hilft dir beim Wiedererkennen.");
    expect(input).not.toHaveAttribute("aria-invalid");
  });

  it("marks errors with aria-invalid and describes them", () => {
    render(
      <Field label="Name" required error="Bitte einen Namen eingeben.">
        <TextInput />
      </Field>,
    );
    const input = screen.getByLabelText(/Name/);
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAttribute("aria-required", "true");
    expect(input).toHaveAccessibleDescription("Bitte einen Namen eingeben.");
    expect(screen.getByText("(Pflicht)")).toBeInTheDocument();
  });

  it("supports a render function for composite controls", () => {
    render(
      <Field label="Vereinsname" hint="Wird öffentlich angezeigt.">
        {(control) => (
          <div>
            <input {...control} />
            <button type="button">Speichern</button>
          </div>
        )}
      </Field>,
    );
    expect(screen.getByLabelText("Vereinsname")).toHaveAccessibleDescription(
      "Wird öffentlich angezeigt.",
    );
  });

  it("renders a labelled group in group mode", () => {
    render(
      <Field group label="Sichtbarkeit">
        <button type="button">Öffentlich</button>
        <button type="button">Privat</button>
      </Field>,
    );
    expect(screen.getByRole("group", { name: "Sichtbarkeit" })).toBeInTheDocument();
  });
});
