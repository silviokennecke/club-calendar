import { useEffect, useRef, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { IMPORT_MAX, replacedZones } from "@/lib/import";
import type { ImportWarning } from "@/lib/types";
import { Banner, Icon, LinkButton, Button } from "@/components/ui/shared";

export type ImportResult =
  | {
      kind: "ok";
      imported: number;
      /** Duplicates the backend skipped (only with `skipDuplicates`). */
      skipped: number;
      drafts: number;
      published: number;
      newPlaces: string[];
      /** Events of the file the user left unselected. */
      unselected: number;
      /** Events of the file without a valid date or name. */
      invalid: number;
      /** E.g. unknown time zones of the file replaced by the calendar's zone. */
      warnings: ImportWarning[];
    }
  /** The import is atomic: on failure nothing was created. */
  | { kind: "error"; reason: "failed" | "tooMany" };

interface ImportDoneProps {
  result: ImportResult;
  calendarUrl: string;
  eventsUrl: string;
  /** The calendar's zone (named when unknown zones of the file were replaced). */
  timeZone: string | null;
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
 * Step 3 of the import (design: ImportDone): result with what was created, new places, skipped
 * events and warnings, or the failure (nothing was created) with a way back. The heading takes
 * focus so screen readers announce the result.
 */
export function ImportDone({
  result,
  calendarUrl,
  eventsUrl,
  timeZone,
  onRetry,
  onAnother,
}: ImportDoneProps) {
  const { t, i18n } = useTranslation();
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
  }, []);

  if (result.kind === "error") {
    const tooMany = result.reason === "tooMany";
    return (
      <section className="ap-stack" aria-labelledby="fail-h">
        <h1 className="t-h1 ap-focus-target" id="fail-h" ref={heading} tabIndex={-1}>
          {t("import.done.failed.heading")}
        </h1>
        <Banner
          tone="danger"
          title={t("import.done.failed.title")}
          action={
            <Button variant="secondary" icon={tooMany ? "arrow-left" : "refresh"} onClick={onRetry}>
              {t(tooMany ? "import.done.failed.backToReview" : "import.done.failed.retry")}
            </Button>
          }
        >
          {tooMany
            ? t("import.done.failed.tooMany", { max: IMPORT_MAX.toLocaleString(i18n.language) })
            : t("import.done.failed.text")}
        </Banner>
        <div className="ap-actions">
          <LinkButton variant="secondary" to={calendarUrl}>
            {t("import.done.toCalendar")}
          </LinkButton>
          <Button variant="ghost" onClick={onAnother}>
            {t("import.done.otherFile")}
          </Button>
        </div>
      </section>
    );
  }

  const { drafts, published, newPlaces, unselected, invalid, skipped } = result;
  const zones = replacedZones(result.warnings);
  const zoneWarnings = new Set(
    result.warnings.filter((w) => w.code === "timezone_replaced").map((w) => w.index),
  ).size;
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
        {skipped > 0 && (
          <Row
            badge={<span className="ap-badge">{t("import.done.skippedBadge")}</span>}
            title={t("import.done.duplicatesSkipped", { count: skipped })}
            text={t("import.done.duplicatesSkippedText")}
          />
        )}
        {zones.zones.length > 0 && (
          <Row
            badge={
              <span className="ap-badge">
                <Icon glyph="clock" size={14} />
                {t("import.done.timezoneBadge")}
              </span>
            }
            title={t("import.done.timezone", { count: zoneWarnings })}
            text={t("import.done.timezoneText", {
              zones: zones.zones.join(", "),
              zone: zones.replacement || timeZone || "UTC",
            })}
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
