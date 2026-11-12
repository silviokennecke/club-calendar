import { useSyncExternalStore } from "react";

// In memory on purpose: the notice belongs to the sign-in that just happened and must not come back
// after a reload.
let pending: { remaining: number } | null = null;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

export function announceBackupCodeUsed(remaining: number) {
  pending = { remaining };
  emit();
}

export function dismissBackupCodeNotice() {
  pending = null;
  emit();
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
