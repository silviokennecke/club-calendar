import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Banner } from "@/components/ui/shared";
import { ClubSettingsTabs } from "@/components/layout/SettingsTabs";
import { useClubSettingsPage } from "./useClubSettingsPage";
import { usePageTitle } from "@/lib/usePageTitle";

interface ClubSettingsLayoutProps {
  /** Wide frame (places with map) instead of the narrow one. */
  wide?: boolean;
  /** Buttons next to the heading. */
  actions?: ReactNode;
  children: ReactNode;
}

/**
 * Frame of the club settings pages (locations, target groups): heading with the club, the tabs and
 * the content. Club data has no archived state; only a too low club role makes the page read-only.
 */
export function ClubSettingsLayout({ wide, actions, children }: ClubSettingsLayoutProps) {
  const { t } = useTranslation();
  usePageTitle(t("settings.club.title"));
  const page = useClubSettingsPage();

  return (
    <div className={wide ? "ap-wrap" : "ap-wrap--narrow"}>
      <header className="ap-pagehead">
        <div>
          <h1 className="t-h1">{t("settings.club.title")}</h1>
          <p className="t-body">{page.club?.name}</p>
        </div>
        {actions && <div className="ap-actions">{actions}</div>}
      </header>
      <ClubSettingsTabs clubId={page.clubId} role={page.club?.role} />
      <div className="ap-stack ap-stack--lg">
        {!page.canEdit && !page.roleLoading && (
          <Banner tone="info" icon="lock">
            {t("shell.roleReadOnly")}
          </Banner>
        )}
        {children}
      </div>
    </div>
  );
}
