import { useEffect, useRef, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  apiErrorStatus,
  apiGet,
  apiPatch,
  clearTokens,
  revokeRefreshToken,
  storeTokens,
  CONSENT_REQUIRED_EVENT,
  EMAIL_VERIFICATION_REQUIRED_EVENT,
  getAccessToken,
  broadcastLogout,
  ensureAccessToken,
  hasSession,
  onRemoteSignOut,
} from "./api";
import { AuthContext, type AuthContextValue } from "./auth-context";
import { clearDrafts } from "./events/draft";
import i18n from "./i18n";
import type { User } from "./types";

/** Pauses before the retries of /me after a failure that is no verdict on the session. */
const RETRY_DELAYS_MS = [500, 1500];

const SUPPORTED_LANGS = ["en", "de"];

function applyUserLanguage(user: User) {
  const lang = SUPPORTED_LANGS.includes(user.language) ? user.language : "en";
  i18n.changeLanguage(lang);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  // A token exists but /me could not be answered (network, 429, 5xx): the visitor is not a guest.
  const [sessionError, setSessionError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  // Bumped by login()/logout(): a /me check that started before is outdated and must not touch the state.
  const decision = useRef(0);

  useEffect(() => {
    if (!hasSession()) {
      setLoading(false);
      return;
    }
    // Ignore a late /me answer once the effect is gone or login()/logout() decided in the meantime.
    const started = decision.current;
    let cancelled = false;
    const stale = () => cancelled || decision.current !== started;
    (async () => {
      for (let i = 0; ; i++) {
        try {
          // A new tab or restarted browser has only the refresh token: get an access token first.
          if (!(await ensureAccessToken())) {
            if (stale()) return;
            setUser(null);
            break;
          }
          const me = await apiGet<User>("/api/auth/me");
          if (stale()) return;
          applyUserLanguage(me);
          setUser(me);
          setSessionError(false);
          break;
        } catch (err: unknown) {
          if (stale()) return;
          // Only a rejection of the session invalidates it. Network errors (also the abort when the page is
          // left while /me is in flight), 429 and 5xx are no verdict: keep the tokens, retry, and never let
          // the visitor look like a guest (`sessionError`).
          const status = apiErrorStatus(err);
          if (status === 401 || status === 403) {
            clearTokens();
            setUser(null);
            setSessionError(false);
            break;
          }
          if (i >= RETRY_DELAYS_MS.length) {
            setSessionError(true);
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS_MS[i]));
          if (stale()) return;
        }
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  // Retry later when the connection or the tab comes back.
  useEffect(() => {
    if (!sessionError) return;
    const retry = () => {
      if (document.visibilityState === "hidden") return;
      setSessionError(false);
      setLoading(true);
      setAttempt((n) => n + 1);
    };
    window.addEventListener("online", retry);
    document.addEventListener("visibilitychange", retry);
    return () => {
      window.removeEventListener("online", retry);
      document.removeEventListener("visibilitychange", retry);
    };
  }, [sessionError]);

  const login = (accessToken: string, refreshToken: string, user: User) => {
    decision.current++;
    storeTokens(accessToken, refreshToken);
    clearDrafts(user.id);
    applyUserLanguage(user);
    setUser(user);
    setSessionError(false);
    setLoading(false);
  };

  const logout = () => {
    // The server ends the session too (revokes the refresh token's family); the local sign-out does not wait for it.
    decision.current++;
    revokeRefreshToken();
    clearTokens();
    broadcastLogout();
    clearDrafts();
    // Cached clubs/events of this account must not show up for the next one in the same tab.
    queryClient.clear();
    setUser(null);
    setSessionError(false);
    setLoading(false);
  };

  // Another tab signed out: same local reset as logout(), without API call or echo.
  useEffect(
    () =>
      onRemoteSignOut(() => {
        decision.current++;
        clearDrafts();
        queryClient.clear();
        setUser(null);
        setSessionError(false);
        setLoading(false);
      }),
    [queryClient],
  );

  const refreshUser = async () => {
    try {
      setUser(await apiGet<User>("/api/auth/me"));
    } catch {
      // no verdict: the next request reports the problem
    }
  };

  // A 403 `consent_required` from any call (api.ts): load /me so the consent gate appears.
  useEffect(() => {
    const onRequired = () => {
      if (getAccessToken()) void refreshUser();
    };
    window.addEventListener(CONSENT_REQUIRED_EVENT, onRequired);
    // likewise a 403 `email_verification_required`: /me then carries the flag that shows the verify page
    window.addEventListener(EMAIL_VERIFICATION_REQUIRED_EVENT, onRequired);
    return () => {
      window.removeEventListener(CONSENT_REQUIRED_EVENT, onRequired);
      window.removeEventListener(EMAIL_VERIFICATION_REQUIRED_EVENT, onRequired);
    };
  }, []);

  /** Saves profile settings on the account; resolves to false when the request failed. */
  const updateUser = async (data: Parameters<AuthContextValue["updateUser"]>[0]) => {
    try {
      const updated = await apiPatch<User>("/api/auth/me", data);
      setUser(updated);
      return true;
    } catch {
      return false;
    }
  };

  return (
    <AuthContext.Provider
      value={{ user, loading, sessionError, login, logout, updateUser, refreshUser, setUser }}
    >
      {children}
    </AuthContext.Provider>
  );
}
