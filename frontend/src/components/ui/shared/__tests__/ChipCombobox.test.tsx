import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ChipCombobox } from "..";
import { sortSuggestions } from "../sortSuggestions";

const OPTIONS = ["01", "02", "03", "04", "05", "06", "07"].map((id) => ({
  id,
  label: `Option ${id}`,
}));

describe("sortSuggestions", () => {
  it("puts recent first, then id descending, ignoring unknown ids", () => {
    const sorted = sortSuggestions(OPTIONS.slice(0, 4), ["03", "gone", "01"]);
    expect(sorted.map((o) => o.id)).toEqual(["03", "01", "04", "02"]);
  });
});

describe("ChipCombobox", () => {
  it("lists five suggestions for an empty input in recency order", async () => {
    render(
      <ChipCombobox
        label="Extras"
        addLabel="Add"
        options={OPTIONS}
        selected={["07"]}
        onChange={() => {}}
        recent={["02", "05"]}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Add" }));
    const items = within(screen.getByRole("listbox")).getAllByRole("option");
    expect(items.map((i) => i.textContent)).toEqual([
      "Option 02",
      "Option 05",
      "Option 06",
      "Option 04",
      "Option 03",
    ]);
  });
});
