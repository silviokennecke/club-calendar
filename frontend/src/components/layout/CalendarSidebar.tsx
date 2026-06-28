import { useEffect, useRef } from "react";
import { Link, useNavigate, useLocation } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { apiGet } from "@/lib/api";
import type { Calendar, Club } from "@/lib/types";
import { useAuth } from "@/lib/auth-context";
import { cn } from "@/lib/utils";
import {
  CalendarDays,
  Settings,
  LayoutTemplate,
  LogOut,
  Palette,
  Tag,
  Users,
  MapPin,
  Rss,
  User,
  List,
  ChevronDown,
  Users2,
  Sun,
} from "lucide-react";

interface Props {
  clubId: string;
  calendarId: string;
}

interface NavItem {
  label: string;
  href: string;
  icon: React.ElementType;
  exact?: boolean;
}

export default function CalendarSidebar({ clubId, calendarId }: Props) {
  const location = useLocation();
  const pathname = location.pathname;
  const navigate = useNavigate();
  const { logout, updateUser } = useAuth();
  const { t } = useTranslation();
  const trackedRef = useRef<string>("");

  const base = `/clubs/${clubId}/calendars/${calendarId}`;

  // Track last-used club/calendar (debounced — fire only when the clubId+calendarId pair changes)
  useEffect(() => {
    const key = `${clubId}-${calendarId}`;
    if (trackedRef.current === key) return;
    trackedRef.current = key;
    updateUser({ lastClubId: clubId, lastCalendarId: calendarId });
  }, [clubId, calendarId]); // eslint-disable-line react-hooks/exhaustive-deps

  const { data: clubs = [] } = useQuery<Club[]>({
    queryKey: ["clubs"],
    queryFn: () => apiGet("/api/clubs"),
  });

  const { data: calendars = [], isLoading: calendarsLoading } = useQuery<Calendar[]>({
    queryKey: ["calendars", clubId],
    queryFn: () => apiGet(`/api/clubs/${clubId}/calendars`),
  });

  // If the current club has no calendars, send the user to setup to create one
  useEffect(() => {
    if (calendarsLoading || calendars.length > 0) return;
    navigate(`/setup?clubId=${clubId}`, { replace: true });
  }, [calendars, calendarsLoading, navigate, clubId]);

  async function handleClubChange(newClubId: string) {
    if (newClubId === clubId) return;
    const cals = await apiGet<Calendar[]>(`/api/clubs/${newClubId}/calendars`);
    if (cals.length > 0) {
      navigate(`/clubs/${newClubId}/calendars/${cals[0].id}`);
    } else {
      navigate("/setup");
    }
  }

  function handleCalendarChange(newCalendarId: string) {
    if (newCalendarId === calendarId) return;
    navigate(`/clubs/${clubId}/calendars/${newCalendarId}`);
  }

  const mainNav: NavItem[] = [
    { label: t("nav.calendar"), href: base, icon: CalendarDays, exact: true },
    { label: t("nav.events"), href: `${base}/events`, icon: List },
    { label: t("nav.templates"), href: `${base}/templates`, icon: LayoutTemplate },
  ];

  const settingsNav: NavItem[] = [
    { label: t("nav.general"), href: `${base}/settings`, icon: Settings, exact: true },
    { label: t("nav.feeds"), href: `${base}/settings/feeds`, icon: Rss },
    { label: t("nav.properties"), href: `${base}/settings/properties`, icon: Palette },
    { label: t("nav.features"), href: `${base}/settings/features`, icon: Tag },
    { label: t("nav.targetGroups"), href: `${base}/settings/target-groups`, icon: Users },
    { label: t("nav.locations"), href: `${base}/settings/locations`, icon: MapPin },
    { label: t("nav.holidays"), href: `${base}/settings/holiday-calendars`, icon: Sun },
    { label: t("nav.clubSettings"), href: `/clubs/${clubId}`, icon: Users2, exact: true },
  ];

  function isActive(item: NavItem) {
    if (item.exact) return pathname === item.href;
    return pathname.startsWith(item.href);
  }

  const currentClub = clubs.find((c) => String(c.id) === clubId);
  const currentCalendar = calendars.find((c) => String(c.id) === calendarId);

  return (
    <div className="flex min-h-screen w-56 shrink-0 flex-col border-r border-slate-200 bg-white">
      {/* Club + Calendar selectors */}
      <div className="space-y-2 border-b border-slate-100 p-3">
        {/* Club selector */}
        <div className="relative">
          <label className="px-1 text-[10px] font-medium tracking-wider text-slate-400 uppercase">
            {t("nav.club")}
          </label>
          <div className="relative mt-0.5">
            <select
              value={clubId}
              onChange={(e) => handleClubChange(e.target.value)}
              className="w-full cursor-pointer appearance-none rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 pr-7 text-sm font-medium text-slate-900 transition-colors hover:border-slate-300 focus:border-blue-300 focus:ring-2 focus:ring-blue-500/20 focus:outline-none"
            >
              {clubs.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
              {clubs.length === 0 && (
                <option value={clubId}>{currentClub?.name ?? t("common.loading")}</option>
              )}
            </select>
            <ChevronDown className="pointer-events-none absolute top-1/2 right-2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
          </div>
        </div>

        {/* Calendar selector */}
        <div className="relative">
          <label className="px-1 text-[10px] font-medium tracking-wider text-slate-400 uppercase">
            {t("nav.calendar")}
          </label>
          <div className="relative mt-0.5">
            <select
              value={calendarId}
              onChange={(e) => handleCalendarChange(e.target.value)}
              className="w-full cursor-pointer appearance-none rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 pr-7 text-sm font-medium text-slate-900 transition-colors hover:border-slate-300 focus:border-blue-300 focus:ring-2 focus:ring-blue-500/20 focus:outline-none"
            >
              {calendars.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
              {calendars.length === 0 && (
                <option value={calendarId}>{currentCalendar?.name ?? t("common.loading")}</option>
              )}
            </select>
            <ChevronDown className="pointer-events-none absolute top-1/2 right-2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
          </div>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 p-2">
        <div className="space-y-0.5">
          {mainNav.map((item) => (
            <Link
              key={item.href}
              to={item.href}
              className={cn(
                "flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors",
                isActive(item)
                  ? "bg-blue-50 font-medium text-blue-700"
                  : "text-slate-600 hover:bg-slate-50 hover:text-slate-900",
              )}
            >
              <item.icon className="h-4 w-4 shrink-0" />
              {item.label}
            </Link>
          ))}
        </div>

        <div className="mt-4">
          <p className="px-3 py-1.5 text-xs font-medium tracking-wider text-slate-400 uppercase">
            {t("nav.settings")}
          </p>
          <div className="space-y-0.5">
            {settingsNav.map((item) => (
              <Link
                key={item.href}
                to={item.href}
                className={cn(
                  "flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors",
                  isActive(item)
                    ? "bg-blue-50 font-medium text-blue-700"
                    : "text-slate-600 hover:bg-slate-50 hover:text-slate-900",
                )}
              >
                <item.icon className="h-4 w-4 shrink-0" />
                {item.label}
              </Link>
            ))}
          </div>
        </div>
      </nav>

      {/* Footer */}
      <div className="space-y-0.5 border-t border-slate-100 p-3">
        <Link
          to="/profile"
          className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-xs text-slate-400 transition-colors hover:text-slate-600"
        >
          <User className="h-3.5 w-3.5" /> {t("nav.profile")}
        </Link>
        <button
          onClick={logout}
          className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-xs text-slate-400 transition-colors hover:text-slate-600"
        >
          <LogOut className="h-3.5 w-3.5" /> {t("auth.signOut")}
        </button>
      </div>
    </div>
  );
}
