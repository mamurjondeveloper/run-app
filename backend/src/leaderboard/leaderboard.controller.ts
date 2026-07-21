import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { LeaderboardService, LeaderboardPeriod } from './leaderboard.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';

function parsePeriod(period?: string): LeaderboardPeriod {
  if (period === 'daily' || period === 'weekly' || period === 'alltime') {
    return period;
  }
  return 'daily';
}

@UseGuards(JwtAuthGuard)
@Controller('leaderboard')
export class LeaderboardController {
  constructor(private readonly leaderboardService: LeaderboardService) {}

  @Get()
  async getLeaderboard(@Query('period') period?: string) {
    return this.leaderboardService.getLeaderboard(parsePeriod(period));
  }

  @Get('me')
  async getMyRank(@CurrentUser() user: any, @Query('period') period?: string) {
    return this.leaderboardService.getMyRank(user.id, parsePeriod(period));
  }
}
