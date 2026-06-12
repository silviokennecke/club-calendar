import { Hono } from 'hono'
import { setCookie, getCookie, deleteCookie } from 'hono/cookie'
import { generateCodeVerifier, generateState } from 'arctic'
import { createAuthorizationURL, handleCallback } from '../services/oauthService.js'
import { enabledProviders, env } from '../env.js'
import { notFound } from '../lib/errors.js'
import type { Context } from 'hono'

type Provider = 'google' | 'microsoft' | 'apple'
const VALID_PROVIDERS: Provider[] = ['google', 'microsoft', 'apple']

export const oauthRoutes = new Hono()

// Redirect to provider
oauthRoutes.get('/:provider', (c) => {
  const provider = c.req.param('provider') as Provider
  if (!VALID_PROVIDERS.includes(provider) || !enabledProviders[provider]) {
    throw notFound('OAuth provider not available')
  }
  const state = generateState()
  const codeVerifier = generateCodeVerifier()
  const url = createAuthorizationURL(provider, state, codeVerifier)
  // Store state + codeVerifier in a short-lived cookie
  setCookie(c, `oauth_state_${provider}`, JSON.stringify({ state, codeVerifier }), {
    httpOnly: true,
    sameSite: 'Lax',
    path: '/',
    maxAge: 600,
    secure: process.env.NODE_ENV === 'production',
  })
  return c.redirect(url.toString())
})

// OAuth callback (GET for Google/Microsoft, POST for Apple)
async function callbackHandler(c: Context) {
  const provider = c.req.param('provider') as Provider
  if (!VALID_PROVIDERS.includes(provider)) throw notFound('Unknown provider')

  const cookieName = `oauth_state_${provider}`
  const cookieRaw = getCookie(c, cookieName)
  deleteCookie(c, cookieName)

  if (!cookieRaw) {
    return c.redirect(`${env.FRONTEND_URL}/login?error=session_expired`)
  }

  let state: string, codeVerifier: string
  try {
    const parsed = JSON.parse(cookieRaw) as { state: string; codeVerifier: string }
    state = parsed.state
    codeVerifier = parsed.codeVerifier
  } catch {
    return c.redirect(`${env.FRONTEND_URL}/login?error=invalid_state`)
  }

  // Get code and state from query (GET) or form body (POST, Apple)
  let code: string | undefined, returnedState: string | undefined
  if (c.req.method === 'POST') {
    const body = (await c.req.parseBody()) as Record<string, string>
    code = body.code
    returnedState = body.state
  } else {
    code = c.req.query('code')
    returnedState = c.req.query('state')
  }

  if (!code || returnedState !== state) {
    return c.redirect(`${env.FRONTEND_URL}/login?error=invalid_state`)
  }

  try {
    const result = await handleCallback(provider, code, codeVerifier)
    // Set refresh token cookie
    setCookie(c, 'refreshToken', result.refreshToken, {
      httpOnly: true,
      sameSite: 'Strict',
      path: '/api/auth/refresh',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 7 * 24 * 60 * 60,
    })
    // Redirect to frontend with access token
    return c.redirect(`${env.FRONTEND_URL}/auth/callback?token=${result.accessToken}`)
  } catch (err) {
    console.error(`OAuth callback error (${provider}):`, err)
    return c.redirect(`${env.FRONTEND_URL}/login?error=oauth_failed`)
  }
}

oauthRoutes.get('/:provider/callback', callbackHandler)
oauthRoutes.post('/:provider/callback', callbackHandler) // Apple uses POST
