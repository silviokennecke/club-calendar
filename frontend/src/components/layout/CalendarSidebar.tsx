'use client'
import { useEffect, useRef } from 'react'
import Link from 'next/link'
import { useRouter, usePathname } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { apiGet } from '@/lib/api'
import type { Calendar, Club } from '@/lib/types'
import { useAuth } from '@/lib/auth-context'
import { cn } from '@/lib/utils'
import {
  CalendarDays, Settings, LayoutTemplate, LogOut,
  Palette, Tag, Users, MapPin, Rss, User, List, ChevronDown
} from 'lucide-react'

interface Props { clubId: string; calendarId: string }

interface NavItem {
  label: string
  href: string
  icon: React.ElementType
  exact?: boolean
}

export default function CalendarSidebar({ clubId, calendarId }: Props) {
  const pathname = usePathname()
  const router = useRouter()
  const { logout, updateUser } = useAuth()
  const trackedRef = useRef<string>('')

  const base = `/clubs/${clubId}/calendars/${calendarId}`

  // Track last-used club/calendar (debounced — fire only when the clubId+calendarId pair changes)
  useEffect(() => {
    const key = `${clubId}-${calendarId}`
    if (trackedRef.current === key) return
    trackedRef.current = key
    updateUser({ lastClubId: Number(clubId), lastCalendarId: Number(calendarId) })
  }, [clubId, calendarId]) // eslint-disable-line react-hooks/exhaustive-deps

  const { data: clubs = [] } = useQuery<Club[]>({
    queryKey: ['clubs'],
    queryFn: () => apiGet('/api/clubs'),
  })

  const { data: calendars = [] } = useQuery<Calendar[]>({
    queryKey: ['calendars', clubId],
    queryFn: () => apiGet(`/api/clubs/${clubId}/calendars`),
  })

  async function handleClubChange(newClubId: string) {
    if (newClubId === clubId) return
    // Fetch calendars for new club and navigate to first one
    const cals = await apiGet<Calendar[]>(`/api/clubs/${newClubId}/calendars`)
    if (cals.length > 0) {
      router.push(`/clubs/${newClubId}/calendars/${cals[0].id}`)
    } else {
      // Club has no calendars — go to club page to create one
      router.push(`/clubs/${newClubId}`)
    }
  }

  function handleCalendarChange(newCalendarId: string) {
    if (newCalendarId === calendarId) return
    router.push(`/clubs/${clubId}/calendars/${newCalendarId}`)
  }

  const mainNav: NavItem[] = [
    { label: 'Calendar', href: base, icon: CalendarDays, exact: true },
    { label: 'Events', href: `${base}/events`, icon: List },
    { label: 'Templates', href: `${base}/templates`, icon: LayoutTemplate },
  ]

  const settingsNav: NavItem[] = [
    { label: 'General', href: `${base}/settings`, icon: Settings, exact: true },
    { label: 'Feeds', href: `${base}/settings/feeds`, icon: Rss },
    { label: 'Properties', href: `${base}/settings/properties`, icon: Palette },
    { label: 'Features', href: `${base}/settings/features`, icon: Tag },
    { label: 'Target Groups', href: `${base}/settings/target-groups`, icon: Users },
    { label: 'Locations', href: `${base}/settings/locations`, icon: MapPin },
  ]

  function isActive(item: NavItem) {
    if (item.exact) return pathname === item.href
    return pathname.startsWith(item.href)
  }

  const currentClub = clubs.find(c => String(c.id) === clubId)
  const currentCalendar = calendars.find(c => String(c.id) === calendarId)

  return (
    <div className="w-56 shrink-0 bg-white border-r border-slate-200 flex flex-col min-h-screen">
      {/* Club + Calendar selectors */}
      <div className="p-3 border-b border-slate-100 space-y-2">
        {/* Club selector */}
        <div className="relative">
          <label className="text-[10px] font-medium text-slate-400 uppercase tracking-wider px-1">Club</label>
          <div className="relative mt-0.5">
            <select
              value={clubId}
              onChange={e => handleClubChange(e.target.value)}
              className="w-full appearance-none bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5 pr-7 text-sm font-medium text-slate-900 cursor-pointer hover:border-slate-300 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-300 transition-colors"
            >
              {clubs.map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
              {clubs.length === 0 && <option value={clubId}>{currentClub?.name ?? 'Loading…'}</option>}
            </select>
            <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 pointer-events-none" />
          </div>
        </div>

        {/* Calendar selector */}
        <div className="relative">
          <label className="text-[10px] font-medium text-slate-400 uppercase tracking-wider px-1">Calendar</label>
          <div className="relative mt-0.5">
            <select
              value={calendarId}
              onChange={e => handleCalendarChange(e.target.value)}
              className="w-full appearance-none bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5 pr-7 text-sm font-medium text-slate-900 cursor-pointer hover:border-slate-300 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-300 transition-colors"
            >
              {calendars.map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
              {calendars.length === 0 && <option value={calendarId}>{currentCalendar?.name ?? 'Loading…'}</option>}
            </select>
            <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 pointer-events-none" />
          </div>
        </div>
      </div>

      {/* Navigation */}
      <nav className="p-2 flex-1">
        <div className="space-y-0.5">
          {mainNav.map(item => (
            <Link key={item.href} href={item.href}
              className={cn('flex items-center gap-2.5 px-3 py-2 rounded-md text-sm transition-colors',
                isActive(item) ? 'bg-blue-50 text-blue-700 font-medium' : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900')}>
              <item.icon className="w-4 h-4 shrink-0" />{item.label}
            </Link>
          ))}
        </div>

        <div className="mt-4">
          <p className="px-3 py-1.5 text-xs font-medium text-slate-400 uppercase tracking-wider">Settings</p>
          <div className="space-y-0.5">
            {settingsNav.map(item => (
              <Link key={item.href} href={item.href}
                className={cn('flex items-center gap-2.5 px-3 py-2 rounded-md text-sm transition-colors',
                  isActive(item) ? 'bg-blue-50 text-blue-700 font-medium' : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900')}>
                <item.icon className="w-4 h-4 shrink-0" />{item.label}
              </Link>
            ))}
          </div>
        </div>
      </nav>

      {/* Footer */}
      <div className="p-3 border-t border-slate-100 space-y-0.5">
        <Link href="/profile"
          className="flex items-center gap-2 text-xs text-slate-400 hover:text-slate-600 px-2 py-1.5 w-full rounded transition-colors">
          <User className="w-3.5 h-3.5" /> Profile
        </Link>
        <button onClick={logout}
          className="flex items-center gap-2 text-xs text-slate-400 hover:text-slate-600 px-2 py-1.5 w-full rounded transition-colors">
          <LogOut className="w-3.5 h-3.5" /> Sign out
        </button>
      </div>
    </div>
  )
}
