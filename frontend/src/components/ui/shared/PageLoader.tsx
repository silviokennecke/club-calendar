import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { Icon } from "./Icon";

interface FullPageLoaderProps {
  message?: string;
  className?: string;
}

export function FullPageLoader({ message, className }: FullPageLoaderProps) {
  const { t } = useTranslation();
  return (
    <div
      className={cn("ap-page flex items-center justify-center", className)}
      role="status"
      aria-busy="true"
    >
      <p className="t-sm t-muted flex items-center gap-2">
        <Icon glyph="loader" size={18} className="animate-spin motion-reduce:animate-none" />
        {message ?? t("common.loading")}
      </p>
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
    <div className={cn("ap-page flex items-center justify-center", className)} role="alert">
      <div className="text-center">
        {children}
        <p className="t-body font-semibold">{message}</p>
      </div>
    </div>
  );
}
