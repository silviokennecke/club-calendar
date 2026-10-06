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
  Skeleton,
  TextInput,
  toast,
} from "@/components/ui/shared";
import { SettingsLayout } from "@/components/settings/SettingsLayout";
import { HolidayPreview } from "@/components/settings/HolidayPreview";
import { useSettingsPage } from "@/components/settings/useSettingsPage";
import { useLocale } from "@/components/calendar/useLocale";
import {
  createHolidayCalendar,
  deleteHolidayCalendar,
  getHolidayCalendars,
  refreshHolidayCalendar,
} from "@/lib/api";
import { formatFetched, validateHolidayForm, type HolidayFormProblem } from "@/lib/settings";
import type { HolidayCalendar } from "@/lib/types";

/**
 * Settings "Feiertage" (design: SettingsHolidays): holiday calendars from an ICS address — add,
 * refresh, delete, with status (count, last fetch), per-calendar holiday list and errors.
 */
export default function HolidayCalendarsPage() {
  const { t } = useTranslation();
  const locale = useLocale();
  const qc = useQueryClient();
  const page = useSettingsPage();
  const { calendarId, readOnly, timeZone } = page;
  const queryKey = ["holidayCalendars", calendarId];

  const list = useQuery<HolidayCalendar[]>({
    queryKey,
    queryFn: () => getHolidayCalendars(calendarId),
  });
  const items = list.data ?? [];

  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [problem, setProblem] = useState<HolidayFormProblem>({});
  const [signal, setSignal] = useState(0);
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<"fetch" | "other" | null>(null);
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

  async function submitAdd(e: FormEvent) {
    e.preventDefault();
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
      });
      await qc.invalidateQueries({ queryKey });
      void qc.invalidateQueries({ queryKey: ["holidayEvents", calendarId] });
      setName("");
      setUrl("");
      toast.success(t("settings.holidays.added", { count: created.eventCount }));
    } catch (error) {
      setAddError((error as { status?: number }).status === 422 ? "fetch" : "other");
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
              <Button icon="plus" onClick={() => document.getElementById("hol-name")?.focus()}>
                {t("settings.holidays.empty.action")}
              </Button>
            )
          }
        />
      </div>
    );
  } else {
    listContent = (
      <ul className="ap-panel ap-panel--flush ap-list" aria-labelledby="hol-list-h">
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
                <span style={{ overflowWrap: "anywhere" }}>{hc.url}</span>
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
                  : t("settings.holidays.addFailed")}
              </Banner>
            )}
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
                autoComplete="off"
                value={url}
                maxLength={2048}
                placeholder="https://"
                onChange={(e) => {
                  setUrl(e.target.value);
                  setProblem((p) => ({ ...p, url: undefined }));
                  setAddError(null);
                }}
              />
            </Field>
            <div className="ap-actions">
              <Button
                type="submit"
                icon="plus"
                loading={adding}
                loadingLabel={t("settings.holidays.adding")}
              >
                {t("settings.holidays.add")}
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
    </SettingsLayout>
  );
}
