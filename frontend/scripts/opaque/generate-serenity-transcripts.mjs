// Generates reference transcripts with the pinned @serenity-kit/opaque (the client library we must interoperate with).
// Output: backend/tests/Opaque/fixtures/serenity-transcripts.json (secrets are throwaway test values).
// Usage: node frontend/scripts/opaque/generate-serenity-transcripts.mjs [out-file]
// Regenerating changes every random value; commit the result only together with the PHP tests that consume it.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as opaque from "@serenity-kit/opaque";

const here = path.dirname(fileURLToPath(import.meta.url));
const outFile =
  process.argv[2] ??
  path.resolve(here, "../../../backend/tests/Opaque/fixtures/serenity-transcripts.json");
const KSF = "memory-constrained";

await opaque.ready;
const b64u = (b) => Buffer.from(b).toString("base64url");
const raw = (s) => Buffer.from(s, "base64url");
const hex = (s) => raw(s).toString("hex");

const serverSetup = opaque.server.createSetup();
const sb = raw(serverSetup);
if (sb.length !== 128) throw new Error(`unexpected serverSetup length ${sb.length}`);
const setup = {
  serverSetup,
  // layout: oprf_seed (64) || server_private_key (32, canonical LE scalar) || dummy_public_key (32)
  oprfSeedHex: sb.subarray(0, 64).toString("hex"),
  serverPrivateKeyHex: sb.subarray(64, 96).toString("hex"),
  dummyPublicKeyHex: sb.subarray(96, 128).toString("hex"),
  serverPublicKeyHex: hex(opaque.server.getPublicKey(serverSetup)),
};

const users = [
  {
    userIdentifier: "0192f6c0-0000-7000-8000-000000000001",
    password: "correct horse battery staple",
    identifiers: undefined,
  },
  {
    userIdentifier: "0192f6c0-0000-7000-8000-000000000002",
    password: "päss wörd 🔑 with ünicode",
    identifiers: undefined,
  },
  // custom identifiers: both sides must pass them, they end up in the 3DH transcript and the envelope
  {
    userIdentifier: "0192f6c0-0000-7000-8000-000000000003",
    password: "x".repeat(128),
    identifiers: { client: "0192f6c0-0000-7000-8000-000000000003", server: "calendar.example.org" },
  },
];

const t0 = Date.now();
const transcripts = [];
for (const u of users) {
  const { userIdentifier, password, identifiers } = u;
  const reg1 = opaque.client.startRegistration({ password });
  const { registrationResponse } = opaque.server.createRegistrationResponse({
    serverSetup,
    userIdentifier,
    registrationRequest: reg1.registrationRequest,
  });
  const reg2 = opaque.client.finishRegistration({
    clientRegistrationState: reg1.clientRegistrationState,
    registrationResponse,
    password,
    identifiers,
    keyStretching: KSF,
  });

  const login = (pw, record) => {
    const l1 = opaque.client.startLogin({ password: pw });
    const l2 = opaque.server.startLogin({
      serverSetup,
      userIdentifier,
      registrationRecord: record,
      startLoginRequest: l1.startLoginRequest,
      identifiers,
    });
    const l3 = opaque.client.finishLogin({
      clientLoginState: l1.clientLoginState,
      loginResponse: l2.loginResponse,
      password: pw,
      identifiers,
      keyStretching: KSF,
    });
    const base = {
      password: pw,
      clientLoginState: l1.clientLoginState,
      startLoginRequest: l1.startLoginRequest,
      loginResponse: l2.loginResponse,
      serverLoginState: l2.serverLoginState,
    };
    if (!l3) return { ...base, clientAccepted: false };
    const l4 = opaque.server.finishLogin({
      serverLoginState: l2.serverLoginState,
      finishLoginRequest: l3.finishLoginRequest,
      identifiers,
    });
    if (l4.sessionKey !== l3.sessionKey) throw new Error("session key mismatch");
    return {
      ...base,
      clientAccepted: true,
      finishLoginRequest: l3.finishLoginRequest,
      sessionKey: l3.sessionKey,
      exportKey: l3.exportKey,
      serverStaticPublicKey: l3.serverStaticPublicKey,
    };
  };

  transcripts.push({
    userIdentifier,
    identifiers: identifiers ?? null,
    keyStretching: KSF,
    password,
    registration: {
      clientRegistrationState: reg1.clientRegistrationState,
      registrationRequest: reg1.registrationRequest,
      registrationResponse,
      registrationRecord: reg2.registrationRecord,
      exportKey: reg2.exportKey,
      serverStaticPublicKey: reg2.serverStaticPublicKey,
    },
    loginOk: login(password, reg2.registrationRecord),
    loginWrongPassword: login(password + "!", reg2.registrationRecord),
  });
}

// Unknown account: serenity answers with a fake record when registrationRecord is null.
const ghost = "0192f6c0-0000-7000-8000-0000000000ff";
const g1 = opaque.client.startLogin({ password: "whatever" });
const g2 = opaque.server.startLogin({
  serverSetup,
  userIdentifier: ghost,
  registrationRecord: null,
  startLoginRequest: g1.startLoginRequest,
});
const g3 = opaque.client.finishLogin({
  clientLoginState: g1.clientLoginState,
  loginResponse: g2.loginResponse,
  password: "whatever",
  keyStretching: KSF,
});
const unknownUser = {
  userIdentifier: ghost,
  password: "whatever",
  clientLoginState: g1.clientLoginState,
  startLoginRequest: g1.startLoginRequest,
  loginResponse: g2.loginResponse,
  serverLoginState: g2.serverLoginState,
  clientAccepted: g3 !== undefined,
};

const lengths = (o) =>
  Object.fromEntries(
    Object.entries(o)
      .filter(([, v]) => typeof v === "string")
      .map(([k, v]) => [k, raw(v).length]),
  );
const first = transcripts[0];
const fixture = {
  generator: "frontend/scripts/opaque/generate-serenity-transcripts.mjs",
  package: "@serenity-kit/opaque@1.1.0",
  encoding: "base64url without padding for every message and key unless the key ends in Hex",
  setup,
  transcripts,
  unknownUser,
  byteLengths: { registration: lengths(first.registration), login: lengths(first.loginOk) },
};
fs.writeFileSync(outFile, JSON.stringify(fixture, null, 2) + "\n");
console.log("wrote", outFile, `in ${Date.now() - t0} ms`);
console.log(JSON.stringify(fixture.byteLengths));
console.log(
  "wrong-password accepted by client:",
  transcripts.map((t) => t.loginWrongPassword.clientAccepted),
  "unknown user accepted:",
  unknownUser.clientAccepted,
);
