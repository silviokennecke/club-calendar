'use client'
import { useQuery } from '@tanstack/react-query'
import { apiGet } from '@/lib/api'
import type { EventTemplate } from '@/lib/types'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import Link from 'next/link'
import { use } from 'react'

interface Props {
  params: Promise<{ clubId: string; calendarId: string }>
}

export default function TemplatesPage({ params }: Props) {
  const { clubId, calendarId } = use(params)

  const { data: templates = [] } = useQuery({
    queryKey: ['calendars', calendarId, 'templates'],
    queryFn: () => apiGet<EventTemplate[]>(`/api/calendars/${calendarId}/templates`),
  })

  return (
    <div className="container mx-auto p-6 max-w-2xl">
      <div className="flex items-center gap-2 mb-6">
        <Link href={`/clubs/${clubId}/calendars/${calendarId}`} className="text-sm text-muted-foreground hover:underline">← Calendar</Link>
        <h1 className="text-xl font-bold">Event Templates</h1>
      </div>

      <div className="space-y-4">
        {templates.map((template) => (
          <Card key={template.id}>
            <CardHeader>
              <CardTitle className="text-base">{template.name}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-sm text-muted-foreground space-y-1">
                <p>{template.timeBegin} – {template.timeEnd}</p>
                {template.location && <p>{template.location.address}</p>}
                <div className="flex flex-wrap gap-1 mt-2">
                  {template.targetGroups.map(({ targetGroup }) => (
                    <Badge key={targetGroup.id} variant="outline">{targetGroup.name}</Badge>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
        {templates.length === 0 && (
          <p className="text-sm text-muted-foreground text-center py-8">No templates yet.</p>
        )}
      </div>
    </div>
  )
}
