import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Button, ConfirmDialog, Skeleton, toast } from "@/components/ui/shared";
import { PersonalLink } from "@/components/myclub/PersonalLink";
import { useRotateMySubscriptionSecret } from "@/lib/club/memberApi";
import { apiGet } from "@/lib/api";
import type { Club, MemberSubscription } from "@/lib/types";

function ClubRow({ club }: { club: Club }) {
  const { t } = useTranslation();
  const rotate = useRotateMySubscriptionSecret(club.id);
  const [confirm, setConfirm] = useState(false);
  const [renewed, setRenewed] = useState<MemberSubscription | null>(null);

  async function renew() {
    try {
      setRenewed(await rotate.mutateAsync());
      toast.success(t("profile.subscription.renewed", { club: club.name }));
    } catch {
      toast.error(t("profile.subscription.renewFailed"));
    }
  }

  return (
    <li className="ap-stack ap-stack--sm">
      <div
        className="ap-row"
        style={{ justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}
      >
        <strong>{club.name}</strong>
        <Button variant="secondary" icon="refresh" onClick={() => setConfirm(true)}>
          {t("profile.subscription.renew")}
        </Button>
      </div>
      {renewed && (
        <div className="ap-stack ap-stack--sm">
          <p className="t-sm">{t("profile.subscription.newLink")}</p>
          <PersonalLink subscription={renewed} id={`sub-link-${club.id}`} />
        </div>
      )}
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title={t("profile.subscription.confirmTitle", { club: club.name })}
        description={t("profile.subscription.confirmText")}
        confirmLabel={t("profile.subscription.confirm")}
        tone="primary"
        icon="refresh"
        onConfirm={renew}
      />
    </li>
  );
}

/**
 * "Mein Kalender-Abo" panel: per club the personal link of the subscription can be renewed; the old
 * link then stops working. The subscription itself is managed in "Mein Verein".
 */
export function CalendarSubscriptionSection() {
  const { t } = useTranslation();
  const clubs = useQuery<Club[]>({
    queryKey: ["clubs"],
    queryFn: () => apiGet<Club[]>("/api/clubs"),
  });
  if (clubs.data?.length === 0) return null;

  return (
    <section className="ap-panel" aria-labelledby="pr-subscription">
      <div className="ap-panel-head">
        <div>
          <h2 className="t-h2" id="pr-subscription">
            {t("profile.subscription.title")}
          </h2>
          <p>{t("profile.subscription.text")}</p>
        </div>
      </div>
      {clubs.isPending ? (
        <div aria-busy="true">
          <p className="ap-sr" role="status">
            {t("profile.subscription.loading")}
          </p>
          <Skeleton style={{ display: "block", height: 56 }} />
        </div>
      ) : clubs.isError ? (
        <div className="ap-stack ap-stack--sm">
          <p role="alert">{t("profile.subscription.loadFailed")}</p>
          <div>
            <Button variant="secondary" icon="refresh" onClick={() => void clubs.refetch()}>
              {t("profile.subscription.retry")}
            </Button>
          </div>
        </div>
      ) : (
        <ul className="ap-stack" style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {clubs.data.map((club) => (
            <ClubRow key={club.id} club={club} />
          ))}
        </ul>
      )}
    </section>
  );
}
