import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { Trans, useTranslation } from "react-i18next";
import {
  Banner,
  Button,
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
import { useLocale } from "@/components/calendar/useLocale";
import { apiPatch } from "@/lib/api";
import { formatClock, timeZoneList } from "@/lib/settings";
import { useUnsavedChanges } from "@/lib/useUnsavedChanges";
import type { Calendar } from "@/lib/types";

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
 * Settings "Allgemein" (design: SettingsGeneral): name and time zone. Archiving, duplicating and
 * deleting a calendar live on the club page (linked at the end); archived calendars are read-only
 * (banner with "Archivierung aufheben").
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

      <p className="t-body t-muted">
        <Trans
          i18nKey="settings.general.manageHint"
          components={{ clubLink: <Link className="ap-link" to={`/clubs/${clubId}`} /> }}
        />
      </p>
      <UnsavedChangesDialog {...guard.dialog} />
    </>
  );
}
