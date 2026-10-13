import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { apiDelete, apiErrorStatus, apiGet, apiPatch, apiPost } from "@/lib/api";
import { isValidIso } from "@/lib/calendar";
import {
  changedEventFields,
  changesDate,
  describeSeriesRule,
  emptyEventValues,
  formatWeekdayDate,
  isFormDirty,
  toEventPayload,
  validateEvent,
  valuesFromEvent,
  valuesFromTemplate,
  type EventField,
  type EventFormValues,
  type EventPayload,
} from "@/lib/events";
import { keepExisting, saveDroppingDeletedReferences } from "@/lib/staleReferences";
import type { CalendarEvent, EventTemplate } from "@/lib/types";
import { useUnsavedChanges } from "@/lib/useUnsavedChanges";
import {
  Banner,
  Button,
  ConfirmDialog,
  ErrorSummary,
  Field,
  LinkButton,
  Modal,
  StatusBadge,
  Tag,
  TextInput,
  UnsavedChangesDialog,
  toast,
  useModalInitialFocus,
} from "@/components/ui/shared";
import { StatusSeg } from "@/components/events/StatusSeg";
import { AssignmentFields } from "@/components/events/AssignmentFields";
import { LocationSection } from "@/components/events/LocationSection";
import { useEventPage } from "@/components/events/useEventPage";
import { CreateGateBody, ModalSkeleton } from "@/components/events/CreateGate";
import { createGate } from "@/components/events/createGateState";
import { useEventResources } from "@/components/events/useEventResources";
import { useLocale } from "@/components/calendar/useLocale";
import { useModalNav } from "@/lib/useModalNav";
import { eventSelector, focusAfterModalClose } from "@/lib/modalFocus";

/** Field ids, also the targets of the error summary links. */
const FIELD_IDS: Record<EventField, string> = {
  name: "ev-name",
  date: "ev-start",
  dateEnd: "ev-end",
  timeBegin: "ev-st",
  timeEnd: "ev-et",
};

/** Scope of saving / deleting an event of a series (`scope` of the API). */
type SeriesScope = "this" | "all";
type PatchBody = Partial<EventPayload> & { scope?: SeriesScope };

/**
 * New event (design: EventNewForm, route …/events/new/form?date=&templateId=) and edit / view
 * (design: EventForm, EventFormMobile, route …/events/:eventId) as a dialog above the calendar or
 * the list. Loads the data, then hands the initial values to the editor. Creating is impossible in
 * archived calendars (notice instead of the form); existing events open read-only there.
 * Events of a series show the rule; saving changes and deleting ask "Nur diesen Termin" / "Alle
 * Termine der Reihe" (all: only the changed fields go to every event, the date stays per event).
 */
export default function EventFormModal() {
  const { eventId } = useParams<{ eventId: string }>();
  const [params] = useSearchParams();
  const page = useEventPage();
  const nav = useModalNav();
  const { t } = useTranslation();
  const isNew = !eventId;
  const presetDate = params.get("date");
  const templateId = params.get("templateId");
  const gate = isNew ? createGate(page) : null;

  const eventQuery = useQuery<CalendarEvent>({
    queryKey: ["events", page.calendarId, "one", eventId],
    queryFn: () => apiGet<CalendarEvent>(`/api/calendars/${page.calendarId}/events/${eventId}`),
    enabled: !isNew,
    retry: false,
  });
  const templatesQuery = useQuery<EventTemplate[]>({
    queryKey: ["templates", page.calendarId],
    queryFn: () => apiGet<EventTemplate[]>(`/api/calendars/${page.calendarId}/templates`),
    enabled: isNew && !!templateId,
  });
  const template = templateId ? templatesQuery.data?.find((x) => x.id === templateId) : undefined;

  // A deep link to an event: show the calendar at the event's month below the dialog.
  const eventDate = eventQuery.data?.date.slice(0, 10);
  const { hasStoredBackground, setBackground } = nav;
  useEffect(() => {
    if (!isNew && eventDate && !hasStoredBackground)
      setBackground(`${page.base}?date=${eventDate}`);
  }, [isNew, eventDate, hasStoredBackground, setBackground, page.base]);

  const loading =
    page.calendarLoading ||
    (!isNew && eventQuery.isPending && !eventQuery.isError) ||
    (isNew && !!templateId && templatesQuery.isPending && !templatesQuery.isError);

  const newTitle = t("events.form.newTitle");
  const closeNew = t("events.form.closeNew");

  if (gate === "archived" || gate === "failed") {
    return (
      <Modal
        title={gate === "archived" ? t("events.new.archived.title") : newTitle}
        closeLabel={closeNew}
        onClose={nav.close}
      >
        <CreateGateBody gate={gate} page={page} onClose={nav.close} />
      </Modal>
    );
  }

  if (loading) {
    return (
      <Modal
        size="xl"
        form
        title={isNew ? newTitle : t("events.form.loadingTitle")}
        closeLabel={isNew ? closeNew : t("events.form.close")}
        onClose={nav.close}
      >
        <ModalSkeleton label={t("events.form.loading")} tall />
      </Modal>
    );
  }

  if (!isNew && eventQuery.isError) {
    const status = apiErrorStatus(eventQuery.error);
    // No access to the calendar (403) reads like an unknown event, not like a network error.
    const notFound = status === 403 || status === 404;
    return (
      <Modal
        title={notFound ? t("events.form.notFound.title") : t("events.form.loadError.title")}
        closeLabel={t("events.form.close")}
        onClose={nav.close}
      >
        {notFound ? (
          <p className="t-body">{t("events.form.notFound.text")}</p>
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
          {notFound && (
            <LinkButton variant="secondary" icon="list" to={page.routes.list}>
              {t("events.form.notFound.back")}
            </LinkButton>
          )}
          <Button onClick={nav.close}>{t("events.form.close")}</Button>
        </div>
      </Modal>
    );
  }

  const initial: EventFormValues = isNew
    ? template
      ? valuesFromTemplate(template, presetDate)
      : emptyEventValues(presetDate)
    : valuesFromEvent(eventQuery.data!);

  return (
    <EventEditor
      key={eventId ?? `new-${templateId ?? ""}-${presetDate ?? ""}`}
      initial={initial}
      event={isNew ? undefined : eventQuery.data}
      template={template}
      presetDate={isNew && isValidIso(presetDate) ? presetDate : null}
    />
  );
}

interface EventEditorProps {
  initial: EventFormValues;
  event?: CalendarEvent;
  template?: EventTemplate;
  presetDate: string | null;
}

function EventEditor({ initial, event, template, presetDate }: EventEditorProps) {
  const page = useEventPage();
  const nav = useModalNav();
  const res = useEventResources(page.calendarId);
  const qc = useQueryClient();
  const { t } = useTranslation();
  const locale = useLocale();
  const isNew = !event;
  const readOnly = page.isArchived;

  const [values, setValues] = useState<EventFormValues>(initial);
  const [touched, setTouched] = useState<Set<EventField>>(new Set());
  const [submits, setSubmits] = useState(0);
  const [saving, setSaving] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [scopeOpen, setScopeOpen] = useState(false);
  // Also shown in the dialog: toasts sit behind the modal for screen readers.
  const [saveFailed, setSaveFailed] = useState(false);

  const dirty = !readOnly && isFormDirty(initial, values);
  // The scope question only makes sense with other events in the series.
  const series = event?.series && event.series.eventCount > 1 ? event.series : null;
  const changed = changedEventFields(toEventPayload(initial), toEventPayload(values));
  const unsaved = useUnsavedChanges(dirty);
  // Start in the first field (the heading when read-only).
  useModalInitialFocus(FIELD_IDS.name, !readOnly);

  const errors = useMemo(() => validateEvent(values), [values]);
  // Inline errors appear once a field was left or after "save"; an end before the start at once.
  const visible = errors.filter(
    (e) =>
      submits > 0 ||
      touched.has(e.field) ||
      e.code === "dateEndBeforeStart" ||
      e.code === "timeEndBeforeStart",
  );
  const errorFor = (field: EventField) => {
    const err = visible.find((e) => e.field === field);
    return err ? t(`events.form.errors.${err.code}`) : undefined;
  };

  function set<K extends keyof EventFormValues>(key: K, value: EventFormValues[K]) {
    setValues((v) => ({ ...v, [key]: value }));
  }
  const blur = (field: EventField) => () => setTouched((prev) => new Set(prev).add(field));

  function leave() {
    unsaved.guard(nav.close);
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (readOnly) return;
    setSubmits((n) => n + 1);
    if (errors.length > 0) return;
    if (series && dirty) {
      setScopeOpen(true);
      return;
    }
    await save("this");
  }

  async function save(scope: SeriesScope) {
    setSaving(true);
    setSaveFailed(false);
    try {
      const send = (body: PatchBody) =>
        event
          ? apiPatch<{ id?: string }>(`/api/calendars/${page.calendarId}/events/${event.id}`, body)
          : apiPost<{ id?: string }>(`/api/calendars/${page.calendarId}/events`, body);
      // "all": only what the user changed is applied to the other events of the series
      const body: PatchBody =
        scope === "all" ? { ...changed, scope: "all" } : toEventPayload(values);
      const saved = await saveDroppingDeletedReferences(
        qc,
        page.calendarId,
        ["properties", "features", "targetGroups", "locations", "templates"],
        body,
        send,
        (b, existing) => ({
          ...b,
          ...(b.propertyIds && { propertyIds: keepExisting(b.propertyIds, existing.properties) }),
          ...(b.featureIds && { featureIds: keepExisting(b.featureIds, existing.features) }),
          ...(b.targetGroupIds && {
            targetGroupIds: keepExisting(b.targetGroupIds, existing.targetGroups),
          }),
          ...("locationId" in b && {
            locationId: b.locationId && existing.locations.has(b.locationId) ? b.locationId : null,
          }),
          ...("eventTemplateId" in b && {
            eventTemplateId:
              b.eventTemplateId && existing.templates.has(b.eventTemplateId)
                ? b.eventTemplateId
                : undefined,
          }),
        }),
      );
      const savedId = event?.id ?? saved?.id;
      await qc.invalidateQueries({ queryKey: ["events", page.calendarId] });
      toast.success(scope === "all" ? t("events.seriesScope.savedAll") : t("events.form.saved"));
      // Back on the page, focus the saved event (if it is shown there).
      focusAfterModalClose(savedId ? eventSelector(savedId) : null);
      unsaved.allow();
      nav.close();
    } catch {
      setSaveFailed(true);
      toast.error(t("events.form.saveFailed"));
    } finally {
      setSaving(false);
    }
  }

  async function onDelete(scope: SeriesScope = "this") {
    if (!event) return;
    try {
      const query = scope === "all" ? "?scope=all" : "";
      await apiDelete(`/api/calendars/${page.calendarId}/events/${event.id}${query}`);
      qc.removeQueries({ queryKey: ["events", page.calendarId, "one", event.id] });
      await qc.invalidateQueries({ queryKey: ["events", page.calendarId] });
      toast.success(scope === "all" ? t("events.seriesScope.deletedAll") : t("events.delete.done"));
      setDeleteOpen(false);
      unsaved.allow();
      nav.close();
    } catch {
      toast.error(t("events.delete.failed"));
    }
  }

  const title = readOnly
    ? t("events.form.viewTitle")
    : isNew
      ? t("events.form.newTitle")
      : t("events.form.editTitle");

  const summary = visible.map((e) => ({
    fieldId: FIELD_IDS[e.field],
    message: t(`events.form.errors.${e.code}`),
  }));

  return (
    <Modal
      size="xl"
      form
      title={title}
      subtitle={isNew ? t("events.form.newSubtitle") : page.calendar?.name}
      headExtra={
        event && (
          <span className="ap-row">
            <StatusBadge status={values.status === "draft" ? "draft" : "published"} />
            {event.seriesId && <Tag tone="brand">{t("events.recurring")}</Tag>}
          </span>
        )
      }
      closeLabel={
        readOnly
          ? t("events.form.close")
          : isNew
            ? t("events.form.closeNew")
            : t("events.form.closeEdit")
      }
      onClose={leave}
    >
      {readOnly && (
        <Banner tone="warning" icon="lock">
          {t("events.form.readOnly")}
        </Banner>
      )}
      {presetDate && values.date === presetDate && !template && (
        <Banner tone="info">
          {t("events.form.dateTaken", { date: formatWeekdayDate(presetDate, locale) })}
        </Banner>
      )}
      {template && (
        <Banner tone="info">{t("events.form.templateTaken", { name: template.name })}</Banner>
      )}
      {event?.series && (
        <Banner
          tone="info"
          icon="repeat"
          title={t("events.seriesInfo.title", { count: event.series.eventCount })}
        >
          {`${describeSeriesRule(event.series.rule, t, locale)}.`}
          {series && !readOnly && ` ${t("events.seriesInfo.hint")}`}
        </Banner>
      )}
      {!isNew && !readOnly && values.status === "published" && (
        <Banner tone="info">{t("events.form.publishedNotice")}</Banner>
      )}
      {saveFailed && <Banner tone="danger">{t("events.form.saveFailed")}</Banner>}
      <ErrorSummary title={t("events.form.errorTitle")} errors={summary} focusSignal={submits} />

      <form className="ap-form" style={{ gap: "var(--space-6)" }} noValidate onSubmit={onSubmit}>
        <fieldset disabled={readOnly} className="ap-stack ap-stack--lg m-0 min-w-0 border-0 p-0">
          <section className="ap-panel ap-form-section" aria-labelledby="sec-basic">
            <h2 className="t-h2" id="sec-basic">
              {t("events.form.sections.basic")}
            </h2>
            <Field
              id={FIELD_IDS.name}
              label={t("events.form.name")}
              required
              error={errorFor("name")}
            >
              <TextInput
                value={values.name}
                autoComplete="off"
                placeholder={t("events.form.namePlaceholder")}
                onChange={(e) => set("name", e.target.value)}
                onBlur={blur("name")}
              />
            </Field>
            <fieldset className="ap-fieldset">
              <legend className="ap-sr">{t("events.form.dates")}</legend>
              <div className="ap-inputrow">
                <Field
                  id={FIELD_IDS.date}
                  label={t("events.form.date")}
                  required
                  error={errorFor("date")}
                >
                  <TextInput
                    type="date"
                    value={values.date}
                    onChange={(e) => set("date", e.target.value)}
                    onBlur={blur("date")}
                  />
                </Field>
                <Field
                  id={FIELD_IDS.dateEnd}
                  label={t("events.form.dateEnd")}
                  hint={t("events.form.dateEndHint")}
                  error={errorFor("dateEnd")}
                >
                  <TextInput
                    type="date"
                    value={values.dateEnd}
                    min={values.date || undefined}
                    onChange={(e) => set("dateEnd", e.target.value)}
                    onBlur={blur("dateEnd")}
                  />
                </Field>
              </div>
            </fieldset>
            <label className="ap-check">
              <input
                type="checkbox"
                checked={values.isAllDay}
                aria-describedby="ev-allday-hint"
                onChange={(e) => set("isAllDay", e.target.checked)}
              />
              <span>
                {t("events.form.allDay")}
                <small id="ev-allday-hint">{t("events.form.allDayHint")}</small>
              </span>
            </label>
            {!values.isAllDay && (
              <fieldset className="ap-fieldset">
                <legend className="ap-sr">{t("events.form.times")}</legend>
                <div className="ap-inputrow">
                  <Field
                    id={FIELD_IDS.timeBegin}
                    label={t("events.form.timeBegin")}
                    required
                    error={errorFor("timeBegin")}
                  >
                    <TextInput
                      type="time"
                      value={values.timeBegin}
                      onChange={(e) => set("timeBegin", e.target.value)}
                      onBlur={blur("timeBegin")}
                    />
                  </Field>
                  <Field
                    id={FIELD_IDS.timeEnd}
                    label={t("events.form.timeEnd")}
                    required
                    error={errorFor("timeEnd")}
                  >
                    <TextInput
                      type="time"
                      value={values.timeEnd}
                      onChange={(e) => set("timeEnd", e.target.value)}
                      onBlur={blur("timeEnd")}
                    />
                  </Field>
                </div>
              </fieldset>
            )}
          </section>

          <section className="ap-panel ap-form-section" aria-labelledby="sec-status">
            <h2 className="t-h2" id="sec-status">
              {t("events.form.sections.status")}
            </h2>
            <StatusSeg
              value={values.status}
              onChange={(s) => set("status", s)}
              hintId="ev-status-hint"
            />
            <p className="t-sm t-muted" id="ev-status-hint">
              {t("events.form.status.hint")}
            </p>
          </section>

          <section className="ap-panel ap-form-section" aria-labelledby="sec-place">
            <h2 className="t-h2" id="sec-place">
              {t("events.form.sections.place")}
            </h2>
            <LocationSection
              locations={res.locations}
              value={values.locationId}
              onChange={(id) => set("locationId", id)}
              onCreate={res.createLocation}
              onMove={res.moveLocation}
              readOnly={readOnly}
            />
          </section>

          <section className="ap-panel ap-form-section" aria-labelledby="sec-tags">
            <h2 className="t-h2" id="sec-tags">
              {t("events.form.sections.tags")}
            </h2>
            <AssignmentFields
              resources={res}
              value={values}
              onChange={(field, ids) => set(field, ids)}
              readOnly={readOnly}
            />
          </section>
        </fieldset>

        <div className="ap-dialog-foot ap-dialog-foot--split">
          {readOnly ? (
            <Button variant="secondary" onClick={leave}>
              {t("events.form.close")}
            </Button>
          ) : isNew ? (
            <Button
              variant="secondary"
              icon="arrow-left"
              onClick={() =>
                unsaved.guard(() =>
                  nav.step(
                    template
                      ? page.routes.fromTemplate(template.id, presetDate)
                      : page.routes.create(presetDate),
                  ),
                )
              }
            >
              {t("events.form.back")}
            </Button>
          ) : (
            <Button variant="ghost-danger" icon="trash" onClick={() => setDeleteOpen(true)}>
              {t("events.form.delete")}
            </Button>
          )}
          {!readOnly && (
            <Button
              type="submit"
              icon="check"
              loading={saving}
              loadingLabel={t("events.form.saving")}
            >
              {t("events.form.save")}
            </Button>
          )}
        </div>
      </form>

      {event && !series && (
        <ConfirmDialog
          open={deleteOpen}
          onOpenChange={setDeleteOpen}
          icon="trash"
          title={t("events.delete.title", { name: event.name })}
          description={t("events.delete.text", {
            date: formatWeekdayDate(event.date.slice(0, 10), locale),
          })}
          consequence={t("events.delete.consequence")}
          confirmLabel={t("events.delete.confirm")}
          onConfirm={() => onDelete("this")}
        />
      )}
      {event && series && (
        <>
          <ConfirmDialog
            open={deleteOpen}
            onOpenChange={setDeleteOpen}
            icon="trash"
            title={t("events.delete.title", { name: event.name })}
            description={t("events.seriesScope.deleteText", {
              date: formatWeekdayDate(event.date.slice(0, 10), locale),
              count: series.eventCount,
            })}
            consequence={t("events.seriesScope.deleteConsequence")}
            confirmLabel={t("events.seriesScope.all")}
            alternative={{ label: t("events.seriesScope.this"), onConfirm: () => onDelete("this") }}
            onConfirm={() => onDelete("all")}
          />
          <ConfirmDialog
            open={scopeOpen}
            onOpenChange={setScopeOpen}
            tone="primary"
            icon="repeat"
            title={t("events.seriesScope.saveTitle")}
            description={t("events.seriesScope.saveText", {
              name: values.name.trim() || event.name,
              count: series.eventCount,
            })}
            consequence={[
              t("events.seriesScope.saveConsequence"),
              changesDate(changed) ? t("events.seriesScope.saveDateNote") : null,
            ]
              .filter(Boolean)
              .join(" ")}
            confirmLabel={t("events.seriesScope.all")}
            alternative={{ label: t("events.seriesScope.this"), onConfirm: () => save("this") }}
            onConfirm={() => save("all")}
          />
        </>
      )}
      <UnsavedChangesDialog {...unsaved.dialog} />
    </Modal>
  );
}
