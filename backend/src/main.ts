import 'reflect-metadata'
import { NestFactory } from '@nestjs/core'
// eslint-disable-next-line @typescript-eslint/no-require-imports
const cookieParser = require('cookie-parser')
import { AppModule } from './app.module'
import { AppExceptionFilter } from './common/filters/app-exception.filter'
import { env } from './env'

async function bootstrap() {
  const app = await NestFactory.create(AppModule)
  app.use(cookieParser())
  app.enableCors({
    origin: env.FRONTEND_URL,
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  })
  app.useGlobalFilters(new AppExceptionFilter())
  await app.listen(env.PORT)
  console.log(`Server running on http://localhost:${env.PORT}`)
}

bootstrap()
