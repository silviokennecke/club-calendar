# Plan: OPAQUE (RFC 9807) statt Klartext-Passwort-Login

Status: Entwurf, nicht umgesetzt; AP 0 (Spike), AP 1 (Konfigurationsgerüst), AP 2 (Primitive) und AP 3 (Server-Rolle, RFC-9807-Vektoren) erledigt, Ergebnisse in `OPAQUE-SPIKE.md` (maßgeblich bei Abweichungen). Stand der Codebasis: Branch `security/audit-followup`.
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
- RFC 9807: OPRF(ristretto255, SHA-512), 3DH (KE-Gruppe ristretto255), HKDF-SHA-512, HMAC-SHA-512, SHA-512; KSF Argon2id (nur Client).
  Entspricht `@serenity-kit/opaque` 1.1.0 (opaque-ke 4.0.1); die Suite ist dort fest, Details und Wire-Format in `OPAQUE-SPIKE.md`.
- **Context-String: leer.** serenity übergibt `context: None` und bietet keine Option. Der frühere Wert `"club-calendar/opaque/v1"`
  entfällt; Domänentrennung zwischen Deployments leisten die Server-Schlüssel. Der PHP-Server hat dennoch einen konfigurierbaren
  Context (Produktion leer), weil die RFC-Vektoren `"OPAQUE-POC"` verwenden.
- **Identitäten (Entscheidung AP 0):** weder `client_identity` noch `server_identity` setzen; Default = statische Public Keys. Der Client
  übergibt keine `identifiers`. Kein Domain- oder Nutzerbezug im Record, E-Mail-Änderung und Hostwechsel entwerten ihn nicht.
- **`credential_identifier`** (nur Server, geht roh in `oprf_key = DeriveKeyPair(HKDF-Expand(oprf_seed, id || "OprfKey", 32), "OPAQUE-DeriveKeyPair")`):
  stabile User-ID (UUID v7, `User::getId()`); `login/start` löst E-Mail → User-ID serverseitig auf, der Client kennt sie nicht.
  Unbekannte Adressen: stabile Fake-Kennung `"fake:" || normalisierte E-Mail` (der OPRF-Schlüssel muss pro Adresse konstant bleiben, sonst
  verrät der Vergleich zweier Versuche mit gleichem Passwort das Fehlen des Kontos).
  Grund für die User-ID: `AccountService::requestEmailChange` beendet alle Sessions, mit E-Mail als Kennung wäre der Record danach wertlos.
- **Argon2id-KSF-Profil** (Client): Wahl siehe Abschnitt 9 (Entscheidungen). Das Profil wird pro Konto als `opaque_version` /
  `ksf_profile` gespeichert und in `identify` und `login/start` an den Client geliefert (Profilwechsel später möglich).

### 2.2 Record-Format
- `user.opaque_record` (`VARBINARY(256)`, nullable): serialisierter RFC-Record (`client_public_key` 32 B, `masking_key` 64 B,
  Envelope `nonce` 32 B + `auth_tag` 64 B = 192 B), in der API Base64url ohne Padding.
- `user.opaque_version` (`SMALLINT`, nullable): Protokoll-/Profilversion. Version 1 = serenity 1.1.0 / opaque-ke 4.0.1: ristretto255-SHA512, 3DH,
  leerer Context, Default-Identitäten, KSF-Profil A (`memory-constrained`). Das Profil steckt nicht im Record, es muss gespeichert und dem Client geliefert werden. Bei künftigen Änderungen (serenity-Breaking-Changes: Context-Wechsel in 0.9.0, Record-Inkompatibilität in 1.0.0)
  bleibt der alte Pfad bis zur Re-Registrierung lauffähig oder das Konto ist reset-pflichtig.
- Spalte `password` (bcrypt) bleibt bis zum Ende von Phase 2 (Abschnitt 6).

### 2.3 Server-Setup und Schlüssel
- Env: `OPAQUE_OPRF_SEED` (**64 B**, base64), `OPAQUE_SERVER_PRIVATE_KEY` (32 B kanonischer Ristretto-Skalar, base64; öffentlicher Schlüssel wird
  abgeleitet; der Dummy-Public-Key für Fake-Records kann daraus abgeleitet werden, kein eigener Wert nötig), optional `OPAQUE_ENABLED` (Feature-Flag, siehe 6).
  Defaults/Doku in `backend/.env.example` und `backend/config/services.yaml`; Start schlägt fehl bei fehlendem oder falsch
  langem Wert, wenn `OPAQUE_ENABLED=1`.
- CLI: `app:opaque:generate-keys` gibt die Werte aus (ohne zu speichern). Docker: `docker/entrypoint.sh` generiert sie
  NICHT automatisch (anders als JWT-Keys): ein automatisch erzeugter, nicht persistierter Seed würde bei jedem Neustart alle
  Konten entwerten. Im Entrypoint nur Prüfung und klare Fehlermeldung.
- **Rotation:** Seed/Server-Key-Wechsel entwertet alle Records. Daher versionierte Schlüsselmenge
  `OPAQUE_KEYS=<id>:<seed>:<priv>,...` und `user.opaque_key_id`; neue Registrierungen nutzen den aktuellen Schlüssel, alte
  Konten werden beim nächsten Login (über Reauth/Re-Registrierung) migriert. Reicht für Kompromittierung eines Schlüssels:
  Notfall = alle Konten reset-pflichtig (Phase-2-Mechanismus wiederverwenden). Diese Story ist ein eigenes AP (M).

### 2.4 PHP-Modul `App\Opaque\` (`backend/src/Opaque/`)
- `Ristretto` (dünner Wrapper um `sodium_crypto_core_ristretto255_*`, `sodium_crypto_scalarmult_ristretto255*`, mit
  `is_valid_point`-Prüfung und Ablehnung des Identitätselements bei jedem Eingabepunkt).
- `ExpandMessageXmd` + `HashToGroup` (RFC 9380 `expand_message_xmd` mit SHA-512, DST `"HashToGroup-" || "OPRFV1-" || 0x00 || "-ristretto255-SHA512"`;
  Ausgabe 64 B -> `sodium_crypto_core_ristretto255_from_hash`; `HashToScalar` = 64 B little-endian mit `sodium_crypto_core_ristretto255_scalar_reduce`).
  Im Spike in PHP mit `ext-sodium` gegen alle RFC-Vektoren bestätigt.
- `Oprf` (RFC 9497 Base-Mode: `blindEvaluate`, `deriveKeyPair`, nur Server-Seite; `finalize` nur für Tests/Fake).
- `Hkdf` (Extract/Expand, `HKDF-Expand-Label` mit `"OPAQUEv1-"`-Präfix wie RFC 9807 §6.4.2/§3.3), `Mac`.
- `KeySchedule` (3DH: Preamble, Transcript-Hash, `km2/km3/session_key`, `server_mac`/`client_mac`).
- `Server` (`registrationResponse`, `startLogin` -> `ke2` + State, `finishLogin(state, ke3)` -> `session_key` oder Exception; Context konfigurierbar, Nonces/Keyshare-Seeds für Tests injizierbar (`DeriveKeyPair(seed, "OPAQUE-DeriveDiffieHellmanKeyPair")`);
  `RegistrationRecord`-Wertobjekt mit Parser, der Längen und Punktgültigkeit prüft).
- `FakeRecord` (wie opaque-ke: `masking_key` 64 Zufallsbytes pro Aufruf, `client_public_key` = fester Dummy-Key, Envelope 96 Nullbytes;
  der OPRF-Schlüssel kommt aus der stabilen Fake-Kennung, siehe 2.1, kein `OPAQUE_FAKE_SEED`; Antwort für unbekannte Konten und für Konten ohne Record (SSO-only/Passkey-only/Legacy-ohne-Record) ist
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
Jede OPRF-Auswertung unter dem Schlüssel eines echten Nutzers (change-password, reset, upgrade, reauth) ist ein Rate-Orakel:
die Credential-Id kommt nur aus serverseitiger Bindung (JWT + Ticket, Reset-Token, signierter Registrierungs-State), nie aus
einem Client-Feld, und jede Auswertung zählt gegen die Nutzer- und IP-Login-Limits (siehe 3.5).

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

**Umgesetzt (AP 5):** `LoginStateSealer` (XChaCha20-Poly1305, Schlüssel per HKDF aus `APP_SECRET`, TTL 120 s weil die Client-KSF nach KE2 läuft). Fester Klartext: ServerLoginState, jti, exp, Purpose (`login` | `reauth:<ticket-purpose>`), Fake-Flag, User-ID (16 B, bei Fake zufällig), `tokenVersion`, SHA-256 des Records. `finish` nimmt den User nur aus dem Blob, verbraucht die jti vor der MAC-Prüfung (`NonceStore`), prüft danach `tokenVersion` und Record-Hash gegen die DB; ein Fake-Zustand scheitert immer. Existierende Konten ohne Record nutzen die User-ID als OPRF-Kennung (stabil bis zur Registrierung), unbekannte `"fake:" || E-Mail`; beide Fake-geflaggt. Ein defekter Record wird geloggt und wie "kein Record" behandelt.

**Umgesetzt (AP 6):** `OpaqueLoginController` (`login/start|finish`), Feldnamen wie 3.2 (`startLoginRequest`, `loginResponse`, `finishLoginRequest`). Flag aus: 503 `opaque_unavailable` vor jeder Schlüsselnutzung. `start`: `assertLoginAllowed` vor DB/Krypto, dann 400 `invalid_opaque_message` (Feld) bei Format/Länge/Gruppenelement. `finish`: KE3-Format 400, danach jeder Fehler (gefälscht, Replay, abgelaufen, Fake, Konto geändert/gelöscht) 401 `invalid_credentials`; kein Adress-Bucket, kein IP-Limit (der Zustand ist einmalig); `recordLoginSuccess` mit der Adresse des Nutzers aus dem Zustand. `AuthService::completeLogin` (Verifikationsmail + `tokenResponse`) teilt sich der Passwort-Login; kein Rehash für OPAQUE.

**Umgesetzt (AP 7):** `OpaqueRegisterController` (`register/start|finish`), Kontext = genau eines der Felder `email`/`registrationState` (Signup), `resetToken`, `reauthTicket` (JWT), `upgradeTicket` (JWT), sonst 400 `invalid_request`. Die Credential-Id kommt nie aus einem Client-Feld: Signup mintet die User-UUID (v7) in den signierten, einmaligen `registrationState` (`OpaqueSignupStates`, 15 min, Nonce wird unmittelbar vor dem Insert verbraucht, ein fehlgeschlagener Consent-Check verbrennt ihn nicht; `User::withPresetId`, E-Mail nur aus dem State, `email_taken` erst beim `finish`), Reset nimmt den User des offenen Links (`userOfOpenToken`, Link wird erst im `finish` verbraucht), Change/Upgrade den JWT-User. Change: Ticket `change-password` wird bei `start` nur geprüft (`OpaqueReauthTickets::isValid`), bei `finish` verbraucht; fehlendes/ungültiges Ticket 403 `reauth_required`. Bcrypt: Signup nie gesetzt (Spalte null), Reset und Change setzen `password = null` (altes Passwort ungültig), Upgrade behält den Hash bis Phase 2 und bumpt keine Tokenversion. Limits: Signup `assertRegisterAllowed` + `assertRegisterEmailAllowed` bei `start`; Reset (unbekannter Link: IP-`other`-Limit), Change, Upgrade `assertLoginAllowed` (IP + Adresse des echten Nutzers) vor jeder Krypto. Upgrade-Ticket: `OpaqueUpgradeTickets` (5 min, einmalig, an User + `tokenVersion` gebunden; die Zugriffs-Tokens tragen keine Familie `fam`, daher keine Familienbindung); Ausstellung nach dem Legacy-Login und Frontend-Hook bleiben AP 14. Neue Codes `opaque_state_invalid` (400), `reauth_required` (403), `opaque_already_registered` (409). `User::hasPasswordCredential()` (bcrypt oder Record) ersetzt `getPassword()`-Prüfungen für "hat ein Passwort" (`hasPassword` in `/me`, Last-Method-Prüfung, Reauth-Code-Pfad: Konten mit Record bekommen keinen Mail-Code). Die Passwortrichtlinie 8-128 gilt für OPAQUE nur clientseitig. Abweichungen: das `finish` des Signups nimmt kein `email`-Feld (nur aus dem State).

**Umgesetzt (AP 8):** `OpaqueReauthController` (`reauth/start|finish`, JWT Pflicht, Nutzer = JWT-User). `start {purpose, startLoginRequest}`: Zweck-Allow-List (400 `invalid_request`, Feld `purpose`), dann vor jeder Krypto `assertLoginAllowed` (IP + Adresse) plus zweckeigenes Limit (`delete-account` -> `assertAccountDeleteAllowed`, `passkey-register` -> `assertPasskeyRegisterAllowed`; `change-email`/`change-password` nur Login-Limits), dann 409 `opaque_not_registered` bei Konten ohne Record (Legacy/SSO behalten ihren Pfad; der angemeldete Nutzer kennt seinen Zustand ohnehin). `finish {purpose, loginState, finishLoginRequest}` -> `{reauthTicket, expiresIn: 300}`; jeder Fehler nach den Formatprüfungen ist 400 `invalid_credentials` (Feld `password`), kein Limit am `finish`. Flag aus: 503 `opaque_unavailable`. Konsumenten: `ReauthenticationService::assertConfirmed(..., ?$ticket)` / `assertTicket` (Zweck muss exakt passen, Verbrauch einmalig; Fehler 403 `reauth_required`), genutzt von `DELETE /api/auth/me`, Passkey-`register/options` (`reauthTicket`) und `change-email` (`reauthTicket` statt `password`); `change-password` war seit AP 7 ticketbasiert (Ende-zu-Ende getestet). Beweis-Matrix: Konto nur mit Record -> nur Ticket (Feld `password` = 400 `invalid_credentials`, `code` ebenso; kein Mail-Code); Legacy (bcrypt, auch mit Record nach Upgrade) -> Passwort UND Ticket; ohne jedes Passwort (SSO/Passkey) -> Mail-Code wie bisher, Ticket nie gültig. `AccountService::assertPassword` meldet für Record-only-Konten 400 `invalid_credentials` statt 409 `no_password`. Verbrauchsreihenfolge: das Ticket wird vom Nachweis verbraucht, also vor dem Last-Member-Guard von `deleteMe` (ein 422 `last_member_of_club`/`last_admin_of_club` verbrennt es; wie beim Passwort wird zuerst der Nachweis geprüft); bei `change-email` vor dem Mail-Limit. Gates: `ReauthGateAllowance` lässt `reauth/start|finish` in E-Mail-Bestätigungs- und Consent-Gate nur für `purpose=delete-account` durch (Body wird gelesen), alle anderen Zwecke bleiben gesperrt. Abweichung: ein `delete-account`-Start zählt zusätzlich die zweckeigenen Löschversuche, der anschließende `DELETE` zählt erneut (ein erfolgreicher Löschvorgang verbraucht 2 von 5).

### 3.4 Reauth-Ticket
- Die Credential-Id der Reauth-/Change-Auswertung kommt aus JWT und Ticket, nie aus dem Request; jede Auswertung zählt gegen die Limits (3.5).
- `SignedTokenService::issue('opaque-reauth', {uid, tv, purpose, jti}, 300)`. Verbrauch einmalig (`NonceStore`), gebunden an
  Nutzer, `tokenVersion` und Zweck (`delete-account`, `passkey-register`, `change-email`, `change-password`).
  Ersetzt den Passwort-Pfad von `ReauthenticationService::assertConfirmed($user, $purpose, $password, $code)`; neuer Parameter
  `?string $reauthTicket`. Konten ohne Passwort behalten den 6-stelligen Mail-Code unverändert (`sendCode`, 409 `has_password`
  gilt künftig für Konten mit Passwort-Record ODER Legacy-Hash).
- Controller-Änderungen: `AuthController::deleteMe`, `WebAuthnController::registrationOptions`,
  `AuthController::changeEmail` (`password` -> `reauthTicket`), Dtos in `backend/src/Dto/Auth/*`.

### 3.5 Rate-Limits und Aufzählungsschutz
- `AuthRateLimiter::assertLoginAllowed(Request, email)` (10/15 min IP, 5/15 min je Adresse) verbraucht bei `login/start`:
  der Client prüft das Passwort lokal anhand von KE2, Passwort-Raten geschieht also bei `start` (jede OPRF-Auswertung ist ein
  Rateversuch), nicht erst bei `finish`. Am `finish` höchstens nur lesend prüfen (peek) oder die Prüfung weglassen;
  `recordLoginSuccess` nur bei Erfolg, die E-Mail dafür kommt aus dem versiegelten State, nicht aus dem Request.
- Jede OPRF-Auswertung unter dem Schlüssel eines echten Nutzers (change-password, reset, upgrade, reauth; siehe 3.2/3.4) ist
  ein Rate-Orakel: die Credential-Id stammt ausschließlich aus serverseitiger Bindung (JWT + Ticket, Reset-Token, signierter
  Registrierungs-State), nie aus einem Client-Feld, und jede Auswertung zählt gegen die Nutzer- und IP-Login-Limits. `identify` bleibt unverändert (bekanntes Orakel, siehe CLAUDE.md "Rate limits").
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

- Paket `@serenity-kit/opaque` **exakt gepinnt** (`"1.1.0"` ohne `^`, bereits in AP 0 eingetragen) in `frontend/package.json`. Wrapper `frontend/src/lib/opaque/`
  (`client.ts`: `registerStart/Finish`, `loginStart/Finish`, `ready`), nur über dynamisches `import()` geladen, damit das
  WASM (inline-Base64; gemessen: Bundle 413 KB, 158 KB gzip) nicht in den Erst-Bundle kommt: Route-Chunk `src/pages/lazy.ts` plus Prefetch
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
- Im Spike bestätigt (Chromium 148): mit `script-src 'self'` wirft `WebAssembly.compile` einen CSP-`CompileError`, mit `'wasm-unsafe-eval'` läuft es ohne Verstoß; `'unsafe-eval'` ist nicht nötig.
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

- **RFC-Vektoren** (PHPUnit-DataProvider, `backend/tests/Unit/Opaque/`): Fixtures liegen bereits in `backend/tests/Opaque/fixtures/`
  (`rfc9807-vectors.json`, `rfc9497-oprf-vectors.json`, `rfc9380-xmd-sha512-vectors.json`, Extraktionsskript `frontend/scripts/opaque/extract-rfc-vectors.mjs`).
  RFC 9807 passt voll nur mit C.1.1, C.1.2 und C.2.1 (ristretto255 auch als KE-Gruppe, KSF Identity, Context `OPAQUE-POC`); C.1.3/C.1.4/C.2.2
  nur für den OPRF-Teil (KE-Gruppe curve25519); P-256-Vektoren unbrauchbar. Der Server-Test speist Record, KE1, Seeds/Nonces ein und erwartet KE2,
  Session-Key und KE3-MAC byte-genau (im Spike mit einem PHP-Prototyp bestätigt).
- **serenity-Transkripte** (`serenity-transcripts.json`, Generator `frontend/scripts/opaque/generate-serenity-transcripts.mjs`): `serverSetup` ist parsebar
  (64 B Seed, 32 B Server-Key, 32 B Dummy-Key), Registrierungsantwort und evaluiertes Element müssen byte-identisch reproduziert, `masked_response` mit dem
  Record-`masking_key` entmaskiert werden. Einen kompletten Login kann nur der Live-Interop-Test (unten) prüfen.
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
| 0 | **Spike** (erledigt, `OPAQUE-SPIKE.md`): serenity-Optionen, Wire-Format, RFC-Vektoren, Identitäten, KSF-Zeit (Desktop-Chromium, gedrosselt; echte Geräte offen), `wasm-unsafe-eval` | - | M |
| 1 | **(erledigt)** `ext-sodium` in composer.json, Docker `php -m`-Check, `.env.example`/`services.yaml` Konfigurationsgerüst, `OpaqueKeys`, `generate-keys` | 0 | S |
| 2 | **(erledigt)** Primitive: `Ristretto`, `ExpandMessageXmd`, `HashToGroup`, `Oprf` + RFC-9497/9380-Vektoren | 1 | M |
| 3 | **(erledigt)** `KeySchedule`, `Hkdf`, `Mac`, `OpaqueServer` (Reg + Login, Fake-Pfad), `RegistrationRecord`, `ServerLoginState` + RFC-9807-Vektoren C.1.1/C.1.2/C.2.1 (voll), C.1.3/C.1.4/C.2.2 (OPRF), serenity-Replay, Test-Client mit Round-Trips | 2 | L |
| 4 | **(erledigt)** Live-Interop `frontend/scripts/opaque/interop.mjs` (serenity 1.1.0, echtes Argon2id) gegen PHP-Harness `backend/tests/Opaque/bin/interop-server.php`, CI-Schritt im Backend-Job; `OpaqueTestClient` + Negativ-Tests kamen mit AP 3. Ursprünglich: Test-only `OpaqueTestClient` + Negativ-Tests + Interop-Skript mit serenity (CI-Job) | 3 | M |
| 5 | **(erledigt)** DB-Migration (3 Spalten), `User`-Entity, `OpaqueService`, `loginState` (AEAD + NonceStore), Reauth-Ticket | 3 | M |
| 6 | **(erledigt)** Endpunkte `login/*` + `AuthService`-Split + Rate-Limits + OpenAPI + Controller-Tests | 5 | L |
| 7 | **(erledigt)** Endpunkte `register/*` (Signup, Reset, Change, Upgrade) + `PasswordResetService`/`AccountService`-Anpassung | 6 | L |
| 8 | **(erledigt)** Reauth: `reauth/*`, `ReauthenticationService`, `deleteMe`, Passkey-Options, `changeEmail` | 6 | M |
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
| serenity nicht RFC-konform / Nicht-Default-Optionen | Gering. Spike: Suite, Preamble, Schlüsselableitung und Wire-Format entsprechen RFC 9807; einzige Abweichung ist der nicht setzbare (leere) Context und `2^21-1` statt `2^21` im RFC-Profil. Interop-Test (AP 4) fixiert das |
| Breaking Changes serenity (0.9.0 Context, 1.0.0 Record) | Exakt pinnen, `opaque_version`, Upgrade nur bewusst mit Migrationsplan und Re-Registrierungsfluss |
| Mobile Browser-Speicher bei 64 MiB Argon2 | Spike: Desktop ca. 0,1 s, mit 6x CPU-Drosselung ca. 0,65 s; echte Geräte vor Rollout messen (AP 10); Profil notfalls senken (Versionsfeld erlaubt Wechsel) |
| Aktiv kompromittierter Server liefert manipuliertes JS | Bleibt (Abschnitt 1) |
| Verlust Seed/Server-Key | Alle Konten reset-pflichtig; Backup Pflicht |
| Support: Nutzer mit sehr altem Browser/ohne WASM | Anzeige und Hilfe-Hinweis; kein Legacy-Fallback nach Phase 2 |
| Wartung Single-Maintainer | Pin, Lockfile-Review, Dependabot nur Hinweis |

**Entscheidungen (2026-11-09):**
1. **CSP `'wasm-unsafe-eval'`:** entschieden ja. Ohne WASM keine brauchbare OPAQUE-Client-Bibliothek; der Eintrag erlaubt kein
   `eval` von JS. Dokumentieren in CLAUDE.md.
2. **Argon2id-KSF-Profil:** entschieden serenity-Default "memory-constrained" (m=2^16 KiB = 64 MiB, t=3, p=4). Das Profil wird pro
   Konto als `opaque_version`/`ksf_profile` gespeichert, damit künftig ohne Hard-Break erhöht werden kann. Spike-Messung:
   Desktop (M4 Pro) ca. 0,1 s je Registrierung/Login, 4-6x CPU-Drosselung 0,4-0,7 s; `rfc-recommended` (2 GiB) ca. 1,1 s Desktop, 5-8 s gedrosselt: ungeeignet.
   Messung auf echten Mobilgeräten (Zielgrenze ca. 1-2 s) folgt in AP 10.
3. **Länge der Übergangsphase:** entschieden 30 Tage ab Rollout-100 %, danach Stichtag. Erinnerungsmails 14 und 3 Tage vorher.
   Konten ohne Login im Zeitraum werden per Reset wiederhergestellt, kein Datenverlust.
4. Client-Identität (Spike AP 0, 2026-11-09): `credential_identifier` = User-UUID (nur Server), keine eigenen `identifiers` (Default = Public Keys), Context leer (Abschnitt 2.1, Begründung in `OPAQUE-SPIKE.md` §7).
5. Bcrypt-Hash: entschieden erst in Phase 2 löschen (Rollback verlustfrei, siehe 6.8). Bis dahin bleibt der Offline-Angriff über den
   alten Hash möglich.

## 10. Pflege der Abhängigkeiten

| Komponente | Status (Recherche) | Policy |
|---|---|---|
| `@serenity-kit/opaque` 1.1.0 (gepinnt) | MIT, Rust opaque-ke 4.0.x als WASM, RFC 9807, ca. 45k Downloads/Woche, 2 Haupt-Contributor, 1 npm-Maintainer, 7ASecurity-Pentest; opaque-ke-Audit (NCC 2021) nur alte Version | Exakt pinnen (kein `^`/`~`), Upgrades nur mit Interop-Test + Changelog-Review, Breaking-Changes-Historie beachten (Context 0.9.0, Records 1.0.0); Lockfile-Integrität prüfen |
| `opaque-ke` (transitiv, im WASM) | 4.0.1 (mit `voprf` 0.5.0, `argon2` 0.5.3, `curve25519-dalek` 4.1.3; aus den Pfaden im WASM belegt) | Bei jedem serenity-Upgrade die Versionen im WASM neu prüfen (`strings`) und Spike-Fixtures regenerieren |
| `noxlogic/oprf` | RFC 9497 Base-Mode, v0.9.1, 1 Maintainer, 41 Installs, hängt an `web-token/jwt-framework` | NICHT als Abhängigkeit, höchstens als Referenz für Vektoren/Vergleich |
| `stef/libopaque` | LGPL-3.0, Pre-RFC-Draft, PHP-7-Binding | nicht verwendbar |
| `cloudflare/opaque-ts`, `@aldenml`, andere JS-Libs | Draft-Stände / nicht verwendbar | nicht verwenden |
| `ext-sodium` | in PHP 8.4 enthalten | explizit in `composer.json`, Check im Docker-Build |
| RFC 9807 / 9497 / 9380 | Standards | Vektor-Fixtures im Repo, bei Errata prüfen |

Prozess: Jedes Upgate der Client-Bibliothek läuft durch den CI-Interop-Test; Monatlicher Check auf Advisories
(`npm audit --omit=dev` läuft bereits in CI). Bei verlassenem Projekt: Plan B ist ein Fork/Vendor der gepinnten Version
(Record-Format bleibt RFC-konform, daher bleibt der PHP-Server unabhängig).
