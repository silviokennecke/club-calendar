import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
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
  Toggle,
  UnsavedChangesDialog,
  CopyField,
  toast,
  type Glyph,
} from "@/components/ui/shared";
import { ArchivedCreateGuard } from "@/components/events/ArchivedCreateGuard";
import { useEventPage } from "@/components/events/useEventPage";
import { FeedAccess } from "@/components/feeds/FeedAccess";
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

/** From open to protected; CLUB ("Nur per Link") is the default for new feeds. */
const VISIBILITIES: { value: FeedVisibility; key: "public" | "club" | "private"; icon: Glyph }[] = [
  { value: "PUBLIC", key: "public", icon: "globe" },
  { value: "CLUB", key: "club", icon: "users" },
  { value: "PRIVATE", key: "private", icon: "lock" },
];

/**
 * New feed (…/settings/feeds/new) and edit (…/settings/feeds/:feedId), design: FeedEdit. Name,
 * status (public / club internal / private; the search engine option only for public), audience
 * filter, the secret (private feeds, regenerating asks first) and the addresses. Saving a private
 * feed as public or club internal asks first (the secret is no longer required).
 */
export default function FeedEditPage() {
  const { feedId } = useParams<{ feedId: string }>();
  // Archived calendars are read-only: a feed can be viewed there, but not created.
  return feedId ? (
    <FeedLoader />
  ) : (
    <ArchivedCreateGuard>
      <FeedLoader />
    </ArchivedCreateGuard>
  );
}

function FeedLoader() {
  const { feedId } = useParams<{ feedId: string }>();
  const page = useEventPage();
  const { t } = useTranslation();
  const one = useFeed(page.calendarId, feedId);
  const isNew = !feedId;
  const feed = one.data;
  const notFound = (one.error as { status?: number } | null)?.status === 404;

  if (page.calendarLoading || (!isNew && one.isPending && !one.isError)) {
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
  const page = useEventPage();
  const data = useFeeds(page.calendarId, { withList: false });
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { t } = useTranslation();
  const isNew = !feed;
  const readOnly = page.isArchived;

  const [initial] = useState<FeedFormValues>(() =>
    feed ? feedValuesFromRecord(feed) : emptyFeedValues(),
  );
  const [values, setValues] = useState<FeedFormValues>(initial);
  const [submits, setSubmits] = useState(0);
  const [touched, setTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const [regenOpen, setRegenOpen] = useState(false);
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

  function set<K extends keyof FeedFormValues>(key: K, value: FeedFormValues[K]) {
    setValues((v) => ({ ...v, [key]: value }));
    setSaveFailed(false);
  }

  /** The search engine option is an explicit opt-in: leaving PUBLIC switches it off. */
  function setVisibility(visibility: FeedVisibility) {
    setValues((v) => ({
      ...v,
      visibility,
      searchable: visibility === "PUBLIC" ? v.searchable : false,
    }));
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
        page.calendarId,
        ["targetGroups"],
        body,
        (b) =>
          feed
            ? apiPatch<CalendarFeed>(`/api/calendars/${page.calendarId}/feeds/${feed.id}`, b)
            : apiPost<CalendarFeed>(`/api/calendars/${page.calendarId}/feeds`, b),
        (b, existing) => ({
          ...b,
          targetGroupIds: keepExisting(b.targetGroupIds, existing.targetGroups),
        }),
      );
      const savedId = feed?.id ?? saved.id;
      await qc.invalidateQueries({ queryKey: ["feeds", page.calendarId] });
      toast.success(t(isNew ? "feeds.form.created" : "feeds.form.saved", { name: body.name }));
      navigate(page.routes.feeds, { state: { open: savedId } });
    } catch {
      setSaveFailed(true);
      setSubmits((n) => n + 1);
    } finally {
      setSaving(false);
    }
  }

  async function regenerate() {
    if (!feed) return;
    try {
      await apiPost(`/api/calendars/${page.calendarId}/feeds/${feed.id}/regenerate-secret`, {});
      await qc.invalidateQueries({ queryKey: ["feeds", page.calendarId] });
      toast.success(t("feeds.regen.done"));
    } catch {
      toast.error(t("feeds.regen.failed"));
    }
  }

  async function remove() {
    if (!feed) return;
    try {
      await apiDelete(`/api/calendars/${page.calendarId}/feeds/${feed.id}`);
      await qc.invalidateQueries({ queryKey: ["feeds", page.calendarId] });
      toast.success(t("feeds.delete.done", { name: feed.name }));
      navigate(page.routes.feeds);
    } catch {
      toast.error(t("feeds.delete.failed"));
    }
  }

  const summary = [
    ...(nameError ? [{ fieldId: "fe-name", message: nameError }] : []),
    ...(saveFailed ? [{ fieldId: "fe-name", message: t("feeds.form.saveFailed") }] : []),
  ];
  const heading1 = readOnly
    ? t("feeds.form.viewTitle", { name: feed?.name })
    : t(isNew ? "feeds.form.newTitle" : "feeds.form.editTitle");
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
          <p className="t-body">{page.calendar?.name}</p>
        </div>
      </header>
      <form className="ap-form" noValidate onSubmit={onSubmit}>
        {readOnly ? (
          <Banner tone="warning" icon="lock" title={t("shell.archivedReadOnly")}>
            {t("feeds.form.readOnly")}
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
              {values.visibility === "PUBLIC" && (
                <Toggle
                  id="fe-searchable"
                  label={t("feeds.form.searchable.label")}
                  hint={t("feeds.form.searchable.hint")}
                  checked={values.searchable}
                  onChange={(on) => set("searchable", on)}
                  disabled={readOnly}
                />
              )}
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
            onOpenChange={setRegenOpen}
            icon="refresh"
            title={t("feeds.regen.title")}
            description={t("feeds.regen.text", { name: feed.name })}
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
