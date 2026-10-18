import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Banner, Button, Skeleton } from "@/components/ui/shared";
import { SettingsTabs } from "@/components/layout/SettingsTabs";
import { useSettingsPage } from "./useSettingsPage";
import { useCalendarActions } from "./useCalendarActions";

interface SettingsLayoutProps {
  /** Wide frame (places with map) instead of the narrow one. */
  wide?: boolean;
  /** Buttons next to the heading. */
  actions?: ReactNode;
  children: ReactNode;
}

/**
 * Frame of all calendar settings pages (design: Settings*): heading with club and calendar,
 * the tabs, the read-only banner of archived calendars and the content. Children render once the
 * calendar is loaded, so an archived calendar never flashes editable controls.
 */
export function SettingsLayout({ wide, actions, children }: SettingsLayoutProps) {
  const { t } = useTranslation();
  const page = useSettingsPage();
  const actionsApi = useCalendarActions(page.clubId, page.calendarId, page.calendar?.name);

  let body: ReactNode;
  if (page.calendarLoading) {
    body = (
      <div className="ap-stack" aria-busy="true">
        <p className="ap-sr" role="status">
          {t("settings.loading")}
        </p>
        <Skeleton style={{ display: "block", height: 160 }} />
        <Skeleton style={{ display: "block", height: 160 }} />
      </div>
    );
  } else if (page.calendarFailed) {
    body = (
      <Banner
        tone="danger"
        title={t("settings.loadError.title")}
        action={
          <Button variant="secondary" icon="refresh" onClick={page.reloadCalendar}>
            {t("settings.loadError.retry")}
          </Button>
        }
      >
        {t("settings.loadError.text")}
      </Banner>
    );
  } else {
    body = (
      <>
        {page.isArchived && (
          <Banner
            tone="warning"
            icon="lock"
            title={t("shell.archivedReadOnly")}
            action={
              page.isAdmin && (
                <Button
                  variant="secondary"
                  onClick={actionsApi.unarchive}
                  loading={actionsApi.busy === "unarchive"}
                >
                  {t("calendar.archived.unarchive")}
                </Button>
              )
            }
          >
            {t("settings.archived.text")}
          </Banner>
        )}
        {!page.isArchived && !page.roleCanEdit && !page.roleLoading && (
          <Banner tone="info" icon="lock">
            {t("shell.roleReadOnly")}
          </Banner>
        )}
        {children}
      </>
    );
  }

  return (
    <div className={wide ? "ap-wrap" : "ap-wrap--narrow"}>
      <header className="ap-pagehead">
        <div>
          <h1 className="t-h1">{t("settings.title")}</h1>
          <p className="t-body">
            {[page.club?.name, page.calendar?.name].filter(Boolean).join(" · ")}
          </p>
        </div>
        {actions && <div className="ap-actions">{actions}</div>}
      </header>
      <SettingsTabs clubId={page.clubId} calendarId={page.calendarId} />
      <div className="ap-stack ap-stack--lg">{body}</div>
    </div>
  );
}
