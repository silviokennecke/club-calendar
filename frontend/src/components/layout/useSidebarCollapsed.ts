import { useSyncExternalStore } from "react";

const KEY = "sidebar_collapsed";
const listeners = new Set<() => void>();
// Fallback when localStorage is unavailable (private window, blocked site data).
let memory = false;

function read(): boolean {
  try {
    const v = localStorage.getItem(KEY);
    return v === null ? memory : v === "1";
  } catch {
    return memory;
  }
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  const onStorage = (e: StorageEvent) => {
    if (e.key === KEY || e.key === null) cb();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", onStorage);
  };
}

function write(value: boolean) {
  memory = value;
  try {
    localStorage.setItem(KEY, value ? "1" : "0");
  } catch {
    /* works without persistence */
  }
  listeners.forEach((cb) => cb());
}

/** Collapsed state of the desktop sidebar, kept per browser and shared by the sidebar and the shell. */
export function useSidebarCollapsed(): [boolean, (value: boolean) => void] {
  const collapsed = useSyncExternalStore(subscribe, read, () => false);
  return [collapsed, write];
}
