import { useTranslation } from "react-i18next";
import { Tag } from "@/components/ui/shared";
import type { CalendarFeed } from "@/lib/types";
import { feedAudienceIds } from "@/lib/feeds";
import type { useFeeds } from "./useFeeds";

/** Audience tags of a feed, or the words "Alle Gruppen" when it is not limited (design: Feeds). */
export function AudienceTags({
  feed,
  data,
}: {
  feed: CalendarFeed;
  data: Pick<ReturnType<typeof useFeeds>, "toneOf" | "nameOf">;
}) {
  const { t } = useTranslation();
  const ids = feedAudienceIds(feed);
  return (
    <div className="ap-chips" role="group" aria-label={t("feeds.audiencesOf", { name: feed.name })}>
      {ids.length === 0 ? (
        <span className="t-sm">{t("feeds.allAudiences")}</span>
      ) : (
        ids
          .filter((id) => data.nameOf(id))
          .map((id) => (
            <Tag key={id} tone={data.toneOf(id)}>
              {data.nameOf(id)}
            </Tag>
          ))
      )}
    </div>
  );
}
