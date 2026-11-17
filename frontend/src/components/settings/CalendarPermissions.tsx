import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  AutocompleteInput,
  Banner,
  Button,
  ConfirmDialog,
  EmptyState,
  Field,
  Skeleton,
  Tag,
  toast,
} from "@/components/ui/shared";
import { apiDelete, apiGet, apiGetWithTotal, apiPost, ApiError } from "@/lib/api";
import type { CalendarMember, ClubMember } from "@/lib/types";

const SEARCH_LIMIT = 20;

/** Autocomplete entry: a club member (any role). */
type Candidate = ClubMember;

/**
 * Settings "Berechtigungen": club members (typically role `member`) who may edit this calendar's events,
 * series, templates, badges and extras. Club admins only (the API answers 403 to everybody else).
 */
export function CalendarPermissions({
  clubId,
  calendarId,
}: {
  clubId: string;
  calendarId: string;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const queryKey = ["calendarMembers", calendarId];
  const [text, setText] = useState("");
  const [chosen, setChosen] = useState<Candidate | null>(null);
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<CalendarMember | null>(null);

  const members = useQuery({
    queryKey,
    queryFn: () => apiGet<CalendarMember[]>(`/api/calendars/${calendarId}/members`),
  });
  const list = members.data ?? [];

  async function search(query: string, signal: AbortSignal): Promise<Candidate[]> {
    const params = new URLSearchParams({ perPage: String(SEARCH_LIMIT) });
    if (query.trim()) params.set("q", query.trim());
    const { data } = await apiGetWithTotal<Candidate[]>(
      `/api/clubs/${clubId}/members?${params}`,
      signal,
    );
    const taken = new Set(list.map((m) => m.userId));
    return data.filter((m) => !taken.has(m.id));
  }

  async function add() {
    if (!chosen || adding) return;
    setAdding(true);
    try {
      await apiPost(`/api/calendars/${calendarId}/members`, { userId: chosen.id });
      await qc.invalidateQueries({ queryKey });
      toast.success(t("settings.permissions.added", { name: chosen.name }));
      setChosen(null);
      setText("");
    } catch (e) {
      if (e instanceof ApiError && e.code === "unknown_reference") {
        toast.error(t("settings.permissions.unknownMember"));
      } else if (!(e instanceof ApiError && e.code === "quota_exceeded")) {
        toast.error(t("settings.permissions.addFailed"));
      }
    } finally {
      setAdding(false);
    }
  }

  async function remove(member: CalendarMember) {
    try {
      await apiDelete(`/api/calendars/${calendarId}/members/${member.userId}`);
      await qc.invalidateQueries({ queryKey });
      toast.success(t("settings.permissions.removed", { name: member.name }));
    } catch {
      toast.error(t("settings.permissions.removeFailed"));
      throw new Error("remove failed");
    }
  }

  let body;
  if (members.isPending) {
    body = <Skeleton style={{ display: "block", height: 96 }} />;
  } else if (members.isError) {
    body = (
      <Banner
        tone="danger"
        title={t("settings.permissions.loadError")}
        action={
          <Button variant="secondary" icon="refresh" onClick={() => void members.refetch()}>
            {t("settings.loadError.retry")}
          </Button>
        }
      />
    );
  } else if (list.length === 0) {
    body = (
      <EmptyState
        icon="users"
        title={t("settings.permissions.emptyTitle")}
        text={t("settings.permissions.emptyText")}
      />
    );
  } else {
    body = (
      <div className="ap-panel ap-panel--flush" style={{ boxShadow: "none" }}>
        <table className="ap-table">
          <caption className="ap-sr">
            {t("settings.permissions.caption", { count: list.length })}
          </caption>
          <thead>
            <tr>
              <th scope="col">{t("club.members.colName")}</th>
              <th scope="col">{t("club.members.colEmail")}</th>
              <th scope="col">{t("club.members.colRole")}</th>
              <th scope="col" className="ap-col-actions">
                {t("club.members.colAction")}
              </th>
            </tr>
          </thead>
          <tbody>
            {list.map((m) => (
              <tr key={m.userId}>
                <td data-label={t("club.members.colName")}>
                  <b>{m.name}</b>
                </td>
                <td data-label={t("club.members.colEmail")}>{m.email}</td>
                <td data-label={t("club.members.colRole")}>
                  <Tag tone={m.clubRole === "admin" ? "brand" : "neutral"}>
                    {t(`club.roles.${m.clubRole}`)}
                  </Tag>
                </td>
                <td className="ap-col-actions" data-label={t("club.members.colAction")}>
                  <Button
                    variant="secondary"
                    aria-label={t("settings.permissions.removeLabel", { name: m.name })}
                    onClick={() => setRemoving(m)}
                  >
                    {t("settings.permissions.remove")}
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
    <>
      <section className="ap-panel ap-form" aria-labelledby="perm-h">
        <h2 className="t-h3" id="perm-h">
          {t("settings.permissions.title")}
        </h2>
        <p className="t-body t-muted t-prose">{t("settings.permissions.description")}</p>
        <form
          className="ap-stack"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            void add();
          }}
        >
          <Field id="perm-add" label={t("settings.permissions.addLabel")}>
            <AutocompleteInput<Candidate>
              value={text}
              minChars={0}
              maxResults={SEARCH_LIMIT}
              placeholder={t("settings.permissions.addPlaceholder")}
              autoComplete="off"
              onSearch={search}
              getLabel={(m) => m.name}
              renderItem={(m) => (
                <>
                  <span>{m.name}</span>
                  <span className="text-ink-muted block">
                    {m.email} · {t(`club.roles.${m.role}`)}
                  </span>
                </>
              )}
              onValueChange={(v) => {
                setText(v);
                if (chosen && v !== chosen.name) setChosen(null);
              }}
              onSelect={setChosen}
            />
          </Field>
          <div className="ap-actions">
            <Button type="submit" icon="plus" loading={adding} disabled={!chosen}>
              {t("settings.permissions.add")}
            </Button>
          </div>
        </form>
      </section>

      <section className="ap-panel" aria-labelledby="perm-list-h">
        <h2 className="t-h3" id="perm-list-h">
          {t("settings.permissions.listTitle")}
        </h2>
        {body}
      </section>

      {removing && (
        <ConfirmDialog
          open
          onOpenChange={(open) => !open && setRemoving(null)}
          icon="user"
          title={t("settings.permissions.removeTitle", { name: removing.name })}
          description={t("settings.permissions.removeText", { name: removing.name })}
          confirmLabel={t("settings.permissions.removeConfirm")}
          onConfirm={() => remove(removing)}
        />
      )}
    </>
  );
}
