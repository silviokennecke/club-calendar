import { useTranslation } from "react-i18next";
import { Banner, CopyField } from "@/components/ui/shared";
import { requiresSecret, type FeedAddresses } from "@/lib/feeds";
import type { CalendarFeed } from "@/lib/types";

interface FeedAccessProps {
  feed: CalendarFeed;
  addresses: FeedAddresses;
  /** Shows the secret and the warning for private feeds (the edit page has its own secret panel). */
  withSecret?: boolean;
}

/**
 * The addresses of a feed as copy fields (design: Feeds, FeedEdit): secret (private feeds), ICS
 * address, webcal subscription and web view. The secret is masked until revealed and the state is
 * always carried by words and icons, never by color alone.
 */
export function FeedAccess({ feed, addresses, withSecret }: FeedAccessProps) {
  const { t } = useTranslation();
  const id = `feed-${feed.id}`;
  return (
    <div className="ap-stack">
      {withSecret && requiresSecret(feed.visibility) && (
        <>
          <CopyField
            id={`${id}-secret`}
            label={t("feeds.access.secret")}
            value={feed.sharedSecret}
            secret
            hint={t("feeds.access.secretHint")}
          />
          <Banner tone="warning">{t("feeds.access.secretWarning")}</Banner>
        </>
      )}
      <CopyField
        id={`${id}-web`}
        label={t("feeds.access.web")}
        value={addresses.web}
        openLabel={t("feeds.access.webOpen")}
        openHref={addresses.web}
        hint={t("feeds.access.webHint")}
      />
      <CopyField
        id={`${id}-ics`}
        label={t("feeds.access.ics")}
        value={addresses.ics}
        hint={t("feeds.access.icsHint")}
      />
      <CopyField
        id={`${id}-webcal`}
        label={t("feeds.access.webcal")}
        value={addresses.webcal}
        openLabel={t("feeds.access.webcalOpen")}
        openHref={addresses.webcal}
        hint={t("feeds.access.webcalHint")}
      />
    </div>
  );
}
