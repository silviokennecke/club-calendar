import { useTranslation } from "react-i18next";
import { Banner, CopyField } from "@/components/ui/shared";
import { requiresSecret, type FeedAddresses } from "@/lib/feeds";
import type { CalendarFeed } from "@/lib/types";

interface FeedAccessProps {
  feed: CalendarFeed;
  addresses: FeedAddresses;
  /** Shows the warning for private feeds (the edit page has its own secret panel). */
  withSecret?: boolean;
}

/**
 * The link to the public page of a feed (design: Feeds, FeedEdit) as a copy field; subscribing and
 * downloading happen there. Private feeds carry the secret in the link and get a warning.
 */
export function FeedAccess({ feed, addresses, withSecret }: FeedAccessProps) {
  const { t } = useTranslation();
  return (
    <div className="ap-stack">
      {withSecret && requiresSecret(feed.visibility) && (
        <Banner tone="warning">{t("feeds.access.secretWarning")}</Banner>
      )}
      <CopyField
        id={`feed-${feed.id}-web`}
        label={t("feeds.access.web")}
        value={addresses.web}
        openLabel={t("feeds.access.webOpen")}
        openHref={addresses.web}
        hint={t("feeds.access.webHint")}
      />
    </div>
  );
}
