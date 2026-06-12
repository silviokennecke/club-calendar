import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import { errorHandler } from './middleware/errorHandler.js'
import { routes } from './routes/index.js'
import { env } from './env.js'

export function createApp() {
  const app = new Hono()

  app.use('*', logger())
  app.use(
    '*',
    cors({
      origin: env.FRONTEND_URL,
      credentials: true,
      allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
      allowHeaders: ['Content-Type', 'Authorization'],
    }),
  )

  app.route('/', routes)
  app.onError(errorHandler)

  return app
}
