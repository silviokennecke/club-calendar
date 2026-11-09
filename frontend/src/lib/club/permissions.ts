// Club role checks (member < viewer < editor < admin). The role comes from `GET /api/clubs/:id` (`role` of the
// signed-in user), read through the shared ["club", clubId] query, so no extra request is made.
//
//   const { role, canEdit, isAdmin } = useClubPermissions(clubId);
//   canEdit: editor or admin (may write events, calendars, reference data); isAdmin: manages members/invitations.
//   While the club is loading (or the role is unknown) role is undefined and both flags are false.
import { useQuery } from "@tanstack/react-query";
import { apiGet } from "@/lib/api";
import type { Club, ClubRole } from "@/lib/types";

const RANK: Record<ClubRole, number> = { member: 0, viewer: 1, editor: 2, admin: 3 };

export const CLUB_ROLES: readonly ClubRole[] = ["member", "viewer", "editor", "admin"];

/** True if `role` is at least `required`; an unknown role (undefined) never is. */
export function roleAtLeast(role: ClubRole | undefined | null, required: ClubRole): boolean {
  return role != null && RANK[role] >= RANK[required];
}

/** Staff = viewer or above; a plain `member` only reaches their own club area ("Mein Verein"). */
export function isStaff(role: ClubRole | undefined | null): boolean {
  return roleAtLeast(role, "viewer");
}

/** Role `member`: reads nothing of the club's calendars and settings (the API answers 403). */
export function isPlainMember(role: ClubRole | undefined | null): boolean {
  return role === "member";
}

export interface ClubPermissions {
  role: ClubRole | undefined;
  isStaff: boolean;
  canEdit: boolean;
  isAdmin: boolean;
}

export function permissionsFor(role: ClubRole | undefined | null): ClubPermissions {
  return {
    role: role ?? undefined,
    isStaff: isStaff(role),
    canEdit: roleAtLeast(role, "editor"),
    isAdmin: roleAtLeast(role, "admin"),
  };
}

export function useClubPermissions(clubId: string | undefined): ClubPermissions {
  const club = useQuery<Club>({
    queryKey: ["club", clubId],
    queryFn: () => apiGet<Club>(`/api/clubs/${clubId}`),
    enabled: !!clubId,
    retry: false,
  });
  return permissionsFor(club.data?.role);
}
