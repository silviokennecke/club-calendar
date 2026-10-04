import { useEffect, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { apiGet, apiPatch, clearTokens, storeTokens, getAccessToken } from "./api";
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
      .catch(() => {
        clearTokens();
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
