import type * as Serenity from "@serenity-kit/opaque";

export type Opaque = typeof Serenity;
export type KsfConfig = "memory-constrained" | "rfc-recommended";

export type OpaqueCall =
  | { op: "startRegistration"; password: string }
  | {
      op: "finishRegistration";
      password: string;
      clientRegistrationState: string;
      registrationResponse: string;
      ksf: KsfConfig;
    }
  | { op: "startLogin"; password: string }
  | {
      op: "finishLogin";
      password: string;
      clientLoginState: string;
      loginResponse: string;
      ksf: KsfConfig;
    };

/** Runs one client operation on a loaded serenity module (shared by the worker and the main thread). */
export async function runOpaque(opaque: Opaque, call: OpaqueCall): Promise<unknown> {
  await opaque.ready;
  switch (call.op) {
    case "startRegistration":
      return opaque.client.startRegistration({ password: call.password });
    case "finishRegistration":
      return opaque.client.finishRegistration({
        password: call.password,
        clientRegistrationState: call.clientRegistrationState,
        registrationResponse: call.registrationResponse,
        keyStretching: call.ksf,
      });
    case "startLogin":
      return opaque.client.startLogin({ password: call.password });
    case "finishLogin": {
      const r = opaque.client.finishLogin({
        password: call.password,
        clientLoginState: call.clientLoginState,
        loginResponse: call.loginResponse,
        keyStretching: call.ksf,
      });
      // Only the message goes back; session and export key are never used.
      return r ? { finishLoginRequest: r.finishLoginRequest } : null;
    }
  }
}
