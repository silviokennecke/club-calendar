import { Component, useEffect, useRef, type ErrorInfo, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useRouteError } from "react-router-dom";
import { AuthLayout } from "@/components/auth/AuthLayout";
import { Button, buttonClass, type Glyph } from "@/components/ui/shared";
import { classifyError, type ErrorKind } from "@/lib/loadError";

const ICONS: Record<ErrorKind, Glyph> = { notFound: "search", load: "refresh", generic: "alert" };

// Last fallback when the texts are not available (i18n not initialised, or the error is in the
// provider tree before it): German, the app's source language. The only hard-coded UI strings.
const EMERGENCY = {
  title: "Da ist etwas schiefgelaufen",
  text: "Die Seite konnte nicht geladen werden. Möglicherweise wurde die Anwendung gerade aktualisiert.",
  reload: "Seite neu laden",
  home: "Zur Startseite",
};

function reloadPage() {
  window.location.reload();
}

/** Details for developers only: the block does not exist in a production build. */
function DevDetails({ error }: { error: unknown }) {
  const { t } = useTranslation();
  if (!import.meta.env.DEV || !error) return null;
  const text = error instanceof Error ? (error.stack ?? error.message) : String(error);
  return (
    <details className="t-sm">
      <summary>{t("errorPage.details")}</summary>
      <pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{text}</pre>
    </details>
  );
}

interface ErrorScreenProps {
  kind: ErrorKind;
  /** Shown under a collapsible detail in development only. */
  error?: unknown;
}

/**
 * Full-page error state (design: AuthLayout card with the EmptyState wording, h1 focused on
 * display). Needs only i18n: no router, auth or query context, so it also works as the boundary
 * around the whole provider tree. The navigation uses plain links and a reload (a fresh document
 * is the most robust way out of a broken app state).
 */
export function ErrorScreen({ kind, error }: ErrorScreenProps) {
  const { t, i18n } = useTranslation();
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    headingRef.current?.focus({ preventScroll: true });
  }, []);
  const texts = i18n.isInitialized && i18n.exists(`errorPage.${kind}.title`);

  if (!texts) {
    return (
      <div className="ap ap-auth">
        <main className="ap-auth-body" id="main" tabIndex={-1}>
          <div className="ap-authcard">
            <h1 className="t-h1 ap-focus-target" tabIndex={-1} ref={headingRef}>
              {EMERGENCY.title}
            </h1>
            <p className="t-body">{EMERGENCY.text}</p>
            <div className="ap-actions">
              <button type="button" className={buttonClass("primary")} onClick={reloadPage}>
                {EMERGENCY.reload}
              </button>
              <a className={buttonClass("secondary")} href="/">
                {EMERGENCY.home}
              </a>
            </div>
          </div>
        </main>
      </div>
    );
  }

  return (
    <AuthLayout
      title={t(`errorPage.${kind}.title`)}
      intro={t(`errorPage.${kind}.text`)}
      icon={ICONS[kind]}
      iconTone={kind === "generic" ? "danger" : "neutral"}
      headingRef={headingRef}
      legalLinks={false}
    >
      <div className="ap-actions">
        <Button icon="refresh" onClick={reloadPage}>
          {t("errorPage.reload")}
        </Button>
        <a className={buttonClass("secondary")} href="/">
          {t("errorPage.home")}
        </a>
        {kind === "notFound" && window.history.length > 1 && (
          <Button variant="ghost" icon="arrow-left" onClick={() => window.history.back()}>
            {t("common.back")}
          </Button>
        )}
      </div>
      <DevDetails error={error} />
    </AuthLayout>
  );
}

/** `errorElement` of the data router: render errors, failed chunk loads and thrown route responses. */
export function RouteErrorPage() {
  const error = useRouteError();
  return <ErrorScreen kind={classifyError(error)} error={error} />;
}

/** Unknown URL (catch-all route of the pages). */
export function NotFoundPage() {
  return <ErrorScreen kind="notFound" />;
}

interface BoundaryState {
  error: unknown;
  failed: boolean;
}

/**
 * Outermost boundary (main.tsx): catches errors the router's `errorElement` cannot, e.g. in the
 * theme provider or the router itself.
 */
export class AppErrorBoundary extends Component<{ children: ReactNode }, BoundaryState> {
  state: BoundaryState = { error: null, failed: false };

  static getDerivedStateFromError(error: unknown): BoundaryState {
    return { error, failed: true };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error("Unhandled render error", error, info.componentStack);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return <ErrorScreen kind={classifyError(this.state.error)} error={this.state.error} />;
  }
}
