import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ConfirmDialog } from "..";

function renderDialog(props: Partial<Parameters<typeof ConfirmDialog>[0]> = {}) {
  const onConfirm = vi.fn();
  render(
    <ConfirmDialog
      trigger={<button type="button">Kalender löschen</button>}
      title="Kalender löschen?"
      description="Der Kalender wird dauerhaft entfernt."
      consequence="Löscht 14 Termine und 2 Feeds."
      confirmLabel="Endgültig löschen"
      onConfirm={onConfirm}
      {...props}
    />,
  );
  return { onConfirm };
}

describe("ConfirmDialog", () => {
  it("opens from the trigger and states the consequences", async () => {
    renderDialog();
    await userEvent.click(screen.getByRole("button", { name: "Kalender löschen" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveAccessibleName("Kalender löschen?");
    expect(dialog).toHaveAccessibleDescription("Der Kalender wird dauerhaft entfernt.");
    expect(screen.getByText("Löscht 14 Termine und 2 Feeds.")).toBeInTheDocument();
  });

  it("calls onConfirm and closes", async () => {
    const { onConfirm } = renderDialog();
    await userEvent.click(screen.getByRole("button", { name: "Kalender löschen" }));
    await userEvent.click(await screen.findByRole("button", { name: "Endgültig löschen" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
  });

  it("offers a second way to confirm next to the main action", async () => {
    const alternative = vi.fn();
    const { onConfirm } = renderDialog({
      alternative: { label: "Nur diesen Termin", onConfirm: alternative },
    });
    await userEvent.click(screen.getByRole("button", { name: "Kalender löschen" }));
    const buttons = (await screen.findByRole("alertdialog")).querySelectorAll("button");
    expect([...buttons].map((b) => b.textContent)).toEqual([
      "Abbrechen",
      "Nur diesen Termin",
      "Endgültig löschen",
    ]);
    await waitFor(() => expect(screen.getByRole("button", { name: "Abbrechen" })).toHaveFocus());
    await userEvent.click(screen.getByRole("button", { name: "Nur diesen Termin" }));
    expect(alternative).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
  });

  it("cancel closes without confirming", async () => {
    const { onConfirm } = renderDialog();
    await userEvent.click(screen.getByRole("button", { name: "Kalender löschen" }));
    await userEvent.click(await screen.findByRole("button", { name: "Abbrechen" }));
    expect(onConfirm).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
  });

  it("requires the typed confirmation text when configured", async () => {
    const { onConfirm } = renderDialog({ requireText: "Waldblick" });
    await userEvent.click(screen.getByRole("button", { name: "Kalender löschen" }));
    const confirm = await screen.findByRole("button", { name: "Endgültig löschen" });
    expect(confirm).toBeDisabled();
    await userEvent.type(screen.getByLabelText(/Waldblick/), "Waldblick");
    expect(confirm).toBeEnabled();
    await userEvent.click(confirm);
    expect(onConfirm).toHaveBeenCalled();
  });

  it("styles the consequence as a danger note only for destructive confirmations", async () => {
    const { unmount } = render(
      <ConfirmDialog
        open
        title="Termin löschen?"
        description="Weg."
        consequence="Löscht 1 Termin."
        confirmLabel="Löschen"
        onConfirm={() => {}}
      />,
    );
    expect(await screen.findByText("Löscht 1 Termin.")).not.toHaveClass("ap-consequence--info");
    unmount();
    render(
      <ConfirmDialog
        open
        tone="primary"
        title="Änderungen speichern?"
        description="Für welche Termine?"
        consequence="Alle Termine übernehmen die Änderungen."
        confirmLabel="Alle Termine"
        onConfirm={() => {}}
      />,
    );
    const note = await screen.findByText("Alle Termine übernehmen die Änderungen.");
    expect(note).toHaveClass("ap-consequence", "ap-consequence--info");
  });
});
