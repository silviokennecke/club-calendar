import { afterEach, describe, expect, it, vi } from "vitest";
import { ENTER_CAP, enterListRef, enterTableRef, markEnter, playPageEnter } from "../pageMotion";

function list(count: number) {
  const ul = document.createElement("ul");
  for (let i = 0; i < count; i++) ul.appendChild(document.createElement("li"));
  return ul;
}

function reduced(value: boolean) {
  vi.stubGlobal("matchMedia", () => ({ matches: value }));
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("list entrance", () => {
  it("marks only the first rows with an increasing index", () => {
    reduced(false);
    const ul = list(25);
    enterListRef(ul);
    const marked = ul.querySelectorAll("[data-enter-i]");
    expect(marked).toHaveLength(ENTER_CAP);
    expect((marked[3] as HTMLElement).style.getPropertyValue("--i")).toBe("3");
  });

  it("clears the marks after the animation and leaves later rows alone", () => {
    reduced(false);
    vi.useFakeTimers();
    const ul = list(3);
    enterListRef(ul);
    ul.appendChild(document.createElement("li"));
    vi.advanceTimersByTime(500);
    expect(ul.querySelector("[data-enter-i]")).toBeNull();
    expect((ul.children[0] as HTMLElement).style.getPropertyValue("--i")).toBe("");
  });

  it("does nothing under reduced motion", () => {
    reduced(true);
    const ul = list(3);
    markEnter(ul.children);
    expect(ul.querySelector("[data-enter-i]")).toBeNull();
  });

  it("table: rows of the first body only", () => {
    reduced(false);
    document.body.innerHTML =
      "<table><tbody><tr></tr><tr></tr></tbody><tbody><tr></tr></tbody></table>";
    enterTableRef(document.querySelector("table"));
    expect(document.querySelectorAll("[data-enter-i]")).toHaveLength(2);
  });
});

describe("playPageEnter", () => {
  it("animates opacity and transform, not under reduced motion", () => {
    const el = document.createElement("main");
    const animate = vi.fn();
    Object.assign(el, { animate, getAnimations: () => [] });
    reduced(true);
    playPageEnter(el);
    expect(animate).not.toHaveBeenCalled();
    reduced(false);
    playPageEnter(el);
    expect(animate).toHaveBeenCalledTimes(1);
    expect(animate.mock.calls[0][1].duration).toBe(160);
  });
});
