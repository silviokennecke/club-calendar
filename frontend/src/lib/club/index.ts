// Pure club-page logic (no React): invite e-mail check, error mapping, delete consequence.
import type { TFunction } from "i18next";
import type { Club, User } from "@/lib/types";

/** E-mail check of the "Per E-Mail einladen" form (members cannot be invited again). */
export function validateMemberEmail(
  email: string,
  members: ReadonlyArray<Pick<User, "email">>,
): "empty" | "invalid" | "duplicate" | null {
  const value = email.trim();
  if (!value) return "empty";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return "invalid";
  const lower = value.toLowerCase();
  if (members.some((m) => m.email.toLowerCase() === lower)) return "duplicate";
  return null;
}

/**
 * Removing a member failed because the user is no member (any more): 404 `member_not_found`, e.g. someone
 * else removed them meanwhile. Matched by the stable code, never the message.
 */
export function isMemberGone(error: unknown): boolean {
  return (error as { code?: unknown } | null)?.code === "member_not_found";
}

/** Removing a member / leaving was refused: the user is the only member (422 `last_member`). */
export function isLastMember(error: unknown): boolean {
  return (error as { code?: unknown } | null)?.code === "last_member";
}

/** Removing / demoting / leaving was refused: the user is the only admin of a club with other members (422 `last_admin`). */
export function isLastAdmin(error: unknown): boolean {
  return (error as { code?: unknown } | null)?.code === "last_admin";
}

/** The role is not one of viewer|editor|admin (422 `invalid_role`). */
export function isInvalidRole(error: unknown): boolean {
  return (error as { code?: unknown } | null)?.code === "invalid_role";
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
