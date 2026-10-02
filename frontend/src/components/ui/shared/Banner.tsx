import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Icon, type Glyph } from "./Icon";

export type BannerTone = "info" | "warning" | "danger" | "success";

const ICONS: Record<BannerTone, Glyph> = {
  info: "info",
  warning: "alert",
  danger: "x-circle",
  success: "check-circle",
};

interface BannerProps {
  tone?: BannerTone;
  title?: ReactNode;
  children?: ReactNode;
  /** Optional action (e.g. a secondary Button/LinkButton). */
  action?: ReactNode;
  /** Override the default icon (e.g. "lock" for read-only). */
  icon?: Glyph;
  className?: string;
}

/** Persistent explanation. Danger banners are announced as alerts, others as status. */
export function Banner({ tone = "info", title, children, action, icon, className }: BannerProps) {
  return (
    <div
      className={cn("ap-banner", `ap-banner--${tone}`, className)}
      role={tone === "danger" ? "alert" : "status"}
    >
      <span className="ap-banner-icon">
        <Icon glyph={icon ?? ICONS[tone]} size={22} />
      </span>
      <div className="ap-grow">
        {title && <p className="t-label">{title}</p>}
        {children && <div className="t-sm">{children}</div>}
      </div>
      {action && <div className="ap-banner-action">{action}</div>}
    </div>
  );
}
