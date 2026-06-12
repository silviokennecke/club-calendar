'use client'
import { use } from 'react'
import { useQuery } from '@tanstack/react-query'
import { apiGet } from '@/lib/api'
import type { Club, Calendar } from '@/lib/types'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import Link from 'next/link'

interface Props {
  params: Promise<{ clubId: string }>
}

export default function ClubPage({ params }: Props) {
  const { clubId } = use(params)

  const { data: club } = useQuery({
    queryKey: ['clubs', clubId],
    queryFn: () => apiGet<Club>(`/api/clubs/${clubId}`),
  })

  const { data: calendars = [] } = useQuery({
    queryKey: ['clubs', clubId, 'calendars'],
    queryFn: () => apiGet<Calendar[]>(`/api/clubs/${clubId}/calendars`),
  })

  return (
    <div className="container mx-auto p-6">
      <div className="flex items-center gap-2 mb-6">
        <Link href="/clubs" className="text-sm text-muted-foreground hover:underline">← Clubs</Link>
        <h1 className="text-2xl font-bold">{club?.name ?? 'Club'}</h1>
      </div>
      <h2 className="text-lg font-semibold mb-4">Calendars</h2>
      <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
        {calendars.map((calendar) => (
          <Link key={calendar.id} href={`/clubs/${clubId}/calendars/${calendar.id}`}>
            <Card className="hover:shadow-md transition-shadow cursor-pointer">
              <CardHeader>
                <CardTitle>{calendar.name}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">View calendar events</p>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  )
}
