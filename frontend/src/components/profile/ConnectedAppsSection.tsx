import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Button,
  ConfirmDialog,
  EmptyState,
  Skeleton,
  StatusBadge,
  toast,
} from "@/components/ui/shared";
import { useAuth } from "@/lib/auth-context";
import { formatDate } from "@/lib/dateFormat";
import { useMcpGrants, useRevokeMcpGrant, type McpGrant } from "@/lib/mcp";

/**
 * "Connected apps" panel: AI clients (MCP) the user allowed, with their rights and last use; each can be
 * disconnected at once (`DELETE /api/auth/mcp-grants/:id` ends its tokens).
 */
export function ConnectedAppsSection() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const dateFormat = user?.dateFormat ?? "dd.MM.yyyy";
  const grants = useMcpGrants();
  const revoke = useRevokeMcpGrant();
  const [target, setTarget] = useState<McpGrant | null>(null);

  async function confirmRevoke() {
    if (!target) return;
    try {
      await revoke.mutateAsync(target.id);
      toast.success(t("profile.apps.revoked", { name: target.clientName }));
    } catch {
      toast.error(t("profile.apps.revokeFailed"));
    }
  }

  return (
    <section className="ap-panel" aria-labelledby="pr-apps">
      <div className="ap-panel-head">
        <div>
          <h2 className="t-h2" id="pr-apps">
            {t("profile.apps.title")}
          </h2>
          <p>{t("profile.apps.text")}</p>
        </div>
      </div>
      {grants.isPending ? (
        <div aria-busy="true">
          <p className="ap-sr" role="status">
            {t("profile.apps.loading")}
          </p>
          <Skeleton style={{ display: "block", height: 72 }} />
        </div>
      ) : grants.isError ? (
        <div className="ap-stack ap-stack--sm">
          <p role="alert">{t("profile.apps.loadFailed")}</p>
          <div>
            <Button variant="secondary" icon="refresh" onClick={() => void grants.refetch()}>
              {t("profile.apps.retry")}
            </Button>
          </div>
        </div>
      ) : grants.data.length === 0 ? (
        <EmptyState
          icon="link"
          headingLevel="h3"
          title={t("profile.apps.emptyTitle")}
          text={t("profile.apps.emptyText")}
        />
      ) : (
        <ul className="ap-stack ap-stack--sm" style={{ listStyle: "none", padding: 0 }}>
          {grants.data.map((g) => (
            <li
              key={g.id}
              className="ap-row"
              style={{
                justifyContent: "space-between",
                alignItems: "flex-start",
                gap: 12,
                flexWrap: "wrap",
              }}
            >
              <div className="ap-stack ap-stack--sm" style={{ minWidth: 0 }}>
                <p style={{ overflowWrap: "anywhere" }}>
                  <strong>{g.clientName}</strong>{" "}
                  <StatusBadge
                    status={g.scopes.includes("mcp:write") ? "draft" : "published"}
                    label={t(
                      g.scopes.includes("mcp:write")
                        ? "profile.apps.scopeWrite"
                        : "profile.apps.scopeRead",
                    )}
                  />
                </p>
                <p className="t-sm t-muted">
                  {t("profile.apps.connectedAt", { date: formatDate(g.createdAt, dateFormat) })}
                  {" · "}
                  {g.lastUsedAt
                    ? t("profile.apps.lastUsed", { date: formatDate(g.lastUsedAt, dateFormat) })
                    : t("profile.apps.neverUsed")}
                </p>
              </div>
              <Button
                variant="secondary"
                icon="unlink"
                aria-label={t("profile.apps.revokeLabel", { name: g.clientName })}
                onClick={() => setTarget(g)}
              >
                {t("profile.apps.revoke")}
              </Button>
            </li>
          ))}
        </ul>
      )}
      <ConfirmDialog
        open={target !== null}
        onOpenChange={(open) => {
          if (!open) setTarget(null);
        }}
        icon="unlink"
        title={t("profile.apps.confirmTitle", { name: target?.clientName ?? "" })}
        description={t("profile.apps.confirmText")}
        consequence={t("profile.apps.consequence")}
        confirmLabel={t("profile.apps.confirm")}
        onConfirm={confirmRevoke}
      />
    </section>
  );
}
