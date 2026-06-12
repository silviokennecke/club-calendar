import { CanActivate, ExecutionContext, Injectable, ForbiddenException } from '@nestjs/common'
import { PrismaService } from '../../prisma/prisma.service'

@Injectable()
export class ClubMemberGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest()
    const userId: number = request.userId
    const clubId = Number(request.params.clubId)
    if (isNaN(clubId)) throw new ForbiddenException()
    const membership = await this.prisma.clubUser.findUnique({
      where: { clubId_userId: { clubId, userId } },
    })
    if (!membership) throw new ForbiddenException()
    return true
  }
}
