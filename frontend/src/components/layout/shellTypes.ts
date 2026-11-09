import type { Calendar, Club, ClubRole } from "@/lib/types";

/** Data the presentational shell parts (Sidebar, Topbar, Tabbar, MorePage) need. */
export interface ShellData {
  clubs: Club[];
  calendars: Calendar[];
  clubId: string;
  /** Null while the club's calendars are loading or when the club has none. */
  calendarId: string | null;
  /**
   * `unavailable`: the club or its calendars cannot be loaded (unknown id, no access, error), so the
   * switchers show "Nicht verfügbar" with a way back to the club picker instead of "Laden…" forever.
   * Missing = ready.
   */
  contextState?: "loading" | "ready" | "unavailable";
  /** Role in the active club (undefined while the club list loads). A plain `member` has no calendars. */
  role?: ClubRole;
  userName: string;
  onSelectClub: (clubId: string) => void;
  onLogout: () => void;
}
