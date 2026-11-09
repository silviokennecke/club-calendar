// Extracts the OPAQUE-related test vectors from the RFC plain-text files into JSON fixtures.
// Usage: node extract-rfc-vectors.mjs <dir-with-rfc9807.txt-rfc9497.txt-rfc9380.txt> <out-dir>
// Only the entries that fit our suite are kept (ristretto255-SHA512); see docs/ops/OPAQUE-SPIKE.md.
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

const [dir, out] = process.argv.slice(2);
if (!dir || !out) throw new Error("usage: extract-rfc-vectors.mjs <rfc-dir> <out-dir>");
const read = (n) =>
  fs
    .readFileSync(path.join(dir, `rfc${n}.txt`), "utf8")
    .replace(/\f/g, "")
    .split("\n")
    .filter(
      (l) =>
        !/^(Pottier|Bourdrez|Krawczyk|Wood|Faz|Hao|Lewi|Wood|Wahby|RFC \d{4}\s|Irtf|Internet Research|Request for Comments)/.test(
          l,
        ) && !/\[Page \d+\]/.test(l),
    );
const write = (name, obj) =>
  fs.writeFileSync(path.join(out, name), JSON.stringify(obj, null, 2) + "\n");

// ---- RFC 9807 appendix C (OPAQUE-3DH) ----
{
  const lines = read(9807);
  const vecs = [];
  let cur = null,
    sect = null,
    key = null,
    m;
  const sectMap = {
    Configuration: "config",
    "Input Values": "inputs",
    "Intermediate Values": "intermediate",
    "Output Values": "outputs",
  };
  const from = lines.findIndex((l) => l.startsWith("C.1.  Real Test Vectors"));
  for (const l of lines.slice(from)) {
    if (/^   Email:/.test(l)) break;
    if ((m = l.match(/^C\.([12])\.(\d+)\.  OPAQUE-3DH (Real|Fake) Test Vector (\d+)/))) {
      cur = {
        id: `C.${m[1]}.${m[2]}`,
        kind: m[3].toLowerCase(),
        config: {},
        inputs: {},
        intermediate: {},
        outputs: {},
      };
      vecs.push(cur);
      sect = null;
      continue;
    }
    if (
      (m = l.match(
        /^C\.[12]\.\d+\.\d\.  (Configuration|Input Values|Intermediate Values|Output Values)/,
      ))
    ) {
      sect = sectMap[m[1]];
      key = null;
      continue;
    }
    if (!cur || !sect) continue;
    if ((m = l.match(/^   ([A-Za-z0-9_]+): ?(.*)$/))) {
      key = m[1];
      cur[sect][key] = m[2].trim();
      continue;
    }
    if ((m = l.match(/^   (\S+)$/)) && key) cur[sect][key] += m[1];
  }
  const keep = vecs
    .filter((v) => v.config.OPRF === "ristretto255-SHA512")
    .map((v) => ({
      ...v,
      // "Group" is the 3DH key-exchange group; curve25519 entries use ristretto255 only for the OPRF
      keGroup: v.config.Group,
      matchesOurSuite: v.config.Group === "ristretto255",
    }));
  write("rfc9807-vectors.json", {
    source: "RFC 9807 Appendix C, https://www.rfc-editor.org/rfc/rfc9807.txt",
    note: 'All hex. KSF is Identity and Context is "OPAQUE-POC" (4f50415155452d504f43) in every vector. P256-SHA256 vectors omitted. matchesOurSuite=false: OPRF is ristretto255 but the 3DH group is curve25519 (usable for OPRF/registration-response checks only).',
    vectors: keep,
  });
  console.log("rfc9807", keep.map((v) => `${v.id}:${v.matchesOurSuite}`).join(" "));
}

// ---- RFC 9497 appendix A.1.1 (ristretto255-SHA512, OPRF mode) ----
{
  const lines = read(9497);
  const a = lines.findIndex((l) => l.startsWith("A.1.1.  OPRF Mode"));
  const b = lines.findIndex((l) => l.startsWith("A.1.2.  VOPRF Mode"));
  const kv = [];
  const header = {};
  let cur = null,
    last = null,
    m;
  for (const l of lines.slice(a, b)) {
    if ((m = l.match(/^A\.1\.1\.\d+\.  Test Vector (\d+), Batch Size (\d+)/))) {
      cur = { vector: +m[1], batchSize: +m[2] };
      kv.push(cur);
      last = null;
      continue;
    }
    if (
      (m = l.match(
        /^   (Seed|KeyInfo|skSm|Input|Blind|BlindedElement|EvaluationElement|Output) = (\S+)$/,
      ))
    ) {
      last = m[1];
      (cur ?? header)[last] = m[2];
      continue;
    }
    if ((m = l.match(/^   (\S+)$/)) && last) (cur ?? header)[last] += m[1];
  }
  write("rfc9497-oprf-vectors.json", {
    source: "RFC 9497 Appendix A.1.1 (ristretto255-SHA512, mode 0x00 OPRF)",
    header,
    vectors: kv.map(
      ({ vector, batchSize, Input, Blind, BlindedElement, EvaluationElement, Output }) => ({
        vector,
        batchSize,
        Input,
        Blind,
        BlindedElement,
        EvaluationElement,
        Output,
      }),
    ),
  });
  console.log("rfc9497", kv.length);
}

// ---- RFC 9380 appendix K.3 (expand_message_xmd, SHA-512) ----
{
  const lines = read(9380);
  const a = lines.findLastIndex((l) => l.startsWith("K.3.  expand_message_xmd(SHA-512)"));
  const b = lines.findIndex((l, i) => i > a && l.startsWith("K.4."));
  const hdr = {};
  const vecs = [];
  let cur = null,
    key = null,
    m;
  for (const l of lines.slice(a, b)) {
    if (
      (m = l.match(
        /^   (name|DST|hash|k|msg|len_in_bytes|DST_prime|msg_prime|uniform_bytes)\s*=\s?(.*)$/,
      ))
    ) {
      key = m[1];
      if (key === "msg") {
        cur = { msg: m[2].trim() };
        vecs.push(cur);
      } else if (cur) cur[key] = m[2].trim();
      else hdr[key] = m[2].trim();
      continue;
    }
    if ((m = l.match(/^\s{9,}(\S+)$/)) && key && cur) cur[key] += m[1];
  }
  // verify our parse by recomputing expand_message_xmd
  const sha = (b) => createHash("sha512").update(b).digest();
  const xmd = (msg, dst, len) => {
    const dstp = Buffer.concat([dst, Buffer.from([dst.length])]);
    const ell = Math.ceil(len / 64);
    const b0 = sha(
      Buffer.concat([Buffer.alloc(128), msg, Buffer.from([len >> 8, len & 255, 0]), dstp]),
    );
    let bi = sha(Buffer.concat([b0, Buffer.from([1]), dstp]));
    const outs = [bi];
    for (let i = 2; i <= ell; i++) {
      bi = sha(
        Buffer.concat([Buffer.from(b0.map((x, j) => x ^ outs[i - 2][j])), Buffer.from([i]), dstp]),
      );
      outs.push(bi);
    }
    return Buffer.concat(outs).subarray(0, len).toString("hex");
  };
  for (const v of vecs) {
    const len = parseInt(v.len_in_bytes, 16);
    const got = xmd(Buffer.from(v.msg), Buffer.from(hdr.DST), len);
    if (got !== v.uniform_bytes) throw new Error(`xmd mismatch for msg=${v.msg.slice(0, 12)}`);
    v.msg_hex = Buffer.from(v.msg).toString("hex");
    v.len_in_bytes = len;
  }
  write("rfc9380-xmd-sha512-vectors.json", {
    source: "RFC 9380 Appendix K.3 (expand_message_xmd SHA-512)",
    DST: hdr.DST,
    hash: "SHA512",
    vectors: vecs.map(({ msg, msg_hex, len_in_bytes, uniform_bytes }) => ({
      msg,
      msg_hex,
      len_in_bytes,
      uniform_bytes,
    })),
  });
  console.log("rfc9380", vecs.length, "recomputed OK");
}
