import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { apiGet, apiPatch, clearTokens, storeTokens, getAccessToken } from './api'
import type { User } from './types'

interface AuthContextValue {
  user: User | null
  loading: boolean
  login: (accessToken: string, refreshToken: string, user: User) => void
  logout: () => void
  updateUser: (data: { lastClubId?: number | null; lastCalendarId?: number | null; dateFormat?: string; firstDayOfWeek?: number }) => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const token = getAccessToken()
    if (!token) {
      setLoading(false)
      return
    }
    apiGet<User>('/api/auth/me')
      .then(setUser)
      .catch(() => { clearTokens(); setUser(null) })
      .finally(() => setLoading(false))
  }, [])

  const login = (accessToken: string, refreshToken: string, user: User) => {
    storeTokens(accessToken, refreshToken)
    setUser(user)
  }

  const logout = () => {
    clearTokens()
    setUser(null)
  }

  const updateUser = async (data: Parameters<AuthContextValue['updateUser']>[0]) => {
    try {
      const updated = await apiPatch<User>('/api/auth/me', data)
      setUser(updated)
    } catch { /* ignore */ }
  }

  return <AuthContext.Provider value={{ user, loading, login, logout, updateUser }}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}
