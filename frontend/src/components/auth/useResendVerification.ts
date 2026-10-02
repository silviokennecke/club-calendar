import { useState } from "react";
import { apiFetch } from "@/lib/api";

/**
 * Requests a new verification mail. The server answers 204 regardless of whether the
 * address exists (no account enumeration), so failures are treated as "sent" as before.
 */
export function useResendVerification() {
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  async function resend(email: string) {
    setLoading(true);
    try {
      await apiFetch("/api/auth/resend-verification", {
        method: "POST",
        body: JSON.stringify({ email }),
      });
    } catch {
      // intentionally ignored
    } finally {
      setLoading(false);
      setDone(true);
    }
  }

  return { resend, loading, done, reset: () => setDone(false) };
}
