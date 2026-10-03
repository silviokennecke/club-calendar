import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  Banner,
  Button,
  ConfirmDialog,
  ErrorSummary,
  Field,
  NativeSelect,
  TextInput,
  Toggle,
  UnsavedChangesDialog,
  toast,
} from "@/components/ui/shared";
import { SettingsLayout } from "@/components/settings/SettingsLayout";
import { useSettingsPage } from "@/components/settings/useSettingsPage";
import { useCalendarActions } from "@/components/settings/useCalendarActions";
import { useLocale } from "@/components/calendar/useLocale";
import { apiGet, apiPatch } from "@/lib/api";
import { formatClock, timeZoneList } from "@/lib/settings";
import { useUnsavedChanges } from "@/lib/useUnsavedChanges";
import type { Calendar, CalendarEvent, CalendarFeed, EventTemplate } from "@/lib/types";

interface FormValues {
  name: string;
  useClub: boolean;
  zone: string;
}

/** Re-renders every 30 seconds so the time zone check stays current. */
function useNow(intervalMs = 30_000) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

/**
 * Settings "Allgemein" (design: SettingsGeneral): name and time zone, plus archive, duplicate and
 * delete of the calendar. Archived calendars are read-only (banner with "Archivierung aufheben").
 */
export default function CalendarSettingsPage() {
  const page = useSettingsPage();
  return (
    <SettingsLayout>
      {page.calendar && <GeneralForm key={page.calendar.id} calendar={page.calendar} />}
    </SettingsLayout>
  );
}

function GeneralForm({ calendar }: { calendar: Calendar }) {
  const { t } = useTranslation();
  const locale = useLocale();
  const qc = useQueryClient();
  const page = useSettingsPage();
  const { clubId, calendarId, readOnly } = page;
  const clubZone = page.club?.timezone ?? "";
  const actions = useCalendarActions(clubId, calendarId, calendar.name);

  const saved: FormValues = useMemo(
    () => ({
      name: calendar.name,
      useClub: !calendar.timezone,
      zone: calendar.timezone || clubZone || "Europe/Berlin",
    }),
    [calendar.name, calendar.timezone, clubZone],
  );
  const [draft, setDraft] = useState<FormValues | null>(null);
  const values = draft ?? saved;
  const dirty =
    draft !== null &&
    (draft.name.trim() !== saved.name ||
      draft.useClub !== saved.useClub ||
      (!draft.useClub && draft.zone !== saved.zone));
  const guard = useUnsavedChanges(dirty);

  const [nameError, setNameError] = useState(false);
  const [signal, setSignal] = useState(0);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  const now = useNow();

  function change(patch: Partial<FormValues>) {
    setDraft({ ...values, ...patch });
    setFailed(false);
  }

  const effectiveZone = values.useClub ? clubZone : values.zone;
  const clock = effectiveZone ? formatClock(now, effectiveZone, locale) : null;
  const zones = useMemo(() => timeZoneList(values.zone), [values.zone]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (readOnly) return;
    if (!values.name.trim()) {
      setNameError(true);
      setSignal((n) => n + 1);
      return;
    }
    setNameError(false);
    setSaving(true);
    setFailed(false);
    try {
      const updated = await apiPatch<Calendar>(`/api/clubs/${clubId}/calendars/${calendarId}`, {
        name: values.name.trim(),
        timezone: values.useClub ? null : values.zone,
      });
      qc.setQueryData(["calendar", clubId, calendarId], updated);
      await qc.invalidateQueries({ queryKey: ["calendars", clubId] });
      setDraft(null);
      toast.success(t("settings.general.saved"));
    } catch {
      setFailed(true);
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <form className="ap-stack ap-stack--lg" noValidate onSubmit={(e) => void submit(e)}>
        <ErrorSummary
          title={t("settings.general.errorSummary")}
          errors={
            nameError ? [{ fieldId: "gen-name", message: t("settings.general.nameError") }] : []
          }
          focusSignal={signal}
        />
        {failed && (
          <Banner tone="danger" title={t("settings.general.saveFailed.title")}>
            {t("settings.general.saveFailed.text")}
          </Banner>
        )}

        <section className="ap-panel ap-form" aria-labelledby="gen-name-h">
          <h2 className="t-h3" id="gen-name-h">
            {t("settings.general.calendar")}
          </h2>
          <Field
            id="gen-name"
            label={t("settings.general.nameLabel")}
            required
            hint={t("settings.general.nameHint")}
            error={nameError ? t("settings.general.nameError") : undefined}
          >
            <TextInput
              ref={nameRef}
              value={values.name}
              maxLength={255}
              autoComplete="off"
              readOnly={readOnly}
              onChange={(e) => {
                change({ name: e.target.value });
                setNameError(false);
              }}
            />
          </Field>
        </section>

        <section className="ap-panel ap-form" aria-labelledby="gen-tz-h">
          <h2 className="t-h3" id="gen-tz-h">
            {t("settings.general.timezone")}
          </h2>
          <Toggle
            label={t("settings.general.useClub")}
            hint={clubZone || undefined}
            checked={values.useClub}
            disabled={readOnly}
            onChange={(on) => change({ useClub: on })}
          />
          {!values.useClub && (
            <Field
              id="gen-tz"
              label={t("settings.general.ownZone")}
              hint={t("settings.general.ownZoneHint")}
            >
              <NativeSelect
                value={values.zone}
                disabled={readOnly}
                onChange={(e) => change({ zone: e.target.value })}
              >
                {zones.map((z) => (
                  <option key={z} value={z}>
                    {z}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          )}
          {clock && (
            <div className="ap-panel ap-panel--sunken">
              <p className="t-label">
                {t("settings.general.clock", { zone: effectiveZone, ...clock })}
              </p>
              <p className="t-sm t-muted">{t("settings.general.clockHint")}</p>
            </div>
          )}
        </section>

        {!readOnly && (
          <div className="ap-actions">
            <Button type="submit" loading={saving} disabled={!dirty && !saving}>
              {t("settings.general.save")}
            </Button>
          </div>
        )}
      </form>

      <ManageSection calendar={calendar} actions={actions} />
      <UnsavedChangesDialog {...guard.dialog} />
    </>
  );
}

function ManageSection({
  calendar,
  actions,
}: {
  calendar: Calendar;
  actions: ReturnType<typeof useCalendarActions>;
}) {
  const { t } = useTranslation();
  const { calendarId, readOnly } = useSettingsPage();
  const [deleteOpen, setDeleteOpen] = useState(false);

  // What deleting removes; fetched only when the dialog opens.
  const scope = useQuery({
    queryKey: ["calendarScope", calendarId],
    enabled: deleteOpen,
    staleTime: 0,
    gcTime: 0,
    queryFn: async () => {
      const [events, templates, feeds] = await Promise.all([
        apiGet<CalendarEvent[]>(`/api/calendars/${calendarId}/events`),
        apiGet<EventTemplate[]>(`/api/calendars/${calendarId}/templates`),
        apiGet<CalendarFeed[]>(`/api/calendars/${calendarId}/feeds`),
      ]);
      return { events: events.length, templates: templates.length, feeds: feeds.length };
    },
  });

  let consequence: string;
  if (scope.isError) consequence = t("settings.delete.consequence.unknown");
  else if (!scope.data) consequence = t("settings.delete.consequence.loading");
  else
    consequence = t("settings.delete.consequence.counts", {
      name: calendar.name,
      events: scope.data.events,
      templates: scope.data.templates,
      feeds: scope.data.feeds,
    });

  return (
    <section className="ap-stack" aria-labelledby="gen-manage-h">
      <h2 className="t-h3" id="gen-manage-h">
        {t("settings.manage.title")}
      </h2>
      <ul className="ap-panel ap-panel--flush ap-list">
        <li className="ap-listrow ap-listrow--wrap">
          <div className="ap-listrow-main" style={{ minWidth: 220 }}>
            <b>{t("settings.duplicate.title")}</b>
            <span>{t("settings.duplicate.text")}</span>
          </div>
          <Button
            variant="secondary"
            icon="copy"
            onClick={() => void actions.duplicate()}
            loading={actions.busy === "duplicate"}
          >
            {t("settings.duplicate.action")}
          </Button>
        </li>
        <li className="ap-listrow ap-listrow--wrap">
          <div className="ap-listrow-main" style={{ minWidth: 220 }}>
            <b>{readOnly ? t("settings.archived.title") : t("settings.archive.title")}</b>
            <span>{readOnly ? t("settings.archived.rowText") : t("settings.archive.text")}</span>
          </div>
          {readOnly ? (
            <Button
              variant="secondary"
              icon="refresh"
              onClick={() => void actions.unarchive()}
              loading={actions.busy === "unarchive"}
            >
              {t("calendar.archived.unarchive")}
            </Button>
          ) : (
            <ConfirmDialog
              trigger={
                <Button variant="secondary" icon="archive" loading={actions.busy === "archive"}>
                  {t("settings.archive.action")}
                </Button>
              }
              tone="primary"
              icon="archive"
              title={t("settings.archive.confirmTitle", { name: calendar.name })}
              description={t("settings.archive.confirmText")}
              consequence={t("settings.archive.consequence")}
              confirmLabel={t("settings.archive.action")}
              onConfirm={actions.archive}
            />
          )}
        </li>
        <li className="ap-listrow ap-listrow--wrap">
          <div className="ap-listrow-main" style={{ minWidth: 220 }}>
            <b>{t("settings.delete.title")}</b>
            <span>{t("settings.delete.text")}</span>
          </div>
          <Button variant="ghost-danger" icon="trash" onClick={() => setDeleteOpen(true)}>
            {t("settings.delete.action")}
          </Button>
        </li>
      </ul>
      {deleteOpen && (
        <ConfirmDialog
          open
          onOpenChange={setDeleteOpen}
          icon="trash"
          title={t("settings.delete.confirmTitle", { name: calendar.name })}
          description={t("settings.delete.confirmText")}
          consequence={consequence}
          confirmLabel={t("settings.delete.confirm")}
          onConfirm={actions.remove}
        />
      )}
    </section>
  );
}
