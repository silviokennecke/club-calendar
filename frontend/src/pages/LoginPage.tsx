import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Link } from 'react-router-dom'
import { apiPost, apiFetch, BACKEND_URL } from '@/lib/api'
import { useAuth } from '@/lib/auth-context'
import type { User } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { SsoProviderIcon } from '@/components/SsoProviderIcon'

interface SsoProvider { id: string; name: string; icon: string }

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [passkeyLoading, setPasskeyLoading] = useState(false)
  const [providers, setProviders] = useState<SsoProvider[]>([])
  const { login } = useAuth()
  const navigate = useNavigate()

  useEffect(() => {
    fetch(`${BACKEND_URL}/api/auth/providers`)
      .then(r => r.json())
      .then(setProviders)
      .catch(() => {})
  }, [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(''); setLoading(true)
    try {
      const data = await apiPost<{ access_token: string; refresh_token: string; user: User }>('/api/auth/login', { email, password })
      login(data.access_token, data.refresh_token, data.user)
      navigate('/clubs')
    } catch {
      setError('Invalid email or password')
    } finally { setLoading(false) }
  }

  async function handlePasskey() {
    setError(''); setPasskeyLoading(true)
    try {
      const { startAuthentication } = await import('@simplewebauthn/browser')
      const optRes = await apiFetch('/api/auth/webauthn/authenticate/options')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { options, challengeToken } = await optRes.json() as { options: any; challengeToken: string }
      const response = await startAuthentication({ optionsJSON: options })
      const verifyRes = await apiFetch('/api/auth/webauthn/authenticate/verify', {
        method: 'POST',
        body: JSON.stringify({ challengeToken, response }),
      })
      if (!verifyRes.ok) { setError('Passkey login failed'); return }
      const data = await verifyRes.json() as { access_token: string; refresh_token: string; user: User }
      login(data.access_token, data.refresh_token, data.user)
      navigate('/clubs')
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : ''
      if (!msg.includes('cancel') && !msg.includes('abort')) setError('Passkey login failed or was cancelled')
    } finally { setPasskeyLoading(false) }
  }

  return (
    <div className="flex items-center justify-center min-h-screen bg-slate-50">
      <Card className="w-full max-w-sm shadow-md border-slate-200">
        <CardHeader className="pb-2">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xl">📅</span>
            <span className="text-sm text-slate-500">Club Calendar</span>
          </div>
          <CardTitle className="text-xl">Sign in</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <form onSubmit={handleSubmit} className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" value={email} onChange={e => setEmail(e.target.value)} required autoComplete="email" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="password">Password</Label>
              <Input id="password" type="password" value={password} onChange={e => setPassword(e.target.value)} required autoComplete="current-password" />
            </div>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <Button type="submit" className="w-full" disabled={loading}>{loading ? 'Signing in…' : 'Sign in'}</Button>
          </form>

          <Button variant="outline" className="w-full gap-2" disabled={passkeyLoading} onClick={handlePasskey}>
            🔑 {passkeyLoading ? 'Waiting for passkey…' : 'Sign in with passkey'}
          </Button>

          {providers.length > 0 && (
            <>
              <div className="relative">
                <Separator />
                <span className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-white px-2 text-xs text-slate-400">or continue with</span>
              </div>
              <div className="space-y-2">
                {providers.map(provider => (
                  <a key={provider.id} href={`${BACKEND_URL}/api/auth/oauth/${provider.id}`} className="block">
                    <Button variant="outline" className="w-full gap-2 justify-center">
                      <SsoProviderIcon icon={provider.icon} />
                      {provider.name}
                    </Button>
                  </a>
                ))}
              </div>
            </>
          )}
        </CardContent>
        <CardFooter className="justify-center pt-0">
          <p className="text-sm text-slate-500">
            No account? <Link to="/signup" className="text-blue-600 hover:underline font-medium">Sign up</Link>
          </p>
        </CardFooter>
      </Card>
    </div>
  )
}
