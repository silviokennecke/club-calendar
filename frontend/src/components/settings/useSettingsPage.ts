import { useOutletContext } from "react-router-dom";
import { useEventPage } from "@/components/events/useEventPage";
import type { ShellData } from "@/components/layout/shellTypes";

/** Shared context of the settings pages: ids, calendar, club and whether the calendar is read-only. */
export function useSettingsPage() {
  const page = useEventPage();
  const shell = useOutletContext<ShellData | undefined>();
  const club = shell?.clubs.find((c) => c.id === page.clubId);
  return {
    ...page,
    club,
    /** Archived calendars and viewers see their settings read-only. */
    readOnly: page.readOnly,
  };
}
