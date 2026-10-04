import { useState, type FormEvent, type ReactNode } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { apiGet, apiPost, getHolidayEvents } from "@/lib/api";
import { addDays, dayOfWeek, isValidIso, weekdayNames, type IsoDate } from "@/lib/calendar";
import {
  formatWeekdayDate,
  locationName,
  seriesDates,
  seriesPreview,
  type EventStatus,
  type SeriesNth,
  type SeriesRhythm,
} from "@/lib/events";
import type { EventTemplate, HolidayEvent } from "@/lib/types";
import {
  Banner,
  Button,
  EmptyState,
  Field,
  LinkButton,
  Modal,
  NativeSelect,
  StatusBadge,
  TextInput,
  toast,
} from "@/components/ui/shared";
import { StatusSeg } from "@/components/events/StatusSeg";
import { useEventPage } from "@/components/events/useEventPage";
import { useLocale } from "@/components/calendar/useLocale";
import { CreateGateBody, ModalSkeleton } from "@/components/events/CreateGate";
import { createGate } from "@/components/events/createGateState";
import { useModalNav } from "@/lib/useModalNav";
import { eventSelector, focusAfterModalClose } from "@/lib/modalFocus";

const RHYTHMS: SeriesRhythm[] = ["weekly", "biweekly", "monthly"];
const NTHS: SeriesNth[] = [1, 2, 3, 4, 5];
/** Monday first, Sunday last (design order). */
const WEEKDAY_ORDER = [1, 2, 3, 4, 5, 6, 0];

/**
 * Event from a template (design: EventSeries; step of the create dialog,
 * route …/events/new/template/:templateId?date=). A single event is created through
 * `POST …/events/from-template`. The series part is complete as UI with a client-side preview,
 * but creating a series is disabled ("Bald verfügbar") until the backend supports recurrence
 * rules (docs/redesign/BACKEND-GAPS.md).
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
  const [rhythm, setRhythm] = useState<SeriesRhythm>("weekly");
  const [nth, setNth] = useState<SeriesNth>(1);
  const [weekday, setWeekday] = useState<number>(dayOfWeek(start));
  const [from, setFrom] = useState<string>(start);
  const [to, setTo] = useState<string>(addDays(start, 8 * 7));
  const [skip, setSkip] = useState(true);
  const [status, setStatus] = useState<EventStatus>("draft");
  const [saving, setSaving] = useState(false);
  // Also shown in the dialog: toasts sit behind the modal for screen readers.
  const [failed, setFailed] = useState(false);
  const [dateError, setDateError] = useState(false);

  const series = mode === "series";
  const rangeValid = isValidIso(from) && isValidIso(to) && to >= from;
  const holidays = useQuery<HolidayEvent[]>({
    queryKey: ["holidayEvents", page.calendarId, from, to],
    queryFn: () => getHolidayEvents(page.calendarId, from, to),
    enabled: series && rangeValid,
  });

  const singleValid = isValidIso(date);
  const candidates: IsoDate[] = series
    ? seriesDates({ rhythm, weekday, nth, from, to })
    : singleValid
      ? [date]
      : [];
  const preview = seriesPreview(candidates, series ? (holidays.data ?? []) : [], series && skip);
  const n = preview.dates.length;
  const names = weekdayNames(locale, 0, "long");
  const time = template.timeBegin
    ? t("events.series.timeRange", {
        from: template.timeBegin.slice(0, 5),
        to: template.timeEnd.slice(0, 5),
      })
    : t("events.series.allDay");
  const place = template.location ? locationName(template.location) : null;

  let countText = n === 0 ? t("events.series.countNone") : "";
  if (n > 0) {
    countText = series
      ? t("events.series.countPreview", { count: n })
      : t("events.series.count", { count: n });
    if (series && skip && preview.holidayCount > 0)
      countText += ` ${t("events.series.holidaysSkipped", { count: preview.holidayCount })}`;
  }
  const skipCounter = skip
    ? t("events.series.skipped", { count: preview.holidayCount })
    : preview.holidayCount === 0
      ? t("events.series.noHolidays")
      : t("events.series.holidaysKept", { count: preview.holidayCount });

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (series) return; // Series are not available yet (button disabled).
    if (!singleValid) {
      setDateError(true);
      document.getElementById("ser-day")?.focus();
      return;
    }
    setSaving(true);
    setFailed(false);
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
      setFailed(true);
      toast.error(t("events.series.failed"));
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

      {failed && <Banner tone="danger">{t("events.series.failed")}</Banner>}
      {series && rangeValid && n === 0 && !holidays.isLoading && (
        <Banner tone="warning">{t("events.series.noMatch")}</Banner>
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
          <>
            <fieldset className="ap-fieldset">
              <legend>{t("events.series.rhythm")}</legend>
              <div
                className="ap-seg"
                role="group"
                aria-label={t("events.series.rhythm")}
                style={{ alignSelf: "flex-start", flexWrap: "wrap" }}
              >
                {RHYTHMS.map((r) => (
                  <button
                    key={r}
                    type="button"
                    aria-pressed={rhythm === r}
                    onClick={() => setRhythm(r)}
                  >
                    {t(`events.series.rhythms.${r}`)}
                  </button>
                ))}
              </div>
            </fieldset>
            {rhythm === "monthly" && (
              <fieldset className="ap-fieldset">
                <legend>{t("events.series.nthLegend")}</legend>
                <div
                  className="ap-seg"
                  role="group"
                  aria-label={t("events.series.nthLegend")}
                  style={{ alignSelf: "flex-start", flexWrap: "wrap" }}
                >
                  {NTHS.map((x) => (
                    <button
                      key={x}
                      type="button"
                      aria-pressed={nth === x}
                      onClick={() => setNth(x)}
                    >
                      {t(`events.series.nth.${x}`)}
                    </button>
                  ))}
                </div>
              </fieldset>
            )}
            <Field id="ser-wd" label={t("events.series.weekday")}>
              <NativeSelect value={weekday} onChange={(e) => setWeekday(Number(e.target.value))}>
                {WEEKDAY_ORDER.map((d) => (
                  <option key={d} value={d}>
                    {names[d]}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <div className="ap-inputrow">
              <Field id="ser-from" label={t("events.series.from")} required>
                <TextInput type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
              </Field>
              <Field id="ser-to" label={t("events.series.to")} required>
                <TextInput
                  type="date"
                  value={to}
                  min={from || undefined}
                  onChange={(e) => setTo(e.target.value)}
                />
              </Field>
            </div>
            <div>
              <label className="ap-check">
                <input
                  type="checkbox"
                  checked={skip}
                  aria-describedby="ser-skip-hint"
                  onChange={(e) => setSkip(e.target.checked)}
                />
                <span>
                  {t("events.series.skipHolidays")}
                  <small id="ser-skip-hint">{skipCounter}</small>
                </span>
              </label>
            </div>
          </>
        )}
      </section>

      <section className="ap-panel ap-panel--flush" aria-labelledby="ser-s3">
        <div style={{ padding: "var(--space-6) var(--space-6) var(--space-3)" }}>
          <StepHeading n={3} id="ser-s3">
            {t("events.series.preview")}
          </StepHeading>
          <p className="t-body" role="status" style={{ marginTop: "var(--space-2)" }}>
            {countText}
          </p>
        </div>
        {preview.rows.length > 0 ? (
          <ul className="ap-list" style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {preview.rows.map((r) => (
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

      {series && (
        <Banner tone="info" icon="clock" title={t("events.series.soon")}>
          {t("events.series.soonText")}
        </Banner>
      )}

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
          {series ? (
            <Button type="submit" icon="check" disabled>
              {createLabel}
              <span className="ap-sr">{` (${t("events.series.soon")})`}</span>
            </Button>
          ) : (
            <Button
              type="submit"
              icon={n === 0 && singleValid ? undefined : "check"}
              loading={saving}
              disabled={n === 0 && singleValid}
            >
              {createLabel}
            </Button>
          )}
        </div>
      </div>
    </form>
  );
}
