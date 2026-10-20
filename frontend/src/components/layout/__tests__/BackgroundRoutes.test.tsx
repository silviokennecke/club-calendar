import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  RouterProvider,
  Route,
  createMemoryRouter,
  createRoutesFromElements,
} from "react-router-dom";
import { BackgroundRoutes } from "../BackgroundRoutes";
import { Modal, ModalFrame } from "@/components/ui/shared";

const EXIT_MS = 100;

function setup() {
  const router = createMemoryRouter(
    createRoutesFromElements(
      <Route
        path="*"
        element={
          <BackgroundRoutes
            pages={<Route path="/" element={<p>Seite</p>} />}
            modals={
              <Route element={<ModalFrame />}>
                <Route
                  path="/privacy"
                  element={
                    <Modal title="Datenschutz" closeLabel="Schließen" onClose={() => undefined}>
                      <p>Inhalt</p>
                    </Modal>
                  }
                />
              </Route>
            }
          />
        }
      />,
    ),
    { initialEntries: [{ pathname: "/privacy", state: { background: "/" } }] },
  );
  return router;
}

describe("BackgroundRoutes exit phase", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    Element.prototype.getAnimations = () =>
      [{ finished: new Promise<void>((resolve) => setTimeout(resolve, EXIT_MS)) }] as never;
  });
  afterEach(() => {
    vi.useRealTimers();
    // @ts-expect-error test stub
    delete Element.prototype.getAnimations;
  });

  it("keeps the dialog mounted for the exit duration after the route changed", async () => {
    const router = setup();
    render(<RouterProvider router={router} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });
    expect(screen.getByRole("dialog", { name: "Datenschutz" })).toBeInTheDocument();

    await act(async () => {
      await router.navigate("/");
    });
    expect(router.state.location.pathname).toBe("/");
    expect(screen.getByText("Seite")).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Datenschutz" })).toHaveAttribute(
      "data-ending-style",
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(EXIT_MS + 20);
    });
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
