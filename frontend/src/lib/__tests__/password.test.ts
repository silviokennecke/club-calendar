import { describe, expect, it } from "vitest";
import { PASSWORD_MAX, passwordProblem } from "../password";

describe("passwordProblem", () => {
  it("follows the API policy (8 to 128 characters)", () => {
    expect(passwordProblem("")).toBe("missing");
    expect(passwordProblem("short12")).toBe("short");
    expect(passwordProblem("password")).toBeNull();
    expect(passwordProblem("a".repeat(PASSWORD_MAX))).toBeNull();
    expect(passwordProblem("a".repeat(PASSWORD_MAX + 1))).toBe("long");
  });

  it("counts characters, not UTF-16 units or bytes", () => {
    expect(passwordProblem("ä".repeat(128))).toBeNull();
    expect(passwordProblem("😀".repeat(128))).toBeNull();
    expect(passwordProblem("😀".repeat(7))).toBe("short");
  });
});
