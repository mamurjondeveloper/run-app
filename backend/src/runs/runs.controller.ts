import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { RunsService } from './runs.service';
import { FinishRunDto } from './dto/finish-run.dto';
import { StartRunDto } from './dto/start-run.dto';
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
  async finish(@CurrentUser() user: any, @Param('id') id: string, @Body() dto: FinishRunDto) {
    return this.runsService.finishRun(user.id, id, dto);
  }

  @Patch(':id/discard')
  async discard(@CurrentUser() user: any, @Param('id') id: string) {
    return this.runsService.discardRun(user.id, id);
  }

  @Get('me')
  async myRuns(@CurrentUser() user: any, @Query('limit') limit?: number) {
    return this.runsService.getMyRuns(user.id, limit ? Number(limit) : undefined);
  }

  @Get(':id')
  async getRun(@CurrentUser() user: any, @Param('id') id: string) {
    return this.runsService.getRun(user.id, id);
  }
}
