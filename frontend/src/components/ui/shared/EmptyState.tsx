import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface Props {
  message: string;
  icon?: ReactNode;
  className?: string;
}

export function EmptyState({ message, icon, className }: Props) {
  return (
    <div
      className={cn(
        "rounded-xl border border-dashed border-slate-200 py-12 text-center text-sm text-slate-400",
        className,
      )}
    >
      {icon && <div className="mb-2">{icon}</div>}
      {message}
    </div>
  );
}
