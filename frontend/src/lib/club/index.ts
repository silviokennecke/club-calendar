// Pure club-page logic (no React): member e-mail check and error mapping.
import type { User } from "@/lib/types";

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
