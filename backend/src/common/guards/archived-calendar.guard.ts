import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common'
import { PrismaService } from '../../prisma/prisma.service'

@Injectable()
export class ArchivedCalendarGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest()

    // Read-only access is always allowed
    if (request.method === 'GET') return true

    const calendarId = Number(request.params.calendarId)
    if (isNaN(calendarId)) return true

    const calendar = await this.prisma.calendar.findUnique({
      where: { id: calendarId },
      select: { archivedAt: true },
    })

    if (!calendar) return true // let CalendarMemberGuard handle not-found

    if (calendar.archivedAt != null) {
      throw new ForbiddenException('Calendar is archived')
    }

    return true
  }
}
