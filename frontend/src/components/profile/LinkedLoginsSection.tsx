import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Banner, Button, ConfirmDialog, Icon, toast } from "@/components/ui/shared";
import { ApiError, apiDelete, apiGet, apiPost, isStepUpCancelled } from "@/lib/api";
import { focusAfterDialog } from "@/lib/focus";
import {
  isLastSignInMethod,
  providerLabel,
  providerRows,
  type LinkError,
  type ProviderInfo,
  type ProviderRow,
} from "@/lib/profile";
import type { ProfileData } from "./profileTypes";

/** Result of an SSO link flow, read from `/profile?linked=` / `?link_error=` by the page. */
export type LinkOutcome =
  | { kind: "linked"; provider: string }
  | { kind: "error"; error: LinkError }
  /** The step-up confirmation for `link-complete` was cancelled; the proof is kept for a retry. */
  | { kind: "cancelled"; provider: string };

const LAST_METHOD_NOTE = "pr-sso-last";

/**
 * "Verknüpfte Anmeldungen" (design: Profile). "Konto verknüpfen" asks the API for a one-time start
 * URL and leaves for the provider (the API comes back to `/profile?linked=<provider>` or
 * `?link_error=<code>`). "Verknüpfung trennen" asks first; it is disabled with an explanation when it
 * is the last way to sign in (the API refuses that too: 409 `last_login_method`).
 */
export function LinkedLoginsSection({
  profile,
  outcome,
  onRetryComplete,
}: {
  profile: ProfileData;
  outcome: LinkOutcome | null;
  onRetryComplete?: () => void;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [starting, setStarting] = useState<string | null>(null);
  const [unlinking, setUnlinking] = useState<ProviderRow | null>(null);
  const [startFailed, setStartFailed] = useState(false);
  const offered = useQuery<ProviderInfo[]>({
    queryKey: ["authProviders"],
    queryFn: () => apiGet<ProviderInfo[]>("/api/auth/providers"),
    retry: false,
    staleTime: 5 * 60_000,
  });
  const rows = providerRows(profile.oauthAccounts, offered.data ?? []);
  const nameOf = (id: string) => rows.find((r) => r.id === id)?.name ?? providerLabel(id);
  const anyLast = rows.some((r) => r.linked && isLastSignInMethod(profile, r.id));

  async function link(row: ProviderRow) {
    setStartFailed(false);
    setStarting(row.id);
    try {
      const { url } = await apiPost<{ url: string }>(
        `/api/auth/oauth/${encodeURIComponent(row.id)}/link-start`,
        {},
      );
      window.location.assign(url);
    } catch (err) {
      setStarting(null);
      if (!isStepUpCancelled(err)) setStartFailed(true);
    }
  }

  async function unlink(row: ProviderRow) {
    try {
      await apiDelete(`/api/auth/oauth/${encodeURIComponent(row.id)}`);
    } catch (err) {
      if (isStepUpCancelled(err)) return;
      const code = err instanceof ApiError ? err.code : undefined;
      toast.error(
        code === "last_login_method"
          ? t("profile.sso.lastMethod")
          : t("profile.sso.unlinkFailed", { name: row.name }),
      );
      return;
    }
    await qc.invalidateQueries({ queryKey: ["profile"] });
    toast.success(t("profile.sso.unlinked", { name: row.name }));
    focusAfterDialog("pr-sso");
  }

  return (
    <section className="ap-panel" aria-labelledby="pr-sso">
      <div className="ap-panel-head">
        <div>
          <h2 className="t-h2 ap-focus-target" id="pr-sso" tabIndex={-1}>
            {t("profile.sso.title")}
          </h2>
          <p>{t("profile.sso.text")}</p>
        </div>
      </div>
      <div className="ap-stack">
        {outcome?.kind === "linked" && (
          <Banner tone="success">
            {t("profile.sso.linkedNow", { name: nameOf(outcome.provider) })}
          </Banner>
        )}
        {outcome?.kind === "error" && (
          <Banner tone="danger" title={t("profile.sso.linkErrorTitle")}>
            {t(`profile.sso.linkError.${outcome.error}`)}
          </Banner>
        )}
        {outcome?.kind === "cancelled" && (
          <Banner
            tone="info"
            action={
              onRetryComplete && (
                <Button type="button" variant="secondary" onClick={onRetryComplete}>
                  {t("profile.sso.completeRetry")}
                </Button>
              )
            }
          >
            {t("profile.sso.completeCancelled", { name: nameOf(outcome.provider) })}
          </Banner>
        )}
        {startFailed && <Banner tone="danger">{t("profile.sso.startFailed")}</Banner>}
        {rows.length === 0 ? (
          <p className="t-body t-muted">{t("profile.sso.none")}</p>
        ) : (
          <ul className="ap-list" style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {rows.map((p) => {
              const last = p.linked && isLastSignInMethod(profile, p.id);
              return (
                <li key={p.id} className="ap-listrow ap-listrow--wrap">
                  <div className="ap-listrow-main">
                    <b>{p.name}</b>
                    <span className="ap-row" style={{ display: "flex", gap: 6 }}>
                      <Icon
                        glyph={p.linked ? "check-circle" : "x-circle"}
                        size={16}
                        className={p.linked ? undefined : "t-muted"}
                      />
                      {p.linked ? t("profile.sso.linked") : t("profile.sso.notLinked")}
                    </span>
                  </div>
                  {p.linked ? (
                    <Button
                      variant="ghost-danger"
                      icon="unlink"
                      disabled={last}
                      aria-describedby={last ? LAST_METHOD_NOTE : undefined}
                      aria-label={t("profile.sso.unlinkLabel", { name: p.name })}
                      onClick={() => setUnlinking(p)}
                    >
                      {t("profile.sso.unlink")}
                    </Button>
                  ) : (
                    <Button
                      variant="secondary"
                      icon="link"
                      loading={starting === p.id}
                      disabled={starting !== null && starting !== p.id}
                      aria-label={t("profile.sso.linkLabel", { name: p.name })}
                      onClick={() => void link(p)}
                    >
                      {t("profile.sso.link")}
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {anyLast && (
          <p className="t-sm" id={LAST_METHOD_NOTE} style={{ margin: 0 }}>
            {t("profile.sso.lastMethod")}
          </p>
        )}
      </div>

      {unlinking && (
        <ConfirmDialog
          open
          onOpenChange={(open) => !open && setUnlinking(null)}
          icon="unlink"
          title={t("profile.sso.unlinkTitle", { name: unlinking.name })}
          description={t("profile.sso.unlinkText", { name: unlinking.name })}
          consequence={t("profile.sso.unlinkConsequence", { name: unlinking.name })}
          confirmLabel={t("profile.sso.unlink")}
          onConfirm={() => unlink(unlinking)}
        />
      )}
    </section>
  );
}
