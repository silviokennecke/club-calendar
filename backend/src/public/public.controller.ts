import { Controller, Get, Param, Query, ParseIntPipe, Res } from '@nestjs/common'
import { Response } from 'express'
import { PublicService } from './public.service'
import { AppError } from '../lib/errors'

@Controller('api/feed')
export class PublicController {
  constructor(private readonly service: PublicService) {}

  @Get(':feedId/events')
  async getEvents(
    @Param('feedId', ParseIntPipe) feedId: number,
    @Query('secret') secret: string,
    @Query('targetGroupIds') tgParam: string,
  ) {
    const targetGroupIds = tgParam ? tgParam.split(',').map(Number).filter((n) => !isNaN(n)) : undefined
    const { feed, events } = await this.service.getFeedEvents(feedId, secret, targetGroupIds)
    return { feed: { id: feed.id, name: feed.name }, events }
  }

  @Get(':feedId/ics')
  async getIcs(
    @Param('feedId', ParseIntPipe) feedId: number,
    @Query('secret') secret: string,
    @Query('targetGroupIds') tgParam: string,
    @Res() res: Response,
  ) {
    const targetGroupIds = tgParam ? tgParam.split(',').map(Number).filter((n) => !isNaN(n)) : undefined
    try {
      const ics = await this.service.getFeedIcs(feedId, secret, targetGroupIds)
      res.setHeader('Content-Type', 'text/calendar; charset=utf-8')
      res.setHeader('Content-Disposition', `attachment; filename="feed-${feedId}.ics"`)
      res.setHeader('Cache-Control', 'no-cache, no-store')
      res.send(ics)
    } catch (err) {
      if (err instanceof AppError) {
        res.status(err.status).json({ error: err.message })
      } else {
        res.status(500).json({ error: 'Internal server error' })
      }
    }
  }
}
