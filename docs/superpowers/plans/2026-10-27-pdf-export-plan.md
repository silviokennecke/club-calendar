# PDF Export Implementation Plan

> **For agentic workers:** the orchestrator delegates each task to ONE subagent (model as marked; no Opus). Steps use checkbox syntax. One commit per task (project rule 8: unsigned fallback if signing fails). Commit messages end with the attribution line from the session reminder.

**Spec:** `docs/superpowers/specs/2026-06-27-pdf-export-design.md` (revised 2026-10-27, read it fully before any task).

**Goal:** `GET /api/calendars/{calendarId}/events.pdf` (dompdf `^3.1.6`, four layouts, emoji PNGs, legend) plus a PDF format on the existing `EventsExportPage`.

**Architecture:** shared filter query in `EventExportService` -> `PdfExportService` (reads `IcsEventReader::chunks`, builds per-day arrays, Twig `pdf/*.html.twig`, hardened dompdf) -> `EventController::exportPdf`. ICS code path, `IcsEventReader`, `IcsEvent`, `IcsService::FORMAT_VERSION` stay untouched.

## Global constraints

- Backend under `backend/`, new namespace `App\Pdf\` for PDF classes (`PdfExportService`, `EmojiImages`, `PdfText`, `PdfLayout`).
- No `|raw` in Twig, no user text in `style`/`@page`. Text via i18n/translator domain `pdf`, never hard-coded.
- `IcsGoldenTest`, `FeedIcsEtagTest` must stay green and unchanged; `FORMAT_VERSION` unchanged.
- Frontend: shared UI components from `@/components/ui/shared`; every UI text in `de.json` + `en.json` with identical keys; `npm run lint -w frontend` clean.
- Test DB: throwaway MySQL on 3360, `TEST_DATABASE_URL` exported (CLAUDE.md "Tests", `docs/redesign/E2E.md`).

## Verified facts and spec/code mismatches

1. `docker/Dockerfile` stage 1 uses `composer:2` with `composer install --no-dev`. Adding `ext-gd`/`ext-intl` to `composer.json` `require` makes that stage fail on the platform check (the `composer` image has neither). Task 1 must add `--ignore-platform-req=ext-gd --ignore-platform-req=ext-intl` there (runtime stage has the extensions). Spec does not mention it.
2. `.github/workflows/ci.yml` sets up PHP with `extensions: pdo_mysql, intl` in at least two jobs (lines ~186 and ~334, check all `setup-php` blocks); `gd` must be added to each, otherwise `composer install` fails. Not in the spec.
3. `EventExportService` is a `readonly class` and `export()` currently builds the query inline with nullable `from`/`to`; `targetGroupIds()` is `private`. The refactor must make it callable from `PdfExportService` (public `buildQuery(...)`/`parseFilters(...)`).
4. `AuthRateLimiter` wires every limiter via `#[Autowire(service: 'limiter.<name>')]` constructor arguments; limiters are defined twice (`config/packages/rate_limiter.yaml` and `config/packages/test/rate_limiter.yaml`, high limits in test). The new `pdf_export_user`/`pdf_export_ip` must be added in both and in the constructor. Feed limits use `env()` parameters with a `0 = off` rule; do the same only if needed (spec asks for fixed 10/30 per 10 min).
5. `Input::assertMaxRange($from, $to, $maxDays)` exists and checks `diff()->days > $maxDays` (field `to`); 366 days therefore allows Jan 1 - Jan 1 of the next year. Annual availability ("exactly Jan 1 - Dec 31") is a separate check.
6. `Quota::LIMITS` is for per-owner counts (`assertRoom`); the PDF caps are per-request caps (like `SeriesRule::MAX_EVENTS`), so they are constants on `PdfExportService`, not `Quota` entries. Only the docs list ("Quotas and input limits") changes.
7. There is no existing ICS export test file; `events.ics` is covered in `tests/Controller/ExportBulkTest.php`. The new test is `tests/Controller/EventExportPdfTest.php`.
8. `frontend/src/lib/api.ts`: `errorFrom` is module-private; `LONG_REQUEST_PATH` currently `/\/events\/import(\/preview)?(\?|$)|\/events\.ics(\?|$)/`. Existing helpers `icsFileName`, `exportQuery`, `downloadBlob`, `ExportRange`, `monthBounds` are in `frontend/src/lib/events/ics.ts`, tests in `lib/events/__tests__/list-ics.test.ts`; `PublicEventModal.tsx` also imports from `ics.ts` (keep exports stable).
9. `docker/php.ini` has `memory_limit = 256M` (confirmed); PHP-FPM pool config in `docker/php-fpm.conf` should be checked for `request_terminate_timeout` and Caddy `reverse_proxy` timeouts vs. the route's `set_time_limit(60)` (Task 1 checks, mention in BACKEND-GAPS).
10. `backend/var/` is gitignored; the emoji PNGs must NOT live in `var/` (not shipped by the image). Use `backend/assets/pdf/emoji/` (committed, copied by `COPY backend/`) as the chroot. dompdf `tempDir`/`fontCache` go to `var/pdf-cache` (writable at runtime; check the Dockerfile `CACHE_DIR=/data/cache` convention and use `%kernel.cache_dir%/pdf` instead if `var/` is read-only in the container).
11. Spec says viewers may export (like ICS): `CalendarMemberVoter::CALENDAR_MEMBER` (confirmed on `exportIcs`).

## Task graph

```
T1 deps/infra ──┬─> T2 emoji assets+resolver ──────────┐
                ├─> T3 query extraction ──────────────┤
                └─> T4 translations+dates ─────────────┼─> T5 service core+agenda ─> T6a month ─┐
                                                      │                              T6b quarter ├─> T7 controller+limiter ─> T8 tests ─> T9 docs ─┐
                                                      │                              T6c annual ─┘                                                 ├─> T12 benchmark+final
T10 frontend (needs only the endpoint contract; start after T1) ─> T11 e2e (needs T7 + T10) ───────────────────────────────────────────────────────┘
```

Parallel groups (disjoint files): {T2, T3, T4} after T1; {T6a, T6b, T6c} after T5 (each adds its own twig file + one `match` arm in `PdfExportService`: merge conflict risk is one line, run sequentially if parallel agents share a working tree; use worktrees otherwise); T10 can run in parallel with T2-T8 (frontend only, mocks the endpoint). T9 after T7. T11 after T7 and T10. T12 last.

---

## Task 1: Dependencies and infrastructure

**Model:** worker-haiku. **Depends on:** none.

**Files:**
- Modify: `backend/composer.json` (+ `composer.lock`): require `dompdf/dompdf: ^3.1.6`, `ext-dom`, `ext-mbstring`, `ext-intl`, `ext-gd`
- Modify: `docker/Dockerfile` (runtime: `install-php-extensions pdo_mysql intl gd opcache`; stage 1: `--ignore-platform-req=ext-gd --ignore-platform-req=ext-intl` on `composer install`)
- Modify: `.github/workflows/ci.yml` (add `gd` to every `setup-php` `extensions:` list; add a step `composer audit` in the backend job, fails on advisories)
- Modify: `docker/php.ini`: comment only if needed (global stays 256M; the route raises its own limit in T7)
- Modify: `.gitignore` entry for `backend/var/pdf-cache` only if `var/` is not already ignored

- [ ] `cd backend && composer require dompdf/dompdf:^3.1.6 ext-gd ext-intl ext-dom ext-mbstring` (verify php-gd locally with `php -m | grep -i gd`; if missing, report instead of working around it).
- [ ] Verify installed dompdf is >= 3.1.6 and `composer audit` is clean.
- [ ] Check `docker/php-fpm.conf` and `docker/Caddyfile` for timeouts below 60 s on `/api/*`; note the result in the report (change only if a limit blocks 60 s).
- [ ] `docker build -f docker/Dockerfile -t club-calendar .` if Docker is available (otherwise state it was not run).

**Acceptance:** `cd backend && composer install && composer audit`; `composer test -- --filter OpenApiSpecTest` still green; Dockerfile builds.

**Commit:** `build(pdf): add dompdf, ext-gd/ext-intl requirements, composer audit in CI`

---

## Task 2: Emoji assets and `EmojiImages` resolver

**Model:** worker-sonnet (asset licensing/size judgement plus security-sensitive lookup). **Depends on:** T1.

**Files:**
- Create: `backend/assets/pdf/emoji/*.png` (Noto Emoji colour PNGs, 72 px, `emoji_u<hex>[_<hex>].png`; only the emoji emoji-mart can produce, i.e. the CLDR emoji set with default skin tone; skin-tone variants only if size permits)
- Create: `backend/assets/pdf/emoji/manifest.json` (sorted list of file keys, generated)
- Create: `backend/assets/pdf/emoji/LICENSE` + `NOTICE` (Apache-2.0 text, attribution to `googlefonts/noto-emoji`)
- Create: `backend/bin/build-emoji-manifest.php` or a console command `app:pdf:emoji-manifest` (regenerates the manifest)
- Create: `backend/src/Pdf/EmojiImages.php` (`resolve(string $icon): ?string` returns the absolute path from the manifest or null; key regex `^[0-9a-f]{2,6}(_[0-9a-f]{2,6}){0,9}$`; NFC; try key, then key without `fe0f`; never builds a path from input)
- Create: `backend/src/Pdf/PdfText.php` (`stripEmoji(string): string`: `\p{Extended_Pictographic}`, `U+FE0F`, `U+200D`, `U+1F3FB-1F3FF`, regional indicators, tag characters; `truncate(string, int)`)
- Create: `backend/tests/Unit/EmojiImagesTest.php`, `backend/tests/Unit/PdfTextTest.php`
- Modify: `docker/Dockerfile.dockerignore` / `.gitattributes` only if PNGs would be excluded

- [ ] Download only the needed PNGs (a script in the scratchpad, not committed); verify licence from the upstream repo and record the total size. Report size (repo + image delta). If > 8 MB, stop and report before committing.
- [ ] Tests: key normalisation incl. `U+FE0F`, ZWJ sequence (`1f468_200d_1f469_200d_1f467`), flag, skin tone, unknown emoji -> null, free text, `<img src=...>`, `../../etc/passwd`, multi-emoji string, 33-char string, empty string -> null; stripEmoji cases.

**Acceptance:** `cd backend && composer test -- --filter 'EmojiImagesTest|PdfTextTest'`; phpstan (`composer phpstan`) and php-cs-fixer clean for new files.

**Commit:** `feat(pdf): bundled Noto Emoji PNGs with allow-list resolver and text stripping`

---

## Task 3: Extract the shared export query

**Model:** worker-sonnet. **Depends on:** T1 (no code dependency; can run parallel to T2/T4).

**Files:**
- Modify: `backend/src/Service/EventExportService.php`: extract `public function filter(Calendar, mixed $from, mixed $to, mixed $includeDrafts, mixed $targetGroupIds): ExportFilter` (readonly value object: `fromDate`, `toDate`, `drafts`, `groupIds`) and `public function buildQuery(Calendar, ExportFilter): QueryBuilder` (the existing select `e` / `FROM Event e` query with draft, overlap and EXISTS target-group conditions). `export()` calls both then `streamCalendarIcs(... reader->chunks($qb))` unchanged. `targetGroupIds()` stays private (used inside `filter`).
- Create: `backend/src/Service/ExportFilter.php` (or nested in the same file)
- Create: `backend/tests/Service/EventExportQueryTest.php` (DQL equality of `buildQuery` for: no filter, from/to, drafts, target groups; `filter()` errors 400/422)

- [ ] Keep `export()` output byte-identical.

**Acceptance:** `cd backend && composer test -- --filter 'IcsGoldenTest|FeedIcsEtagTest|ExportBulkTest|DateRangeParamsTest|ClubRolesTest|EventExportQueryTest'` all green, golden fixture untouched (`git diff --stat` shows no fixture change).

**Commit:** `refactor(export): share the export filter and query between ICS and PDF`

---

## Task 4: PDF translations and date formatting

**Model:** worker-haiku. **Depends on:** T1.

**Files:**
- Create: `backend/translations/pdf+intl-icu.de.json`, `backend/translations/pdf+intl-icu.en.json` (identical keys: `title`, `draft`, `legend`, `more` (`+{count} weitere` / `+{count} more`), `generated_on`, `period`, `col.date|time|name|location|tags`, `all_day`, `page`, `continued`)
- Create: `backend/src/Pdf/PdfDates.php` (`monthName(\DateTimeInterface|int $y,$m, string $locale)` via `IntlDateFormatter` pattern `LLLL`; `weekdayShort(int $dow, locale)` via `EEEEEE`; `weekdayOrder(int $firstDayOfWeek): list<int>` rule: `0` = Sunday else Monday; `formatDate`, `formatTime`)
- Create: `backend/tests/Unit/PdfDatesTest.php` (de/en month names, weekday header rotation for 0 and 1, invalid value -> Monday, null-safe)
- Create: `backend/tests/Unit/PdfTranslationsTest.php` (both files have identical key sets and placeholders; mirrors `i18n.test.ts` idea)

**Acceptance:** `cd backend && composer test -- --filter 'PdfDatesTest|PdfTranslationsTest'`; php-cs-fixer clean.

**Commit:** `feat(pdf): translation domain pdf and IntlDateFormatter helpers`

---

## Task 5: `PdfExportService` core, base template, agenda layout, legend

**Model:** worker-sonnet. **Depends on:** T2, T3, T4.

**Files:**
- Create: `backend/src/Pdf/PdfExportService.php`: constants `MAX_RANGE_DAYS = 366`, `MAX_EVENTS = 2000`; `render(Calendar, ExportFilter, PdfOptions $opts, User $user): string`. Steps: validate layout/paper/orientation + availability (reuse `PdfLayout` enum with `available(from,to)`), `Input::assertMaxRange`, count check via `COUNT(e.id)` on `buildQuery` (clone, `select('COUNT(e.id)')`, 422 `too_many_events` field `to`), read `IcsEventReader::chunks`, convert to per-day arrays in the club time zone (multi-day events on each day inside the range, `PdfText::truncate` + `stripEmoji` on name/location/tag names), resolve `propertyIcons` through `EmojiImages` (unresolved dropped), collect event ids, legend lookup (`SELECT DISTINCT p.icon, p.name FROM EventProperty ep JOIN ep.property p WHERE ep.event IN (:ids) AND p.icon IS NOT NULL`, batches of 500, group names by icon sorted, only resolvable icons), Twig render, dompdf.
- Create: `backend/src/Pdf/PdfOptions.php` (layout, paper, orientation), `backend/src/Pdf/PdfLayout.php` (enum `month-grid|quarter-overview|annual-overview|agenda`, default orientation, availability)
- Create: `backend/src/Pdf/DompdfFactory.php` (hardened options: `isRemoteEnabled=false`, `isPhpEnabled=false`, `isJavascriptEnabled=false`, `isHtml5ParserEnabled=true`, `chroot=backend/assets/pdf`, `allowedProtocols` = `file://` only, `fontSubsetting=true`, `tempDir/fontDir/fontCache` under the cache/var dir, `defaultFont=DejaVu Sans`)
- Create: `backend/templates/pdf/base.html.twig` (`@page` from validated enum values only, shared CSS, header/footer), `backend/templates/pdf/agenda.html.twig` (table Date|Time|Name|Location|Tags, month heading rows, `thead { display: table-header-group }`, `tr { page-break-inside: avoid }`, emoji `<img>` before tags, draft marker, legend section at the end)
- Create: `backend/tests/Service/PdfExportServiceTest.php` (agenda renders `%PDF`; legend only used + resolvable properties; draft excluded -> legend absent; same-emoji properties share a row; weekday/month labels via a `renderHtml()` seam that returns the HTML before dompdf)

Design note: expose `buildViewModel()`/`renderHtml()` as public methods so tests assert German/English labels and weekday order without parsing PDF text.

**Acceptance:** `cd backend && composer test -- --filter PdfExportServiceTest`; `composer phpstan`; the file renders umlauts and a bundled emoji (manual: write a PDF to the scratchpad and inspect with `pdftotext`/screenshot).

**Commit:** `feat(pdf): PdfExportService with hardened dompdf, agenda layout and emoji legend`

---

## Task 6a: Month grid layout

**Model:** worker-sonnet. **Depends on:** T5.
**Files:** Create `backend/templates/pdf/month_grid.html.twig`; Modify `PdfExportService` (month view-model: `months[] {year, month, label, weeks[7 cells {date|null, inRange, number, events[]}]}`, weekday header rotated by `firstDayOfWeek`, "+k more" via the `more` key when more events than cap per cell); Create `backend/tests/Unit/PdfMonthGridTest.php` (week building, rotation Sunday/Monday, out-of-range days greyed without events, February leap year, range spanning a year boundary).
**Acceptance:** `composer test -- --filter 'PdfMonthGridTest|PdfExportServiceTest'`; fixed-layout table, one page per month (`page-break-after: always`).
**Commit:** `feat(pdf): month grid layout`

## Task 6b: Quarter overview layout

**Model:** worker-sonnet. **Depends on:** T5.
**Files:** Create `backend/templates/pdf/quarter_overview.html.twig`; Modify `PdfExportService` (chunks of 3 months per landscape page, last page 1-2 months); Create `backend/tests/Unit/PdfQuarterOverviewTest.php` (chunking: 12 months -> 4 pages, 5 months -> 2 pages, availability needs >= 3 touched months).
**Acceptance:** `composer test -- --filter 'PdfQuarterOverviewTest|PdfExportServiceTest'`.
**Commit:** `feat(pdf): quarter overview layout`

## Task 6c: Annual overview layout

**Model:** worker-sonnet. **Depends on:** T5.
**Files:** Create `backend/templates/pdf/annual_overview.html.twig` (4 x 3 outer table, each month one inner table; fall back to one flat table if dompdf is unstable), chronological event legend below or on the next page; Modify `PdfExportService`; Create `backend/tests/Unit/PdfAnnualOverviewTest.php` (available only for exactly Jan 1 - Dec 31 of one year).
**Acceptance:** `composer test -- --filter 'PdfAnnualOverviewTest|PdfExportServiceTest'`; visual check of a generated sample in the scratchpad.
**Commit:** `feat(pdf): annual overview layout`

---

## Task 7: Controller route, rate limiter, request validation

**Model:** worker-sonnet. **Depends on:** T6a-c.

**Files:**
- Modify: `backend/src/Controller/EventController.php`: inject `PdfExportService`, `AuthRateLimiter`, `CurrentUserResolver`; add `exportPdf()` with `#[Route('.pdf', methods: ['GET'])]` and `#[IsGranted(CalendarMemberVoter::CALENDAR_MEMBER, subject: 'calendar')]`. Order: rate limit (`assertPdfExportAllowed($request, $userId)`) -> `exportService->filter()` -> parse `layout` (required), `paper`, `orientation` (400 `validation_failed` with `field`) -> `ini_set('memory_limit', '512M')`, `set_time_limit(60)` (values per T12) -> `pdfService->render()` -> `new Response($pdf, 200, [Content-Type application/pdf, Content-Disposition (generalise `EventExportService::contentDisposition(Calendar, string $ext = 'ics')`), Content-Length, Cache-Control no-cache no-store, X-Content-Type-Options nosniff])`. `from` and `to` are required for PDF (400 on missing).
- Modify: `backend/src/Security/AuthRateLimiter.php`: `assertPdfExportAllowed(Request, string $userId)` (user limiter 10 / 10 min, IP limiter 30 / 10 min, same `assertAccepted` -> 429 `rate_limited` + `Retry-After`), constructor args `#[Autowire(service: 'limiter.pdf_export_user')]`, `...ip`.
- Modify: `backend/config/packages/rate_limiter.yaml` (sliding_window, 10 and 30, `10 minutes`) and `backend/config/packages/test/rate_limiter.yaml` (high limits, cache pool `app.auth_limiter_pool`).
- Modify: `backend/src/Service/EventExportService.php`: `contentDisposition` extension parameter (ICS default unchanged).

**Acceptance:** manual `curl` against a local server with a valid JWT returns a PDF; `composer test -- --filter 'ExportBulkTest|ClubRolesTest|OpenApiSpecTest'` (OpenApiSpecTest is expected RED until T9: run T9 immediately after, or add the openapi path in this task if the test blocks the commit; recommended: do the minimal `events.pdf` path stub in T7 so every commit stays green and T9 completes the prose).

**Commit:** `feat(pdf): events.pdf endpoint with per-user rate limit`

---

## Task 8: PHPUnit endpoint tests

**Model:** worker-sonnet. **Depends on:** T7.

**Files:** Create `backend/tests/Controller/EventExportPdfTest.php` (use the existing controller test base and helpers in `tests/Helper`; read `ExportBulkTest.php` for the ICS setup pattern). Cases (spec "Testing"):
- 200 `application/pdf`, body starts `%PDF`, `Content-Length`, Content-Disposition slug, per layout x 4
- 400: missing/invalid `layout`, missing `from`/`to`, `from > to`, range > 366 days, annual for a partial year, quarter for < 3 months, bad `paper`/`orientation`
- 401 no token; 403 non-member; 404 unknown calendar; viewer allowed; archived allowed
- 422 `unknown_reference` foreign target group; 422 `too_many_events` (lower the cap through a test seam, e.g. protected constant override or a service parameter, not 2001 real rows)
- 429 `rate_limited` + `Retry-After` (swap in a low-limit limiter via the test container)
- drafts only with `includeDrafts`; filter parity with `events.ics` (same event names in both outputs for the same query; extract names from the ICS body and from `renderHtml`)
- hostile input in name/location/note/property icon: payloads from the spec (`<img src="file:///etc/passwd">`, `@font-face` to `http://127.0.0.1:1/x`, `<svg>`/`data:image/svg+xml`, `<link rel=stylesheet>`, `<?php ?>`): 200, non-empty PDF, payload as literal text in the HTML view-model, no fetch; icon payloads (`../../etc/passwd`, multi-emoji, unknown) omitted from item and legend
- language/weekday: user `de`/`1` -> German labels, Monday first; `en`/`0` -> English, Sunday first
- legend: only used properties, absent for out-of-range / excluded drafts, shared row for equal emoji
- regression: `IcsGoldenTest`, `FeedIcsEtagTest` unchanged and green

**Acceptance:** `cd backend && composer test -- --filter EventExportPdfTest` then the full `composer test` green.

**Commit:** `test(pdf): endpoint, validation, hostile input, language and legend tests`

---

## Task 9: API docs and project docs

**Model:** worker-haiku. **Depends on:** T7 (parallel with T8).

**Files:**
- Modify: `docs/api/openapi.yaml`: path `/api/calendars/{calendarId}/events.pdf` next to `events.ics` (params `from`, `to` required, `includeDrafts`, `targetGroupIds[]`, `layout`, `paper`, `orientation`; 200 `application/pdf`; 400/401/403/404/422/429 refs), "Quotas and input limits" (366 days, 2000 events per PDF, `too_many_events` 422, rate limit), viewer role list (line ~51: add `events.pdf`)
- Modify: `CLAUDE.md` ("Event Import, Export, Bulk, Series": the new route and caps; Stack list: dompdf; note on `backend/assets/pdf/emoji`, `ext-gd`)
- Modify: `CHANGELOG.md` `[Unreleased]` (Added: PDF export)
- Modify: `docs/redesign/BACKEND-GAPS.md` ("Betrieb": memory limit of the route, `ext-gd`, cache dir, timeouts; remove the PDF export gap if listed)
- Modify: `docs/superpowers/specs/2026-06-27-pdf-export-design.md`: status line "Implemented" (only at T12)

**Acceptance:** `cd backend && composer test -- --filter OpenApiSpecTest` green.

**Commit:** `docs(pdf): OpenAPI, CLAUDE.md, changelog and operations notes for PDF export`

---

## Task 10: Frontend

**Model:** worker-sonnet. **Depends on:** T1 only (endpoint contract from spec); verify against the real endpoint after T7.

**Files:**
- Modify: `frontend/src/lib/api.ts`: export `errorFrom` (or add `apiDownload(path, accept)` returning `Blob`, throwing `ApiError` with `code`); extend `LONG_REQUEST_PATH` with `|\/events\.pdf(\?|$)`
- Create: `frontend/src/lib/events/pdf.ts`: `PdfLayout`, `pdfExportQuery({...exportQuery, layout, paper, orientation})`, `availableLayouts(from, to)` (month, agenda always; quarter >= 3 touched months; annual exactly Jan 1 - Dec 31), `pdfRangeTooLong`; re-export from `lib/events/index.ts` if the pattern fits
- Modify: `frontend/src/lib/events/ics.ts`: `exportFileName(name, ext)` (keep `icsFileName` as wrapper), `ExportRange` gains `year`, `exportRange()` handles it
- Modify: `frontend/src/pages/events/EventsExportPage.tsx`: format fieldset first (`ap-fieldset`/`ap-check`), PDF-only layout fieldset, paper and orientation `NativeSelect`, range `all` hidden/disabled for PDF with fallback to `month`, `year` option for PDF, layout reset to month when unavailable, cap `Banner` + disabled button (count > 2000 or range > 366 days), download via `apiFetch(... events.pdf ..., { headers: { Accept: 'application/pdf' } })` + `downloadBlob`, error mapping by `code` (`too_many_events`, `validation_failed` on `to`, `rate_limited`, otherwise generic)
- Modify: `frontend/src/locales/de.json`, `en.json` (keys from spec section 9: `events.export.format.*`, `range.year`, `pdf.layout.*`, `pdf.paper.*`, `pdf.orientation.*`, `downloadIcs`/`downloadPdf` replacing `download` (delete if unused), `intro` per format, `failed.tooMany|rangeTooLong|rateLimited`)
- Create: `frontend/src/lib/events/__tests__/pdf.test.ts`; Modify `list-ics.test.ts` (year range, `exportFileName`); Create `frontend/src/pages/events/__tests__/EventsExportPage.test.tsx` if no page test exists (format switch shows/hides PDF options, request URL + `Accept` header, error banners)
- Modify: `frontend/AGENTS.md` (events section "…/events/export" sentence, `LONG_REQUEST_PATH` note, new `pdf.ts`)

**Acceptance:** `npm test -w frontend`, `npm run lint -w frontend`, `npm run build -w frontend` (type check), `i18n.test.ts` green.

**Commit:** `feat(frontend): PDF format on the events export page`

---

## Task 11: E2E spec

**Model:** worker-sonnet. **Depends on:** T7, T10. **Needs the isolated environment** (`docs/redesign/E2E.md`: `club_calendar_e2e` DB on port 3360, backend `php -S 127.0.0.1:3001`, Vite 5199; `safety.ts` aborts otherwise).

**Files:** Modify `frontend/e2e/events.spec.ts` (or `calendar.spec.ts`, whichever holds the ICS export case: `grep -n "events/export\|\.ics" frontend/e2e/*.ts`); helpers from `helpers.ts`. Cases: choose PDF, pick agenda, download resolves with a body starting `%PDF` (`page.waitForEvent('download')`), unavailable layouts disabled for a one-month range, `year` range enables annual, too-long range shows the banner.

**Acceptance:** `PLAYWRIGHT_BASE_URL=http://localhost:5199 npm run e2e -w frontend -- events.spec.ts` green. If the environment cannot be started, report and do not commit a spec that was never run.

**Commit:** `test(e2e): PDF export from the events export page`

---

## Task 12: Benchmark, caps, final verification

**Model:** worker-sonnet. **Depends on:** all.

**Files:** Create `backend/tests/Service/PdfPerformanceTest.php` (`#[Group('performance')]`, excluded by default as in `IcsMemoryTest`): ~1000 events in one year, every layout x A4/A3, measure `memory_get_peak_usage(true)`, time, size; Modify `PdfExportService::MAX_*`, `EventController::exportPdf` ini values, `docker/php.ini` comment, spec/openapi/BACKEND-GAPS numbers if the caps change.

- [ ] Run `cd backend && vendor/bin/phpunit --group performance --filter PdfPerformanceTest` locally and, if Docker is available, inside the built `php:8.4-fpm-alpine` image (musl + gd behaviour differs from macOS).
- [ ] Pass criteria (spec): peak below the raised `memory_limit` with headroom, < ~20 s. Failing: lower caps or report the Gotenberg/mPDF fallback to the orchestrator (decision outside scope).
- [ ] Full run: `npm test`, `npm run lint -w frontend`, `cd backend && composer phpstan && composer cs-check` (names per `composer.json` scripts), `composer audit`.

**Commit:** `perf(pdf): benchmark and final cap/memory values`

---

## Risks

- **Memory/time:** dompdf DOM cost scales with table cells; month grid with many events per cell and A3 are worst cases. Mitigation: caps, per-cell "+k more", route-local `memory_limit`, benchmark T12. Fallback per spec.
- **GD on alpine:** `install-php-extensions gd` builds against libpng/freetype; PNG alpha support and no JPEG/WebP needed. Verify `php -r 'var_dump(function_exists("imagecreatefrompng"));'` in the image. Missing GD makes dompdf silently skip images (no emoji) or throw: T8 asserts the emoji path renders.
- **Platform check in composer stage:** see mismatch 1; also local developers need `ext-gd`.
- **Emoji sequences:** ZWJ/skin-tone/flag sequences must match bundled file names exactly; unmatched ones are dropped by design. Noto file names may differ for `fe0f` handling; the manifest test covers real emoji-mart samples.
- **Asset size/licence:** PNG set size is checked in T2 before commit.
- **ETag/FORMAT_VERSION:** PDF reuses `IcsEventReader` read-only and adds no field to `IcsEvent`; any change to `IcsEvent`/`IcsService` is out of scope and would force `FORMAT_VERSION` + golden regeneration.
- **dompdf security:** hostile text covered by the T8 test; keep `^3.1.6`, `composer audit` in CI; no `|raw`.
- **Blocking FPM workers:** rate limit + event cap are the only protection; no queue in v1.
- **Timeouts:** proxy/FPM timeouts below 60 s would cut the response (T1 check).

## Definition of done

- [ ] All 12 tasks committed, one commit each, working tree clean.
- [ ] `cd backend && composer test` green; `IcsGoldenTest` and `FeedIcsEtagTest` unchanged; `IcsService::FORMAT_VERSION` unchanged.
- [ ] `npm test -w frontend`, `npm run lint -w frontend`, frontend build green; de/en keys identical.
- [ ] `OpenApiSpecTest` green; `docs/api/openapi.yaml`, `CLAUDE.md`, `frontend/AGENTS.md`, `CHANGELOG.md`, `docs/redesign/BACKEND-GAPS.md` updated.
- [ ] `composer audit` clean; dompdf >= 3.1.6; CI installs `gd`.
- [ ] Docker image builds with `gd`/`intl`; PDF generated inside the image; benchmark within criteria.
- [ ] Hostile-input, 400/401/403/404/422/429, language/weekday, emoji legend tests present and green.
- [ ] E2E spec passes in the isolated environment.
- [ ] Emoji licence file and NOTICE shipped next to the PNGs.
- [ ] Spec status updated to implemented.
