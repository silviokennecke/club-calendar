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
import { initials } from "@/components/layout/navigation";
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

  useEffect(() => {
    if (isLoading || isError || redirected) return;
    if (!explicitSelect && user?.lastClubId && user?.lastCalendarId) {
      const clubExists = clubs.some((c) => c.id === user.lastClubId);
      if (clubs.length > 0 && clubExists) {
        setRedirected(true);
        navigate(`/clubs/${user.lastClubId}/calendars/${user.lastCalendarId}`, { replace: true });
        return;
      }
    }
    // No club yet: onboarding. (With ?select=1 the empty state below explains it instead.)
    if (clubs.length === 0 && !explicitSelect) {
      setRedirected(true);
      navigate("/setup", { replace: true });
    }
  }, [user, clubs, isLoading, isError, redirected, navigate, explicitSelect]);

  if (isLoading || redirected) return <FullPageLoader />;

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
        <EmptyState
          icon="building"
          title={t("clubs.emptyTitle")}
          text={t("clubs.emptyText")}
          actions={
            <LinkButton to="/setup?new=1" icon="plus">
              {t("clubs.newClub")}
            </LinkButton>
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
      <div className="ap-cols-3">
        {clubs.map((club) => (
          <ClubCard
            key={club.id}
            club={club}
            lastClubId={user?.lastClubId}
            lastCalendarId={user?.lastCalendarId}
            userId={user?.id}
          />
        ))}
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
      </div>
    </AuthLayout>
  );
}
