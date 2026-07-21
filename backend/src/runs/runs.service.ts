import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { FinishRunDto } from './dto/finish-run.dto';

function startOfUTCDate(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function daysBetween(a: Date, b: Date): number {
  const MS_PER_DAY = 24 * 60 * 60 * 1000;
  return Math.round((startOfUTCDate(a).getTime() - startOfUTCDate(b).getTime()) / MS_PER_DAY);
}

@Injectable()
export class RunsService {
  constructor(private prisma: PrismaService) {}

  async startRun(userId: string) {
    // Guard against starting a second run while one is already in progress
    const existing = await this.prisma.run.findFirst({
      where: { userId, status: 'in_progress' },
    });
    if (existing) {
      return existing;
    }

    return this.prisma.run.create({
      data: { userId, status: 'in_progress' },
    });
  }

  async finishRun(userId: string, runId: string, dto: FinishRunDto) {
    const run = await this.prisma.run.findUnique({ where: { id: runId } });
    if (!run) {
      throw new NotFoundException('Run not found');
    }
    if (run.userId !== userId) {
      throw new ForbiddenException('This run does not belong to you');
    }
    if (run.status !== 'in_progress') {
      throw new BadRequestException('Run has already been finished or discarded');
    }

    const stats = await this.prisma.userStats.upsert({
      where: { userId },
      create: { userId },
      update: {},
    });

    const now = new Date();
    let currentStreakDays = stats.currentStreakDays;
    if (!stats.lastRunDate) {
      currentStreakDays = 1;
    } else {
      const gap = daysBetween(now, stats.lastRunDate);
      if (gap === 0) {
        // Another run today - streak unchanged
      } else if (gap === 1) {
        currentStreakDays += 1;
      } else {
        currentStreakDays = 1;
      }
    }
    const longestStreakDays = Math.max(stats.longestStreakDays, currentStreakDays);

    const streakBonus = Math.min(currentStreakDays, 30) * 5;
    const pointsEarned = Math.round(dto.distanceMeters / 100) + streakBonus;

    const [updatedRun] = await this.prisma.$transaction([
      this.prisma.run.update({
        where: { id: runId },
        data: {
          status: 'completed',
          endedAt: now,
          distanceMeters: dto.distanceMeters,
          durationSec: dto.durationSec,
          avgSpeedKmh: dto.avgSpeedKmh,
          maxSpeedKmh: dto.maxSpeedKmh,
          pointsEarned,
          path: dto.path ? JSON.stringify(dto.path) : null,
        },
      }),
      this.prisma.userStats.update({
        where: { userId },
        data: {
          totalDistanceM: stats.totalDistanceM + dto.distanceMeters,
          totalRuns: stats.totalRuns + 1,
          totalPoints: stats.totalPoints + pointsEarned,
          bestMaxSpeedKmh: Math.max(stats.bestMaxSpeedKmh, dto.maxSpeedKmh),
          currentStreakDays,
          longestStreakDays,
          lastRunDate: now,
        },
      }),
    ]);

    return updatedRun;
  }

  async discardRun(userId: string, runId: string) {
    const run = await this.prisma.run.findUnique({ where: { id: runId } });
    if (!run) {
      throw new NotFoundException('Run not found');
    }
    if (run.userId !== userId) {
      throw new ForbiddenException('This run does not belong to you');
    }
    return this.prisma.run.update({
      where: { id: runId },
      data: { status: 'discarded', endedAt: new Date() },
    });
  }

  async getMyRuns(userId: string, limit = 20) {
    return this.prisma.run.findMany({
      where: { userId, status: 'completed' },
      orderBy: { startedAt: 'desc' },
      take: limit,
    });
  }

  async getRun(userId: string, runId: string) {
    const run = await this.prisma.run.findUnique({ where: { id: runId } });
    if (!run) {
      throw new NotFoundException('Run not found');
    }
    if (run.userId !== userId) {
      throw new ForbiddenException('This run does not belong to you');
    }
    return {
      ...run,
      path: run.path ? JSON.parse(run.path) : [],
    };
  }
}
