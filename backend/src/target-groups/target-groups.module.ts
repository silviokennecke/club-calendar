import { Module } from '@nestjs/common'
import { TargetGroupsController } from './target-groups.controller'
import { TargetGroupsService } from './target-groups.service'

@Module({
  controllers: [TargetGroupsController],
  providers: [TargetGroupsService],
})
export class TargetGroupsModule {}
