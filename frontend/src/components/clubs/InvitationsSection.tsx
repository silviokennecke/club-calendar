import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Button, toast } from "@/components/ui/shared";
import { apiPost } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { formatDate } from "@/lib/dateFormat";
import { invitationFailure, type MyInvitation } from "@/lib/invitations";
import { useEnterClub } from "@/lib/useEnterClub";
import type { Club } from "@/lib/types";

/** "Einladungen" of the club picker: invitations to this account with accept / decline. Hidden when empty. */
export function InvitationsSection({ invitations }: { invitations: MyInvitation[] }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { user } = useAuth();
  const enterClub = useEnterClub();
  const [busy, setBusy] = useState<string | null>(null);

  if (invitations.length === 0) return null;
  const dateFormat = user?.dateFormat ?? "dd.MM.yyyy";

  async function answer(inv: MyInvitation, accept: boolean) {
    setBusy(inv.id);
    try {
      if (accept) {
        const club = await apiPost<Club>(`/api/invitations/${inv.id}/accept`, {});
        toast.success(t("invitations.accepted", { club: club.name }));
        await enterClub(club.id);
        return;
      }
      await apiPost(`/api/invitations/${inv.id}/decline`, {});
      toast.success(t("invitations.declined", { club: inv.clubName }));
      await qc.invalidateQueries({ queryKey: ["invitations"] });
    } catch (error) {
      const failure = invitationFailure(error);
      toast.error(t(`invitations.problem.${failure}`));
      // gone, expired or the club is full: the entry would only fail again
      if (failure !== "failed" && failure !== "rateLimited") {
        void qc.invalidateQueries({ queryKey: ["invitations"] });
      }
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="ap-stack" aria-labelledby="inv-h">
      <h2 className="t-h2" id="inv-h">
        {t("invitations.title")}
      </h2>
      <ul className="ap-stack ap-stack--sm" style={{ listStyle: "none", padding: 0, margin: 0 }}>
        {invitations.map((inv) => (
          <li key={inv.id} className="ap-panel ap-row ap-spread" style={{ alignItems: "center" }}>
            <div className="ap-stack ap-stack--sm">
              <p className="t-label">{inv.clubName}</p>
              <p className="t-sm t-muted">
                {inv.invitedByName
                  ? t("invitations.invitedBy", { name: inv.invitedByName })
                  : t("invitations.invited")}
                {" · "}
                {t("invitations.validUntil", { date: formatDate(inv.expiresAt, dateFormat) })}
              </p>
            </div>
            <div className="ap-row" style={{ gap: 8 }}>
              <Button
                variant="secondary"
                disabled={busy !== null}
                aria-label={t("invitations.declineLabel", { club: inv.clubName })}
                onClick={() => void answer(inv, false)}
              >
                {t("invitations.decline")}
              </Button>
              <Button
                icon="check"
                loading={busy === inv.id}
                disabled={busy !== null}
                aria-label={t("invitations.acceptLabel", { club: inv.clubName })}
                onClick={() => void answer(inv, true)}
              >
                {t("invitations.accept")}
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
