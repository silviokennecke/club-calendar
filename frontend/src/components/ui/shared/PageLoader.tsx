import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface FullPageLoaderProps {
  message?: string;
  className?: string;
}

export function FullPageLoader({ message = "Loading…", className }: FullPageLoaderProps) {
  return (
    <div className={cn("flex min-h-screen items-center justify-center bg-slate-50", className)}>
      <p className="text-sm text-slate-400">{message}</p>
    </div>
  );
}

interface FullPageErrorProps {
  message: string;
  children?: ReactNode;
  className?: string;
}

export function FullPageError({ message, children, className }: FullPageErrorProps) {
  return (
    <div className={cn("flex min-h-screen items-center justify-center bg-slate-50", className)}>
      <div className="text-center">
        {children}
        <p className="font-medium text-slate-600">{message}</p>
      </div>
    </div>
  );
}
