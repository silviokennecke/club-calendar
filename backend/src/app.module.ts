import { Module } from '@nestjs/common'
import { PrismaModule } from './prisma/prisma.module'
// Feature modules will be added in later phases — leave these as TODO comments
// import { AuthModule } from './auth/auth.module'
// import { ClubsModule } from './clubs/clubs.module'
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
    // Feature modules added in Phase 2
  ],
})
export class AppModule {}
