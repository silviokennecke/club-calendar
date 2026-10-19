import { createContext, useContext } from "react";
import type { User } from "./types";

export interface AuthContextValue {
  user: User | null;
  loading: boolean;
  /** Tokens exist but /me failed for a reason that is no rejection (network, 429, 5xx): not a guest. */
  sessionError: boolean;
  /** Loads /api/auth/me again (e.g. after a 403 `consent_required`); keeps the current user on failure. */
  refreshUser: () => Promise<void>;
  /** Replaces the current user with a fresh /me body (e.g. the answer of `POST /api/auth/consents`). */
  setUser: (user: User) => void;
  login: (accessToken: string, refreshToken: string, user: User) => void;
  logout: () => void;
  updateUser: (data: {
    name?: string;
    lastClubId?: string | null;
    lastCalendarId?: string | null;
    dateFormat?: string;
    language?: string;
    firstDayOfWeek?: number;
  }) => Promise<boolean>;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
