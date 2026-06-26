const BASE_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3001'

export const BACKEND_URL = BASE_URL

let accessToken: string | null = null

export function storeTokens(newAccessToken: string, newRefreshToken: string) {
  accessToken = newAccessToken
  if (typeof window !== 'undefined') {
    sessionStorage.setItem('access_token', newAccessToken)
    sessionStorage.setItem('refresh_token', newRefreshToken)
  }
}

export function setAccessToken(token: string) {
  accessToken = token
  if (typeof window !== 'undefined') {
    sessionStorage.setItem('access_token', token)
  }
}

export function getAccessToken(): string | null {
  if (accessToken) return accessToken
  if (typeof window !== 'undefined') {
    // Support both new key and old key for backward compatibility
    return sessionStorage.getItem('access_token') ?? sessionStorage.getItem('accessToken')
  }
  return null
}

export function getRefreshToken(): string | null {
  if (typeof window !== 'undefined') {
    return sessionStorage.getItem('refresh_token')
  }
  return null
}

export function clearTokens() {
  accessToken = null
  if (typeof window !== 'undefined') {
    sessionStorage.removeItem('access_token')
    sessionStorage.removeItem('refresh_token')
    // Also remove old key in case it exists
    sessionStorage.removeItem('accessToken')
  }
}

/** @deprecated Use clearTokens() instead */
export function clearAccessToken() {
  clearTokens()
}

export async function apiFetch(path: string, options: RequestInit = {}): Promise<Response> {
  const token = getAccessToken()
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> ?? {}),
  }
  if (token) headers['Authorization'] = `Bearer ${token}`

  let res = await fetch(BASE_URL + path, { ...options, headers })

  if (res.status === 401 && token) {
    // Try token refresh via OAuth2 form-encoded grant
    const refreshToken = getRefreshToken()
    if (refreshToken) {
      const refreshRes = await fetch(BASE_URL + '/api/auth/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: refreshToken,
        }).toString(),
      })
      if (refreshRes.ok) {
        const data = await refreshRes.json() as { access_token: string; refresh_token: string }
        storeTokens(data.access_token, data.refresh_token)
        headers['Authorization'] = `Bearer ${data.access_token}`
        res = await fetch(BASE_URL + path, { ...options, headers })
      } else {
        clearTokens()
        if (typeof window !== 'undefined') window.location.href = '/login'
      }
    } else {
      clearTokens()
      if (typeof window !== 'undefined') window.location.href = '/login'
    }
  }

  return res
}

export async function apiGet<T>(path: string): Promise<T> {
  const res = await apiFetch(path)
  if (!res.ok) throw new Error(`API error ${res.status}`)
  return res.json()
}

export async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const res = await apiFetch(path, { method: 'POST', body: JSON.stringify(body) })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Unknown error' }))
    throw Object.assign(new Error(err.error ?? 'Request failed'), { status: res.status })
  }
  return res.json()
}

export async function apiPatch<T>(path: string, body: unknown): Promise<T> {
  const res = await apiFetch(path, { method: 'PATCH', body: JSON.stringify(body) })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Unknown error' }))
    throw Object.assign(new Error(err.error ?? 'Request failed'), { status: res.status })
  }
  return res.json()
}

export async function apiDelete(path: string): Promise<void> {
  const res = await apiFetch(path, { method: 'DELETE' })
  if (!res.ok) throw new Error(`API error ${res.status}`)
}
