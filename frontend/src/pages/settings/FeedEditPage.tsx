import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  Banner,
  Button,
  Chip,
  ConfirmDialog,
  EmptyState,
  ErrorSummary,
  Field,
  Icon,
  LinkButton,
  Skeleton,
  TextInput,
  UnsavedChangesDialog,
  CopyField,
  toast,
  type Glyph,
} from "@/components/ui/shared";
import { FeedsForbidden } from "@/components/feeds/FeedsForbidden";
import { useClubSettingsPage } from "@/components/settings/useClubSettingsPage";
import { FeedAccess } from "@/components/feeds/FeedAccess";
import { FeedAssignments } from "@/components/feeds/FeedAssignments";
import { useFeed, useFeeds } from "@/components/feeds/useFeeds";
import { apiDelete, apiPatch, apiPost } from "@/lib/api";
import { keepExisting, saveDroppingDeletedReferences } from "@/lib/staleReferences";
import {
  dropsSecret,
  emptyFeedValues,
  feedValuesFromRecord,
  isFeedDirty,
  toFeedPayload,
  toggleId,
  validateFeed,
  type FeedFormValues,
  type FeedVisibility,
} from "@/lib/feeds";
import type { CalendarFeed } from "@/lib/types";
import { useUnsavedChanges } from "@/lib/useUnsavedChanges";
import { usePageTitle } from "@/lib/usePageTitle";

/** From open to protected; CLUB ("Nur per Link") is the default for new feeds. */
const VISIBILITIES: { value: FeedVisibility; key: "public" | "club" | "private"; icon: Glyph }[] = [
  { value: "PUBLIC", key: "public", icon: "globe" },
  { value: "CLUB", key: "club", icon: "users" },
  { value: "PRIVATE", key: "private", icon: "lock" },
];

/**
 * New feed (/clubs/:clubId/settings/feeds/new) and edit (…/feeds/:feedId), design: FeedEdit. Name,
 * status (public / club internal / private; the search engine option only for public), audience
 * filter, the secret (private feeds, regenerating asks first) and the addresses. Saving a private
 * feed as public or club internal asks first (the secret is no longer required).
 *
 * The page lives in the club settings and has no calendar in the URL. The calendar field selects the
 * calendars the feed publishes (at least one; archived ones are selectable but add no events while
 * archived). A new feed starts with ALL active (non-archived) calendars selected.
 */
export default function FeedEditPage() {
  const { feedId } = useParams<{ feedId: string }>();
  // Only admins create feeds; others can view existing ones (editors) or see nothing (viewers).
  return feedId ? (
    <FeedLoader />
  ) : (
    <NewFeedGuard>
      <FeedLoader />
    </NewFeedGuard>
  );
}

function NewFeedGuard({ children }: { children: ReactNode }) {
  const page = useClubSettingsPage();
  const { t } = useTranslation();
  if (page.roleLoading) {
    return (
      <div className="ap-pagedialog" aria-busy="true">
        <Skeleton style={{ display: "block", height: 40, width: "50%" }} />
      </div>
    );
  }
  if (page.isAdmin) return <>{children}</>;
  return (
    <div className="ap-pagedialog">
      <EmptyState
        icon="lock"
        headingLevel="h1"
        title={t("events.new.forbidden.title")}
        text={t("shell.roleReadOnly")}
        actions={
          <LinkButton variant="secondary" icon="arrow-left" to={page.routes.feeds}>
            {t("feeds.form.back")}
          </LinkButton>
        }
      />
    </div>
  );
}

function FeedLoader() {
  const { feedId } = useParams<{ feedId: string }>();
  const page = useClubSettingsPage();
  const { t } = useTranslation();
  const one = useFeed(page.clubId, page.canEdit ? feedId : undefined);
  const isNew = !feedId;
  const feed = one.data;
  const notFound = (one.error as { status?: number } | null)?.status === 404;

  if (!page.roleLoading && !page.canEdit) return <FeedsForbidden backHref={page.routes.club} />;
  if (page.calendarsLoading || page.roleLoading || (!isNew && one.isPending && !one.isError)) {
    return (
      <div className="ap-wrap--narrow" aria-busy="true">
        <p className="ap-sr" role="status">
          {t("feeds.form.loading")}
        </p>
        <div className="ap-stack ap-stack--lg">
          <Skeleton style={{ display: "block", height: 40, width: "50%" }} />
          <Skeleton style={{ display: "block", height: 320 }} />
        </div>
      </div>
    );
  }
  if (!isNew && one.isError && !feed && !notFound) {
    return (
      <div className="ap-wrap--narrow">
        <Banner
          tone="danger"
          title={t("feeds.loadError.title")}
          action={
            <Button variant="secondary" icon="refresh" onClick={() => void one.refetch()}>
              {t("feeds.loadError.retry")}
            </Button>
          }
        >
          {t("feeds.loadError.text")}
        </Banner>
      </div>
    );
  }
  if (!isNew && !feed) {
    return (
      <div className="ap-wrap--narrow">
        <EmptyState
          icon="search"
          headingLevel="h1"
          title={t("feeds.form.notFound.title")}
          text={t("feeds.form.notFound.text")}
          actions={
            <LinkButton variant="secondary" icon="arrow-left" to={page.routes.feeds}>
              {t("feeds.form.back")}
            </LinkButton>
          }
        />
      </div>
    );
  }
  return <FeedEditor key={feedId ?? "new"} feed={feed} />;
}

function FeedEditor({ feed }: { feed?: CalendarFeed }) {
  const page = useClubSettingsPage();
  const data = useFeeds(page.clubId, { withList: false });
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { t } = useTranslation();
  const isNew = !feed;
  const readOnly = !page.isAdmin;

  const [initial] = useState<FeedFormValues>(() =>
    feed ? feedValuesFromRecord(feed) : emptyFeedValues(page.activeCalendars.map((c) => c.id)),
  );
  const [values, setValues] = useState<FeedFormValues>(initial);
  const [submits, setSubmits] = useState(0);
  const [touched, setTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  // Server rejection (422 unknown_reference / validation_failed) of `calendarIds`.
  const [calendarsRejected, setCalendarsRejected] = useState(false);
  const [regenOpen, setRegenOpen] = useState(false);
  const [revokeClaimed, setRevokeClaimed] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [unprotectOpen, setUnprotectOpen] = useState(false);

  const dirty = !readOnly && isFeedDirty(initial, values);
  const unsaved = useUnsavedChanges(dirty);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
  }, []);

  const problems = useMemo(() => validateFeed(values), [values]);
  const nameError =
    problems.includes("nameEmpty") && (submits > 0 || touched)
      ? t("feeds.form.nameError")
      : undefined;

  const calendarsError =
    problems.includes("noCalendar") && submits > 0
      ? t("feeds.form.calendarsError")
      : calendarsRejected
        ? t("feeds.form.calendarsRejected")
        : undefined;
  const hasArchived = page.calendars.some((c) => c.archivedAt);

  function set<K extends keyof FeedFormValues>(key: K, value: FeedFormValues[K]) {
    setValues((v) => ({ ...v, [key]: value }));
    setSaveFailed(false);
    if (key === "calendarIds") setCalendarsRejected(false);
  }

  function setVisibility(visibility: FeedVisibility) {
    setValues((v) => ({ ...v, visibility }));
    setSaveFailed(false);
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (readOnly) return;
    setSubmits((n) => n + 1);
    if (problems.length > 0) return;
    if (dropsSecret(feed, values)) {
      setUnprotectOpen(true);
      return;
    }
    void save();
  }

  async function save() {
    setSaving(true);
    setSaveFailed(false);
    try {
      const body = toFeedPayload(values);
      const saved = await saveDroppingDeletedReferences(
        qc,
        { clubId: page.clubId, calendarId: page.calendarId ?? "" },
        ["targetGroups"],
        body,
        (b) =>
          feed
            ? apiPatch<CalendarFeed>(
                `/api/clubs/${page.clubId}/feeds/${feed.id}?includeSecret=1`,
                b,
              )
            : apiPost<CalendarFeed>(`/api/clubs/${page.clubId}/feeds?includeSecret=1`, b),
        (b, existing) => ({
          ...b,
          targetGroupIds: keepExisting(b.targetGroupIds, existing.targetGroups),
        }),
      );
      const savedId = feed?.id ?? saved.id;
      await qc.invalidateQueries({ queryKey: ["feeds", page.clubId] });
      toast.success(t(isNew ? "feeds.form.created" : "feeds.form.saved", { name: body.name }));
      navigate(page.routes.feeds, { state: { open: savedId } });
    } catch (e) {
      const err = e as { status?: number; code?: string; field?: string } | null;
      if (
        err?.status === 422 &&
        err.field === "calendarIds" &&
        (err.code === "unknown_reference" || err.code === "validation_failed")
      ) {
        setCalendarsRejected(true);
      } else {
        setSaveFailed(true);
      }
      setSubmits((n) => n + 1);
    } finally {
      setSaving(false);
    }
  }

  async function regenerate() {
    if (!feed) return;
    try {
      await apiPost(
        `/api/clubs/${page.clubId}/feeds/${feed.id}/regenerate-secret?includeSecret=1`,
        revokeClaimed ? { revokeClaimed: true } : {},
      );
      await qc.invalidateQueries({ queryKey: ["feeds", page.clubId] });
      toast.success(t("feeds.regen.done"));
    } catch {
      toast.error(t("feeds.regen.failed"));
    }
  }

  async function remove() {
    if (!feed) return;
    try {
      await apiDelete(`/api/clubs/${page.clubId}/feeds/${feed.id}`);
      await qc.invalidateQueries({ queryKey: ["feeds", page.clubId] });
      toast.success(t("feeds.delete.done", { name: feed.name }));
      navigate(page.routes.feeds);
    } catch {
      toast.error(t("feeds.delete.failed"));
    }
  }

  const summary = [
    ...(nameError ? [{ fieldId: "fe-name", message: nameError }] : []),
    ...(calendarsError ? [{ fieldId: "fe-calendars-chips", message: calendarsError }] : []),
    ...(saveFailed ? [{ fieldId: "fe-name", message: t("feeds.form.saveFailed") }] : []),
  ];
  const heading1 = readOnly
    ? t("feeds.form.viewTitle", { name: feed?.name })
    : t(isNew ? "feeds.form.newTitle" : "feeds.form.editTitle");
  usePageTitle(heading1);
  // The addresses and the secret describe the saved feed, not the unsaved form.
  const saved = feed;

  return (
    <div className="ap-wrap--narrow">
      <Link className="ap-back" to={page.routes.feeds}>
        <Icon glyph="arrow-left" size={18} />
        {t("feeds.form.back")}
      </Link>
      <header className="ap-pagehead">
        <div>
          <h1 className="t-h1 ap-focus-target" ref={heading} tabIndex={-1}>
            {heading1}
          </h1>
          <p className="t-body">{page.club?.name}</p>
        </div>
      </header>
      <form className="ap-form" noValidate onSubmit={onSubmit}>
        {readOnly ? (
          <Banner tone="info" icon="lock">
            {t("feeds.readOnlyRole")}
          </Banner>
        ) : (
          <Banner tone="info">{t("feeds.form.intro")}</Banner>
        )}
        <ErrorSummary title={t("feeds.form.errorTitle")} errors={summary} focusSignal={submits} />

        <section className="ap-panel ap-form-section" aria-labelledby="fe-basis">
          <h2 className="t-h2" id="fe-basis">
            {t("feeds.form.basics")}
          </h2>
          <fieldset disabled={readOnly} className="ap-stack m-0 min-w-0 border-0 p-0">
            <Field
              id="fe-name"
              label={t("feeds.form.name")}
              required
              hint={t("feeds.form.nameHint")}
              error={nameError}
            >
              <TextInput
                value={values.name}
                maxLength={255}
                autoComplete="off"
                placeholder={t("feeds.form.namePlaceholder")}
                onChange={(e) => set("name", e.target.value)}
                onBlur={() => setTouched(true)}
              />
            </Field>

            <Field
              id="fe-calendars"
              group
              label={t("feeds.form.calendars")}
              required
              hint={
                hasArchived
                  ? `${t("feeds.form.calendarsHint")} ${t("feeds.form.calendarsArchivedHint")}`
                  : t("feeds.form.calendarsHint")
              }
              error={calendarsError}
            >
              <div className="ap-chips" id="fe-calendars-chips" tabIndex={-1}>
                {page.calendars.map((c) => (
                  <Chip
                    key={c.id}
                    pressed={values.calendarIds.includes(c.id)}
                    onClick={() => set("calendarIds", toggleId(values.calendarIds, c.id))}
                  >
                    {c.archivedAt ? t("feeds.form.calendarArchived", { name: c.name }) : c.name}
                  </Chip>
                ))}
              </div>
            </Field>

            <fieldset className="ap-fieldset">
              <legend>{t("feeds.form.visibility")}</legend>
              <div className="ap-stack ap-stack--sm">
                {VISIBILITIES.map((v) => (
                  <label
                    key={v.value}
                    className="ap-optionrow"
                    style={{ alignItems: "flex-start" }}
                  >
                    <input
                      type="radio"
                      name="fe-vis"
                      value={v.value}
                      checked={values.visibility === v.value}
                      onChange={() => setVisibility(v.value)}
                    />
                    <span className="ap-stack ap-stack--sm">
                      <span className="ap-row" style={{ gap: 8 }}>
                        <Icon glyph={v.icon} size={20} />
                        <b className="t-h3">{t(`feeds.form.vis.${v.key}.label`)}</b>
                      </span>
                      <span className="t-sm">{t(`feeds.form.vis.${v.key}.text`)}</span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>

            <fieldset className="ap-fieldset">
              <legend>{t("feeds.form.audiences")}</legend>
              {data.groups.isError && !data.groups.data ? (
                <Banner tone="danger">{t("feeds.form.audiencesError")}</Banner>
              ) : data.groupList.length === 0 ? (
                <p className="t-sm">{t("feeds.form.audiencesNone")}</p>
              ) : (
                <div className="ap-chips">
                  {data.groupList.map((g) => (
                    <Chip
                      key={g.id}
                      pressed={values.targetGroupIds.includes(g.id)}
                      onClick={() => set("targetGroupIds", toggleId(values.targetGroupIds, g.id))}
                    >
                      {g.name}
                    </Chip>
                  ))}
                </div>
              )}
              <span className="cc-hint">{t("feeds.form.audiencesHint")}</span>
            </fieldset>
          </fieldset>
        </section>

        {saved && saved.visibility === "PRIVATE" && (
          <section className="ap-panel ap-form-section" aria-labelledby="fe-secret">
            <h2 className="t-h2" id="fe-secret">
              {t("feeds.secret.title")}
            </h2>
            <p className="t-body t-prose">{t("feeds.secret.text")}</p>
            <CopyField
              id="fe-key"
              label={t("feeds.access.secret")}
              value={saved.sharedSecret}
              secret
              hint={t("feeds.secret.hint")}
            />
            {!readOnly && (
              <div className="ap-actions">
                <Button variant="secondary" icon="refresh" onClick={() => setRegenOpen(true)}>
                  {t("feeds.regen.action")}
                </Button>
              </div>
            )}
          </section>
        )}

        {saved && saved.visibility === "PRIVATE" && (
          <FeedAssignments clubId={page.clubId} feed={saved} />
        )}

        <section className="ap-panel ap-form-section" aria-labelledby="fe-access">
          <h2 className="t-h2" id="fe-access">
            {t("feeds.form.access")}
          </h2>
          {saved ? (
            <FeedAccess feed={saved} addresses={data.addresses(saved)} />
          ) : (
            <p className="t-body t-prose">{t("feeds.form.accessNew")}</p>
          )}
        </section>

        <div className="ap-actions" style={{ justifyContent: "space-between" }}>
          <div className="ap-actions">
            {!readOnly && (
              <Button type="submit" loading={saving} loadingLabel={t("feeds.form.saving")}>
                {t("feeds.form.save")}
              </Button>
            )}
            <LinkButton variant="secondary" to={page.routes.feeds}>
              {readOnly ? t("feeds.form.back") : t("common.cancel")}
            </LinkButton>
          </div>
          {feed && !readOnly && (
            <Button variant="ghost-danger" icon="trash" onClick={() => setDeleteOpen(true)}>
              {t("feeds.form.delete")}
            </Button>
          )}
        </div>
      </form>

      {feed && (
        <>
          <ConfirmDialog
            open={regenOpen}
            onOpenChange={(open) => {
              setRegenOpen(open);
              if (!open) setRevokeClaimed(false);
            }}
            icon="refresh"
            title={t("feeds.regen.title")}
            description={
              <>
                {t("feeds.regen.text", { name: feed.name })}
                {feed.visibility === "PRIVATE" && (
                  <label className="ap-optionrow" style={{ marginTop: 12 }}>
                    <input
                      type="checkbox"
                      checked={revokeClaimed}
                      onChange={(e) => setRevokeClaimed(e.target.checked)}
                    />
                    <span className="ap-stack ap-stack--sm">
                      <span>{t("feeds.regen.revokeClaimed")}</span>
                      <span className="t-sm">
                        {t("feeds.regen.revokeHint", { count: feed.assignedCount ?? 0 })}
                      </span>
                    </span>
                  </label>
                )}
              </>
            }
            consequence={t("feeds.regen.consequence")}
            confirmLabel={t("feeds.regen.confirm")}
            onConfirm={regenerate}
          />
          <ConfirmDialog
            open={unprotectOpen}
            onOpenChange={setUnprotectOpen}
            icon="lock"
            title={t("feeds.unprotect.title")}
            description={t(
              values.visibility === "PUBLIC"
                ? "feeds.unprotect.textPublic"
                : "feeds.unprotect.textClub",
              { name: values.name.trim() || feed.name },
            )}
            consequence={t("feeds.unprotect.consequence")}
            confirmLabel={t("feeds.unprotect.confirm")}
            onConfirm={save}
          />
          <ConfirmDialog
            open={deleteOpen}
            onOpenChange={setDeleteOpen}
            icon="trash"
            title={t("feeds.delete.title", { name: feed.name })}
            description={t("feeds.delete.text")}
            consequence={t("feeds.delete.consequence")}
            confirmLabel={t("feeds.delete.confirm")}
            onConfirm={remove}
          />
        </>
      )}
      <UnsavedChangesDialog {...unsaved.dialog} />
    </div>
  );
}
