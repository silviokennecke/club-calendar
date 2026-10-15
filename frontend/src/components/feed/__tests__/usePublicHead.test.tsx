import { afterEach, describe, expect, it } from "vitest";
import { renderHook } from "@testing-library/react";
import { usePublicHead } from "../usePublicHead";

const robots = () =>
  Array.from(document.head.querySelectorAll<HTMLMetaElement>("meta[name=robots]")).map(
    (m) => m.content,
  );

afterEach(() => {
  document.head
    .querySelectorAll("meta[name=referrer], meta[name=robots]")
    .forEach((m) => m.remove());
});

describe("usePublicHead", () => {
  it.each([
    ["indexable feed", true, []],
    [
      "not indexable (club internal, private, public without the option)",
      false,
      ["noindex, nofollow"],
    ],
    ["loading or error state (no value)", undefined, ["noindex, nofollow"]],
  ] as const)("%s", (_label, indexable, expected) => {
    const { unmount } = renderHook(() => usePublicHead({ title: "Feed", indexable }));
    expect(robots()).toEqual(expected);
    expect(document.head.querySelector("meta[name=referrer]")).toHaveAttribute(
      "content",
      "no-referrer",
    );
    unmount();
    expect(robots()).toEqual([]);
  });

  it("follows a change of the feed (e.g. after loading)", () => {
    const { rerender } = renderHook(
      ({ indexable }) => usePublicHead({ title: "Feed", indexable }),
      {
        initialProps: { indexable: undefined as boolean | undefined },
      },
    );
    expect(robots()).toEqual(["noindex, nofollow"]);
    rerender({ indexable: true });
    expect(robots()).toEqual([]);
    rerender({ indexable: false });
    expect(robots()).toEqual(["noindex, nofollow"]);
  });
});
