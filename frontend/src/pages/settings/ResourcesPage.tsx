import { useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  Banner,
  Button,
  ConfirmDialog,
  EmptyState,
  ErrorSummary,
  Field,
  FormDialog,
  IconButton,
  LinkButton,
  NativeSelect,
  Skeleton,
  Tag,
  TextInput,
  Toggle,
  UnsavedChangesDialog,
  toast,
} from "@/components/ui/shared";
import { ClubSettingsLayout } from "@/components/settings/ClubSettingsLayout";
import { useClubSettingsPage } from "@/components/settings/useClubSettingsPage";
import { apiDelete, apiGet, apiPatch, apiPost } from "@/lib/api";
import {
  EMPTY_RESOURCE_FORM,
  hoursToMinutes,
  minutesToHours,
  placeTitle,
  resourceToForm,
  sameResourceForm,
  validateResourceForm,
  type ResourceForm,
  type ResourceProblem,
} from "@/lib/settings";
import type { Location, Resource } from "@/lib/types";
import { useUnsavedChanges } from "@/lib/useUnsavedChanges";
import { enterListRef } from "@/lib/pageMotion";

type Problem = ResourceProblem | "duplicate" | "unknownLocation";

const FIELD_OF: Record<Problem, string> = {
  locationRequired: "res-location",
  unknownLocation: "res-location",
  duplicate: "res-location",
  nameRequired: "res-name",
  bufferRange: "res-buffer",
};

/**
 * Club settings "Ressourcen": locations that can be booked once at a time. Everybody with at least
 * the viewer role sees the list, only admins create, edit and delete (form in a dialog).
 */
export default function ResourcesPage() {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const page = useClubSettingsPage();
  const { clubId, isAdmin } = page;
  const base = `/api/clubs/${clubId}/resources`;
  const queryKey = ["resources", clubId];

  const list = useQuery<Resource[]>({
    queryKey,
    queryFn: () => apiGet<Resource[]>(base),
    enabled: !!clubId,
  });
  const locations = useQuery<Location[]>({
    queryKey: ["locations", clubId],
    queryFn: () => apiGet<Location[]>(`/api/clubs/${clubId}/locations`),
    enabled: !!clubId && isAdmin,
  });

  const resources = useMemo(
    () =>
      [...(list.data ?? [])].sort((a, b) =>
        a.name.localeCompare(b.name, i18n.language, { sensitivity: "base" }),
      ),
    [list.data, i18n.language],
  );
  const locationName = (id: string) => {
    const loc = locations.data?.find((l) => l.id === id);
    return loc ? placeTitle(loc) : null;
  };
  const freeLocations = useMemo(() => {
    const taken = new Set(resources.map((r) => r.locationId));
    return (locations.data ?? [])
      .filter((l) => !taken.has(l.id))
      .map((l) => ({ id: l.id, title: placeTitle(l) ?? t("settings.places.unnamed") }))
      .sort((a, b) => a.title.localeCompare(b.title, i18n.language, { sensitivity: "base" }));
  }, [locations.data, resources, i18n.language, t]);

  // editing: null = closed, "new" = create, else the resource
  const [editing, setEditing] = useState<Resource | "new" | null>(null);
  const [form, setForm] = useState<ResourceForm>(EMPTY_RESOURCE_FORM);
  const [baseline, setBaseline] = useState<ResourceForm>(EMPTY_RESOURCE_FORM);
  const [problems, setProblems] = useState<Problem[]>([]);
  const [signal, setSignal] = useState(0);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const [nameTouched, setNameTouched] = useState(false);
  const [deleting, setDeleting] = useState<Resource | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const guard = useUnsavedChanges(!!editing && !sameResourceForm(form, baseline));
  const creating = editing === "new";

  function open(target: Resource | "new") {
    const next = target === "new" ? EMPTY_RESOURCE_FORM : resourceToForm(target);
    setEditing(target);
    setForm(next);
    setBaseline(next);
    setProblems([]);
    setFailed(false);
    setNameTouched(target !== "new");
  }

  function close() {
    if (saving) return;
    setEditing(null);
  }

  function change(patch: Partial<ResourceForm>) {
    setForm((f) => ({ ...f, ...patch }));
    setProblems([]);
    setFailed(false);
  }

  function pickLocation(locationId: string) {
    const title = freeLocations.find((l) => l.id === locationId)?.title ?? "";
    // The name follows the location until the user types an own one.
    change(nameTouched ? { locationId } : { locationId, name: title });
  }

  async function submit() {
    if (!editing) return;
    const found = validateResourceForm(form, creating);
    if (found.length > 0) {
      setProblems(found);
      setSignal((n) => n + 1);
      return;
    }
    const bufferMinutes = hoursToMinutes(form.bufferHours) ?? 0;
    setSaving(true);
    try {
      if (editing === "new") {
        await apiPost(base, {
          locationId: form.locationId,
          name: form.name.trim(),
          visibility: form.visibility,
          allowDoubleBooking: form.allowDoubleBooking,
          bufferMinutes,
        });
        toast.success(t("settings.resources.created", { name: form.name.trim() }));
      } else {
        const body: Record<string, unknown> = {
          name: form.name.trim(),
          visibility: form.visibility,
          allowDoubleBooking: form.allowDoubleBooking,
        };
        // Minutes set elsewhere (API, AI assistants) stay unless the hours were changed here.
        if (form.bufferHours.trim() !== String(minutesToHours(editing.bufferMinutes))) {
          body.bufferMinutes = bufferMinutes;
        }
        await apiPatch(`${base}/${editing.id}`, body);
        toast.success(t("settings.resources.saved"));
      }
      await qc.invalidateQueries({ queryKey });
      setEditing(null);
    } catch (error) {
      const code = (error as { code?: string } | null)?.code;
      if (code === "duplicate_resource" || code === "unknown_reference") {
        setProblems([code === "duplicate_resource" ? "duplicate" : "unknownLocation"]);
        setSignal((n) => n + 1);
        void qc.invalidateQueries({ queryKey });
        void qc.invalidateQueries({ queryKey: ["locations", clubId] });
      } else {
        setFailed(true);
      }
    } finally {
      setSaving(false);
    }
  }

  async function confirmDelete(item: Resource) {
    try {
      await apiDelete(`${base}/${item.id}`);
      await qc.invalidateQueries({ queryKey });
      toast.success(t("settings.resources.deleted", { name: item.name }));
      setTimeout(() => headingRef.current?.focus(), 0);
    } catch {
      toast.error(t("settings.resources.deleteFailed", { name: item.name }));
    }
  }

  const problemText = (p: Problem) => t(`settings.resources.problem.${p}`);
  const errorFor = (fieldId: string) => {
    const p = problems.find((x) => FIELD_OF[x] === fieldId);
    return p ? problemText(p) : undefined;
  };
  const canCreate = isAdmin && (locations.data ? freeLocations.length > 0 : true);

  let content;
  if (list.isLoading) {
    content = (
      <div className="ap-stack" aria-busy="true">
        <p className="ap-sr" role="status">
          {t("settings.resources.loading")}
        </p>
        <Skeleton style={{ display: "block", height: 56 }} />
        <Skeleton style={{ display: "block", height: 56 }} />
      </div>
    );
  } else if (list.isError && !list.data) {
    content = (
      <Banner
        tone="danger"
        title={t("settings.resources.loadError.title")}
        action={
          <Button variant="secondary" icon="refresh" onClick={() => void list.refetch()}>
            {t("settings.resources.loadError.retry")}
          </Button>
        }
      >
        {t("settings.resources.loadError.text")}
      </Banner>
    );
  } else if (resources.length === 0) {
    content = (
      <div className="ap-panel">
        <EmptyState
          icon="layers"
          title={t("settings.resources.empty.title")}
          text={
            !isAdmin
              ? t("settings.resources.empty.readOnly")
              : locations.data && locations.data.length === 0
                ? t("settings.resources.empty.noLocations")
                : t("settings.resources.empty.text")
          }
          actions={
            canCreate ? (
              <Button variant="secondary" icon="plus" onClick={() => open("new")}>
                {t("settings.resources.create")}
              </Button>
            ) : undefined
          }
        />
      </div>
    );
  } else {
    content = (
      <ul
        ref={enterListRef}
        className="ap-panel ap-panel--flush ap-list"
        aria-labelledby="res-list-h"
      >
        {resources.map((r) => (
          <li key={r.id} className="ap-listrow">
            <div className="ap-listrow-main">
              <b>{r.name}</b>
              {locationName(r.locationId) && locationName(r.locationId) !== r.name && (
                <span className="t-cap t-muted">{locationName(r.locationId)}</span>
              )}
            </div>
            <span className="ap-row ap-hide-m" style={{ gap: "var(--space-2)" }}>
              <Tag tone="neutral">
                {t(
                  r.visibility === "staff"
                    ? "settings.resources.visibilityStaff"
                    : "settings.resources.visibilityMembers",
                )}
              </Tag>
              {r.allowDoubleBooking && (
                <Tag tone="neutral">{t("settings.resources.doubleBookingTag")}</Tag>
              )}
              {r.bufferMinutes > 0 && (
                <Tag tone="neutral">
                  {t("settings.resources.bufferHours", { count: minutesToHours(r.bufferMinutes) })}
                </Tag>
              )}
            </span>
            <LinkButton
              variant="secondary"
              icon="calendar"
              to={`/clubs/${clubId}/resources/${r.id}/calendar`}
            >
              {t("settings.resources.calendar")}
            </LinkButton>
            {isAdmin && (
              <>
                <IconButton
                  id={`res-edit-btn-${r.id}`}
                  icon="edit"
                  label={t("settings.resources.editLabel", { name: r.name })}
                  onClick={() => open(r)}
                />
                <IconButton
                  icon="trash"
                  variant="danger"
                  label={t("settings.resources.deleteLabel", { name: r.name })}
                  onClick={() => setDeleting(r)}
                />
              </>
            )}
          </li>
        ))}
      </ul>
    );
  }

  const errors = problems.map((p) => ({ fieldId: FIELD_OF[p], message: problemText(p) }));

  return (
    <ClubSettingsLayout
      wide
      actions={
        canCreate && resources.length > 0 ? (
          <Button icon="plus" onClick={() => open("new")}>
            {t("settings.resources.create")}
          </Button>
        ) : undefined
      }
    >
      <p className="t-body t-muted t-prose">{t("settings.resources.description")}</p>
      <section className="ap-stack" aria-labelledby="res-list-h">
        <h2 className="t-h3" id="res-list-h" ref={headingRef} tabIndex={-1}>
          {t("settings.resources.listTitle", { count: resources.length })}
        </h2>
        {content}
      </section>

      {editing && (
        <FormDialog
          open
          onOpenChange={(o) => !o && guard.guard(close)}
          title={t(creating ? "settings.resources.createTitle" : "settings.resources.editTitle")}
          description={
            creating
              ? t("settings.resources.createText")
              : t("settings.resources.editText", { name: editing.name })
          }
          onSubmit={() => void submit()}
          finalFocus={
            creating ? undefined : () => document.getElementById(`res-edit-btn-${editing.id}`)
          }
          actions={
            <>
              <Button variant="secondary" onClick={() => guard.guard(close)} disabled={saving}>
                {t("common.cancel")}
              </Button>
              <Button type="submit" loading={saving}>
                {t("settings.resources.save")}
              </Button>
            </>
          }
        >
          <ErrorSummary
            title={t("settings.resources.errorSummary")}
            errors={errors}
            focusSignal={signal}
          />
          {failed && <Banner tone="danger">{t("settings.resources.saveFailed")}</Banner>}
          {creating ? (
            <Field
              id="res-location"
              label={t("settings.resources.location")}
              required
              error={errorFor("res-location")}
            >
              <NativeSelect value={form.locationId} onChange={(e) => pickLocation(e.target.value)}>
                <option value="">{t("settings.resources.locationPlaceholder")}</option>
                {freeLocations.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.title}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          ) : (
            <Field
              label={t("settings.resources.location")}
              hint={t("settings.resources.locationFixed")}
            >
              <TextInput value={locationName(editing.locationId) ?? ""} readOnly />
            </Field>
          )}
          <Field
            id="res-name"
            label={t("settings.resources.name")}
            required
            error={errorFor("res-name")}
          >
            <TextInput
              value={form.name}
              maxLength={255}
              autoComplete="off"
              onChange={(e) => {
                setNameTouched(true);
                change({ name: e.target.value });
              }}
            />
          </Field>
          <Field id="res-visibility" label={t("settings.resources.visibility")}>
            <NativeSelect
              value={form.visibility}
              onChange={(e) => change({ visibility: e.target.value as ResourceForm["visibility"] })}
            >
              <option value="staff">{t("settings.resources.visibilityStaff")}</option>
              <option value="members">{t("settings.resources.visibilityMembers")}</option>
            </NativeSelect>
          </Field>
          <Toggle
            label={t("settings.resources.doubleBooking")}
            hint={t("settings.resources.doubleBookingHint")}
            checked={form.allowDoubleBooking}
            onChange={(v) => change({ allowDoubleBooking: v })}
          />
          <Field
            id="res-buffer"
            label={t("settings.resources.buffer")}
            hint={t("settings.resources.bufferHint")}
            error={errorFor("res-buffer")}
          >
            <TextInput
              type="number"
              inputMode="numeric"
              min={0}
              max={24}
              step={1}
              value={form.bufferHours}
              onChange={(e) => change({ bufferHours: e.target.value })}
            />
          </Field>
        </FormDialog>
      )}
      <UnsavedChangesDialog {...guard.dialog} />

      {deleting && (
        <ConfirmDialog
          open
          onOpenChange={(o) => !o && setDeleting(null)}
          icon="trash"
          title={t("settings.resources.delete.title", { name: deleting.name })}
          description={t("settings.resources.delete.text")}
          confirmLabel={t("settings.resources.delete.confirm")}
          onConfirm={() => confirmDelete(deleting)}
        />
      )}
    </ClubSettingsLayout>
  );
}
