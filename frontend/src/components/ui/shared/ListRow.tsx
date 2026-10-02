import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface Props {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  className?: string;
}

export function ListRow({ title, subtitle, actions, className }: Props) {
  return (
    <div className={cn("ap-listrow", className)}>
      <div className="ap-listrow-main">
        <b>{title}</b>
        {subtitle && <span>{subtitle}</span>}
      </div>
      {actions && <div className="ap-actions shrink-0">{actions}</div>}
    </div>
  );
}
