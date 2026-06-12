const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'

export const BACKEND_URL = BASE_URL

let accessToken: string | null = null

export function setAccessToken(token: string) {
  accessToken = token
  if (typeof window !== 'undefined') {
    sessionStorage.setItem('accessToken', token)
  }
}

export function getAccessToken(): string | null {
  if (accessToken) return accessToken
  if (typeof window !== 'undefined') {
    return sessionStorage.getItem('accessToken')
  }
  return null
}

export function clearAccessToken() {
  accessToken = null
  if (typeof window !== 'undefined') {
    sessionStorage.removeItem('accessToken')
  }
}

export async function apiFetch(path: string, options: RequestInit = {}): Promise<Response> {
  const token = getAccessToken()
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> ?? {}),
  }
  if (token) headers['Authorization'] = `Bearer ${token}`

  let res = await fetch(BASE_URL + path, { ...options, headers, credentials: 'include' })

  if (res.status === 401 && token) {
    // Try token refresh
    const refreshRes = await fetch(BASE_URL + '/api/auth/refresh', {
      method: 'POST',
      credentials: 'include',
    })
    if (refreshRes.ok) {
      const data = await refreshRes.json() as { accessToken: string }
      setAccessToken(data.accessToken)
      headers['Authorization'] = `Bearer ${data.accessToken}`
      res = await fetch(BASE_URL + path, { ...options, headers, credentials: 'include' })
    } else {
      clearAccessToken()
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
