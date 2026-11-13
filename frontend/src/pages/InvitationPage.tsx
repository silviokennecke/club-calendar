import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useAppName } from "@/lib/appName";
import { apiPost } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { Banner, Button, FullPageLoader, LinkButton } from "@/components/ui/shared";
import { AuthLayout } from "@/components/auth/AuthLayout";
import {
  clearInvitationToken,
  invitationFailure,
  readInvitationToken,
  stashInvitationToken,
  type InvitationFailure,
} from "@/lib/invitations";
import { useEnterClub } from "@/lib/useEnterClub";
import type { Club } from "@/lib/types";

/**
 * /invitations?token=… : the link of the invitation e-mail. The page only has the token (no club details),
 * so it is neutral. The token moves into `sessionStorage` and out of the address bar at once; a visitor who
 * is not signed in goes to the login and returns here after it (the club picker forwards back). The token
 * is removed after use or when it is dead.
 */
export default function InvitationPage() {
  const { t } = useTranslation();
  const appName = useAppName();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { user, loading } = useAuth();
  const enterClub = useEnterClub();
  const [params] = useSearchParams();
  const urlToken = params.get("token");
  const [token] = useState(() => urlToken ?? readInvitationToken());
  const [busy, setBusy] = useState<"accept" | "decline" | null>(null);
  const [failure, setFailure] = useState<InvitationFailure | null>(null);
  const [declined, setDeclined] = useState(false);

  useEffect(() => {
    if (!urlToken) return;
    stashInvitationToken(urlToken);
    navigate("/invitations", { replace: true });
  }, [urlToken, navigate]);

  useEffect(() => {
    if (loading || urlToken) return;
    if (!user) navigate("/login", { replace: true });
    // Pending consents: the gate on the protected pages comes first; the token stays stashed and the
    // clubs page forwards here again once the documents are accepted.
    else if (user.consentRequired) navigate("/clubs", { replace: true });
    else if (!token) navigate("/clubs", { replace: true });
  }, [loading, user, token, urlToken, navigate]);

  if (loading || !user || user.consentRequired || !token)
    return <FullPageLoader message={t("common.loading")} />;

  async function answer(accept: boolean) {
    setBusy(accept ? "accept" : "decline");
    setFailure(null);
    try {
      if (accept) {
        const club = await apiPost<Club>("/api/invitations/accept", { token });
        clearInvitationToken();
        await enterClub(club.id);
        return;
      }
      await apiPost("/api/invitations/decline", { token });
      clearInvitationToken();
      void qc.invalidateQueries({ queryKey: ["invitations"] });
      setDeclined(true);
    } catch (error) {
      const found = invitationFailure(error);
      // The invitation is dead (or the club full): the token is of no use any more
      if (found !== "failed" && found !== "rateLimited") clearInvitationToken();
      setFailure(found);
    } finally {
      setBusy(null);
    }
  }

  function later() {
    clearInvitationToken();
    navigate("/clubs?select=1", { replace: true });
  }

  const dead = failure !== null && failure !== "failed" && failure !== "rateLimited";

  if (declined) {
    return (
      <AuthLayout icon="mail" title={t("invitations.page.declinedTitle")}>
        <div className="ap-stack">
          <Banner tone="success">{t("invitations.page.declinedText")}</Banner>
          <LinkButton to="/clubs?select=1" block>
            {t("invitations.page.toClubs")}
          </LinkButton>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      icon="mail"
      title={t("invitations.page.title")}
      intro={dead ? undefined : t("invitations.page.intro", { appName })}
    >
      <div className="ap-stack">
        {failure && (
          <Banner tone="danger" title={t("invitations.page.errorTitle")}>
            {t(`invitations.problem.${failure}`)}
          </Banner>
        )}
        {dead ? (
          <LinkButton to="/clubs?select=1" block>
            {t("invitations.page.toClubs")}
          </LinkButton>
        ) : (
          <>
            <Button
              block
              icon="check"
              loading={busy === "accept"}
              disabled={busy !== null}
              onClick={() => void answer(true)}
            >
              {t("invitations.accept")}
            </Button>
            <Button
              block
              variant="secondary"
              loading={busy === "decline"}
              disabled={busy !== null}
              onClick={() => void answer(false)}
            >
              {t("invitations.decline")}
            </Button>
            <Button block variant="ghost" disabled={busy !== null} onClick={later}>
              {t("invitations.page.later")}
            </Button>
          </>
        )}
      </div>
    </AuthLayout>
  );
}
