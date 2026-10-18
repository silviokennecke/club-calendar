import { useRef, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
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
import { apiDelete, apiGet, apiPost } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { focusAfterDialog } from "@/lib/focus";
import {
  isLastMember,
  isMemberGone,
  memberAddFailure,
  validateMemberEmail,
  type MemberProblem,
} from "@/lib/club";
import type { Club, User } from "@/lib/types";

/**
 * "Mitglieder" panel (design: Club): table with remove / leave (confirmed with consequences) and the
 * "Mitglied hinzufügen" form (the person needs an account already).
 */
export function MembersSection({ club }: { club: Club }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { user, updateUser } = useAuth();
  const [removing, setRemoving] = useState<User | null>(null);
  const [email, setEmail] = useState("");
  const [problem, setProblem] = useState<MemberProblem | "notFound" | "failed" | null>(null);
  const [signal, setSignal] = useState(0);
  const [adding, setAdding] = useState(false);
  const emailRef = useRef<HTMLInputElement>(null);
  const queryKey = ["members", club.id];

  const members = useQuery<User[]>({
    queryKey,
    queryFn: () => apiGet<User[]>(`/api/clubs/${club.id}/members`),
  });
  const list = members.data ?? [];

  async function add(e: FormEvent) {
    e.preventDefault();
    const found = validateMemberEmail(email, list);
    if (found) {
      setProblem(found);
      setSignal((n) => n + 1);
      return;
    }
    setProblem(null);
    setAdding(true);
    const value = email.trim();
    try {
      await apiPost(`/api/clubs/${club.id}/members`, { email: value });
      await qc.invalidateQueries({ queryKey });
      setEmail("");
      toast.success(t("club.members.added", { email: value }));
      emailRef.current?.focus();
    } catch (error) {
      setProblem(memberAddFailure(error));
      setSignal((n) => n + 1);
    } finally {
      setAdding(false);
    }
  }

  async function remove(member: User) {
    const self = member.id === user?.id;
    try {
      await apiDelete(`/api/clubs/${club.id}/members/${member.id}`);
    } catch (error) {
      // 404 member_not_found: someone else removed the member meanwhile; the goal is reached
      if (!isMemberGone(error)) {
        // 422 last_member: the others left meanwhile; the club keeps at least one member
        toast.error(
          isLastMember(error)
            ? t("club.members.lastMember")
            : t(self ? "club.members.leaveFailed" : "club.members.removeFailed"),
        );
        if (isLastMember(error)) void qc.invalidateQueries({ queryKey });
        return;
      }
    }
    if (self) {
      // The user no longer belongs to the club: forget it as "last used" and leave the page.
      toast.success(t("club.members.left", { club: club.name }));
      await qc.invalidateQueries({ queryKey: ["clubs"] });
      void updateUser({ lastClubId: null, lastCalendarId: null });
      navigate("/clubs?select=1", { replace: true });
      return;
    }
    await qc.invalidateQueries({ queryKey });
    toast.success(t("club.members.removed", { name: member.name }));
    focusAfterDialog("cl-mem-h");
  }

  const message = problem ? t(`club.members.problem.${problem}`) : undefined;

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
    table = (
      <EmptyState
        icon="users"
        title={t("club.members.emptyTitle")}
        text={t("club.members.empty")}
      />
    );
  } else {
    table = (
      <div className="ap-panel ap-panel--flush" style={{ boxShadow: "none" }}>
        <table className="ap-table">
          <caption className="ap-sr">{t("club.members.caption", { count: list.length })}</caption>
          <thead>
            <tr>
              <th scope="col">{t("club.members.colName")}</th>
              <th scope="col">{t("club.members.colEmail")}</th>
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
                  <td className="ap-col-actions" data-label={t("club.members.colAction")}>
                    <Button
                      variant="secondary"
                      disabled={list.length <= 1}
                      aria-label={
                        self
                          ? t("club.members.leaveLabel", { club: club.name })
                          : t("club.members.removeLabel", { name: m.name })
                      }
                      onClick={() => setRemoving(m)}
                    >
                      {self ? t("club.members.leave") : t("club.members.remove")}
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {list.length <= 1 && (
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
      {table}
      <form
        className="ap-form"
        style={{ marginTop: "var(--space-6)" }}
        aria-labelledby="cl-add-h"
        noValidate
        onSubmit={(e) => void add(e)}
      >
        <h3 className="t-h3" id="cl-add-h">
          {t("club.members.addTitle")}
        </h3>
        <ErrorSummary
          title={t("club.members.errorSummary")}
          errors={message ? [{ fieldId: "cl-email", message }] : []}
          focusSignal={signal}
        />
        <Field
          id="cl-email"
          label={t("club.members.emailLabel")}
          required
          hint={t("club.members.emailHint")}
          error={message}
        >
          <TextInput
            ref={emailRef}
            type="email"
            value={email}
            autoComplete="off"
            placeholder={t("club.members.emailPlaceholder")}
            onChange={(e) => {
              setEmail(e.target.value);
              setProblem(null);
            }}
          />
        </Field>
        <div className="ap-actions">
          <Button type="submit" icon="user-plus" loading={adding}>
            {t("club.members.add")}
          </Button>
        </div>
      </form>

      {removing && (
        <ConfirmDialog
          open
          onOpenChange={(open) => !open && setRemoving(null)}
          icon={removingSelf ? "log-out" : "user"}
          title={
            removingSelf
              ? t("club.members.leaveTitle")
              : t("club.members.removeTitle", { name: removing.name })
          }
          description={
            removingSelf
              ? t("club.members.leaveText", { club: club.name })
              : t("club.members.removeText", { name: removing.name, club: club.name })
          }
          consequence={
            removingSelf ? t("club.members.leaveConsequence") : t("club.members.removeConsequence")
          }
          confirmLabel={
            removingSelf ? t("club.members.leaveConfirm") : t("club.members.removeConfirm")
          }
          onConfirm={() => remove(removing)}
        />
      )}
    </section>
  );
}
