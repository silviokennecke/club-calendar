import { useEffect, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { apiPost } from "@/lib/api";
import type { ConflictCheck, ConflictRequest } from "@/lib/events";

const DEBOUNCE_MS = 400;

/** Debounced live check of a resource's bookings; no request while `request` is null. */
export function useEventConflicts(calendarId: string, request: ConflictRequest | null) {
  const key = request ? JSON.stringify(request) : null;
  const [settled, setSettled] = useState(key);
  useEffect(() => {
    if (key === null) {
      setSettled(null);
      return;
    }
    const id = setTimeout(() => setSettled(key), DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [key]);

  const query = useQuery({
    queryKey: ["resourceConflicts", calendarId, settled],
    queryFn: () =>
      apiPost<ConflictCheck>(
        `/api/calendars/${calendarId}/events/conflicts`,
        JSON.parse(settled!) as ConflictRequest,
      ),
    enabled: settled !== null && settled === key,
    placeholderData: keepPreviousData,
    retry: false,
    staleTime: 0,
  });
  const conflicts =
    key === null ? [] : Array.isArray(query.data?.conflicts) ? query.data.conflicts : [];
  return { conflicts, blocking: key !== null && query.data?.blocking === true };
}
