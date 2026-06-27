import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { apiGet, apiPatch, apiDelete, apiFetch } from '@/lib/api'
import { DATE_FORMAT_OPTIONS } from '@/lib/dateFormat'
import { useAuth } from '@/lib/auth-context'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Label } from '@/components/ui/label'
import { FormField, DangerZoneConfirm } from '@/components/ui/shared'
import { LanguageSwitcher } from '@/components/ui/LanguageSwitcher'
import { Trash2, Plus, Key } from 'lucide-react'

interface PasskeyInfo { id: string; deviceName: string; createdAt: string }
interface ProfileData {
  id: number; name: string; email: string
  dateFormat: string
  firstDayOfWeek: number
  passkeys: PasskeyInfo[]
  oauthAccounts: { provider: string }[]
}

export default function ProfilePage() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const { t } = useTranslation()
  const [deviceName, setDeviceName] = useState('')
  const [registering, setRegistering] = useState(false)
  const [message, setMessage] = useState('')
  const [deleting, setDeleting] = useState(false)

  const { data: profile, refetch } = useQuery<ProfileData>({
    queryKey: ['profile'],
    queryFn: () => apiGet('/api/auth/me'),
  })

  async function handleRegisterPasskey() {
    setRegistering(true); setMessage('')
    try {
      const { startRegistration } = await import('@simplewebauthn/browser')
      const optRes = await apiFetch('/api/auth/webauthn/register/options')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { options, challengeToken } = await optRes.json() as { options: any; challengeToken: string }
      const response = await startRegistration({ optionsJSON: options })
      const verifyRes = await apiFetch('/api/auth/webauthn/register/verify', {
        method: 'POST',
        body: JSON.stringify({ challengeToken, response, deviceName: deviceName || 'My device' }),
      })
      if (!verifyRes.ok) { setMessage(t('profile.registrationFailed')); return }
      setMessage(t('profile.passkeyRegistered')); setDeviceName('')
      refetch()
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : ''
      if (!msg.includes('cancel')) setMessage(t('profile.registrationFailedOrCancelled'))
    } finally { setRegistering(false) }
  }

  async function handleDeletePasskey(id: string) {
    await apiDelete(`/api/auth/webauthn/${id}`)
    refetch()
  }

  async function handleDeleteAccount() {
    setDeleting(true)
    try {
      await apiDelete('/api/auth/me')
      logout()
      navigate('/login', { replace: true })
    } finally { setDeleting(false) }
  }

  void user

  return (
    <div className="p-6 max-w-lg">
      <h2 className="text-base font-semibold text-slate-900 mb-6">{t('profile.title')}</h2>

      <div className="bg-white rounded-xl border border-slate-200 p-5 mb-6">
        <p className="text-sm font-medium text-slate-900">{profile?.name}</p>
        <p className="text-sm text-slate-500">{profile?.email}</p>
        {profile?.oauthAccounts?.map(a => (
          <Badge key={a.provider} variant="secondary" className="mt-2 mr-1 text-xs capitalize">{a.provider}</Badge>
        ))}
      </div>

      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-slate-800 flex items-center gap-2"><Key className="w-4 h-4" />{t('profile.passkeys')}</h3>
        <p className="text-xs text-slate-500">{t('profile.passkeyDescription')}</p>

        {profile?.passkeys?.map(pk => (
          <div key={pk.id} className="flex items-center justify-between p-3 bg-white rounded-lg border border-slate-200">
            <div>
              <p className="text-sm font-medium text-slate-900">{pk.deviceName}</p>
              <p className="text-xs text-slate-400">{t('profile.addedOn', { date: new Date(pk.createdAt).toLocaleDateString() })}</p>
            </div>
            <button onClick={() => handleDeletePasskey(pk.id)} className="text-slate-400 hover:text-red-500 p-1.5 rounded"><Trash2 className="w-3.5 h-3.5" /></button>
          </div>
        ))}

        <div className="flex gap-2 mt-2">
          <Input placeholder={t('profile.deviceName')} value={deviceName} onChange={e => setDeviceName(e.target.value)} className="flex-1" />
          <Button size="sm" disabled={registering} onClick={handleRegisterPasskey} className="gap-1.5">
            <Plus className="w-3.5 h-3.5" />{registering ? t('profile.waiting') : t('profile.addPasskey')}
          </Button>
        </div>
        {message && <p className="text-sm text-green-600">{message}</p>}
      </div>

      <div className="space-y-3 mt-6">
        <h3 className="text-sm font-semibold text-slate-800">{t('profile.localization')}</h3>
        <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-4">
          <FormField label={t('profile.dateFormat')}>
            <select
              className="w-full border border-slate-200 rounded-md px-3 py-2 text-sm"
              value={profile?.dateFormat ?? 'dd.MM.yyyy'}
              onChange={async e => {
                await apiPatch('/api/auth/me', { dateFormat: e.target.value })
                refetch()
              }}
            >
              {DATE_FORMAT_OPTIONS.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </FormField>

          <FormField label={t('profile.firstDayOfWeek')}>
            <div className="flex gap-2">
              {([{ label: t('profile.monday'), value: 1 }, { label: t('profile.sunday'), value: 0 }] as const).map(opt => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={async () => {
                    await apiPatch('/api/auth/me', { firstDayOfWeek: opt.value })
                    refetch()
                  }}
                  className={`flex-1 py-2 text-sm rounded-md border transition-colors ${(profile?.firstDayOfWeek ?? 1) === opt.value ? 'bg-blue-50 border-blue-300 text-blue-700 font-medium' : 'border-slate-200 text-slate-600 hover:border-slate-300'}`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </FormField>

          <div className="space-y-1.5">
            <Label>{t('profile.language')}</Label>
            <LanguageSwitcher className="w-full border border-slate-200 rounded-md px-3 py-2 text-sm" />
          </div>
        </div>
      </div>

      <div className="mt-8 pt-6 border-t border-slate-200">
        <h3 className="text-sm font-semibold text-red-600 mb-3">{t('profile.dangerZone')}</h3>
        <DangerZoneConfirm
          triggerLabel={t('profile.deleteAccount')}
          description={t('profile.deleteAccountConfirm')}
          confirmLabel={t('profile.deleteAccountButton')}
          onConfirm={handleDeleteAccount}
          isLoading={deleting}
        />
      </div>
    </div>
  )
}
