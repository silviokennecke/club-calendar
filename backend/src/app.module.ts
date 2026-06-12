import { Module } from '@nestjs/common'
import { APP_FILTER } from '@nestjs/core'
import { AppController } from './app.controller'
import { PrismaModule } from './prisma/prisma.module'
import { AppExceptionFilter } from './common/filters/app-exception.filter'
import { AuthModule } from './auth/auth.module'
import { ClubsModule } from './clubs/clubs.module'
import { CalendarsModule } from './calendars/calendars.module'
import { PropertiesModule } from './properties/properties.module'
import { FeaturesModule } from './features/features.module'
import { TargetGroupsModule } from './target-groups/target-groups.module'
import { LocationsModule } from './locations/locations.module'
import { EventTemplatesModule } from './event-templates/event-templates.module'
import { FeedsModule } from './feeds/feeds.module'
import { EventsModule } from './events/events.module'
import { PublicModule } from './public/public.module'

@Module({
  controllers: [AppController],
  imports: [
    PrismaModule,
    AuthModule,
    ClubsModule,
    CalendarsModule,
    PropertiesModule,
    FeaturesModule,
    TargetGroupsModule,
    LocationsModule,
    EventTemplatesModule,
    FeedsModule,
    EventsModule,
    PublicModule,
  ],
  providers: [
    { provide: APP_FILTER, useClass: AppExceptionFilter },
  ],
})
export class AppModule {}
