import { useCallback } from "react";
import { opaqueReauth, type ReauthPurpose } from "./client";

/** Returns a function that proves the password for `purpose` and resolves with the one-time ticket. */
export function useReauth(purpose: ReauthPurpose): (password: string) => Promise<string> {
  return useCallback((password: string) => opaqueReauth(purpose, password), [purpose]);
}
