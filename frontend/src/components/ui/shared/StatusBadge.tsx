import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { Icon, type Glyph } from "./Icon";

export type Status =
  | "published"
  | "draft"
  | "holiday"
  | "archived"
  | "new"
  | "private"
  | "public"
  | "club"
  | "searchable"
  | "danger";

const ICONS: Record<Status, Glyph> = {
  published: "check",
  draft: "edit",
  holiday: "flag",
  archived: "archive",
  new: "plus",
  private: "lock",
  public: "globe",
  club: "users",
  searchable: "search",
  danger: "alert",
};

interface StatusBadgeProps {
  status: Status;
  /** Overrides the default word (e.g. "Archiviert, schreibgeschützt"). */
  label?: string;
  className?: string;
}

/** Status is always shown as icon + word; color only supports it. */
export function StatusBadge({ status, label, className }: StatusBadgeProps) {
  const { t } = useTranslation();
  const kind: Status = status in ICONS ? status : "published";
  return (
    <span className={cn("ap-badge", `ap-badge--${kind}`, className)} data-status={kind}>
      <Icon glyph={ICONS[kind]} size={14} />
      {label ?? t(`ui.status.${kind}`)}
    </span>
  );
}
