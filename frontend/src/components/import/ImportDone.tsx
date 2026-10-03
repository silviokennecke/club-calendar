import { useEffect, useRef, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { formatEventDates } from "@/lib/events";
import { useLocale } from "@/components/calendar/useLocale";
import { Banner, Icon, LinkButton, Button } from "@/components/ui/shared";

/** Most events of the "not imported" list; the rest is summed up. */
const NOT_IMPORTED_LIMIT = 50;

export type ImportResult =
  | {
      kind: "ok";
      imported: number;
      drafts: number;
      published: number;
      newPlaces: string[];
      /** Events of the file the user left unselected. */
      unselected: number;
      /** Events of the file without a valid date or name. */
      invalid: number;
    }
  /** `imported` > 0: some chunks were created before the failure; `notImported` are the rest. */
  | {
      kind: "error";
      imported: number;
      notImported: { name: string; date: string; dateEnd: string }[];
    };

interface ImportDoneProps {
  result: ImportResult;
  calendarUrl: string;
  eventsUrl: string;
  onRetry: () => void;
  onAnother: () => void;
}

function Row({ badge, title, text }: { badge: ReactNode; title: string; text: string }) {
  return (
    <li className="ap-listrow">
      {badge}
      <span className="ap-listrow-main">
        <b>{title}</b>
        <span>{text}</span>
      </span>
    </li>
  );
}

/**
 * Step 3 of the import (design: ImportDone): result with what was created as a draft, new places
 * and skipped events, or the failure with a way back. The heading takes focus so screen readers
 * announce the result.
 */
export function ImportDone({
  result,
  calendarUrl,
  eventsUrl,
  onRetry,
  onAnother,
}: ImportDoneProps) {
  const { t } = useTranslation();
  const locale = useLocale();
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
  }, []);

  if (result.kind === "error") {
    const partial = result.imported > 0;
    return (
      <section className="ap-stack" aria-labelledby="fail-h">
        <h1 className="t-h1 ap-focus-target" id="fail-h" ref={heading} tabIndex={-1}>
          {t(partial ? "import.done.partial.heading" : "import.done.failed.heading")}
        </h1>
        <Banner
          tone="danger"
          title={t(partial ? "import.done.partial.title" : "import.done.failed.title")}
          action={
            partial ? undefined : (
              <Button variant="secondary" icon="refresh" onClick={onRetry}>
                {t("import.done.failed.retry")}
              </Button>
            )
          }
        >
          {partial
            ? t("import.done.partial.text", { count: result.imported })
            : t("import.done.failed.text")}
        </Banner>
        {partial && result.notImported.length > 0 && (
          <section className="ap-stack" aria-labelledby="not-imported-h">
            <h2 className="t-h3" id="not-imported-h">
              {t("import.done.partial.listHeading", { count: result.notImported.length })}
            </h2>
            <ul className="ap-list" style={{ listStyle: "none", margin: 0, padding: 0 }}>
              {result.notImported.slice(0, NOT_IMPORTED_LIMIT).map((ev, i) => (
                <li className="ap-listrow" key={i}>
                  <span className="ap-listrow-main">
                    <b>{ev.name}</b>
                    <span>{formatEventDates(ev, locale)}</span>
                  </span>
                </li>
              ))}
            </ul>
            {result.notImported.length > NOT_IMPORTED_LIMIT && (
              <p className="t-body t-muted">
                {t("import.done.partial.more", {
                  count: result.notImported.length - NOT_IMPORTED_LIMIT,
                })}
              </p>
            )}
          </section>
        )}
        <div className="ap-actions">
          <LinkButton variant="secondary" to={partial ? eventsUrl : calendarUrl}>
            {t(partial ? "import.done.allEvents" : "import.done.toCalendar")}
          </LinkButton>
          {!partial && (
            <Button variant="ghost" onClick={onAnother}>
              {t("import.done.otherFile")}
            </Button>
          )}
        </div>
      </section>
    );
  }

  const { drafts, published, newPlaces, unselected, invalid } = result;
  return (
    <section
      className="ap-panel ap-stack"
      style={{ alignItems: "center", textAlign: "center" }}
      aria-labelledby="done-h"
    >
      <span className="ap-empty-icon" style={{ width: 72, height: 72 }}>
        <Icon glyph="check-circle" size={40} />
      </span>
      <h1 className="t-h1 ap-focus-target" id="done-h" ref={heading} tabIndex={-1}>
        {t("import.done.heading", { count: result.imported })}
      </h1>
      <ul
        className="ap-list"
        style={{
          listStyle: "none",
          margin: 0,
          padding: 0,
          width: "100%",
          maxWidth: 520,
          textAlign: "left",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius-md)",
        }}
      >
        {drafts > 0 && (
          <Row
            badge={<span className="ap-badge ap-badge--draft">{t("common.draft")}</span>}
            title={t("import.done.drafts", { count: drafts })}
            text={t("import.done.draftsText")}
          />
        )}
        {published > 0 && (
          <Row
            badge={<span className="ap-badge ap-badge--published">{t("common.published")}</span>}
            title={t("import.done.published", { count: published })}
            text={t("import.done.publishedText")}
          />
        )}
        {newPlaces.length > 0 && (
          <Row
            badge={<span className="ap-badge ap-badge--new">{t("ui.status.new")}</span>}
            title={t("import.done.places", {
              count: newPlaces.length,
              names: newPlaces.join(", "),
            })}
            text={t("import.done.placesText")}
          />
        )}
        {unselected > 0 && (
          <Row
            badge={<span className="ap-badge">{t("import.done.skippedBadge")}</span>}
            title={t("import.done.unselected", { count: unselected })}
            text={t("import.done.unselectedText")}
          />
        )}
        {invalid > 0 && (
          <Row
            badge={<span className="ap-badge">{t("import.done.skippedBadge")}</span>}
            title={t("import.done.invalid", { count: invalid })}
            text={t("import.done.invalidText")}
          />
        )}
      </ul>
      <div className="ap-actions" style={{ justifyContent: "center" }}>
        <LinkButton to={calendarUrl}>{t("import.done.toCalendar")}</LinkButton>
        <LinkButton variant="secondary" to={eventsUrl}>
          {t("import.done.allEvents")}
        </LinkButton>
        <Button variant="ghost" onClick={onAnother}>
          {t("import.done.another")}
        </Button>
      </div>
    </section>
  );
}
