import type { CSSProperties, DragEvent } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import type { CalItem } from "@/lib/calendar";
import { Icon } from "@/components/ui/shared";
import { itemStatus, itemSummary } from "./eventDisplay";

interface EventChipProps {
  item: CalItem;
  /** "bar" = month grid bar (single line), "block" = week column (wraps). */
  variant?: "bar" | "block";
  /** Text shown in bold before the title (start time or "Ganztägig"); omitted when empty. */
  timeLabel?: string;
  continuesBefore?: boolean;
  continuesAfter?: boolean;
  onOpen?: (item: CalItem) => void;
  /**
   * Hide the chip from assistive technology and the tab order (month grid: keyboard and
   * screen reader users reach events through the day cell and the day panel).
   */
  presentational?: boolean;
  draggable?: boolean;
  onDragStart?: (e: DragEvent<HTMLElement>, item: CalItem) => void;
  onDragEnd?: () => void;
  style?: CSSProperties;
}

/**
 * Event in a calendar grid (design: ap-evchip). Published = filled, draft = dashed + "Entwurf",
 * holiday = grey, italic with a flag (not clickable). Status never relies on colour alone.
 */
export function EventChip({
  item,
  variant = "bar",
  timeLabel,
  continuesBefore,
  continuesAfter,
  onOpen,
  presentational,
  draggable,
  onDragStart,
  onDragEnd,
  style,
}: EventChipProps) {
  const { t } = useTranslation();
  const status = itemStatus(item);
  const summary = itemSummary(item, t);
  const className = cn(
    "ap-evchip",
    `ap-evchip--${status}`,
    variant === "block" && "ap-evchip--block",
    continuesBefore && "ap-evchip--cl",
    continuesAfter && "ap-evchip--cr",
  );

  if (status === "holiday") {
    return (
      <span
        className={className}
        style={style}
        title={summary}
        aria-hidden={presentational || undefined}
      >
        <Icon glyph="flag" size={12} />
        <span className="t">{item.title}</span>
        <span className="ap-sr"> {t("calendar.chip.holiday")}</span>
      </span>
    );
  }

  return (
    <button
      type="button"
      className={className}
      style={style}
      title={summary}
      data-event-id={item.id}
      aria-hidden={presentational || undefined}
      tabIndex={presentational ? -1 : undefined}
      draggable={draggable || undefined}
      onDragStart={draggable ? (e) => onDragStart?.(e, item) : undefined}
      onDragEnd={draggable ? onDragEnd : undefined}
      onClick={(e) => {
        e.stopPropagation();
        onOpen?.(item);
      }}
    >
      {timeLabel && <b>{timeLabel}</b>}
      <span className="t">{item.title}</span>
      {item.icons && (
        <span className="ap-ico" role="img" aria-label={item.iconLabel}>
          {item.icons}
        </span>
      )}
      {item.isDraft ? (
        <span className="ap-evchip-draft">
          <Icon glyph="edit" size={10} />
          {t("calendar.chip.draft")}
        </span>
      ) : (
        <span className="ap-sr"> {t("calendar.chip.published")}</span>
      )}
    </button>
  );
}
