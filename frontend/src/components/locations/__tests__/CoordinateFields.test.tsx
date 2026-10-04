import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { CoordinateFields } from "../CoordinateFields";

function Harness({
  initial,
  onErrors,
}: {
  initial: [number | null, number | null];
  onErrors?: (errors: { fieldId: string }[]) => void;
}) {
  const [[lat, lng], setPos] = useState(initial);
  return (
    <CoordinateFields
      latitude={lat}
      longitude={lng}
      onChange={(a, b) => setPos([a, b])}
      onErrorsChange={onErrors}
    />
  );
}

describe("CoordinateFields", () => {
  it("opens for a saved position and stays open while text that is no number is typed", async () => {
    const user = userEvent.setup();
    const { container } = render(<Harness initial={[48.1371, 11.5754]} />);
    const details = container.querySelector("details")!;
    expect(details.open).toBe(true);
    // Typing a letter empties the value (null); the fields must not collapse under the cursor.
    await user.clear(screen.getByLabelText("Breitengrad"));
    await user.type(screen.getByLabelText("Breitengrad"), "x");
    expect(details.open).toBe(true);
    expect(screen.getByLabelText("Breitengrad")).toHaveAttribute("aria-invalid", "true");
  });

  it("starts closed without a position and reports the invalid fields", async () => {
    const user = userEvent.setup();
    const onErrors = vi.fn();
    const { container } = render(<Harness initial={[null, null]} onErrors={onErrors} />);
    expect(container.querySelector("details")!.open).toBe(false);
    await user.click(screen.getByText("Koordinaten von Hand eingeben"));
    await user.type(screen.getByLabelText("Längengrad"), "181");
    const last = onErrors.mock.calls.at(-1)![0] as { fieldId: string }[];
    expect(last.map((e) => e.fieldId)).toEqual(["pl-lng"]);
  });
});
