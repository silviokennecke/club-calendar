import { useEffect, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  ApiError,
  apiGet,
  apiPatch,
  clearTokens,
  revokeRefreshToken,
  storeTokens,
  getAccessToken,
} from "./api";
import { AuthContext, type AuthContextValue } from "./auth-context";
import i18n from "./i18n";
import type { User } from "./types";

const SUPPORTED_LANGS = ["en", "de"];

function applyUserLanguage(user: User) {
  const lang = SUPPORTED_LANGS.includes(user.language) ? user.language : "en";
  i18n.changeLanguage(lang);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = getAccessToken();
    if (!token) {
      setLoading(false);
      return;
    }
    apiGet<User>("/api/auth/me")
      .then((user) => {
        applyUserLanguage(user);
        setUser(user);
      })
      .catch((err: unknown) => {
        // Only a server answer invalidates the session. A network error is no verdict: when the page is left
        // while /me is in flight (reload, address bar), the browser aborts the request, and clearing the tokens
        // then would sign the user out of the page they are going to.
        if (err instanceof ApiError) clearTokens();
        setUser(null);
      })
      .finally(() => setLoading(false));
  }, []);

  const login = (accessToken: string, refreshToken: string, user: User) => {
    storeTokens(accessToken, refreshToken);
    applyUserLanguage(user);
    setUser(user);
  };

  const logout = () => {
    // The server ends the session too (revokes the refresh token's family); the local sign-out does not wait for it.
    revokeRefreshToken();
    clearTokens();
    // Cached clubs/events of this account must not show up for the next one in the same tab.
    queryClient.clear();
    setUser(null);
  };

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
    <AuthContext.Provider value={{ user, loading, login, logout, updateUser }}>
      {children}
    </AuthContext.Provider>
  );
}
