import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma.module';
import { AuthModule } from './auth/auth.module';
import { RunsModule } from './runs/runs.module';
import { LeaderboardModule } from './leaderboard/leaderboard.module';
import { RoutesModule } from './routes/routes.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    // Default cap for every route; auth endpoints tighten this further with
    // their own @Throttle() to blunt brute-force login/register attempts,
    // which would otherwise compete with real users for the single backend
    // instance's CPU/DB (bcrypt + SQLite lock contention).
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 120 }]),
    PrismaModule,
    AuthModule,
    RunsModule,
    LeaderboardModule,
    RoutesModule,
  ],
  controllers: [AppController],
  providers: [AppService, { provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
