# Shared UI Components & Map Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract 11 shared UI components, a `useMapbox` hook, and fix one incorrect import to eliminate ~40% of duplicate Tailwind/JSX patterns across all frontend pages.

**Architecture:** Create `src/components/ui/shared/` with prop-driven wrapper components that replace repeated div+Tailwind patterns. Each component accepts `className` for escape-hatch overrides. Tasks 2–11 are independent of each other and can be dispatched in parallel after Task 1 completes.

**Tech Stack:** React 19, TypeScript, Tailwind CSS, Vite, `@/lib/utils` cn helper, shadcn/ui, mapbox-gl

## Global Constraints

- No behavior changes — visual/structural refactor only
- No new dependencies
- Do not modify shadcn primitives in `src/components/ui/` (only `src/components/ui/shared/`)
- Every task ends with `npm run build -w frontend` to verify TypeScript + bundle compile
- Import shared components as `import { X } from '@/components/ui/shared'`
- All components accept optional `className?: string` using `cn()` from `@/lib/utils`

---

### Task 1: Create all shared UI components

**Files:**
- Create: `frontend/src/components/ui/shared/FormField.tsx`
- Create: `frontend/src/components/ui/shared/SectionHeader.tsx`
- Create: `frontend/src/components/ui/shared/EmptyState.tsx`
- Create: `frontend/src/components/ui/shared/ListCard.tsx`
- Create: `frontend/src/components/ui/shared/ListRow.tsx`
- Create: `frontend/src/components/ui/shared/TagBadge.tsx`
- Create: `frontend/src/components/ui/shared/FilterPillGroup.tsx`
- Create: `frontend/src/components/ui/shared/DangerZoneConfirm.tsx`
- Create: `frontend/src/components/ui/shared/SearchInput.tsx`
- Create: `frontend/src/components/ui/shared/PageLoader.tsx`
- Create: `frontend/src/components/ui/shared/Alert.tsx`
- Create: `frontend/src/components/ui/shared/index.ts`

**Interfaces:**
- Produces: all components listed in the barrel export below

- [ ] **Step 1: Create FormField.tsx**

```tsx
import type { ReactNode } from 'react'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'

interface Props {
  label: ReactNode
  description?: string
  children: ReactNode
  className?: string
}

export function FormField({ label, description, children, className }: Props) {
  return (
    <div className={cn('space-y-1.5', className)}>
      <Label>{label}</Label>
      {description && <p className="text-xs text-slate-400">{description}</p>}
      {children}
    </div>
  )
}
```

- [ ] **Step 2: Create SectionHeader.tsx**

```tsx
import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

interface Props {
  title: string
  description?: string
  action?: ReactNode
  className?: string
}

export function SectionHeader({ title, description, action, className }: Props) {
  return (
    <div className={cn('flex items-center justify-between mb-6', className)}>
      <div>
        <h2 className="text-base font-semibold text-slate-900">{title}</h2>
        {description && <p className="text-sm text-slate-500 mt-0.5">{description}</p>}
      </div>
      {action}
    </div>
  )
}
```

- [ ] **Step 3: Create EmptyState.tsx**

```tsx
import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

interface Props {
  message: string
  icon?: ReactNode
  className?: string
}

export function EmptyState({ message, icon, className }: Props) {
  return (
    <div className={cn('text-center py-12 text-slate-400 text-sm border border-dashed border-slate-200 rounded-xl', className)}>
      {icon && <div className="mb-2">{icon}</div>}
      {message}
    </div>
  )
}
```

- [ ] **Step 4: Create ListCard.tsx**

```tsx
import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

interface Props<T extends { id: string | number }> {
  items: T[]
  renderItem: (item: T) => ReactNode
  emptyMessage: string
  className?: string
}

export function ListCard<T extends { id: string | number }>({ items, renderItem, emptyMessage, className }: Props<T>) {
  return (
    <div className={cn('bg-white rounded-xl border border-slate-200 divide-y divide-slate-100', className)}>
      {items.length === 0
        ? <p className="text-sm text-slate-400 p-4">{emptyMessage}</p>
        : items.map(item => <div key={item.id}>{renderItem(item)}</div>)
      }
    </div>
  )
}
```

- [ ] **Step 5: Create ListRow.tsx**

```tsx
import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

interface Props {
  title: string
  subtitle?: string
  actions?: ReactNode
  className?: string
}

export function ListRow({ title, subtitle, actions, className }: Props) {
  return (
    <div className={cn('flex items-center justify-between px-4 py-3', className)}>
      <div>
        <p className="text-sm font-medium text-slate-900">{title}</p>
        {subtitle && <p className="text-xs text-slate-500">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-1 shrink-0">{actions}</div>}
    </div>
  )
}
```

- [ ] **Step 6: Create TagBadge.tsx**

```tsx
import { cn } from '@/lib/utils'

const variantClasses = {
  purple: 'bg-purple-50 text-purple-700',
  blue: 'bg-blue-50 text-blue-700',
  green: 'bg-green-50 text-green-700',
  slate: 'bg-slate-100 text-slate-500',
} as const

export type TagBadgeVariant = keyof typeof variantClasses

interface TagBadgeProps {
  label: string
  icon?: string | null
  variant: TagBadgeVariant
  className?: string
}

export function TagBadge({ label, icon, variant, className }: TagBadgeProps) {
  return (
    <span className={cn('text-xs px-2 py-0.5 rounded-full', variantClasses[variant], className)}>
      {icon && <span className="mr-1">{icon}</span>}
      {label}
    </span>
  )
}

interface TagBadgeRowItem {
  id: string | number
  name: string
  icon?: string | null
}

interface TagBadgeRowProps {
  items: TagBadgeRowItem[]
  variant: TagBadgeVariant
  className?: string
}

export function TagBadgeRow({ items, variant, className }: TagBadgeRowProps) {
  if (items.length === 0) return null
  return (
    <div className={cn('flex flex-wrap gap-1', className)}>
      {items.map(item => (
        <TagBadge key={item.id} label={item.name} icon={item.icon} variant={variant} />
      ))}
    </div>
  )
}
```

- [ ] **Step 7: Create FilterPillGroup.tsx**

```tsx
import { cn } from '@/lib/utils'

interface FilterItem {
  id: string
  label: string
}

interface Props {
  label?: string
  items: FilterItem[]
  selected: string[]
  onChange: (id: string) => void
  onClearAll?: () => void
  className?: string
}

export function FilterPillGroup({ label, items, selected, onChange, onClearAll, className }: Props) {
  const pillBase = 'text-xs px-3 py-1.5 rounded-full border transition-colors'
  const active = 'bg-blue-600 border-blue-600 text-white'
  const inactive = 'border-slate-200 text-slate-600 hover:border-slate-300 bg-white'

  return (
    <div className={cn('flex items-center gap-2 flex-wrap', className)}>
      {label && <span className="text-xs text-slate-500">{label}</span>}
      {onClearAll && (
        <button onClick={onClearAll} className={cn(pillBase, selected.length === 0 ? active : inactive)}>
          All
        </button>
      )}
      {items.map(item => (
        <button
          key={item.id}
          onClick={() => onChange(item.id)}
          className={cn(pillBase, selected.includes(item.id) ? active : inactive)}
        >
          {item.label}
        </button>
      ))}
    </div>
  )
}
```

- [ ] **Step 8: Create DangerZoneConfirm.tsx**

```tsx
import { useState } from 'react'
import type { ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

interface Props {
  triggerLabel: string
  description: ReactNode
  confirmLabel?: string
  onConfirm: () => void
  isLoading?: boolean
  className?: string
}

export function DangerZoneConfirm({ triggerLabel, description, confirmLabel = 'Delete', onConfirm, isLoading = false, className }: Props) {
  const [confirming, setConfirming] = useState(false)

  if (!confirming) {
    return (
      <button onClick={() => setConfirming(true)} className={cn('text-xs text-red-400 hover:text-red-600 underline', className)}>
        {triggerLabel}
      </button>
    )
  }

  return (
    <div className={cn('bg-red-50 border border-red-200 rounded-lg p-4 space-y-3', className)}>
      <p className="text-sm text-red-700 font-medium">{description}</p>
      <div className="flex gap-2">
        <Button variant="destructive" size="sm" disabled={isLoading} onClick={onConfirm}>
          {isLoading ? `${confirmLabel}…` : confirmLabel}
        </Button>
        <Button variant="outline" size="sm" onClick={() => setConfirming(false)}>Cancel</Button>
      </div>
    </div>
  )
}
```

- [ ] **Step 9: Create SearchInput.tsx**

```tsx
import { Search, X } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

interface Props {
  value: string
  onChange: (val: string) => void
  placeholder?: string
  className?: string
}

export function SearchInput({ value, onChange, placeholder = 'Search…', className }: Props) {
  return (
    <div className={cn('relative', className)}>
      <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 pointer-events-none" />
      <Input
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className="pl-8 pr-8 h-8 w-48 text-sm"
      />
      {value && (
        <button onClick={() => onChange('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
          <X className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  )
}
```

- [ ] **Step 10: Create PageLoader.tsx**

```tsx
import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

interface FullPageLoaderProps {
  message?: string
  className?: string
}

export function FullPageLoader({ message = 'Loading…', className }: FullPageLoaderProps) {
  return (
    <div className={cn('flex items-center justify-center min-h-screen bg-slate-50', className)}>
      <p className="text-slate-400 text-sm">{message}</p>
    </div>
  )
}

interface FullPageErrorProps {
  message: string
  children?: ReactNode
  className?: string
}

export function FullPageError({ message, children, className }: FullPageErrorProps) {
  return (
    <div className={cn('flex items-center justify-center min-h-screen bg-slate-50', className)}>
      <div className="text-center">
        {children}
        <p className="text-slate-600 font-medium">{message}</p>
      </div>
    </div>
  )
}
```

- [ ] **Step 11: Create Alert.tsx**

```tsx
import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

const variantClasses = {
  info: 'bg-blue-50 border-blue-200 text-blue-800',
  warning: 'bg-amber-50 border-amber-200 text-amber-800',
  danger: 'bg-red-50 border-red-200 text-red-700',
} as const

interface Props {
  variant: keyof typeof variantClasses
  message: string
  actions?: ReactNode
  className?: string
}

export function Alert({ variant, message, actions, className }: Props) {
  return (
    <div className={cn('border px-4 py-2.5 flex items-center justify-between gap-4', variantClasses[variant], className)}>
      <p className="text-sm font-medium">{message}</p>
      {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
    </div>
  )
}
```

- [ ] **Step 12: Create index.ts barrel**

```ts
export { FormField } from './FormField'
export { SectionHeader } from './SectionHeader'
export { EmptyState } from './EmptyState'
export { ListCard } from './ListCard'
export { ListRow } from './ListRow'
export { TagBadge, TagBadgeRow } from './TagBadge'
export type { TagBadgeVariant } from './TagBadge'
export { FilterPillGroup } from './FilterPillGroup'
export { DangerZoneConfirm } from './DangerZoneConfirm'
export { SearchInput } from './SearchInput'
export { FullPageLoader, FullPageError } from './PageLoader'
export { Alert } from './Alert'
```

- [ ] **Step 13: Verify build**

```bash
npm run build -w frontend
```

Expected: exits 0 with no TypeScript errors.

- [ ] **Step 14: Commit**

```bash
git add frontend/src/components/ui/shared/
git commit -m "feat: add shared UI component library (FormField, SectionHeader, EmptyState, ListCard, ListRow, TagBadge, FilterPillGroup, DangerZoneConfirm, SearchInput, PageLoader, Alert)"
```

---

### Task 2: Migrate FormField — LocationsPage, FeedsPage, CalendarSettingsPage, HolidayCalendarsPage, SetupPage, ProfilePage

**Files:**
- Modify: `frontend/src/pages/settings/LocationsPage.tsx`
- Modify: `frontend/src/pages/settings/FeedsPage.tsx`
- Modify: `frontend/src/pages/settings/CalendarSettingsPage.tsx`
- Modify: `frontend/src/pages/settings/HolidayCalendarsPage.tsx`
- Modify: `frontend/src/pages/SetupPage.tsx`
- Modify: `frontend/src/pages/ProfilePage.tsx`

**Interfaces:**
- Consumes: `FormField` from `@/components/ui/shared`

- [ ] **Step 1: Add FormField import to each file**

Add `import { FormField } from '@/components/ui/shared'` to the top of each file. Remove `import { Label } from '@/components/ui/label'` only if Label is no longer used elsewhere in that file after the migration.

- [ ] **Step 2: Migrate LocationsPage.tsx**

In the dialog `<div className="space-y-4 py-1">` block (lines ~192–229), replace each `<div className="space-y-1.5">` + `<Label>` pattern:

```tsx
// BEFORE (repeat for each form field):
<div className="space-y-1.5">
  <Label>Name <span className="text-slate-400 font-normal">(optional)</span></Label>
  <Input placeholder="e.g. Main Hall" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
</div>

// AFTER:
<FormField label={<>Name <span className="text-slate-400 font-normal">(optional)</span></>}>
  <Input placeholder="e.g. Main Hall" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
</FormField>
```

For the grid row with ZIP and City, preserve the grid wrapper and add className to FormField:
```tsx
<div className="grid grid-cols-3 gap-3">
  <FormField label="ZIP">
    <Input placeholder="12345" value={form.zip} onChange={e => setForm(f => ({ ...f, zip: e.target.value }))} />
  </FormField>
  <FormField label="City" className="col-span-2">
    <Input placeholder="Berlin" value={form.city} onChange={e => setForm(f => ({ ...f, city: e.target.value }))} />
  </FormField>
</div>
```

For the map position field, the `<Suspense>` block is the child:
```tsx
<FormField label={<>Map position <span className="text-slate-400 font-normal">(search or click/drag)</span></>}>
  <Suspense fallback={<div className="h-56 bg-slate-100 rounded-lg animate-pulse" />}>
    <MapPicker ... />
  </Suspense>
</FormField>
```

- [ ] **Step 3: Migrate FeedsPage.tsx**

In the dialog form block (lines ~227–258), replace each `<div className="space-y-1">` or `<div className="space-y-1.5">` + `<Label>` pattern:

```tsx
// BEFORE:
<div className="space-y-1">
  <Label>Name</Label>
  <Input placeholder="e.g. Public Calendar" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
</div>

// AFTER:
<FormField label="Name">
  <Input placeholder="e.g. Public Calendar" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
</FormField>
```

The Target Group filter field:
```tsx
// BEFORE:
<div className="space-y-1.5">
  <Label>Filter by Target Group <span className="text-slate-400 font-normal">(optional — empty = all events)</span></Label>
  <div className="flex flex-wrap gap-1.5">...</div>
</div>

// AFTER:
<FormField label={<>Filter by Target Group <span className="text-slate-400 font-normal">(optional — empty = all events)</span></>}>
  <div className="flex flex-wrap gap-1.5">...</div>
</FormField>
```

- [ ] **Step 4: Migrate CalendarSettingsPage.tsx**

Lines 46–53, replace two `<div className="space-y-1.5">` blocks:
```tsx
// BEFORE:
<div className="space-y-1.5">
  <Label>Calendar Name</Label>
  <Input value={name} onChange={e => setName(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleSave()} />
</div>

// AFTER:
<FormField label="Calendar Name">
  <Input value={name} onChange={e => setName(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleSave()} />
</FormField>
```

The timezone field wraps a complex `<div className="relative">` block — that whole div becomes the FormField child:
```tsx
<FormField label={<>Timezone <span className="text-slate-400 font-normal">(overrides club default)</span></>}>
  <div className="relative">
    <Input ... />
    {showTzDropdown && (...)}
  </div>
  {timezone && <p className="text-xs text-slate-400">...</p>}
</FormField>
```

- [ ] **Step 5: Migrate HolidayCalendarsPage.tsx**

Lines 131–149, replace two `<div className="space-y-1">` + `<Label>` blocks:
```tsx
// BEFORE:
<div className="space-y-1">
  <Label htmlFor="hc-name">Name</Label>
  <Input id="hc-name" ... />
</div>

// AFTER:
<FormField label="Name">
  <Input id="hc-name" ... />
</FormField>
```

- [ ] **Step 6: Migrate SetupPage.tsx**

Lines 98–107 and 123–131, replace two `<div className="space-y-1.5">` blocks:
```tsx
// BEFORE:
<div className="space-y-1.5">
  <Label>Club name</Label>
  <Input placeholder="e.g. Schützenverein Musterstadt" ... />
</div>

// AFTER:
<FormField label="Club name">
  <Input placeholder="e.g. Schützenverein Musterstadt" ... />
</FormField>
```

- [ ] **Step 7: Migrate ClubPage.tsx**

Add `import { FormField } from '@/components/ui/shared'`. In the club name card (lines ~180–188), replace:
```tsx
// BEFORE:
<div className="space-y-1.5">
  <Label>Name</Label>
  <div className="flex gap-2">
    <Input value={clubName} onChange={e => setClubName(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleSaveClubName()} />
    <Button ...>{nameSaved ? 'Saved' : nameSaving ? 'Saving…' : 'Save'}</Button>
  </div>
</div>

// AFTER:
<FormField label="Name">
  <div className="flex gap-2">
    <Input value={clubName} onChange={e => setClubName(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleSaveClubName()} />
    <Button ...>{nameSaved ? 'Saved' : nameSaving ? 'Saving…' : 'Save'}</Button>
  </div>
</FormField>
```

- [ ] **Step 8: Migrate ProfilePage.tsx**

Lines 111–144, replace two `<div className="space-y-1.5">` blocks in the Localization card:
```tsx
// BEFORE:
<div className="space-y-1.5">
  <Label>Date format</Label>
  <select ...>{...}</select>
</div>

// AFTER:
<FormField label="Date format">
  <select ...>{...}</select>
</FormField>
```

```tsx
// BEFORE:
<div className="space-y-1.5">
  <Label>First day of week</Label>
  <div className="flex gap-2">...</div>
</div>

// AFTER:
<FormField label="First day of week">
  <div className="flex gap-2">...</div>
</FormField>
```

- [ ] **Step 9: Verify build**

```bash
npm run build -w frontend
```

Expected: exits 0 with no TypeScript errors.

- [ ] **Step 10: Commit**

```bash
git add frontend/src/pages/
git commit -m "refactor: migrate form fields to FormField component"
```

---

### Task 3: Migrate SectionHeader — TemplatesPage, FeedsPage, HolidayCalendarsPage, ClubPage

**Files:**
- Modify: `frontend/src/pages/TemplatesPage.tsx`
- Modify: `frontend/src/pages/settings/FeedsPage.tsx`
- Modify: `frontend/src/pages/settings/HolidayCalendarsPage.tsx`
- Modify: `frontend/src/pages/ClubPage.tsx`

**Interfaces:**
- Consumes: `SectionHeader` from `@/components/ui/shared`

- [ ] **Step 1: Migrate TemplatesPage.tsx**

Add `import { SectionHeader } from '@/components/ui/shared'`. Replace lines 34–40:
```tsx
// BEFORE:
<div className="flex items-center justify-between mb-6">
  <div>
    <h2 className="text-base font-semibold text-slate-900">Event Templates</h2>
    <p className="text-sm text-slate-500 mt-0.5">Templates pre-fill event details and can be used to create series of events.</p>
  </div>
  <Button size="sm" onClick={openCreate}><Plus className="w-3.5 h-3.5 mr-1" />New Template</Button>
</div>

// AFTER:
<SectionHeader
  title="Event Templates"
  description="Templates pre-fill event details and can be used to create series of events."
  action={<Button size="sm" onClick={openCreate}><Plus className="w-3.5 h-3.5 mr-1" />New Template</Button>}
/>
```

- [ ] **Step 2: Migrate FeedsPage.tsx**

Replace lines 110–116:
```tsx
// BEFORE:
<div className="flex items-center justify-between mb-6">
  <div>
    <h2 className="text-base font-semibold text-slate-900">Calendar Feeds</h2>
    <p className="text-sm text-slate-500 mt-0.5">Publish your calendar as an ICS feed for Apple Calendar, Google Calendar, etc.</p>
  </div>
  <Button size="sm" onClick={openCreate}><Plus className="w-3.5 h-3.5 mr-1" />New Feed</Button>
</div>

// AFTER:
<SectionHeader
  title="Calendar Feeds"
  description="Publish your calendar as an ICS feed for Apple Calendar, Google Calendar, etc."
  action={<Button size="sm" onClick={openCreate}><Plus className="w-3.5 h-3.5 mr-1" />New Feed</Button>}
/>
```

- [ ] **Step 3: Migrate HolidayCalendarsPage.tsx**

Replace lines 82–87:
```tsx
// BEFORE:
<div className="flex items-center justify-between mb-5 gap-4 flex-wrap">
  <h1 className="text-lg font-semibold text-slate-900">Holiday Calendars</h1>
  <div className="flex items-center gap-2 flex-wrap">
    <Button onClick={() => setShowAdd(true)}>Add ICS Feed</Button>
  </div>
</div>

// AFTER:
<SectionHeader
  title="Holiday Calendars"
  action={<Button onClick={() => setShowAdd(true)}>Add ICS Feed</Button>}
  className="mb-5"
/>
```

- [ ] **Step 4: Migrate ClubPage.tsx — Calendars section header**

Lines 226–240 contain the Calendars section header with an inline Dialog as the action. Replace:
```tsx
// BEFORE:
<div className="flex items-center justify-between mb-4">
  <h2 className="text-base font-semibold text-slate-900">Calendars</h2>
  <Dialog open={calDialogOpen} onOpenChange={setCalDialogOpen}>
    <DialogTrigger render={<Button size="sm" variant="outline" className="gap-1" />}>
      <Plus className="w-3.5 h-3.5" />New
    </DialogTrigger>
    ...
  </Dialog>
</div>

// AFTER — keep the Dialog but use SectionHeader for the header row:
<SectionHeader
  title="Calendars"
  className="mb-4"
  action={
    <Dialog open={calDialogOpen} onOpenChange={setCalDialogOpen}>
      <DialogTrigger render={<Button size="sm" variant="outline" className="gap-1" />}>
        <Plus className="w-3.5 h-3.5" />New
      </DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Create Calendar</DialogTitle></DialogHeader>
        <div className="space-y-4 pt-2">
          <Input placeholder="Calendar name" value={newCalName} onChange={e => setNewCalName(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleCreateCalendar()} autoFocus />
          <Button className="w-full" onClick={handleCreateCalendar}>Create</Button>
        </div>
      </DialogContent>
    </Dialog>
  }
/>
```

- [ ] **Step 5: Verify build**

```bash
npm run build -w frontend
```

Expected: exits 0 with no TypeScript errors.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages/
git commit -m "refactor: migrate section headers to SectionHeader component"
```

---

### Task 4: Migrate EmptyState — TemplatesPage, EventsListPage, LocationsPage, FeedsPage

**Files:**
- Modify: `frontend/src/pages/TemplatesPage.tsx`
- Modify: `frontend/src/pages/EventsListPage.tsx`
- Modify: `frontend/src/pages/settings/LocationsPage.tsx`
- Modify: `frontend/src/pages/settings/FeedsPage.tsx`

**Interfaces:**
- Consumes: `EmptyState` from `@/components/ui/shared`

- [ ] **Step 1: Migrate TemplatesPage.tsx**

Add `import { EmptyState } from '@/components/ui/shared'`. Replace line 43:
```tsx
// BEFORE:
<div className="text-center py-12 text-slate-400 text-sm border border-dashed border-slate-200 rounded-xl">
  No templates yet. Create one to speed up event creation.
</div>

// AFTER:
<EmptyState message="No templates yet. Create one to speed up event creation." />
```

- [ ] **Step 2: Migrate EventsListPage.tsx**

Replace line ~149:
```tsx
// BEFORE:
<div className="text-center py-12 text-slate-400 text-sm border border-dashed border-slate-200 rounded-xl">
  {search ? 'No events match your search.' : statusFilter !== 'all' ? `No ${statusFilter} events.` : 'No events yet.'}
</div>

// AFTER:
<EmptyState message={search ? 'No events match your search.' : statusFilter !== 'all' ? `No ${statusFilter} events.` : 'No events yet.'} />
```

- [ ] **Step 3: Migrate LocationsPage.tsx**

Replace lines ~141–143:
```tsx
// BEFORE:
<div className="text-center py-12 text-slate-400 text-sm border border-dashed border-slate-200 rounded-xl">
  No locations yet. Add one to assign it to events and templates.
</div>

// AFTER:
<EmptyState message="No locations yet. Add one to assign it to events and templates." />
```

- [ ] **Step 4: Migrate FeedsPage.tsx**

Replace lines ~118–120:
```tsx
// BEFORE:
<div className="text-center py-12 text-slate-400 text-sm border border-dashed border-slate-200 rounded-xl">
  No feeds yet. Create one to publish your calendar.
</div>

// AFTER:
<EmptyState message="No feeds yet. Create one to publish your calendar." />
```

- [ ] **Step 5: Verify build**

```bash
npm run build -w frontend
```

Expected: exits 0 with no TypeScript errors.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages/
git commit -m "refactor: migrate empty state divs to EmptyState component"
```

---

### Task 5: Migrate ListCard + ListRow — ClubPage members list

**Files:**
- Modify: `frontend/src/pages/ClubPage.tsx`

**Interfaces:**
- Consumes: `ListCard`, `ListRow` from `@/components/ui/shared`

- [ ] **Step 1: Migrate the Members list in ClubPage.tsx**

Add `import { ListCard, ListRow } from '@/components/ui/shared'`. Replace lines ~211–224:

```tsx
// BEFORE:
<div className="bg-white rounded-xl border border-slate-200 divide-y divide-slate-100 mb-10">
  {members.length === 0
    ? <p className="text-sm text-slate-400 p-4">No members yet.</p>
    : members.map((m: User) => (
      <div key={m.id} className="flex items-center justify-between px-4 py-3">
        <div>
          <p className="text-sm font-medium text-slate-900">{m.name}</p>
          <p className="text-xs text-slate-500">{m.email}</p>
        </div>
        <button onClick={() => handleRemoveMember(m.id)} className="text-slate-400 hover:text-red-500 text-xs px-2 py-1 rounded hover:bg-red-50 transition-colors">Remove</button>
      </div>
    ))
  }
</div>

// AFTER:
<ListCard
  items={members}
  emptyMessage="No members yet."
  className="mb-10"
  renderItem={(m: User) => (
    <ListRow
      title={m.name}
      subtitle={m.email}
      actions={
        <button onClick={() => handleRemoveMember(m.id)} className="text-slate-400 hover:text-red-500 text-xs px-2 py-1 rounded hover:bg-red-50 transition-colors">Remove</button>
      }
    />
  )}
/>
```

- [ ] **Step 2: Verify build**

```bash
npm run build -w frontend
```

Expected: exits 0 with no TypeScript errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/ClubPage.tsx
git commit -m "refactor: migrate members list to ListCard + ListRow"
```

---

### Task 6: Migrate TagBadge + TagBadgeRow — EventsListPage, FeedPage, FeedsPage, TemplatesPage

**Files:**
- Modify: `frontend/src/pages/EventsListPage.tsx`
- Modify: `frontend/src/pages/FeedPage.tsx`
- Modify: `frontend/src/pages/settings/FeedsPage.tsx`
- Modify: `frontend/src/pages/TemplatesPage.tsx`

**Interfaces:**
- Consumes: `TagBadge`, `TagBadgeRow` from `@/components/ui/shared`

- [ ] **Step 1: Migrate EventsListPage.tsx**

Add `import { TagBadge } from '@/components/ui/shared'`. In the event row (lines ~195–202), replace raw badge spans:

```tsx
// BEFORE:
<div className="flex gap-1 flex-wrap">
  {tgNames.map(n => (
    <span key={n} className="text-xs bg-purple-50 text-purple-700 px-1.5 py-0.5 rounded-full">{n}</span>
  ))}
  {ev.features.map(f => (
    <span key={f.feature.id} className="text-xs bg-green-50 text-green-700 px-1.5 py-0.5 rounded-full">{f.feature.name}</span>
  ))}
</div>

// AFTER:
<div className="flex gap-1 flex-wrap">
  {tgNames.map(n => <TagBadge key={n} label={n} variant="purple" />)}
  {ev.features.map(f => <TagBadge key={f.feature.id} label={f.feature.name} variant="green" />)}
</div>
```

- [ ] **Step 2: Migrate FeedPage.tsx**

Add `import { TagBadge } from '@/components/ui/shared'`. Replace the three badge sections in the `EventDetail` component (lines ~112–147):

```tsx
// Target groups section — BEFORE:
<div className="flex flex-wrap gap-1">
  {ev.targetGroups.map(t => (
    <span key={t.targetGroup.id} className="text-xs bg-purple-50 text-purple-700 px-2 py-0.5 rounded-full">
      {t.targetGroup.name}
    </span>
  ))}
</div>

// AFTER:
<div className="flex flex-wrap gap-1">
  {ev.targetGroups.map(t => <TagBadge key={t.targetGroup.id} label={t.targetGroup.name} variant="purple" />)}
</div>
```

```tsx
// Properties section — BEFORE:
<div className="flex flex-wrap gap-1">
  {ev.properties.map(p => (
    <span key={p.property.id} className="text-xs bg-blue-50 text-blue-700 px-2 py-0.5 rounded-full">
      {p.property.icon && <span className="mr-1">{p.property.icon}</span>}
      {p.property.name}
    </span>
  ))}
</div>

// AFTER:
<div className="flex flex-wrap gap-1">
  {ev.properties.map(p => <TagBadge key={p.property.id} label={p.property.name} icon={p.property.icon} variant="blue" />)}
</div>
```

```tsx
// Features section — BEFORE:
<div className="flex flex-wrap gap-1">
  {ev.features.map(f => (
    <span key={f.feature.id} className="text-xs bg-green-50 text-green-700 px-2 py-0.5 rounded-full">
      {f.feature.name}
    </span>
  ))}
</div>

// AFTER:
<div className="flex flex-wrap gap-1">
  {ev.features.map(f => <TagBadge key={f.feature.id} label={f.feature.name} variant="green" />)}
</div>
```

- [ ] **Step 3: Migrate FeedsPage.tsx**

In the feed card (lines ~141–147), replace the target group badge block:

```tsx
// BEFORE:
{tgNames.length > 0 && (
  <div className="flex gap-1 flex-wrap">
    {tgNames.map(name => (
      <span key={name} className="text-xs bg-purple-50 text-purple-700 px-2 py-0.5 rounded-full">{name}</span>
    ))}
  </div>
)}

// AFTER:
{tgNames.length > 0 && (
  <div className="flex gap-1 flex-wrap">
    {tgNames.map(name => <TagBadge key={name} label={name} variant="purple" />)}
  </div>
)}
```

- [ ] **Step 4: Migrate TemplatesPage.tsx**

Remove the `Badge` import from shadcn and add `TagBadge` from shared. Replace lines 78–94:

```tsx
// BEFORE:
<div className="flex flex-wrap gap-1.5">
  {t.properties.map(p => (
    <Badge key={p.property.id} variant="secondary" className="text-xs">
      {p.property.icon && <span className="mr-1">{p.property.icon}</span>}{p.property.name}
    </Badge>
  ))}
  {t.features.map(f => (
    <Badge key={f.feature.id} variant="outline" className="text-xs text-green-700 border-green-200 bg-green-50">
      {f.feature.name}
    </Badge>
  ))}
  {t.targetGroups.map(tg => (
    <Badge key={tg.targetGroup.id} variant="outline" className="text-xs text-purple-700 border-purple-200 bg-purple-50">
      {tg.targetGroup.name}
    </Badge>
  ))}
</div>

// AFTER:
<div className="flex flex-wrap gap-1.5">
  {t.properties.map(p => <TagBadge key={p.property.id} label={p.property.name} icon={p.property.icon} variant="slate" />)}
  {t.features.map(f => <TagBadge key={f.feature.id} label={f.feature.name} variant="green" />)}
  {t.targetGroups.map(tg => <TagBadge key={tg.targetGroup.id} label={tg.targetGroup.name} variant="purple" />)}
</div>
```

- [ ] **Step 5: Verify build**

```bash
npm run build -w frontend
```

Expected: exits 0 with no TypeScript errors.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages/
git commit -m "refactor: migrate tag badges to TagBadge component"
```

---

### Task 7: Migrate FilterPillGroup — CalendarPage, FeedPage

**Files:**
- Modify: `frontend/src/pages/CalendarPage.tsx`
- Modify: `frontend/src/pages/FeedPage.tsx`

**Interfaces:**
- Consumes: `FilterPillGroup` from `@/components/ui/shared`

- [ ] **Step 1: Migrate CalendarPage.tsx**

Add `import { FilterPillGroup } from '@/components/ui/shared'`. Replace lines ~255–274:

```tsx
// BEFORE:
{targetGroups.length > 1 && (
  <div className="flex items-center gap-2 mb-4 flex-wrap">
    <span className="text-xs text-slate-500">Filter:</span>
    <button
      onClick={clearFilter}
      className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${selectedGroups.length === 0 ? 'bg-blue-600 border-blue-600 text-white' : 'border-slate-200 text-slate-600 hover:border-slate-300 bg-white'}`}
    >
      All
    </button>
    {targetGroups.map(tg => (
      <button
        key={tg.id}
        onClick={() => toggleGroup(tg.id)}
        className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${selectedGroups.includes(tg.id) ? 'bg-blue-600 border-blue-600 text-white' : 'border-slate-200 text-slate-600 hover:border-slate-300 bg-white'}`}
      >
        {tg.name}
      </button>
    ))}
  </div>
)}

// AFTER:
{targetGroups.length > 1 && (
  <FilterPillGroup
    label="Filter:"
    items={targetGroups.map(tg => ({ id: tg.id, label: tg.name }))}
    selected={selectedGroups}
    onChange={toggleGroup}
    onClearAll={clearFilter}
    className="mb-4"
  />
)}
```

- [ ] **Step 2: Migrate FeedPage.tsx**

The FeedPage uses `number` IDs for target groups. Convert to strings when passing to FilterPillGroup and convert back when handling changes. Replace lines ~265–273:

```tsx
// BEFORE:
{allGroups.length > 1 && (
  <div className="flex items-center gap-2 mt-4 flex-wrap">
    <span className="text-xs text-slate-500">Filter:</span>
    <button onClick={() => setSelected([])} className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${selected.length === 0 ? 'bg-blue-600 border-blue-600 text-white' : 'border-slate-200 text-slate-600 hover:border-slate-300 bg-white'}`}>All</button>
    {allGroups.map(tg => (
      <button key={tg.id} onClick={() => toggleGroup(tg.id)} className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${selected.includes(tg.id) ? 'bg-blue-600 border-blue-600 text-white' : 'border-slate-200 text-slate-600 hover:border-slate-300 bg-white'}`}>{tg.name}</button>
    ))}
  </div>
)}

// AFTER:
{allGroups.length > 1 && (
  <FilterPillGroup
    label="Filter:"
    items={allGroups.map(tg => ({ id: String(tg.id), label: tg.name }))}
    selected={selected.map(String)}
    onChange={id => toggleGroup(Number(id))}
    onClearAll={() => setSelected([])}
    className="mt-4"
  />
)}
```

- [ ] **Step 3: Verify build**

```bash
npm run build -w frontend
```

Expected: exits 0 with no TypeScript errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/CalendarPage.tsx frontend/src/pages/FeedPage.tsx
git commit -m "refactor: migrate filter pill groups to FilterPillGroup component"
```

---

### Task 8: Migrate DangerZoneConfirm — ClubPage, ProfilePage

**Files:**
- Modify: `frontend/src/pages/ClubPage.tsx`
- Modify: `frontend/src/pages/ProfilePage.tsx`

**Interfaces:**
- Consumes: `DangerZoneConfirm` from `@/components/ui/shared`

- [ ] **Step 1: Migrate ClubPage.tsx**

Add `import { DangerZoneConfirm } from '@/components/ui/shared'`. Remove `confirmDeleteClub` and `deletingClub` state declarations. Replace lines ~192–203:

```tsx
// BEFORE:
const [confirmDeleteClub, setConfirmDeleteClub] = useState(false)
const [deletingClub, setDeletingClub] = useState(false)
...
<div className="mb-10">
  {!confirmDeleteClub ? (
    <button onClick={() => setConfirmDeleteClub(true)} className="text-xs text-red-400 hover:text-red-600 underline">Delete this club</button>
  ) : (
    <div className="bg-red-50 border border-red-200 rounded-lg p-4 space-y-3">
      <p className="text-sm text-red-700 font-medium">This permanently deletes <strong>{club?.name}</strong> including all calendars and events. This cannot be undone.</p>
      <div className="flex gap-2">
        <Button variant="destructive" size="sm" disabled={deletingClub} onClick={handleDeleteClub}>{deletingClub ? 'Deleting…' : 'Delete club'}</Button>
        <Button variant="outline" size="sm" onClick={() => setConfirmDeleteClub(false)}>Cancel</Button>
      </div>
    </div>
  )}
</div>

// AFTER — keep deletingClub state, remove confirmDeleteClub state:
const [deletingClub, setDeletingClub] = useState(false)
...
<div className="mb-10">
  <DangerZoneConfirm
    triggerLabel="Delete this club"
    description={<>This permanently deletes <strong>{club?.name}</strong> including all calendars and events. This cannot be undone.</>}
    confirmLabel="Delete club"
    onConfirm={handleDeleteClub}
    isLoading={deletingClub}
  />
</div>
```

- [ ] **Step 2: Migrate ProfilePage.tsx**

Add `import { DangerZoneConfirm } from '@/components/ui/shared'`. Remove `confirmDelete` and `deleting` state. Replace lines ~148–165:

```tsx
// BEFORE:
const [confirmDelete, setConfirmDelete] = useState(false)
const [deleting, setDeleting] = useState(false)
...
<div className="mt-8 pt-6 border-t border-slate-200">
  <h3 className="text-sm font-semibold text-red-600 mb-3">Danger Zone</h3>
  {!confirmDelete ? (
    <button onClick={() => setConfirmDelete(true)} className="text-sm text-red-500 hover:text-red-700 underline">
      Delete my account
    </button>
  ) : (
    <div className="bg-red-50 border border-red-200 rounded-lg p-4 space-y-3">
      <p className="text-sm text-red-700 font-medium">This permanently deletes your account and all associated data. This cannot be undone.</p>
      <div className="flex gap-2">
        <Button variant="destructive" size="sm" disabled={deleting} onClick={handleDeleteAccount}>
          {deleting ? 'Deleting…' : 'Delete account'}
        </Button>
        <Button variant="outline" size="sm" onClick={() => setConfirmDelete(false)}>Cancel</Button>
      </div>
    </div>
  )}
</div>

// AFTER — keep deleting state, remove confirmDelete state:
const [deleting, setDeleting] = useState(false)
...
<div className="mt-8 pt-6 border-t border-slate-200">
  <h3 className="text-sm font-semibold text-red-600 mb-3">Danger Zone</h3>
  <DangerZoneConfirm
    triggerLabel="Delete my account"
    description="This permanently deletes your account and all associated data. This cannot be undone."
    confirmLabel="Delete account"
    onConfirm={handleDeleteAccount}
    isLoading={deleting}
  />
</div>
```

- [ ] **Step 3: Verify build**

```bash
npm run build -w frontend
```

Expected: exits 0 with no TypeScript errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/ClubPage.tsx frontend/src/pages/ProfilePage.tsx
git commit -m "refactor: migrate danger zone confirm patterns to DangerZoneConfirm component"
```

---

### Task 9: Migrate SearchInput — CalendarPage, EventsListPage

**Files:**
- Modify: `frontend/src/pages/CalendarPage.tsx`
- Modify: `frontend/src/pages/EventsListPage.tsx`

**Interfaces:**
- Consumes: `SearchInput` from `@/components/ui/shared`

- [ ] **Step 1: Migrate CalendarPage.tsx**

Add `import { SearchInput } from '@/components/ui/shared'`. Remove `Search`, `X`, `Input` imports if no longer used elsewhere. Replace lines ~230–243:

```tsx
// BEFORE:
<div className="relative">
  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 pointer-events-none" />
  <Input
    value={searchQuery}
    onChange={e => handleSearchChange(e.target.value)}
    placeholder="Search events…"
    className="pl-8 pr-8 h-8 w-48 text-sm"
  />
  {searchQuery && (
    <button onClick={clearSearch} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
      <X className="w-3.5 h-3.5" />
    </button>
  )}
</div>

// AFTER:
<SearchInput
  value={searchQuery}
  onChange={handleSearchChange}
  placeholder="Search events…"
/>
```

Note: `SearchInput.onChange` calls `onChange('')` on clear. In CalendarPage `clearSearch` also calls `calendarRef.current?.getApi().refetchEvents()`. Keep a wrapper:
```tsx
<SearchInput
  value={searchQuery}
  onChange={val => {
    handleSearchChange(val)
    if (!val) clearSearch()
  }}
  placeholder="Search events…"
/>
```

Wait — `handleSearchChange` already calls `clearSearch`-equivalent logic via debounce. Check the exact CalendarPage flow: `handleSearchChange` sets `searchQueryRef.current` and debounces a refetch. `clearSearch` resets the ref and immediately refetches. So `onChange` on SearchInput for the empty case should call the immediate-clear path. Use:

```tsx
<SearchInput
  value={searchQuery}
  onChange={val => val === '' ? clearSearch() : handleSearchChange(val)}
  placeholder="Search events…"
/>
```

- [ ] **Step 2: Migrate EventsListPage.tsx**

Add `import { SearchInput } from '@/components/ui/shared'`. Replace lines ~106–111:

```tsx
// BEFORE:
<div className="relative">
  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 pointer-events-none" />
  <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search…"
    className="pl-8 pr-7 h-8 w-48 text-sm" />
  {search && <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"><X className="w-3.5 h-3.5" /></button>}
</div>

// AFTER:
<SearchInput value={search} onChange={setSearch} placeholder="Search…" />
```

- [ ] **Step 3: Verify build**

```bash
npm run build -w frontend
```

Expected: exits 0 with no TypeScript errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/CalendarPage.tsx frontend/src/pages/EventsListPage.tsx
git commit -m "refactor: migrate search inputs to SearchInput component"
```

---

### Task 10: Migrate FullPageLoader + FullPageError — AuthCallbackPage, ClubsPage, FeedPage, SetupPage

**Files:**
- Modify: `frontend/src/pages/AuthCallbackPage.tsx`
- Modify: `frontend/src/pages/ClubsPage.tsx`
- Modify: `frontend/src/pages/FeedPage.tsx`
- Modify: `frontend/src/pages/SetupPage.tsx`

**Interfaces:**
- Consumes: `FullPageLoader`, `FullPageError` from `@/components/ui/shared`

- [ ] **Step 1: Migrate AuthCallbackPage.tsx**

Add `import { FullPageLoader } from '@/components/ui/shared'`. Replace the return:
```tsx
// BEFORE:
return (
  <div className="flex items-center justify-center min-h-screen bg-slate-50">
    <p className="text-slate-400">Signing in…</p>
  </div>
)

// AFTER:
return <FullPageLoader message="Signing in…" />
```

- [ ] **Step 2: Migrate ClubsPage.tsx**

Replace lines 48–54:
```tsx
// BEFORE:
if (isLoading || redirected) {
  return (
    <div className="flex items-center justify-center min-h-screen bg-slate-50">
      <div className="text-slate-400 text-sm">Loading…</div>
    </div>
  )
}

// AFTER:
if (isLoading || redirected) return <FullPageLoader />
```

- [ ] **Step 3: Migrate FeedPage.tsx**

Add `import { FullPageLoader, FullPageError } from '@/components/ui/shared'`. Replace lines 236–241:
```tsx
// BEFORE:
if (loading) return <div className="flex items-center justify-center min-h-screen bg-slate-50"><p className="text-slate-400">Loading...</p></div>
if (error) return (
  <div className="flex items-center justify-center min-h-screen bg-slate-50">
    <div className="text-center"><Calendar className="w-10 h-10 text-slate-300 mx-auto mb-3" /><p className="text-slate-600 font-medium">{error}</p></div>
  </div>
)

// AFTER:
if (loading) return <FullPageLoader />
if (error) return (
  <FullPageError message={error}>
    <Calendar className="w-10 h-10 text-slate-300 mx-auto mb-3" />
  </FullPageError>
)
```

- [ ] **Step 4: Migrate SetupPage.tsx**

Replace lines 70–75:
```tsx
// BEFORE:
if (detecting) {
  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center">
      <div className="text-slate-400 text-sm">Loading…</div>
    </div>
  )
}

// AFTER:
if (detecting) return <FullPageLoader />
```

- [ ] **Step 5: Verify build**

```bash
npm run build -w frontend
```

Expected: exits 0 with no TypeScript errors.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages/
git commit -m "refactor: migrate full-page loading/error states to FullPageLoader + FullPageError"
```

---

### Task 11: Migrate Alert — CalendarPage

**Files:**
- Modify: `frontend/src/pages/CalendarPage.tsx`

**Interfaces:**
- Consumes: `Alert` from `@/components/ui/shared`

- [ ] **Step 1: Migrate CalendarPage.tsx archived banner**

Add `import { Alert } from '@/components/ui/shared'`. Replace lines ~213–226:

```tsx
// BEFORE:
{isArchived && (
  <div className="bg-amber-50 border-b border-amber-200 px-4 py-2.5 flex items-center justify-between gap-4">
    <p className="text-sm text-amber-800 font-medium">
      This calendar is archived — it is read-only.
    </p>
    <button
      onClick={handleUnarchive}
      className="flex items-center gap-1.5 text-xs text-amber-700 font-medium hover:text-amber-900 whitespace-nowrap"
    >
      <ArchiveRestore className="w-3.5 h-3.5" />
      Unarchive
    </button>
  </div>
)}

// AFTER:
{isArchived && (
  <Alert
    variant="warning"
    message="This calendar is archived — it is read-only."
    className="border-b border-t-0 border-x-0 rounded-none"
    actions={
      <button
        onClick={handleUnarchive}
        className="flex items-center gap-1.5 text-xs text-amber-700 font-medium hover:text-amber-900 whitespace-nowrap"
      >
        <ArchiveRestore className="w-3.5 h-3.5" />
        Unarchive
      </button>
    }
  />
)}
```

- [ ] **Step 2: Verify build**

```bash
npm run build -w frontend
```

Expected: exits 0 with no TypeScript errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/CalendarPage.tsx
git commit -m "refactor: migrate archived calendar alert to Alert component"
```

---

### Task 12: Extract useMapbox hook + refactor MapPicker + LocationsOverviewMap

**Files:**
- Create: `frontend/src/components/locations/useMapbox.ts`
- Modify: `frontend/src/components/locations/MapPicker.tsx`
- Modify: `frontend/src/components/locations/LocationsOverviewMap.tsx`

**Interfaces:**
- Produces: `useMapbox({ initialCenter?, initialZoom?, onReady? })` returning `{ mapContainerRef, mapRef }`

- [ ] **Step 1: Create useMapbox.ts**

```ts
import { useEffect, useRef } from 'react'
import { initMapboxProxy, mapboxTransformRequest } from './mapboxProxy'

type MapboxGLModule = typeof import('mapbox-gl').default

interface UseMapboxOptions {
  initialCenter?: [number, number]
  initialZoom?: number
  onReady?: (map: mapboxgl.Map, mapboxgl: MapboxGLModule) => void
}

export function useMapbox({ initialCenter = [10.0, 51.0], initialZoom = 5, onReady }: UseMapboxOptions = {}) {
  const mapContainerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<mapboxgl.Map | null>(null)

  useEffect(() => {
    if (!mapContainerRef.current) return
    let map: mapboxgl.Map

    import('mapbox-gl').then(({ default: mapboxgl }) => {
      initMapboxProxy(mapboxgl)
      map = new mapboxgl.Map({
        container: mapContainerRef.current!,
        style: 'mapbox://styles/mapbox/streets-v12',
        center: initialCenter,
        zoom: initialZoom,
        transformRequest: mapboxTransformRequest,
        performanceMetricsCollection: false,
      })
      map.addControl(new mapboxgl.NavigationControl(), 'top-right')
      mapRef.current = map
      onReady?.(map, mapboxgl)
    })

    return () => { map?.remove() }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return { mapContainerRef, mapRef }
}
```

- [ ] **Step 2: Refactor MapPicker.tsx**

Replace the `mapContainerRef`, `mapRef` declarations and the entire initialization `useEffect` with `useMapbox`. Add the import.

```tsx
// ADD import at top:
import { useMapbox } from './useMapbox'

// REMOVE these lines:
const mapContainerRef = useRef<HTMLDivElement>(null)
const mapRef = useRef<mapboxgl.Map | null>(null)

// REMOVE the full initialization useEffect (lines ~62–110) and REPLACE with:
const initLng = longitude ?? 10.0
const initLat = latitude ?? 51.0

const { mapContainerRef, mapRef } = useMapbox({
  initialCenter: [initLng, initLat],
  initialZoom: longitude != null ? 14 : 5,
  onReady: (map, mapboxgl) => {
    const marker = new mapboxgl.Marker({ draggable: true, color: '#2563eb' })
      .setLngLat([initLng, initLat])
      .addTo(map)

    if (longitude != null) marker.setLngLat([longitude, latitude!])

    marker.on('dragend', async () => {
      const { lng, lat } = marker.getLngLat()
      const geocoded = await reverseGeocode(lng, lat)
      onPositionChange(lat, lng, geocoded)
      setSearchQuery(geocoded.displayName)
    })

    map.on('click', async (e) => {
      const { lng, lat } = e.lngLat
      marker.setLngLat([lng, lat])
      const geocoded = await reverseGeocode(lng, lat)
      onPositionChange(lat, lng, geocoded)
      setSearchQuery(geocoded.displayName)
    })

    markerRef.current = marker
  },
})
```

Also remove the `import { initMapboxProxy, mapboxTransformRequest }` line since `useMapbox` handles those internally. Keep `BACKEND_URL` import since `reverseGeocode` and `fetchSuggestions` still use it.

- [ ] **Step 3: Refactor LocationsOverviewMap.tsx**

Replace `mapContainerRef`, `mapRef` declarations and the initialization `useEffect` with `useMapbox`.

```tsx
// ADD import at top:
import { useMapbox } from './useMapbox'

// REMOVE these lines:
const mapContainerRef = useRef<HTMLDivElement>(null)
const mapRef = useRef<mapboxgl.Map | null>(null)

// REMOVE the initialization useEffect (lines ~29–54) and REPLACE with:
const { mapContainerRef, mapRef } = useMapbox({
  onReady: (map, mapboxgl) => {
    map.on('load', () => {
      addMarkers(mapboxgl, map)
      fitBounds(map)
    })
  },
})

// ADD a separate cleanup effect for markersRef (after the useMapbox call):
useEffect(() => {
  return () => { markersRef.current = [] }
}, [])
```

Also remove the `import { initMapboxProxy, mapboxTransformRequest }` line from LocationsOverviewMap since `useMapbox` handles those.

The `addMarkers` and `fitBounds` functions remain unchanged. The `useEffect` that updates markers on location change (lines ~57–68) stays unchanged. The `useEffect` that highlights the selected marker (lines ~71–82) stays unchanged.

- [ ] **Step 4: Verify build**

```bash
npm run build -w frontend
```

Expected: exits 0 with no TypeScript errors.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/locations/
git commit -m "refactor: extract useMapbox hook to eliminate map initialization duplication"
```

---

### Task 13: Fix EventModal — replace next/dynamic with React.lazy

**Files:**
- Modify: `frontend/src/components/calendar/EventModal.tsx`

**Interfaces:**
- No interface change — MapPicker component API is unchanged

- [ ] **Step 1: Remove 'use client' from map components**

`MapPicker.tsx` and `LocationsOverviewMap.tsx` both start with `'use client'` — a Next.js directive with no effect in Vite. Remove line 1 (`'use client'`) from each file.

- [ ] **Step 2: Fix the EventModal import**

In `EventModal.tsx`, remove line 1 (`'use client'`) and then at line 14 find:
```tsx
import dynamic from 'next/dynamic'

const MapPicker = dynamic(() => import('@/components/locations/MapPicker'), { ssr: false, loading: () => <div className="h-48 bg-slate-100 rounded-lg animate-pulse" /> })
```

Replace these two lines with:
```tsx
import { lazy, Suspense } from 'react'

const MapPicker = lazy(() => import('@/components/locations/MapPicker'))
```

Then find where `MapPicker` is rendered in EventModal.tsx and wrap it in `<Suspense>`:
```tsx
// BEFORE (wherever MapPicker is rendered):
<MapPicker ... />

// AFTER:
<Suspense fallback={<div className="h-48 bg-slate-100 rounded-lg animate-pulse" />}>
  <MapPicker ... />
</Suspense>
```

Also remove `'use client'` from line 1 of EventModal.tsx — this is a Next.js directive that has no effect in Vite but is misleading.

- [ ] **Step 3: Verify build**

```bash
npm run build -w frontend
```

Expected: exits 0 with no TypeScript errors and no `next` import warnings.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/calendar/EventModal.tsx frontend/src/components/locations/MapPicker.tsx frontend/src/components/locations/LocationsOverviewMap.tsx
git commit -m "fix: remove Next.js 'use client' directives and replace next/dynamic with React.lazy (Vite SPA)"
```

---

### Task 14: Update CLAUDE.md and AGENTS.md

**Files:**
- Modify: `CLAUDE.md` (repo root)
- Modify: `frontend/AGENTS.md`

- [ ] **Step 1: Add shared component guidance to CLAUDE.md**

In `CLAUDE.md`, find the `## Working Rules` section. Add a new rule after the existing rules:

```markdown
5. **Use shared UI components** — Before adding structural JSX or Tailwind layout patterns to a frontend page, check `frontend/src/components/ui/shared/` for existing components: `FormField`, `SectionHeader`, `EmptyState`, `ListCard`, `ListRow`, `TagBadge`, `TagBadgeRow`, `FilterPillGroup`, `DangerZoneConfirm`, `SearchInput`, `FullPageLoader`, `FullPageError`, `Alert`. Import from `@/components/ui/shared`. For Mapbox maps, use `useMapbox` from `frontend/src/components/locations/useMapbox.ts` instead of duplicating the initialization boilerplate.
```

- [ ] **Step 2: Add shared component guidance to frontend/AGENTS.md**

In `frontend/AGENTS.md`, add a new section after `## Key conventions`:

```markdown
## Shared UI Components

Before writing raw Tailwind layout divs in a page, check `src/components/ui/shared/` first:

| Component | Replaces |
|---|---|
| `FormField` | `<div className="space-y-1.5"><Label>…</Label>…</div>` |
| `SectionHeader` | `<div className="flex items-center justify-between mb-6">…</div>` |
| `EmptyState` | `<div className="text-center py-12 … border-dashed …">…</div>` |
| `ListCard` | `<div className="bg-white rounded-xl border … divide-y …">…</div>` |
| `ListRow` | `<div className="flex items-center justify-between px-4 py-3">…</div>` |
| `TagBadge` / `TagBadgeRow` | Inline colored `<span className="text-xs bg-… rounded-full">` pills |
| `FilterPillGroup` | Toggle pill buttons for filtering |
| `DangerZoneConfirm` | Two-step destructive action UI |
| `SearchInput` | Icon-prefixed input with clear button |
| `FullPageLoader` / `FullPageError` | `<div className="flex … min-h-screen bg-slate-50">…</div>` |
| `Alert` | Colored `bg-{color}-50 border-{color}-200` alert boxes |

Import: `import { FormField, SectionHeader, ... } from '@/components/ui/shared'`

For Mapbox maps: use `useMapbox` from `src/components/locations/useMapbox.ts`.
```

- [ ] **Step 3: Verify build**

```bash
npm run build -w frontend
```

Expected: exits 0 with no TypeScript errors.

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md frontend/AGENTS.md
git commit -m "docs: update CLAUDE.md and AGENTS.md with shared UI component guidelines"
```
