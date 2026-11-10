import { useContext } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { hasSession } from "@/lib/api";
import { AuthContext } from "@/lib/auth-context";

/**
 * Slim bar above the public pages for a signed-in visitor (who they are, way to the account, sign out).
 * Public pages never force a login: without an auth provider or tokens nothing is rendered. While the
 * session of a returning visitor is being checked an empty bar of the same height holds the place.
 */
export function SignedInBar() {
  const { t } = useTranslation();
  const auth = useContext(AuthContext);
  if (!auth) return null;
  const { user, loading, logout } = auth;

  if (!user) {
    return loading && hasSession() ? (
      <div className="pub-accountbar" aria-hidden="true" data-testid="signed-in-bar-placeholder" />
    ) : null;
  }

  return (
    <div className="pub-accountbar" role="region" aria-label={t("feed.accountBar.label")}>
      <div className="pub-wrap pub-accountbar-in">
        <span className="pub-accountbar-who">
          {t("feed.accountBar.signedInAs")} <strong>{user.name || user.email}</strong>
        </span>
        <span className="pub-accountbar-links">
          <Link className="ap-link" to="/clubs">
            {t("feed.accountBar.toAccount")}
          </Link>
          <button type="button" className="ap-link" onClick={logout}>
            {t("feed.accountBar.signOut")}
          </button>
        </span>
      </div>
    </div>
  );
}
