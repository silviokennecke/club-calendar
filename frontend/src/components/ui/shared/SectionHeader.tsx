import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface Props {
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}

export function SectionHeader({ title, description, action, className }: Props) {
  return (
    <div className={cn("ap-pagehead", className)} style={{ alignItems: "center" }}>
      <div>
        <h2 className="t-h3">{title}</h2>
        {description && <p className="t-sm">{description}</p>}
      </div>
      {action}
    </div>
  );
}
