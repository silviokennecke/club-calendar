import { describe, expect, it } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useNavigate } from "react-router-dom";
import { shouldFocusPageStart, useHistoryFocus } from "../historyFocus";

const CAL = "/clubs/c1/calendars/k1";

describe("shouldFocusPageStart", () => {
  it("for every navigation between different pages", () => {
    expect(shouldFocusPageStart("/a", "/b")).toBe(true);
  });

  it("not for query-only changes (month switch)", () => {
    expect(shouldFocusPageStart(CAL, CAL)).toBe(false);
  });

  it("not when a routed dialog opens or closes", () => {
    expect(shouldFocusPageStart(CAL, `${CAL}/events/new/form`)).toBe(false);
    expect(shouldFocusPageStart(`${CAL}/events/e1`, CAL)).toBe(false);
    expect(shouldFocusPageStart("/feed/f1", "/feed/f1/events/e1")).toBe(false);
  });
});

function Field() {
  return (
    <>
      <h1>Seite C</h1>
      <input aria-label="Feld" ref={(el) => el?.focus()} />
    </>
  );
}

let nav: ReturnType<typeof useNavigate>;
function Shell() {
  nav = useNavigate();
  useHistoryFocus();
  return (
    <main id="main" tabIndex={-1}>
      <Routes>
        <Route path="/a" element={<h1>Seite A</h1>} />
        <Route path="/b" element={<h1>Seite B</h1>} />
        <Route path="/c" element={<Field />} />
      </Routes>
    </main>
  );
}

describe("useHistoryFocus", () => {
  it("focuses the heading after a link navigation and after back", async () => {
    render(
      <MemoryRouter initialEntries={["/a"]}>
        <Shell />
      </MemoryRouter>,
    );
    await act(async () => nav("/b"));
    await waitFor(() => expect(screen.getByRole("heading", { name: "Seite B" })).toHaveFocus());
    await act(async () => nav(-1));
    await waitFor(() => expect(screen.getByRole("heading", { name: "Seite A" })).toHaveFocus());
  });

  it("focuses the heading after a replace and keeps focus a page set itself", async () => {
    render(
      <MemoryRouter initialEntries={["/a"]}>
        <Shell />
      </MemoryRouter>,
    );
    await act(async () => nav("/b", { replace: true }));
    await waitFor(() => expect(screen.getByRole("heading", { name: "Seite B" })).toHaveFocus());
    await act(async () => nav("/c"));
    await waitFor(() => expect(screen.getByLabelText("Feld")).toHaveFocus());
  });
});
