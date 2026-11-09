// Live interop: pinned @serenity-kit/opaque client against our PHP OpaqueServer (test harness over stdin/stdout).
// Run: npm run test:opaque-interop -w frontend   (needs php + backend/vendor; real Argon2id KSF "memory-constrained")
import { spawn } from "node:child_process";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";
import * as opaque from "@serenity-kit/opaque";

const here = path.dirname(fileURLToPath(import.meta.url));
const harness = path.resolve(here, "../../../backend/tests/Opaque/bin/interop-server.php");
const KSF = "memory-constrained";
const raw = (s) => Buffer.from(s, "base64url");

class Harness {
  constructor() {
    this.proc = spawn(process.env.PHP_BIN ?? "php", [harness], {
      stdio: ["pipe", "pipe", "inherit"],
    });
    this.queue = [];
    this.proc.on("error", (e) => {
      console.error(`cannot start php: ${e.message}`);
      process.exit(2);
    });
    readline
      .createInterface({ input: this.proc.stdout })
      .on("line", (l) => this.queue.shift()?.(JSON.parse(l)));
  }
  call(msg) {
    return new Promise((resolve) => {
      this.queue.push(resolve);
      this.proc.stdin.write(JSON.stringify(msg) + "\n");
    });
  }
  async ok(msg) {
    const r = await this.call(msg);
    if (!r.ok) throw new Error(`harness ${msg.op} failed: ${r.error}`);
    return r;
  }
  close() {
    this.proc.stdin.end();
  }
}

let failures = 0;
let checks = 0;
const check = (cond, name) => {
  checks++;
  if (!cond) {
    failures++;
    console.error(`FAIL  ${name}`);
  } else console.log(`ok    ${name}`);
};
const flip = (b64, i) => {
  const b = raw(b64);
  b[i] ^= 0x01;
  return b.toString("base64url");
};
const clientFinish = (state, loginResponse, password, identifiers) => {
  try {
    return opaque.client.finishLogin({
      clientLoginState: state,
      loginResponse,
      password,
      identifiers,
      keyStretching: KSF,
    });
  } catch {
    return undefined; // malformed input: also a rejection
  }
};

await opaque.ready;
const setup = opaque.server.createSetup();
const sb = raw(setup);
const keys = {
  oprfSeed: sb.subarray(0, 64).toString("base64url"),
  serverPrivateKey: sb.subarray(64, 96).toString("base64url"),
};

const h = new Harness();
const init = await h.ok({ op: "init", ...keys });
check(
  init.serverPublicKey === opaque.server.getPublicKey(setup),
  "server public key equals serenity's derived key",
);

const register = async (id, password, identifiers) => {
  const s = opaque.client.startRegistration({ password });
  const { response } = await h.ok({ op: "register", id, request: s.registrationRequest });
  const f = opaque.client.finishRegistration({
    clientRegistrationState: s.clientRegistrationState,
    registrationResponse: response,
    password,
    identifiers,
    keyStretching: KSF,
  });
  check(
    f.serverStaticPublicKey === init.serverPublicKey,
    `[${id}] client sees our server public key`,
  );
  return f;
};

// returns { client, serverKey } where client is serenity's result (undefined on rejection)
const login = async (id, record, password, identifiers, mutate = {}) => {
  const l1 = opaque.client.startLogin({ password });
  const s = await h.ok({
    op: "login-start",
    id,
    ke1: l1.startLoginRequest,
    record,
    clientIdentity: identifiers?.client,
  });
  const ke2 = mutate.ke2 ? mutate.ke2(s.ke2) : s.ke2;
  const client = clientFinish(l1.clientLoginState, ke2, password, identifiers);
  return { client, state: s.state, ke1: l1.startLoginRequest, ke2: s.ke2 };
};

const cases = [
  ["ascii", "correct horse battery staple"],
  ["unicode", "päss wörd 🔑 日本語 with ünicode"],
  ["max-128", "p".repeat(128)],
  ["one-char", "x"],
  ["spaces-nul-like", "  leading and trailing  \t"],
];
const base = "0192f6c0-0000-7000-8000-0000000000";

for (const [i, [label, password]] of cases.entries()) {
  const id = `${base}${String(i + 1).padStart(2, "0")}`;
  const reg = await register(id, password);
  check(raw(reg.registrationRecord).length === 192, `[${label}] record is 192 bytes`);

  const a = await login(id, reg.registrationRecord, password);
  check(a.client !== undefined, `[${label}] client accepts our KE2`);
  const fin = await h.ok({ op: "login-finish", state: a.state, ke3: a.client.finishLoginRequest });
  check(fin.sessionKey === a.client.sessionKey, `[${label}] session keys equal`);
  check(a.client.exportKey === reg.exportKey, `[${label}] exportKey equals registration's`);

  const b = await login(id, reg.registrationRecord, password);
  check(b.client?.exportKey === a.client.exportKey, `[${label}] exportKey stable across logins`);
  check(b.client?.sessionKey !== a.client.sessionKey, `[${label}] session key differs per login`);

  // wrong password: client rejects; a forged KE3 must not be accepted by the server either
  const w = await login(id, reg.registrationRecord, password + "!");
  check(w.client === undefined, `[${label}] wrong password rejected by client`);
  const forged = await h.call({
    op: "login-finish",
    state: w.state,
    ke3: Buffer.alloc(64, 7).toString("base64url"),
  });
  check(forged.ok === false, `[${label}] forged KE3 rejected by server`);

  // state is bound to its own KE3: KE3 of login a does not verify against login b's state
  const cross = await h.call({
    op: "login-finish",
    state: b.state,
    ke3: a.client.finishLoginRequest,
  });
  check(cross.ok === false, `[${label}] KE3 of another login rejected`);

  // tampered KE2 (each field) -> client rejects
  for (const [field, at] of [
    ["evaluated element", 3],
    ["masking nonce", 40],
    ["masked response", 100],
    ["server nonce", 200],
    ["server keyshare", 235],
    ["server MAC", 300],
  ]) {
    const t = await login(id, reg.registrationRecord, password, undefined, {
      ke2: (x) => flip(x, at),
    });
    check(t.client === undefined, `[${label}] tampered KE2 (${field}) rejected by client`);
  }

  // tampered KE3 -> server rejects
  const k = await login(id, reg.registrationRecord, password);
  const bad = await h.call({
    op: "login-finish",
    state: k.state,
    ke3: flip(k.client.finishLoginRequest, 10),
  });
  check(bad.ok === false, `[${label}] tampered KE3 rejected by server`);
  const short = await h.call({
    op: "login-finish",
    state: k.state,
    ke3: raw(k.client.finishLoginRequest).subarray(0, 63).toString("base64url"),
  });
  check(short.ok === false, `[${label}] truncated KE3 rejected by server`);
}

// custom identities (bound into the transcript): both sides must agree
{
  const id = `${base}77`;
  const identifiers = { client: id, server: "calendar.example.org" };
  await h.ok({ op: "init", ...keys, serverIdentity: identifiers.server });
  const reg = await register(id, "identity pw", identifiers);
  const ok = await login(id, reg.registrationRecord, "identity pw", identifiers);
  check(ok.client !== undefined, "[identifiers] login with custom client/server identity");
  const fin = await h.ok({
    op: "login-finish",
    state: ok.state,
    ke3: ok.client.finishLoginRequest,
  });
  check(fin.sessionKey === ok.client.sessionKey, "[identifiers] session keys equal");
  const mismatch = await login(id, reg.registrationRecord, "identity pw", {
    client: id,
    server: "evil.example.org",
  });
  check(mismatch.client === undefined, "[identifiers] server identity mismatch rejected by client");
  await h.ok({ op: "init", ...keys });
}

// unknown user: fake KE2 -> client rejects, server never accepts a KE3, OPRF output consistent per address
{
  const ghost = `${base}ff`;
  const pw = "whatever";
  const g1 = await login(ghost, null, pw);
  check(g1.client === undefined, "[unknown] client rejects fake KE2");
  check(raw(g1.ke2).length === 320, "[unknown] fake KE2 has real length (320)");
  const forged = await h.call({
    op: "login-finish",
    state: g1.state,
    ke3: Buffer.alloc(64, 1).toString("base64url"),
  });
  check(forged.ok === false, "[unknown] forged KE3 rejected by server");

  // same KE1 against the fake path twice and against a second process with the same keys
  const l1 = opaque.client.startLogin({ password: pw });
  const x = await h.ok({ op: "login-start", id: ghost, ke1: l1.startLoginRequest, record: null });
  const y = await h.ok({ op: "login-start", id: ghost, ke1: l1.startLoginRequest, record: null });
  const other = new Harness();
  await other.ok({ op: "init", ...keys });
  const z = await other.ok({
    op: "login-start",
    id: ghost,
    ke1: l1.startLoginRequest,
    record: null,
  });
  other.close();
  const ev = (ke2) => raw(ke2).subarray(0, 32).toString("hex");
  check(
    ev(x.ke2) === ev(y.ke2) && ev(y.ke2) === ev(z.ke2),
    "[unknown] OPRF element stable per address (runs and processes)",
  );
  check(
    raw(x.ke2).subarray(32, 64).toString("hex") !== raw(y.ke2).subarray(32, 64).toString("hex"),
    "[unknown] masking nonce fresh per call",
  );
  const o = await h.ok({
    op: "login-start",
    id: `${base}fe`,
    ke1: l1.startLoginRequest,
    record: null,
  });
  check(ev(o.ke2) !== ev(x.ke2), "[unknown] OPRF element differs per address");

  // a fake KE2 for a registered address must not be distinguishable by length from a real one
  const realId = `${base}aa`;
  const reg = await register(realId, pw);
  const real = await login(realId, reg.registrationRecord, pw);
  check(
    raw(real.ke2).length === raw(g1.ke2).length,
    "[unknown] real and fake KE2 have equal length",
  );
}

h.close();
console.log(`\n${checks - failures}/${checks} checks passed`);
process.exit(failures ? 1 : 0);
