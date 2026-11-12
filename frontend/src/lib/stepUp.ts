import { useSyncExternalStore } from "react";

// The step-up token proves a recent confirmation of the account holder (valid 10 minutes, not
// renewable). It lives in sessionStorage only: never in localStorage, never on the auth
// BroadcastChannel, so it belongs to this tab and ends with it.
const KEY = "cc_step_up";
/** A token that expires within this margin counts as expired (the request would race the expiry). */
const SAFETY_MARGIN_MS = 5_000;

interface Entry {
  token: string;
  exp: number;
}

/** The user closed the confirmation dialog (or the session ended while it was open). */
export class StepUpCancelledError extends Error {
  constructor() {
    super("Step-up confirmation cancelled");
    this.name = "StepUpCancelledError";
  }
}

function read(): Entry | null {
  try {
    const raw = typeof window === "undefined" ? null : sessionStorage.getItem(KEY);
    if (!raw) return null;
    const entry = JSON.parse(raw) as Partial<Entry>;
    return typeof entry.token === "string" && typeof entry.exp === "number"
      ? { token: entry.token, exp: entry.exp }
      : null;
  } catch {
    return null;
  }
}

/** Fallback when sessionStorage is unavailable: the token then lives in this module only. */
let memory: Entry | null = null;

function load(): Entry | null {
  return read() ?? memory;
}

/** The stored token, or null when there is none or it is (almost) expired. */
export function getStepUpToken(): string | null {
  const entry = load();
  if (!entry) return null;
  if (entry.exp - SAFETY_MARGIN_MS <= Date.now()) {
    removeStored();
    return null;
  }
  return entry.token;
}

export function hasValidStepUp(): boolean {
  return getStepUpToken() !== null;
}

function removeStored() {
  memory = null;
  try {
    if (typeof window !== "undefined") sessionStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}

export function setStepUpToken(token: string, expiresInSeconds: number) {
  const entry: Entry = { token, exp: Date.now() + expiresInSeconds * 1000 };
  memory = entry;
  try {
    if (typeof window !== "undefined") sessionStorage.setItem(KEY, JSON.stringify(entry));
  } catch {
    // memory fallback
  }
}

interface Waiter {
  resolve: (token: string) => void;
  reject: (error: Error) => void;
}

let waiters: Waiter[] = [];
let promptOpen = false;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

export function subscribeStepUp(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function isStepUpPrompting(): boolean {
  return promptOpen;
}

/** True while the confirmation dialog should be shown. */
export function useStepUpPrompt(): boolean {
  return useSyncExternalStore(
    subscribeStepUp,
    () => promptOpen,
    () => false,
  );
}

/**
 * Resolves with a valid step-up token. Without one the confirmation dialog opens (one dialog for any
 * number of waiting requests); rejects with `StepUpCancelledError` when the user cancels.
 */
export function ensureStepUp(): Promise<string> {
  const token = getStepUpToken();
  if (token) return Promise.resolve(token);
  return new Promise<string>((resolve, reject) => {
    waiters.push({ resolve, reject });
    if (!promptOpen) {
      promptOpen = true;
      emit();
    }
  });
}

/** The dialog got a token from `POST /api/auth/step-up`. */
export function completeStepUp(token: string, expiresInSeconds: number) {
  setStepUpToken(token, expiresInSeconds);
  const pending = waiters;
  waiters = [];
  promptOpen = false;
  pending.forEach((w) => w.resolve(token));
  emit();
}

/** The user dismissed the dialog: every waiting request fails. */
export function cancelStepUp() {
  const pending = waiters;
  waiters = [];
  promptOpen = false;
  pending.forEach((w) => w.reject(new StepUpCancelledError()));
  emit();
}

/** Logout, session end, user change, a token-version change: the token (and an open prompt) is gone. */
export function clearStepUp() {
  removeStored();
  cancelStepUp();
}
