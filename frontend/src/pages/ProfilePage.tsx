import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useOutletContext, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Banner, Button, Skeleton, toast } from "@/components/ui/shared";
import { AuthLayout } from "@/components/auth/AuthLayout";
import { initials } from "@/components/layout/navigation";
import type { ShellData } from "@/components/layout/shellTypes";
import { DeleteAccountDialog } from "@/components/profile/DeleteAccountDialog";
import { AccountSection } from "@/components/profile/AccountSection";
import { LinkedLoginsSection, type LinkOutcome } from "@/components/profile/LinkedLoginsSection";
import { CalendarSubscriptionSection } from "@/components/profile/CalendarSubscriptionSection";
import { ConnectedAppsSection } from "@/components/profile/ConnectedAppsSection";
import { LegalSection } from "@/components/profile/LegalSection";
import { PasswordSection } from "@/components/profile/PasswordSection";
import { MfaSection } from "@/components/profile/MfaSection";
import { PreferencesSection } from "@/components/profile/PreferencesSection";
import { SessionsSection } from "@/components/profile/SessionsSection";
import type { ProfileData } from "@/components/profile/profileTypes";
import { ApiError, apiGet, apiPost } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { linkErrorKind, providerLabel } from "@/lib/profile";
import { usePageTitle } from "@/lib/usePageTitle";

/** URL parameters of the SSO link flow; read once, then removed from the address. */
const LINK_PARAMS = ["linked", "link_error", "link_provider", "link_proof"];

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
    return { kind: "error", error: linkErrorKind(err instanceof ApiError ? err.code : undefined) };
  }
}

/**
 * Profile (design: Profile, ProfileMobile): account (name, e-mail with confirmation link), password
 * (change, or set by e-mail for SSO-only accounts), linked sign-ins (link / unlink), MFA (authenticator app, passkeys, backup codes), personal
 * settings (incl. theme) and account deletion. Name / e-mail / password editing extends the design.
 */
export default function ProfilePage() {
  const { t } = useTranslation();
  usePageTitle(t("profile.title"));
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [deleteOpen, setDeleteOpen] = useState(false);
  // Inside the app shell (a club is known) or on its own page for users without a club.
  const shell = useOutletContext<ShellData | undefined>();
  const [params, setParams] = useSearchParams();
  const [linkOutcome, setLinkOutcome] = useState(() => linkOutcomeOf(params));
  const [linkProof] = useState(() => linkProofOf(params));
  const completing = useRef(false);

  useEffect(() => {
    // Once, also when effects run twice (StrictMode): the proof is single-use.
    if (!linkProof || completing.current) return;
    completing.current = true;
    void completeLink(linkProof.provider, linkProof.proof).then((outcome) => {
      setLinkOutcome(outcome);
      if (outcome.kind === "linked") void queryClient.invalidateQueries({ queryKey: ["profile"] });
    });
  }, [linkProof, queryClient]);

  useEffect(() => {
    if (linkOutcome?.kind !== "linked") return;
    // Fixed id: shown once, also when effects run twice (StrictMode).
    toast.success(t("profile.sso.linkedNow", { name: providerLabel(linkOutcome.provider) }), {
      id: "sso-linked",
    });
  }, [linkOutcome, t]);

  // The result of the link flow is shown once; the address loses the parameters (no repeat on reload).
  useEffect(() => {
    if (!LINK_PARAMS.some((p) => params.has(p))) return;
    const rest = new URLSearchParams(params);
    for (const p of LINK_PARAMS) rest.delete(p);
    setParams(rest, { replace: true });
  }, [params, setParams]);

  const profile = useQuery<ProfileData>({
    queryKey: ["profile"],
    queryFn: () => apiGet<ProfileData>("/api/auth/me"),
  });
  const data = profile.data;
  const name = data?.name ?? user?.name ?? "";
  const email = data?.email ?? user?.email ?? "";

  function accountDeleted() {
    logout();
    navigate("/login", { replace: true });
  }

  const signOut = (
    <Button variant="secondary" icon="log-out" onClick={logout}>
      {t("profile.signOut")}
    </Button>
  );

  const body = (
    <div className="ap-stack ap-stack--lg">
      <section className="ap-panel" aria-labelledby="pr-me">
        <div className="ap-row" style={{ gap: 16, alignItems: "center" }}>
          <span
            className="ap-avatar"
            style={{ width: 64, height: 64, fontSize: 22 }}
            aria-hidden="true"
          >
            {initials(name || email)}
          </span>
          <div className="ap-stack ap-stack--sm" style={{ minWidth: 0 }}>
            <h2 className="t-h2" id="pr-me">
              {name || email}
            </h2>
            {name && <p className="t-body">{email}</p>}
          </div>
        </div>
      </section>

      {profile.isPending ? (
        <div className="ap-stack" aria-busy="true">
          <p className="ap-sr" role="status">
            {t("profile.loading")}
          </p>
          <Skeleton style={{ display: "block", height: 160 }} />
          <Skeleton style={{ display: "block", height: 220 }} />
        </div>
      ) : data ? (
        <>
          <AccountSection key={data.name} profile={data} />
          <PasswordSection profile={data} />
          <LinkedLoginsSection profile={data} outcome={linkOutcome} />
          <MfaSection profile={data} />
        </>
      ) : (
        <Banner
          tone="danger"
          title={t("profile.loadError.title")}
          action={
            <Button variant="secondary" icon="refresh" onClick={() => void profile.refetch()}>
              {t("profile.loadError.retry")}
            </Button>
          }
        >
          {t("profile.loadError.text")}
        </Banner>
      )}

      <PreferencesSection />

      <CalendarSubscriptionSection />

      <ConnectedAppsSection />

      <SessionsSection />

      <LegalSection />

      <section className="ap-panel ap-panel--danger" aria-labelledby="pr-danger">
        <div className="ap-panel-head">
          <div>
            <h2 className="t-h2" id="pr-danger">
              {t("profile.danger.title")}
            </h2>
            <p>{t("profile.danger.text")}</p>
          </div>
          <Button variant="danger" icon="trash" onClick={() => setDeleteOpen(true)}>
            {t("profile.danger.action")}
          </Button>
          <DeleteAccountDialog
            open={deleteOpen}
            onOpenChange={setDeleteOpen}
            hasPassword={data?.hasPassword}
            email={email}
            onDeleted={accountDeleted}
          />
        </div>
      </section>
    </div>
  );

  if (!shell) {
    return (
      <AuthLayout
        bare
        title={t("profile.title")}
        intro={t("profile.intro")}
        headerEnd={
          <div className="ap-row">
            <Link className="ap-link" to="/clubs?select=1">
              {t("profile.toClubs")}
            </Link>
            {signOut}
          </div>
        }
      >
        {body}
      </AuthLayout>
    );
  }

  return (
    <div className="ap-wrap--narrow">
      <header className="ap-pagehead">
        <div>
          <h1 className="t-h1">{t("profile.title")}</h1>
          <p className="t-body">{t("profile.intro")}</p>
        </div>
        <div className="ap-actions">{signOut}</div>
      </header>
      {body}
    </div>
  );
}
