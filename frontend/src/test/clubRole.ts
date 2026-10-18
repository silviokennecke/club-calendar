import type { Mock } from "vitest";
import type { ClubRole } from "@/lib/types";

/**
 * `apiGet` mock that also answers `GET /api/clubs` with club `c1` in which the signed-in user has
 * `role` (default admin), so pages gated by the club role show their write controls.
 */
export function mockApiGet(
  apiGet: Mock,
  impl: (path: string, ...rest: unknown[]) => unknown,
  role: ClubRole = "admin",
) {
  apiGet.mockImplementation((path: string, ...rest: unknown[]) =>
    path === "/api/clubs"
      ? Promise.resolve([{ id: "c1", name: "Schützenverein", timezone: "Europe/Berlin", role }])
      : impl(path, ...rest),
  );
}
