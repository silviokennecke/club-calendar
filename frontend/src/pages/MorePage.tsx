import { Link, useOutletContext } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/lib/auth-context";
import { Icon, LangSwitch, type Glyph } from "@/components/ui/shared";
import { calendarBase } from "@/components/layout/navigation";
import { clubSettingsRoutes } from "@/components/settings/clubSettingsRoutes";
import { myClubPath } from "@/lib/club/myClub";
import type { ShellData } from "@/components/layout/shellTypes";
import { useContextHelpUrl } from "@/docs/contextHelp";
import { usePageTitle } from "@/lib/usePageTitle";

interface Row {
  labelKey: string;
  href: string;
  icon: Glyph;
}

/** Mobile "Mehr" page (design: Menu.dc.html): context, further areas, language, sign out. */
export default function MorePage() {
  const { t } = useTranslation();
  const helpUrl = useContextHelpUrl();
  usePageTitle(t("shell.more.title"));
  const { updateUser } = useAuth();
  const data = useOutletContext<ShellData>();
  const club = data.clubs.find((c) => c.id === data.clubId);
  const calendar = data.calendars.find((c) => c.id === data.calendarId);
  const fallback =
    data.contextState === "unavailable" ? t("shell.unavailable") : t("common.loading");
  const base = data.calendarId ? calendarBase(data.clubId, data.calendarId) : null;

  const rows: Row[] = [
    ...(base
      ? [
          { labelKey: "shell.nav.templates", href: `${base}/templates`, icon: "layers" as const },
          { labelKey: "shell.nav.settings", href: `${base}/settings`, icon: "sliders" as const },
        ]
      : []),
    { labelKey: "shell.nav.myClub", href: myClubPath(data.clubId), icon: "user" },
    { labelKey: "shell.nav.club", href: `/clubs/${data.clubId}`, icon: "building" },
    {
      labelKey: "shell.nav.clubSettings",
      href: clubSettingsRoutes(data.clubId).locations,
      icon: "map-pin",
    },
    { labelKey: "shell.more.allClubs", href: "/clubs?select=1", icon: "list" },
    { labelKey: "shell.profile", href: "/profile", icon: "user" },
  ];

  return (
    <div className="ap-wrap ap-wrap--narrow">
      <header className="ap-pagehead">
        <h1 className="t-h1">{t("shell.more.title")}</h1>
      </header>
      <div className="ap-stack ap-stack--lg">
        <section className="ap-panel ap-panel--sunken" aria-labelledby="more-ctx">
          <h2 className="t-label" id="more-ctx">
            {t("shell.more.workingIn")}
          </h2>
          <dl className="ap-stack ap-stack--sm" style={{ marginTop: 8 }}>
            <div>
              <dt className="t-sm t-muted">{t("shell.club")}</dt>
              <dd className="t-body m-0 font-bold">{club?.name ?? fallback}</dd>
            </div>
            <div>
              <dt className="t-sm t-muted">{t("shell.calendar")}</dt>
              <dd className="t-body m-0 font-bold">{calendar?.name ?? fallback}</dd>
            </div>
          </dl>
        </section>

        <section aria-labelledby="more-areas">
          <h2 className="t-label" id="more-areas" style={{ marginBottom: 8 }}>
            {t("shell.more.areas")}
          </h2>
          <div className="ap-panel ap-panel--flush">
            <nav className="ap-list" aria-label={t("shell.more.areasNav")}>
              {rows.map((row) => (
                <Link key={row.href} className="ap-listrow" to={row.href}>
                  <Icon glyph={row.icon} size={22} />
                  <span className="ap-listrow-main">
                    <b>{t(row.labelKey)}</b>
                  </span>
                  <Icon glyph="chevron-right" size={20} />
                </Link>
              ))}
              <Link className="ap-listrow" to={helpUrl} target="_blank" rel="noopener noreferrer">
                <Icon glyph="info" size={22} />
                <span className="ap-listrow-main">
                  <b>{t("docs.footerLink")}</b>
                  <span className="ap-sr"> ({t("docs.opensInNewTab")})</span>
                </span>
                <Icon glyph="chevron-right" size={20} />
              </Link>
            </nav>
          </div>
        </section>

        <section aria-labelledby="more-lang">
          <h2 className="t-label" id="more-lang" style={{ marginBottom: 8 }}>
            {t("shell.more.language")}
          </h2>
          <div className="ap-panel">
            <LangSwitch onChange={(language) => void updateUser({ language })} />
          </div>
        </section>

        <div className="ap-panel ap-panel--flush">
          <button type="button" className="ap-listrow" onClick={data.onLogout}>
            <Icon glyph="log-out" size={22} />
            <span className="ap-listrow-main">
              <b>{t("shell.signOut")}</b>
            </span>
            <Icon glyph="chevron-right" size={20} />
          </button>
        </div>
      </div>
    </div>
  );
}
