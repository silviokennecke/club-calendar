import { ExceptionFilter, Catch, ArgumentsHost } from '@nestjs/common'
import { AppError } from '../../lib/errors'

@Catch(AppError)
export class AppExceptionFilter implements ExceptionFilter {
  catch(err: AppError, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse()
    res.status(err.status).json({ error: err.message })
  }
}
