import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  Banner,
  Button,
  ConfirmDialog,
  EmptyState,
  LinkButton,
  Skeleton,
  toast,
} from "@/components/ui/shared";
import { ClubNameSection } from "@/components/club/ClubNameSection";
import { MembersSection } from "@/components/club/MembersSection";
import { CalendarsSection } from "@/components/club/CalendarsSection";
import { apiDelete, apiGet } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { clubDeleteConsequence } from "@/lib/club";
import type { Club } from "@/lib/types";
/**
 * Club management (design: Club, ClubMobile): name, members, calendars (incl. archived, with
 * duplicate / archive / delete) and the danger zone. Calendar and club deletion name their
 * consequences; deleting the club also asks to type its name.
 */
export default function ClubPage() {
  const { t } = useTranslation();
  const { clubId = "" } = useParams<{ clubId: string }>();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { updateUser } = useAuth();
  const [deleteOpen, setDeleteOpen] = useState(false);

  const query = useQuery<Club>({
    queryKey: ["club", clubId],
    queryFn: () => apiGet<Club>(`/api/clubs/${clubId}`),
    retry: false,
  });
  const club = query.data;
  // The club list tells "unknown club" apart from a network problem, even when the browser cannot
  // read the status of the failed request.
  const clubs = useQuery<Club[]>({
    queryKey: ["clubs"],
    queryFn: () => apiGet<Club[]>("/api/clubs"),
  });

  async function deleteClub() {
    if (!club) return;
    try {
      await apiDelete(`/api/clubs/${club.id}`);
    } catch {
      toast.error(t("club.danger.failed"));
      return;
    }
    toast.success(t("club.danger.done", { name: club.name }));
    qc.removeQueries({ queryKey: ["club", club.id] });
    await qc.invalidateQueries({ queryKey: ["clubs"] });
    void updateUser({ lastClubId: null, lastCalendarId: null });
    navigate("/clubs", { replace: true });
  }

  let body;
  if (query.isPending) {
    body = (
      <div className="ap-stack ap-stack--lg" aria-busy="true">
        <p className="ap-sr" role="status">
          {t("club.loading")}
        </p>
        <Skeleton style={{ display: "block", height: 140 }} />
        <Skeleton style={{ display: "block", height: 260 }} />
        <Skeleton style={{ display: "block", height: 260 }} />
      </div>
    );
  } else if (!club) {
    const notFound =
      /40[34]/.test((query.error as { message?: string } | null)?.message ?? "") ||
      (!!clubs.data && !clubs.data.some((c) => c.id === clubId));
    body = notFound ? (
      <EmptyState
        icon="building"
        title={t("club.notFound.title")}
        text={t("club.notFound.text")}
        actions={
          <LinkButton to="/clubs?select=1" icon="building">
            {t("club.allClubs")}
          </LinkButton>
        }
      />
    ) : (
      <Banner
        tone="danger"
        title={t("club.loadError.title")}
        action={
          <Button variant="secondary" icon="refresh" onClick={() => void query.refetch()}>
            {t("club.retry")}
          </Button>
        }
      >
        {t("club.loadError.text")}
      </Banner>
    );
  } else {
    body = (
      <div className="ap-stack ap-stack--lg">
        <ClubNameSection key={club.name} club={club} />
        <MembersSection club={club} />
        <CalendarsSection club={club} />

        <section className="ap-panel ap-panel--danger" aria-labelledby="cl-danger-h">
          <div className="ap-panel-head">
            <div>
              <h2 className="t-h2" id="cl-danger-h">
                {t("club.danger.title")}
              </h2>
              <p>{t("club.danger.text")}</p>
            </div>
            <Button
              variant="danger"
              icon="trash"
              onClick={() => {
                // Fresh counters for the consequence ("… mit 14 Terminen und 2 Feeds …")
                void query.refetch();
                setDeleteOpen(true);
              }}
            >
              {t("club.danger.action")}
            </Button>
          </div>
        </section>
        <ConfirmDialog
          open={deleteOpen}
          onOpenChange={setDeleteOpen}
          icon="trash"
          title={t("club.danger.confirmTitle", { name: club.name })}
          description={t("club.danger.confirmText")}
          consequence={clubDeleteConsequence(club, t)}
          confirmLabel={t("club.danger.confirm")}
          requireText={club.name}
          requireLabel={t("club.danger.requireLabel")}
          onConfirm={deleteClub}
        />
      </div>
    );
  }

  return (
    <div className="ap-wrap">
      <header className="ap-pagehead">
        <div>
          <h1 className="t-h1">{t("club.title")}</h1>
          {club && (
            <p className="t-body">{t("club.subtitle", { name: club.name, zone: club.timezone })}</p>
          )}
        </div>
        <div className="ap-actions">
          <LinkButton variant="secondary" icon="building" to="/clubs?select=1">
            {t("club.allClubs")}
          </LinkButton>
        </div>
      </header>
      {body}
    </div>
  );
}
