'use client'
import { useEffect } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { useAuth } from '@/lib/auth-context'
import CalendarSidebar from '@/components/layout/CalendarSidebar'

function parseCalendarFromPath(pathname: string): { clubId: string; calendarId: string } | null {
  const match = pathname.match(/\/clubs\/(\d+)\/calendars\/(\d+)/)
  if (match) return { clubId: match[1], calendarId: match[2] }
  return null
}

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth()
  const router = useRouter()
  const pathname = usePathname()

  useEffect(() => {
    if (!loading && !user) router.push('/login')
  }, [user, loading, router])

  if (loading || (!user && !loading)) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-slate-50">
        <div className="text-slate-400 text-sm">Loading...</div>
      </div>
    )
  }

  // Setup page: full-screen, no sidebar
  if (pathname === '/setup') return <>{children}</>

  // Determine club/calendar context: from URL or fall back to last-used
  const fromUrl = parseCalendarFromPath(pathname)
  const clubId = fromUrl?.clubId ?? (user?.lastClubId ? String(user.lastClubId) : null)
  const calendarId = fromUrl?.calendarId ?? (user?.lastCalendarId ? String(user.lastCalendarId) : null)

  // Show sidebar whenever we have a valid club+calendar context
  if (clubId && calendarId) {
    return (
      <div className="flex min-h-screen bg-slate-50">
        <CalendarSidebar clubId={clubId} calendarId={calendarId} />
        <main className="flex-1 min-w-0 overflow-auto">
          {children}
        </main>
      </div>
    )
  }

  // No context yet (new user, no clubs) — render content only
  return <>{children}</>
}
