import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { apiDelete, apiErrorStatus, apiGet, apiPatch, apiPost } from "@/lib/api";
import { keepExisting, saveDroppingDeletedReferences } from "@/lib/staleReferences";
import { NOTE_MAX, locationName } from "@/lib/events";
import {
  TIMEZONES,
  emptyTemplateValues,
  isTemplateDirty,
  templateDeleteConsequence,
  toTemplatePayload,
  validateTemplate,
  valuesFromTemplateRecord,
  type TemplateField,
  type TemplateFormValues,
} from "@/lib/templates";
import type { EventTemplate } from "@/lib/types";
import { useUnsavedChanges } from "@/lib/useUnsavedChanges";
import {
  Banner,
  Button,
  ConfirmDialog,
  EmptyState,
  ErrorSummary,
  Field,
  Icon,
  LinkButton,
  NativeSelect,
  Skeleton,
  TextArea,
  TextInput,
  Toggle,
  UnsavedChangesDialog,
  toast,
} from "@/components/ui/shared";
import { AssignmentFields } from "@/components/events/AssignmentFields";
import { useEventPage } from "@/components/events/useEventPage";
import { useEventResources } from "@/components/events/useEventResources";
import type { EventNavState } from "@/components/events/routes";
import { ArchivedCreateGuard } from "@/components/events/ArchivedCreateGuard";

/** Field ids, also the targets of the error summary links. */
const FIELD_IDS: Record<TemplateField, string> = {
  name: "tpl-name",
  timeBegin: "tpl-start",
  timeEnd: "tpl-end",
  note: "tpl-note",
};

/**
 * New template (…/templates/new) and edit (…/templates/:templateId), design: TemplateEdit. The
 * form is built from the same parts as the event form (fields, chip selects with inline creation).
 */
export default function TemplateEditPage() {
  const { templateId } = useParams<{ templateId: string }>();
  // Archived calendars are read-only: a template can be viewed, but not created.
  return templateId ? (
    <TemplateLoader />
  ) : (
    <ArchivedCreateGuard>
      <TemplateLoader />
    </ArchivedCreateGuard>
  );
}

function TemplateLoader() {
  const { templateId } = useParams<{ templateId: string }>();
  const page = useEventPage();
  const { t } = useTranslation();
  const isNew = !templateId;

  const query = useQuery<EventTemplate>({
    queryKey: ["templates", page.calendarId, "one", templateId],
    queryFn: () =>
      apiGet<EventTemplate>(`/api/calendars/${page.calendarId}/templates/${templateId}`),
    enabled: !isNew,
    retry: false,
  });

  if (page.calendarLoading || (!isNew && query.isPending && !query.isError)) {
    return (
      <div className="ap-wrap--narrow" aria-busy="true">
        <p className="ap-sr" role="status">
          {t("templates.form.loading")}
        </p>
        <div className="ap-stack ap-stack--lg">
          <Skeleton style={{ display: "block", height: 40, width: "50%" }} />
          <Skeleton style={{ display: "block", height: 360 }} />
        </div>
      </div>
    );
  }

  if (!isNew && query.isError) {
    const notFound = apiErrorStatus(query.error) === 404;
    return (
      <div className="ap-wrap--narrow">
        {notFound ? (
          <EmptyState
            icon="search"
            headingLevel="h1"
            title={t("templates.form.notFound.title")}
            text={t("templates.form.notFound.text")}
            actions={
              <LinkButton variant="secondary" icon="arrow-left" to={page.routes.templates}>
                {t("templates.form.back")}
              </LinkButton>
            }
          />
        ) : (
          <Banner
            tone="danger"
            title={t("templates.form.loadError.title")}
            action={
              <Button variant="secondary" icon="refresh" onClick={() => query.refetch()}>
                {t("templates.form.loadError.retry")}
              </Button>
            }
          >
            {t("templates.form.loadError.text")}
          </Banner>
        )}
      </div>
    );
  }

  return <TemplateEditor key={templateId ?? "new"} template={query.data} />;
}

function TemplateEditor({ template }: { template?: EventTemplate }) {
  const page = useEventPage();
  const res = useEventResources(page.clubId, page.calendarId);
  const navigate = useNavigate();
  const location = useLocation();
  const qc = useQueryClient();
  const { t } = useTranslation();
  const isNew = !template;
  const readOnly = page.readOnly;
  const clubTimezone = page.timeZone;

  // The starting point of this edit session.
  const [initial] = useState<TemplateFormValues>(() =>
    template ? valuesFromTemplateRecord(template, clubTimezone) : emptyTemplateValues(),
  );
  const [values, setValues] = useState<TemplateFormValues>(initial);
  const [touched, setTouched] = useState<Set<TemplateField>>(new Set());
  const [submits, setSubmits] = useState(0);
  const [saving, setSaving] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const returnTo = (location.state as EventNavState | null)?.from ?? page.routes.templates;
  const dirty = !readOnly && isTemplateDirty(initial, values);
  const unsaved = useUnsavedChanges(dirty);

  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
  }, []);

  const errors = useMemo(() => validateTemplate(values), [values]);
  const visible = errors.filter(
    (e) => submits > 0 || touched.has(e.field) || e.code === "timeEndBeforeStart",
  );
  const errorFor = (field: TemplateField) => {
    const err = visible.find((e) => e.field === field);
    return err ? t(`templates.form.errors.${err.code}`) : undefined;
  };
  const blur = (field: TemplateField) => () => setTouched((prev) => new Set(prev).add(field));

  function set<K extends keyof TemplateFormValues>(key: K, value: TemplateFormValues[K]) {
    setValues((v) => ({ ...v, [key]: value }));
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (readOnly) return;
    setSubmits((n) => n + 1);
    if (errors.length > 0) return;
    setSaving(true);
    try {
      await saveDroppingDeletedReferences(
        qc,
        page,
        ["properties", "features", "targetGroups", "locations"],
        toTemplatePayload(values, clubTimezone),
        (body) =>
          template
            ? apiPatch(`/api/calendars/${page.calendarId}/templates/${template.id}`, body)
            : apiPost(`/api/calendars/${page.calendarId}/templates`, body),
        (body, existing) => ({
          ...body,
          propertyIds: keepExisting(body.propertyIds, existing.properties),
          featureIds: keepExisting(body.featureIds, existing.features),
          targetGroupIds: keepExisting(body.targetGroupIds, existing.targetGroups),
          locationId:
            body.locationId && existing.locations.has(body.locationId) ? body.locationId : null,
        }),
      );
      await qc.invalidateQueries({ queryKey: ["templates", page.calendarId] });
      toast.success(t("templates.form.saved"));
      navigate(returnTo);
    } catch {
      toast.error(t("templates.form.saveFailed"));
    } finally {
      setSaving(false);
    }
  }

  async function onDelete() {
    if (!template) return;
    try {
      await apiDelete(`/api/calendars/${page.calendarId}/templates/${template.id}`);
      qc.removeQueries({ queryKey: ["templates", page.calendarId, "one", template.id] });
      await qc.invalidateQueries({ queryKey: ["templates", page.calendarId] });
      toast.success(t("templates.delete.done"));
      setDeleteOpen(false);
      navigate(page.routes.templates);
    } catch {
      toast.error(t("templates.delete.failed"));
    }
  }

  const zones = TIMEZONES.includes(values.timezone) ? TIMEZONES : [values.timezone, ...TIMEZONES];
  const summary = visible.map((e) => ({
    fieldId: FIELD_IDS[e.field],
    message: t(`templates.form.errors.${e.code}`),
  }));
  const heading1 = readOnly
    ? t("templates.form.viewTitle", { name: template?.name })
    : isNew
      ? t("templates.form.newTitle")
      : t("templates.form.editTitle", { name: template?.name });

  return (
    <div className="ap-wrap--narrow">
      <div className="ap-stack ap-stack--lg">
        <div className="ap-stack ap-stack--sm">
          <Link className="ap-back" to={returnTo}>
            <Icon glyph="arrow-left" size={18} />
            {t("templates.form.back")}
          </Link>
          <h1 className="t-h1 ap-focus-target" ref={heading} tabIndex={-1}>
            {heading1}
          </h1>
        </div>

        {readOnly ? (
          <Banner tone="warning" icon="lock" title={t("shell.archivedReadOnly")}>
            {page.isArchived ? t("templates.form.readOnly") : t("shell.roleReadOnly")}
          </Banner>
        ) : (
          <Banner
            tone="info"
            title={t(isNew ? "templates.form.noteNewTitle" : "templates.form.noteEditTitle")}
          >
            {t(isNew ? "templates.form.noteNewText" : "templates.form.noteEditText")}
          </Banner>
        )}

        <ErrorSummary
          title={t("templates.form.errorTitle")}
          errors={summary}
          focusSignal={submits}
        />

        <form
          className="ap-panel ap-form"
          aria-label={t("templates.form.label")}
          noValidate
          onSubmit={onSubmit}
        >
          <fieldset disabled={readOnly} className="ap-stack m-0 min-w-0 border-0 p-0">
            <Field
              id={FIELD_IDS.name}
              label={t("templates.form.name")}
              required
              error={errorFor("name")}
            >
              <TextInput
                value={values.name}
                autoComplete="off"
                placeholder={t("templates.form.namePlaceholder")}
                onChange={(e) => set("name", e.target.value)}
                onBlur={blur("name")}
              />
            </Field>

            <Toggle
              label={t("templates.form.clubZone", { zone: clubTimezone ?? "Europe/Berlin" })}
              checked={values.useClubTimezone}
              onChange={(on) => set("useClubTimezone", on)}
            />
            {!values.useClubTimezone && (
              <Field id="tpl-tz" label={t("templates.form.zone")}>
                <NativeSelect
                  value={values.timezone}
                  onChange={(e) => set("timezone", e.target.value)}
                >
                  {zones.map((zone) => (
                    <option key={zone} value={zone}>
                      {zone}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
            )}

            <fieldset className="ap-fieldset">
              <legend className="ap-sr">{t("templates.form.times")}</legend>
              <div className="ap-inputrow">
                <Field
                  id={FIELD_IDS.timeBegin}
                  label={t("templates.form.start")}
                  hint={t("templates.form.startHint")}
                  optional
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
                  label={t("templates.form.end")}
                  hint={t("templates.form.endHint")}
                  optional
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

            <Field id="tpl-place" label={t("templates.form.place")} optional>
              <NativeSelect
                value={values.locationId}
                onChange={(e) => set("locationId", e.target.value)}
              >
                <option value="">{t("templates.form.noPlace")}</option>
                {res.locations.map((l) => (
                  <option key={l.id} value={l.id}>
                    {locationName(l)}
                  </option>
                ))}
              </NativeSelect>
            </Field>

            <Field
              id={FIELD_IDS.note}
              label={t("templates.form.noteField")}
              optional
              hint={`${t("templates.form.noteFieldHint")} ${t("templates.form.noteCount", {
                count: values.note.length,
                max: NOTE_MAX,
              })}`}
              error={errorFor("note")}
            >
              <TextArea
                rows={4}
                value={values.note}
                onChange={(e) => set("note", e.target.value)}
                onBlur={blur("note")}
              />
            </Field>

            <AssignmentFields
              resources={res}
              value={values}
              onChange={(field, ids) => set(field, ids)}
              readOnly={readOnly}
              targetGroupsHint={t("templates.form.audiencesHint")}
            />
          </fieldset>

          <div className="ap-actions" style={{ justifyContent: "space-between" }}>
            <div className="ap-actions">
              {!readOnly && (
                <Button type="submit" loading={saving} loadingLabel={t("templates.form.saving")}>
                  {t("templates.form.save")}
                </Button>
              )}
              <LinkButton variant="secondary" to={returnTo}>
                {readOnly ? t("templates.form.back") : t("common.cancel")}
              </LinkButton>
            </div>
            {template && !readOnly && (
              <Button variant="ghost-danger" icon="trash" onClick={() => setDeleteOpen(true)}>
                {t("templates.form.delete")}
              </Button>
            )}
          </div>
        </form>
      </div>

      {template && (
        <ConfirmDialog
          open={deleteOpen}
          onOpenChange={setDeleteOpen}
          icon="trash"
          title={t("templates.delete.title", { name: template.name })}
          description={t("templates.delete.text")}
          consequence={templateDeleteConsequence(template, t)}
          confirmLabel={t("templates.delete.confirm")}
          onConfirm={onDelete}
        />
      )}
      <UnsavedChangesDialog {...unsaved.dialog} />
    </div>
  );
}
