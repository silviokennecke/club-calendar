import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "@/components/ui/shared";
import { LinkedLoginsSection, type LinkOutcome } from "@/components/profile/LinkedLoginsSection";
import { MfaSection } from "@/components/profile/MfaSection";
import { PasswordSection } from "@/components/profile/PasswordSection";
import { SessionsSection } from "@/components/profile/SessionsSection";
import { LINK_PARAMS } from "@/components/profile/profileTabsConfig";
import { useProfileContext } from "@/components/profile/profileContext";
import { ApiError, apiPost, isStepUpCancelled } from "@/lib/api";
import { linkErrorKind, providerLabel } from "@/lib/profile";
import { useScrollToHash } from "@/lib/profile/useScrollToHash";

/** `?linked=<provider>` / `?link_error=<code>` of the SSO link flow. */
function linkOutcomeOf(params: URLSearchParams): LinkOutcome | null {
  const linked = params.get("linked");
  if (linked) return { kind: "linked", provider: linked };
  if (params.has("link_error"))
    return { kind: "error", error: linkErrorKind(params.get("link_error")) };
  return null;
}

/** `?link_provider=&link_proof=`: the provider confirmed the account, this session completes the link. */
function linkProofOf(params: URLSearchParams): { provider: string; proof: string } | null {
  const provider = params.get("link_provider");
  const proof = params.get("link_proof");
  return provider && proof ? { provider, proof } : null;
}

/**
 * Completes an SSO link with this session's token. The API links only when the signed-in user is the
 * one who started the flow, so a link flow started by someone else (a link sent to this browser) never
 * attaches this browser's provider account to another user.
 */
async function completeLink(provider: string, proof: string): Promise<LinkOutcome> {
  try {
    await apiPost<void>(`/api/auth/oauth/${encodeURIComponent(provider)}/link-complete`, { proof });
    return { kind: "linked", provider };
  } catch (err) {
    if (isStepUpCancelled(err)) return { kind: "cancelled", provider };
    return { kind: "error", error: linkErrorKind(err instanceof ApiError ? err.code : undefined) };
  }
}

/** Password, linked sign-ins (incl. the return of the SSO link flow), MFA and sessions. */
export default function ProfileSecurityTab() {
  const { t } = useTranslation();
  const { profile } = useProfileContext();
  const queryClient = useQueryClient();
  const [params, setParams] = useSearchParams();
  const [linkOutcome, setLinkOutcome] = useState(() => linkOutcomeOf(params));
  const [linkProof] = useState(() => linkProofOf(params));
  const completing = useRef(false);
  // The proof stays in the address until the call has an answer (or was cancelled: then the state keeps it).
  const [linkSettled, setLinkSettled] = useState(!linkProof);
  useScrollToHash(!!profile);

  const runComplete = useCallback(() => {
    if (!linkProof) return;
    setLinkOutcome(null);
    void completeLink(linkProof.provider, linkProof.proof).then((outcome) => {
      setLinkOutcome(outcome);
      setLinkSettled(true);
      if (outcome.kind === "linked") void queryClient.invalidateQueries({ queryKey: ["profile"] });
    });
  }, [linkProof, queryClient]);

  useEffect(() => {
    // Once, also when effects run twice (StrictMode): the proof is single-use.
    if (!linkProof || completing.current) return;
    completing.current = true;
    runComplete();
  }, [linkProof, runComplete]);

  useEffect(() => {
    if (linkOutcome?.kind !== "linked") return;
    // Fixed id: shown once, also when effects run twice (StrictMode).
    toast.success(t("profile.sso.linkedNow", { name: providerLabel(linkOutcome.provider) }), {
      id: "sso-linked",
    });
  }, [linkOutcome, t]);

  // The result of the link flow is shown once; the address loses the parameters (no repeat on reload).
  useEffect(() => {
    const removable = LINK_PARAMS.filter(
      (p) => linkSettled || (p !== "link_proof" && p !== "link_provider"),
    );
    if (!removable.some((p) => params.has(p))) return;
    const rest = new URLSearchParams(params);
    for (const p of removable) rest.delete(p);
    setParams(rest, { replace: true });
  }, [params, setParams, linkSettled]);

  return (
    <div className="ap-stack ap-stack--lg">
      {profile && (
        <>
          <PasswordSection profile={profile} />
          <LinkedLoginsSection
            profile={profile}
            outcome={linkOutcome}
            onRetryComplete={runComplete}
          />
          <MfaSection profile={profile} />
        </>
      )}
      <SessionsSection />
    </div>
  );
}
