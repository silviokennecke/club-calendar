let sessionEnded = false;

/**
 * True once the session was rejected (refresh failed) and the page is on its way to the login page:
 * the unsaved-changes guard must not hold this navigation (nothing can be saved without a session).
 */
export function isSessionEnded(): boolean {
  return sessionEnded;
}

export function markSessionEnded() {
  sessionEnded = true;
}
