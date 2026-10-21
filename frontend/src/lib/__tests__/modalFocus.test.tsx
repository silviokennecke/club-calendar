import { useState } from "react";
import { describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { eventSelector, focusAfterModalClose, useModalFocusReturn } from "../modalFocus";

/** `deepLink`: the dialog is open from the start, nothing on the page had focus (no opener). */
function Page({ deepLink = false }: { deepLink?: boolean }) {
  const [open, setOpen] = useState(deepLink);
  useModalFocusReturn(open);
  return (
    <main id="main" tabIndex={-1}>
      <h1>Oktober 2026</h1>
      <button type="button" onClick={() => setOpen(true)}>
        Öffnen
      </button>
      {open && (
        <button type="button" onClick={() => setOpen(false)}>
          Schließen
        </button>
      )}
    </main>
  );
}

describe("useModalFocusReturn", () => {
  it("returns to the opener when the requested event is not on the page", async () => {
    render(<Page />);
    await userEvent.click(screen.getByRole("button", { name: "Öffnen" }));
    focusAfterModalClose(eventSelector("not-visible"));
    await userEvent.click(screen.getByRole("button", { name: "Schließen" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Öffnen" })).toHaveFocus(), {
      timeout: 2000,
    });
  });

  it("deep link without an opener and an invisible event: focus goes to the page heading, not #main", async () => {
    render(<Page deepLink />);
    focusAfterModalClose(eventSelector("next-month"));
    await userEvent.click(await screen.findByRole("button", { name: "Schließen" }));
    await waitFor(
      () => expect(screen.getByRole("heading", { name: "Oktober 2026" })).toHaveFocus(),
      { timeout: 2000 },
    );
    expect(document.getElementById("main")).not.toHaveFocus();
  });

  it("moves focus off a close button that stays rendered during the exit animation", async () => {
    function Closing() {
      const [open, setOpen] = useState(false);
      useModalFocusReturn(open);
      return (
        <main id="main" tabIndex={-1}>
          <h1>Oktober 2026</h1>
          <button type="button" onClick={() => setOpen(true)}>
            Öffnen
          </button>
          <div role="dialog" aria-label="Termin">
            <button type="button" onClick={() => setOpen(false)}>
              Schließen
            </button>
          </div>
        </main>
      );
    }
    render(<Closing />);
    await userEvent.click(screen.getByRole("button", { name: "Öffnen" }));
    await userEvent.click(screen.getByRole("button", { name: "Schließen" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Öffnen" })).toHaveFocus(), {
      timeout: 2000,
    });
  });
});
