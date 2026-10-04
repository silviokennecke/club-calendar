import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { formatShortMonth, parseIso, type CalItem, type IsoDate } from "@/lib/calendar";
import { StatusBadge, Tag, type TagTone } from "@/components/ui/shared";
import { itemStatus, itemTimeText } from "./eventDisplay";
import { useLocale } from "./useLocale";

export interface EventItemTag {
  id: string;
  label: string;
  tone: TagTone;
}

interface EventItemProps {
  item: CalItem;
  /** Day shown in the date badge (defaults to the item's start). */
  day?: IsoDate;
  place?: string | null;
  tags?: EventItemTag[];
  /** Opens the event; holidays are never clickable. */
  onOpen?: (item: CalItem) => void;
  headingLevel?: "h3" | "h4";
  /** Status badge (default); the public view lists published events only and hides it. */
  showStatus?: boolean;
}

/**
 * Event card for lists (design: EventItem.dc.html = EventCard + status). The whole card is
 * clickable through the title button; status is shown as icon + word.
 */
export function EventItem({
  item,
  day,
  place,
  tags = [],
  onOpen,
  headingLevel = "h3",
  showStatus = true,
}: EventItemProps) {
  const { t } = useTranslation();
  const locale = useLocale();
  const status = itemStatus(item);
  const shown = day ?? item.start;
  const Heading = headingLevel;
  const meta = [itemTimeText(item, t), place].filter(Boolean).join(" · ");
  const clickable = !!onOpen && status !== "holiday";

  return (
    <article
      className={cn(
        "cc-card ap-evcard",
        status === "draft" && "ap-evcard--draft",
        status === "holiday" && "ap-evcard--holiday",
      )}
    >
      <div className="cc-date" aria-hidden="true">
        <b>{parseIso(shown).day}</b>
        <span>{formatShortMonth(shown, locale)}</span>
      </div>
      <div className="ap-grow">
        <div className="ap-evcard-head">
          <Heading>
            {clickable ? (
              <button
                type="button"
                className="ap-evcard-link"
                data-event-id={item.id}
                onClick={() => onOpen(item)}
              >
                {item.title}
              </button>
            ) : (
              <span>{item.title}</span>
            )}
            {item.icons && (
              <>
                {" "}
                <span className="ap-ico" role="img" aria-label={item.iconLabel}>
                  {item.icons}
                </span>
              </>
            )}
          </Heading>
          {showStatus && <StatusBadge status={status} />}
        </div>
        <p className="cc-meta">{meta}</p>
        {tags.length > 0 && (
          <div className="cc-tags">
            {tags.map((tag) => (
              <Tag key={tag.id} tone={tag.tone}>
                {tag.label}
              </Tag>
            ))}
          </div>
        )}
      </div>
    </article>
  );
}
