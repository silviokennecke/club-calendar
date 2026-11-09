import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { apiGet } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { pickCalendar } from "@/lib/pickCalendar";
import { isPlainMember } from "@/lib/club/permissions";
import { myClubPath } from "@/lib/club/myClub";
import type { Calendar, Club } from "@/lib/types";

/**
 * Switches to a club the user has just joined (accepted invitation): refreshes the club list, remembers the
 * club as "last used" and opens its calendar (the club page when it has none or they cannot be loaded).
 */
export function useEnterClub() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { updateUser } = useAuth();

  return async function enterClub(clubId: string): Promise<void> {
    await qc.invalidateQueries({ queryKey: ["clubs"] });
    const clubs = await qc
      .fetchQuery({ queryKey: ["clubs"], queryFn: () => apiGet<Club[]>("/api/clubs") })
      .catch(() => undefined);
    if (isPlainMember(clubs?.find((c) => c.id === clubId)?.role)) {
      void updateUser({ lastClubId: clubId, lastCalendarId: null });
      navigate(myClubPath(clubId), { replace: true });
      return;
    }
    let calendar: Calendar | undefined;
    try {
      // Same query key as the club picker and the shell: the list is shared.
      const list = await qc.fetchQuery({
        queryKey: ["calendars", clubId, "all"],
        queryFn: () => apiGet<Calendar[]>(`/api/clubs/${clubId}/calendars?includeArchived=true`),
      });
      calendar = pickCalendar(list, clubId);
    } catch {
      calendar = undefined;
    }
    void updateUser({ lastClubId: clubId, lastCalendarId: calendar?.id ?? null });
    navigate(calendar ? `/clubs/${clubId}/calendars/${calendar.id}` : `/clubs/${clubId}`, {
      replace: true,
    });
  };
}
