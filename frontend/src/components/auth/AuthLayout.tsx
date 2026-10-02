import { useEffect, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { Icon, LangSwitch, Logo, type Glyph } from "@/components/ui/shared";

interface AuthLayoutProps {
  /** The page's h1. */
  title: ReactNode;
  /** Explanation below the h1. */
  intro?: ReactNode;
  /** Round icon above the heading (decorative). */
  icon?: Glyph;
  iconTone?: "brand" | "neutral" | "danger";
  /** Wider card (confirmation pages). */
  wide?: boolean;
  /** Line below the card content, e.g. "No account? Register". */
  footer?: ReactNode;
  children?: ReactNode;
}

const TONE_CLASS = {
  brand: "ap-dialog-icon--brand",
  neutral: "ap-dialog-icon--neutral",
  danger: "",
} as const;

/**
 * Frame for all unauthenticated pages: skip link, header with logo and language switch,
 * centered card with h1, <main id="main">.
 */
export function AuthLayout({
  title,
  intro,
  icon,
  iconTone = "brand",
  wide,
  footer,
  children,
}: AuthLayoutProps) {
  const { t } = useTranslation();
  useEffect(() => {
    if (typeof title !== "string") return;
    const previous = document.title;
    document.title = `${title} – Club Calendar`;
    return () => {
      document.title = previous;
    };
  }, [title]);
  return (
    <div className="ap ap-auth">
      <a className="ap-skip cc-btn cc-btn--primary" href="#main">
        {t("shell.skipToContent")}
      </a>
      <header className="ap-auth-top">
        <Logo />
        <LangSwitch />
      </header>
      <main className="ap-auth-body" id="main" tabIndex={-1}>
        <div className={cn("ap-authcard", wide && "ap-authcard--wide")}>
          {icon && (
            <span className={cn("ap-dialog-icon", TONE_CLASS[iconTone])} aria-hidden="true">
              <Icon glyph={icon} size={24} />
            </span>
          )}
          {intro ? (
            <div className="ap-stack ap-stack--sm">
              <h1 className="t-h1">{title}</h1>
              <div className="t-body">{intro}</div>
            </div>
          ) : (
            <h1 className="t-h1">{title}</h1>
          )}
          {children}
          {footer && <p className="ap-auth-foot">{footer}</p>}
        </div>
      </main>
    </div>
  );
}
