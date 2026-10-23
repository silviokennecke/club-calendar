import { afterEach, describe, expect, it } from "vitest";
import {
  clearInvitationToken,
  inviteFailure,
  invitationFailure,
  isInvitationGone,
  readInvitationToken,
  stashInvitationToken,
} from ".";

const coded = (code: string) => Object.assign(new Error("x"), { code });

afterEach(() => sessionStorage.clear());

describe("invitation token stash", () => {
  it("keeps the token until it is cleared", () => {
    expect(readInvitationToken()).toBeNull();
    stashInvitationToken("abc");
    expect(readInvitationToken()).toBe("abc");
    clearInvitationToken();
    expect(readInvitationToken()).toBeNull();
  });
});

describe("invitationFailure", () => {
  it("maps the stable codes", () => {
    expect(invitationFailure(coded("invitation_not_found"))).toBe("notFound");
    expect(invitationFailure(coded("invitation_expired"))).toBe("expired");
    expect(invitationFailure(coded("quota_exceeded"))).toBe("quota");
    expect(invitationFailure(coded("rate_limited"))).toBe("rateLimited");
    expect(invitationFailure(new Error("network"))).toBe("failed");
    expect(invitationFailure(null)).toBe("failed");
  });
});

describe("inviteFailure and friends", () => {
  it("maps quota, rate limit and validation", () => {
    expect(inviteFailure(coded("quota_exceeded"))).toBe("quota");
    expect(inviteFailure(coded("rate_limited"))).toBe("rateLimited");
    expect(inviteFailure(coded("validation_failed"))).toBe("invalid");
    expect(inviteFailure(new Error("x"))).toBe("failed");
  });
  it("recognises gone invitations", () => {
    expect(isInvitationGone(coded("invitation_not_found"))).toBe(true);
    expect(isInvitationGone(null)).toBe(false);
  });
});
