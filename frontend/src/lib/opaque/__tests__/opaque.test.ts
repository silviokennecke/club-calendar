import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import * as serenity from "@serenity-kit/opaque";
import { ApiError } from "@/lib/api";
import { loginProtocol } from "../auth";
import {
  assertPasswordPolicy,
  opaqueChangePassword,
  opaqueLogin,
  opaqueReauth,
  opaqueReset,
  opaqueSignup,
  opaqueUpgrade,
} from "../client";
import { ksfConfig, OpaqueClientError } from "../ksf";

// Simulated backend: serenity's own server functions behind a mocked fetch.
let setup: string;
const users = new Map<string, { id: string; record: string }>();
const states = new Map<string, string>();
const signupStates = new Map<string, { id: string; email?: string }>();
let staleFinishes = 0;
let ksfProfile = "memory-constrained";
let calls: { path: string; body: Record<string, unknown> }[] = [];

const json = (status: number, body?: unknown) =>
  new Response(body === undefined ? null : JSON.stringify(body), { status });
const problem = (status: number, code: string) => json(status, { detail: code, code });

function handle(path: string, body: Record<string, string>): Response {
  const startLogin = (id: string, record: string | null) => {
    const r = serenity.server.startLogin({
      serverSetup: setup,
      userIdentifier: id,
      registrationRecord: record,
      startLoginRequest: body.startLoginRequest,
    });
    const handleId = `st${states.size}`;
    states.set(handleId, r.serverLoginState);
    return json(200, { loginResponse: r.loginResponse, loginState: handleId, ksfProfile });
  };
  const finishLogin = (): boolean => {
    const st = states.get(body.loginState);
    states.delete(body.loginState);
    if (!st) return false;
    try {
      serenity.server.finishLogin({
        serverLoginState: st,
        finishLoginRequest: body.finishLoginRequest,
      });
      return true;
    } catch {
      return false;
    }
  };
  switch (path) {
    case "/api/auth/opaque/login/start": {
      const u = users.get(body.email);
      return startLogin(u?.id ?? `fake:${body.email}`, u?.record ?? null);
    }
    case "/api/auth/opaque/login/finish":
      return finishLogin()
        ? json(200, { access_token: "a", refresh_token: "r", user: { id: "u" } })
        : problem(401, "invalid_credentials");
    case "/api/auth/opaque/reauth/start":
      return startLogin("me", users.get("me@x.org")!.record);
    case "/api/auth/opaque/reauth/finish":
      return finishLogin()
        ? json(200, { reauthTicket: `ticket-${body.purpose}`, expiresIn: 300 })
        : problem(400, "invalid_credentials");
    case "/api/auth/opaque/register/start": {
      const id = body.email ? `id-${body.email}` : "me";
      const r = serenity.server.createRegistrationResponse({
        serverSetup: setup,
        userIdentifier: id,
        registrationRequest: body.registrationRequest,
      });
      const registrationState = `rs${signupStates.size}`;
      signupStates.set(registrationState, { id, email: body.email });
      return json(200, { registrationResponse: r.registrationResponse, registrationState });
    }
    case "/api/auth/opaque/register/finish": {
      const s = signupStates.get(body.registrationState);
      if (!s || staleFinishes-- > 0) {
        return problem(409, "opaque_state_invalid");
      }
      if (s.email) {
        users.set(s.email, { id: s.id, record: body.registrationRecord });
        return json(201, {
          verificationRequired: true,
          email: s.email,
          access_token: "a",
          refresh_token: "r",
          user: { id: s.id },
        });
      }
      users.set("me@x.org", { id: "me", record: body.registrationRecord });
      return body.reauthTicket
        ? json(200, { access_token: "n", refresh_token: "n", user: { id: "me" } })
        : json(204);
    }
  }
  return problem(404, "not_found");
}

beforeAll(async () => {
  await serenity.ready;
  setup = serenity.server.createSetup();
});

function mockBackend() {
  calls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      const path = url.replace(/^https?:\/\/[^/]+/, "");
      const body = JSON.parse(String(init.body ?? "{}"));
      calls.push({ path, body });
      return handle(path, body);
    }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  ksfProfile = "memory-constrained";
  staleFinishes = 0;
});

describe("opaque client flows", () => {
  it("signs up and logs in with the same password", async () => {
    mockBackend();
    const res = await opaqueSignup("a@x.org", "correct horse", {
      name: "A",
      acceptedDocuments: ["d1"],
    });
    expect(res.verificationRequired).toBe(true);
    const finish = calls.at(-1)!.body;
    expect(finish.acceptedDocuments).toEqual(["d1"]);
    expect(finish.registrationState).toBeTruthy();
    expect(JSON.stringify(calls)).not.toContain("correct horse");

    const tokens = await opaqueLogin("a@x.org", "correct horse");
    expect(tokens.access_token).toBe("a");
  }, 30000);

  it("wrong password and unknown account both give invalid_credentials", async () => {
    mockBackend();
    await opaqueSignup("b@x.org", "correct horse", { name: "B", acceptedDocuments: [] });
    for (const [email, pw] of [
      ["b@x.org", "wrong password"],
      ["ghost@x.org", "whatever pw"],
    ]) {
      const err = await opaqueLogin(email, pw).catch((e) => e);
      expect(err).toBeInstanceOf(ApiError);
      expect(err.code).toBe("invalid_credentials");
    }
    // no finish request is sent when the client rejects
    expect(calls.filter((c) => c.path.endsWith("login/finish"))).toHaveLength(0);
  }, 30000);

  it("reauth yields a ticket, change-password and reset register a new record", async () => {
    mockBackend();
    users.set("me@x.org", { id: "me", record: "" });
    // seed a real record for user "me"
    const r1 = serenity.client.startRegistration({ password: "old password" });
    const r2 = serenity.server.createRegistrationResponse({
      serverSetup: setup,
      userIdentifier: "me",
      registrationRequest: r1.registrationRequest,
    });
    const r3 = serenity.client.finishRegistration({
      password: "old password",
      clientRegistrationState: r1.clientRegistrationState,
      registrationResponse: r2.registrationResponse,
      keyStretching: "memory-constrained",
    });
    users.set("me@x.org", { id: "me", record: r3.registrationRecord });

    const bad = await opaqueReauth("change-password", "nope nope").catch((e) => e);
    expect(bad.code).toBe("invalid_credentials");
    const ticket = await opaqueReauth("change-password", "old password");
    expect(ticket).toBe("ticket-change-password");

    const tokens = await opaqueChangePassword(ticket, "new password");
    expect(tokens.access_token).toBe("n");
    expect(calls.at(-1)!.body.reauthTicket).toBe(ticket);
    expect(await opaqueReauth("delete-account", "new password")).toBe("ticket-delete-account");

    await opaqueReset("tok", "another one");
    expect(calls.at(-1)!.body.resetToken).toBe("tok");
    expect(await opaqueReauth("change-email", "another one")).toBe("ticket-change-email");
  }, 60000);

  it("sends registrationState in every context", async () => {
    mockBackend();
    users.set("me@x.org", { id: "me", record: "" });
    await opaqueReset("tok", "another one");
    expect(calls.at(-1)!.body).toMatchObject({
      resetToken: "tok",
      registrationState: expect.any(String),
    });
    await opaqueChangePassword("tk", "another one");
    expect(calls.at(-1)!.body).toMatchObject({
      reauthTicket: "tk",
      registrationState: expect.any(String),
    });
    await opaqueUpgrade("up", "another one");
    expect(calls.at(-1)!.body).toMatchObject({
      upgradeTicket: "up",
      registrationState: expect.any(String),
    });
  }, 60000);

  it("restarts once from register/start on 409 opaque_state_invalid", async () => {
    mockBackend();
    staleFinishes = 1;
    await opaqueSignup("r@x.org", "correct horse", { name: "R", acceptedDocuments: [] });
    expect(calls.filter((c) => c.path.endsWith("register/start"))).toHaveLength(2);
    expect(calls.filter((c) => c.path.endsWith("register/finish"))).toHaveLength(2);
    expect(users.has("r@x.org")).toBe(true);
  }, 30000);

  it("surfaces a second opaque_state_invalid", async () => {
    mockBackend();
    staleFinishes = 2;
    const err = await opaqueSignup("s@x.org", "correct horse", {
      name: "S",
      acceptedDocuments: [],
    }).catch((e) => e);
    expect(err.code).toBe("opaque_state_invalid");
    expect(calls.filter((c) => c.path.endsWith("register/start"))).toHaveLength(2);
  }, 30000);

  it("rejects an unknown KSF profile before any key stretching", async () => {
    mockBackend();
    await opaqueSignup("c@x.org", "correct horse", { name: "C", acceptedDocuments: [] });
    ksfProfile = "weak-custom";
    const err = await opaqueLogin("c@x.org", "correct horse").catch((e) => e);
    expect(err).toBeInstanceOf(OpaqueClientError);
    expect(err.code).toBe("invalid_ksf_profile");
  }, 30000);
});

describe("helpers", () => {
  it("ksfConfig accepts only known profiles", () => {
    expect(ksfConfig("memory-constrained")).toBe("memory-constrained");
    for (const bad of ["rfc-recommended", "__proto__", "", undefined, 3]) {
      expect(() => ksfConfig(bad)).toThrow(OpaqueClientError);
    }
  });

  it("password policy 8-128 code points", () => {
    expect(() => assertPasswordPolicy("1234567")).toThrow(ApiError);
    expect(() => assertPasswordPolicy("x".repeat(129))).toThrow(ApiError);
    expect(() => assertPasswordPolicy("12345678")).not.toThrow();
    expect(() => assertPasswordPolicy("🔑".repeat(128))).not.toThrow();
  });

  it("opaqueSignup refuses a weak password without any request", async () => {
    mockBackend();
    await expect(
      opaqueSignup("d@x.org", "short", { name: "D", acceptedDocuments: [] }),
    ).rejects.toMatchObject({
      code: "validation_failed",
    });
    expect(calls).toHaveLength(0);
  });

  it("maps the identify hint to a protocol", () => {
    expect(loginProtocol("opaque")).toBe("opaque");
    expect(loginProtocol("legacy")).toBe("legacy");
    expect(loginProtocol("none")).toBe("legacy");
    expect(loginProtocol("reset_required")).toBe("reset");
    expect(loginProtocol(undefined)).toBe("legacy");
  });
});
