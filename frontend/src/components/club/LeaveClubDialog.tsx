import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ConfirmDialog, toast } from "@/components/ui/shared";
import { apiDelete } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { isLastAdmin, isLastMember, isMemberGone } from "@/lib/club";
import type { Club } from "@/lib/types";

interface LeaveClubDialogProps {
  club: Pick<Club, "id" | "name">;
  onClose: () => void;
  /** Refetch the member list after a refusal (members section); not needed elsewhere. */
  onRefused?: () => void;
}

/** Confirmation and request for leaving a club oneself (open to every role). */
export function LeaveClubDialog({ club, onClose, onRefused }: LeaveClubDialogProps) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { user, updateUser } = useAuth();

  async function leave() {
    if (!user) return;
    try {
      await apiDelete(`/api/clubs/${club.id}/members/${user.id}`);
    } catch (error) {
      // 404 member_not_found: already removed meanwhile; the goal is reached
      if (!isMemberGone(error)) {
        // 422 last_member / last_admin: the club keeps at least one member and one admin
        toast.error(
          isLastAdmin(error)
            ? t("club.members.lastAdmin")
            : isLastMember(error)
              ? t("club.members.lastMember")
              : t("club.members.leaveFailed"),
        );
        if (isLastMember(error) || isLastAdmin(error)) onRefused?.();
        return;
      }
    }
    toast.success(t("club.members.left", { club: club.name }));
    await qc.invalidateQueries({ queryKey: ["clubs"] });
    void updateUser({ lastClubId: null, lastCalendarId: null });
    navigate("/clubs?select=1", { replace: true });
  }

  return (
    <ConfirmDialog
      open
      onOpenChange={(open) => !open && onClose()}
      icon="log-out"
      title={t("club.members.leaveTitle")}
      description={t("club.members.leaveText", { club: club.name })}
      consequence={t("club.members.leaveConsequence")}
      confirmLabel={t("club.members.leaveConfirm")}
      onConfirm={leave}
    />
  );
}
