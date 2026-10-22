import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Banner, Button, Icon, LinkButton, Skeleton } from "@/components/ui/shared";
import { AuthLayout } from "@/components/auth/AuthLayout";
import {
  decide,
  decisionFailure,
  navigateAway,
  useAuthorizationRequest,
  type DecisionFailure,
} from "@/lib/mcp";
import { apiErrorCode } from "@/lib/api";

/**
 * /oauth/consent?request=<id>: an AI client (MCP) asks for access to the account. The authorization
 * endpoint of the backend redirects here; the answer goes to `POST /api/oauth/authorize/decision` and the
 * browser then follows the returned redirect URL to the client.
 */
export default function OAuthConsentPage() {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const requestId = params.get("request");
  const request = useAuthorizationRequest(requestId);
  const [busy, setBusy] = useState<"allow" | "deny" | null>(null);
  const [failure, setFailure] = useState<DecisionFailure | null>(null);
  const [leaving, setLeaving] = useState(false);

  const expired =
    !requestId ||
    failure === "expired" ||
    apiErrorCode(request.error) === "authorization_request_not_found" ||
    (request.data !== undefined && new Date(request.data.expiresAt).getTime() <= Date.now());

  async function answer(approve: boolean) {
    if (!requestId) return;
    setBusy(approve ? "allow" : "deny");
    setFailure(null);
    try {
      const { redirectUrl } = await decide(requestId, approve);
      setLeaving(true);
      navigateAway.to(redirectUrl);
    } catch (error) {
      setFailure(decisionFailure(error));
      setBusy(null);
    }
  }

  if (expired) {
    return (
      <AuthLayout icon="alert" title={t("oauth.consent.expiredTitle")}>
        <div className="ap-stack">
          <Banner tone="warning">{t("oauth.consent.expiredText")}</Banner>
          <LinkButton to="/clubs" block>
            {t("oauth.consent.toApp")}
          </LinkButton>
        </div>
      </AuthLayout>
    );
  }

  if (request.isPending) {
    return (
      <AuthLayout icon="lock" title={t("oauth.consent.title")}>
        <div className="ap-stack" aria-busy="true">
          <p className="ap-sr" role="status">
            {t("oauth.consent.loading")}
          </p>
          <Skeleton style={{ display: "block", height: 120 }} />
        </div>
      </AuthLayout>
    );
  }

  if (request.isError || !request.data) {
    return (
      <AuthLayout icon="alert" title={t("oauth.consent.errorTitle")}>
        <div className="ap-stack">
          <Banner
            tone="danger"
            action={
              <Button variant="secondary" icon="refresh" onClick={() => void request.refetch()}>
                {t("oauth.consent.retry")}
              </Button>
            }
          >
            {t("oauth.consent.loadFailed")}
          </Banner>
          <LinkButton to="/clubs" variant="ghost" block>
            {t("oauth.consent.toApp")}
          </LinkButton>
        </div>
      </AuthLayout>
    );
  }

  const data = request.data;
  const write = data.scopes.includes("mcp:write");
  const locked = busy !== null || leaving;

  return (
    <AuthLayout
      icon="lock"
      title={t("oauth.consent.title")}
      intro={t("oauth.consent.intro", { name: data.clientName })}
    >
      <div className="ap-stack">
        <dl className="ap-stack ap-stack--sm">
          <div>
            <dt className="t-sm t-muted">{t("oauth.consent.app")}</dt>
            <dd className="t-h3" style={{ overflowWrap: "anywhere" }}>
              {data.clientName}
            </dd>
          </div>
          <div>
            <dt className="t-sm t-muted">{t("oauth.consent.redirectHost")}</dt>
            <dd>
              <strong style={{ overflowWrap: "anywhere" }}>{data.redirectHost}</strong>
            </dd>
          </div>
        </dl>

        {data.family === null && (
          <Banner tone="warning" title={t("oauth.consent.unverifiedTitle")}>
            {t("oauth.consent.unverifiedText")}
          </Banner>
        )}

        <div className="ap-stack ap-stack--sm">
          <h2 className="t-h3">{t("oauth.consent.scopesTitle")}</h2>
          <ul className="ap-stack ap-stack--sm" style={{ listStyle: "none", padding: 0 }}>
            <li className="ap-row" style={{ gap: 8, alignItems: "flex-start" }}>
              <Icon glyph="eye" size={18} />
              <span>{t("oauth.scope.read")}</span>
            </li>
            {write && (
              <li className="ap-row" style={{ gap: 8, alignItems: "flex-start" }}>
                <Icon glyph="edit" size={18} />
                <span>{t("oauth.scope.write")}</span>
              </li>
            )}
          </ul>
          {write && <p className="t-sm t-muted">{t("oauth.consent.writeNote")}</p>}
        </div>

        {failure && failure !== "expired" && (
          <Banner tone="danger" title={t("oauth.consent.errorTitle")}>
            {t(`oauth.consent.problem.${failure}`)}{" "}
            {failure === "quota" && (
              <Link className="ap-link" to="/profile">
                {t("oauth.consent.toProfile")}
              </Link>
            )}
          </Banner>
        )}

        <Button
          block
          icon="check"
          loading={busy === "allow" || leaving}
          disabled={locked}
          onClick={() => void answer(true)}
        >
          {t("oauth.consent.allow")}
        </Button>
        <Button
          block
          variant="secondary"
          loading={busy === "deny"}
          disabled={locked}
          onClick={() => void answer(false)}
        >
          {t("oauth.consent.deny")}
        </Button>
        <p className="t-sm t-muted">{t("oauth.consent.revokeHint")}</p>
      </div>
    </AuthLayout>
  );
}
