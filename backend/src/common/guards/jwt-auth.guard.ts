import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common'
import { verifyAccessToken } from '../../lib/jwt'

@Injectable()
export class JwtAuthGuard implements CanActivate {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest()
    const authHeader = request.headers['authorization']
    if (!authHeader?.startsWith('Bearer ')) throw new UnauthorizedException()
    const token = (authHeader as string).slice(7)
    try {
      const payload = await verifyAccessToken(token)
      request.userId = payload.sub
      return true
    } catch {
      throw new UnauthorizedException()
    }
  }
}
