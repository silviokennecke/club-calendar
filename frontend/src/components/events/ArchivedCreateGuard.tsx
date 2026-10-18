import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { EmptyState, LinkButton, Skeleton } from "@/components/ui/shared";
import { useEventPage } from "./useEventPage";

/**
 * Wraps the "create" pages: archived calendars and too low club roles are read-only, so a direct call of
 * …/events/new* shows a notice instead of a form whose save the backend would reject (403).
 */
export function ArchivedCreateGuard({
  children,
  require = "editor",
}: {
  children: ReactNode;
  /** Club role needed to create: editor (events, templates, import) or admin (feeds). */
  require?: "editor" | "admin";
}) {
  const page = useEventPage();
  const { t } = useTranslation();
  if (page.calendarLoading || page.roleLoading) {
    return (
      <div className="ap-pagedialog" aria-busy="true">
        <Skeleton style={{ display: "block", height: 40, width: "50%" }} />
      </div>
    );
  }
  const allowed = require === "admin" ? page.isAdmin : page.roleCanEdit;
  if (!page.isArchived && allowed) return <>{children}</>;
  const forbidden = !page.isArchived;
  return (
    <div className="ap-pagedialog">
      <EmptyState
        icon="lock"
        headingLevel="h1"
        title={t(forbidden ? "events.new.forbidden.title" : "events.new.archived.title")}
        text={t(forbidden ? "shell.roleReadOnly" : "events.new.archived.text")}
        actions={
          <LinkButton variant="secondary" icon="arrow-left" to={page.routes.list}>
            {t("events.new.archived.back")}
          </LinkButton>
        }
      />
    </div>
  );
}
