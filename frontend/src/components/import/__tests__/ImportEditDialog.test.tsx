import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { ImportEditDialog } from "../ImportEditDialog";
import type { ImportItem } from "@/lib/import";
import type { useEventResources } from "@/components/events/useEventResources";

const item: ImportItem = {
  id: "i1",
  groupKey: "g",
  uid: "",
  name: "Training",
  date: "2026-10-01",
  dateEnd: "",
  isAllDay: false,
  timeBegin: "19:00",
  timeEnd: "21:00",
  timezone: null,
  locationText: "",
  note: "",
  placeOverride: null,
  recurring: false,
  recurrenceKey: null,
  recurrenceUnsupported: false,
  status: "draft",
  propertyIds: [],
  featureIds: [],
  targetGroupIds: [],
  selected: true,
};

const resources = {
  properties: [],
  features: [],
  targetGroups: [],
  locations: [],
} as unknown as ReturnType<typeof useEventResources>;

function setup() {
  const onClose = vi.fn();
  const onSubmit = vi.fn();
  render(
    <MemoryRouter>
      <ImportEditDialog
        target={{ kind: "item", item }}
        items={[item]}
        locations={[]}
        resources={resources}
        onClose={onClose}
        onSubmit={onSubmit}
      />
    </MemoryRouter>,
  );
  return { onClose, onSubmit };
}

describe("ImportEditDialog – unsaved changes", () => {
  it("closes directly while nothing was changed", async () => {
    const user = userEvent.setup();
    const { onClose } = setup();
    await user.click(await screen.findByRole("button", { name: "Abbrechen" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("asks before discarding changes", async () => {
    const user = userEvent.setup();
    const { onClose } = setup();
    const name = await screen.findByLabelText(/^Name/);
    await user.type(name, " 2");
    await user.click(screen.getByRole("button", { name: "Abbrechen" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(onClose).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole("button", { name: "Änderungen verwerfen" }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it("does not ask when applying the changes", async () => {
    const user = userEvent.setup();
    const { onSubmit } = setup();
    await user.type(await screen.findByLabelText(/^Name/), " 2");
    await user.click(screen.getByRole("button", { name: "Änderungen übernehmen" }));
    expect(onSubmit).toHaveBeenCalled();
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });
});
