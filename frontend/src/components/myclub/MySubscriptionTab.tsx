import { useTranslation } from "react-i18next";
import { EmptyState } from "@/components/ui/shared";

/** Tab "Abo" of Mein Verein: choose feeds and audiences, copy the personal subscription address. */
export function MySubscriptionTab({ clubId }: { clubId: string }) {
  const { t } = useTranslation();
  return (
    <div data-club-id={clubId}>
      <EmptyState
        icon="rss"
        title={t("myClub.subscription.emptyTitle")}
        text={t("myClub.subscription.emptyText")}
      />
    </div>
  );
}
