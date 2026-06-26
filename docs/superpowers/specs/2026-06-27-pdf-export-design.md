# PDF Export — Design Spec

**Date:** 2026-06-27
**Status:** Approved

---

## Overview

Users can export a calendar as a PDF from a dedicated export page. They choose a date range, a layout, and whether to include draft events. The PDF is generated server-side (Symfony + dompdf) and downloaded directly.

---

## Architecture

### Backend

- New Symfony controller: `PdfExportController`
- New service: `PdfExportService`
- PDF library: `dompdf/dompdf` (Composer)
- One Twig template per layout (`pdf/month_grid.html.twig`, `pdf/annual_overview.html.twig`, `pdf/quarter_overview.html.twig`, `pdf/agenda.html.twig`)
- Protected by the same JWT auth as all other `/api/` endpoints

### Frontend

- New page: `src/pages/ExportPage.tsx`, route `/clubs/:clubId/calendars/:calendarId/export`
- Entry point: an "Export PDF" button (lucide `FileDown` icon) added to the header of both `CalendarPage` and `EventsListPage`
- Download flow: `fetch()` with `Authorization` header → receive blob → create temporary object URL → trigger `<a download>` → revoke URL

---

## API Endpoint

```
GET /api/calendars/{calendarId}/export/pdf
```

### Query Parameters

| Param | Values | Required |
|---|---|---|
| `layout` | `month-grid` \| `quarter-overview` \| `annual-overview` \| `agenda` | yes |
| `from` | `YYYY-MM` | yes |
| `to` | `YYYY-MM` | yes |
| `includeDrafts` | `0` \| `1` | yes |

### Response

- `200 application/pdf` with `Content-Disposition: attachment; filename="calendar-<from>-<to>.pdf"`
- `400` if params are invalid or `from > to`
- `403` if the user does not have access to the calendar

---

## Layouts

### A — Month Grid (`month-grid`)
- One page per month, portrait A4
- 7-column CSS grid (Mon–Sun header row, then day cells)
- Each day cell: day number + stacked event chips (time + name)
- Multi-month export = multiple pages

### B — Annual Overview (`annual-overview`)
- All 12 months on one landscape A4 page, 4 columns × 3 rows
- Each month cell: compact mini-grid with day numbers; colored dot under days that have events
- Chronological event legend below the grid
- Only available when `from = YYYY-01` and `to = YYYY-12` (same year)

### C — Quarter Overview (`quarter-overview`)
- Three months side-by-side on one landscape A4 page (one column per month, compact month grid)
- Event chips inside day cells
- Full-year export = 4 pages (Q1–Q4); custom range pages through in 3-month chunks; if the range is not a multiple of 3, the last page shows the remaining 1 or 2 months
- Available when the selected range spans at least 3 months

### D — Agenda / List (`agenda`)
- Portrait A4, no grid
- Table columns: Date | Time | Event name | Location | Tags
- Events grouped under bold month-heading separator rows
- Always available

---

## Layout Availability Rules

| Layout | Available when |
|---|---|
| Month Grid | always |
| Agenda | always |
| Quarter Overview | range ≥ 3 months |
| Annual Overview | range = full Jan–Dec of one year |

If the user narrows the range and their selected layout becomes unavailable, the UI resets to Month Grid.

---

## Frontend Export Page (`ExportPage.tsx`)

### UI Elements

1. **Layout selector** — 4 radio cards, each with icon, label, short description; unavailable layouts are greyed out and non-selectable
2. **Range mode toggle** — "Full year" (year picker) vs "Custom months" (from/to month+year selectors)
3. **Include draft events** — checkbox, unchecked by default
4. **Download PDF** button — disabled while fetching, shows spinner; triggers the fetch+download flow

### Routing

- Route: `/clubs/:clubId/calendars/:calendarId/export`
- Added to `App.tsx` inside the existing protected route wrapper

### Entry Points

- `CalendarPage` header: `<Button variant="outline" size="sm">` with `FileDown` icon, links to export page
- `EventsListPage` header: same button alongside existing search input

---

## Backend Implementation Details

### `PdfExportController`

- Route: `GET /api/calendars/{calendarId}/export/pdf`
- Validates params; returns 400 on invalid input
- Delegates to `PdfExportService`

### `PdfExportService`

- Fetches events via existing `EventRepository` filtered by calendar, date range, and draft flag
- Groups events by month for template rendering
- Selects the correct Twig template based on `layout` param
- Renders HTML via `twig->render()`
- Passes rendered HTML to `Dompdf`, sets paper size and orientation per layout:
  - Month Grid: A4 portrait
  - Annual Overview: A4 landscape
  - Quarter Overview: A4 landscape
  - Agenda: A4 portrait
- Returns the PDF string to the controller, which streams it as a response

### Twig Templates

Each template receives:
- `months` — array of `{ year, month, days[] }` where each day has `{ number, events[] }`
- `calendarName` — string
- `includeDrafts` — bool (for legend/header note)
- `from`, `to` — display strings

---

## Testing

- PHPUnit integration test in `tests/Controller/PdfExportControllerTest.php`:
  - Valid request returns 200 with `application/pdf` content type
  - Invalid layout param returns 400
  - Unauthenticated request returns 401
  - Calendar not owned by user returns 403
  - Each of the 4 layouts returns a non-empty response body
