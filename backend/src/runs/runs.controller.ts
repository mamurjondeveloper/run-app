import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { RunsService } from './runs.service';
import { FinishRunDto } from './dto/finish-run.dto';
import { StartRunDto } from './dto/start-run.dto';
import { PingRunDto } from './dto/ping-run.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';

@UseGuards(JwtAuthGuard)
@Controller('runs')
export class RunsController {
  constructor(private readonly runsService: RunsService) {}

  @Post('start')
  async start(@CurrentUser() user: any, @Body() dto: StartRunDto) {
    return this.runsService.startRun(user.id, dto);
  }

  @Patch(':id/finish')
  async finish(
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Body() dto: FinishRunDto,
  ) {
    return this.runsService.finishRun(user.id, id, dto);
  }

  @Patch(':id/discard')
  async discard(@CurrentUser() user: any, @Param('id') id: string) {
    return this.runsService.discardRun(user.id, id);
  }

  // Called every ~25s by the mobile app while a run is in progress (see
  // App.tsx) - purely to power the "who's running right now" live list
  // below. Deliberately not covered by FinishRunDto's path validation -
  // this is a single lat/lng point, not a GPS track.
  @Patch(':id/ping')
  async ping(
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Body() dto: PingRunDto,
  ) {
    return this.runsService.pingRun(user.id, id, dto);
  }

  @Get('me')
  async myRuns(@CurrentUser() user: any, @Query('limit') limit?: string) {
    // Clamp so a client (or anyone hitting the API directly) can't request
    // an unbounded findMany, e.g. ?limit=999999.
    const MAX_LIMIT = 100;
    const parsed = limit ? Number(limit) : undefined;
    const safeLimit =
      parsed && Number.isFinite(parsed) && parsed > 0
        ? Math.min(parsed, MAX_LIMIT)
        : undefined;
    return this.runsService.getMyRuns(user.id, safeLimit);
  }

  // Must come before the ':id' route below, or NestJS would match a request
  // for /runs/live as ':id' = 'live' instead.
  @Get('live')
  async live(@CurrentUser() user: any) {
    return this.runsService.getLiveRuns(user.id);
  }

  @Get(':id')
  async getRun(@CurrentUser() user: any, @Param('id') id: string) {
    return this.runsService.getRun(user.id, id);
  }
}
