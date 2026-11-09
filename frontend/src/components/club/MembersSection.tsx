import { useEffect, useState } from "react";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  Banner,
  Button,
  ConfirmDialog,
  EmptyState,
  Field,
  NativeSelect,
  Pagination,
  SearchInput,
  Skeleton,
  Tag,
  toast,
} from "@/components/ui/shared";
import { apiDelete, apiGetWithTotal, apiPatch } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { focusAfterDialog } from "@/lib/focus";
import { isInvalidRole, isLastAdmin, isLastMember, isMemberGone } from "@/lib/club";
import { CLUB_ROLES, permissionsFor } from "@/lib/club/permissions";
import type { Club, ClubMember, ClubRole } from "@/lib/types";
import { InviteSection } from "./InviteSection";
import { LeaveClubDialog } from "./LeaveClubDialog";

const PER_PAGE = 10;
const SEARCH_DEBOUNCE_MS = 300;

/**
 * "Mitglieder" panel (design: Club): table with remove / leave (confirmed with consequences), the
 * invitation form and the open invitations (`InviteSection`). The list is paginated and searched on the
 * server (a club can have thousands of members): the full list is never loaded.
 */
export function MembersSection({ club }: { club: Club }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { user } = useAuth();
  const [removing, setRemoving] = useState<ClubMember | null>(null);
  const { isAdmin } = permissionsFor(club.role);
  const queryKey = ["members", club.id];
  const [text, setText] = useState("");
  const [q, setQ] = useState("");
  const [role, setRole] = useState<ClubRole | "">("");
  const [page, setPage] = useState(1);

  // A new search term starts at page 1 once typing pauses
  useEffect(() => {
    const trimmed = text.trim();
    if (trimmed === q) return;
    const timer = setTimeout(() => {
      setQ(trimmed);
      setPage(1);
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [text, q]);

  const members = useQuery({
    queryKey: [...queryKey, { page, q, role }],
    queryFn: ({ signal }) => {
      const params = new URLSearchParams({ page: String(page), perPage: String(PER_PAGE) });
      if (q) params.set("q", q);
      if (role) params.set("role", role);
      return apiGetWithTotal<ClubMember[]>(`/api/clubs/${club.id}/members?${params}`, signal);
    },
    placeholderData: keepPreviousData,
  });
  const list = members.data?.data ?? [];
  const total = members.data?.total ?? list.length;
  const pageCount = Math.max(1, Math.ceil(total / PER_PAGE));
  const filtered = q !== "" || role !== "";

  // The last entry of the last page was removed: step back
  useEffect(() => {
    if (members.data && !members.isPlaceholderData && page > pageCount) setPage(pageCount);
  }, [members.data, members.isPlaceholderData, page, pageCount]);

  async function changeRole(member: ClubMember, role: ClubRole) {
    try {
      await apiPatch(`/api/clubs/${club.id}/members/${member.id}`, { role });
      toast.success(
        t("club.members.roleChanged", { name: member.name, role: t(`club.roles.${role}`) }),
      );
      // the own role decides what the page offers
      if (member.id === user?.id) void qc.invalidateQueries({ queryKey: ["club", club.id] });
    } catch (error) {
      toast.error(
        isLastAdmin(error)
          ? t("club.members.lastAdmin")
          : isInvalidRole(error)
            ? t("club.members.invalidRole")
            : t("club.members.roleFailed"),
      );
    }
    await qc.invalidateQueries({ queryKey });
  }

  async function remove(member: ClubMember) {
    try {
      await apiDelete(`/api/clubs/${club.id}/members/${member.id}`);
    } catch (error) {
      // 404 member_not_found: someone else removed the member meanwhile; the goal is reached
      if (!isMemberGone(error)) {
        toast.error(
          isLastAdmin(error)
            ? t("club.members.lastAdmin")
            : isLastMember(error)
              ? t("club.members.lastMember")
              : t("club.members.removeFailed"),
        );
        if (isLastMember(error) || isLastAdmin(error)) void qc.invalidateQueries({ queryKey });
        return;
      }
    }
    await qc.invalidateQueries({ queryKey });
    toast.success(t("club.members.removed", { name: member.name }));
    focusAfterDialog("cl-mem-h");
  }

  let table;
  if (members.isLoading) {
    table = (
      <div className="ap-stack" aria-busy="true">
        <p className="ap-sr" role="status">
          {t("club.members.loading")}
        </p>
        <Skeleton style={{ display: "block", height: 56 }} />
        <Skeleton style={{ display: "block", height: 56 }} />
      </div>
    );
  } else if (members.isError && !members.data) {
    table = (
      <Banner
        tone="danger"
        title={t("club.members.loadError")}
        action={
          <Button variant="secondary" icon="refresh" onClick={() => void members.refetch()}>
            {t("club.retry")}
          </Button>
        }
      />
    );
  } else if (list.length === 0) {
    table = filtered ? (
      <EmptyState
        icon="search"
        title={t("club.members.noMatchTitle")}
        text={t("club.members.noMatch")}
      />
    ) : (
      <EmptyState
        icon="users"
        title={t("club.members.emptyTitle")}
        text={t("club.members.empty")}
      />
    );
  } else {
    table = (
      <div
        className="ap-panel ap-panel--flush"
        style={{ boxShadow: "none", opacity: members.isPlaceholderData ? 0.6 : 1 }}
        aria-busy={members.isPlaceholderData}
      >
        <table className="ap-table">
          <caption className="ap-sr">{t("club.members.caption", { count: total })}</caption>
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
            {list.map((m) => {
              const self = m.id === user?.id;
              return (
                <tr key={m.id}>
                  <td data-label={t("club.members.colName")}>
                    <span className="ap-row" style={{ gap: 8 }}>
                      <b>{m.name}</b>
                      {self && (
                        <span className="ap-badge ap-badge--archived">{t("club.members.you")}</span>
                      )}
                    </span>
                  </td>
                  <td data-label={t("club.members.colEmail")}>{m.email}</td>
                  <td data-label={t("club.members.colRole")}>
                    {isAdmin ? (
                      <NativeSelect
                        value={m.role}
                        aria-label={t("club.members.roleLabel", { name: m.name })}
                        onChange={(e) => void changeRole(m, e.target.value as ClubRole)}
                      >
                        {CLUB_ROLES.map((r) => (
                          <option key={r} value={r}>
                            {t(`club.roles.${r}`)}
                          </option>
                        ))}
                      </NativeSelect>
                    ) : (
                      <Tag tone={m.role === "admin" ? "brand" : "neutral"}>
                        {t(`club.roles.${m.role}`)}
                      </Tag>
                    )}
                  </td>
                  <td className="ap-col-actions" data-label={t("club.members.colAction")}>
                    {(self || isAdmin) && (
                      <Button
                        variant="secondary"
                        disabled={!filtered && total <= 1}
                        aria-label={
                          self
                            ? t("club.members.leaveLabel", { club: club.name })
                            : t("club.members.removeLabel", { name: m.name })
                        }
                        onClick={() => setRemoving(m)}
                      >
                        {self ? t("club.members.leave") : t("club.members.remove")}
                      </Button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!filtered && total <= 1 && (
          <p className="t-small" style={{ padding: "var(--space-3) var(--space-4)" }}>
            {t("club.members.lastMemberHint")}
          </p>
        )}
      </div>
    );
  }

  const removingSelf = removing?.id === user?.id;

  return (
    <section className="ap-panel" aria-labelledby="cl-mem-h">
      <div className="ap-panel-head">
        <div>
          <h2 className="t-h2 ap-focus-target" id="cl-mem-h" tabIndex={-1}>
            {t("club.members.title")}
          </h2>
          <p>{t("club.members.text")}</p>
        </div>
      </div>
      <div className="ap-toolbar">
        <SearchInput
          className="ap-toolbar-search"
          value={text}
          onChange={setText}
          placeholder={t("club.members.searchPlaceholder")}
          label={t("club.members.searchLabel")}
        />
        <Field id="cl-mem-role" label={t("club.members.filterRole")}>
          <NativeSelect
            value={role}
            onChange={(e) => {
              setRole(e.target.value as ClubRole | "");
              setPage(1);
            }}
          >
            <option value="">{t("club.members.allRoles")}</option>
            {CLUB_ROLES.map((r) => (
              <option key={r} value={r}>
                {t(`club.roles.${r}`)}
              </option>
            ))}
          </NativeSelect>
        </Field>
      </div>
      {table}
      <Pagination
        page={page}
        pageCount={pageCount}
        total={total}
        disabled={members.isPlaceholderData}
        onPageChange={setPage}
      />
      {isAdmin && <InviteSection club={club} members={list} />}

      {removing && removingSelf && (
        <LeaveClubDialog
          club={club}
          onClose={() => setRemoving(null)}
          onRefused={() => void qc.invalidateQueries({ queryKey })}
        />
      )}
      {removing && !removingSelf && (
        <ConfirmDialog
          open
          onOpenChange={(open) => !open && setRemoving(null)}
          icon="user"
          title={t("club.members.removeTitle", { name: removing.name })}
          description={t("club.members.removeText", { name: removing.name, club: club.name })}
          consequence={t("club.members.removeConsequence")}
          confirmLabel={t("club.members.removeConfirm")}
          onConfirm={() => remove(removing)}
        />
      )}
    </section>
  );
}
