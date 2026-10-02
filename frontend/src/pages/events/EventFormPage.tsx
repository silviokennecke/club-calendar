import { useMemo, useState, type FormEvent } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { apiDelete, apiGet, apiPatch, apiPost } from "@/lib/api";
import { isValidIso } from "@/lib/calendar";
import {
  emptyEventValues,
  formatWeekdayDate,
  isFormDirty,
  toEventPayload,
  validateEvent,
  valuesFromEvent,
  valuesFromTemplate,
  type EventField,
  type EventFormValues,
} from "@/lib/events";
import type { CalendarEvent, EventTemplate } from "@/lib/types";
import { useUnsavedChanges } from "@/lib/useUnsavedChanges";
import {
  Banner,
  Button,
  ChipSelect,
  ConfirmDialog,
  EmptyState,
  ErrorSummary,
  Field,
  LinkButton,
  Skeleton,
  StatusBadge,
  TextInput,
  UnsavedChangesDialog,
  toast,
} from "@/components/ui/shared";
import { EventPageHead } from "@/components/events/EventPageHead";
import { StatusSeg } from "@/components/events/StatusSeg";
import { LocationSection } from "@/components/events/LocationSection";
import { useEventPage } from "@/components/events/useEventPage";
import { ArchivedCreateGuard } from "@/components/events/ArchivedCreateGuard";
import { useEventResources } from "@/components/events/useEventResources";
import { useLocale } from "@/components/calendar/useLocale";

/** Field ids, also the targets of the error summary links. */
const FIELD_IDS: Record<EventField, string> = {
  name: "ev-name",
  date: "ev-start",
  dateEnd: "ev-end",
  timeBegin: "ev-st",
  timeEnd: "ev-et",
};

/**
 * New event (design: EventNewForm, route …/events/new/form?date=&templateId=) and edit / view
 * (design: EventForm, EventFormMobile, route …/events/:eventId). Loads the data, then hands
 * the initial values to the editor.
 */
export default function EventFormPage() {
  const { eventId } = useParams<{ eventId: string }>();
  // Creating is impossible in archived calendars; existing events open read-only.
  return eventId ? (
    <EventFormLoader />
  ) : (
    <ArchivedCreateGuard>
      <EventFormLoader />
    </ArchivedCreateGuard>
  );
}

function EventFormLoader() {
  const { eventId } = useParams<{ eventId: string }>();
  const [params] = useSearchParams();
  const page = useEventPage();
  const { t } = useTranslation();
  const isNew = !eventId;
  const presetDate = params.get("date");
  const templateId = params.get("templateId");

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

  const loading =
    page.calendarLoading ||
    (!isNew && eventQuery.isPending && !eventQuery.isError) ||
    (isNew && !!templateId && templatesQuery.isPending && !templatesQuery.isError);

  if (loading) {
    return (
      <div className="ap-pagedialog" aria-busy="true">
        <p className="ap-sr" role="status">
          {t("events.form.loading")}
        </p>
        <Skeleton style={{ display: "block", height: 40, width: "50%" }} />
        <Skeleton style={{ display: "block", height: 320 }} />
      </div>
    );
  }

  if (!isNew && eventQuery.isError) {
    const status = (eventQuery.error as { message?: string })?.message ?? "";
    const notFound = /404/.test(status);
    return (
      <div className="ap-pagedialog">
        {notFound ? (
          <EmptyState
            icon="search"
            headingLevel="h2"
            title={t("events.form.notFound.title")}
            text={t("events.form.notFound.text")}
            actions={
              <LinkButton variant="secondary" icon="arrow-left" to={page.routes.list}>
                {t("events.form.notFound.back")}
              </LinkButton>
            }
          />
        ) : (
          <Banner
            tone="danger"
            title={t("events.form.loadError.title")}
            action={
              <Button variant="secondary" icon="refresh" onClick={() => eventQuery.refetch()}>
                {t("events.form.loadError.retry")}
              </Button>
            }
          >
            {t("events.form.loadError.text")}
          </Banner>
        )}
      </div>
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
  const res = useEventResources(page.calendarId);
  const navigate = useNavigate();
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

  const dirty = !readOnly && isFormDirty(initial, values);
  const unsaved = useUnsavedChanges(dirty);

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
    unsaved.guard(() => navigate(page.returnTo));
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (readOnly) return;
    setSubmits((n) => n + 1);
    if (errors.length > 0) return;
    setSaving(true);
    try {
      const body = toEventPayload(values);
      if (event) await apiPatch(`/api/calendars/${page.calendarId}/events/${event.id}`, body);
      else await apiPost(`/api/calendars/${page.calendarId}/events`, body);
      await qc.invalidateQueries({ queryKey: ["events", page.calendarId] });
      toast.success(t("events.form.saved"));
      navigate(page.returnTo);
    } catch {
      toast.error(t("events.form.saveFailed"));
    } finally {
      setSaving(false);
    }
  }

  async function onDelete() {
    if (!event) return;
    try {
      await apiDelete(`/api/calendars/${page.calendarId}/events/${event.id}`);
      qc.removeQueries({ queryKey: ["events", page.calendarId, "one", event.id] });
      await qc.invalidateQueries({ queryKey: ["events", page.calendarId] });
      toast.success(t("events.delete.done"));
      setDeleteOpen(false);
      navigate(page.returnTo === page.routes.edit(event.id) ? page.routes.list : page.returnTo);
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
    <div className="ap-pagedialog">
      <EventPageHead
        title={title}
        subtitle={isNew ? t("events.form.newSubtitle") : page.calendar?.name}
        extra={event && <StatusBadge status={values.status === "draft" ? "draft" : "published"} />}
        closeLabel={
          readOnly
            ? t("events.form.close")
            : isNew
              ? t("events.form.closeNew")
              : t("events.form.closeEdit")
        }
        onClose={leave}
      />

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
      {!isNew && !readOnly && values.status === "published" && (
        <Banner tone="info">{t("events.form.publishedNotice")}</Banner>
      )}
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
            <ChipSelect
              label={t("events.form.properties")}
              options={res.properties.map((p) => ({
                id: p.id,
                label: p.icon ? `${p.icon} ${p.name}` : p.name,
              }))}
              selected={values.propertyIds}
              onChange={(ids) => set("propertyIds", ids)}
              onCreate={readOnly ? undefined : (name) => createAndReport(res.createProperty, name)}
              createLabel={t("events.form.createProperty")}
            />
            <ChipSelect
              label={t("events.form.features")}
              options={res.features.map((f) => ({ id: f.id, label: f.name }))}
              selected={values.featureIds}
              onChange={(ids) => set("featureIds", ids)}
              onCreate={readOnly ? undefined : (name) => createAndReport(res.createFeature, name)}
              createLabel={t("events.form.createFeature")}
            />
            <ChipSelect
              label={t("events.form.targetGroups")}
              options={res.targetGroups.map((g) => ({ id: g.id, label: g.name }))}
              selected={values.targetGroupIds}
              onChange={(ids) => set("targetGroupIds", ids)}
              onCreate={
                readOnly ? undefined : (name) => createAndReport(res.createTargetGroup, name)
              }
              createLabel={t("events.form.createTargetGroup")}
              hint={t("events.form.targetGroupsHint")}
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
                  navigate(page.routes.create(presetDate), { state: page.navState }),
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

      {event && (
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
          onConfirm={onDelete}
        />
      )}
      <UnsavedChangesDialog {...unsaved.dialog} />
    </div>
  );

  async function createAndReport(fn: (name: string) => Promise<{ id: string }>, name: string) {
    try {
      return (await fn(name)).id;
    } catch (err) {
      toast.error(t("events.form.createFailed"));
      throw err;
    }
  }
}
