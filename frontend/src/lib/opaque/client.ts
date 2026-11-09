import { ApiError, apiPost, type TokenResponse } from "@/lib/api";
import { passwordProblem } from "@/lib/password";
import { callOpaque } from "./engine";
import { ksfConfig } from "./ksf";

export type ReauthPurpose =
  "delete-account" | "passkey-register" | "change-email" | "change-password";

const BASE = "/api/auth/opaque";

/** The 8-128 policy is enforced by the client only (the server never sees the password). */
export function assertPasswordPolicy(password: string): void {
  if (passwordProblem(password)) {
    throw new ApiError("Password does not meet the policy", 422, "validation_failed", "password");
  }
}

const wrongPassword = () =>
  new ApiError("Invalid credentials", 401, "invalid_credentials", "password");

interface LoginStart {
  loginResponse: string;
  loginState: string;
  ksfProfile: string;
}

/** KE1 -> server -> KE2 -> local KSF -> KE3. Wrong password and unknown account look the same. */
async function loginRounds(
  password: string,
  start: (startLoginRequest: string) => Promise<LoginStart>,
): Promise<{ loginState: string; finishLoginRequest: string }> {
  const s1 = await callOpaque<{ clientLoginState: string; startLoginRequest: string }>({
    op: "startLogin",
    password,
  });
  const res = await start(s1.startLoginRequest);
  const ksf = ksfConfig(res.ksfProfile);
  const s2 = await callOpaque<{ finishLoginRequest: string } | null>({
    op: "finishLogin",
    password,
    clientLoginState: s1.clientLoginState,
    loginResponse: res.loginResponse,
    ksf,
  });
  if (!s2) throw wrongPassword();
  return { loginState: res.loginState, finishLoginRequest: s2.finishLoginRequest };
}

export async function opaqueLogin(email: string, password: string): Promise<TokenResponse> {
  const { loginState, finishLoginRequest } = await loginRounds(password, (startLoginRequest) =>
    apiPost<LoginStart>(`${BASE}/login/start`, { email, startLoginRequest }),
  );
  return apiPost<TokenResponse>(`${BASE}/login/finish`, { loginState, finishLoginRequest });
}

/** Re-authentication: resolves with the single-use `reauthTicket` (5 min). Wrong password: `invalid_credentials`. */
export async function opaqueReauth(purpose: ReauthPurpose, password: string): Promise<string> {
  const { loginState, finishLoginRequest } = await loginRounds(password, (startLoginRequest) =>
    apiPost<LoginStart>(`${BASE}/reauth/start`, { purpose, startLoginRequest }),
  );
  const res = await apiPost<{ reauthTicket: string; expiresIn: number }>(`${BASE}/reauth/finish`, {
    purpose,
    loginState,
    finishLoginRequest,
  });
  return res.reauthTicket;
}

/** Exactly one of these selects the registration context (the server rejects zero or several). */
export type RegisterContext =
  { email: string } | { resetToken: string } | { reauthTicket: string } | { upgradeTicket: string };

interface RegisterStart {
  registrationResponse: string;
  registrationState: string;
}

/** Profile used for new records; login uses whatever the server stored/announces (`ksfProfile`). */
export const REGISTRATION_PROFILE = "memory-constrained";

async function registerOnce<T>(
  password: string,
  ctx: RegisterContext,
  extra: Record<string, unknown>,
): Promise<T> {
  const s1 = await callOpaque<{ clientRegistrationState: string; registrationRequest: string }>({
    op: "startRegistration",
    password,
  });
  const start = await apiPost<RegisterStart>(`${BASE}/register/start`, {
    ...ctx,
    registrationRequest: s1.registrationRequest,
  });
  // register/start announces no profile: new records use the client's current default.
  const s2 = await callOpaque<{ registrationRecord: string }>({
    op: "finishRegistration",
    password,
    clientRegistrationState: s1.clientRegistrationState,
    registrationResponse: start.registrationResponse,
    ksf: ksfConfig(REGISTRATION_PROFILE),
  });
  // signup is selected by the absence of a ticket/token; its address only goes to start
  const finishCtx = "email" in ctx ? {} : ctx;
  return apiPost<T>(`${BASE}/register/finish`, {
    ...finishCtx,
    ...extra,
    registrationState: start.registrationState,
    registrationRecord: s2.registrationRecord,
  });
}

/** Both rounds; a stale state (409 `opaque_state_invalid`, e.g. key rotation) restarts once from register/start. */
async function register<T>(
  password: string,
  ctx: RegisterContext,
  extra: Record<string, unknown> = {},
): Promise<T> {
  assertPasswordPolicy(password);
  try {
    return await registerOnce<T>(password, ctx, extra);
  } catch (e) {
    if (e instanceof ApiError && e.code === "opaque_state_invalid") {
      return registerOnce<T>(password, ctx, extra);
    }
    throw e;
  }
}

export interface SignupResult extends TokenResponse {
  verificationRequired: boolean;
  email: string;
}

export function opaqueSignup(
  email: string,
  password: string,
  details: { name: string; language?: string | null; acceptedDocuments: string[] },
): Promise<SignupResult> {
  return register<SignupResult>(password, { email }, details);
}

export async function opaqueReset(resetToken: string, password: string): Promise<void> {
  await register<void>(password, { resetToken });
}

/** Needs a `change-password` ticket from `opaqueReauth`; ends the other sessions, returns a new token pair. */
export function opaqueChangePassword(
  reauthTicket: string,
  password: string,
): Promise<TokenResponse> {
  return register<TokenResponse>(password, { reauthTicket });
}

export async function opaqueUpgrade(upgradeTicket: string, password: string): Promise<void> {
  await register<void>(password, { upgradeTicket });
}
