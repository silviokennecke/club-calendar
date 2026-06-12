import { Controller, Get, Req, Res } from '@nestjs/common'
import { Request, Response } from 'express'
import { env } from '../env'

@Controller('api/mapbox')
export class MapboxController {
  @Get('*')
  async proxy(@Req() req: Request, @Res() res: Response) {
    if (!env.MAPBOX_TOKEN) {
      res.status(503).json({ error: 'Map service not configured' })
      return
    }

    const mapboxPath = req.path.replace('/api/mapbox', '') || '/'

    const params = new URLSearchParams()
    for (const [k, v] of Object.entries(req.query)) {
      if (k !== 'access_token') {
        if (Array.isArray(v)) {
          v.forEach((val) => params.append(k, String(val)))
        } else {
          params.set(k, String(v))
        }
      }
    }
    params.set('access_token', env.MAPBOX_TOKEN)

    const upstreamUrl = `https://api.mapbox.com${mapboxPath}?${params}`

    try {
      const upstream = await fetch(upstreamUrl)
      res.status(upstream.status)

      const skip = new Set(['transfer-encoding', 'connection', 'keep-alive', 'te', 'trailer', 'upgrade'])
      upstream.headers.forEach((value, key) => {
        if (!skip.has(key.toLowerCase())) res.setHeader(key, value)
      })

      const buf = await upstream.arrayBuffer()
      res.end(Buffer.from(buf))
    } catch {
      res.status(502).json({ error: 'Failed to reach map service' })
    }
  }
}
