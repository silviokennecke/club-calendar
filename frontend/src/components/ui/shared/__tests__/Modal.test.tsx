import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { Modal, ModalFrame, useModalInitialFocus } from "../Modal";

function Form() {
  useModalInitialFocus("m-name");
  return (
    <form>
      <label htmlFor="m-name">Name</label>
      <input id="m-name" />
      <button type="submit">Speichern</button>
    </form>
  );
}

describe("Modal", () => {
  it("is a labelled, described modal dialog with a named close button", async () => {
    const onClose = vi.fn();
    render(
      <>
        <button type="button">Draußen</button>
        <Modal
          title="Termin anlegen"
          subtitle="Wie möchtest du starten?"
          closeLabel="Schließen"
          onClose={onClose}
        >
          <p>Inhalt</p>
        </Modal>
      </>,
    );
    const dialog = await screen.findByRole("dialog", { name: "Termin anlegen" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAccessibleDescription("Wie möchtest du starten?");
    expect(within(dialog).getByRole("heading", { level: 1 })).toHaveTextContent("Termin anlegen");
    // Everything else is hidden from assistive technology.
    expect(screen.queryByRole("button", { name: "Draußen" })).toBeNull();
    await waitFor(() => expect(within(dialog).getByRole("heading", { level: 1 })).toHaveFocus());

    const user = userEvent.setup();
    await user.click(within(dialog).getByRole("button", { name: "Schließen" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("starts a form in its first field", async () => {
    render(
      <Modal title="Neuer Termin" closeLabel="Schließen" onClose={() => undefined} form size="xl">
        <Form />
      </Modal>,
    );
    const dialog = await screen.findByRole("dialog", { name: "Neuer Termin" });
    expect(dialog).toHaveClass("ap-dialog", "ap-dialog--xl", "ap-dialog--form");
    await waitFor(() => expect(screen.getByLabelText("Name")).toHaveFocus());
  });

  it("keeps one dialog across steps and moves focus to the new heading", async () => {
    function Steps() {
      const [step, setStep] = useState(1);
      return (
        <ModalFrame>
          {step === 1 ? (
            <Modal
              title="Schritt eins"
              closeLabel="Schließen"
              onClose={() => undefined}
              size="wide"
            >
              <button type="button" onClick={() => setStep(2)}>
                Weiter
              </button>
            </Modal>
          ) : (
            <Modal title="Schritt zwei" closeLabel="Schließen" onClose={() => undefined}>
              <p>Zwei</p>
            </Modal>
          )}
        </ModalFrame>
      );
    }
    const user = userEvent.setup();
    render(<Steps />);
    const dialog = await screen.findByRole("dialog", { name: "Schritt eins" });
    expect(dialog).toHaveClass("ap-dialog--wide");
    await user.click(screen.getByRole("button", { name: "Weiter" }));
    expect(await screen.findByRole("dialog", { name: "Schritt zwei" })).toBe(dialog);
    expect(dialog).not.toHaveClass("ap-dialog--wide");
    await waitFor(() =>
      expect(screen.getByRole("heading", { level: 1, name: "Schritt zwei" })).toHaveFocus(),
    );
  });
});
