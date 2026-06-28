import type { ReactNode } from "react";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

interface Props {
  label: ReactNode;
  description?: string;
  children: ReactNode;
  className?: string;
}

export function FormField({ label, description, children, className }: Props) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <Label>{label}</Label>
      {description && <p className="text-xs text-slate-400">{description}</p>}
      {children}
    </div>
  );
}
