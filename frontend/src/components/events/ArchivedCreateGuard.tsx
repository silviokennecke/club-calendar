import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { EmptyState, LinkButton, Skeleton } from "@/components/ui/shared";
import { useEventPage } from "./useEventPage";

/**
 * Wraps the "create event" pages: archived calendars are read-only, so a direct call of
 * …/events/new* shows a notice instead of a form whose save the backend would reject (403).
 */
export function ArchivedCreateGuard({ children }: { children: ReactNode }) {
  const page = useEventPage();
  const { t } = useTranslation();
  if (page.calendarLoading) {
    return (
      <div className="ap-pagedialog" aria-busy="true">
        <Skeleton style={{ display: "block", height: 40, width: "50%" }} />
      </div>
    );
  }
  if (!page.isArchived) return <>{children}</>;
  return (
    <div className="ap-pagedialog">
      <EmptyState
        icon="lock"
        headingLevel="h1"
        title={t("events.new.archived.title")}
        text={t("events.new.archived.text")}
        actions={
          <LinkButton variant="secondary" icon="arrow-left" to={page.routes.list}>
            {t("events.new.archived.back")}
          </LinkButton>
        }
      />
    </div>
  );
}
