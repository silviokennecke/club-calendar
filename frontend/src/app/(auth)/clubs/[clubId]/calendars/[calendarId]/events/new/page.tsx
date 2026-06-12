import { redirect } from 'next/navigation'

interface Props { params: Promise<{ clubId: string; calendarId: string }> }

export default async function NewEventRedirect({ params }: Props) {
  const { clubId, calendarId } = await params
  redirect(`/clubs/${clubId}/calendars/${calendarId}`)
}
