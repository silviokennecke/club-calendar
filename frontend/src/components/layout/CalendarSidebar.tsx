'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { apiGet } from '@/lib/api'
import type { Calendar, Club } from '@/lib/types'
import { useAuth } from '@/lib/auth-context'
import { cn } from '@/lib/utils'
import {
  CalendarDays, Settings, LayoutTemplate, ChevronLeft, LogOut,
  Palette, Tag, Users, MapPin, Rss, User, List
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
  const { logout } = useAuth()

  const base = `/clubs/${clubId}/calendars/${calendarId}`

  const { data: calendar } = useQuery({
    queryKey: ['calendar', calendarId],
    queryFn: () => apiGet<Calendar>(`/api/clubs/${clubId}/calendars/${calendarId}`),
  })
  const { data: club } = useQuery({
    queryKey: ['club', clubId],
    queryFn: () => apiGet<Club>(`/api/clubs/${clubId}`),
  })

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

  return (
    <div className="w-56 shrink-0 bg-white border-r border-slate-200 flex flex-col min-h-screen">
      {/* Header */}
      <div className="p-4 border-b border-slate-100">
        <Link
          href={`/clubs/${clubId}`}
          className="flex items-center gap-1.5 text-slate-500 hover:text-slate-700 text-xs mb-3"
        >
          <ChevronLeft className="w-3 h-3" /> {club?.name ?? '...'}
        </Link>
        <div className="font-semibold text-slate-900 text-sm truncate">
          {calendar?.name ?? '...'}
        </div>
      </div>

      {/* Main nav */}
      <nav className="p-2 flex-1">
        <div className="space-y-0.5">
          {mainNav.map(item => (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'flex items-center gap-2.5 px-3 py-2 rounded-md text-sm transition-colors',
                isActive(item)
                  ? 'bg-blue-50 text-blue-700 font-medium'
                  : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
              )}
            >
              <item.icon className="w-4 h-4 shrink-0" />
              {item.label}
            </Link>
          ))}
        </div>

        <div className="mt-4">
          <p className="px-3 py-1.5 text-xs font-medium text-slate-400 uppercase tracking-wider">Settings</p>
          <div className="space-y-0.5">
            {settingsNav.map(item => (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  'flex items-center gap-2.5 px-3 py-2 rounded-md text-sm transition-colors',
                  isActive(item)
                    ? 'bg-blue-50 text-blue-700 font-medium'
                    : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                )}
              >
                <item.icon className="w-4 h-4 shrink-0" />
                {item.label}
              </Link>
            ))}
          </div>
        </div>
      </nav>

      {/* Footer */}
      <div className="p-3 border-t border-slate-100">
        <Link href="/profile" className="flex items-center gap-2 text-xs text-slate-400 hover:text-slate-600 px-2 py-1.5 rounded transition-colors mb-1">
          <User className="w-3.5 h-3.5" /> Profile
        </Link>
        <button
          onClick={logout}
          className="flex items-center gap-2 text-xs text-slate-400 hover:text-slate-600 px-2 py-1.5 w-full rounded transition-colors"
        >
          <LogOut className="w-3.5 h-3.5" /> Sign out
        </button>
      </div>
    </div>
  )
}
