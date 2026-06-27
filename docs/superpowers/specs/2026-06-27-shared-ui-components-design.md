# Design Spec: Shared UI Components & Map Refactor

**Date:** 2026-06-27  
**Status:** Approved  
**Scope:** Frontend — `frontend/src/`

---

## Problem

The frontend pages contain extensive duplication of Tailwind class combinations and structural JSX patterns. An audit of all pages identified 12+ distinct repeated patterns across `src/pages/` and `src/components/`, contributing to:

- Hard-to-maintain styling (changing a card style requires editing 8+ files)
- Inconsistent spacing variants (`mb-4` vs `mb-6`, `space-y-1` vs `space-y-1.5`)
- Map initialization code duplicated verbatim across two components

---

## Solution

### Part 1 — Shared UI Component Library

Create `src/components/ui/shared/` with 11 focused, prop-driven components. Each replaces a well-defined repeated pattern. All accept an optional `className` for escape-hatch overrides.

#### Component Definitions

**`FormField`**  
Wraps a label + input in `space-y-1.5` with optional description text.  
Props: `label: string`, `description?: string`, `children: ReactNode`, `className?: string`  
Replaces: 18+ `<div className="space-y-1.5">` groups across ClubPage, ProfilePage, SetupPage, LocationsPage, FeedsPage, CalendarSettingsPage.

**`SectionHeader`**  
Renders `flex items-center justify-between mb-6` with title, optional subtitle, and optional action slot.  
Props: `title: string`, `description?: string`, `action?: ReactNode`, `className?: string`  
Replaces: 10+ manual header divs across TemplatesPage, LocationsPage, FeedsPage, ClubPage.

**`EmptyState`**  
Dashed border box with centered message and optional icon.  
Props: `message: string`, `icon?: ReactNode`, `className?: string`  
Replaces: 4+ instances in TemplatesPage, EventsListPage, LocationsPage, FeedsPage.

**`ListCard`**  
`bg-white rounded-xl border border-slate-200 divide-y divide-slate-100` wrapper with a typed items array, render prop, and built-in empty state fallback.  
Props: `items: T[]`, `renderItem: (item: T) => ReactNode`, `emptyMessage: string`, `className?: string`  
Replaces: 8+ manual card+list combos in ClubPage, EventsListPage, and settings pages.

**`ListRow`**  
`flex items-center justify-between px-4 py-3` row with title, optional subtitle, and actions slot. Used inside `ListCard`.  
Props: `title: string`, `subtitle?: string`, `actions?: ReactNode`, `className?: string`  
Replaces: 6+ manual row divs in ClubPage, ProfilePage.

**`TagBadge` + `TagBadgeRow`**  
Single colored pill and a `flex-wrap gap-1.5` group.  
`TagBadge` props: `label: string`, `icon?: string`, `variant: "purple" | "blue" | "green" | "slate"`, `className?: string`  
`TagBadgeRow` props: `items: Array<{ id: string; name: string; icon?: string }>`, `variant: TagBadge["variant"]`, `className?: string`  
Replaces: 8+ badge rows in EventsListPage, FeedPage, TemplatesPage, ProfilePage.

**`FilterPillGroup`**  
Controlled toggle-button group for filter UIs. The active state is owned externally.  
Props: `label?: string`, `items: Array<{ id: string; label: string }>`, `selected: string[]`, `onChange: (id: string) => void`, `className?: string`  
Replaces: 6+ filter pill blocks in CalendarPage, FeedPage.

**`DangerZoneConfirm`**  
Two-step destructive action: a link → a red confirmation box with confirm/cancel and loading state. Has one internal boolean state.  
Props: `triggerLabel: string`, `title: string`, `description: string`, `confirmLabel?: string`, `onConfirm: () => Promise<void> | void`, `isLoading?: boolean`, `className?: string`  
Replaces: 3+ danger zone patterns in ClubPage, ProfilePage.

**`SearchInput`**  
Icon-prefixed input with a clear (×) button.  
Props: `value: string`, `onChange: (val: string) => void`, `placeholder?: string`, `className?: string`  
Replaces: 3+ icon-wrapper patterns in CalendarPage, EventsListPage.

**`FullPageLoader` / `FullPageError`**  
Centered `min-h-screen bg-slate-50` wrappers for loading and error states.  
Props: `FullPageLoader` — none (or optional `message?`). `FullPageError` — `message: string`.  
Replaces: 5+ full-page loading patterns in AuthCallbackPage, ClubsPage, FeedPage, LoginPage, SignupPage.

**`Alert`**  
Colored alert box with `info` / `warning` / `danger` variants and optional actions slot.  
Props: `variant: "info" | "warning" | "danger"`, `message: string`, `actions?: ReactNode`, `className?: string`  
Color map: info → blue, warning → amber, danger → red.  
Replaces: 2+ alert boxes in CalendarPage, ClubPage.

#### File Layout

```
src/components/ui/shared/
  FormField.tsx
  SectionHeader.tsx
  EmptyState.tsx
  ListCard.tsx
  ListRow.tsx
  TagBadge.tsx
  FilterPillGroup.tsx
  DangerZoneConfirm.tsx
  SearchInput.tsx
  PageLoader.tsx          (exports FullPageLoader + FullPageError)
  Alert.tsx
  index.ts                (barrel export of all above)
```

---

### Part 2 — Map Initialization Refactor

#### Problem

`MapPicker.tsx` and `LocationsOverviewMap.tsx` duplicate ~20 lines of identical map initialization boilerplate:
- Dynamic `import('mapbox-gl')`
- `initMapboxProxy(mapboxgl)`
- `new mapboxgl.Map({ container, style: 'mapbox://styles/mapbox/streets-v12', transformRequest, performanceMetricsCollection: false })`
- `map.addControl(new mapboxgl.NavigationControl(), 'top-right')`
- Cleanup on unmount

#### Solution

Extract a `useMapbox` hook in `src/components/locations/useMapbox.ts`:

```ts
interface UseMapboxOptions {
  initialCenter?: [number, number]  // [lng, lat], default [10, 51]
  initialZoom?: number              // default 5
  onLoad?: (map: mapboxgl.Map, mapboxgl: typeof import('mapbox-gl').default) => void
}

function useMapbox(options: UseMapboxOptions): {
  mapContainerRef: RefObject<HTMLDivElement>
  mapRef: RefObject<mapboxgl.Map | null>
}
```

The hook handles: dynamic import, proxy init, Map construction, NavigationControl, and cleanup. The `onLoad` callback receives the `map` instance and the mapboxgl module so callers can add their markers/interactions.

Both `MapPicker.tsx` and `LocationsOverviewMap.tsx` are refactored to use this hook.

#### Bug Fix

`EventModal.tsx` currently imports `next/dynamic` for `MapPicker` — incorrect for a Vite SPA. Fix to `React.lazy()` with `<Suspense>`, matching how `LocationsPage.tsx` already loads the same component.

---

## Migration Strategy

1. **Build all shared components first** (no page changes yet).
2. **Migrate pages in parallel** via sub-agents, one component-type at a time.
3. **Build `useMapbox` hook** and update both map components and fix the EventModal bug.
4. **Commit each logical group** separately for clean git history.

---

## What This Does NOT Change

- No behavioral changes — this is a visual/structural refactor only.
- No changes to API calls, state management, or routing.
- No new dependencies.
- No changes to shadcn/ui components in `src/components/ui/` (those stay as-is).

---

## CLAUDE.md / AGENTS.md Updates

After implementation, add to both files:

> **Shared UI components:** Before adding structural JSX or Tailwind layout patterns to a page, check `src/components/ui/shared/` for existing components (`FormField`, `SectionHeader`, `EmptyState`, `ListCard`, `ListRow`, `TagBadge`, `TagBadgeRow`, `FilterPillGroup`, `DangerZoneConfirm`, `SearchInput`, `FullPageLoader`, `FullPageError`, `Alert`). Use these instead of writing raw Tailwind. For maps, use the `useMapbox` hook from `src/components/locations/useMapbox.ts`.
