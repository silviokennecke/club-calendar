import { afterEach, describe, expect, it, vi } from "vitest";
import { focusAfterDialog } from "../focus";

describe("focusAfterDialog", () => {
  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = "";
  });

  it("focuses the heading when focus fell back to the page", () => {
    vi.useFakeTimers();
    document.body.innerHTML = '<h2 id="h" tabindex="-1">Titel</h2>';
    focusAfterDialog("h");
    vi.runAllTimers();
    expect(document.activeElement).toBe(document.getElementById("h"));
  });

  it("leaves focus alone when the user already moved on", () => {
    vi.useFakeTimers();
    document.body.innerHTML = '<h2 id="h" tabindex="-1">Titel</h2><input id="i" />';
    focusAfterDialog("h");
    document.getElementById("i")?.focus();
    vi.runAllTimers();
    expect(document.activeElement).toBe(document.getElementById("i"));
  });
});
