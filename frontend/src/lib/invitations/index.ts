// Club invitations (M8): types, the token stash across sign-in and error mapping (no React).

/** Open invitation of a club (`GET /api/clubs/:id/invitations`, club members only). */
export interface ClubInvitation {
  id: string;
  email: string;
  status: "pending" | "expired";
  invitedByName: string | null;
  createdAt: string;
  expiresAt: string;
}

/** Invitation addressed to the signed-in user (`GET /api/invitations`). */
export interface MyInvitation {
  id: string;
  clubName: string;
  invitedByName: string | null;
  expiresAt: string;
}

const TOKEN_KEY = "cc.invitationToken";

/**
 * The mail link carries a token (`/invitations?token=…`). It is kept in `sessionStorage` while the visitor
 * signs in, registers and confirms the address, and removed once it was used (or is dead). Never logged,
 * never in a URL after the first load.
 */
export function stashInvitationToken(token: string): void {
  try {
    sessionStorage.setItem(TOKEN_KEY, token);
  } catch {
    // storage blocked: the link still works for a visitor who is signed in already
  }
}

export function readInvitationToken(): string | null {
  try {
    return sessionStorage.getItem(TOKEN_KEY) || null;
  } catch {
    return null;
  }
}

export function clearInvitationToken(): void {
  try {
    sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    // nothing stored
  }
}

function codeOf(error: unknown): string | undefined {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" ? code : undefined;
}

export type InvitationFailure = "notFound" | "expired" | "quota" | "rateLimited" | "failed";

/** Why accepting / declining failed, by the stable error code (never the message). */
export function invitationFailure(error: unknown): InvitationFailure {
  switch (codeOf(error)) {
    case "invitation_not_found":
      return "notFound";
    case "invitation_expired":
      return "expired";
    case "quota_exceeded":
      return "quota";
    case "rate_limited":
      return "rateLimited";
    default:
      return "failed";
  }
}

export type InviteProblem = "empty" | "invalid" | "duplicate" | "quota" | "rateLimited" | "failed";

/** Why sending an invitation failed (422 `quota_exceeded`, 429, 422 `validation_failed` for the e-mail). */
export function inviteFailure(error: unknown): InviteProblem {
  const code = codeOf(error);
  if (code === "quota_exceeded") return "quota";
  if (code === "rate_limited") return "rateLimited";
  if (code === "validation_failed") return "invalid";
  return "failed";
}

/** Resending refused because the invitation has not expired yet (422 `invitation_not_expired`). */
export function isNotExpired(error: unknown): boolean {
  return codeOf(error) === "invitation_not_expired";
}

/** The invitation is gone (answered, revoked meanwhile): 404 `invitation_not_found`. */
export function isInvitationGone(error: unknown): boolean {
  return codeOf(error) === "invitation_not_found";
}
