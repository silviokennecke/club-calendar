# PDF Export — Design Spec

**Date:** 2026-06-27
**Status:** Approved — revised 2026-10-26 (not implemented)

---

## Revision history

- **2026-10-26** — aligned with the current code and the user's decision:
  - PDF is a second format on the existing export page `EventsExportPage` (`…/events/export`), next to ICS; no new `ExportPage`, route or header buttons.
  - Endpoint renamed to `GET /api/calendars/{calendarId}/events.pdf` with the same filter parameters as `events.ics` (`from`/`to` are `YYYY-MM-DD`, `includeDrafts`, `targetGroupIds[]`); old `YYYY-MM` / required-`includeDrafts` contract dropped.
  - Layout technique corrected: dompdf is CSS 2.1 only (no grid, no flexbox) → fixed-layout `<table>`.
  - New sections: library decision, security hardening, performance and limits (caps, rate limit, errors, OpenAPI).
  - Events come from `IcsEventReader` (array rows, no hydration), not from `EventRepository`; filters shared with `EventExportService`.
  - Test file names, auth (member voter, 401/403/404) and error format (RFC 7807) corrected.
- **2026-10-27** — user decisions applied, open questions resolved:
  - Language and first weekday come from the signed-in user's stored preferences (`User.language`, `User.firstDayOfWeek`), read server-side; no request parameters.
  - Translations: new Symfony translation domain `pdf`, month/weekday names via `IntlDateFormatter` (`ext-intl`).
  - Property emoji are shown on each event item, plus an emoji legend at the end of the document (only properties used in the export); emoji are drawn as bundled local PNG files (allow-list lookup by codepoints), replacing the former "strip emoji" rule. Property names come from a separate lookup query, `IcsEventReader` and the ICS output stay untouched.
  - v1 scope explicit: no holidays, no event notes. Caps (366 days / 2000 events / 10 per 10 min) accepted as starting values, the benchmark may adjust them.
  - Verified: `ext-dom`/`ext-mbstring` ship with the base image, `ext-intl` is installed in `docker/Dockerfile`, `ext-gd` is NOT (needed for PNG, must be added); there is no dedicated ICS export controller test file (see Testing).
- **2026-10-27** — open points settled:
  - Emoji set: Noto Emoji PNGs; Twemoji dropped as an option. Licence and bundle size are verified when the PNGs are added, with the licence file and attribution shipped alongside.
  - dompdf is accepted as the PDF library, including its PNG/emoji handling; the benchmark remains the release check.
  - First weekday confirmed: `0` = Sunday, every other value = Monday (as in `CalendarPage` and the PDF).
  - Open questions list resolved and removed.

---

## Overview

Members export a calendar as a PDF from the existing export page. The page offers a format choice (ICS | PDF); date range, status (drafts) and audience filters are shared by both formats. PDF adds a layout and paper options. The PDF is generated server-side (Symfony + dompdf) and downloaded with the JWT, like the ICS file.

---

## Library decision

**dompdf/dompdf, constraint `^3.1.6`.** Last verified 2026-10-26.

- 3.1.6 (2026-07-20) fixed six advisories for untrusted HTML/SVG/font input; earlier versions are affected, so the floor is 3.1.6 and `composer audit` runs in CI.
- Pure PHP: no binary in `php:8.4-fpm-alpine`, no extra container. LGPL-2.1. Needs `ext-dom` and `ext-mbstring` only (add both, plus `ext-intl` and `ext-gd`, to `composer.json` `require`). Verified in `docker/Dockerfile`: `php:8.4-fpm-alpine` already ships `dom` and `mbstring`, and `intl` is installed explicitly; `gd` is not installed, so add `gd` to the `install-php-extensions` line (dompdf needs GD to embed PNG images, see "Emoji"; it is already present locally).
- PHP 8.4 is supported. PHP 8.5 support is not explicitly stated; dompdf has no upper PHP cap, so re-check on a PHP upgrade.
- Twig HTML → PDF fits the existing template stack.

Rejected:

| Option | Reason |
|---|---|
| mPDF | GPL-2.0, needs `ext-gd`, no real gain over dompdf for table layouts |
| TCPDF | not HTML-first, layout by coordinates |
| FPDF | no HTML at all |
| Browsershot / Gotenberg | full CSS grid/flex, but Chromium/Node or an extra container; disproportionate for four table layouts |
| wkhtmltopdf / Snappy | archived, unmaintained engine, CVE-2026-46643 |

**Fallback** if rendering or memory proves inadequate in the benchmark: Gotenberg as a sidecar container, or mPDF if GPL is acceptable.

---

## Architecture

### Backend

- `PdfExportController` is not needed as a new class: add `exportPdf()` next to `exportIcs()` in `EventController` (`#[Route('.pdf', methods: ['GET'])]`, same `#[IsGranted(CalendarMemberVoter::CALENDAR_MEMBER, subject: 'calendar')]`; viewers may export, archived calendars allowed, like ICS).
- `PdfExportService` (new): validates, reads events, renders Twig, runs dompdf.
- Shared filtering: extract the query building of `EventExportService::export()` (calendar, `from`/`to` overlap via `COALESCE(e.dateEnd, e.date)`, `includeDrafts`, `targetGroupIds` incl. `MAX_TARGET_GROUPS` and the club check) into a public method (e.g. `EventExportService::buildQuery(): QueryBuilder`) used by both formats, so ICS and PDF cannot drift apart.
- Event data: `App\Ics\IcsEventReader::chunks($qb)` → readonly `IcsEvent` / `IcsLocation` DTOs (no entity hydration; has `name`, `date`, `dateEnd`, `timeBegin/End`, `isAllDay`, `isDraft`, `note`, `location`, `propertyIcons`, `featureNames`, `targetGroupNames`, calendar/event time zones). The PDF consumes the chunks into arrays per day; caps below bound memory. Rendering uses the club time zone like the feeds.
- Property names for the legend: `IcsEvent` carries only `propertyIcons`. Chosen (less invasive): a separate lookup in `PdfExportService`, not a reader change. While consuming the chunks it collects the event ids; afterwards it runs `SELECT DISTINCT p.icon, p.name FROM EventProperty ep JOIN ep.property p WHERE ep.event IN (:ids) AND p.icon IS NOT NULL` in batches of 500 ids (same batching as the reader) and groups names by icon (several properties may share an emoji: the legend lists them joined, sorted). `IcsEventReader`, `IcsEvent` and `IcsService` stay unchanged, so the ICS output is byte-identical, `IcsGoldenTest` stays green and `IcsService::FORMAT_VERSION` does not change.
- Template per layout: `backend/templates/pdf/{month_grid,annual_overview,quarter_overview,agenda}.html.twig` plus a base `pdf/base.html.twig` (shared `@page` and CSS).
- PDF library: `dompdf/dompdf` `^3.1.6`.
- Out of scope in v1: holidays (`HolidayEvent`; ICS has none either) and the event `note` are not part of the PDF.
- Language and first weekday: read from the signed-in user, not from request parameters and not from the time zone. Real fields: `User::$language` (`'de'` | `'en'`, default `'en'`, `getLanguage()`) and `User::$firstDayOfWeek` (int 0-6, 0 = Sunday, default 1 = Monday, `getFirstDayOfWeek()`); both are returned by `AuthService::getMe` and written by `PATCH /api/auth/me` (`firstDayOfWeek`, `language`; OpenAPI: `firstDayOfWeek` integer 0-6, `language` enum `en|de`). So a first-weekday preference IS stored (no derivation from the language). The frontend profile (`PreferencesSection`) offers Monday/Sunday only, and `CalendarPage` coerces `firstDayOfWeek === 0 ? 0 : 1`; the PDF follows the same rule (0 = Sunday, anything else = Monday) so web and PDF agree. Fallback for a null/invalid value: language `en`, Monday. The user is taken from the token storage (`CurrentUserResolver`), like other controllers.
- Translations/dates: `symfony/translation` is installed and `backend/translations/` exists (mail domain `messages+intl-icu.{de,en}.json`). Add a domain `pdf` (`translations/pdf+intl-icu.de.json`, `pdf+intl-icu.en.json`, identical keys) for the PDF labels (title, "Draft", "Legend", "+{count} more", column headings, "generated on"), rendered with the `trans` filter and `locale` = user language. Month and weekday names: `IntlDateFormatter` (patterns `LLLL`, `EEEEEE`/`EEE`) with the user locale. Recommended over a hand-written lookup table because `ext-intl` is already installed in `docker/Dockerfile` (`install-php-extensions pdo_mysql intl opcache`) and available locally; add `ext-intl` to `composer.json` `require`. The weekday header row is rotated by `firstDayOfWeek`.
- Emoji rendering (property icons): see "Emoji" below.

### Frontend (existing page, no new route)

`frontend/src/pages/events/EventsExportPage.tsx` (route `/clubs/:clubId/calendars/:calendarId/events/export` in `App.tsx`, lazy via `pages/lazy.ts`) is extended; entry points stay as they are (`CalendarPage` "download" `LinkButton` to `routes.export`, link on `FeedsPage`). No change to `App.tsx`, `lazy.ts`, `navigation.ts` or `calendarSwitchPath.ts`.

1. **Format section (new, first):** radio fieldset `ap-fieldset` / `ap-check` (same markup as the range and status sections) with ICS and PDF; state `format: "ics" | "pdf"`, default `ics`.
2. **Reused for both formats, unchanged:** range section (`ExportRange`, `monthBounds`, `Field` + `TextInput type="date"`), status section (`includeDrafts` + draft `Banner`), audiences section (`FilterPillGroup` over `GET /api/clubs/:clubId/target-groups`), preview (`selectForExport` count on `useAllEvents`), failure `Banner`, `Button` with `loading`/`loadingLabel`, `LinkButton` cancel, `toast.success`.
3. **PDF-only section (shown only when `format === "pdf"`):**
   - Layout: radio fieldset (`ap-check`) with month grid, annual overview, quarter overview, agenda; unavailable layouts are `disabled` with a hint (rules below).
   - Paper: `Field` + `NativeSelect` (`a4` | `a3`) and orientation `NativeSelect` (`auto` = layout default | `portrait` | `landscape`).
4. **Range for PDF:** PDF needs a bounded period (ICS "Whole calendar" stays ICS-only: the option is hidden/disabled for PDF, and switching to PDF with `all` selected falls back to `month`). `ExportRange` gets a `year` value (full calendar year of `today`, shown for PDF only) so the annual overview is reachable in one click. `exportRange()` handles `year`.
5. **Download:** same flow as ICS: `apiFetch('/api/calendars/${calendarId}/events.pdf${query}', { headers: { Accept: 'application/pdf' } })` (JWT, refresh on 401) → `res.blob()` → `downloadBlob(blob, name)` (`lib/events/ics.ts`: object URL + `a[download]`) → `toast.success`. File name via a generalised `exportFileName(name, ext)` (keeps `icsFileName` as wrapper). Query: `exportQuery()` plus `layout`, `paper`, `orientation` (new `pdfExportQuery`, in `lib/events/ics.ts` or a new `lib/events/pdf.ts` with Vitest tests).
6. **Errors:** on `!res.ok` the problem body is read and mapped by `code`, never `detail`: `too_many_events` → "too many events, shorten the period", `validation_failed` on `to` → "period too long", `rate_limited` → "try again later" (`Retry-After`), `quota`/others → generic failure banner. (`errorFrom` in `lib/api.ts` is module-private; export it or add an `apiDownload` helper.)
7. **Timeout:** `LONG_REQUEST_PATH` in `lib/api.ts` (120 s) is extended to `\/events\.pdf(\?|$)`.
8. **Preview:** the count uses the same `selectForExport` rule; for PDF it additionally disables the button and shows a `Banner` when the count exceeds the PDF cap or the period exceeds the range cap (backend stays authoritative).
9. **i18n (de.json + en.json, identical keys/placeholders, `i18n.test.ts`):** new under `events.export`: `format.{title,ics,icsHint,pdf,pdfHint}`, `range.year`, `pdf.layout.{title,month,monthHint,annual,annualHint,quarter,quarterHint,agenda,agendaHint,unavailable}`, `pdf.paper.{label,a4,a3}`, `pdf.orientation.{label,auto,portrait,landscape}`, `download` split into `downloadIcs` / `downloadPdf` (remove the old `download` key if unused), `intro` per format, `failed.tooMany`, `failed.rangeTooLong`, `failed.rateLimited`. Update `frontend/AGENTS.md` (events section, "…/events/export" sentence, `LONG_REQUEST_PATH` note) and CHANGELOG `[Unreleased]`.
10. **Tests:** Vitest for the new query/file-name/layout-availability helpers and the page (format switch hides/shows PDF options; request URL and headers); an E2E case in the existing flow is optional.

---

## API Endpoint

```
GET /api/calendars/{calendarId}/events.pdf
```

JWT, calendar member (viewer+), archived calendars allowed. Ids are UUIDs as everywhere (`calendarId`, `targetGroupIds[]`).

### Query Parameters

| Param | Values | Required |
|---|---|---|
| `from` | `YYYY-MM-DD` (events ending on or after) | yes |
| `to` | `YYYY-MM-DD` (events starting on or before, not before `from`) | yes |
| `includeDrafts` | `true`/`false`/`1`/`0` (default `false`) | no |
| `targetGroupIds[]` | target group ids of the club (at most 100; comma-separated `targetGroupIds` also accepted) | no |
| `layout` | `month-grid` \| `quarter-overview` \| `annual-overview` \| `agenda` | yes |
| `paper` | `a4` (default) \| `a3` | no |
| `orientation` | `auto` (default: per layout) \| `portrait` \| `landscape` | no |

`from`, `to`, `includeDrafts` and `targetGroupIds` are parsed and validated by the same code as `events.ics` (`Input::optionalDate`, `Input::assertDateRange`, `EventExportService::targetGroupIds`), so the selected events are identical.

### Response

- `200 application/pdf`, `Content-Disposition: attachment; filename="<calendar-slug>.pdf"` (slug logic of `EventExportService::contentDisposition`, extension parameterised), `Cache-Control: no-cache, no-store`, `X-Content-Type-Options: nosniff`. Not streamed (dompdf builds the document in memory): `Content-Length` is set.
- Errors are RFC 7807 via `ApiProblemException`, all raised before rendering: `400 validation_failed` / `invalid_request` (bad params, `from > to`, range too long, field `to`/`layout`/…), `401`, `403` (non-member), `404`, `422 unknown_reference` (foreign target group), `422 too_many_events` (cap), `429 rate_limited` + `Retry-After`.

---

## Layouts

Layouts are derived from the dates; page content is limited to `from`..`to` (days outside the range inside a touched month are shown greyed, without events).

### A — Month Grid (`month-grid`)
- One page per month touched by the range, portrait, A4 default.
- 7-column `<table style="table-layout: fixed; width: 100%">`: weekday header row starting at the user's `firstDayOfWeek`, then one `<tr>` per week with day cells.
- Day cell: day number + stacked event lines (time + name). If more events than fit: first N and "+k more".

### B — Annual Overview (`annual-overview`)
- One landscape page, 12 months as a 4 × 3 outer table; each month a compact day-number table (no nested-table nesting beyond this one level: build each month as a separate `<td>` containing one table; if dompdf layout proves unstable, flatten to one table with month blocks).
- Days with events marked with a text marker (bold + background colour); chronological event legend below, or on the following page when it does not fit.
- Available only when the range is exactly Jan 1 – Dec 31 of one year.

### C — Quarter Overview (`quarter-overview`)
- Landscape; three months side by side (one `<td>` per month with a compact grid), event names in day cells.
- Full-year export = 4 pages; other ranges page through in 3-month chunks, the last page shows the remaining 1–2 months.
- Available when the range touches at least 3 calendar months.

### D — Agenda / List (`agenda`)
- Portrait; one table: Date | Time | Event name | Location | Tags (features, target groups). Month heading rows; `page-break-inside: avoid` on rows; header row repeats (`thead { display: table-header-group }`).
- Always available.

### Layout technique (dompdf = CSS 2.1 only)

- **No CSS grid, no flexbox.** Use `<table>` with `table-layout: fixed` and explicit column widths.
- Avoid nested tables (only where noted above) and floats; no `position: absolute` for layout.
- `page-break-inside: avoid` on `<tr>` only; explicit `page-break-after: always` between month pages.
- Paper and orientation via `@page { size: A4 portrait; margin: … }` in the template (generated from `paper`/`orientation`), and `Dompdf::setPaper()` with the same values.
- Fonts: DejaVu Sans only for text (see security); emoji are images, not font glyphs.

### Availability rules

| Layout | Available when |
|---|---|
| Month Grid | always |
| Agenda | always |
| Quarter Overview | range touches ≥ 3 calendar months |
| Annual Overview | range = Jan 1 – Dec 31 of one year |

The backend enforces the rules (400 `validation_failed`, field `layout`); the UI disables unavailable layouts and resets to Month Grid when the selection becomes unavailable.

---

## Security

dompdf renders HTML that contains user-controlled text (event names, locations, notes), so it is hardened and event text never reaches the engine as markup.

- Options: `isRemoteEnabled=false`, `isPhpEnabled=false`, `isJavascriptEnabled=false`, `isHtml5ParserEnabled=true`, `chroot` = a dedicated directory (`backend/var/pdf-assets` or a templates asset directory containing only the bundled logo/fonts), `allowedProtocols` limited to `file://` inside the chroot (no `http(s)`, no `data:`), `fontSubsetting=true`, `tempDir`/`fontDir`/`fontCache` under `backend/var/` (not `public/`, not the vendor dir), `defaultFont` = `DejaVu Sans` (umlauts).
- No user-supplied images, SVG, fonts or CSS: event text is passed only through Twig auto-escape (never `|raw`, never inside `style` attributes, never in `@page`/`<style>` blocks). Names are length-capped for display.
- Emoji: see "Emoji" below. Property icons are looked up only through the allow-list; emoji inside event names and locations are not rendered as images (see below) and are removed from the text so dompdf never draws boxes.
- Logo only as a local file inside the chroot (e.g. `backend/assets/mail/logo.png` copied/linked there); no logo upload.
- The font directory is not writable by request data; `var/` files are not served by the web server.
- CI: `composer audit` (fail on advisories) in `.github/workflows/ci.yml`; dompdf stays on the patched `^3.1.6`.
- **Emoji lookup is an allow-list, never a path.** The user-chosen `Property.icon` (up to 32 chars, free text) is only converted to a codepoint key and looked up in a manifest of the bundled files; the resolved path comes from the manifest, never from the input; no `data:` URI, no user-supplied file, the images live inside the chroot (`backend/var/pdf-assets/emoji/` or `backend/assets/pdf/emoji/` configured as chroot).
- **Required hostile-input test** (PHPUnit): event name/location/note containing `<img src="file:///etc/passwd">`, `<style>@font-face{src:url(http://127.0.0.1:1/x)}</style>`, `<svg>`/`data:image/svg+xml` URIs, `<link rel=stylesheet href=…>` and `<?php … ?>`; the export must return 200 with a non-empty PDF, no HTTP/file fetch must happen (assert via the options + an unreachable loopback URL that would fail/hang loudly, and that the PDF text contains the payload as literal text), and no files outside the chroot are read.

---

## Emoji

Each event item shows the emoji of its properties (`IcsEvent::propertyIcons`); the last page (or the end of the agenda) has a legend "emoji = property name" for the properties actually used in the exported events.

**Problem:** dompdf renders no emoji with DejaVu Sans (boxes). Options:

| Option | Assessment |
|---|---|
| Emoji font (Noto Emoji monochrome, Symbola) | Not recommended. dompdf/php-font-lib handles only monochrome TrueType outlines (no colour emoji fonts: COLR/CBDT/SVG tables are ignored); astral codepoints, variation selectors (`U+FE0F`), ZWJ sequences, flags and skin tones are not shaped (no GSUB), so sequences fall apart into several glyphs or boxes; variable-font instancing and subsetting add risk. Glyph coverage is incomplete, so boxes remain possible. |
| Local PNG images keyed by codepoint sequence | **Chosen.** Sequences are exactly one file, colour, no shaping needed, deterministic output. Needs `ext-gd` (dompdf embeds PNG through GD) and ~2-5 MB of bundled assets. |
| SVG images | Not recommended: dompdf renders SVG via php-svg-lib, and recent dompdf advisories concern untrusted SVG; avoid SVG parsing on the server. |

**Chosen approach:** bundled Noto Emoji colour PNGs (72 px, from `googlefonts/noto-emoji`, file names `emoji_u<hex>[_<hex>...].png`). Licence: Apache-2.0 per our notes. When the PNGs are added, the licence and the bundle size (repository and Docker image) must be verified, and the licence file and attribution (NOTICE) are shipped next to the images. Only the emoji the frontend picker (emoji-mart) can produce need to be bundled.

Lookup (`App\Pdf\EmojiImages`):
1. Take the icon string (NFC), split it into codepoints, lower-case hex joined with `_`. Try the key as is, then without `U+FE0F`. The key must match `^[0-9a-f]{2,6}(_[0-9a-f]{2,6}){0,9}$` before any lookup.
2. Look it up in a manifest (a generated list of the bundled file names, built once and cached, or a `scandir` of the directory); the path is `<emoji dir>/<manifest entry>`, never built from the input otherwise.
3. Rendered in Twig as `<img src="<absolute path inside the chroot>" class="emoji">` (fixed size, e.g. 9 pt in event items, 11 pt in the legend).
4. **Fallback:** no manifest entry (unknown, odd, multi-emoji string, plain text in the icon field) means no image: the symbol is omitted from the event item and has no legend entry; never a box and never raw text from the field. Only icons that resolved appear in the legend, and a property whose icon does not resolve is omitted from the legend as well.
5. Emoji inside event names, locations and other text are not turned into images; they are removed from those strings in the PDF path (`\p{Extended_Pictographic}`, `U+FE0F`, `U+200D`, skin tone modifiers `U+1F3FB-1F3FF`, regional indicators, tag characters) so no boxes appear.

Legend: after the last page content, a table "emoji | property name(s)", sorted by name, built from the property lookup above; omitted entirely when no resolvable emoji was used. In the agenda layout the emoji appear in the Tags column in front of feature/target group names.

---

## Performance and limits

dompdf is memory- and CPU-hungry, especially with many small table cells. The figures below are **estimates, not measured**; the benchmark task decides the final values before release.

- **Range cap** (accepted as starting values; the benchmark below may adjust them): `to - from` at most **366 days** (stricter than the 1830 days of the list/ICS: one year is the largest layout, a PDF of five years is not useful). Violation: 400 `validation_failed`, field `to` (`Input::assertMaxRange($from, $to, PdfExportService::MAX_RANGE_DAYS)`).
- **Event cap:** at most **2000 events per PDF** (starting value; stricter than the 5000 of list/import). Counted with a cheap `COUNT` query on the shared filter before reading/rendering; exceeding it: **422 `too_many_events`** (field `from`/`to`), same code as series (`SeriesRule::MAX_EVENTS`) and the import (413).
- **Rate limit:** per user (not only per IP) through `AuthRateLimiter::assertPdfExportAllowed(Request, string $userId)`, limiter `pdf_export` in `config/packages/rate_limiter.yaml` (starting value: 10 per user and 10 min plus 30 per IP and 10 min), 429 `rate_limited` + `Retry-After`, checked before any DB/render work. Test env: high limit like the other limiters (state in `var/test-auth-limiter`).
- **Memory/time:** `docker/php.ini` has `memory_limit = 256M`. Raise it only for this route (`ini_set('memory_limit', '512M')` and `set_time_limit(60)` at the start of `exportPdf()`, values set by the benchmark), not globally. Chunked reading (`IcsEventReader::chunks`) bounds the DTO memory; the HTML/DOM is the dominant cost.
- **Benchmark task (release check, may adjust the caps and `memory_limit`):** synthetic calendar with ~1000 events in one year; measure peak memory (`memory_get_peak_usage`), time and file size for every layout and A4/A3, in the `php:8.4-fpm-alpine` image; as `phpunit --group performance` (excluded by default, like the ICS memory check). Pass criteria: stays below the raised `memory_limit` with headroom, under ~20 s. Failing → lower the caps or switch to the fallback above.
- **Concurrency:** PHP-FPM workers are blocked during rendering; the rate limit and event cap are the protection. No queue in v1.
- **Docs:** `docs/api/openapi.yaml` gets the `events.pdf` path (next to `events.ics`: parameters, 200 `application/pdf`, 400/401/403/404/422/429) and the new caps in "Quotas and input limits" (range 366 days, 2000 events per PDF, `too_many_events` 422); `backend/tests/Unit/OpenApiSpecTest.php` fails when route and document drift, so both change together. Update `CLAUDE.md` ("Event Import, Export, Bulk, Series") and `docs/redesign/BACKEND-GAPS.md` (operations: memory limit, `var/pdf-assets`).

---

## Backend Implementation Details

### `EventController::exportPdf`

- Route `GET /api/calendars/{calendarId}/events.pdf`; rate limit → delegate to `PdfExportService` → `new Response($pdf, 200, headers)`.

### `PdfExportService`

1. Validate `layout`, `paper`, `orientation`, range cap and layout availability (all `ApiProblemException`).
2. Build the filtered query via the shared `EventExportService` method, run the count check.
3. Read events with `IcsEventReader::chunks`, convert to per-day arrays in the club time zone (multi-day events appear on every day of the range they overlap), resolve property icons through `EmojiImages` (unresolved ones dropped), strip emoji from text, collect event ids, group by month. Then run the property lookup and build the legend. Load the user's `language` and `firstDayOfWeek`.
4. Render the Twig template for the layout.
5. Configure `Dompdf` (options above), `loadHtml`, `setPaper`, `render`, return `output()`.
6. Paper per layout (default for `orientation=auto`): Month Grid portrait, Agenda portrait, Quarter Overview landscape, Annual Overview landscape; size from `paper`.

### Twig Templates

Each template receives:
- `months` — list of `{ year, month, label, weeks[] }`, each week 7 cells `{ date|null, inRange, number, events[] }`; `agenda` receives `rows` grouped by month instead
- `calendarName`, `clubName` — strings
- `includeDrafts` — bool (drafts are marked "Entwurf"/"Draft" in the PDF)
- `from`, `to` — display strings; `generatedAt`
- `locale`, `firstDayOfWeek` — from the signed-in user; labels from the translator (domain `pdf`), month/weekday names from `IntlDateFormatter`, no hard-coded strings
- `legend` — list of `{ emojiPath, names[] }` (only used and resolvable properties; empty = no legend); event items carry `emojiPaths[]`

---

## Testing

- PHPUnit controller test `backend/tests/Controller/EventExportPdfTest.php` (new file; there is no dedicated ICS export test: `events.ics` is covered in `ExportBulkTest.php`, `DateRangeParamsTest.php`, `ClubRolesTest.php` and others) using the existing controller test base:
  - valid request returns 200, `application/pdf`, body starts with `%PDF`
  - each of the 4 layouts returns a non-empty PDF
  - 400: invalid/missing `layout`, `from > to`, range > 366 days, unavailable layout (annual for a partial year)
  - 401 without token, 403 non-member, 404 unknown calendar, viewer role allowed, archived calendar allowed
  - 422 `unknown_reference` for a foreign target group, 422 `too_many_events` over the cap
  - 429 `rate_limited` with `Retry-After`
  - drafts only with `includeDrafts`; target group filter parity with `events.ics` (same event set for the same query)
  - hostile-input test (see Security)
  - language/weekday: a user with `language=de`, `firstDayOfWeek=1` gets German labels and a Monday-first header; `en` + `0` gets English labels and Sunday-first (assert via extracted PDF text or the rendered HTML in a service-level test)
  - emoji: an event with a property whose icon resolves renders without error and the legend lists its name; an unknown/odd icon (free text, `<img src=...>`, `../../etc/passwd`, a multi-emoji string, an emoji without a bundled image) renders 200, draws no box, is omitted from the item and the legend, and reads no file outside the chroot; legend test: only properties used in the exported events appear (a property of a draft excluded by `includeDrafts=false` or outside the range is absent), two properties with the same emoji share one legend row
  - `IcsGoldenTest` and `FeedIcsEtagTest` stay green unchanged (`FORMAT_VERSION` not touched)
- Unit tests for `EmojiImages` (key normalisation incl. `U+FE0F`, ZWJ sequences, allow-list, invalid keys), emoji text stripping, layout availability, week/cell building (rotation by `firstDayOfWeek`).
- `OpenApiSpecTest` passes with the new route; `SecurityHeadersConfigTest` unaffected.
- Vitest/frontend tests as listed under Frontend; performance benchmark as `--group performance`.

---

## Open questions

None.
