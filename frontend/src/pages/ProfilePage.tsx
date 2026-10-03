import { useState } from "react";
import { Link, useNavigate, useOutletContext } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Banner, Button, ConfirmDialog, Skeleton, toast } from "@/components/ui/shared";
import { AuthLayout } from "@/components/auth/AuthLayout";
import { initials } from "@/components/layout/navigation";
import type { ShellData } from "@/components/layout/shellTypes";
import { LinkedLoginsSection } from "@/components/profile/LinkedLoginsSection";
import { PasskeysSection } from "@/components/profile/PasskeysSection";
import { PreferencesSection } from "@/components/profile/PreferencesSection";
import type { ProfileData } from "@/components/profile/profileTypes";
import { apiDelete, apiGet } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";

/**
 * Profile (design: Profile, ProfileMobile): account, linked sign-ins, passkeys, personal settings
 * (incl. theme) and account deletion. Name, e-mail and password cannot be changed yet (no backend).
 */
export default function ProfilePage() {
  const { t } = useTranslation();
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [deleteOpen, setDeleteOpen] = useState(false);
  // Inside the app shell (a club is known) or on its own page for users without a club.
  const shell = useOutletContext<ShellData | undefined>();

  const profile = useQuery<ProfileData>({
    queryKey: ["profile"],
    queryFn: () => apiGet<ProfileData>("/api/auth/me"),
  });
  const data = profile.data;
  const name = data?.name ?? user?.name ?? "";
  const email = data?.email ?? user?.email ?? "";

  async function deleteAccount() {
    try {
      await apiDelete("/api/auth/me");
    } catch {
      toast.error(t("profile.danger.failed"));
      return;
    }
    logout();
    navigate("/login", { replace: true });
  }

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
        <p className="t-sm" style={{ marginTop: "var(--space-3)" }}>
          {t("profile.me.readOnly")}
        </p>
      </section>

      {profile.isPending ? (
        <div className="ap-stack" aria-busy="true">
          <p className="ap-sr" role="status">
            {t("profile.loading")}
          </p>
          <Skeleton style={{ display: "block", height: 160 }} />
          <Skeleton style={{ display: "block", height: 220 }} />
        </div>
      ) : data ? (
        <>
          <LinkedLoginsSection linked={data.oauthAccounts} />
          <PasskeysSection passkeys={data.passkeys} refresh={() => profile.refetch()} />
        </>
      ) : (
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
      )}

      <PreferencesSection />

      <section className="ap-panel ap-panel--danger" aria-labelledby="pr-danger">
        <div className="ap-panel-head">
          <div>
            <h2 className="t-h2" id="pr-danger">
              {t("profile.danger.title")}
            </h2>
            <p>{t("profile.danger.text")}</p>
          </div>
          <Button variant="danger" icon="trash" onClick={() => setDeleteOpen(true)}>
            {t("profile.danger.action")}
          </Button>
          <ConfirmDialog
            open={deleteOpen}
            onOpenChange={setDeleteOpen}
            icon="trash"
            title={t("profile.danger.confirmTitle")}
            description={t("profile.danger.confirmText")}
            consequence={t("profile.danger.consequence")}
            confirmLabel={t("profile.danger.confirm")}
            requireText={email || undefined}
            requireLabel={t("profile.danger.requireLabel")}
            onConfirm={deleteAccount}
          />
        </div>
      </section>
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
