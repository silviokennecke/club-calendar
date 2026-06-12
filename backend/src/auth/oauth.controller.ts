import { Controller, Get, Post, Param, Req, Res } from '@nestjs/common'
import { Request, Response } from 'express'
import { generateCodeVerifier, generateState } from 'arctic'
import { OAuthService } from './oauth.service'
import { enabledProviders, env } from '../env'
import { notFound } from '../lib/errors'

type Provider = 'google' | 'microsoft' | 'apple'
const VALID_PROVIDERS: Provider[] = ['google', 'microsoft', 'apple']

@Controller('api/auth/oauth')
export class OAuthController {
  constructor(private readonly oauthService: OAuthService) {}

  @Get(':provider')
  async initiateOAuth(@Param('provider') provider: string, @Res() res: Response) {
    const p = provider as Provider
    if (!VALID_PROVIDERS.includes(p) || !enabledProviders[p]) {
      throw notFound('OAuth provider not available')
    }
    const state = generateState()
    const codeVerifier = generateCodeVerifier()
    const url = await this.oauthService.createAuthorizationURL(p, state, codeVerifier)
    res.cookie(`oauth_state_${provider}`, JSON.stringify({ state, codeVerifier }), {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 600 * 1000, // 600 seconds in ms
      secure: process.env.NODE_ENV === 'production',
    })
    return res.redirect(url.toString())
  }

  @Get(':provider/callback')
  async handleCallbackGet(
    @Param('provider') provider: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    return this.handleCallback(provider, req, res)
  }

  @Post(':provider/callback')
  async handleCallbackPost(
    @Param('provider') provider: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    return this.handleCallback(provider, req, res)
  }

  private async handleCallback(provider: string, req: Request, res: Response) {
    const p = provider as Provider
    if (!VALID_PROVIDERS.includes(p)) throw notFound('Unknown provider')

    const cookieName = `oauth_state_${provider}`
    const cookieRaw = req.cookies?.[cookieName]
    res.clearCookie(cookieName)

    if (!cookieRaw) {
      return res.redirect(`${env.FRONTEND_URL}/login?error=session_expired`)
    }

    let state: string, codeVerifier: string
    try {
      const parsed = JSON.parse(cookieRaw as string) as { state: string; codeVerifier: string }
      state = parsed.state
      codeVerifier = parsed.codeVerifier
    } catch {
      return res.redirect(`${env.FRONTEND_URL}/login?error=invalid_state`)
    }

    // Get code and state from query (GET) or form body (POST, Apple)
    let code: string | undefined, returnedState: string | undefined
    if (req.method === 'POST') {
      const body = req.body as Record<string, string>
      code = body.code
      returnedState = body.state
    } else {
      const query = req.query as Record<string, string>
      code = query.code
      returnedState = query.state
    }

    if (!code || returnedState !== state) {
      return res.redirect(`${env.FRONTEND_URL}/login?error=invalid_state`)
    }

    try {
      const result = await this.oauthService.handleCallback(p, code, codeVerifier)
      // Set refresh token cookie
      res.cookie('refreshToken', result.refreshToken, {
        httpOnly: true,
        sameSite: 'strict',
        path: '/api/auth/refresh',
        secure: process.env.NODE_ENV === 'production',
        maxAge: 7 * 24 * 60 * 60 * 1000,
      })
      // Redirect to frontend with access token
      return res.redirect(`${env.FRONTEND_URL}/auth/callback?token=${result.accessToken}`)
    } catch (err) {
      console.error(`OAuth callback error (${provider}):`, err)
      return res.redirect(`${env.FRONTEND_URL}/login?error=oauth_failed`)
    }
  }
}
