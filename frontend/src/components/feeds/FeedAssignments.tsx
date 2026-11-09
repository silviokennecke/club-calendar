import { useEffect, useState } from "react";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  Banner,
  Button,
  ConfirmDialog,
  EmptyState,
  Field,
  FormDialog,
  NativeSelect,
  Pagination,
  SearchInput,
  Skeleton,
  Tag,
  TextArea,
  toast,
} from "@/components/ui/shared";
import { apiGetWithTotal, apiPost } from "@/lib/api";
import { MAX_BATCH, parseEmailList } from "@/lib/feeds/assignments";
import type { CalendarFeed, ClubMember, FeedMember } from "@/lib/types";

const PER_PAGE = 10;
const SEARCH_DEBOUNCE_MS = 300;

/** Debounced copy of a search text; `settled` is false while the user is still typing. */
function useDebounced(text: string) {
  const [value, setValue] = useState("");
  const trimmed = text.trim();
  useEffect(() => {
    if (trimmed === value) return;
    const timer = setTimeout(() => setValue(trimmed), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [trimmed, value]);
  return value;
}

function listPath(base: string, page: number, q: string, extra?: Record<string, string>) {
  const params = new URLSearchParams({ page: String(page), perPage: String(PER_PAGE), ...extra });
  if (q) params.set("q", q);
  return `${base}?${params}`;
}

/**
 * "Zugewiesene Mitglieder" of a PRIVATE feed: who may read it without knowing the secret. The list is
 * paginated and searched on the server; members are added from the (equally paginated) club member
 * search or by pasting e-mail addresses. Editors and admins.
 */
export function FeedAssignments({ clubId, feed }: { clubId: string; feed: CalendarFeed }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const base = `/api/clubs/${clubId}/feeds/${feed.id}/members`;
  const queryKey = ["feed-members", clubId, feed.id];
  const [text, setText] = useState("");
  const q = useDebounced(text);
  const [source, setSource] = useState<"" | "assigned" | "claimed">("");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Map<string, FeedMember>>(new Map());
  const [addOpen, setAddOpen] = useState(false);
  const [removing, setRemoving] = useState<FeedMember[] | null>(null);

  // A new search term or filter starts at page 1
  useEffect(() => setPage(1), [q, source]);

  const members = useQuery({
    queryKey: [...queryKey, { page, q, source }],
    queryFn: ({ signal }) =>
      apiGetWithTotal<FeedMember[]>(
        listPath(base, page, q, source ? { source } : undefined),
        signal,
      ),
    placeholderData: keepPreviousData,
  });
  const list = members.data?.data ?? [];
  const total = members.data?.total ?? list.length;
  const pageCount = Math.max(1, Math.ceil(total / PER_PAGE));
  const filtered = q !== "" || source !== "";

  useEffect(() => {
    if (members.data && !members.isPlaceholderData && page > pageCount) setPage(pageCount);
  }, [members.data, members.isPlaceholderData, page, pageCount]);

  function refresh() {
    setSelected(new Map());
    return Promise.all([
      qc.invalidateQueries({ queryKey }),
      qc.invalidateQueries({ queryKey: ["feeds", clubId] }),
    ]);
  }

  async function remove(items: FeedMember[]) {
    try {
      await apiPost(`${base}/bulk-delete`, { userIds: items.map((m) => m.userId) });
    } catch {
      toast.error(t("feeds.assign.removeFailed"));
      return;
    }
    await refresh();
    toast.success(
      items.length === 1
        ? t("feeds.assign.removed", { name: items[0].name })
        : t("feeds.assign.removedMany", { count: items.length }),
    );
  }

  function toggle(m: FeedMember) {
    setSelected((cur) => {
      const next = new Map(cur);
      if (!next.delete(m.userId)) next.set(m.userId, m);
      return next;
    });
  }

  const allOnPage = list.length > 0 && list.every((m) => selected.has(m.userId));
  function togglePage() {
    setSelected((cur) => {
      const next = new Map(cur);
      for (const m of list) {
        if (allOnPage) next.delete(m.userId);
        else next.set(m.userId, m);
      }
      return next;
    });
  }

  let body;
  if (members.isLoading) {
    body = (
      <div className="ap-stack" aria-busy="true">
        <p className="ap-sr" role="status">
          {t("feeds.assign.loading")}
        </p>
        <Skeleton style={{ display: "block", height: 48 }} />
        <Skeleton style={{ display: "block", height: 48 }} />
      </div>
    );
  } else if (members.isError && !members.data) {
    body = (
      <Banner
        tone="danger"
        title={t("feeds.assign.loadError")}
        action={
          <Button variant="secondary" icon="refresh" onClick={() => void members.refetch()}>
            {t("feeds.loadError.retry")}
          </Button>
        }
      />
    );
  } else if (list.length === 0) {
    body = filtered ? (
      <EmptyState
        icon="search"
        title={t("feeds.assign.noMatchTitle")}
        text={t("feeds.assign.noMatch")}
      />
    ) : (
      <EmptyState
        icon="users"
        title={t("feeds.assign.emptyTitle")}
        text={t("feeds.assign.empty")}
      />
    );
  } else {
    body = (
      <div
        className="ap-panel ap-panel--flush"
        style={{ boxShadow: "none", opacity: members.isPlaceholderData ? 0.6 : 1 }}
        aria-busy={members.isPlaceholderData}
      >
        <table className="ap-table">
          <caption className="ap-sr">{t("feeds.assign.caption", { count: total })}</caption>
          <thead>
            <tr>
              <th scope="col">
                <input
                  type="checkbox"
                  checked={allOnPage}
                  onChange={togglePage}
                  aria-label={t("feeds.assign.selectPage")}
                />
              </th>
              <th scope="col">{t("feeds.assign.colName")}</th>
              <th scope="col">{t("feeds.assign.colEmail")}</th>
              <th scope="col">{t("feeds.assign.colSource")}</th>
              <th scope="col" className="ap-col-actions">
                {t("feeds.assign.colAction")}
              </th>
            </tr>
          </thead>
          <tbody>
            {list.map((m) => (
              <tr key={m.userId}>
                <td>
                  <input
                    type="checkbox"
                    checked={selected.has(m.userId)}
                    onChange={() => toggle(m)}
                    aria-label={t("feeds.assign.select", { name: m.name })}
                  />
                </td>
                <td data-label={t("feeds.assign.colName")}>
                  <b>{m.name}</b>
                </td>
                <td data-label={t("feeds.assign.colEmail")}>{m.email}</td>
                <td data-label={t("feeds.assign.colSource")}>
                  <Tag tone={m.source === "assigned" ? "brand" : "neutral"}>
                    {t(`feeds.assign.source.${m.source}`)}
                  </Tag>
                </td>
                <td className="ap-col-actions" data-label={t("feeds.assign.colAction")}>
                  <Button
                    variant="secondary"
                    aria-label={t("feeds.assign.removeLabel", { name: m.name })}
                    onClick={() => setRemoving([m])}
                  >
                    {t("feeds.assign.remove")}
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <section className="ap-panel ap-form-section" aria-labelledby="fe-assign">
      <div className="ap-panel-head">
        <div>
          <h2 className="t-h2 ap-row" id="fe-assign" style={{ gap: 8 }}>
            {t("feeds.assign.title")}
            <span
              className="ap-badge ap-badge--archived"
              aria-label={t("feeds.assign.countLabel", { count: feed.assignedCount ?? total })}
            >
              {feed.assignedCount ?? total}
            </span>
          </h2>
          <p className="t-body t-prose">{t("feeds.assign.text")}</p>
        </div>
        <Button icon="plus" onClick={() => setAddOpen(true)}>
          {t("feeds.assign.add")}
        </Button>
      </div>
      <div className="ap-row" style={{ alignItems: "flex-end", flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 220 }}>
          <SearchInput
            value={text}
            onChange={setText}
            placeholder={t("feeds.assign.search")}
            label={t("feeds.assign.searchLabel")}
          />
        </div>
        <Field id="fe-assign-source" label={t("feeds.assign.sourceFilter")}>
          <NativeSelect value={source} onChange={(e) => setSource(e.target.value as typeof source)}>
            <option value="">{t("feeds.assign.sourceAll")}</option>
            <option value="assigned">{t("feeds.assign.source.assigned")}</option>
            <option value="claimed">{t("feeds.assign.source.claimed")}</option>
          </NativeSelect>
        </Field>
      </div>
      {selected.size > 0 && (
        <div className="ap-actions">
          <Button variant="danger" icon="trash" onClick={() => setRemoving([...selected.values()])}>
            {t("feeds.assign.removeSelected", { count: selected.size })}
          </Button>
        </div>
      )}
      {body}
      <Pagination
        page={page}
        pageCount={pageCount}
        total={total}
        disabled={members.isPlaceholderData}
        onPageChange={setPage}
      />

      {addOpen && (
        <AddAssignmentsDialog
          clubId={clubId}
          feed={feed}
          onClose={() => setAddOpen(false)}
          onAdded={() => void refresh()}
        />
      )}
      {removing && (
        <ConfirmDialog
          open
          onOpenChange={(open) => !open && setRemoving(null)}
          icon="user"
          title={
            removing.length === 1
              ? t("feeds.assign.removeTitle", { name: removing[0].name })
              : t("feeds.assign.removeManyTitle", { count: removing.length })
          }
          description={t("feeds.assign.removeText", { feed: feed.name })}
          consequence={t("feeds.assign.removeConsequence")}
          confirmLabel={t("feeds.assign.removeConfirm")}
          onConfirm={() => remove(removing)}
        />
      )}
    </section>
  );
}

type AddMode = "search" | "emails";

function AddAssignmentsDialog({
  clubId,
  feed,
  onClose,
  onAdded,
}: {
  clubId: string;
  feed: CalendarFeed;
  onClose: () => void;
  onAdded: () => void;
}) {
  const { t } = useTranslation();
  const base = `/api/clubs/${clubId}/feeds/${feed.id}/members`;
  const [mode, setMode] = useState<AddMode>("search");
  const [text, setText] = useState("");
  const q = useDebounced(text);
  const [page, setPage] = useState(1);
  const [picked, setPicked] = useState<Map<string, ClubMember>>(new Map());
  const [emailText, setEmailText] = useState("");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [result, setResult] = useState<{ added: number; unknown: string[] } | null>(null);

  useEffect(() => setPage(1), [q]);

  const found = useQuery({
    queryKey: ["feed-member-candidates", clubId, { page, q }],
    queryFn: ({ signal }) =>
      apiGetWithTotal<ClubMember[]>(listPath(`/api/clubs/${clubId}/members`, page, q), signal),
    placeholderData: keepPreviousData,
    enabled: mode === "search",
  });
  const list = found.data?.data ?? [];
  const total = found.data?.total ?? list.length;
  const pageCount = Math.max(1, Math.ceil(total / PER_PAGE));
  const parsed = parseEmailList(emailText);

  function toggle(m: ClubMember) {
    setPicked((cur) => {
      const next = new Map(cur);
      if (!next.delete(m.id)) next.set(m.id, m);
      return next;
    });
  }

  async function submit() {
    if (busy || result) return;
    setFailed(false);
    if (mode === "search") {
      if (picked.size === 0) return;
      setBusy(true);
      try {
        const res = await apiPost<{ added: number }>(base, { userIds: [...picked.keys()] });
        toast.success(t("feeds.assign.added", { count: res.added }));
        onAdded();
        onClose();
      } catch {
        setFailed(true);
      } finally {
        setBusy(false);
      }
      return;
    }
    if (parsed.emails.length === 0 || parsed.tooMany) return;
    setBusy(true);
    try {
      const res = await apiPost<{ added: number; unknown: string[] }>(`${base}/by-email`, {
        emails: parsed.emails,
      });
      setResult(res);
      onAdded();
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  const canSubmit =
    mode === "search" ? picked.size > 0 : parsed.emails.length > 0 && !parsed.tooMany;

  return (
    <FormDialog
      open
      wide
      onOpenChange={(open) => !open && onClose()}
      title={t("feeds.assign.addTitle")}
      description={t("feeds.assign.addDescription", { name: feed.name })}
      onSubmit={() => void submit()}
      actions={
        result ? (
          <Button onClick={onClose}>{t("feeds.assign.done")}</Button>
        ) : (
          <>
            <Button variant="secondary" onClick={onClose}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" loading={busy} disabled={!canSubmit}>
              {mode === "search"
                ? t("feeds.assign.addSelected", { count: picked.size })
                : t("feeds.assign.addEmails", { count: parsed.emails.length })}
            </Button>
          </>
        )
      }
    >
      {!result && (
        <div className="ap-seg" role="group" aria-label={t("feeds.assign.modeLabel")}>
          {(["search", "emails"] as const).map((m) => (
            <button key={m} type="button" aria-pressed={mode === m} onClick={() => setMode(m)}>
              {t(`feeds.assign.mode.${m}`)}
            </button>
          ))}
        </div>
      )}
      {failed && <Banner tone="danger">{t("feeds.assign.addFailed")}</Banner>}
      {result ? (
        <div className="ap-stack" role="status">
          <Banner tone="info">{t("feeds.assign.result", { count: result.added })}</Banner>
          {result.unknown.length > 0 && (
            <div className="ap-stack ap-stack--sm">
              <p className="t-body">
                {t("feeds.assign.unknown", { count: result.unknown.length })}
              </p>
              <ul className="t-sm">
                {result.unknown.map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      ) : mode === "search" ? (
        <div className="ap-stack">
          <SearchInput
            value={text}
            onChange={setText}
            placeholder={t("feeds.assign.candidateSearch")}
          />
          {found.isError && !found.data ? (
            <Banner tone="danger">{t("feeds.assign.candidatesError")}</Banner>
          ) : list.length === 0 && !found.isLoading ? (
            <p className="t-sm">{t("feeds.assign.candidatesNone")}</p>
          ) : (
            <ul
              className="ap-stack ap-stack--sm"
              style={{ opacity: found.isPlaceholderData ? 0.6 : 1 }}
              aria-label={t("feeds.assign.candidatesLabel")}
            >
              {list.map((m) => (
                <li key={m.id}>
                  <label className="ap-optionrow">
                    <input type="checkbox" checked={picked.has(m.id)} onChange={() => toggle(m)} />
                    <span>
                      <b>{m.name}</b> <span className="t-sm">{m.email}</span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          )}
          <Pagination
            page={page}
            pageCount={pageCount}
            total={total}
            disabled={found.isPlaceholderData}
            onPageChange={setPage}
          />
          {picked.size > 0 && (
            <p className="t-sm" role="status">
              {t("feeds.assign.pickedCount", { count: picked.size })}
            </p>
          )}
        </div>
      ) : (
        <Field
          id="fe-assign-emails"
          label={t("feeds.assign.emailsLabel")}
          hint={t("feeds.assign.emailsHint", { max: MAX_BATCH })}
          error={parsed.tooMany ? t("feeds.assign.emailsTooMany", { max: MAX_BATCH }) : undefined}
        >
          <TextArea
            rows={7}
            value={emailText}
            onChange={(e) => setEmailText(e.target.value)}
            placeholder={t("feeds.assign.emailsPlaceholder")}
          />
        </Field>
      )}
      {!result && mode === "emails" && emailText.trim() !== "" && (
        <p className="t-sm" role="status">
          {t("feeds.assign.emailsParsed", { count: parsed.emails.length })}
          {parsed.invalid.length > 0 &&
            ` ${t("feeds.assign.emailsInvalid", { count: parsed.invalid.length })}`}
        </p>
      )}
    </FormDialog>
  );
}
