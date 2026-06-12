'use client'
import { useQuery } from '@tanstack/react-query'
import { apiGet } from '@/lib/api'
import { useAuth } from '@/lib/auth-context'
import type { Club } from '@/lib/types'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

export default function ClubsPage() {
  const { logout } = useAuth()
  const router = useRouter()
  const { data: clubs = [] } = useQuery({
    queryKey: ['clubs'],
    queryFn: () => apiGet<Club[]>('/api/clubs'),
  })

  return (
    <div className="container mx-auto p-6">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold">My Clubs</h1>
        <Button variant="outline" onClick={() => { logout(); router.push('/login') }}>Logout</Button>
      </div>
      <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
        {clubs.map((club) => (
          <Link key={club.id} href={`/clubs/${club.id}`}>
            <Card className="hover:shadow-md transition-shadow cursor-pointer">
              <CardHeader>
                <CardTitle>{club.name}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">{club.timezone}</p>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  )
}
