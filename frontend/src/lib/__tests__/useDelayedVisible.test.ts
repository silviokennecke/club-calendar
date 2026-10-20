import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useDelayedVisible } from "../useDelayedVisible";

describe("useDelayedVisible", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("never shows for an operation shorter than the delay", () => {
    const { result, rerender } = renderHook(({ on }) => useDelayedVisible(on, 150, 300), {
      initialProps: { on: true },
    });
    act(() => vi.advanceTimersByTime(100));
    rerender({ on: false });
    act(() => vi.advanceTimersByTime(1000));
    expect(result.current).toBe(false);
  });

  it("shows after the delay and stays for the minimum time", () => {
    const { result, rerender } = renderHook(({ on }) => useDelayedVisible(on, 150, 300), {
      initialProps: { on: true },
    });
    act(() => vi.advanceTimersByTime(150));
    expect(result.current).toBe(true);
    act(() => vi.advanceTimersByTime(50));
    rerender({ on: false });
    act(() => vi.advanceTimersByTime(249));
    expect(result.current).toBe(true);
    act(() => vi.advanceTimersByTime(2));
    expect(result.current).toBe(false);
  });

  it("hides at once when shown longer than the minimum", () => {
    const { result, rerender } = renderHook(({ on }) => useDelayedVisible(on, 150, 300), {
      initialProps: { on: true },
    });
    act(() => vi.advanceTimersByTime(600));
    rerender({ on: false });
    act(() => vi.advanceTimersByTime(1));
    expect(result.current).toBe(false);
  });
});
