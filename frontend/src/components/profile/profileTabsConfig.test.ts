import { describe, expect, it } from "vitest";
import { LINK_PARAMS, PROFILE_TABS, profileTabForHash } from "./profileTabsConfig";

describe("profileTabForHash", () => {
  it.each([
    ["#pr-account", "/profile"],
    ["#pr-set", "/profile"],
    ["#pr-pw", "/profile/security"],
    ["#pr-sso", "/profile/security"],
    ["#pr-mfa", "/profile/security"],
    ["#pr-sessions", "/profile/security"],
    ["#pr-subscription", "/profile/apps"],
    ["#pr-apps", "/profile/apps"],
    ["#pr-legal", "/profile/privacy"],
    ["#pr-danger", "/profile/privacy"],
    ["pr-pw", "/profile/security"],
  ])("maps %s to %s", (hash, href) => {
    expect(profileTabForHash(hash)?.href).toBe(href);
  });

  it("knows no tab for an empty or unknown hash", () => {
    expect(profileTabForHash("")).toBeNull();
    expect(profileTabForHash("#")).toBeNull();
    expect(profileTabForHash("#pr-unknown")).toBeNull();
    expect(profileTabForHash("#other")).toBeNull();
  });

  it("only points at defined tabs", () => {
    expect(PROFILE_TABS.map((t) => t.href)).toEqual([
      "/profile",
      "/profile/security",
      "/profile/apps",
      "/profile/privacy",
    ]);
    expect(LINK_PARAMS).toEqual(["linked", "link_error", "link_provider", "link_proof"]);
  });
});
