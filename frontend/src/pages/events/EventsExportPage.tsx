import { useMemo, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { apiGet } from "@/lib/api";
import { formatMonthTitle, yearMonthOf } from "@/lib/calendar";
import {
  buildIcs,
  downloadTextFile,
  icsFileName,
  monthBounds,
  selectForExport,
  type ExportRange,
} from "@/lib/events";
import type { TargetGroup } from "@/lib/types";
import {
  Banner,
  Button,
  Field,
  FilterPillGroup,
  Icon,
  LinkButton,
  TextInput,
  toast,
} from "@/components/ui/shared";
import { useAllEvents, useEventPage } from "@/components/events/useEventPage";
import { useLocale } from "@/components/calendar/useLocale";

/**
 * Export (design: Export, route …/events/export). The backend has no export endpoint, so the ICS
 * file is built in the browser from the calendar's events (lib/events/ics.ts).
 */
export default function EventsExportPage() {
  const page = useEventPage();
  const { t } = useTranslation();
  const locale = useLocale();
  const events = useAllEvents(page.calendarId);
  const groups = useQuery<TargetGroup[]>({
    queryKey: ["targetGroups", page.calendarId],
    queryFn: () => apiGet(`/api/calendars/${page.calendarId}/target-groups`),
  });

  const [first, last] = monthBounds(page.today);
  const [range, setRange] = useState<ExportRange>("all");
  const [from, setFrom] = useState(first);
  const [to, setTo] = useState(last);
  const [includeDrafts, setIncludeDrafts] = useState(false);
  const [groupIds, setGroupIds] = useState<string[]>([]);

  const selected = useMemo(
    () =>
      selectForExport(events.data ?? [], {
        range,
        today: page.today,
        from,
        to,
        includeDrafts,
        groupIds,
      }),
    [events.data, range, page.today, from, to, includeDrafts, groupIds],
  );
  const customInvalid = range === "custom" && !!from && !!to && to < from;
  const n = customInvalid ? 0 : selected.length;
  const calendarName = page.calendar?.name ?? "";

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (n === 0) return;
    const ics = buildIcs(selected, {
      calendarName,
      timeZone: page.timeZone,
      labels: {
        features: t("events.export.ics.features"),
        targetGroups: t("events.export.ics.targetGroups"),
      },
    });
    downloadTextFile(ics, icsFileName(calendarName));
    toast.success(t("events.export.done"));
  }

  const ranges: { key: ExportRange; label: string; hint: string }[] = [
    {
      key: "all",
      label: t("events.export.range.all"),
      hint: t("events.export.range.allHint", { calendar: calendarName }),
    },
    {
      key: "month",
      label: t("events.export.range.month"),
      hint: formatMonthTitle(yearMonthOf(page.today), locale),
    },
    {
      key: "custom",
      label: t("events.export.range.custom"),
      hint: t("events.export.range.customHint"),
    },
  ];

  return (
    <div className="ap-wrap--narrow ap-stack ap-stack--lg">
      <div>
        <Link className="ap-back" to={page.routes.list}>
          <Icon glyph="arrow-left" size={18} />
          {t("events.export.back")}
        </Link>
      </div>
      <header className="ap-pagehead" style={{ marginBottom: 0 }}>
        <div>
          <h1 className="t-h1">{t("events.export.title")}</h1>
          <p className="t-body t-prose">{t("events.export.intro")}</p>
          <p className="t-sm" style={{ marginTop: "var(--space-2)" }}>
            <Link className="ap-link" to={page.routes.feeds}>
              {t("events.export.feeds")}
            </Link>
          </p>
        </div>
      </header>

      {events.isError && (
        <Banner
          tone="danger"
          title={t("events.list.error.title")}
          action={
            <Button variant="secondary" icon="refresh" onClick={() => events.refetch()}>
              {t("events.list.error.retry")}
            </Button>
          }
        >
          {t("events.list.error.text")}
        </Banner>
      )}

      <form className="ap-form" noValidate onSubmit={onSubmit}>
        <section className="ap-panel ap-form-section" aria-labelledby="x-range">
          <h2 className="t-h2" id="x-range">
            {t("events.export.range.title")}
          </h2>
          <fieldset className="ap-fieldset">
            <legend className="ap-sr">{t("events.export.range.title")}</legend>
            {ranges.map((r) => (
              <label key={r.key} className="ap-check">
                <input
                  type="radio"
                  name="range"
                  checked={range === r.key}
                  onChange={() => setRange(r.key)}
                />
                <span>
                  {r.label}
                  <small>{r.hint}</small>
                </span>
              </label>
            ))}
          </fieldset>
          {range === "custom" && (
            <div className="ap-inputrow">
              <Field id="x-from" label={t("events.export.range.from")}>
                <TextInput type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
              </Field>
              <Field
                id="x-to"
                label={t("events.export.range.to")}
                error={customInvalid ? t("events.export.range.invalid") : undefined}
              >
                <TextInput
                  type="date"
                  value={to}
                  min={from || undefined}
                  onChange={(e) => setTo(e.target.value)}
                />
              </Field>
            </div>
          )}
        </section>

        <section className="ap-panel ap-form-section" aria-labelledby="x-status">
          <h2 className="t-h2" id="x-status">
            {t("events.export.status.title")}
          </h2>
          <fieldset className="ap-fieldset">
            <legend className="ap-sr">{t("events.export.status.legend")}</legend>
            <label className="ap-check">
              <input
                type="radio"
                name="drafts"
                checked={!includeDrafts}
                onChange={() => setIncludeDrafts(false)}
              />
              <span>
                {t("events.export.status.published")}
                <small>{t("events.export.status.publishedHint")}</small>
              </span>
            </label>
            <label className="ap-check">
              <input
                type="radio"
                name="drafts"
                checked={includeDrafts}
                onChange={() => setIncludeDrafts(true)}
              />
              <span>
                {t("events.export.status.drafts")}
                <small>{t("events.export.status.draftsHint")}</small>
              </span>
            </label>
          </fieldset>
          {includeDrafts && <Banner tone="info">{t("events.export.status.draftsNotice")}</Banner>}
        </section>

        <section className="ap-panel ap-form-section" aria-labelledby="x-aud">
          <h2 className="t-h2" id="x-aud">
            {t("events.export.audiences.title")}
          </h2>
          {(groups.data ?? []).length > 0 ? (
            <>
              <FilterPillGroup
                label={t("events.export.audiences.label")}
                hideLabel
                items={(groups.data ?? []).map((g) => ({ id: g.id, label: g.name }))}
                selected={groupIds}
                onChange={(id) =>
                  setGroupIds((prev) =>
                    prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
                  )
                }
              />
              <p className="t-sm t-muted">{t("events.export.audiences.hint")}</p>
            </>
          ) : (
            <p className="t-sm t-muted">{t("events.export.audiences.none")}</p>
          )}
        </section>

        <section className="ap-panel ap-panel--sunken ap-form-section" aria-labelledby="x-prev">
          <h2 className="t-h3" id="x-prev">
            {t("events.export.preview.title")}
          </h2>
          <p className="t-body" role="status" aria-busy={events.isLoading || undefined}>
            <b>
              {events.isLoading
                ? t("events.list.loading")
                : n === 0
                  ? t("events.export.preview.none")
                  : t("events.export.preview.count", { count: n })}
            </b>
          </p>
          {!events.isLoading && n === 0 && (
            <p className="t-sm">{t("events.export.preview.noneHint")}</p>
          )}
        </section>

        <div className="ap-actions">
          <Button type="submit" icon="download" disabled={n === 0 || events.isLoading}>
            {t("events.export.download")}
          </Button>
          <LinkButton variant="secondary" to={page.routes.list}>
            {t("events.export.cancel")}
          </LinkButton>
        </div>
      </form>
    </div>
  );
}
