import type { ReactNode, Ref } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { usePageTitle } from "@/lib/usePageTitle";
import { LegalLinks } from "@/components/legal/LegalLinks";
import { HelpFooterLink } from "@/components/help/HelpFooterLink";
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
  /** Content above the heading inside the card (e.g. the setup Stepper). */
  top?: ReactNode;
  /** Replaces the language switch in the header (e.g. user name + sign out). */
  headerEnd?: ReactNode;
  /** Page layout without a card (club picker): heading and children sit directly on the page. */
  bare?: boolean;
  /** Ref for the h1, so flows can move focus to it when the step changes. */
  headingRef?: Ref<HTMLHeadingElement>;
  /** Imprint / privacy / terms links below the card; off where no router or query client exists (error page). */
  legalLinks?: boolean;
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
  top,
  headerEnd,
  bare,
  headingRef,
  legalLinks = true,
  children,
}: AuthLayoutProps) {
  const { t } = useTranslation();
  usePageTitle(typeof title === "string" ? title : null);
  const heading = (
    <h1 className="t-h1 ap-focus-target" tabIndex={headingRef ? -1 : undefined} ref={headingRef}>
      {title}
    </h1>
  );
  const head = intro ? (
    <div className="ap-stack ap-stack--sm">
      {heading}
      <div className={cn("t-body", bare && "t-muted")}>{intro}</div>
    </div>
  ) : (
    heading
  );
  const footerLinks = legalLinks && (
    <div className="legal-links">
      <LegalLinks />
      <HelpFooterLink />
    </div>
  );
  return (
    <div className="ap ap-auth">
      <a className="ap-skip cc-btn cc-btn--primary" href="#main">
        {t("shell.skipToContent")}
      </a>
      <header className="ap-auth-top">
        <Logo />
        {headerEnd ?? <LangSwitch />}
      </header>
      <main
        className="ap-auth-body"
        id="main"
        tabIndex={-1}
        style={bare ? { alignItems: "flex-start" } : undefined}
      >
        {bare ? (
          <div className="ap-wrap ap-stack ap-stack--lg" style={{ width: "100%" }}>
            {head}
            {children}
            {footerLinks}
          </div>
        ) : (
          <div className="ap-auth-col">
            <div className={cn("ap-authcard", wide && "ap-authcard--wide")}>
              {top}
              {icon && (
                <span className={cn("ap-dialog-icon", TONE_CLASS[iconTone])} aria-hidden="true">
                  <Icon glyph={icon} size={24} />
                </span>
              )}
              {head}
              {children}
              {footer && <p className="ap-auth-foot">{footer}</p>}
            </div>
            {footerLinks}
          </div>
        )}
      </main>
    </div>
  );
}
