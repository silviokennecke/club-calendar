import { Module } from '@nestjs/common'
import { MapboxController } from './mapbox.controller'

@Module({ controllers: [MapboxController] })
export class MapboxModule {}
