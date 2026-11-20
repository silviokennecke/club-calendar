import { useContext, useState } from "react";
import { AuthContext } from "@/lib/auth-context";
import { getRecentIds, recordRecent } from "./recent";

/** Recent assignments of the signed-in user for one club (audiences) and calendar (extras, badges). */
export function useRecentSelections(clubId: string, calendarId: string) {
  const userId = useContext(AuthContext)?.user?.id;
  const [recent] = useState(() => ({
    targetGroups: userId ? getRecentIds(userId, "targetGroups", clubId) : [],
    features: userId ? getRecentIds(userId, "features", calendarId) : [],
    properties: userId ? getRecentIds(userId, "properties", calendarId) : [],
  }));

  /** Call after a successful save; `before` = what the event had assigned already. */
  function record(
    now: { targetGroupIds: string[]; featureIds: string[]; propertyIds: string[] },
    before?: { targetGroupIds: string[]; featureIds: string[]; propertyIds: string[] },
  ) {
    if (!userId) return;
    const added = (a: string[], b?: string[]) => a.filter((id) => !b?.includes(id));
    recordRecent(userId, "targetGroups", clubId, added(now.targetGroupIds, before?.targetGroupIds));
    recordRecent(userId, "features", calendarId, added(now.featureIds, before?.featureIds));
    recordRecent(userId, "properties", calendarId, added(now.propertyIds, before?.propertyIds));
  }

  return { recent, record };
}
