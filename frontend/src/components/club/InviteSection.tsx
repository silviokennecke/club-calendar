import { useRef, useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  Banner,
  Button,
  ConfirmDialog,
  ErrorSummary,
  Field,
  NativeSelect,
  Tag,
  TextInput,
  toast,
} from "@/components/ui/shared";
import { apiDelete, apiGet, apiPost } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { validateMemberEmail } from "@/lib/club";
import { formatDate } from "@/lib/dateFormat";
import {
  inviteFailure,
  isInvitationGone,
  type ClubInvitation,
  type InviteProblem,
} from "@/lib/invitations";
import { CLUB_ROLES } from "@/lib/club/permissions";
import type { Club, ClubRole, User } from "@/lib/types";

/**
 * "Per E-Mail einladen" form and the list of open invitations of the club. The answer to an invitation is
 * always neutral (the backend does not say whether the address has an account), so is the message here.
 */
export function InviteSection({ club, members }: { club: Club; members: ReadonlyArray<User> }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { user } = useAuth();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<ClubRole>("editor");
  const [problem, setProblem] = useState<InviteProblem | null>(null);
  const [signal, setSignal] = useState(0);
  const [sending, setSending] = useState(false);
  const [resending, setResending] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<ClubInvitation | null>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const queryKey = ["invitations", club.id];
  const dateFormat = user?.dateFormat ?? "dd.MM.yyyy";

  const invitations = useQuery<ClubInvitation[]>({
    queryKey,
    queryFn: () => apiGet<ClubInvitation[]>(`/api/clubs/${club.id}/invitations`),
  });
  const list = invitations.data ?? [];

  async function invite(e: FormEvent) {
    e.preventDefault();
    const found = validateMemberEmail(email, members);
    if (found) {
      setProblem(found);
      setSignal((n) => n + 1);
      return;
    }
    setProblem(null);
    setSending(true);
    try {
      await apiPost(`/api/clubs/${club.id}/invitations`, {
        email: email.trim(),
        role,
      });
      await qc.invalidateQueries({ queryKey });
      setEmail("");
      toast.success(
        t("club.invite.sent", {
          email: email.trim(),
          role,
        }),
      );
      emailRef.current?.focus();
    } catch (error) {
      setProblem(inviteFailure(error));
      setSignal((n) => n + 1);
    } finally {
      setSending(false);
    }
  }

  async function resend(invitation: ClubInvitation) {
    setResending(invitation.id);
    try {
      await apiPost(`/api/clubs/${club.id}/invitations/${invitation.id}/resend`, {});
      toast.success(t("club.invite.resent", { email: invitation.email }));
    } catch (error) {
      if (isInvitationGone(error)) toast.error(t("club.invite.gone"));
      else if ((error as { code?: unknown } | null)?.code === "rate_limited")
        toast.error(t("club.invite.problem.rateLimited"));
      else toast.error(t("club.invite.resendFailed"));
    } finally {
      setResending(null);
      void qc.invalidateQueries({ queryKey });
    }
  }

  async function revoke(invitation: ClubInvitation) {
    try {
      await apiDelete(`/api/clubs/${club.id}/invitations/${invitation.id}`);
    } catch (error) {
      // 404: answered or revoked meanwhile, the goal is reached
      if (!isInvitationGone(error)) {
        toast.error(t("club.invite.revokeFailed"));
        return;
      }
    }
    await qc.invalidateQueries({ queryKey });
    toast.success(t("club.invite.revoked", { email: invitation.email }));
  }

  const message = problem ? t(`club.invite.problem.${problem}`) : undefined;

  return (
    <>
      <form
        className="ap-form"
        style={{ marginTop: "var(--space-6)" }}
        aria-labelledby="cl-add-h"
        noValidate
        onSubmit={(e) => void invite(e)}
      >
        <h3 className="t-h3" id="cl-add-h">
          {t("club.invite.title")}
        </h3>
        <ErrorSummary
          title={t("club.invite.errorSummary")}
          errors={message ? [{ fieldId: "cl-email", message }] : []}
          focusSignal={signal}
        />
        <Field
          id="cl-email"
          label={t("club.invite.emailLabel")}
          required
          hint={t("club.invite.emailHint")}
          error={message}
        >
          <TextInput
            ref={emailRef}
            type="email"
            inputMode="email"
            spellCheck={false}
            value={email}
            autoComplete="off"
            placeholder={t("club.invite.emailPlaceholder")}
            onChange={(e) => {
              setEmail(e.target.value);
              setProblem(null);
            }}
          />
        </Field>
        <Field id="cl-role" label={t("club.invite.roleLabel")} hint={t("club.invite.roleHint")}>
          <NativeSelect value={role} onChange={(e) => setRole(e.target.value as ClubRole)}>
            {CLUB_ROLES.map((r) => (
              <option key={r} value={r}>
                {t(`club.roles.${r}`)}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <div className="ap-actions">
          <Button type="submit" icon="mail" loading={sending}>
            {t("club.invite.send")}
          </Button>
        </div>
      </form>

      {invitations.isError && !invitations.data && (
        <Banner
          tone="danger"
          title={t("club.invite.loadError")}
          action={
            <Button variant="secondary" icon="refresh" onClick={() => void invitations.refetch()}>
              {t("club.retry")}
            </Button>
          }
        />
      )}

      {list.length > 0 && (
        <div style={{ marginTop: "var(--space-6)" }}>
          <h3 className="t-h3" id="cl-inv-h">
            {t("club.invite.openTitle")}
          </h3>
          <p className="t-small">{t("club.invite.openText")}</p>
          <div className="ap-panel ap-panel--flush" style={{ boxShadow: "none" }}>
            <table className="ap-table">
              <caption className="ap-sr">
                {t("club.invite.caption", { count: list.length })}
              </caption>
              <thead>
                <tr>
                  <th scope="col">{t("club.members.colEmail")}</th>
                  <th scope="col">{t("club.members.colRole")}</th>
                  <th scope="col">{t("club.invite.colStatus")}</th>
                  <th scope="col" className="ap-col-actions">
                    {t("club.members.colAction")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {list.map((inv) => {
                  const expired = inv.status === "expired";
                  return (
                    <tr key={inv.id}>
                      <td data-label={t("club.members.colEmail")}>{inv.email}</td>
                      <td data-label={t("club.members.colRole")}>
                        <Tag>{t(`club.roles.${inv.role}`)}</Tag>
                      </td>
                      <td data-label={t("club.invite.colStatus")}>
                        {expired ? (
                          <>
                            <span className="ap-badge ap-badge--danger">
                              {t("club.invite.expired")}
                            </span>{" "}
                            <span className="t-small">
                              {t("club.invite.expiredText", {
                                date: formatDate(inv.expiresAt, dateFormat),
                              })}
                            </span>
                          </>
                        ) : (
                          <span className="ap-badge ap-badge--draft">
                            {t("club.invite.pending", {
                              date: formatDate(inv.expiresAt, dateFormat),
                            })}
                          </span>
                        )}
                      </td>
                      <td className="ap-col-actions" data-label={t("club.members.colAction")}>
                        <span className="ap-row" style={{ gap: 8 }}>
                          <Button
                            variant="secondary"
                            loading={resending === inv.id}
                            aria-label={t("club.invite.resendLabel", { email: inv.email })}
                            onClick={() => void resend(inv)}
                          >
                            {t("club.invite.resend")}
                          </Button>
                          <Button
                            variant="secondary"
                            aria-label={t("club.invite.revokeLabel", { email: inv.email })}
                            onClick={() => setRevoking(inv)}
                          >
                            {t("club.invite.revoke")}
                          </Button>
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {revoking && (
        <ConfirmDialog
          open
          onOpenChange={(open) => !open && setRevoking(null)}
          icon="mail"
          title={t("club.invite.revokeTitle", { email: revoking.email })}
          description={t("club.invite.revokeText", { email: revoking.email, club: club.name })}
          consequence={t("club.invite.revokeConsequence")}
          confirmLabel={t("club.invite.revokeConfirm")}
          onConfirm={() => revoke(revoking)}
        />
      )}
    </>
  );
}
