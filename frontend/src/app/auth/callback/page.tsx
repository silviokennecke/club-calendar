'use client'
import { Suspense, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { storeTokens, apiGet } from '@/lib/api'
import { useAuth } from '@/lib/auth-context'
import type { User } from '@/lib/types'

function CallbackInner() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { login } = useAuth()

  useEffect(() => {
    const token = searchParams.get('token')
    const refreshToken = searchParams.get('refresh_token')
    const error = searchParams.get('error')

    if (error) {
      router.replace(`/login?error=${error}`)
      return
    }
    if (!token) {
      router.replace('/login')
      return
    }
    // Store both tokens then fetch user info
    if (refreshToken) {
      storeTokens(token, refreshToken)
    } else {
      // Fallback: store only access token if no refresh token provided
      storeTokens(token, '')
    }
    apiGet<User>('/api/auth/me')
      .then(user => {
        login(token, refreshToken ?? '', user)
        router.replace('/clubs')
      })
      .catch(() => router.replace('/login?error=oauth_failed'))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="flex items-center justify-center min-h-screen bg-slate-50">
      <p className="text-slate-400">Signing in…</p>
    </div>
  )
}

export default function AuthCallbackPage() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center min-h-screen bg-slate-50">
        <p className="text-slate-400">Signing in…</p>
      </div>
    }>
      <CallbackInner />
    </Suspense>
  )
}
