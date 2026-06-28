import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

const variantClasses = {
  info: "bg-blue-50 border-blue-200 text-blue-800",
  warning: "bg-amber-50 border-amber-200 text-amber-800",
  danger: "bg-red-50 border-red-200 text-red-700",
} as const;

interface Props {
  variant: keyof typeof variantClasses;
  message: string;
  actions?: ReactNode;
  className?: string;
}

export function Alert({ variant, message, actions, className }: Props) {
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-4 border px-4 py-2.5",
        variantClasses[variant],
        className,
      )}
    >
      <p className="text-sm font-medium">{message}</p>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}
