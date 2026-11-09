import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { apiGet } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import {
  Banner,
  Button,
  EmptyState,
  FullPageLoader,
  Icon,
  LinkButton,
} from "@/components/ui/shared";
import { AuthLayout } from "@/components/auth/AuthLayout";
import { ClubCard } from "@/components/clubs/ClubCard";
import { InvitationsSection } from "@/components/clubs/InvitationsSection";
import { readInvitationToken, takeInvitationRedirect, type MyInvitation } from "@/lib/invitations";
import { initials } from "@/components/layout/navigation";
import { isPlainMember } from "@/lib/club/permissions";
import { myClubPath } from "@/lib/club/myClub";
import { takeReturnTo } from "@/lib/mcp";
import { useClubCreationAllowed } from "@/lib/registration";
import type { Club } from "@/lib/types";

/**
 * Club picker (design: ClubPicker). Without `?select=1` the user is sent straight to the last used
 * calendar (or to /setup when they have no club yet); the club switcher links here with select=1.
 */
export default function ClubsPage() {
  const { user, logout } = useAuth();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const explicitSelect = searchParams.has("select");
  const [redirected, setRedirected] = useState(false);

  const {
    data: clubs = [],
    isLoading,
    isError,
  } = useQuery({
    queryKey: ["clubs"],
    queryFn: () => apiGet<Club[]>("/api/clubs"),
  });

  const { allowed: creationAllowed, loading: registrationLoading } = useClubCreationAllowed();

  // Invitations to this account. A failed request counts as "none": the page works without them.
  const { data: invitations = [], isLoading: invitationsLoading } = useQuery({
    queryKey: ["invitations"],
    queryFn: () => apiGet<MyInvitation[]>("/api/invitations"),
    retry: false,
  });

  useEffect(() => {
    if (redirected) return;
    // Back from the sign-in with the link of an invitation e-mail: continue there.
    if (readInvitationToken() && takeInvitationRedirect()) {
      setRedirected(true);
      navigate("/invitations", { replace: true });
      return;
    }
    const returnTo = takeReturnTo();
    if (returnTo) {
      setRedirected(true);
      navigate(returnTo, { replace: true });
      return;
    }
    if (isLoading || isError || invitationsLoading || registrationLoading) return;
    const lastClub = user?.lastClubId ? clubs.find((c) => c.id === user.lastClubId) : undefined;
    if (!explicitSelect && lastClub && isPlainMember(lastClub.role)) {
      setRedirected(true);
      navigate(myClubPath(lastClub.id), { replace: true });
      return;
    }
    if (!explicitSelect && user?.lastClubId && user?.lastCalendarId) {
      const clubExists = clubs.some((c) => c.id === user.lastClubId);
      if (clubs.length > 0 && clubExists) {
        setRedirected(true);
        navigate(`/clubs/${user.lastClubId}/calendars/${user.lastCalendarId}`, { replace: true });
        return;
      }
    }
    // No club yet: onboarding, unless invitations are waiting (they are shown here instead). With
    // ?select=1 (skipped onboarding) the empty state below explains it.
    if (clubs.length === 0 && invitations.length === 0 && !explicitSelect && creationAllowed) {
      setRedirected(true);
      navigate("/setup", { replace: true });
    }
  }, [
    user,
    clubs,
    invitations,
    isLoading,
    isError,
    invitationsLoading,
    registrationLoading,
    creationAllowed,
    redirected,
    navigate,
    explicitSelect,
  ]);

  if (
    isLoading ||
    redirected ||
    (clubs.length === 0 && !explicitSelect && (invitationsLoading || registrationLoading))
  )
    return <FullPageLoader />;

  const name = user?.name || user?.email || "";
  const headerEnd = (
    <div className="ap-row">
      <span className="ap-avatar" aria-hidden="true">
        {initials(name)}
      </span>
      <span className="t-label">{name}</span>
      <Button variant="ghost" icon="log-out" onClick={logout}>
        {t("clubs.signOut")}
      </Button>
    </div>
  );

  if (isError) {
    return (
      <AuthLayout bare title={t("clubs.selectClub")} headerEnd={headerEnd}>
        <Banner tone="danger" title={t("clubs.errorTitle")}>
          {t("clubs.errorText")}
        </Banner>
      </AuthLayout>
    );
  }

  if (clubs.length === 0) {
    return (
      <AuthLayout bare title={t("clubs.selectClub")} headerEnd={headerEnd}>
        <InvitationsSection invitations={invitations} />
        <EmptyState
          icon="building"
          title={t("clubs.emptyTitle")}
          text={creationAllowed ? t("clubs.emptyText") : t("clubs.emptyRestrictedText")}
          actions={
            creationAllowed ? (
              <LinkButton to="/setup?new=1" icon="plus">
                {t("clubs.newClub")}
              </LinkButton>
            ) : undefined
          }
        />
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      bare
      title={t("clubs.selectClub")}
      intro={clubs.length > 1 ? t("clubs.selectIntro") : t("clubs.selectIntroOne")}
      headerEnd={headerEnd}
    >
      <InvitationsSection invitations={invitations} />
      <div className="ap-cols-3">
        {clubs.map((club) => (
          <ClubCard
            key={club.id}
            club={club}
            lastClubId={user?.lastClubId}
            lastCalendarId={user?.lastCalendarId}
          />
        ))}
        {creationAllowed && (
          <article
            className="ap-panel ap-evcard ap-stack ap-stack--sm"
            style={{
              alignItems: "stretch",
              border: "1.5px dashed var(--border-strong)",
              boxShadow: "none",
            }}
          >
            <h2 className="t-h3 ap-row ap-row--nowrap">
              <Icon glyph="plus" size={20} />
              <Link to="/setup?new=1" aria-describedby="club-new-meta">
                {t("clubs.newClub")}
              </Link>
            </h2>
            <p className="t-sm t-muted" id="club-new-meta">
              {t("clubs.newClubText")}
            </p>
          </article>
        )}
      </div>
    </AuthLayout>
  );
}
