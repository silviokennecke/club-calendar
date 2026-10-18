// Club role checks (viewer < editor < admin). The role comes from `GET /api/clubs/:id` (`role` of the
// signed-in user), read through the shared ["club", clubId] query, so no extra request is made.
//
//   const { role, canEdit, isAdmin } = useClubPermissions(clubId);
//   canEdit: editor or admin (may write events, calendars, reference data); isAdmin: manages members/invitations.
//   While the club is loading (or the role is unknown) role is undefined and both flags are false.
import { useQuery } from "@tanstack/react-query";
import { apiGet } from "@/lib/api";
import type { Club, ClubRole } from "@/lib/types";

const RANK: Record<ClubRole, number> = { viewer: 0, editor: 1, admin: 2 };

export const CLUB_ROLES: readonly ClubRole[] = ["viewer", "editor", "admin"];

/** True if `role` is at least `required`; an unknown role (undefined) never is. */
export function roleAtLeast(role: ClubRole | undefined | null, required: ClubRole): boolean {
  return role != null && RANK[role] >= RANK[required];
}

export interface ClubPermissions {
  role: ClubRole | undefined;
  canEdit: boolean;
  isAdmin: boolean;
}

export function permissionsFor(role: ClubRole | undefined | null): ClubPermissions {
  return {
    role: role ?? undefined,
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
