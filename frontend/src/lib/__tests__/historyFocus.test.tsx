import { describe, expect, it } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useNavigate } from "react-router-dom";
import { shouldFocusPageStart, useHistoryFocus } from "../historyFocus";

const CAL = "/clubs/c1/calendars/k1";

describe("shouldFocusPageStart", () => {
  it("only for back / forward between different pages", () => {
    expect(shouldFocusPageStart("POP", "/a", "/b")).toBe(true);
    expect(shouldFocusPageStart("PUSH", "/a", "/b")).toBe(false);
    expect(shouldFocusPageStart("REPLACE", "/a", "/b")).toBe(false);
  });

  it("not for query-only changes (month switch)", () => {
    expect(shouldFocusPageStart("POP", CAL, CAL)).toBe(false);
  });

  it("not when a routed dialog opens or closes", () => {
    expect(shouldFocusPageStart("POP", CAL, `${CAL}/events/new`)).toBe(false);
    expect(shouldFocusPageStart("POP", `${CAL}/events/e1`, CAL)).toBe(false);
    expect(shouldFocusPageStart("POP", "/feed/f1", "/feed/f1/events/e1")).toBe(false);
  });
});

let nav: ReturnType<typeof useNavigate>;
function Shell() {
  nav = useNavigate();
  useHistoryFocus();
  return (
    <main id="main" tabIndex={-1}>
      <Routes>
        <Route path="/a" element={<h1>Seite A</h1>} />
        <Route path="/b" element={<h1>Seite B</h1>} />
      </Routes>
    </main>
  );
}

describe("useHistoryFocus", () => {
  it("focuses the heading after back, not after a normal link navigation", async () => {
    render(
      <MemoryRouter initialEntries={["/a"]}>
        <Shell />
      </MemoryRouter>,
    );
    await act(async () => nav("/b"));
    await new Promise((r) => setTimeout(r, 100));
    expect(screen.getByRole("heading", { name: "Seite B" })).not.toHaveFocus();
    await act(async () => nav(-1));
    await waitFor(() => expect(screen.getByRole("heading", { name: "Seite A" })).toHaveFocus());
  });
});
