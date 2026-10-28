import { useMemo, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { apiFetch, apiGet, errorFrom } from "@/lib/api";
import { formatMonthTitle, yearMonthOf } from "@/lib/calendar";
import {
  PDF_LAYOUTS,
  PDF_MAX_EVENTS,
  PDF_MAX_DAYS,
  availableLayouts,
  downloadBlob,
  exportFileName,
  exportQuery,
  exportRange,
  monthBounds,
  pdfExportQuery,
  pdfFailure,
  pdfRangeTooLong,
  selectForExport,
  type ExportRange,
  type PdfFailure,
  type PdfLayout,
  type PdfOrientation,
  type PdfPaper,
} from "@/lib/events";
import type { TargetGroup } from "@/lib/types";
import {
  Banner,
  Button,
  Field,
  FilterPillGroup,
  Icon,
  LinkButton,
  NativeSelect,
  TextInput,
  toast,
} from "@/components/ui/shared";
import { useAllEvents, useEventPage } from "@/components/events/useEventPage";
import { useLocale } from "@/components/calendar/useLocale";
import { usePageTitle } from "@/lib/usePageTitle";

/**
 * Export (design: Export, route …/events/export). The file comes from the backend: ICS
 * (`GET …/events.ics`, same output as the feeds, drafts as TENTATIVE) or PDF (`GET …/events.pdf`,
 * layout/paper/orientation; needs a bounded period), downloaded with the JWT (fetch + Blob +
 * `a[download]`). The count preview uses the loaded event list with the same rule.
 */
type Format = "ics" | "pdf";

const LAYOUT_KEYS: Record<PdfLayout, string> = {
  "month-grid": "month",
  "annual-overview": "annual",
  "quarter-overview": "quarter",
  agenda: "agenda",
};

export default function EventsExportPage() {
  const page = useEventPage();
  const { t } = useTranslation();
  usePageTitle(t("events.export.title"));
  const locale = useLocale();
  const events = useAllEvents(page.calendarId);
  const groups = useQuery<TargetGroup[]>({
    queryKey: ["targetGroups", page.clubId],
    queryFn: () => apiGet(`/api/clubs/${page.clubId}/target-groups`),
  });

  const [first, last] = monthBounds(page.today);
  const [format, setFormat] = useState<Format>("ics");
  const [layout, setLayout] = useState<PdfLayout>("month-grid");
  const [paper, setPaper] = useState<PdfPaper>("a4");
  const [orientation, setOrientation] = useState<PdfOrientation>("auto");
  const [range, setRange] = useState<ExportRange>("all");
  const [from, setFrom] = useState(first);
  const [to, setTo] = useState(last);
  const [includeDrafts, setIncludeDrafts] = useState(false);
  const [groupIds, setGroupIds] = useState<string[]>([]);
  const [downloading, setDownloading] = useState(false);
  const [failed, setFailed] = useState<{ kind: PdfFailure; retryAfter?: number } | null>(null);

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
  const isPdf = format === "pdf";
  const customInvalid = range === "custom" && !!from && !!to && to < from;
  const period = exportRange({ range, today: page.today, from, to, includeDrafts, groupIds });
  const available = availableLayouts(period.from, period.to);
  const activeLayout = available[layout] ? layout : "month-grid";
  const periodMissing = isPdf && (!period.from || !period.to);
  const tooLong = isPdf && pdfRangeTooLong(period.from, period.to);
  const n = customInvalid || periodMissing ? 0 : selected.length;
  const tooMany = isPdf && n > PDF_MAX_EVENTS;
  const pdfBlocked = tooLong || tooMany;
  const calendarName = page.calendar?.name ?? "";

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (n === 0 || downloading || pdfBlocked) return;
    setDownloading(true);
    setFailed(null);
    try {
      const opts = { range, today: page.today, from, to, includeDrafts, groupIds };
      const base = `/api/calendars/${page.calendarId}/events`;
      const path = isPdf
        ? `${base}.pdf${pdfExportQuery({ ...opts, layout: activeLayout, paper, orientation })}`
        : `${base}.ics${exportQuery(opts)}`;
      const res = await apiFetch(path, {
        headers: { Accept: isPdf ? "application/pdf" : "text/calendar" },
      });
      if (!res.ok) throw await errorFrom(res);
      const blob = await res.blob();
      downloadBlob(blob, exportFileName(calendarName, format));
      toast.success(t("events.export.done"));
    } catch (err) {
      setFailed(isPdf ? pdfFailure(err) : { kind: "generic" });
    } finally {
      setDownloading(false);
    }
  }

  function chooseFormat(next: Format) {
    setFormat(next);
    if (next === "pdf" && range === "all") setRange("month");
  }

  const thisYear = Number(page.today.slice(0, 4));
  const ranges: { key: ExportRange; label: string; hint: string }[] = [
    ...(isPdf
      ? []
      : [
          {
            key: "all" as const,
            label: t("events.export.range.all"),
            hint: t("events.export.range.allHint", { calendar: calendarName }),
          },
        ]),
    {
      key: "month",
      label: t("events.export.range.month"),
      hint: formatMonthTitle(yearMonthOf(page.today), locale),
    },
    {
      key: "year",
      label: t("events.export.range.year"),
      hint: String(thisYear),
    },
    {
      key: "nextYear",
      label: t("events.export.range.nextYear"),
      hint: String(thisYear + 1),
    },
    {
      key: "custom",
      label: t("events.export.range.custom"),
      hint: t("events.export.range.customHint"),
    },
  ];

  function failedText(f: { kind: PdfFailure; retryAfter?: number }): string {
    switch (f.kind) {
      case "tooMany":
        return t("events.export.failed.tooMany", { max: PDF_MAX_EVENTS });
      case "rangeTooLong":
        return t("events.export.failed.rangeTooLong", { max: PDF_MAX_DAYS });
      case "rateLimited":
        return f.retryAfter
          ? t("events.export.failed.rateLimitedIn", { minutes: Math.ceil(f.retryAfter / 60) })
          : t("events.export.failed.rateLimited");
      default:
        return t("events.export.failed.text");
    }
  }

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
          <p className="t-body t-prose">
            {t(isPdf ? "events.export.intro.pdf" : "events.export.intro.ics")}
          </p>
          <p className="t-sm" style={{ marginTop: "var(--space-2)" }}>
            <Link className="ap-link ap-link--standalone" to={page.routes.feeds}>
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
        <section className="ap-panel ap-form-section" aria-labelledby="x-format">
          <h2 className="t-h2" id="x-format">
            {t("events.export.format.title")}
          </h2>
          <fieldset className="ap-fieldset">
            <legend className="ap-sr">{t("events.export.format.title")}</legend>
            {(["ics", "pdf"] as const).map((f) => (
              <label key={f} className="ap-check">
                <input
                  type="radio"
                  name="format"
                  checked={format === f}
                  onChange={() => chooseFormat(f)}
                />
                <span>
                  {t(`events.export.format.${f}`)}
                  <small>{t(`events.export.format.${f}Hint`)}</small>
                </span>
              </label>
            ))}
          </fieldset>
        </section>

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
                <TextInput
                  autoComplete="off"
                  type="date"
                  value={from}
                  onChange={(e) => setFrom(e.target.value)}
                />
              </Field>
              <Field
                id="x-to"
                label={t("events.export.range.to")}
                error={customInvalid ? t("events.export.range.invalid") : undefined}
              >
                <TextInput
                  autoComplete="off"
                  type="date"
                  value={to}
                  min={from || undefined}
                  onChange={(e) => setTo(e.target.value)}
                />
              </Field>
            </div>
          )}
        </section>

        {isPdf && (
          <section className="ap-panel ap-form-section" aria-labelledby="x-layout">
            <h2 className="t-h2" id="x-layout">
              {t("events.export.pdf.layout.title")}
            </h2>
            <fieldset className="ap-fieldset">
              <legend className="ap-sr">{t("events.export.pdf.layout.title")}</legend>
              {PDF_LAYOUTS.map((l) => (
                <label key={l} className="ap-check">
                  <input
                    type="radio"
                    name="layout"
                    disabled={!available[l]}
                    checked={activeLayout === l}
                    onChange={() => setLayout(l)}
                  />
                  <span>
                    {t(`events.export.pdf.layout.${LAYOUT_KEYS[l]}`)}
                    <small>
                      {t(`events.export.pdf.layout.${LAYOUT_KEYS[l]}Hint`)}
                      {!available[l] && ` ${t("events.export.pdf.layout.unavailable")}`}
                    </small>
                  </span>
                </label>
              ))}
            </fieldset>
            <div className="ap-inputrow">
              <Field id="x-paper" label={t("events.export.pdf.paper.label")}>
                <NativeSelect value={paper} onChange={(e) => setPaper(e.target.value as PdfPaper)}>
                  <option value="a4">{t("events.export.pdf.paper.a4")}</option>
                  <option value="a3">{t("events.export.pdf.paper.a3")}</option>
                </NativeSelect>
              </Field>
              <Field id="x-orientation" label={t("events.export.pdf.orientation.label")}>
                <NativeSelect
                  value={orientation}
                  onChange={(e) => setOrientation(e.target.value as PdfOrientation)}
                >
                  {(["auto", "portrait", "landscape"] as const).map((o) => (
                    <option key={o} value={o}>
                      {t(`events.export.pdf.orientation.${o}`)}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
            </div>
          </section>
        )}

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

        {(tooLong || tooMany) && (
          <Banner tone="warning">
            {tooLong
              ? t("events.export.failed.rangeTooLong", { max: PDF_MAX_DAYS })
              : t("events.export.failed.tooMany", { max: PDF_MAX_EVENTS })}
          </Banner>
        )}

        {failed && (
          <Banner tone="danger" title={t("events.export.failed.title")}>
            {failedText(failed)}
          </Banner>
        )}

        <div className="ap-actions">
          <Button
            type="submit"
            icon="download"
            disabled={n === 0 || events.isLoading || pdfBlocked}
            loading={downloading}
            loadingLabel={t("events.export.downloading")}
          >
            {t(isPdf ? "events.export.downloadPdf" : "events.export.downloadIcs")}
          </Button>
          <LinkButton variant="secondary" to={page.routes.list}>
            {t("events.export.cancel")}
          </LinkButton>
        </div>
      </form>
    </div>
  );
}
