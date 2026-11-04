// MCP / OAuth: consent page API, connected apps and the return path across sign-in (no React components).

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiDelete, apiErrorCode, apiGet, apiPost } from "@/lib/api";

export type McpScope = "mcp:read" | "mcp:write";

/** `GET /api/oauth/authorization-request/:id` */
export interface AuthorizationRequest {
  id: string;
  /** Server-derived from the matched family (Claude, ChatGPT, Gemini); null = no known family. */
  label: string | null;
  /** Name the client declared about itself at registration: a claim, never an identity. */
  claimedName: string;
  redirectHost: string;
  /** Matched client family (claude, openai, ...); null = unverified app. */
  family: string | null;
  /** Callback a third party can own: a local program or a ChatGPT connector id. */
  callbackRisk: "loopback" | "connector" | null;
  scopes: McpScope[];
  createdAt: string;
  expiresAt: string;
}

/** `GET /api/auth/mcp-grants` */
export interface McpGrant {
  id: string;
  label: string | null;
  claimedName: string;
  redirectHost: string;
  family: string | null;
  scopes: McpScope[];
  createdAt: string;
  lastUsedAt: string | null;
}

export const mcpKeys = {
  request: (id: string) => ["oauth", "request", id] as const,
  grants: ["mcp-grants"] as const,
};

export function useAuthorizationRequest(id: string | null) {
  return useQuery({
    queryKey: mcpKeys.request(id ?? ""),
    queryFn: () =>
      apiGet<AuthorizationRequest>(
        `/api/oauth/authorization-request/${encodeURIComponent(id ?? "")}`,
      ),
    enabled: !!id,
    retry: false,
    staleTime: Infinity,
  });
}

export function decide(requestId: string, approve: boolean): Promise<{ redirectUrl: string }> {
  return apiPost<{ redirectUrl: string }>("/api/oauth/authorize/decision", { requestId, approve });
}

/** Leaves the SPA for the client's redirect URL (wrapped so tests can replace it). */
export const navigateAway = {
  to: (url: string) => window.location.assign(url),
};

export type DecisionFailure =
  "expired" | "consent" | "emailUnverified" | "quota" | "rateLimited" | "failed";

/** Why the consent page failed, by the stable error code (never the message). */
export function decisionFailure(error: unknown): DecisionFailure {
  switch (apiErrorCode(error)) {
    case "authorization_request_not_found":
      return "expired";
    case "consent_required":
      return "consent";
    case "email_not_verified":
      return "emailUnverified";
    case "quota_exceeded":
      return "quota";
    case "rate_limited":
      return "rateLimited";
    default:
      return "failed";
  }
}

export function useMcpGrants() {
  return useQuery({
    queryKey: mcpKeys.grants,
    queryFn: () => apiGet<McpGrant[]>("/api/auth/mcp-grants"),
  });
}

export function useRevokeMcpGrant() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiDelete(`/api/auth/mcp-grants/${encodeURIComponent(id)}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: mcpKeys.grants }),
  });
}

const RETURN_KEY = "cc.returnTo";
const RETURN_TTL = 10 * 60_000;
/** Only the consent page is restored after a sign-in (open redirect safe: fixed path prefix). */
const RETURN_PATH = /^\/oauth\/consent\?request=[\w-]+$/;

/** Remembers the consent URL while a signed-out visitor signs in; `/clubs` forwards back (see `takeReturnTo`). */
export function stashReturnTo(path: string): void {
  if (!RETURN_PATH.test(path)) return;
  try {
    sessionStorage.setItem(RETURN_KEY, JSON.stringify({ path, at: Date.now() }));
  } catch {
    // storage blocked: the visitor opens the consent link again
  }
}

/** The stashed path (once, and only while fresh), else null. */
export function takeReturnTo(): string | null {
  try {
    const raw = sessionStorage.getItem(RETURN_KEY);
    if (!raw) return null;
    sessionStorage.removeItem(RETURN_KEY);
    const { path, at } = JSON.parse(raw) as { path?: unknown; at?: unknown };
    if (typeof path !== "string" || typeof at !== "number") return null;
    if (Date.now() - at > RETURN_TTL || !RETURN_PATH.test(path)) return null;
    return path;
  } catch {
    return null;
  }
}
