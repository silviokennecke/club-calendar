import { useTranslation } from "react-i18next";
import { EmptyState, LinkButton } from "@/components/ui/shared";

/** Feeds are not readable for viewers (the backend answers 403): notice instead of the feeds UI. */
export function FeedsForbidden({ calendarHref }: { calendarHref: string }) {
  const { t } = useTranslation();
  return (
    <div className="ap-wrap--narrow">
      <EmptyState
        icon="lock"
        headingLevel="h1"
        title={t("feeds.forbidden.title")}
        text={t("feeds.forbidden.text")}
        actions={
          <LinkButton variant="secondary" icon="arrow-left" to={calendarHref}>
            {t("feeds.forbidden.back")}
          </LinkButton>
        }
      />
    </div>
  );
}
