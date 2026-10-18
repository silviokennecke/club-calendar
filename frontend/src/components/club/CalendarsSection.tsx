import { useRef, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
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
  StatusBadge,
  TextInput,
  buttonClass,
  toast,
} from "@/components/ui/shared";
import { CalendarDeleteDialog } from "@/components/settings/CalendarDeleteDialog";
import { useCalendarActions } from "@/components/settings/useCalendarActions";
import { calendarBase } from "@/components/layout/navigation";
import { apiGet, apiPost } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { focusAfterDialog } from "@/lib/focus";
import { formatDate } from "@/lib/dateFormat";
import { isBlank } from "@/lib/club";
import { permissionsFor } from "@/lib/club/permissions";
import type { Calendar, Club } from "@/lib/types";

/**
 * "Kalender" panel (design: Club): create, open, duplicate, archive and delete calendars, plus the
 * list of archived ones (view, restore, delete). Destructive steps open a confirmation with the
 * consequences. The shared `useCalendarActions` hook does the work and gives the feedback.
 */
export function CalendarsSection({ club }: { club: Club }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState("");
  const [problem, setProblem] = useState(false);
  const [failed, setFailed] = useState(false);
  const [signal, setSignal] = useState(0);
  const [saving, setSaving] = useState(false);
  const toggleRef = useRef<HTMLButtonElement>(null);
  // Creating, archiving, duplicating and deleting calendars is admin-only.
  const { isAdmin } = permissionsFor(club.role);

  const calendars = useQuery<Calendar[]>({
    queryKey: ["calendars", club.id, "all"],
    queryFn: () => apiGet<Calendar[]>(`/api/clubs/${club.id}/calendars?includeArchived=true`),
  });
  const all = calendars.data ?? [];
  const active = all.filter((c) => !c.archivedAt);
  const archived = all.filter((c) => !!c.archivedAt);

  function closeForm() {
    setCreating(false);
    setDraft("");
    setProblem(false);
    setFailed(false);
    setTimeout(() => toggleRef.current?.focus(), 0);
  }

  async function create(e: FormEvent) {
    e.preventDefault();
    if (isBlank(draft)) {
      setProblem(true);
      setSignal((n) => n + 1);
      return;
    }
    setProblem(false);
    setFailed(false);
    setSaving(true);
    const name = draft.trim();
    try {
      await apiPost<Calendar>(`/api/clubs/${club.id}/calendars`, { name });
      await qc.invalidateQueries({ queryKey: ["calendars", club.id] });
      toast.success(t("club.calendars.created", { name }));
      closeForm();
    } catch {
      setFailed(true);
      setSignal((n) => n + 1);
    } finally {
      setSaving(false);
    }
  }

  const errors = problem
    ? [{ fieldId: "cl-newcal", message: t("club.calendars.nameError") }]
    : failed
      ? [{ fieldId: "cl-newcal", message: t("club.calendars.createFailed") }]
      : [];

  let content;
  if (calendars.isLoading) {
    content = (
      <div className="ap-stack" aria-busy="true">
        <p className="ap-sr" role="status">
          {t("club.calendars.loading")}
        </p>
        <Skeleton style={{ display: "block", height: 64 }} />
        <Skeleton style={{ display: "block", height: 64 }} />
      </div>
    );
  } else if (calendars.isError && !calendars.data) {
    content = (
      <Banner
        tone="danger"
        title={t("club.calendars.loadError")}
        action={
          <Button variant="secondary" icon="refresh" onClick={() => void calendars.refetch()}>
            {t("club.retry")}
          </Button>
        }
      />
    );
  } else {
    content = (
      <>
        {active.length === 0 ? (
          <EmptyState
            icon="calendar"
            title={t("club.calendars.emptyTitle")}
            text={t("club.calendars.empty")}
          />
        ) : (
          <div className="ap-panel ap-panel--flush" style={{ boxShadow: "none" }}>
            <ul className="ap-list" style={{ listStyle: "none", margin: 0, padding: 0 }}>
              {active.map((c) => (
                <CalendarRow key={c.id} club={club} calendar={c} isAdmin={isAdmin} />
              ))}
            </ul>
          </div>
        )}

        {archived.length > 0 && (
          <>
            <h3 className="t-h3" style={{ marginTop: "var(--space-8)" }} id="cl-arch-h">
              {t("club.calendars.archivedTitle")}
            </h3>
            <p className="t-sm" style={{ margin: "var(--space-1) 0 var(--space-3)" }}>
              {t("club.calendars.archivedText")}
            </p>
            <div className="ap-panel ap-panel--flush ap-panel--sunken">
              <ul
                className="ap-list"
                style={{ listStyle: "none", margin: 0, padding: 0 }}
                aria-labelledby="cl-arch-h"
              >
                {archived.map((c) => (
                  <CalendarRow key={c.id} club={club} calendar={c} isAdmin={isAdmin} archived />
                ))}
              </ul>
            </div>
          </>
        )}
      </>
    );
  }

  return (
    <section className="ap-panel" aria-labelledby="cl-cal-h">
      <div className="ap-panel-head">
        <div>
          <h2 className="t-h2 ap-focus-target" id="cl-cal-h" tabIndex={-1}>
            {t("club.calendars.title")}
          </h2>
          <p>{t("club.calendars.text")}</p>
        </div>
        {isAdmin && (
          <Button
            ref={toggleRef}
            variant="secondary"
            icon="plus"
            aria-expanded={creating}
            aria-controls="cl-newcal-form"
            onClick={() => (creating ? closeForm() : setCreating(true))}
          >
            {t("club.calendars.create")}
          </Button>
        )}
      </div>
      {isAdmin && creating && (
        <form
          id="cl-newcal-form"
          className="ap-panel ap-panel--sunken ap-stack"
          style={{ marginBottom: "var(--space-4)" }}
          aria-label={t("club.calendars.create")}
          noValidate
          onSubmit={(e) => void create(e)}
        >
          <ErrorSummary
            title={t("club.calendars.errorSummary")}
            errors={errors}
            focusSignal={signal}
          />
          <div className="ap-row" style={{ alignItems: "flex-end" }}>
            <div style={{ flex: 1, minWidth: 240 }}>
              <Field
                id="cl-newcal"
                label={t("club.calendars.nameLabel")}
                required
                error={problem ? t("club.calendars.nameError") : undefined}
              >
                <TextInput
                  autoFocus
                  value={draft}
                  maxLength={255}
                  autoComplete="off"
                  placeholder={t("club.calendars.namePlaceholder")}
                  onChange={(e) => {
                    setDraft(e.target.value);
                    setProblem(false);
                    setFailed(false);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") {
                      e.preventDefault();
                      closeForm();
                    }
                  }}
                />
              </Field>
            </div>
            <Button type="submit" loading={saving}>
              {t("club.calendars.createSubmit")}
            </Button>
            <Button variant="ghost" onClick={closeForm} disabled={saving}>
              {t("common.cancel")}
            </Button>
          </div>
        </form>
      )}
      {content}
    </section>
  );
}

function CalendarRow({
  club,
  calendar,
  isAdmin,
  archived = false,
}: {
  club: Club;
  calendar: Calendar;
  isAdmin: boolean;
  archived?: boolean;
}) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const actions = useCalendarActions(club.id, calendar.id, calendar.name, { stay: true });
  const [deleting, setDeleting] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const name = calendar.name;
  // The row moves or disappears: focus continues at the section heading.
  const then = (action: () => Promise<void>) => async () => {
    await action();
    focusAfterDialog("cl-cal-h");
  };
  const href = calendarBase(club.id, calendar.id);

  const meta = archived
    ? t("club.calendars.archivedOn", {
        date: formatDate(calendar.archivedAt ?? "", user?.dateFormat ?? "dd.MM.yyyy"),
      })
    : calendar.eventCount !== undefined
      ? t("club.calendars.events", { count: calendar.eventCount })
      : t("club.calendars.zone", { zone: calendar.timezone || club.timezone });

  return (
    <li className="ap-listrow ap-listrow--wrap">
      <div className="ap-listrow-main" style={{ minWidth: 200 }}>
        {archived ? (
          <div className="ap-row" style={{ gap: 8, flexWrap: "wrap" }}>
            <b style={{ display: "inline" }}>{name}</b>
            <StatusBadge status="archived" />
          </div>
        ) : (
          <b>{name}</b>
        )}
        <span>{meta}</span>
      </div>
      <div className="ap-actions">
        <Link
          className={buttonClass("secondary")}
          to={href}
          aria-label={t(archived ? "club.calendars.viewLabel" : "club.calendars.openLabel", {
            name,
          })}
        >
          {t(archived ? "club.calendars.view" : "club.calendars.open")}
        </Link>
        {!isAdmin ? null : archived ? (
          <Button
            variant="secondary"
            aria-label={t("club.calendars.restoreLabel", { name })}
            loading={actions.busy === "unarchive"}
            onClick={() => void then(actions.unarchive)()}
          >
            {t("club.calendars.restore")}
          </Button>
        ) : (
          <>
            <Button
              variant="secondary"
              aria-label={t("club.calendars.duplicateLabel", { name })}
              loading={actions.busy === "duplicate"}
              onClick={() => void actions.duplicate()}
            >
              {t("club.calendars.duplicate")}
            </Button>
            <Button
              variant="secondary"
              aria-label={t("club.calendars.archiveLabel", { name })}
              loading={actions.busy === "archive"}
              onClick={() => setArchiving(true)}
            >
              {t("club.calendars.archive")}
            </Button>
            <ConfirmDialog
              open={archiving}
              onOpenChange={setArchiving}
              tone="primary"
              icon="archive"
              title={t("settings.archive.confirmTitle", { name })}
              description={t("settings.archive.confirmText")}
              consequence={t("settings.archive.consequence")}
              confirmLabel={t("settings.archive.action")}
              onConfirm={then(actions.archive)}
            />
          </>
        )}
        {isAdmin && (
          <Button
            variant="ghost-danger"
            aria-label={t("club.calendars.deleteLabel", { name })}
            onClick={() => setDeleting(true)}
          >
            {t("club.calendars.delete")}
          </Button>
        )}
      </div>
      {deleting && (
        <CalendarDeleteDialog
          clubId={club.id}
          calendar={calendar}
          onClose={() => setDeleting(false)}
          onConfirm={then(actions.remove)}
        />
      )}
    </li>
  );
}
