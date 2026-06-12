import { Module } from '@nestjs/common'
import { EventTemplatesController } from './event-templates.controller'
import { EventTemplatesService } from './event-templates.service'

@Module({
  controllers: [EventTemplatesController],
  providers: [EventTemplatesService],
})
export class EventTemplatesModule {}
