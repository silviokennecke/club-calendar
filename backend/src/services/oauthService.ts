import { env, enabledProviders } from '../env.js'
import { findOrCreateOAuthUser } from './authService.js'
import { badRequest, notFound } from '../lib/errors.js'
import { Google, MicrosoftEntraId, Apple, decodeIdToken } from 'arctic'

type Provider = 'google' | 'microsoft' | 'apple'

function getCallbackUrl(provider: Provider): string {
  return `${env.FRONTEND_URL.replace(':3000', ':3001')}/api/auth/oauth/${provider}/callback`
}

// Lazy provider construction
function getGoogle() {
  if (!enabledProviders.google) throw notFound('Google SSO not configured')
  return new Google(env.GOOGLE_CLIENT_ID!, env.GOOGLE_CLIENT_SECRET!, getCallbackUrl('google'))
}

function getMicrosoft() {
  if (!enabledProviders.microsoft) throw notFound('Microsoft SSO not configured')
  return new MicrosoftEntraId(
    env.MICROSOFT_TENANT_ID,
    env.MICROSOFT_CLIENT_ID!,
    env.MICROSOFT_CLIENT_SECRET!,
    getCallbackUrl('microsoft'),
  )
}

function getApple() {
  if (!enabledProviders.apple) throw notFound('Apple SSO not configured')
  // Apple constructor expects Uint8Array for the PKCS8 private key
  const privateKeyBytes = new TextEncoder().encode(env.APPLE_PRIVATE_KEY!)
  return new Apple(
    env.APPLE_CLIENT_ID!,
    env.APPLE_TEAM_ID!,
    env.APPLE_KEY_ID!,
    privateKeyBytes,
    getCallbackUrl('apple'),
  )
}

export function createAuthorizationURL(provider: Provider, state: string, codeVerifier: string) {
  switch (provider) {
    case 'google': {
      const g = getGoogle()
      return g.createAuthorizationURL(state, codeVerifier, ['openid', 'profile', 'email'])
    }
    case 'microsoft': {
      const m = getMicrosoft()
      return m.createAuthorizationURL(state, codeVerifier, ['openid', 'profile', 'email'])
    }
    case 'apple': {
      const a = getApple()
      // Apple does not use PKCE in the same way; codeVerifier is ignored
      return a.createAuthorizationURL(state, ['name', 'email'])
    }
  }
}

export async function handleCallback(
  provider: Provider,
  code: string,
  codeVerifier: string,
) {
  switch (provider) {
    case 'google': {
      const tokens = await getGoogle().validateAuthorizationCode(code, codeVerifier)
      const claims = decodeIdToken(tokens.idToken()) as {
        sub: string
        email: string
        name: string
      }
      return findOrCreateOAuthUser('google', claims.sub, claims.email, claims.name ?? claims.email)
    }
    case 'microsoft': {
      const tokens = await getMicrosoft().validateAuthorizationCode(code, codeVerifier)
      const claims = decodeIdToken(tokens.idToken()) as {
        sub: string
        email: string
        name: string
      }
      return findOrCreateOAuthUser(
        'microsoft',
        claims.sub,
        claims.email ?? '',
        claims.name ?? claims.email ?? 'User',
      )
    }
    case 'apple': {
      const tokens = await getApple().validateAuthorizationCode(code)
      const claims = decodeIdToken(tokens.idToken()) as { sub: string; email?: string }
      const email = claims.email ?? `${claims.sub}@apple.id`
      return findOrCreateOAuthUser('apple', claims.sub, email, email)
    }
  }
}
