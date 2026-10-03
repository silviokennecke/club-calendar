import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Button, Icon } from "@/components/ui/shared";
import { apiGet } from "@/lib/api";
import { providerRows, type ProviderInfo } from "@/lib/profile";

/**
 * "Verknüpfte Anmeldungen" (design: Profile). The backend only reports which providers are linked
 * (`/api/auth/me`) and which are offered (`/api/auth/providers`); linking and unlinking from the
 * profile is not possible yet, so the actions are shown disabled ("Bald verfügbar").
 */
export function LinkedLoginsSection({ linked }: { linked: { provider: string }[] }) {
  const { t } = useTranslation();
  const offered = useQuery<ProviderInfo[]>({
    queryKey: ["authProviders"],
    queryFn: () => apiGet<ProviderInfo[]>("/api/auth/providers"),
    retry: false,
    staleTime: 5 * 60_000,
  });
  const rows = providerRows(linked, offered.data ?? []);

  return (
    <section className="ap-panel" aria-labelledby="pr-sso">
      <div className="ap-panel-head">
        <div>
          <h2 className="t-h2" id="pr-sso">
            {t("profile.sso.title")}
          </h2>
          <p>{t("profile.sso.text")}</p>
        </div>
      </div>
      {rows.length === 0 ? (
        <p className="t-body t-muted">{t("profile.sso.none")}</p>
      ) : (
        <>
          <ul className="ap-list" style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {rows.map((p) => (
              <li key={p.id} className="ap-listrow ap-listrow--wrap">
                <div className="ap-listrow-main">
                  <b>{p.name}</b>
                  <span className="ap-row" style={{ gap: 6 }}>
                    <Icon glyph={p.linked ? "check-circle" : "minus"} size={16} />
                    {p.linked ? t("profile.sso.linked") : t("profile.sso.notLinked")}
                  </span>
                </div>
                <Button
                  variant={p.linked ? "ghost-danger" : "secondary"}
                  icon={p.linked ? "unlink" : "link"}
                  disabled
                  aria-describedby="pr-sso-soon"
                  aria-label={t(p.linked ? "profile.sso.unlinkLabel" : "profile.sso.linkLabel", {
                    name: p.name,
                  })}
                >
                  {p.linked ? t("profile.sso.unlink") : t("profile.sso.link")}
                </Button>
              </li>
            ))}
          </ul>
          <p className="t-sm" id="pr-sso-soon" style={{ margin: "var(--space-3) 0 0" }}>
            {t("profile.sso.soon")}
          </p>
        </>
      )}
    </section>
  );
}
