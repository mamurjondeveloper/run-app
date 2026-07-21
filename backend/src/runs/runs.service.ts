import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { FinishRunDto, RunPointDto } from './dto/finish-run.dto';

function startOfUTCDate(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function daysBetween(a: Date, b: Date): number {
  const MS_PER_DAY = 24 * 60 * 60 * 1000;
  return Math.round((startOfUTCDate(a).getTime() - startOfUTCDate(b).getTime()) / MS_PER_DAY);
}

function haversineMeters(a: RunPointDto, b: RunPointDto): number {
  const R = 6371000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(Math.min(1, h)));
}

interface ComputedRunStats {
  distanceMeters: number;
  durationSec: number;
  avgSpeedKmh: number;
  maxSpeedKmh: number;
}

// The server is the source of truth for run stats: it recomputes everything
// from the raw GPS path rather than trusting numbers the client could have
// sent directly (which would make the leaderboard trivially fakeable via a
// bare API call, with no app or GPS involved at all).
function computeStatsFromPath(path: RunPointDto[]): ComputedRunStats {
  const sorted = [...path].sort((a, b) => a.ts - b.ts);

  let distanceMeters = 0;
  for (let i = 1; i < sorted.length; i++) {
    const segment = haversineMeters(sorted[i - 1], sorted[i]);
    // Ignore GPS noise jumps that would be physically impossible for a runner
    if (segment < 200) {
      distanceMeters += segment;
    }
  }

  const durationSec = Math.max(0, Math.round((sorted[sorted.length - 1].ts - sorted[0].ts) / 1000));
  const avgSpeedKmh = durationSec > 0 ? distanceMeters / 1000 / (durationSec / 3600) : 0;
  const maxSpeedKmh = sorted.reduce((max, p) => {
    // A single bad GPS fix can report an absurd instantaneous speed; ignore
    // anything faster than a car, not just faster than a runner, so we don't
    // silently drop legitimate sprint bursts.
    if (p.speedKmh && p.speedKmh < 60 && p.speedKmh > max) return p.speedKmh;
    return max;
  }, 0);

  return {
    distanceMeters: Math.round(distanceMeters),
    durationSec,
    avgSpeedKmh: Math.round(avgSpeedKmh * 10) / 10,
    maxSpeedKmh: Math.round(maxSpeedKmh * 10) / 10,
  };
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

    const computed = computeStatsFromPath(dto.path);
    if (computed.distanceMeters <= 0) {
      throw new BadRequestException('No movement detected in this run');
    }
    if (computed.avgSpeedKmh > 40) {
      throw new BadRequestException(
        'That average speed is faster than running — this looks like it was recorded in a vehicle',
      );
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
    const pointsEarned = Math.round(computed.distanceMeters / 100) + streakBonus;

    const [updatedRun] = await this.prisma.$transaction([
      this.prisma.run.update({
        where: { id: runId },
        data: {
          status: 'completed',
          endedAt: now,
          distanceMeters: computed.distanceMeters,
          durationSec: computed.durationSec,
          avgSpeedKmh: computed.avgSpeedKmh,
          maxSpeedKmh: computed.maxSpeedKmh,
          pointsEarned,
          path: JSON.stringify(dto.path),
        },
      }),
      this.prisma.userStats.update({
        where: { userId },
        data: {
          totalDistanceM: stats.totalDistanceM + computed.distanceMeters,
          totalRuns: stats.totalRuns + 1,
          totalPoints: stats.totalPoints + pointsEarned,
          bestMaxSpeedKmh: Math.max(stats.bestMaxSpeedKmh, computed.maxSpeedKmh),
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
