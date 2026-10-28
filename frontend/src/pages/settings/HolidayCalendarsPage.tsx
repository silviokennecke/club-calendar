import { useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  Banner,
  Button,
  ConfirmDialog,
  EmptyState,
  ErrorSummary,
  Field,
  NativeSelect,
  Skeleton,
  Tag,
  TextInput,
  UnsavedChangesDialog,
  toast,
} from "@/components/ui/shared";
import { SettingsLayout } from "@/components/settings/SettingsLayout";
import { HolidayPreview } from "@/components/settings/HolidayPreview";
import { useSettingsPage } from "@/components/settings/useSettingsPage";
import { useLocale } from "@/components/calendar/useLocale";
import {
  createHolidayCalendar,
  createPredefinedHolidayCalendars,
  deleteHolidayCalendar,
  getHolidayCalendars,
  getHolidayCountries,
  getHolidaySubdivisions,
  refreshHolidayCalendar,
} from "@/lib/api";
import { useUnsavedChanges } from "@/lib/useUnsavedChanges";
import { formatFetched, validateHolidayForm, type HolidayFormProblem } from "@/lib/settings";
import type { HolidayCalendar, HolidayType } from "@/lib/types";
import { enterListRef } from "@/lib/pageMotion";

/**
 * Settings "Feiertage" (design: SettingsHolidays): holiday calendars from an ICS address — add,
 * refresh, delete, with status (count, last fetch), per-calendar holiday list and errors.
 */
/**
 * The address is the problem: it could not be fetched (422 `ics_fetch_failed`) or the server rejects it
 * (`validation_failed` on `url`, e.g. no top-level domain). Matched by code and field, never the message.
 */
function isAddressProblem(error: unknown): boolean {
  const { code, field } = (error ?? {}) as { code?: string; field?: string };
  return code === "ics_fetch_failed" || (code === "validation_failed" && field === "url");
}

const SOURCE_STALE_TIME = 24 * 60 * 60 * 1000;
const DEFAULT_COUNTRY = "DE";
const TYPE_TONE = { public: "brand", school: "accent", other: "neutral" } as const;

export default function HolidayCalendarsPage() {
  const { t } = useTranslation();
  const locale = useLocale();
  const qc = useQueryClient();
  const page = useSettingsPage();
  const { calendarId, readOnly, timeZone } = page;
  const queryKey = ["holidayCalendars", calendarId];

  const [mode, setMode] = useState<"predefined" | "ics">("predefined");
  const [icsType, setIcsType] = useState<HolidayType>("other");
  const [country, setCountry] = useState(DEFAULT_COUNTRY);
  const [subdivision, setSubdivision] = useState("");
  const [kinds, setKinds] = useState({ public: true, school: true });
  const [kindsError, setKindsError] = useState(false);
  const list = useQuery<HolidayCalendar[]>({
    queryKey,
    queryFn: () => getHolidayCalendars(calendarId),
  });
  const items = list.data ?? [];

  const countries = useQuery({
    queryKey: ["holidaySources", "countries"],
    queryFn: getHolidayCountries,
    staleTime: SOURCE_STALE_TIME,
    enabled: !readOnly && mode === "predefined",
  });
  const subdivisions = useQuery({
    queryKey: ["holidaySources", "subdivisions", country],
    queryFn: () => getHolidaySubdivisions(country),
    staleTime: SOURCE_STALE_TIME,
    enabled: !readOnly && mode === "predefined" && country !== "",
  });
  const countryOptions = countries.data?.length
    ? countries.data
    : [{ isoCode: DEFAULT_COUNTRY, name: t("settings.holidays.defaultCountry") }];
  const subdivisionOptions = (subdivisions.data ?? []).flatMap((s) => [
    { code: s.code, name: s.name, label: s.name },
    ...s.children.map((c) => ({ code: c.code, name: c.name, label: `– ${c.name}` })),
  ]);

  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [problem, setProblem] = useState<HolidayFormProblem>({});
  const [signal, setSignal] = useState(0);
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<"fetch" | "source" | "other" | null>(null);
  const unsaved = useUnsavedChanges(!readOnly && (name.trim() !== "" || url.trim() !== ""));
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rowErrors, setRowErrors] = useState<Record<string, boolean>>({});
  const [deleting, setDeleting] = useState<HolidayCalendar | null>(null);

  const problemText = {
    name: { empty: t("settings.holidays.errors.nameEmpty") },
    url: {
      empty: t("settings.holidays.errors.urlEmpty"),
      invalid: t("settings.holidays.errors.urlInvalid"),
    },
  };
  const summary = [
    ...(problem.name ? [{ fieldId: "hol-name", message: problemText.name[problem.name] }] : []),
    ...(problem.url ? [{ fieldId: "hol-url", message: problemText.url[problem.url] }] : []),
  ];

  async function submitPredefined() {
    setAddError(null);
    if (!kinds.public && !kinds.school) {
      setKindsError(true);
      return;
    }
    setKindsError(false);
    setAdding(true);
    try {
      const chosen = subdivisionOptions.find((o) => o.code === subdivision);
      const created = await createPredefinedHolidayCalendars(calendarId, {
        country,
        ...(subdivision ? { subdivision } : {}),
        kinds: [
          ...(kinds.public ? ["public" as const] : []),
          ...(kinds.school ? ["school" as const] : []),
        ],
        ...(chosen ? { regionName: chosen.name } : {}),
      });
      await qc.invalidateQueries({ queryKey });
      void qc.invalidateQueries({ queryKey: ["holidayEvents", calendarId] });
      toast.success(t("settings.holidays.predefinedAdded", { count: created.length }));
    } catch (error) {
      setAddError(
        (error as { code?: string } | null)?.code === "holiday_source_failed" ? "source" : "other",
      );
    } finally {
      setAdding(false);
    }
  }

  async function submitAdd(e: FormEvent) {
    e.preventDefault();
    if (mode === "predefined") {
      await submitPredefined();
      return;
    }
    const found = validateHolidayForm(name, url);
    setAddError(null);
    setProblem(found);
    if (found.name || found.url) {
      setSignal((n) => n + 1);
      return;
    }
    setAdding(true);
    try {
      const created = await createHolidayCalendar(calendarId, {
        name: name.trim(),
        url: url.trim(),
        type: icsType,
      });
      await qc.invalidateQueries({ queryKey });
      void qc.invalidateQueries({ queryKey: ["holidayEvents", calendarId] });
      setName("");
      setUrl("");
      toast.success(t("settings.holidays.added", { count: created.eventCount }));
    } catch (error) {
      setAddError(isAddressProblem(error) ? "fetch" : "other");
    } finally {
      setAdding(false);
    }
  }

  async function refresh(hc: HolidayCalendar) {
    setBusyId(hc.id);
    setRowErrors((r) => ({ ...r, [hc.id]: false }));
    try {
      const updated = await refreshHolidayCalendar(calendarId, hc.id);
      await qc.invalidateQueries({ queryKey });
      void qc.invalidateQueries({ queryKey: ["holidayEvents", calendarId] });
      toast.success(t("settings.holidays.refreshed", { count: updated.eventCount }));
    } catch {
      setRowErrors((r) => ({ ...r, [hc.id]: true }));
    } finally {
      setBusyId(null);
    }
  }

  async function remove(hc: HolidayCalendar) {
    try {
      await deleteHolidayCalendar(calendarId, hc.id);
      await qc.invalidateQueries({ queryKey });
      void qc.invalidateQueries({ queryKey: ["holidayEvents", calendarId] });
      toast.success(t("settings.holidays.deleted", { name: hc.name }));
    } catch {
      toast.error(t("settings.holidays.deleteFailed", { name: hc.name }));
    }
  }

  let listContent;
  if (list.isLoading) {
    listContent = (
      <div className="ap-stack" aria-busy="true">
        <p className="ap-sr" role="status">
          {t("settings.holidays.loading")}
        </p>
        <Skeleton style={{ display: "block", height: 72 }} />
      </div>
    );
  } else if (list.isError && !list.data) {
    listContent = (
      <Banner
        tone="danger"
        title={t("settings.holidays.loadError.title")}
        action={
          <Button variant="secondary" icon="refresh" onClick={() => void list.refetch()}>
            {t("settings.holidays.loadError.retry")}
          </Button>
        }
      >
        {t("settings.holidays.loadError.text")}
      </Banner>
    );
  } else if (items.length === 0) {
    listContent = (
      <div className="ap-panel">
        <EmptyState
          icon="flag"
          title={t("settings.holidays.empty.title")}
          text={
            readOnly ? t("settings.holidays.empty.readOnly") : t("settings.holidays.empty.text")
          }
          actions={
            readOnly ? undefined : (
              <Button
                variant="secondary"
                icon="plus"
                onClick={() => document.getElementById("hol-name")?.focus()}
              >
                {t("settings.holidays.empty.action")}
              </Button>
            )
          }
        />
      </div>
    );
  } else {
    listContent = (
      <ul
        ref={enterListRef}
        className="ap-panel ap-panel--flush ap-list"
        aria-labelledby="hol-list-h"
      >
        {items.map((hc) => {
          const busy = busyId === hc.id;
          const fetched = hc.lastFetchedAt ? formatFetched(hc.lastFetchedAt, timeZone, locale) : "";
          return (
            <li
              key={hc.id}
              className="ap-listrow ap-listrow--wrap"
              aria-busy={busy || undefined}
              style={{ alignItems: "flex-start" }}
            >
              <div className="ap-listrow-main" style={{ minWidth: 220 }}>
                <b>{hc.name}</b>
                <span>
                  <Tag tone={TYPE_TONE[hc.type] ?? "neutral"}>
                    {t(`settings.holidays.type.${hc.type}`)}
                  </Tag>
                </span>
                {hc.url ? (
                  <span translate="no" style={{ overflowWrap: "anywhere" }}>
                    {hc.url}
                  </span>
                ) : hc.source === "openholidays" ? (
                  <span translate="no">
                    {t("settings.holidays.sourceOpenHolidays", {
                      region: hc.sourceSubdivision ?? hc.sourceCountry ?? "",
                    })}
                  </span>
                ) : null}
                <span>
                  {busy
                    ? t("settings.holidays.refreshing")
                    : fetched
                      ? t("settings.holidays.meta", { count: hc.eventCount, date: fetched })
                      : t("settings.holidays.metaNever", { count: hc.eventCount })}
                </span>
                {rowErrors[hc.id] && (
                  <span role="alert" style={{ color: "var(--danger)", fontWeight: 600 }}>
                    {t("settings.holidays.refreshFailed")}
                  </span>
                )}
                {hc.eventCount > 0 && (
                  <HolidayPreview
                    calendarId={calendarId}
                    holidayCalendarId={hc.id}
                    holidayCalendarName={hc.name}
                    timeZone={timeZone}
                  />
                )}
              </div>
              {!readOnly && (
                <div className="ap-actions">
                  <Button
                    variant="secondary"
                    icon="refresh"
                    loading={busy}
                    loadingLabel={t("settings.holidays.refreshing")}
                    aria-label={t(
                      busy ? "settings.holidays.refreshingLabel" : "settings.holidays.refreshLabel",
                      { name: hc.name },
                    )}
                    onClick={() => void refresh(hc)}
                  >
                    {t("settings.holidays.refresh")}
                  </Button>
                  <Button
                    variant="ghost-danger"
                    icon="trash"
                    aria-label={t("settings.holidays.deleteLabel", { name: hc.name })}
                    onClick={() => setDeleting(hc)}
                  >
                    {t("common.delete")}
                  </Button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    );
  }

  return (
    <SettingsLayout>
      <p className="t-body t-muted t-prose">{t("settings.holidays.description")}</p>

      {!readOnly && (
        <section className="ap-panel" aria-labelledby="hol-add-h">
          <form className="ap-form" noValidate onSubmit={(e) => void submitAdd(e)}>
            <h2 className="t-h3" id="hol-add-h">
              {t("settings.holidays.addTitle")}
            </h2>
            <ErrorSummary
              title={t("settings.holidays.errorSummary")}
              errors={summary}
              focusSignal={signal}
            />
            {addError && (
              <Banner tone="danger">
                {addError === "fetch"
                  ? t("settings.holidays.fetchError")
                  : addError === "source"
                    ? t("settings.holidays.sourceFailed")
                    : t("settings.holidays.addFailed")}
              </Banner>
            )}
            <div
              role="radiogroup"
              aria-label={t("settings.holidays.modeLabel")}
              className="ap-actions"
            >
              {(["predefined", "ics"] as const).map((m) => (
                <label key={m} className="ap-check">
                  <input
                    type="radio"
                    name="hol-mode"
                    checked={mode === m}
                    onChange={() => {
                      setMode(m);
                      setAddError(null);
                    }}
                  />
                  <span>
                    {t(
                      m === "predefined"
                        ? "settings.holidays.modePredefined"
                        : "settings.holidays.modeIcs",
                    )}
                  </span>
                </label>
              ))}
            </div>
            {mode === "predefined" ? (
              <>
                {(countries.isError || subdivisions.isError) && (
                  <Banner tone="warning">{t("settings.holidays.sourceListError")}</Banner>
                )}
                <Field id="hol-country" label={t("settings.holidays.countryLabel")} required>
                  <NativeSelect
                    value={country}
                    onChange={(e) => {
                      setCountry(e.target.value);
                      setSubdivision("");
                    }}
                  >
                    {countryOptions.map((c) => (
                      <option key={c.isoCode} value={c.isoCode}>
                        {c.name}
                      </option>
                    ))}
                  </NativeSelect>
                </Field>
                <Field
                  id="hol-subdivision"
                  label={t("settings.holidays.subdivisionLabel")}
                  optional
                >
                  <NativeSelect
                    value={subdivision}
                    onChange={(e) => setSubdivision(e.target.value)}
                  >
                    <option value="">{t("settings.holidays.subdivisionNone")}</option>
                    {subdivisionOptions.map((o) => (
                      <option key={o.code} value={o.code}>
                        {o.label}
                      </option>
                    ))}
                  </NativeSelect>
                </Field>
                <fieldset
                  className="ap-stack"
                  aria-describedby={kindsError ? "hol-kinds-error" : undefined}
                >
                  <legend>{t("settings.holidays.kindsLabel")}</legend>
                  {(["public", "school"] as const).map((k) => (
                    <label key={k} className="ap-check">
                      <input
                        type="checkbox"
                        checked={kinds[k]}
                        onChange={(e) => {
                          setKinds((v) => ({ ...v, [k]: e.target.checked }));
                          setKindsError(false);
                        }}
                      />
                      <span>{t(`settings.holidays.type.${k}`)}</span>
                    </label>
                  ))}
                  {kindsError && (
                    <span id="hol-kinds-error" role="alert" style={{ color: "var(--danger)" }}>
                      {t("settings.holidays.kindsError")}
                    </span>
                  )}
                </fieldset>
              </>
            ) : (
              <>
                <Field
                  id="hol-name"
                  label={t("settings.holidays.nameLabel")}
                  required
                  error={problem.name ? problemText.name[problem.name] : undefined}
                >
                  <TextInput
                    value={name}
                    maxLength={255}
                    autoComplete="off"
                    placeholder={t("settings.holidays.namePlaceholder")}
                    onChange={(e) => {
                      setName(e.target.value);
                      setProblem((p) => ({ ...p, name: undefined }));
                    }}
                  />
                </Field>
                <Field
                  id="hol-url"
                  label={t("settings.holidays.urlLabel")}
                  required
                  hint={t("settings.holidays.urlHint")}
                  error={problem.url ? problemText.url[problem.url] : undefined}
                >
                  <TextInput
                    type="url"
                    inputMode="url"
                    spellCheck={false}
                    autoComplete="off"
                    value={url}
                    maxLength={2048}
                    placeholder={t("settings.holidays.urlPlaceholder")}
                    onChange={(e) => {
                      setUrl(e.target.value);
                      setProblem((p) => ({ ...p, url: undefined }));
                      setAddError(null);
                    }}
                  />
                </Field>
                <Field id="hol-type" label={t("settings.holidays.typeLabel")}>
                  <NativeSelect
                    value={icsType}
                    onChange={(e) => setIcsType(e.target.value as HolidayType)}
                  >
                    {(["public", "school", "other"] as const).map((k) => (
                      <option key={k} value={k}>
                        {t(`settings.holidays.type.${k}`)}
                      </option>
                    ))}
                  </NativeSelect>
                </Field>
              </>
            )}
            <div className="ap-actions">
              <Button
                type="submit"
                icon="plus"
                loading={adding}
                loadingLabel={t("settings.holidays.adding")}
              >
                {t(
                  mode === "predefined"
                    ? "settings.holidays.addPredefined"
                    : "settings.holidays.add",
                )}
              </Button>
            </div>
          </form>
        </section>
      )}

      <section className="ap-stack" aria-labelledby="hol-list-h">
        <h2 className="t-h3" id="hol-list-h">
          {t("settings.holidays.listTitle", { count: items.length })}
        </h2>
        {listContent}
      </section>

      {deleting && (
        <ConfirmDialog
          open
          onOpenChange={(open) => !open && setDeleting(null)}
          icon="trash"
          title={t("settings.holidays.delete.title", { name: deleting.name })}
          description={t("settings.holidays.delete.text")}
          consequence={
            deleting.eventCount > 0
              ? t("settings.holidays.delete.consequenceCount", { count: deleting.eventCount })
              : t("settings.holidays.delete.consequence")
          }
          confirmLabel={t("settings.holidays.delete.confirm")}
          onConfirm={() => remove(deleting)}
        />
      )}
      <UnsavedChangesDialog {...unsaved.dialog} />
    </SettingsLayout>
  );
}
