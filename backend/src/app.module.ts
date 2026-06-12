import { Module } from '@nestjs/common'
import { APP_FILTER } from '@nestjs/core'
import { PrismaModule } from './prisma/prisma.module'
import { AppExceptionFilter } from './common/filters/app-exception.filter'
import { AuthModule } from './auth/auth.module'
import { ClubsModule } from './clubs/clubs.module'
// Feature modules will be added in later phases — leave these as TODO comments
// import { CalendarsModule } from './calendars/calendars.module'
// import { PropertiesModule } from './properties/properties.module'
// import { FeaturesModule } from './features/features.module'
// import { TargetGroupsModule } from './target-groups/target-groups.module'
// import { LocationsModule } from './locations/locations.module'
// import { TemplatesModule } from './templates/templates.module'
// import { FeedsModule } from './feeds/feeds.module'
// import { EventsModule } from './events/events.module'
// import { FeedPublicModule } from './feed-public/feed-public.module'

@Module({
  imports: [
    PrismaModule,
    AuthModule,
    ClubsModule,
  ],
  providers: [
    { provide: APP_FILTER, useClass: AppExceptionFilter },
  ],
})
export class AppModule {}
