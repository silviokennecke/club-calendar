import type { ReactNode } from 'react'
import CalendarSidebar from '@/components/layout/CalendarSidebar'

interface Props {
  children: ReactNode
  params: Promise<{ clubId: string; calendarId: string }>
}

export default async function CalendarLayout({ children, params }: Props) {
  const { clubId, calendarId } = await params
  return (
    <div className="min-h-screen bg-slate-50 flex">
      <CalendarSidebar clubId={clubId} calendarId={calendarId} />
      <main className="flex-1 min-w-0 overflow-auto">
        {children}
      </main>
    </div>
  )
}
