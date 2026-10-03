import { describe, expect, it } from "vitest";
import { isBlank, memberAddFailure, validateMemberEmail } from "..";

const members = [{ email: "Alex@Beispiel.de" }, { email: "mara@beispiel.de" }];

describe("validateMemberEmail", () => {
  it("requires an address", () => {
    expect(validateMemberEmail("", members)).toBe("empty");
    expect(validateMemberEmail("   ", members)).toBe("empty");
  });
  it("rejects malformed addresses", () => {
    for (const bad of ["alex", "alex@", "@beispiel.de", "a b@c.de", "a@b"]) {
      expect(validateMemberEmail(bad, members)).toBe("invalid");
    }
  });
  it("finds members already in the club regardless of case and spaces", () => {
    expect(validateMemberEmail(" alex@beispiel.de ", members)).toBe("duplicate");
  });
  it("accepts a new address", () => {
    expect(validateMemberEmail("jonas@beispiel.de", members)).toBeNull();
  });
});

describe("memberAddFailure", () => {
  it("maps 404 to 'no account' and everything else to a generic failure", () => {
    expect(memberAddFailure(Object.assign(new Error("User not found"), { status: 404 }))).toBe(
      "notFound",
    );
    expect(memberAddFailure(Object.assign(new Error("x"), { status: 500 }))).toBe("failed");
    expect(memberAddFailure(new Error("network"))).toBe("failed");
    expect(memberAddFailure(null)).toBe("failed");
  });
});

describe("isBlank", () => {
  it("treats whitespace as blank", () => {
    expect(isBlank("  \t")).toBe(true);
    expect(isBlank(" a ")).toBe(false);
  });
});
