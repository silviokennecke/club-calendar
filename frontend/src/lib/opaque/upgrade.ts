import { opaqueUpgrade } from "./client";

/** Offered by a legacy login (`opaqueUpgrade` in the token response). */
export interface OpaqueUpgradeOffer {
  ticket: string;
  expiresIn: number;
}

/**
 * Silently moves a legacy account to OPAQUE with the password just typed (kept in memory only, never stored).
 * Runs after the caller navigated; any failure leaves everything as it was and the next login tries again.
 */
export function startOpaqueUpgrade(offer: OpaqueUpgradeOffer | undefined, password: string): void {
  if (!offer?.ticket || !password) return;
  setTimeout(() => {
    opaqueUpgrade(offer.ticket, password).catch((err: unknown) => {
      if (import.meta.env.DEV) console.debug("OPAQUE upgrade failed", err);
    });
  }, 0);
}
