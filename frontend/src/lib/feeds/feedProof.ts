// Feed proof: the feed (and its secret) a visitor wants to add to an account. Kept in `sessionStorage`
// across sign-in, registration and e-mail confirmation like the invitation token, removed once used.

export interface FeedProof {
  feedId: string;
  secret?: string;
}

const KEY = "cc.feedProof";
const REDIRECTED_KEY = "cc.feedProofRedirected";
const MAX_AGE_MS = 60 * 60 * 1000;

export function stashFeedProof(proof: FeedProof): void {
  try {
    sessionStorage.setItem(
      KEY,
      JSON.stringify({ feedId: proof.feedId, secret: proof.secret || undefined, at: Date.now() }),
    );
    sessionStorage.removeItem(REDIRECTED_KEY);
  } catch {
    // storage blocked: the join page still works for a visitor who is signed in already
  }
}

export function readFeedProof(): FeedProof | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as { feedId?: unknown; secret?: unknown; at?: unknown };
    if (typeof data.feedId !== "string" || !data.feedId) return null;
    if (typeof data.at !== "number" || Date.now() - data.at > MAX_AGE_MS) {
      clearFeedProof();
      return null;
    }
    return {
      feedId: data.feedId,
      secret: typeof data.secret === "string" && data.secret ? data.secret : undefined,
    };
  } catch {
    return null;
  }
}

export function clearFeedProof(): void {
  try {
    sessionStorage.removeItem(KEY);
    sessionStorage.removeItem(REDIRECTED_KEY);
  } catch {
    // nothing stored
  }
}

/** The clubs page forwards to the join page once per stash; returns true if that redirect is due. */
export function takeFeedJoinRedirect(): boolean {
  try {
    if (sessionStorage.getItem(REDIRECTED_KEY)) return false;
    sessionStorage.setItem(REDIRECTED_KEY, "1");
  } catch {
    // storage blocked: nothing could have been stashed either
  }
  return true;
}

/** Request body part for identify / register (`feedProof`), empty without a stash. */
export function feedProofBody(): { feedProof?: FeedProof } {
  const proof = readFeedProof();
  return proof ? { feedProof: proof } : {};
}

export const feedJoinPath = (feedId: string) => `/feed/${encodeURIComponent(feedId)}/join`;

export type FeedJoinFailure = "signupDisabled" | "notFound" | "quota" | "rateLimited" | "failed";

/** Why joining / claiming failed, by the stable error code. */
export function feedJoinFailure(error: unknown): FeedJoinFailure {
  const code = (error as { code?: unknown } | null)?.code;
  switch (code) {
    case "member_signup_disabled":
      return "signupDisabled";
    case "feed_not_found":
      return "notFound";
    case "quota_exceeded":
      return "quota";
    case "rate_limited":
      return "rateLimited";
    default:
      return "failed";
  }
}
