import { createParamDecorator, ExecutionContext } from '@nestjs/common'

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): number => {
    return ctx.switchToHttp().getRequest().userId
  },
)
