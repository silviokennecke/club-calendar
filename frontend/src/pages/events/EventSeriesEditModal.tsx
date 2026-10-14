import { useEffect, useState, type FormEvent } from "react";
import { useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ApiError, apiErrorStatus, apiGet, apiPatch } from "@/lib/api";
import {
  SERIES_MAX_EVENTS,
  describeSeriesRule,
  formFromRule,
  formatWeekdayDate,
  sameSeriesRule,
  toSeriesRule,
  type EventSeriesInfo,
  type SeriesFormRule,
  type SeriesUpdateResult,
} from "@/lib/events";
import type { CalendarEvent } from "@/lib/types";
import {
  Banner,
  Button,
  ConfirmDialog,
  LinkButton,
  Modal,
  StatusBadge,
  toast,
  useModalInitialFocus,
} from "@/components/ui/shared";
import { ModalSkeleton } from "@/components/events/CreateGate";
import { SeriesRuleFields } from "@/components/events/SeriesRuleFields";
import { useEventPage } from "@/components/events/useEventPage";
import { useSeriesUpdatePreview } from "@/components/events/useSeriesPreview";
import { useLocale } from "@/components/calendar/useLocale";
import { useModalNav } from "@/lib/useModalNav";
import { eventSelector, focusAfterModalClose } from "@/lib/modalFocus";

/**
 * "Reihe ändern" (own addition, the design has no artboard for it; route …/events/:eventId/series,
 * a step of the edit dialog). A new rule for the series of the event: the server preview
 * (`POST …/event-series/{id}/preview-update`) lists what changes (new dates, events that get
 * deleted, unchanged and past events); saving asks for confirmation and applies the change
 * atomically (`PATCH …/event-series/{id}`). Only future events change, past events stay.
 */
export default function EventSeriesEditModal() {
  const { eventId = "" } = useParams<{ eventId: string }>();
  const page = useEventPage();
  const nav = useModalNav();
  const { t } = useTranslation();

  const eventQuery = useQuery<CalendarEvent>({
    queryKey: ["events", page.calendarId, "one", eventId],
    queryFn: () => apiGet<CalendarEvent>(`/api/calendars/${page.calendarId}/events/${eventId}`),
    retry: false,
  });

  // A deep link: show the calendar at the event's month below the dialog.
  const eventDate = eventQuery.data?.date.slice(0, 10);
  const { hasStoredBackground, setBackground } = nav;
  useEffect(() => {
    if (eventDate && !hasStoredBackground) setBackground(`${page.base}?date=${eventDate}`);
  }, [eventDate, hasStoredBackground, setBackground, page.base]);

  const title = t("events.seriesEdit.title");
  const closeLabel = t("events.seriesEdit.close");
  const event = eventQuery.data;

  let body;
  if (page.calendarLoading || (eventQuery.isPending && !eventQuery.isError)) {
    body = <ModalSkeleton label={t("events.form.loading")} tall />;
  } else if (eventQuery.isError || !event?.series) {
    const status = apiErrorStatus(eventQuery.error);
    const missing = !eventQuery.isError || status === 403 || status === 404;
    body = (
      <>
        {missing ? (
          <p className="t-body">
            {eventQuery.isError ? t("events.form.notFound.text") : t("events.seriesEdit.noSeries")}
          </p>
        ) : (
          <Banner
            tone="danger"
            action={
              <Button variant="secondary" icon="refresh" onClick={() => eventQuery.refetch()}>
                {t("events.form.loadError.retry")}
              </Button>
            }
          >
            {t("events.form.loadError.text")}
          </Banner>
        )}
        <div className="ap-dialog-foot">
          <Button onClick={nav.close}>{t("events.form.close")}</Button>
        </div>
      </>
    );
  } else if (page.isArchived) {
    body = (
      <>
        <Banner tone="warning" icon="lock">
          {t("events.form.readOnly")}
        </Banner>
        <div className="ap-dialog-foot">
          <LinkButton
            variant="secondary"
            icon="arrow-left"
            {...nav.stepLink(page.routes.edit(eventId))}
          >
            {t("events.form.back")}
          </LinkButton>
        </div>
      </>
    );
  } else {
    body = <SeriesEditor key={event.series.id} event={event} series={event.series} />;
  }

  return (
    <Modal
      size="xl"
      form
      title={title}
      subtitle={event ? t("events.seriesEdit.subtitle", { name: event.name }) : undefined}
      closeLabel={closeLabel}
      onClose={nav.close}
    >
      {body}
    </Modal>
  );
}

function SeriesEditor({ event, series }: { event: CalendarEvent; series: EventSeriesInfo }) {
  const page = useEventPage();
  const nav = useModalNav();
  const qc = useQueryClient();
  const { t } = useTranslation();
  const locale = useLocale();

  const [form, setForm] = useState<SeriesFormRule>(() => formFromRule(series.rule));
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  useModalInitialFocus("sre-wd");

  const rule = toSeriesRule(form);
  const unchanged = !!rule && sameSeriesRule(series.rule, rule);
  // The stored rule is never previewed (nothing to change)
  const preview = useSeriesUpdatePreview(page.calendarId, series.id, unchanged ? null : rule, true);
  const data = rule && !unchanged && !preview.error ? preview.data : undefined;
  const ready = !!data && !preview.pending;
  const code = preview.error instanceof ApiError ? preview.error.code : undefined;

  const created = data?.toCreate.length ?? 0;
  const deleted = data?.toDelete.length ?? 0;

  let statusText = "";
  if (!rule) statusText = t("events.seriesEdit.incomplete");
  else if (unchanged) statusText = t("events.seriesEdit.unchanged");
  else if (preview.pending && !preview.data) statusText = t("events.series.previewLoading");
  else if (data)
    statusText = [
      t("events.seriesEdit.summary.created", { count: created }),
      t("events.seriesEdit.summary.deleted", { count: deleted }),
      t("events.seriesEdit.summary.kept", { count: data.kept }),
      t("events.seriesEdit.summary.past", { count: data.past }),
    ].join(" ");
  const skipHint = form.skipHolidays
    ? t("events.series.skipped", { count: data?.skippedHolidays.length ?? 0 })
    : t("events.seriesEdit.holidaysKept");

  function previewError(): string | null {
    if (!rule || unchanged || !preview.error) return null;
    if (code === "too_many_events") return t("events.series.tooMany", { max: SERIES_MAX_EVENTS });
    if (code === "validation_failed") return t("events.seriesEdit.errors.noEvents");
    if (code === "series_empty") return t("events.seriesEdit.errors.empty");
    return null;
  }
  const knownPreviewError = previewError();

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!ready || !rule) return;
    setFailed(null);
    setConfirmOpen(true);
  }

  async function apply() {
    try {
      const result = await apiPatch<SeriesUpdateResult>(
        `/api/calendars/${page.calendarId}/event-series/${series.id}`,
        { rule },
      );
      await qc.invalidateQueries({ queryKey: ["events", page.calendarId] });
      await qc.invalidateQueries({ queryKey: ["seriesUpdatePreview", page.calendarId] });
      toast.success(
        t("events.seriesEdit.done", { created: result.created, deleted: result.deleted }),
      );
      const stays = !data?.toDelete.some((d) => d.id === event.id);
      focusAfterModalClose(stays ? eventSelector(event.id) : null);
      nav.close();
    } catch (err) {
      setConfirmOpen(false);
      const status = apiErrorStatus(err);
      const errCode = err instanceof ApiError ? err.code : undefined;
      let message = t("events.seriesEdit.errors.failed");
      if (errCode === "series_changed" || errCode === "series_empty" || status === 409) {
        message = t("events.seriesEdit.errors.conflict");
        preview.retry();
      } else if (errCode === "too_many_events")
        message = t("events.series.tooMany", { max: SERIES_MAX_EVENTS });
      else if (errCode === "validation_failed") message = t("events.seriesEdit.errors.noEvents");
      else if (status === 403) message = t("events.seriesEdit.errors.forbidden");
      else if (status === 404) message = t("events.seriesEdit.errors.gone");
      setFailed(message);
      toast.error(message);
    }
  }

  const consequenceParts = [
    t("events.seriesEdit.confirm.text", {
      deletes: t("events.seriesEdit.confirm.deletes", { count: deleted }),
      creates: t("events.seriesEdit.confirm.creates", { count: created }),
    }),
  ];
  if (deleted > 0) consequenceParts.push(t("events.seriesEdit.confirm.irreversible"));

  return (
    <form noValidate onSubmit={onSubmit}>
      <Banner tone="info" icon="repeat" title={t("events.seriesEdit.current")}>
        {`${describeSeriesRule(series.rule, t, locale)}. ${t("events.seriesEdit.futureOnly")}`}
      </Banner>
      {failed && <Banner tone="danger">{failed}</Banner>}
      {knownPreviewError && <Banner tone="warning">{knownPreviewError}</Banner>}
      {rule && !unchanged && preview.error && !knownPreviewError && (
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

      <section className="ap-panel ap-form-section" aria-labelledby="sre-s1">
        <h2 className="t-h2" id="sre-s1">
          {t("events.seriesEdit.ruleTitle")}
        </h2>
        <SeriesRuleFields
          value={form}
          onChange={setForm}
          idPrefix="sre"
          skipHint={skipHint}
          toHint={
            series.rule.until === null && series.rule.count !== null
              ? t("events.seriesEdit.countEnded", { count: series.rule.count })
              : undefined
          }
        />
      </section>

      <section
        className="ap-panel ap-panel--flush"
        aria-labelledby="sre-s2"
        aria-busy={preview.pending || undefined}
      >
        <div style={{ padding: "var(--space-6) var(--space-6) var(--space-3)" }}>
          <h2 className="t-h2" id="sre-s2">
            {t("events.seriesEdit.preview")}
          </h2>
          <p className="t-body" role="status" style={{ marginTop: "var(--space-2)" }}>
            {statusText}
          </p>
        </div>
        {data && deleted > 0 && (
          <>
            <h3 className="t-label" id="sre-del" style={{ padding: "0 var(--space-6)" }}>
              {t("events.seriesEdit.deleteList", { count: deleted })}
            </h3>
            <ul
              className="ap-list"
              aria-labelledby="sre-del"
              style={{ listStyle: "none", margin: 0, padding: 0 }}
            >
              {data.toDelete.map((d) => (
                <li key={d.id} className="ap-listrow">
                  <div className="ap-listrow-main">
                    <b>{formatWeekdayDate(d.date, locale)}</b>
                    <span>{d.name}</span>
                  </div>
                  <StatusBadge status={d.isDraft ? "draft" : "published"} />
                </li>
              ))}
            </ul>
          </>
        )}
        {data && created > 0 && (
          <>
            <h3
              className="t-label"
              id="sre-new"
              style={{ padding: "var(--space-3) var(--space-6) 0" }}
            >
              {t("events.seriesEdit.createList", { count: created })}
            </h3>
            <ul
              className="ap-list"
              aria-labelledby="sre-new"
              style={{ listStyle: "none", margin: 0, padding: 0 }}
            >
              {data.toCreate.map((c) => (
                <li key={c.date} className="ap-listrow">
                  <div className="ap-listrow-main">
                    <b>{formatWeekdayDate(c.date, locale)}</b>
                    <span>{t("events.seriesEdit.newNote")}</span>
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
        {data && created === 0 && deleted === 0 && (
          <p className="t-sm t-muted" style={{ padding: "0 var(--space-6) var(--space-6)" }}>
            {t("events.seriesEdit.sameDates")}
          </p>
        )}
      </section>

      <div className="ap-dialog-foot ap-dialog-foot--split">
        <LinkButton
          variant="secondary"
          icon="arrow-left"
          {...nav.stepLink(page.routes.edit(event.id))}
        >
          {t("events.form.back")}
        </LinkButton>
        <Button type="submit" icon="repeat" disabled={!ready}>
          {t("events.seriesEdit.submit")}
        </Button>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        tone={deleted > 0 ? "danger" : "primary"}
        icon="repeat"
        title={t("events.seriesEdit.confirm.title")}
        description={t("events.seriesEdit.confirm.description", { name: event.name })}
        consequence={consequenceParts.join(" ")}
        confirmLabel={t("events.seriesEdit.submit")}
        onConfirm={apply}
      />
    </form>
  );
}
