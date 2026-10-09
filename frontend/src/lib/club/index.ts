// Pure club-page logic (no React): member e-mail check, error mapping, delete consequence.
import type { TFunction } from "i18next";
import type { Club, User } from "@/lib/types";

export type MemberProblem = "empty" | "invalid" | "duplicate";

/** E-mail check of the "Mitglied hinzufügen" form (the backend only knows existing accounts). */
export function validateMemberEmail(
  email: string,
  members: ReadonlyArray<Pick<User, "email">>,
): MemberProblem | null {
  const value = email.trim();
  if (!value) return "empty";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return "invalid";
  const lower = value.toLowerCase();
  if (members.some((m) => m.email.toLowerCase() === lower)) return "duplicate";
  return null;
}

/** Why the backend refused to add a member: no account (404) or anything else. */
export function memberAddFailure(error: unknown): "notFound" | "failed" {
  const status = (error as { status?: number } | null)?.status;
  return status === 404 ? "notFound" : "failed";
}

/** Name check of the club name and the "Kalender anlegen" forms. */
export function isBlank(value: string): boolean {
  return value.trim().length === 0;
}

/**
 * Consequence of deleting the club (design: Dialogs.dc.html "Verein löschen"), with the scope from the
 * counters of `GET /api/clubs/:id` ("… mit 2 Kalendern, 14 Terminen und 2 Feeds …").
 */
export function clubDeleteConsequence(club: Club, t: TFunction): string {
  if (club.eventCount === undefined || club.feedCount === undefined) {
    return t("club.danger.consequence");
  }
  const calendars = (club.calendarCount ?? 0) + (club.archivedCalendarCount ?? 0);
  return t("club.danger.consequenceCounts", {
    calendars: t("club.danger.count.calendars", { count: calendars }),
    events: t("club.danger.count.events", { count: club.eventCount }),
    feeds: t("club.danger.count.feeds", { count: club.feedCount }),
  });
}
