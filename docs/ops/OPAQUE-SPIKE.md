# OPAQUE Spike (AP 0): Ergebnisse

Stand 2026-11-09, Branch `security/audit-followup`. Zugehörig: `OPAQUE-PLAN.md`. Alles hier ist gegen Quelltext und
Messung belegt, nicht aus der Dokumentation übernommen.

## 1. Bibliothek

| | |
|---|---|
| Paket | `@serenity-kit/opaque` **1.1.0** (2026-02-01), exakt gepinnt in `frontend/package.json`, Lockfile mit SHA-512-Integrität |
| Lizenz / Skripte | MIT; keine `scripts` (kein postinstall), keine Abhängigkeiten; `bin` = kleines CLI (`create-server-setup`), wird nicht ausgeführt |
| Lieferkette | npm-Provenance aktiv, `npm audit signatures` ohne Befund |
| Rust-Kern | `opaque-ke` **4.0.1** (Cargo.toml verlangt `4.0.0`, im WASM steht `opaque-ke-4.0.1`), `voprf` 0.5.0, `argon2` 0.5.3, `curve25519-dalek` 4.1.3 |
| Quelle | Tag `@serenity-kit/opaque@1.1.0`, `src/lib.rs` (570 Zeilen), dazu `opaque-ke-4.0.1` von crates.io |
| Größe | WASM inline (Base64) im JS: Bundle 413 KB, 158 KB gzip (esbuild, minifiziert) |

## 2. Was der PHP-Server exakt implementieren muss

### 2.1 Suite (fest, nicht konfigurierbar)

- OPRF: ristretto255-SHA512 (RFC 9497, Modus 0x00, contextString `"OPRFV1-" || 0x00 || "-ristretto255-SHA512"`)
- 3DH: KE-Gruppe ristretto255, Hash SHA-512, KDF HKDF-SHA-512, MAC HMAC-SHA-512; Nh=64, Npk=32, Nsk=32, Nm=64, Nx=64, Nok=32
- Envelope: Internal-Modus; die Envelope wird nur vom Client geöffnet, der Server reicht sie unverändert durch
- Der Server braucht nie Argon2, nie die Client-Schlüsselableitung und nie die Envelope-Logik.

### 2.2 KSF (nur Client, aber für das Profilfeld relevant)

`stretched = Argon2id(oprf_output (64 B), salt = 16 Nullbytes, tag 64 B)`, Version 0x13, ohne Secret/AD;
`randomized_pwd = HKDF-Extract(salt leer, oprf_output || stretched)`.

| Profil (`keyStretching`) | m (KiB) | t | p |
|---|---|---|---|
| `memory-constrained` (Default) | 65536 | 3 | 4 |
| `rfc-recommended` (= `rfc-draft-recommended`) | 2097151 (2^21-1, nicht 2^21: Browser-Absturz) | 1 | 4 |
| `argon2id-custom` | frei | frei | frei |

Das Profil steckt weder im Record noch in einer Nachricht. Client muss bei Registrierung und jedem Login
dasselbe angeben, sonst scheitert der Login still (Client bekommt `undefined`). Der Server kann ein zu schwaches Profil
nicht erkennen. Die Profilkennung ist rein Anwendungsebene (`opaque_version`/`ksf_profile`, Plan 2.1).

### 2.3 Context und Identitäten

- **Context: leer (Länge 0).** `lib.rs` übergibt überall `context: None`; es gibt keine Option dafür. Der
  Plan-Wert `"club-calendar/opaque/v1"` ist mit serenity nicht umsetzbar und entfällt.
- Preamble (Transkript, exakt RFC 9807 §6.4.2.1): `"OPAQUEv1-" || I2OSP(len(context),2) || context || I2OSP(len(client_id),2) || client_id || KE1 || I2OSP(len(server_id),2) || server_id || evaluated_element || masking_nonce || masked_response || server_nonce || server_e_pk`
  (KE1 = blinded_element || client_nonce || client_e_pk, 96 B). `transcript_hash = SHA-512(preamble)`.
- **Identitäten:** optional `identifiers: {client?, server?}` (UTF-8-Strings). Ohne Angabe ist die Identität der
  jeweilige **statische Public Key (32 B)**; sie wird dann mit Längenpräfix `0x0020` ins Transkript gehängt.
  Angegebene Identitäten müssen bei Registrierung (Client), Login-Start (Server) und Login-Finish (Client) identisch sein
  (sie stecken in `auth_tag` der Envelope und im Transkript).
- **`userIdentifier` = `credential_identifier`** (nur Server). Wird roh als UTF-8 in die OPRF-Schlüsselableitung gegeben:
  `seed = HKDF-Expand(PRK = oprf_seed, info = credential_identifier || "OprfKey", L = 32)` (kein Extract, PRK ist der 64-B-Seed),
  `oprf_key = DeriveKeyPair(seed, "OPAQUE-DeriveKeyPair")` (RFC 9497 §3.2.1: `HashToScalar(seed || I2OSP(len(info),2) || info || counter, DST="DeriveKeyPair" || contextString)`).
  Gilt für Registrierung und Login gleich.

### 2.4 Schlüsselplan und Serverlogik (alles gegen die RFC-Vektoren geprüft, siehe 5)

- `ikm = DH(server_e_sk, client_e_pk) || DH(server_s_sk, client_e_pk) || DH(server_e_sk, client_s_pk)`
- `prk = HKDF-Extract(salt = leer, ikm)`; `Expand-Label(secret, label, ctx, 64) = HKDF-Expand(secret, I2OSP(64,2) || len8("OPAQUE-"||label) || "OPAQUE-"||label || len8(ctx) || ctx, 64)`
- `handshake_secret = Expand-Label(prk, "HandshakeSecret", transcript_hash)`, `session_key = Expand-Label(prk, "SessionKey", transcript_hash)`
- `km2 = Expand-Label(handshake_secret, "ServerMAC", "")`, `km3 = Expand-Label(handshake_secret, "ClientMAC", "")`
- `server_mac = HMAC(km2, transcript_hash)`; `expected_client_mac = HMAC(km3, SHA-512(preamble || server_mac))`
- `masked_response = (server_s_pk || envelope) XOR HKDF-Expand(masking_key, masking_nonce || "CredentialResponsePad", 128)`
- Die Server-Ephemeralschlüssel sind in serenity zufällig (`derive_random`); für die RFC-Vektoren wird
  `DeriveKeyPair(seed, "OPAQUE-DeriveDiffieHellmanKeyPair")` mit dem vorgegebenen Seed gebraucht (Testeinsprung für Seeds/Nonces).
- Punkte: Dekodierung nach RFC 9496 und Ablehnung des Identitätselements (opaque-ke `NonIdentity`); Skalare kanonisch,
  ungleich 0 (`from_canonical_bytes`).
- **Fake-Pfad (opaque-ke):** unbekanntes Konto = `ServerRegistration::dummy`: `masking_key` 64 Zufallsbytes pro Aufruf,
  `client_s_pk` = `dummy_pk` (einmalig im Setup, festes Zufallselement), Envelope 96 Nullbytes. Wichtig ist nur, dass der
  **OPRF-Schlüssel für dieselbe Adresse stabil bleibt**: sonst könnte ein Angreifer zwei Versuche mit demselben Passwort vergleichen
  (entblindetes OPRF-Ergebnis bliebe nur für echte Konten gleich). Ein zufälliger Fake-Masking-Key pro Aufruf ist unkritisch (Maskierung mit
  zufälliger `masking_nonce`). `OPAQUE_FAKE_SEED` im Plan ist daher nicht nötig; stabile Fake-Kennung z. B. `"fake:" || normalisierte E-Mail`.

### 2.5 Wire-Format (alle Nachrichten Base64url **ohne Padding**, `base64::URL_SAFE_NO_PAD`, strenger Decoder: Padding oder Standard-Alphabet wird abgelehnt)

| API-Name (serenity) | RFC-Name | Bytes | Layout |
|---|---|---|---|
| `registrationRequest` | RegistrationRequest | 32 | blinded_element |
| `registrationResponse` | RegistrationResponse | 64 | evaluated_element (32) \| server_s_pk (32) |
| `registrationRecord` | RegistrationRecord / registration_upload | 192 | client_s_pk (32) \| masking_key (64) \| envelope: nonce (32) \| auth_tag (64) |
| `startLoginRequest` | KE1 | 96 | blinded_element (32) \| client_nonce (32) \| client_e_pk (32) |
| `loginResponse` | KE2 | 320 | evaluated_element (32) \| masking_nonce (32) \| masked_response (128) \| server_nonce (32) \| server_e_pk (32) \| server_mac (64) |
| `finishLoginRequest` | KE3 | 64 | client_mac |
| `sessionKey` | session_key | 64 | auf beiden Seiten gleich |
| `exportKey` | export_key | 64 | nur Client (aus `randomized_pwd`), Server sieht ihn nie; stabil über Logins |
| `serverStaticPublicKey` | server_s_pk | 32 | Client-Ausgabe, entspricht `getPublicKey(serverSetup)` |

Interne serenity-Zustände (nicht interoperabel nötig): `clientRegistrationState` 64, `clientLoginState` 192
(Blind 32, KE1 96, Client-Ephemeral-Sk 32, Nonce 32), `serverLoginState` 128 (`session_key` 64 \| `expected_client_mac` 64).
Der PHP-Server hat seinen eigenen Zustand (Plan 3.3).

### 2.6 Fehlersemantik des Clients

`finishLogin` liefert bei **jedem** Protokollfehler (falsches Passwort, Envelope/MAC-Prüfung, Fake-Konto) `undefined`; es wirft nur bei
Base64-/Deserialisierungsfehlern (z. B. Punkt ungültig). Falsches Passwort und unbekanntes Konto sind für den Client daher nicht
unterscheidbar (getestet). Der Client prüft zusätzlich auf reflektierte Werte (`evaluated == blinded` → Fehler).

### 2.7 `serverSetup` ist parsebar

Base64url, 128 Bytes (171 Zeichen): `oprf_seed` (64) \| `server_private_key` (32, kanonischer little-endian Skalar) \| `dummy_public_key` (32).
Der Public Key wird aus dem Private Key berechnet (`sk * Basepunkt`, nachgeprüft). Der PHP-Server kann daher mit demselben Setup arbeiten
(`OPAQUE_OPRF_SEED` ist **64 Byte**, nicht 32 wie im Plan) und die Transkripte replizieren. Eigenes Setup erzeugen: 64 Zufallsbytes,
Zufallsskalar (`sodium_crypto_core_ristretto255_scalar_random`), `dummy_pk` = Zufallselement.

## 3. Testvektoren

Extraktion: `frontend/scripts/opaque/extract-rfc-vectors.mjs` (parst die RFC-Textdateien; `rfc-editor.org` und `ietf.org` liefern byte-identische
Dateien). Ablage in `backend/tests/Opaque/fixtures/`.

| Datei | Quelle | Inhalt |
|---|---|---|
| `rfc9807-vectors.json` | RFC 9807 Anhang C | alle Vektoren mit OPRF ristretto255-SHA512; P-256 weggelassen. Alle Vektoren: KSF = Identity, **Context = `"OPAQUE-POC"`** (`4f50415155452d504f43`) |
| `rfc9497-oprf-vectors.json` | RFC 9497 A.1.1 | Seed/KeyInfo/skSm + 2 OPRF-Vektoren (Mode 0, Batch 1) |
| `rfc9380-xmd-sha512-vectors.json` | RFC 9380 K.3 | 10 Vektoren `expand_message_xmd` SHA-512 (DST `QUUX-V01-CS02-with-expander-SHA512-256`, len 0x20 und 0x80) |

RFC 9807 Zuordnung zu unserer Suite (`matchesOurSuite` im JSON):

| Vektor | OPRF | KE-Gruppe | Identitäten | nutzbar |
|---|---|---|---|---|
| C.1.1 | ristretto255 | ristretto255 | Public Keys | ja, voll (Registrierung + KE1/KE2/KE3, Session-/Export-Key) |
| C.1.2 | ristretto255 | ristretto255 | alice / bob | ja, voll |
| C.2.1 | ristretto255 | ristretto255 | alice / bob | ja, Fake-KE2 |
| C.1.3, C.1.4, C.2.2 | ristretto255 | curve25519 | | nur OPRF-Teil (OPRF-Key, Registrierungsantwort, evaluierte Elemente) |
| C.1.5, C.1.6, C.2.3 | P-256 | P-256 | | nicht anwendbar |

Folgen für AP 2/3: Der Server braucht einen konfigurierbaren Context (Produktion leer, Vektoren `OPAQUE-POC`) und injizierbare
Zufallswerte (Nonces, Server-Keyshare-Seed). Weil die Vektoren KSF=Identity nutzen, prüfen sie nur die Serverseite
(gegeben Record + KE1 + Seeds muss KE2 byte-identisch entstehen, gegeben KE3 der Session-Key); das ist die Rolle des Servers.

**Verifikation im Spike:** ein 60-Zeilen-PHP-Skript (nur `ext-sodium` + `hash_hmac`; nicht im Repo) reproduziert byte-genau
(a) alle RFC-9380-Vektoren, (b) beide RFC-9497-Vektoren inkl. `DeriveKeyPair`, (c) für C.1.1 und C.1.2 den OPRF-Key, die
Registrierungsantwort, das vollständige **KE2**, die Client-MAC (KE3) und den **Session-Key**. Damit sind die Fixture-Transkription
und der Bauplan in 2.3/2.4 doppelt belegt. Risiko „Server in PHP/sodium bauen“ ist deutlich kleiner als im Plan angenommen
(`sodium_crypto_core_ristretto255_from_hash`, `scalar_reduce` (64 B little-endian), `scalarmult_ristretto255(_base)`, `scalar_invert` reichen).

## 4. Referenz-Transkripte aus serenity

`frontend/scripts/opaque/generate-serenity-transcripts.mjs` (Node 22, 1 s Laufzeit) schreibt
`backend/tests/Opaque/fixtures/serenity-transcripts.json`: ein `serverSetup` (Base64url plus zerlegt in Hex-Felder), drei Nutzer
(ASCII-Passwort, Unicode/Emoji, 128 Zeichen mit eigenen `identifiers`), je Registrierung, erfolgreicher Login und Login mit falschem Passwort
(`clientAccepted=false`), plus ein unbekanntes Konto (`registrationRecord: null`). Profil `memory-constrained`.
Enthalten sind alle Nachrichten, Zustände, `exportKey`, `sessionKey`, `serverStaticPublicKey`.

Replay im Spike (PHP, ohne Argon2): Registrierungsantwort byte-identisch aus Setup + `userIdentifier` + Request; evaluiertes Element
der Login-Antwort identisch (auch Fake); `masked_response` mit dem `masking_key` des Records entmaskiert zu `server_pk || envelope`. Grenze: Der Server erzeugt
frische Zufallswerte, sein KE2 kann daher nicht byte-gleich nachgebaut werden, und die Server-Ephemeralschlüssel sind nicht im Fixture.
Die Vollprüfung des Schlüsselplans leisten die RFC-Vektoren (C.1.1/C.1.2) und der spätere Live-Interop-Test (AP 4).

## 5. KSF-Zeiten (headless Chromium, Playwright)

Maschine: Apple M4 Pro (Desktop), macOS 27.0.1, Chromium 148.0.7778.96, Hauptthread, ein Aufruf = ein Argon2id (WASM, ein Thread).
`finishRegistration` bzw. `finishLogin` allein (OPRF + Argon2id + Envelope):

| Profil | Registrierung | Login | Anmerkung |
|---|---|---|---|
| memory-constrained | 97-112 ms | 95-100 ms | 5 Läufe, stabil |
| memory-constrained, CPU-Drosselung 4x | 400-430 ms | 400-420 ms | CDP `Emulation.setCPUThrottlingRate`, nur Näherung |
| memory-constrained, CPU-Drosselung 6x | 620-700 ms | 610-640 ms | Näherung für ein schwaches Mobilgerät |
| rfc-recommended | 1,1-1,5 s | 1,1 s | Desktop; gedrosselt 4x: 4,6-5,6 s, 6x: 7,4-8,5 s; ca. 2 GiB Speicher |

Echte Mobilgeräte sind **nicht** gemessen (Drosselung ersetzt weder Speicherbandbreite noch Speicherlimits). Einschätzung: `memory-constrained`
liegt komfortabel unter der Zielgrenze 1-2 s; `rfc-recommended` ist wegen 2 GiB Speicher und mehreren Sekunden auf Mobilgeräten keine Option.
Entscheidung 2 im Plan (memory-constrained) bleibt; ein späterer Wechsel auf `argon2id-custom` mit mehr Iterationen bei 64 MiB
(statt mehr Speicher) wäre die sinnvolle Erhöhung. Vor Rollout auf 2-3 echten Geräten messen (AP 10).

## 6. CSP

Testseite mit dem produktiven Header-Rahmen (`default-src 'self'; ... worker-src 'self' blob:`), Skript als eigene Datei:

- `script-src 'self'` (aktuell): **scheitert**. `WebAssembly.compile()` wirft `CompileError ... violates the following Content Security policy directive because 'unsafe-eval' is not an allowed source`; `securitypolicyviolation` mit `violatedDirective=script-src`, `blockedURI=wasm-eval`.
- `script-src 'self' 'wasm-unsafe-eval'`: **läuft**, keine Verstöße, keine Konsolenmeldung. Es genügt `'wasm-unsafe-eval'`; kein `'unsafe-eval'` nötig. Das WASM kommt als Base64 im eigenen JS-Bundle, es ist keine weitere Quelle (`connect-src`, `wasm-src`) nötig.

Nicht geprüft: Ausführung im Web Worker (der Worker erbt die CSP des Skripts, Dokument-CSP genügt vermutlich); in AP 10/12 mit dem echten Vite-Build per `csp.spec.ts` prüfen.

## 7. Entscheidung Client-Identität (Plan 2.1)

**`credential_identifier` = User-UUID (nur serverseitig); `identifiers` weder Client noch Server angeben (Default = statische Public Keys).**

Begründung:
1. Die Zuordnung E-Mail → UUID macht der Server in `login/start`; der Client muss die UUID nicht kennen und `login/start` verrät sie nicht
   (die OPRF-Antwort ist blind). Eine E-Mail-Änderung entwertet den Record nicht.
2. Eigene `identifiers` würden Client-Wissen erzwingen: `client` = UUID/E-Mail ist beim Login vorab nicht bekannt bzw. änderbar,
   `server` = Host müsste aus `window.location` kommen (Split-Setups, Proxys, `TRUSTED_HOSTS`-Aliase) und würde Domainwechsel zum Record-Bruch machen.
   Identitäten stecken in `auth_tag` und Transkript, ein Wechsel hieße Re-Registrierung aller Konten.
3. Sicherheit: Mit Default-Identitäten sind beide Parteien durch ihre Schlüssel gebunden (RFC-Default); Serverbindung leistet der
   Server-Key, der pro Deployment verschieden ist. Der Context ist ohnehin leer und nicht änderbar.
4. Der Spike bestätigt, dass serenity dies ohne Parameter unterstützt (Default-Pfad, im Transkript-Fixture Nutzer 1 und 2); der Pfad mit
   `identifiers` (Nutzer 3) ist ebenfalls als Fixture vorhanden, falls später doch gebraucht (dann Versionsfeld erhöhen).
5. Unbekannte Konten: stabile Fake-Kennung (`"fake:" || normalisierte E-Mail`) als `credential_identifier`, damit der OPRF-Schlüssel pro Adresse konstant bleibt (2.4).

## 8. Änderungen am Plan / Blocker

Kein Blocker. Anpassungen sind in `OPAQUE-PLAN.md` eingearbeitet (Context leer, Seed 64 B, Fake-Pfad ohne `OPAQUE_FAKE_SEED`, Vektor-Zuordnung,
konfigurierbarer Context und injizierbare Seeds für Tests, Versionsangaben, Entscheidung zu Identitäten, KSF-Messung, CSP-Ergebnis).
Offen: Messung auf echten Mobilgeräten, Worker-Verhalten im Produktions-Build, Kennzeichnung des Profils (`ksf_profile`) im Datenmodell.
