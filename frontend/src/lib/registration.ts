import { useQuery } from "@tanstack/react-query";
import { apiGet } from "@/lib/api";

export interface RegistrationInfo {
  /** true: new accounts only for addresses with an open club invitation. */
  restricted: boolean;
  /** false: only the operator creates clubs (RESTRICT_CLUB_CREATION). */
  clubCreationAllowed?: boolean;
}

export const registrationKeys = { info: ["auth", "registration"] as const };

/** Public: is registration restricted to invited addresses? Failure = treated as unrestricted. */
export function useRegistrationInfo() {
  return useQuery({
    queryKey: registrationKeys.info,
    queryFn: () => apiGet<RegistrationInfo>("/api/auth/registration"),
    staleTime: 5 * 60_000,
    retry: false,
  });
}

/** Unknown (loading, failed request) counts as allowed; the backend enforces it anyway. */
export function useClubCreationAllowed() {
  const { data, isLoading } = useRegistrationInfo();
  return { allowed: data?.clubCreationAllowed !== false, loading: isLoading };
}
