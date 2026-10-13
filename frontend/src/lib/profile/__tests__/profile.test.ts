import { describe, expect, it } from "vitest";
import {
  dateFormatChoices,
  isLastSignInMethod,
  linkErrorKind,
  localDay,
  providerLabel,
  providerRows,
} from "..";

describe("dateFormatChoices", () => {
  it("shows an example date for every format", () => {
    expect(dateFormatChoices()).toEqual([
      { value: "dd.MM.yyyy", example: "31.12.2026" },
      { value: "dd/MM/yyyy", example: "31/12/2026" },
      { value: "MM/dd/yyyy", example: "12/31/2026" },
      { value: "yyyy-MM-dd", example: "2026-12-31" },
    ]);
  });
});

describe("providerRows", () => {
  const offered = [
    { id: "google", name: "Google" },
    { id: "microsoft", name: "Microsoft" },
  ];
  it("lists linked accounts first, then the other offered providers", () => {
    expect(providerRows([{ provider: "microsoft" }], offered)).toEqual([
      { id: "microsoft", name: "Microsoft", linked: true },
      { id: "google", name: "Google", linked: false },
    ]);
  });
  it("keeps a linked provider the server no longer offers", () => {
    expect(providerRows([{ provider: "apple" }, { provider: "apple" }], [])).toEqual([
      { id: "apple", name: "Apple", linked: true },
    ]);
  });
  it("is empty without any provider", () => {
    expect(providerRows([], [])).toEqual([]);
    expect(providerLabel("")).toBe("");
  });
});

describe("isLastSignInMethod", () => {
  const google = [{ provider: "google" }];
  it("is the last method only without password, passkeys and other providers", () => {
    expect(
      isLastSignInMethod({ hasPassword: false, passkeys: [], oauthAccounts: google }, "google"),
    ).toBe(true);
    expect(
      isLastSignInMethod({ hasPassword: true, passkeys: [], oauthAccounts: google }, "google"),
    ).toBe(false);
    expect(
      isLastSignInMethod({ hasPassword: false, passkeys: [{}], oauthAccounts: google }, "google"),
    ).toBe(false);
    expect(
      isLastSignInMethod(
        { hasPassword: false, passkeys: [], oauthAccounts: [...google, { provider: "microsoft" }] },
        "google",
      ),
    ).toBe(false);
  });
});

describe("linkErrorKind", () => {
  it("keeps known codes and maps everything else to generic", () => {
    expect(linkErrorKind("account_in_use")).toBe("account_in_use");
    expect(linkErrorKind("already_linked")).toBe("already_linked");
    expect(linkErrorKind("<script>")).toBe("generic");
    expect(linkErrorKind(null)).toBe("generic");
  });
});

describe("localDay", () => {
  it("returns the local calendar day of a timestamp", () => {
    const iso = new Date(2026, 9, 13, 0, 30).toISOString();
    expect(localDay(iso)).toBe("2026-10-13");
    expect(localDay("nonsense")).toBe("nonsense".slice(0, 10));
  });
});
