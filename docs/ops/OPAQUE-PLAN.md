# Plan: OPAQUE (RFC 9807) statt Klartext-Passwort-Login

Status: Entwurf, nicht umgesetzt. Stand der Codebasis: Branch `security/audit-followup`.
Umsetzung direkt im PHP-Backend (kein Sidecar). Zielgruppe: Owner und Implementierer der Arbeitspakete (Abschnitt 8).

## 1. Ziel, Sicherheitsgewinn, ehrliche Grenzen

**Ziel:** Der Server sieht das Passwort nie. Heute gehen Klartext-Passwörter an sechs Stellen über die Leitung und durch
PHP (siehe Abschnitt 3.1) und werden mit bcrypt (`algorithm: auto`, Kosten 13) verglichen. Mit OPAQUE speichert der Server
nur einen Registrierungs-Record; ein Login ist eine authentifizierte Schlüsselvereinbarung (3DH), das Passwort verlässt
den Browser nie.

**Gewinn:**
- Passwörter tauchen nicht in Request-Bodies auf: Access-Logs mit Body, WAF/Proxy, TLS-Terminator, APM/Fehlerreports,
  PHP-Fehlerdumps (Stacktraces mit Argumenten), versehentliches Logging.
- Datenbank-Leak ohne den OPRF-Seed ist wertlos für Offline-Angriffe (anders als bcrypt-Hashes). Mit Seed: Angreifer
  muss pro Kandidat Argon2id im Client-Stil rechnen (KSF), also mindestens so teuer wie heute.
- Pre-Computation-Resistenz (kein Hash-Lookup), keine Passwort-Wiederverwendungsleaks über den Server.
- Der OPRF-Seed und das AKE-Schlüsselpaar sind Secrets in der Umgebung (`.env.local`/Secret-Store), nicht in der DB.

**Ehrliche Grenzen:**
- Die SPA wird vom selben Server ausgeliefert. Ein aktiv kompromittierter Server (oder Deploy-Pipeline, CDN-Vorderseite)
  kann das JS manipulieren und das Passwort im Browser abgreifen. OPAQUE schützt vor *passiver* Server-/Infra-Sicht,
  nicht vor aktiver Kompromittierung. CSP, SRI und Release-Signierung mildern das nur teilweise.
- Server mit gestohlenem OPRF-Seed + DB-Dump kann offline raten (Pre-Computation unmöglich, aber Wörterbuchangriff
  pro Konto). Daher KSF (Argon2id) und Seed getrennt von der DB halten.
- Die Passwort-Policy (8-128 Zeichen, `App\Validator\PasswordPolicy`) ist serverseitig nicht mehr durchsetzbar, nur noch
  clientseitig (Umgehung durch eigenen Client möglich). Akzeptiert; Mindest-Policy bleibt Komfort, kein Sicherheitsversprechen.
  Es gibt auch keine serverseitige Prüfung gegen Leak-Listen (Have-I-Been-Pwned k-Anonymity bleibt clientseitig möglich, aber
  CSP `connect-src 'self'` verbietet Drittanfragen: nicht geplant).
- Es gibt keine unabhängig auditierte PHP-OPAQUE-Implementierung. Wir schreiben Krypto-Code (Server-Seite). Mitigation:
  RFC-Vektoren, Differential-Tests gegen die Client-Bibliothek, externes Review (Abschnitt 7, 9).
- Die JS-Bibliothek (`@serenity-kit/opaque`, Rust-WASM) ist die Vertrauensbasis auf der Client-Seite; Lieferketten-Risiko
  (ein npm-Maintainer) bleibt, daher exaktes Pinnen.

## 2. Architektur

### 2.1 Cipher-Suite und Parameter
- RFC 9807: OPRF(ristretto255, SHA-512), 3DH, HKDF-SHA-512, HMAC-SHA-512, SHA-512; KSF Argon2id (nur Client).
  Entspricht dem Default von `@serenity-kit/opaque` (opaque-ke 4.0.x). Konfiguration: SPIKE klärt, ob serenity
  Nicht-Default-Optionen (Context-String, Identifiers) verwendet; PHP muss bit-identisch folgen (AP 0).
- **Context-String:** `"club-calendar/opaque/v1"` (fest, Teil des Records-Formats). Falls serenity den Context nicht setzbar
  macht, den serenity-Wert übernehmen und hier dokumentieren (er geht in den Transcript-Hash ein).
- **Server-Identität** (`server_identity`): Host aus `APP_URL` (nicht aus dem Request, vgl. Host-Header-Regel M2).
- **Client-Identität / `credential_identifier`:**
  - Empfehlung: `credential_identifier` = stabile User-ID (UUID v7, `User::getId()`), `client_identity` = ebenfalls die User-ID.
  - Grund: E-Mail-Änderung (`AccountService::requestEmailChange`, beendet alle Sessions) würde bei E-Mail als Identität
    den Record entwerten und einen kompletten Re-Registrierungsflow erzwingen (Passwort nötig, geht aber nur mit dem alten Record).
  - Konsequenz: `login/start` muss E-Mail -> User-ID auflösen (server-seitig, wie `identify`), der Client kennt die ID nicht
    vorab; der Server liefert sie nicht zurück, sondern die Antwort ist ein OPRF-Ergebnis über `credential_identifier = user id`.
    Der Client setzt für die AKE `client_identity`: Dafür muss der Client die ID kennen. Lösung: `login/start`-Antwort enthält
    `userId` NICHT; stattdessen `client_identity` weglassen (RFC: Default = Client-Public-Key). Empfehlung: Identitäten leer
    lassen (Public Keys), nur `credential_identifier` = User-ID serverseitig. Der Spike prüft, dass serenity das so unterstützt.
  - Der OPRF-Key pro Konto wird aus `oprf_seed` und `credential_identifier` abgeleitet (RFC 9807 `DeriveKeyPair`-Weg),
    es wird nichts pro Konto gespeichert außer dem Record.
- **Argon2id-KSF-Profil** (Client): Wahl siehe Abschnitt 9 (Entscheidungen). Das Profil wird pro Konto als `opaque_version` /
  `ksf_profile` gespeichert und in `identify` und `login/start` an den Client geliefert (Profilwechsel später möglich).

### 2.2 Record-Format
- `user.opaque_record` (`VARBINARY(256)`, nullable): serialisierter RFC-Record (`client_public_key` 32 B, `masking_key` 64 B,
  Envelope `nonce` 32 B + `auth_tag` 64 B = 192 B).
- `user.opaque_version` (`SMALLINT`, nullable): Protokoll-/Profilversion. Version 1 = ristretto255-SHA512, 3DH, Context v1,
  KSF-Profil A. Bei künftigen Änderungen (serenity-Breaking-Changes: Context-Wechsel in 0.9.0, Record-Inkompatibilität in 1.0.0)
  bleibt der alte Pfad bis zur Re-Registrierung lauffähig oder das Konto ist reset-pflichtig.
- Spalte `password` (bcrypt) bleibt bis zum Ende von Phase 2 (Abschnitt 6).

### 2.3 Server-Setup und Schlüssel
- Env: `OPAQUE_OPRF_SEED` (32 B, base64), `OPAQUE_SERVER_PRIVATE_KEY` (32 B Ristretto-Skalar, base64; öffentlicher Schlüssel wird
  abgeleitet), `OPAQUE_FAKE_SEED` (Seed für Fake-Records), optional `OPAQUE_ENABLED` (Feature-Flag, siehe 6).
  Defaults/Doku in `backend/.env.example` und `backend/config/services.yaml`; Start schlägt fehl bei fehlendem oder falsch
  langem Wert, wenn `OPAQUE_ENABLED=1`.
- CLI: `app:opaque:generate-keys` gibt die drei Werte aus (ohne zu speichern). Docker: `docker/entrypoint.sh` generiert sie
  NICHT automatisch (anders als JWT-Keys): ein automatisch erzeugter, nicht persistierter Seed würde bei jedem Neustart alle
  Konten entwerten. Im Entrypoint nur Prüfung und klare Fehlermeldung.
- **Rotation:** Seed/Server-Key-Wechsel entwertet alle Records. Daher versionierte Schlüsselmenge
  `OPAQUE_KEYS=<id>:<seed>:<priv>,...` und `user.opaque_key_id`; neue Registrierungen nutzen den aktuellen Schlüssel, alte
  Konten werden beim nächsten Login (über Reauth/Re-Registrierung) migriert. Reicht für Kompromittierung eines Schlüssels:
  Notfall = alle Konten reset-pflichtig (Phase-2-Mechanismus wiederverwenden). Diese Story ist ein eigenes AP (M).

### 2.4 PHP-Modul `App\Opaque\` (`backend/src/Opaque/`)
- `Ristretto` (dünner Wrapper um `sodium_crypto_core_ristretto255_*`, `sodium_crypto_scalarmult_ristretto255*`, mit
  `is_valid_point`-Prüfung und Ablehnung des Identitätselements bei jedem Eingabepunkt).
- `ExpandMessageXmd` + `HashToGroup` (RFC 9380 `expand_message_xmd` mit SHA-512, DST `HashToGroup-OPAQUE...` laut RFC 9497
  contextString; Ausgabe 64 B -> `sodium_crypto_core_ristretto255_from_hash`).
- `Oprf` (RFC 9497 Base-Mode: `blindEvaluate`, `deriveKeyPair`, nur Server-Seite; `finalize` nur für Tests/Fake).
- `Hkdf` (Extract/Expand, `HKDF-Expand-Label` mit `"OPAQUEv1-"`-Präfix wie RFC 9807 §6.4.2/§3.3), `Mac`.
- `KeySchedule` (3DH: Preamble, Transcript-Hash, `km2/km3/session_key`, `server_mac`/`client_mac`).
- `Server` (`registrationResponse`, `startLogin` -> `ke2` + State, `finishLogin(state, ke3)` -> `session_key` oder Exception;
  `RegistrationRecord`-Wertobjekt mit Parser, der Längen und Punktgültigkeit prüft).
- `FakeRecord` (RFC 9807 §10.9: deterministisch aus `OPAQUE_FAKE_SEED` + Identifier ein gefälschter Record + gefälschter
  Masking-Key; Antwort für unbekannte Konten und für Konten ohne Record (SSO-only/Passkey-only/Legacy-ohne-Record) ist
  für den Beobachter nicht unterscheidbar).
- `OpaqueKeys` (lädt Env, validiert), `OpaqueException` (alle Fehlerpfade -> gleiches 401 `invalid_credentials`).
- Alles `final readonly`, `declare(strict_types=1)`, konstante Zeit via `hash_equals`/`sodium_memcmp` für alle MAC-Vergleiche,
  `sodium_memzero` für Schlüsselmaterial. Eigener Service-Tag in `config/services.yaml`; kein Symfony-Security-Authenticator:
  Controller + `AuthService` stellen weiter über `TokenService::tokenResponse` die Tokens aus.
- `ext-sodium` ist heute nur transitiv (`lcobucci/jwt`) abgedeckt: `"ext-sodium": "*"` explizit in `backend/composer.json`
  ergänzen. Lokal ist `sodium` geladen; das Docker-Image (`docker/Dockerfile` installiert nur `pdo_mysql intl gd opcache`)
  bringt sodium in `php:8.4-fpm-alpine` mit, unverifiziert: im Build `php -m | grep sodium` als Check (AP 1).

### 2.5 Symfony-Integration
- Neuer `OpaqueController` (`/api/auth/opaque/...`) und `OpaqueService` (Orchestrierung: Rate-Limits, User-Lookup, Zustand).
- `AuthService::login()` wird aufgeteilt: `findLoginUser()` / `completeLogin(User)` (E-Mail-Bestätigungscode-Versand
  `sendCodeIfDue`, `tokenResponse`) wird von Legacy- und OPAQUE-Pfad geteilt. `needsRehash`/bcrypt bleibt bis Phase 2.
- Gate-Logik bleibt unverändert, weil sie nur an `tokenResponse` und an das Tokenformat hängt:
  `EmailVerificationGateListener` (Restricted Session für unverifizierte Nutzer), `ConsentGateListener` und das Flag `lc`
  (wird in `tokenResponse` pro neuer Familie gesetzt), `SessionVersionListener` (`tv`).

## 3. API-Design

### 3.1 Heutige Klartext-Stellen (Mapping)
| Heute | Datei | Ersatz |
|---|---|---|
| `POST /api/auth/register` (`password`) | `AuthController.php:81`, `AuthService::register` | `opaque/register/start` + `/finish` |
| `POST /api/auth/login` | `AuthController.php:118`, `AuthService::login` | `opaque/login/start` + `/finish` |
| `POST /api/auth/reset-password` | `AuthController.php:180`, `PasswordResetService::reset` | Reset-Token + `opaque/register/*` |
| `POST /api/auth/change-password` | `AuthController.php:208`, `AccountService::changePassword` | Reauth-Ticket + `opaque/register/*` |
| `DELETE /api/auth/me` (`password`) | `AuthController.php:402`, `ReauthenticationService::assertConfirmed` | Reauth-Ticket (`purpose=delete-account`) |
| Passkey-Registrierung (`password`) | `WebAuthnController.php:40-43` | Reauth-Ticket (`purpose=passkey-register`) |
| **`POST /api/auth/change-email` (`password`)** | `AuthController.php:208` (Zeile der Methode `changeEmail`), `AccountService::assertPassword` | Reauth-Ticket (`purpose=change-email`). In der Auftragsliste fehlend. |
| CLI `app:user:create`, `app:user:set-password` | `Command/PasswordInputTrait.php` | siehe 6.7 |

### 3.2 Neue Endpunkte (alle unter `/api/auth/opaque`, öffentlich bzw. wie angegeben; alle JSON, binär base64url)
```
POST /register/start    {email}|{} (JWT je nach Kontext), {registrationRequest}  -> {registrationResponse}
POST /register/finish   {registrationRecord, ...kontextabhängig}                  -> je Kontext
POST /login/start       {email, startLoginRequest}   -> {loginResponse, loginState, ksfProfile}
POST /login/finish      {loginState, finishLoginRequest} -> Tokenpaar (wie bisher inkl. emailVerificationRequired)
POST /reauth/start      (JWT) {purpose, startLoginRequest} -> {loginResponse, loginState, ksfProfile}
POST /reauth/finish     (JWT) {loginState, finishLoginRequest} -> {reauthTicket, expiresIn}
```
Kontexte der Registrierung (`register/start|finish`), jeweils mit eigenem Berechtigungsnachweis:
1. **Signup:** `register/start {email, name?}` öffentlich. `register/finish {record, name, email, language, acceptedDocuments}` legt
   den Nutzer an (`AuthService::register`-Logik: Legal-Consent, Registration-Policy, Race-Schutz über Unique-Index,
   Verifikationsmail, Tokenpaar). `register/start` legt NICHTS an und prüft nur das Rate-Limit; `email_taken` erst bei `finish`
   (400 wie heute). Der `finish` wird an den `start` gebunden (signiertes, kurzes `registrationState` mit E-Mail, vorab
   berechnetem Schlüssel-Id und Nonce, `SignedTokenService`).
2. **Reset:** `{resetToken}` statt E-Mail; Token wie in `PasswordResetService` (atomares `used_at`-Update beim `finish`, nicht
   beim `start`), `finish` beendet alle Sessions, bestätigt die Adresse, verwirft wartende E-Mail-Änderung, versendet die
   "Passwort geändert"-Mail (heutiges Verhalten bleibt).
3. **Change:** JWT + `reauthTicket(purpose=change-password)`; `finish` bumpt `tokenVersion`, liefert neues Tokenpaar der neuen
   Familie (`AccountService::changePassword`-Semantik, `consentOk` weiterreichen), Mail wie heute.
4. **Upgrade (Legacy->OPAQUE):** siehe 6.

### 3.3 Server-Zustand zwischen KE2 und KE3
- `auth_nonce` (`NonceStore`, `Entity/AuthNonce`) speichert nur einen Hash plus Ablaufzeit, KEIN Payload, und ist daher nur für
  "einmal einlösen" geeignet. `SignedTokenService` signiert (HMAC), verschlüsselt nicht.
- Empfehlung: `loginState` = AEAD-versiegelter Blob (`sodium_crypto_secretbox` mit aus `APP_SECRET` abgeleitetem Schlüssel,
  Purpose-getrennt) mit `{userId|fake, expected_client_mac, session_key, ke1-Transcript-Hash, exp, nonce}`; TTL 60 s;
  Einmaligkeit via `NonceStore::consume('opaque-login', nonce, exp)` beim `finish`. Vorteil: keine neue Tabelle, kein Cron.
  Der Client sieht den Blob, kann ihn aber weder lesen noch verändern; Replay des KE3 scheitert am Nonce.
- Alternative (verworfen, falls Review die Variante ablehnt): Tabelle `opaque_login_state` (+ `app:prune-*` Cron).
- Fake-Pfad: Auch für unbekannte Konten wird ein vollständiger KE2 samt `loginState` ausgegeben; `finish` scheitert immer mit
  dem gleichen 401 `invalid_credentials` (keine Unterscheidung nach Zeit: gleiche Rechenwege, siehe 7).

### 3.4 Reauth-Ticket
- `SignedTokenService::issue('opaque-reauth', {uid, tv, purpose, jti}, 300)`. Verbrauch einmalig (`NonceStore`), gebunden an
  Nutzer, `tokenVersion` und Zweck (`delete-account`, `passkey-register`, `change-email`, `change-password`).
  Ersetzt den Passwort-Pfad von `ReauthenticationService::assertConfirmed($user, $purpose, $password, $code)`; neuer Parameter
  `?string $reauthTicket`. Konten ohne Passwort behalten den 6-stelligen Mail-Code unverändert (`sendCode`, 409 `has_password`
  gilt künftig für Konten mit Passwort-Record ODER Legacy-Hash).
- Controller-Änderungen: `AuthController::deleteMe`, `WebAuthnController::registrationOptions`,
  `AuthController::changeEmail` (`password` -> `reauthTicket`), Dtos in `backend/src/Dto/Auth/*`.

### 3.5 Rate-Limits und Aufzählungsschutz
- `AuthRateLimiter::assertLoginAllowed(Request, email)` (10/15 min IP, 5/15 min je Adresse) wird bei `login/start` UND
  `login/finish` geprüft: Fehlversuche zählen am `finish` (Passwort-Raten geschieht erst dort), `recordLoginSuccess` nur bei
  Erfolg. `identify` bleibt unverändert (bekanntes Orakel, siehe CLAUDE.md "Rate limits").
- Neu in `rate_limiter.yaml`/`AuthRateLimiter`: `opaque_register_*` (IP, wie register 5/h; plus E-Mail 3/h), `opaque_reauth_*`
  (je Nutzer 5/15 min, wie `assertAccountDeleteAllowed`). Prüfung wie bisher vor DB/Hashing.
- Antworten für unbekannte und SSO-/Passkey-only-Konten identisch (Fake-Record). `identify` erhält additiv `auth`
  (`opaque|legacy|none`, nur wenn Status `login`); das ist ohnehin bereits ein Orakel für die Existenz, `none` verrät zusätzlich
  "kein Passwort" (SSO-/Passkey-only): vertretbar, die UI braucht es für die Wahl der Methode. Kein weiteres Leck über
  `login/*`.
- Fehlercodes: unverändert `invalid_credentials` (401 Login; 400 Reauth mit Feld `password` wie heute für die UI-Kompatibilität),
  neu: `invalid_opaque_message` (400, Format/Punkt ungültig), `opaque_state_invalid` (400, Zustand abgelaufen/benutzt),
  `reauth_required` (403/400, Ticket fehlt/abgelaufen), `reset_required` (409, Phase 2), `opaque_unavailable` (503 bei Flag aus).
  Alle in `ErrorCode` in `docs/api/openapi.yaml` ergänzen; Frontend matcht auf `ApiError.code`.
- `OpenApiSpecTest` erzwingt Gleichstand von Routen und `docs/api/openapi.yaml`: jede neue Route zugleich dort dokumentieren
  (Auth-Abschnitt, Schemas, "Quotas and input limits", Sicherheits-/Reauth-Beschreibung).

## 4. Frontend

- Paket `@serenity-kit/opaque` **exakt gepinnt** (`"1.1.x"` ohne `^`) in `frontend/package.json`. Wrapper `frontend/src/lib/opaque/`
  (`client.ts`: `registerStart/Finish`, `loginStart/Finish`, `ready`), nur über dynamisches `import()` geladen, damit das
  WASM (inline-Base64, ca. mehrere hundert KB) nicht in den Erst-Bundle kommt: Route-Chunk `src/pages/lazy.ts` plus Prefetch
  beim Fokus des Passwort-Feldes.
- KSF läuft im Browser (Argon2id, 64 MiB). Empfehlung: in einem Web Worker (CSP `worker-src 'self' blob:` erlaubt das bereits,
  Vite-Worker-Konfiguration prüfen), damit die UI nicht einfriert; Fallback Haupt-Thread mit "Button disabled + Spinner".
- **UX zwei Roundtrips + KSF:** Ein Submit löst `login/start` -> lokale KSF-Zeit (ca. 0,5-2 s auf Mobilgeräten) ->
  `login/finish` aus. Button zeigt Fortschritt (vorhandener `Button`-`loading`, `Skeleton`/`FullPageLoader` nicht nötig).
  Fehler beim Verschlüsseln/KSF (Out-of-Memory auf alten Mobilgeräten) separat behandeln: neuer i18n-Key
  `auth.opaqueUnsupported`; kein Fallback auf Legacy-Login (Downgrade-Angriff).
- **Passwort-Policy** nur noch clientseitig: `frontend/src/lib/password.ts` bleibt die einzige Quelle (8-128), plus Test
  `lib/__tests__/password.test.ts`. Backend-`PasswordPolicy` bleibt für Legacy-Pfad/CLI bis zum Ende von Phase 2, danach nur
  noch für CLI-Reset-Pfade (Abschnitt 6.7).
- Betroffene Stellen:
  - `pages/SignInPage.tsx`, `components/auth/LoginStep.tsx`, `components/auth/SignupStep.tsx` (Signup: Passwort -> `register/start`,
    lokal Record erzeugen, `register/finish` mit Consent-IDs); der identify-`auth`-Wert entscheidet Legacy/OPAQUE.
  - `pages/ResetPasswordPage.tsx`, `lib/passwordReset.ts`, `pages/ForgotPasswordPage.tsx` (unverändert, nur Reset-Seite ändert).
  - `components/profile/PasswordSection.tsx` (Change), `DeleteAccountDialog.tsx`, `PasskeyReauthDialog.tsx`,
    `AccountSection.tsx` bzw. E-Mail-Änderungsdialog (Reauth-Ticket), `ConsentPage.tsx` (Konto löschen), `ProfilePage.tsx`.
  - `components/ui/shared/PasswordField.tsx` bleibt unverändert; neuer gemeinsamer Hook `useReauth(purpose)` liefert Ticket
    (verhindert Duplikate in den drei Dialogen, Regel "Shared UI").
  - `lib/api.ts`: neue Fehlercodes, `AuthProvider.tsx` unverändert (Tokenformat gleich).
  - OAuth/MCP-Consent-Login nutzt `SignInPage`; automatisch abgedeckt, E2E `mcp-consent.spec.ts` anpassen.
- i18n: neue Keys in `de.json` UND `en.json` (identisch, `i18n.test.ts`), nicht mehr genutzte entfernen.
- Hilfeseiten (Pflicht lt. CLAUDE.md, DE und EN, Screenshots prüfen): `frontend/docs/{de,en}/70-settings/password.md`,
  `delete-account.md`, `passkeys.md`, `email-change.md`, `10-getting-started/sign-up.md`, `80-support/faq.md`,
  `80-support/troubleshooting.md`, `70-settings/index.md`, `70-settings/sessions.md`, `70-settings/linked-accounts.md`,
  `60-ai-assistants/manage-access.md`. Inhalte: "Ihr Passwort verlässt Ihr Gerät nicht", längere Anmeldezeit, "Passwort vergessen
  = Reset ohne Wiederherstellung des alten Passworts" (war schon so), Hinweis auf Browser-Anforderung (WebAssembly).
  `CHANGELOG.md` (`Unreleased`) ergänzen.

## 5. CSP

- `script-src 'self'` -> `script-src 'self' 'wasm-unsafe-eval'` in `backend/public/.htaccess` UND `docker/Caddyfile`
  (müssen identisch bleiben; `backend/tests/Unit/SecurityHeadersConfigTest.php` anpassen).
- `frontend/e2e/csp.spec.ts` (`E2E_CSP=1`, Produktions-Build): Test-Fall ergänzen, dass Login/Registrierung mit WASM keine
  `securitypolicyviolation` auslöst; `frontend/src/lib/__tests__/cspStyleHash.test.ts` bleibt (kein Einfluss).
- `'wasm-unsafe-eval'` erlaubt WebAssembly-Kompilierung, aber weiterhin kein `eval()`/`new Function()` für JS. Nur WASM, das
  das eigene Skript lädt (WASM inline im Chunk, keine Fremdquelle). Gegenmaßnahme gegen das Risiko: Kein `'unsafe-eval'`.
- CLAUDE.md "Deployment"-Absatz und `docs/ops/OPERATIONS.md` aktualisieren (CSP-Beschreibung).
- Alternative ohne CSP-Änderung gibt es mit der gewählten Bibliothek nicht (reines WASM). Eine reine JS-Implementierung wäre ein
  eigenes Auditprojekt: verworfen.

## 6. Migration im Produktivbetrieb

Grundprinzip: Dual-Stack, kein Downgrade, Nutzer wechseln beim nächsten Login, Rest wird per Reset erledigt.

### 6.1 Schema (Doctrine-Migration, neue `Version2026…`)
`user.opaque_record VARBINARY(256) NULL`, `user.opaque_version SMALLINT NULL`, `user.opaque_key_id VARCHAR(16) NULL`.
Kein Index nötig. `password` bleibt. Entity `App\Entity\User` (UUID-Regeln unverändert), Fixtures/Raw-SQL-Inserts bleiben gültig.

### 6.2 Feature-Flag und Rollout
- `OPAQUE_ENABLED` (Default `0`): `0` = alles wie bisher, `identify` liefert nur `legacy`; `1` = neue Endpunkte aktiv.
- Gestaffelt: `OPAQUE_ROLLOUT_PERCENT` (0-100, Hash der User-ID) für den Upgrade-Pfad; Signup und Reset sind bei Flag `1`
  sofort OPAQUE (neue Konten haben nie einen Legacy-Hash). Rollback = Flag aus: OPAQUE-Konten (ohne Legacy-Hash) können dann nicht mehr
  einloggen -> deshalb Reset-Pfad über `opaque_unavailable` Hinweis; vor dem Rollback prüfen (Abschnitt 6.8).

### 6.3 Dual-Stack über `identify`
`POST /api/auth/identify` -> `{email, status, auth}` mit `auth`: `opaque` (Record vorhanden), `legacy` (nur bcrypt), `none`
(kein Passwort, SSO/Passkey-only), `reset_required` (Phase 2, Hash entfernt, keine Record). Das OpenAPI-Schema und `IdentifyDto`-Antwort
(`AuthController::identify`) erweitern; Frontend wählt Login-Schritt danach.

### 6.4 Upgrade beim Legacy-Login
1. Client loggt wie bisher per `POST /login` mit Klartext (letztes Mal), Server prüft bcrypt.
2. Antwort enthält zusätzlich `opaqueUpgrade: {ticket}` (signiert, 5 min, einmalig, an Nutzer + Session-Familie gebunden), wenn
   Flag + Rollout aktiv.
3. Client macht sofort `opaque/register/start|finish` mit dem Ticket (gleiches Passwort, im Speicher), Server setzt Record,
   `opaque_version`, löscht den bcrypt-Hash (`setPassword(null)`) im selben Commit, KEIN `tokenVersion`-Bump (laufende Sessions
   bleiben gültig, wie beim bisherigen Rehash).
4. Schlägt Schritt 3 fehl (Netz, Tab zu), bleibt alles beim Alten; nächster Login versucht es erneut.
Das Upgrade-Ticket (nicht nur das JWT) ist nötig, damit ein gestohlenes Access-Token nicht das Passwort durch einen
Angreifer-Record ersetzt.

### 6.5 Phase 2: Stichtag
- Ankündigung: Banner in der SPA, Hilfeseite, Benachrichtigungsmail an alle Konten mit Legacy-Hash
  (`app:opaque:notify-legacy --deadline=YYYY-MM-DD`, begrenzte Rate, `DeferredMailer`, nur verifizierte Adressen, pro Nutzer einmal).
- Nach dem Stichtag: `app:opaque:retire-legacy` nullt alle verbleibenden bcrypt-Hashes (dry-run Standard, `--force`). Betroffene
  Nutzer bekommen `auth: reset_required` und den bestehenden "Passwort vergessen"-Pfad (Reset setzt per OPAQUE ein neues Passwort).
  Sessions bleiben gültig (Hash entfernen bumpt nichts). Konten mit SSO/Passkey unberührt.
- Danach Aufräumen: `needsRehash`, `UserPasswordHasher`-Nutzung in `AuthService::login`, `ReauthenticationService`, Legacy-Endpunkte
  (`/login`, `/register`, `/change-password`, `reset-password` mit Klartext) entfernen; `User implements PasswordAuthenticatedUserInterface` prüfen
  (bleibt nötig, `getPassword()` -> null) und `security.yaml` `password_hashers` entfernen; Migration `DROP COLUMN password`
  nach einem weiteren Release.
- Länge der Übergangsphase: siehe Abschnitt 9 (Entscheidungen).

### 6.6 Kein Downgrade
Es gibt keinen Weg von OPAQUE zurück zu bcrypt (der Server kennt das Passwort nie). Der Legacy-Login lehnt Konten mit Record ab.

### 6.7 CLI
- `app:user:create` und `app:user:set-password` (`PasswordInputTrait`) kennen das Passwort im Klartext. Ein PHP-Client für die
  KSF-Seite (Argon2id mit exakt den Client-Parametern + OPAQUE-Client) wäre ein eigenes Modul und muss bit-kompatibel zum JS-Client
  sein: zu aufwändig und fehleranfällig. Empfehlung: Phase 1 wie bisher (setzt Legacy-Hash, Upgrade beim ersten Login). Phase 2:
  `--password` entfernen, CLI legt Nutzer ohne Passwort an und gibt Reset-Link aus (`app:user:reset-link` existiert,
  `RESTRICT_REGISTRATION`-Erstnutzer: `app:user:create` -> Link). `set-password` wird zu "Reset-Link erzeugen + Sessions beenden".
- Neu: `app:opaque:status` (Anzahl total/mit Record/Legacy/ohne Passwort), `app:opaque:generate-keys`,
  `app:opaque:notify-legacy`, `app:opaque:retire-legacy`.

### 6.8 Monitoring und Rollback
- Metrik "Anteil migrierter Konten": `app:opaque:status` (Cron/Ausgabe in Logs, `docs/ops/OPERATIONS.md`), plus Logzeilen
  `opaque.login.success|failure`, `opaque.upgrade.success` (ohne Nutzerdaten/Token; `RedactTokensProcessor` greift).
- Alarm: Verhältnis Fehlschläge/Erfolge `login/finish`, Anstieg `opaque_state_invalid`, Antwortzeiten `login/start`.
- Rollback vor Phase 2: Flag `OPAQUE_ENABLED=0`; Legacy-Hashes sind noch vollständig; bereits migrierte Konten haben keinen Hash mehr
  -> vor dem ersten Upgrade-Rollout entscheiden, ob migrierte Konten ihren bcrypt-Hash zunächst BEHALTEN (zusätzliche Sicherheit:
  `opaque_version` gesetzt, `password` bleibt bis Phase 2). Empfehlung: Hash erst in Phase 2 löschen, nicht beim Upgrade. Das
  verlängert die Zeit, in der Hashes in der DB liegen, macht den Rollback aber verlustfrei. Dann ist der Legacy-Login für
  Konten mit Record trotzdem verboten, sobald das Flag-Rollout stabil ist (Schalter `OPAQUE_ALLOW_LEGACY_FALLBACK`).
- Backups vor jedem Schritt; Schlüssel-Backup (Seed, Server-Key) ist Betriebsvoraussetzung (Verlust = alle Konten reset-pflichtig).

## 7. Teststrategie

- **RFC-Vektoren** (PHPUnit-DataProvider, `backend/tests/Unit/Opaque/`): Appendix C.1.x (Real-Vektoren: Registration-Request/
  Response, KE1/KE2/KE3, Session-Key, Export-Key) und C.2.x (Fake-Response); zusätzlich RFC 9497 (OPRF, ristretto255-SHA512)
  und RFC 9380-`expand_message_xmd`-Vektoren für Hash-to-Group. Einheitlich als JSON-Fixtures in `tests/Unit/Opaque/fixtures/`.
- **Test-only PHP-Client** (`tests/Support/OpaqueTestClient`, mit Identitäts-KSF wie in den RFC-Vektoren): ermöglicht
  PHPUnit-Controller-Tests (Registrierung/Login/Reauth/Reset/Change) ohne Node und macht die vielen bestehenden Tests mit Passwort
  portierbar. Nur im Test-Autoload.
- **Differential-/Interop-Test in CI** mit gepinnter serenity-Version: Node-Skript `frontend/scripts/opaque-interop.mjs` (oder
  Vitest) führt Client-Seite (Registrierung + Login mit echtem Argon2id-KSF-Profil) gegen den PHP-Server; Variante A: PHPUnit startet
  den Node-Prozess (`Process`) und tauscht JSON über stdin/stdout aus; Variante B: PHP-CLI-Harness `bin/console app:opaque:test-server`
  (nur `APP_ENV=test`) und ein Vitest-Test ruft ihn. Empfehlung A. Läuft in `.github/workflows/ci.yml` im Backend-Job
  (Node ist dort für `build:mail` ohnehin vorhanden). Prüft beide Richtungen und Fake-Pfad (unbekannter Nutzer -> Client scheitert
  mit gleichem Fehler wie falsches Passwort), außerdem Context/Identifier-Konfiguration.
- **Kryptografische Negativ-Tests:** ungültige/Identitäts-/nicht-kanonische Ristretto-Punkte, falsche Längen, abgeschnittene Records,
  vertauschte KE-Felder, abgelaufener/wiederverwendeter `loginState`, falscher MAC, `sodium_memcmp`/`hash_equals`-Nutzung
  (statische Prüfung per Test, der den Quelltext nach `===` auf MAC-Variablen greppt), Timing-Test (Mittelwert Fake vs. echt, grobe
  Toleranz, `--group performance`, nicht Teil des Standardlaufs).
- **Controller-Tests** (`tests/Controller/*`): alle neuen Routen, Rate-Limits (429 + `Retry-After`), Gates (unverifizierter Nutzer ->
  restricted session; Consent-`lc`), Race bei `register/finish`, Reset-Token-Einmaligkeit, Reauth-Zweckbindung, `last_admin_of_club`
  bei Löschen, Passkey-Reauth, E-Mail-Wechsel. `AccessControlCoverageTest` (`PUBLIC_PATTERNS`) und `AccessControlBypassTest`
  für die neuen öffentlichen Pfade pflegen; `OpenApiSpecTest`.
- **Frontend:** Vitest für `lib/opaque` (gemockt), Dialoge (`PasswordSection`, `DeleteAccountDialog`, `PasskeyReauthDialog`,
  `LoginStep`, `SignupStep`, `ResetPasswordPage`), bestehende Tests in `pages/__tests__` und `lib/profile/__tests__` anpassen.
- **E2E (Playwright):** `frontend/e2e/helpers.ts` registriert vermutlich per API-Aufruf mit Klartext-Passwort: neuer Helper mit
  serenity-Node-Client (`registerOpaque`); betroffene Specs `auth`, `onboarding`, `account`, `profile`, `session-revoked`, `calendar`,
  `mcp-consent`, `csp`, `docs/shots.ts`, `docs/start-events.docs.ts`. Langsame KSF im Test: eigenes schwaches Profil per
  Env nur im E2E-Backend zulässig? NEIN (Downgrade-Risiko); stattdessen Timeouts erhöhen.
- **Externes Review:** vor Phase 2 (Entzug von bcrypt) unabhängiges Review der `App\Opaque\`-Module durch eine Krypto-Fachperson
  (Umfang etwa 1-2 Tage; Fokus: Punkt-Validierung, Fake-Pfade, State-Binding, Konstantzeit, Schlüsselableitung).

## 8. Arbeitspakete (Reihenfolge, Abhängigkeiten, Aufwand)

| AP | Inhalt | Abhängig von | Aufwand |
|---|---|---|---|
| 0 | **Spike**: serenity-kit Optionen (Context, Identifier, KSF-Profile, Wire-Format) gegen RFC-C.1-Vektoren prüfen; Entscheidung Identitäten; Browser-Messung der KSF-Zeit auf realen Geräten; `wasm-unsafe-eval` verifizieren; Ergebnis-Notiz im Repo | - | M |
| 1 | `ext-sodium` in composer.json, Docker `php -m`-Check, `.env.example`/`services.yaml` Konfigurationsgerüst, `OpaqueKeys`, `generate-keys` | 0 | S |
| 2 | Primitive: `Ristretto`, `ExpandMessageXmd`, `HashToGroup`, `Oprf` + RFC-9497/9380-Vektoren | 1 | M |
| 3 | `KeySchedule`, `Hkdf`, `Mac`, `Server` (Reg + Login), `FakeRecord` + RFC-9807-C.1/C.2-Vektoren | 2 | L |
| 4 | Test-only `OpaqueTestClient` + Negativ-Tests + Interop-Skript mit serenity (CI-Job) | 3 | M |
| 5 | DB-Migration (3 Spalten), `User`-Entity, `OpaqueService`, `loginState` (AEAD + NonceStore), Reauth-Ticket | 3 | M |
| 6 | Endpunkte `login/*` + `AuthService`-Split + Rate-Limits + OpenAPI + Controller-Tests | 5 | L |
| 7 | Endpunkte `register/*` (Signup, Reset, Change, Upgrade) + `PasswordResetService`/`AccountService`-Anpassung | 6 | L |
| 8 | Reauth: `reauth/*`, `ReauthenticationService`, `deleteMe`, Passkey-Options, `changeEmail` | 6 | M |
| 9 | `identify` um `auth` erweitern, Feature-Flag, Rollout-Prozent, Monitoring-Logzeilen, `app:opaque:status` | 6 | S |
| 10 | Frontend `lib/opaque`, Worker, Hook `useReauth`, i18n-Keys, Fehlercodes | 0, 9 | M |
| 11 | Frontend: Login/Signup/Reset/Change/Delete/Passkey/E-Mail-Dialoge + Vitest | 10, 7, 8 | L |
| 12 | CSP in `.htaccess`, `Caddyfile`, `SecurityHeadersConfigTest`, `csp.spec.ts`, OPERATIONS.md | 0 | S |
| 13 | E2E-Helper und Specs, Hilfeseiten DE/EN, CHANGELOG, CLAUDE.md/AGENTS.md | 11, 12 | L |
| 14 | Upgrade-Pfad (Ticket, Frontend-Hook nach Legacy-Login), Notify-/Retire-Commands | 7, 11 | M |
| 15 | Schlüsselrotation (`OPAQUE_KEYS`, `opaque_key_id`) | 5 | M |
| 16 | Externes Review, Rollout-Plan, Phase 2 (Stichtag), Legacy-Cleanup, CLI-Umbau | 14, 15 | M + Wartezeit |

Rollout-Reihenfolge in Produktion: 1-9 deployen mit Flag aus -> Migration laufen lassen -> Flag in Staging -> Frontend (10-13) ->
Flag in Produktion (Signup/Reset OPAQUE, Upgrade 10 % -> 50 % -> 100 %) -> Review -> Phase 2.

## 9. Risiken und offene Entscheidungen

| Risiko | Bewertung / Gegenmaßnahme |
|---|---|
| Eigener Krypto-Code, keine Audits | Hoch. RFC-Vektoren, Interop, Review (AP 16), kleine Angriffsfläche (nur Server-Rolle), kein selbst erfundenes Protokoll |
| serenity nicht RFC-konform / Nicht-Default-Optionen | Mittel. Spike (AP 0) entscheidet; Fallback: Bibliothek-Konfiguration anpassen oder serenity-Defaults zum Standard erklären (Interop-Test fixiert das) |
| Breaking Changes serenity (0.9.0 Context, 1.0.0 Record) | Exakt pinnen, `opaque_version`, Upgrade nur bewusst mit Migrationsplan und Re-Registrierungsfluss |
| Mobile Browser-Speicher bei 64 MiB Argon2 | Messen im Spike; Profil notfalls senken (Versionsfeld erlaubt Wechsel) |
| Aktiv kompromittierter Server liefert manipuliertes JS | Bleibt (Abschnitt 1) |
| Verlust Seed/Server-Key | Alle Konten reset-pflichtig; Backup Pflicht |
| Support: Nutzer mit sehr altem Browser/ohne WASM | Anzeige und Hilfe-Hinweis; kein Legacy-Fallback nach Phase 2 |
| Wartung Single-Maintainer | Pin, Lockfile-Review, Dependabot nur Hinweis |

**Entscheidungen (2026-11-09):**
1. **CSP `'wasm-unsafe-eval'`:** entschieden ja. Ohne WASM keine brauchbare OPAQUE-Client-Bibliothek; der Eintrag erlaubt kein
   `eval` von JS. Dokumentieren in CLAUDE.md.
2. **Argon2id-KSF-Profil:** entschieden serenity-Default "memory-constrained" (m=2^16 KiB = 64 MiB, t=3, p=4). Das Profil wird pro
   Konto als `opaque_version`/`ksf_profile` gespeichert, damit künftig ohne Hard-Break erhöht werden kann. Bestätigung durch die
   Messung im Spike (Zielgrenze: ca. 1-2 s auf einem Mittelklasse-Handy).
3. **Länge der Übergangsphase:** entschieden 30 Tage ab Rollout-100 %, danach Stichtag. Erinnerungsmails 14 und 3 Tage vorher.
   Konten ohne Login im Zeitraum werden per Reset wiederhergestellt, kein Datenverlust.
4. Client-Identität: unverändert, entscheidet der Spike (AP 0) (Abschnitt 2.1).
5. Bcrypt-Hash: entschieden erst in Phase 2 löschen (Rollback verlustfrei, siehe 6.8). Bis dahin bleibt der Offline-Angriff über den
   alten Hash möglich.

## 10. Pflege der Abhängigkeiten

| Komponente | Status (Recherche) | Policy |
|---|---|---|
| `@serenity-kit/opaque` 1.1.x | MIT, Rust opaque-ke 4.0.x als WASM, RFC 9807, ca. 45k Downloads/Woche, 2 Haupt-Contributor, 1 npm-Maintainer, 7ASecurity-Pentest; opaque-ke-Audit (NCC 2021) nur alte Version | Exakt pinnen (kein `^`/`~`), Upgrades nur mit Interop-Test + Changelog-Review, Breaking-Changes-Historie beachten (Context 0.9.0, Records 1.0.0); Lockfile-Integrität prüfen |
| `opaque-ke` (transitiv) | wie oben | Version im Spike notieren (`cargo`-Metadaten in der Bibliothek bzw. Release-Notizen) |
| `noxlogic/oprf` | RFC 9497 Base-Mode, v0.9.1, 1 Maintainer, 41 Installs, hängt an `web-token/jwt-framework` | NICHT als Abhängigkeit, höchstens als Referenz für Vektoren/Vergleich |
| `stef/libopaque` | LGPL-3.0, Pre-RFC-Draft, PHP-7-Binding | nicht verwendbar |
| `cloudflare/opaque-ts`, `@aldenml`, andere JS-Libs | Draft-Stände / nicht verwendbar | nicht verwenden |
| `ext-sodium` | in PHP 8.4 enthalten | explizit in `composer.json`, Check im Docker-Build |
| RFC 9807 / 9497 / 9380 | Standards | Vektor-Fixtures im Repo, bei Errata prüfen |

Prozess: Jedes Upgate der Client-Bibliothek läuft durch den CI-Interop-Test; Monatlicher Check auf Advisories
(`npm audit --omit=dev` läuft bereits in CI). Bei verlassenem Projekt: Plan B ist ein Fork/Vendor der gepinnten Version
(Record-Format bleibt RFC-konform, daher bleibt der PHP-Server unabhängig).
