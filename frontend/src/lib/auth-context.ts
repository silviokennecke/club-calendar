import { createContext, useContext } from "react";
import type { User } from "./types";

export interface AuthContextValue {
  user: User | null;
  loading: boolean;
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
