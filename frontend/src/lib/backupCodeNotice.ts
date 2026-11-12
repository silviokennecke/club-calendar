import { useSyncExternalStore } from "react";

// In memory on purpose: the notice belongs to the sign-in that just happened and must not come back
// after a reload.
let pending: { userId: string; remaining: number } | null = null;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

export function announceBackupCodeUsed(userId: string, remaining: number) {
  pending = { userId, remaining };
  emit();
}

export function dismissBackupCodeNotice() {
  pending = null;
  emit();
}

/** Drops a notice that was announced for another user than the signed-in one (or for nobody). */
export function dropBackupCodeNoticeUnless(userId: string | undefined) {
  if (pending && pending.userId !== userId) dismissBackupCodeNotice();
}

export function usePendingBackupCodeNotice() {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => pending,
  );
}
