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
  registrationState?: string;
}

/** Registration rounds; `ctx` goes into start, `finishCtx` (state or the same ticket/token) into finish. */
async function registerRounds(
  password: string,
  ctx: RegisterContext,
  finishCtx: (start: RegisterStart) => Record<string, unknown>,
  extra: Record<string, unknown> = {},
) {
  assertPasswordPolicy(password);
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
  return {
    body: { ...finishCtx(start), ...extra, registrationRecord: s2.registrationRecord },
  };
}

/** Profile used for new records; login uses whatever the server stored/announces (`ksfProfile`). */
export const REGISTRATION_PROFILE = "memory-constrained";

export interface SignupResult extends TokenResponse {
  verificationRequired: boolean;
  email: string;
}

export async function opaqueSignup(
  email: string,
  password: string,
  details: { name: string; language?: string | null; acceptedDocuments: string[] },
): Promise<SignupResult> {
  const { body } = await registerRounds(
    password,
    { email },
    (s) => ({ registrationState: s.registrationState }),
    details,
  );
  return apiPost<SignupResult>(`${BASE}/register/finish`, body);
}

export async function opaqueReset(resetToken: string, password: string): Promise<void> {
  const { body } = await registerRounds(password, { resetToken }, () => ({ resetToken }));
  await apiPost<void>(`${BASE}/register/finish`, body);
}

/** Needs a `change-password` ticket from `opaqueReauth`; ends the other sessions, returns a new token pair. */
export async function opaqueChangePassword(
  reauthTicket: string,
  password: string,
): Promise<TokenResponse> {
  const { body } = await registerRounds(password, { reauthTicket }, () => ({ reauthTicket }));
  return apiPost<TokenResponse>(`${BASE}/register/finish`, body);
}

export async function opaqueUpgrade(upgradeTicket: string, password: string): Promise<void> {
  const { body } = await registerRounds(password, { upgradeTicket }, () => ({ upgradeTicket }));
  await apiPost<void>(`${BASE}/register/finish`, body);
}
