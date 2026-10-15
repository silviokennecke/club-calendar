import { useState, type FormEvent, type ReactNode } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { templateTimes } from "@/lib/templates";
import { ApiError, apiGet, apiPost } from "@/lib/api";
import { addDays, dayOfWeek, isValidIso } from "@/lib/calendar";
import {
  SERIES_MAX_EVENTS,
  formatWeekdayDate,
  locationName,
  seriesPreviewRows,
  toSeriesRule,
  type EventSeriesInfo,
  type EventStatus,
  type SeriesFormRule,
  type SeriesPreviewRow,
} from "@/lib/events";
import type { CalendarEvent, EventTemplate } from "@/lib/types";
import {
  Banner,
  Button,
  EmptyState,
  Field,
  LinkButton,
  Modal,
  StatusBadge,
  TextInput,
  toast,
} from "@/components/ui/shared";
import { StatusSeg } from "@/components/events/StatusSeg";
import { useEventPage } from "@/components/events/useEventPage";
import { useLocale } from "@/components/calendar/useLocale";
import { CreateGateBody, ModalSkeleton } from "@/components/events/CreateGate";
import { createGate } from "@/components/events/createGateState";
import { useSeriesPreview } from "@/components/events/useSeriesPreview";
import { SeriesRuleFields } from "@/components/events/SeriesRuleFields";
import { useModalNav } from "@/lib/useModalNav";
import { eventSelector, focusAfterModalClose } from "@/lib/modalFocus";

/**
 * Event from a template (design: EventSeries; step of the create dialog,
 * route …/events/new/template/:templateId?date=). A single event is created through
 * `POST …/events/from-template`; a series with `POST …/events/series` (series + all events at once).
 * The dates of the rule, skipped holidays included, come from the backend preview
 * (`POST …/events/series/preview`, debounced): the server is the only place that computes them.
 */
export default function EventFromTemplateModal() {
  const { templateId = "" } = useParams<{ templateId: string }>();
  const page = useEventPage();
  const nav = useModalNav();
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const gate = createGate(page);

  const templates = useQuery<EventTemplate[]>({
    queryKey: ["templates", page.calendarId],
    queryFn: () => apiGet<EventTemplate[]>(`/api/calendars/${page.calendarId}/templates`),
    enabled: !gate,
  });
  const template = templates.data?.find((x) => x.id === templateId);
  const preset = params.get("date");

  let body;
  if (gate) {
    body = <CreateGateBody gate={gate} page={page} onClose={nav.close} />;
  } else if (templates.isPending && !templates.isError) {
    body = <ModalSkeleton label={t("events.templatePick.loading")} tall />;
  } else if (!template) {
    body = (
      <EmptyState
        icon="layers"
        title={t("events.series.notFound")}
        actions={
          <LinkButton variant="secondary" {...nav.stepLink(page.routes.pickTemplate(preset))}>
            {t("events.series.change")}
          </LinkButton>
        }
      />
    );
  } else {
    body = (
      <SeriesForm
        key={template.id}
        template={template}
        presetDate={isValidIso(preset) ? preset : null}
      />
    );
  }

  return (
    <Modal
      size="xl"
      form
      title={gate === "archived" ? t("events.new.archived.title") : t("events.series.title")}
      subtitle={gate ? undefined : t("events.series.subtitle")}
      closeLabel={t("events.series.close")}
      onClose={nav.close}
    >
      {body}
    </Modal>
  );
}

function StepHeading({ n, id, children }: { n: number; id: string; children: ReactNode }) {
  const { t } = useTranslation();
  return (
    <h2 className="t-h2 ap-row" id={id}>
      <span className="ap-stepnum" aria-hidden="true">
        {n}
      </span>
      <span>
        <span className="ap-sr">{t("events.series.step", { n })}</span>
        {children}
      </span>
    </h2>
  );
}

function SeriesForm({
  template,
  presetDate,
}: {
  template: EventTemplate;
  presetDate: string | null;
}) {
  const page = useEventPage();
  const nav = useModalNav();
  const qc = useQueryClient();
  const { t } = useTranslation();
  const locale = useLocale();

  const start = presetDate ?? page.today;
  const [mode, setMode] = useState<"single" | "series">("single");
  const [date, setDate] = useState<string>(start);
  const [ruleForm, setRuleForm] = useState<SeriesFormRule>({
    rhythm: "weekly",
    nth: 1,
    weekday: dayOfWeek(start),
    from: start,
    to: addDays(start, 8 * 7),
    skipHolidays: true,
  });
  const skip = ruleForm.skipHolidays;
  const [status, setStatus] = useState<EventStatus>("draft");
  const [saving, setSaving] = useState(false);
  // Also shown in the dialog: toasts sit behind the modal for screen readers.
  const [failed, setFailed] = useState<string | null>(null);
  const [dateError, setDateError] = useState(false);

  const series = mode === "series";
  const rule = toSeriesRule(ruleForm);
  const preview = useSeriesPreview(page.calendarId, rule, series);
  const tooMany = preview.error instanceof ApiError && preview.error.code === "too_many_events";

  const singleValid = isValidIso(date);
  const rows: SeriesPreviewRow[] = series
    ? preview.data && !preview.error && rule
      ? seriesPreviewRows(preview.data)
      : []
    : singleValid
      ? [{ date, holiday: null, skipped: false }]
      : [];
  const n = series ? (rule && !preview.error ? (preview.data?.count ?? 0) : 0) : rows.length;
  const skippedCount = preview.data?.skippedHolidays.length ?? 0;
  const holidayCount = preview.data?.holidays.length ?? 0;
  const ready = !series || (!!rule && !!preview.data && !preview.pending && !preview.error);
  // A template without times creates all-day events (backend rule, see docs/api/openapi.yaml)
  const times = templateTimes(template);
  const time = times ? t("events.series.timeRange", times) : t("events.series.allDay");
  const place = template.location ? locationName(template.location) : null;

  let countText = "";
  if (series && preview.pending && !preview.data) countText = t("events.series.previewLoading");
  else if (n === 0) countText = t("events.series.countNone");
  else {
    countText = t("events.series.count", { count: n });
    if (series && skip && skippedCount > 0)
      countText += ` ${t("events.series.holidaysSkipped", { count: skippedCount })}`;
  }
  const skipCounter = skip
    ? t("events.series.skipped", { count: skippedCount })
    : holidayCount === 0
      ? t("events.series.noHolidays")
      : t("events.series.holidaysKept", { count: holidayCount });

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (series) {
      if (!rule || !ready || n === 0) return;
      await createSeries();
      return;
    }
    if (!singleValid) {
      setDateError(true);
      document.getElementById("ser-day")?.focus();
      return;
    }
    setSaving(true);
    setFailed(null);
    try {
      const created = await apiPost<{ id: string }[]>(
        `/api/calendars/${page.calendarId}/events/from-template`,
        {
          templateId: template.id,
          dates: [date],
          overrides: { isDraft: status === "draft" },
        },
      );
      await qc.invalidateQueries({ queryKey: ["events", page.calendarId] });
      toast.success(t("events.series.created"));
      const first = Array.isArray(created) ? created[0]?.id : undefined;
      focusAfterModalClose(first ? eventSelector(first) : null);
      nav.close();
    } catch {
      setFailed(t("events.series.failed"));
      toast.error(t("events.series.failed"));
    } finally {
      setSaving(false);
    }
  }

  async function createSeries() {
    setSaving(true);
    setFailed(null);
    try {
      const created = await apiPost<{ series: EventSeriesInfo; events: CalendarEvent[] }>(
        `/api/calendars/${page.calendarId}/events/series`,
        { rule, templateId: template.id, isDraft: status === "draft" },
      );
      await qc.invalidateQueries({ queryKey: ["events", page.calendarId] });
      const count = created.events.length;
      toast.success(t("events.series.createdSeries", { count }));
      const first = created.events[0]?.id;
      focusAfterModalClose(first ? eventSelector(first) : null);
      nav.close();
    } catch (err) {
      const message =
        err instanceof ApiError && err.code === "too_many_events"
          ? t("events.series.tooMany", { max: SERIES_MAX_EVENTS })
          : t("events.series.seriesFailed");
      setFailed(message);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  }

  const createLabel =
    n === 0
      ? t("events.series.nothing")
      : status === "draft"
        ? t("events.series.createDraft", { count: n })
        : t("events.series.createPublished", { count: n });
  const createDisabled = series ? !ready || n === 0 : n === 0 && singleValid;

  return (
    <form noValidate onSubmit={onSubmit}>
      <div className="ap-chosen">
        <div className="ap-grow">
          <span className="t-sm t-muted" style={{ display: "block" }}>
            {t("events.series.chosen")}
          </span>
          <b className="t-body" style={{ display: "block", fontWeight: 700 }}>
            {template.name}
          </b>
          <span className="t-sm t-muted" style={{ display: "block" }}>
            {[time, place].filter(Boolean).join(" · ")}
          </span>
        </div>
        <LinkButton variant="secondary" {...nav.stepLink(page.routes.pickTemplate(presetDate))}>
          {t("events.series.change")}
        </LinkButton>
      </div>

      {failed && <Banner tone="danger">{failed}</Banner>}
      {series && rule && ready && n === 0 && (
        <Banner tone="warning">{t("events.series.noMatch")}</Banner>
      )}
      {series && tooMany && (
        <Banner tone="warning">{t("events.series.tooMany", { max: SERIES_MAX_EVENTS })}</Banner>
      )}
      {series && rule && preview.error && !tooMany && (
        <Banner
          tone="danger"
          action={
            <Button variant="secondary" icon="refresh" onClick={preview.retry}>
              {t("events.series.previewRetry")}
            </Button>
          }
        >
          {t("events.series.previewFailed")}
        </Banner>
      )}

      <section className="ap-panel ap-form-section" aria-labelledby="ser-s1">
        <StepHeading n={1} id="ser-s1">
          {t("events.series.kindTitle")}
        </StepHeading>
        <div
          className="ap-seg"
          role="group"
          aria-label={t("events.series.kindLabel")}
          style={{ alignSelf: "flex-start", flexWrap: "wrap" }}
        >
          <button type="button" aria-pressed={!series} onClick={() => setMode("single")}>
            {t("events.series.single")}
          </button>
          <button type="button" aria-pressed={series} onClick={() => setMode("series")}>
            {t("events.series.series")}
          </button>
        </div>
      </section>

      <section className="ap-panel ap-form-section" aria-labelledby="ser-s2">
        <StepHeading n={2} id="ser-s2">
          {series ? t("events.series.ruleTitle") : t("events.series.dateTitle")}
        </StepHeading>
        {!series ? (
          <Field
            id="ser-day"
            label={t("events.series.date")}
            required
            error={dateError && !singleValid ? t("events.series.dateRequired") : undefined}
          >
            <TextInput
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              onBlur={() => setDateError(true)}
            />
          </Field>
        ) : (
          <SeriesRuleFields
            value={ruleForm}
            onChange={setRuleForm}
            idPrefix="ser"
            skipHint={skipCounter}
          />
        )}
      </section>

      <section
        className="ap-panel ap-panel--flush"
        aria-labelledby="ser-s3"
        aria-busy={(series && preview.pending) || undefined}
      >
        <div style={{ padding: "var(--space-6) var(--space-6) var(--space-3)" }}>
          <StepHeading n={3} id="ser-s3">
            {t("events.series.preview")}
          </StepHeading>
          <p className="t-body" role="status" style={{ marginTop: "var(--space-2)" }}>
            {countText}
          </p>
        </div>
        {rows.length > 0 ? (
          <ul className="ap-list" style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {rows.map((r) => (
              <li
                key={r.date}
                className="ap-listrow"
                style={
                  r.skipped
                    ? { background: "var(--surface-sunken)", color: "var(--ink-muted)" }
                    : undefined
                }
              >
                <div className="ap-listrow-main">
                  <b>{formatWeekdayDate(r.date, locale)}</b>
                  <span>{[time, place].filter(Boolean).join(" · ")}</span>
                </div>
                {r.holiday && (
                  <span className="ap-row">
                    <StatusBadge status="holiday" />
                    <span className="t-sm">
                      {r.skipped
                        ? t("events.series.skippedNote")
                        : t("events.series.holidayNote", { name: r.holiday })}
                    </span>
                  </span>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="t-sm t-muted" style={{ padding: "0 var(--space-6) var(--space-6)" }}>
            {t("events.series.previewEmpty")}
          </p>
        )}
      </section>

      <section className="ap-panel ap-form-section" aria-labelledby="ser-s4">
        <StepHeading n={4} id="ser-s4">
          {series ? t("events.series.statusSeries") : t("events.series.statusSingle")}
        </StepHeading>
        <StatusSeg
          value={status}
          onChange={setStatus}
          label={series ? t("events.series.statusSeries") : t("events.series.statusSingle")}
          hintId="ser-status-hint"
        />
        <p className="t-sm t-muted" id="ser-status-hint">
          {t("events.form.status.hint")}
        </p>
      </section>

      <div className="ap-dialog-foot ap-dialog-foot--split">
        <LinkButton
          variant="secondary"
          icon="arrow-left"
          {...nav.stepLink(page.routes.pickTemplate(presetDate))}
        >
          {t("events.form.back")}
        </LinkButton>
        <div className="ap-actions">
          {!series && singleValid && (
            <LinkButton
              variant="secondary"
              icon="edit"
              {...nav.stepLink(page.routes.form(date, template.id))}
            >
              {t("events.series.customize")}
            </LinkButton>
          )}
          <Button
            type="submit"
            icon={n === 0 ? undefined : "check"}
            loading={saving}
            disabled={createDisabled}
          >
            {createLabel}
          </Button>
        </div>
      </div>
    </form>
  );
}
