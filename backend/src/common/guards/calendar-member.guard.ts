import { CanActivate, ExecutionContext, Injectable, ForbiddenException, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../../prisma/prisma.service'

@Injectable()
export class CalendarMemberGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest()
    const userId: number = request.userId
    const calendarId = Number(request.params.calendarId)
    if (isNaN(calendarId)) throw new NotFoundException('Calendar not found')
    const calendar = await this.prisma.calendar.findUnique({
      where: { id: calendarId },
      include: { club: { include: { users: { where: { userId } } } } },
    })
    if (!calendar) throw new NotFoundException('Calendar not found')
    if (calendar.club.users.length === 0) throw new ForbiddenException()
    return true
  }
}
