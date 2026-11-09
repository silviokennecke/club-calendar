import type { KsfConfig } from "./core";

// Profiles the server may announce; anything else is rejected (no silent downgrade).
// Same parameters must be used at registration and login (docs/ops/OPAQUE-SPIKE.md 2.2).
const PROFILES: Record<string, KsfConfig> = {
  "memory-constrained": "memory-constrained",
};

export class OpaqueClientError extends Error {
  code: "invalid_ksf_profile" | "opaque_unsupported";
  constructor(code: OpaqueClientError["code"], message: string) {
    super(message);
    this.name = "OpaqueClientError";
    this.code = code;
  }
}

export function ksfConfig(profile: unknown): KsfConfig {
  const config = typeof profile === "string" ? PROFILES[profile] : undefined;
  if (!config || !Object.prototype.hasOwnProperty.call(PROFILES, profile as string)) {
    throw new OpaqueClientError("invalid_ksf_profile", "Unknown key stretching profile");
  }
  return config;
}
