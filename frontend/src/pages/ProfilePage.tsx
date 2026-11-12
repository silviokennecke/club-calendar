import { Link, Outlet, useOutletContext } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Banner, Button, Skeleton } from "@/components/ui/shared";
import { AuthLayout } from "@/components/auth/AuthLayout";
import { initials } from "@/components/layout/navigation";
import type { ShellData } from "@/components/layout/shellTypes";
import { ProfileTabs } from "@/components/profile/ProfileTabs";
import type { ProfileOutletContext } from "@/components/profile/profileContext";
import type { ProfileData } from "@/components/profile/profileTypes";
import { apiGet } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { usePageTitle } from "@/lib/usePageTitle";

/**
 * Profile layout (design: Profile, ProfileMobile): header, sign-out and the load state of the account
 * above the tabs; the tabs are routes below `/profile` (account, security, calendar & apps, privacy)
 * rendered through the outlet. The profile query is shared with the tabs via the outlet context.
 */
export default function ProfilePage() {
  const { t } = useTranslation();
  usePageTitle(t("profile.title"));
  const { user, logout } = useAuth();
  // Inside the app shell (a club is known) or on its own page for users without a club.
  const shell = useOutletContext<ShellData | undefined>();

  const profile = useQuery<ProfileData>({
    queryKey: ["profile"],
    queryFn: () => apiGet<ProfileData>("/api/auth/me"),
  });
  const data = profile.data;
  const name = data?.name ?? user?.name ?? "";
  const email = data?.email ?? user?.email ?? "";
  const context: ProfileOutletContext = { profile: data };

  const signOut = (
    <Button variant="secondary" icon="log-out" onClick={logout}>
      {t("profile.signOut")}
    </Button>
  );

  const body = (
    <div className="ap-stack ap-stack--lg">
      <section className="ap-panel" aria-labelledby="pr-me">
        <div className="ap-row" style={{ gap: 16, alignItems: "center" }}>
          <span
            className="ap-avatar"
            style={{ width: 64, height: 64, fontSize: 22 }}
            aria-hidden="true"
          >
            {initials(name || email)}
          </span>
          <div className="ap-stack ap-stack--sm" style={{ minWidth: 0 }}>
            <h2 className="t-h2" id="pr-me">
              {name || email}
            </h2>
            {name && <p className="t-body">{email}</p>}
          </div>
        </div>
      </section>

      <div>
        <ProfileTabs />

        {profile.isPending ? (
          <div className="ap-stack" aria-busy="true">
            <p className="ap-sr" role="status">
              {t("profile.loading")}
            </p>
            <Skeleton style={{ display: "block", height: 160 }} />
            <Skeleton style={{ display: "block", height: 220 }} />
          </div>
        ) : (
          !data && (
            <Banner
              tone="danger"
              title={t("profile.loadError.title")}
              action={
                <Button variant="secondary" icon="refresh" onClick={() => void profile.refetch()}>
                  {t("profile.loadError.retry")}
                </Button>
              }
            >
              {t("profile.loadError.text")}
            </Banner>
          )
        )}

        <Outlet context={context} />
      </div>
    </div>
  );

  if (!shell) {
    return (
      <AuthLayout
        bare
        title={t("profile.title")}
        intro={t("profile.intro")}
        headerEnd={
          <div className="ap-row">
            <Link className="ap-link" to="/clubs?select=1">
              {t("profile.toClubs")}
            </Link>
            {signOut}
          </div>
        }
      >
        {body}
      </AuthLayout>
    );
  }

  return (
    <div className="ap-wrap--narrow">
      <header className="ap-pagehead">
        <div>
          <h1 className="t-h1">{t("profile.title")}</h1>
          <p className="t-body">{t("profile.intro")}</p>
        </div>
        <div className="ap-actions">{signOut}</div>
      </header>
      {body}
    </div>
  );
}
