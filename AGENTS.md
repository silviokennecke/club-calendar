# Club Calendar — Agent Guide

## Backend Module Structure

The backend (`backend/`) uses NestJS with the following module layout:

| Module | Path prefix | Files |
|--------|-------------|-------|
| Auth | `/api/auth` | `src/auth/` |
| WebAuthn | `/api/auth/webauthn` | `src/auth/webauthn.controller.ts` |
| OAuth | `/api/auth/oauth` | `src/auth/oauth.controller.ts` |
| Clubs | `/api/clubs` | `src/clubs/` |
| Calendars | `/api/clubs/:clubId/calendars` | `src/calendars/` |
| Properties | `/api/calendars/:calendarId/properties` | `src/properties/` |
| Features | `/api/calendars/:calendarId/features` | `src/features/` |
| Target Groups | `/api/calendars/:calendarId/target-groups` | `src/target-groups/` |
| Locations | `/api/calendars/:calendarId/locations` | `src/locations/` |
| Event Templates | `/api/calendars/:calendarId/templates` | `src/event-templates/` |
| Feeds | `/api/calendars/:calendarId/feeds` | `src/feeds/` |
| Events | `/api/calendars/:calendarId/events` | `src/events/` |
| Public Feed | `/api/feed` | `src/public/` |

## Common Infrastructure

| File | Purpose |
|------|---------|
| `src/prisma/prisma.service.ts` | Global `PrismaService` (inject into any service) |
| `src/common/guards/jwt-auth.guard.ts` | Requires valid Bearer token; sets `request.userId` |
| `src/common/guards/club-member.guard.ts` | Requires `request.userId` to be a member of `:clubId` |
| `src/common/guards/calendar-member.guard.ts` | Requires `request.userId` to have access to `:calendarId` |
| `src/common/pipes/zod-validation.pipe.ts` | Use with `@Body(new ZodValidationPipe(schema))` |
| `src/common/decorators/current-user.decorator.ts` | `@CurrentUser()` extracts `request.userId` |
| `src/common/filters/app-exception.filter.ts` | Maps `AppError` to HTTP responses (registered via APP_FILTER) |

## Auth Flow

- **Access token**: short-lived JWT (15 min), sent in `Authorization: Bearer` header
- **Refresh token**: long-lived JWT (7 days), stored in `httpOnly` cookie at path `/api/auth/refresh`
- `JwtAuthGuard` validates access tokens; `ClubMemberGuard`/`CalendarMemberGuard` check authorization

## Testing

Tests use `@nestjs/testing` + `supertest`. Test files are in `src/routes/`. Shared helpers are in `src/test/helpers.ts`.

Run: `npm test` (requires MySQL test DB on port 3307)
