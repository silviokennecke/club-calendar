import { describe, it, expect } from "vitest";
import { classifyError, isLoadError } from "../loadError";

describe("isLoadError", () => {
  it.each([
    "Failed to fetch dynamically imported module: https://x.test/assets/a.js",
    "error loading dynamically imported module: /assets/a.js",
    "Importing a module script failed.",
    "Unable to preload CSS for /assets/a.css",
    "Loading chunk 12 failed.",
  ])("recognises %s", (message) => {
    expect(isLoadError(new TypeError(message))).toBe(true);
  });

  it("recognises ChunkLoadError by name", () => {
    const error = new Error("x");
    error.name = "ChunkLoadError";
    expect(isLoadError(error)).toBe(true);
  });

  it("does not take other errors for load errors", () => {
    expect(isLoadError(new Error("Cannot read properties of undefined"))).toBe(false);
    expect(isLoadError(null)).toBe(false);
    expect(isLoadError("Failed to fetch dynamically imported module")).toBe(false);
  });
});

describe("classifyError", () => {
  it("sorts into notFound, load and generic", () => {
    expect(classifyError({ status: 404, statusText: "Not Found", data: null })).toBe("notFound");
    expect(classifyError(new TypeError("Failed to fetch dynamically imported module: /a.js"))).toBe(
      "load",
    );
    expect(classifyError(new Error("boom"))).toBe("generic");
    expect(classifyError({ status: 500 })).toBe("generic");
    expect(classifyError(undefined)).toBe("generic");
  });
});
