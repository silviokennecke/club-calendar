'use client'
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { apiGet, apiDelete, apiFetch } from '@/lib/api'
import { useAuth } from '@/lib/auth-context'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Trash2, Plus, Key } from 'lucide-react'

interface PasskeyInfo { id: string; deviceName: string; createdAt: string }
interface ProfileData {
  id: number; name: string; email: string
  passkeys: PasskeyInfo[]
  oauthAccounts: { provider: string }[]
}

export default function ProfilePage() {
  const { user } = useAuth()
  const [deviceName, setDeviceName] = useState('')
  const [registering, setRegistering] = useState(false)
  const [message, setMessage] = useState('')

  const { data: profile, refetch } = useQuery<ProfileData>({
    queryKey: ['profile'],
    queryFn: () => apiGet('/api/auth/me'),
  })

  async function handleRegisterPasskey() {
    setRegistering(true); setMessage('')
    try {
      const { startRegistration } = await import('@simplewebauthn/browser')
      // Get options
      const optRes = await apiFetch('/api/auth/webauthn/register/options')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { options, challengeToken } = await optRes.json() as { options: any; challengeToken: string }
      // Perform ceremony
      const response = await startRegistration({ optionsJSON: options })
      // Verify
      const verifyRes = await apiFetch('/api/auth/webauthn/register/verify', {
        method: 'POST',
        body: JSON.stringify({ challengeToken, response, deviceName: deviceName || 'My device' }),
      })
      if (!verifyRes.ok) { setMessage('Registration failed'); return }
      setMessage('Passkey registered!'); setDeviceName('')
      refetch()
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : ''
      if (!msg.includes('cancel')) setMessage('Registration failed or cancelled')
    } finally { setRegistering(false) }
  }

  async function handleDeletePasskey(id: string) {
    await apiDelete(`/api/auth/webauthn/${id}`)
    refetch()
  }

  // Suppress unused variable warning — user is available from context if needed
  void user

  return (
    <div className="p-6 max-w-lg">
      <h2 className="text-base font-semibold text-slate-900 mb-6">Profile</h2>

      {/* Account info */}
      <div className="bg-white rounded-xl border border-slate-200 p-5 mb-6">
        <p className="text-sm font-medium text-slate-900">{profile?.name}</p>
        <p className="text-sm text-slate-500">{profile?.email}</p>
        {profile?.oauthAccounts?.map(a => (
          <Badge key={a.provider} variant="secondary" className="mt-2 mr-1 text-xs capitalize">{a.provider}</Badge>
        ))}
      </div>

      {/* Passkeys */}
      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-slate-800 flex items-center gap-2"><Key className="w-4 h-4" />Passkeys</h3>
        <p className="text-xs text-slate-500">Passkeys let you sign in with biometrics or a hardware key — no password needed.</p>

        {profile?.passkeys?.map(pk => (
          <div key={pk.id} className="flex items-center justify-between p-3 bg-white rounded-lg border border-slate-200">
            <div>
              <p className="text-sm font-medium text-slate-900">{pk.deviceName}</p>
              <p className="text-xs text-slate-400">Added {new Date(pk.createdAt).toLocaleDateString()}</p>
            </div>
            <button onClick={() => handleDeletePasskey(pk.id)} className="text-slate-400 hover:text-red-500 p-1.5 rounded"><Trash2 className="w-3.5 h-3.5" /></button>
          </div>
        ))}

        <div className="flex gap-2 mt-2">
          <Input placeholder="Device name (optional)" value={deviceName} onChange={e => setDeviceName(e.target.value)} className="flex-1" />
          <Button size="sm" disabled={registering} onClick={handleRegisterPasskey} className="gap-1.5">
            <Plus className="w-3.5 h-3.5" />{registering ? 'Waiting…' : 'Add passkey'}
          </Button>
        </div>
        {message && <p className="text-sm text-green-600">{message}</p>}
      </div>
    </div>
  )
}
