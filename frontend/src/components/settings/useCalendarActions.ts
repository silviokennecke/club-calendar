import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "@/components/ui/shared";
import { apiDelete, apiPatch, apiPost } from "@/lib/api";
import type { Calendar } from "@/lib/types";
import { calendarBase } from "@/components/layout/navigation";

/** Archive, restore, duplicate and delete the calendar of the settings pages (with feedback). */
export function useCalendarActions(clubId: string, calendarId: string, calendarName?: string) {
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
        const copy = await apiPost<Calendar>(
          `/api/clubs/${clubId}/calendars/${calendarId}/duplicate`,
          {},
        );
        // The backend names the copy "Copy of …"; give it a name in the UI language.
        const name = t("settings.duplicate.copyName", { name: calendarName ?? "" }).trim();
        if (calendarName && name) {
          await apiPatch(`/api/clubs/${clubId}/calendars/${copy.id}`, { name }).catch(
            () => undefined,
          );
        }
        await qc.invalidateQueries({ queryKey: ["calendars", clubId] });
        toast.success(t("settings.duplicate.done"));
        navigate(`${calendarBase(clubId, copy.id)}/settings`);
      } catch {
        toast.error(t("settings.duplicate.failed"));
      } finally {
        setBusy(null);
      }
    },
    /** Deletes the calendar and leaves for the club page; throws nothing (shows a toast). */
    async remove() {
      try {
        await apiDelete(`/api/clubs/${clubId}/calendars/${calendarId}`);
        qc.removeQueries({ queryKey: ["calendar", clubId, calendarId] });
        await qc.invalidateQueries({ queryKey: ["calendars", clubId] });
        toast.success(t("settings.delete.done"));
        navigate(`/clubs/${clubId}`);
      } catch {
        toast.error(t("settings.delete.failed"));
      }
    },
  };
}
