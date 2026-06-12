import { Injectable } from '@nestjs/common'
import { env, enabledProviders } from '../env'
import { AuthService } from './auth.service'
import { badRequest, notFound } from '../lib/errors'
import { Google, MicrosoftEntraId, Apple, decodeIdToken } from 'arctic'

type Provider = 'google' | 'microsoft' | 'apple'

function getCallbackUrl(provider: Provider): string {
  return `${env.FRONTEND_URL.replace(':3000', ':3001')}/api/auth/oauth/${provider}/callback`
}

@Injectable()
export class OAuthService {
  constructor(private readonly authService: AuthService) {}

  private getGoogle() {
    if (!enabledProviders.google) throw notFound('Google SSO not configured')
    return new Google(env.GOOGLE_CLIENT_ID!, env.GOOGLE_CLIENT_SECRET!, getCallbackUrl('google'))
  }

  private getMicrosoft() {
    if (!enabledProviders.microsoft) throw notFound('Microsoft SSO not configured')
    return new MicrosoftEntraId(
      env.MICROSOFT_TENANT_ID,
      env.MICROSOFT_CLIENT_ID!,
      env.MICROSOFT_CLIENT_SECRET!,
      getCallbackUrl('microsoft'),
    )
  }

  private getApple() {
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

  async createAuthorizationURL(provider: Provider, state: string, codeVerifier: string) {
    switch (provider) {
      case 'google': {
        const g = this.getGoogle()
        return g.createAuthorizationURL(state, codeVerifier, ['openid', 'profile', 'email'])
      }
      case 'microsoft': {
        const m = this.getMicrosoft()
        return m.createAuthorizationURL(state, codeVerifier, ['openid', 'profile', 'email'])
      }
      case 'apple': {
        const a = this.getApple()
        // Apple does not use PKCE in the same way; codeVerifier is ignored
        return a.createAuthorizationURL(state, ['name', 'email'])
      }
    }
  }

  async handleCallback(provider: Provider, code: string, codeVerifier: string) {
    switch (provider) {
      case 'google': {
        const tokens = await this.getGoogle().validateAuthorizationCode(code, codeVerifier)
        const claims = decodeIdToken(tokens.idToken()) as {
          sub: string
          email: string
          name: string
        }
        return this.authService.findOrCreateOAuthUser(
          'google',
          claims.sub,
          claims.email,
          claims.name ?? claims.email,
        )
      }
      case 'microsoft': {
        const tokens = await this.getMicrosoft().validateAuthorizationCode(code, codeVerifier)
        const claims = decodeIdToken(tokens.idToken()) as {
          sub: string
          email: string
          name: string
        }
        return this.authService.findOrCreateOAuthUser(
          'microsoft',
          claims.sub,
          claims.email ?? '',
          claims.name ?? claims.email ?? 'User',
        )
      }
      case 'apple': {
        const tokens = await this.getApple().validateAuthorizationCode(code)
        const claims = decodeIdToken(tokens.idToken()) as { sub: string; email?: string }
        const email = claims.email ?? `${claims.sub}@apple.id`
        return this.authService.findOrCreateOAuthUser('apple', claims.sub, email, email)
      }
    }
  }
}
