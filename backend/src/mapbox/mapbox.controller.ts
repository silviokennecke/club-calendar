import { All, Controller, Req, Res } from '@nestjs/common'
import { Request, Response } from 'express'
import { env } from '../env'

const ALLOWED_DOMAINS = new Set(['api.mapbox.com', 'events.mapbox.com'])

// Node fetch decompresses bodies automatically — these headers become invalid after decompression
const DROP_HEADERS = new Set([
  'transfer-encoding',
  'content-encoding',
  'content-length',
  'connection',
  'keep-alive',
  'te',
  'trailer',
  'upgrade',
])

@Controller('api/mapbox')
export class MapboxController {
  @All('*')
  async proxy(@Req() req: Request, @Res() res: Response) {
    if (!env.MAPBOX_TOKEN) {
      res.status(503).json({ error: 'Map service not configured' })
      return
    }

    // Expected path format: /api/mapbox/<domain>/<rest>
    const afterPrefix = req.path.replace(/^\/api\/mapbox/, '')
    const parts = afterPrefix.split('/').filter(Boolean)
    const domain = parts[0] ?? ''
    const mapboxPath = '/' + parts.slice(1).join('/')

    if (!ALLOWED_DOMAINS.has(domain)) {
      res.status(400).json({ error: `Domain not allowed: ${domain}` })
      return
    }

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

    const upstreamUrl = `https://${domain}${mapboxPath}?${params}`

    let body: string | undefined
    if (['POST', 'PUT', 'PATCH'].includes(req.method ?? '') && req.body) {
      body = JSON.stringify(req.body)
    }

    try {
      const upstream = await fetch(upstreamUrl, {
        method: req.method,
        headers: body ? { 'content-type': 'application/json' } : undefined,
        body,
      })
      res.status(upstream.status)

      upstream.headers.forEach((value, key) => {
        if (!DROP_HEADERS.has(key.toLowerCase())) res.setHeader(key, value)
      })

      const buf = await upstream.arrayBuffer()
      res.end(Buffer.from(buf))
    } catch {
      res.status(502).json({ error: 'Failed to reach map service' })
    }
  }
}
