import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "@/components/ui/shared";
import { apiDelete, apiPost } from "@/lib/api";
import type { Calendar } from "@/lib/types";
import { calendarBase } from "@/components/layout/navigation";

interface CalendarActionsOptions {
  /**
   * Stay on the page after duplicating or deleting (club page, where the list updates in place)
   * instead of opening the copy / leaving for the club page.
   */
  stay?: boolean;
}

/**
 * Archive, restore, duplicate and delete one calendar (with feedback). Used by the club page
 * (calendar management) and by the archived banner of the settings pages.
 */
export function useCalendarActions(
  clubId: string,
  calendarId: string,
  calendarName?: string,
  { stay = false }: CalendarActionsOptions = {},
) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [busy, setBusy] = useState<"archive" | "unarchive" | "duplicate" | null>(null);

  const refresh = () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: ["calendar", clubId, calendarId] }),
      qc.invalidateQueries({ queryKey: ["calendars", clubId] }),
    ]);

  async function run(kind: "archive" | "unarchive", doneKey: string, failedKey: string) {
    setBusy(kind);
    try {
      await apiPost(`/api/clubs/${clubId}/calendars/${calendarId}/${kind}`, {});
      await refresh();
      toast.success(t(doneKey));
    } catch {
      toast.error(t(failedKey));
    } finally {
      setBusy(null);
    }
  }

  return {
    busy,
    archive: () => run("archive", "settings.archive.done", "settings.archive.failed"),
    unarchive: () => run("unarchive", "settings.archived.restored", "settings.archived.failed"),
    async duplicate() {
      setBusy("duplicate");
      try {
        // The copy gets its name in the UI language right away (backend default: "Copy of …").
        const name = calendarName
          ? t("settings.duplicate.copyName", { name: calendarName }).trim().slice(0, 255)
          : "";
        const copy = await apiPost<Calendar>(
          `/api/clubs/${clubId}/calendars/${calendarId}/duplicate`,
          name ? { name } : {},
        );
        await qc.invalidateQueries({ queryKey: ["calendars", clubId] });
        if (stay) {
          toast.success(t("settings.duplicate.doneStay", { name: copy.name }));
        } else {
          toast.success(t("settings.duplicate.done"));
          navigate(`${calendarBase(clubId, copy.id)}/settings`);
        }
      } catch {
        toast.error(t("settings.duplicate.failed"));
      } finally {
        setBusy(null);
      }
    },
    /** Deletes the calendar (and leaves for the club page unless `stay`); shows a toast on failure. */
    async remove() {
      try {
        await apiDelete(`/api/clubs/${clubId}/calendars/${calendarId}`);
        qc.removeQueries({ queryKey: ["calendar", clubId, calendarId] });
        await qc.invalidateQueries({ queryKey: ["calendars", clubId] });
        toast.success(t("settings.delete.done"));
        if (!stay) navigate(`/clubs/${clubId}`);
      } catch {
        toast.error(t("settings.delete.failed"));
      }
    },
  };
}
