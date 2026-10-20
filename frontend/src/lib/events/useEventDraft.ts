import { useCallback, useContext, useEffect, useRef, useState } from "react";
import { AuthContext } from "@/lib/auth-context";
import { draftKey, isFormDirty, loadDraft, removeDraft, saveDraft } from "@/lib/events";
import type { EventFormValues } from "@/lib/events";

export const DRAFT_DEBOUNCE_MS = 1000;

/**
 * Autosaves the event form as a local draft (debounced, only with user changes). A stored draft that
 * differs from the initial values is offered through `pending`; nothing is applied automatically.
 */
export function useEventDraft(
  calendarId: string,
  eventId: string | null,
  initial: EventFormValues,
  values: EventFormValues,
  enabled: boolean,
) {
  const userId = useContext(AuthContext)?.user?.id;
  const key = enabled && userId ? draftKey(userId, calendarId, eventId) : null;
  const [pending, setPending] = useState<EventFormValues | null>(() => {
    if (!key) return null;
    const stored = loadDraft(key);
    return stored && isFormDirty(initial, stored) ? stored : null;
  });
  const stopped = useRef(false);

  const dirty = isFormDirty(initial, values);
  useEffect(() => {
    if (!key || pending || stopped.current) return;
    if (!dirty) {
      removeDraft(key);
      return;
    }
    const timer = setTimeout(() => {
      if (!stopped.current) saveDraft(key, values);
    }, DRAFT_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [key, pending, dirty, values]);

  /** Deletes the draft for good (saved, deleted or deliberately discarded). */
  const clear = useCallback(() => {
    stopped.current = true;
    setPending(null);
    if (key) removeDraft(key);
  }, [key]);

  return {
    pending,
    /** Hands the draft over for filling the form and hides the banner. */
    takePending: () => {
      const draft = pending;
      setPending(null);
      return draft;
    },
    discardPending: () => {
      setPending(null);
      if (key) removeDraft(key);
    },
    clear,
  };
}
