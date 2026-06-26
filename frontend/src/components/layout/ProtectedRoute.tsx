import { useEffect } from 'react'
import { Outlet, useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '@/lib/auth-context'
import CalendarSidebar from './CalendarSidebar'

function parseCalendarFromPath(pathname: string): { clubId: string; calendarId: string } | null {
  const match = pathname.match(/\/clubs\/(\d+)\/calendars\/(\d+)/)
  if (match) return { clubId: match[1], calendarId: match[2] }
  return null
}

export default function ProtectedRoute() {
  const { user, loading } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const pathname = location.pathname

  useEffect(() => {
    if (!loading && !user) navigate('/login', { replace: true })
  }, [user, loading, navigate])

  if (loading || (!user && !loading)) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-slate-50">
        <div className="text-slate-400 text-sm">Loading...</div>
      </div>
    )
  }

  if (pathname === '/setup') return <Outlet />

  const fromUrl = parseCalendarFromPath(pathname)
  const clubId = fromUrl?.clubId ?? (user?.lastClubId ? String(user.lastClubId) : null)
  const calendarId = fromUrl?.calendarId ?? (user?.lastCalendarId ? String(user.lastCalendarId) : null)

  if (clubId && calendarId) {
    return (
      <div className="flex min-h-screen bg-slate-50">
        <CalendarSidebar clubId={clubId} calendarId={calendarId} />
        <main className="flex-1 min-w-0 overflow-auto">
          <Outlet />
        </main>
      </div>
    )
  }

  return <Outlet />
}
