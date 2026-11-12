import { Navigate, useLocation } from "react-router-dom";
import { AccountSection } from "@/components/profile/AccountSection";
import { PreferencesSection } from "@/components/profile/PreferencesSection";
import { LINK_PARAMS, profileTabForHash } from "@/components/profile/profileTabsConfig";
import { useProfileContext } from "@/components/profile/profileContext";
import { useScrollToHash } from "@/lib/profile/useScrollToHash";

/**
 * Index of `/profile`. Also receives the old addresses: `/profile#pr-pw` style links and the SSO link
 * flow's return (`?linked=` …) are forwarded to the tab that owns them, keeping query and hash.
 */
export default function ProfileAccountTab() {
  const { profile } = useProfileContext();
  const { search, hash } = useLocation();
  useScrollToHash(!!profile);

  const params = new URLSearchParams(search);
  const target = LINK_PARAMS.some((p) => params.has(p))
    ? "/profile/security"
    : profileTabForHash(hash)?.href;
  if (target && target !== "/profile")
    return <Navigate to={{ pathname: target, search, hash }} replace />;

  return (
    <div className="ap-stack ap-stack--lg">
      {profile && <AccountSection key={profile.name} profile={profile} />}
      <PreferencesSection />
    </div>
  );
}
