import type { Calendar, Club } from "@/lib/types";

/** Data the presentational shell parts (Sidebar, Topbar, Tabbar, MorePage) need. */
export interface ShellData {
  clubs: Club[];
  calendars: Calendar[];
  clubId: string;
  /** Null while the club's calendars are loading or when the club has none. */
  calendarId: string | null;
  userName: string;
  onSelectClub: (clubId: string) => void;
  onLogout: () => void;
}
