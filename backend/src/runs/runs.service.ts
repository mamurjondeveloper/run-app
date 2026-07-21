import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { FinishRunDto, RunPointDto } from './dto/finish-run.dto';
import { StartRunDto } from './dto/start-run.dto';

// Faster than this is not running — a bus, metro, or car. Segments implying a
// speed above this are excluded from the distance/points calculation instead
// of invalidating the whole run, since a runner can legitimately cross a
// road or wait at a light mid-run.
const MAX_RUNNING_SPEED_KMH = 40;
// A run needs this many flagged (too-fast) runs before the account is banned
// from submitting further runs. Kept low-ish since this is meant to catch
// repeated, deliberate cheating, not one bad GPS fix.
const BAN_THRESHOLD_VIOLATIONS = 5;
// A gap this long between two consecutive points means tracking was almost
// certainly paused (e.g. a browser tab backgrounded/suspended) rather than
// the runner covering that ground in one straight line — excluded from the
// distance/elevation totals the same way an implausible speed segment is.
const MAX_GAP_SECONDS = 30;

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
  flaggedSegments: number;
  elevationGainM: number;
}

// The server is the source of truth for run stats: it recomputes everything
// from the raw GPS path rather than trusting numbers the client could have
// sent directly (which would make the leaderboard trivially fakeable via a
// bare API call, with no app or GPS involved at all).
//
// Each consecutive pair of points is checked individually: if the implied
// speed for that segment is faster than running, that segment's distance is
// dropped from the total instead of rejecting the whole run — so switching
// to a bus for one block doesn't wipe out an otherwise-real run, but it also
// doesn't get counted as running.
function computeStatsFromPath(path: RunPointDto[]): ComputedRunStats {
  const sorted = [...path].sort((a, b) => a.ts - b.ts);

  let distanceMeters = 0;
  let flaggedSegments = 0;
  let elevationGainM = 0;
  let maxSegmentSpeedKmh = 0;

  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const curr = sorted[i];
    const segmentMeters = haversineMeters(prev, curr);
    const segmentSec = (curr.ts - prev.ts) / 1000;

    if (segmentMeters >= 200 || segmentSec > MAX_GAP_SECONDS) {
      // GPS noise jump, or a tracking gap (e.g. backgrounded tab) - neither
      // counted nor flagged, since we have no real data for what happened
      continue;
    }

    const impliedSpeedKmh = segmentSec > 0 ? segmentMeters / 1000 / (segmentSec / 3600) : 0;
    if (impliedSpeedKmh > MAX_RUNNING_SPEED_KMH) {
      flaggedSegments++;
      continue;
    }

    distanceMeters += segmentMeters;
    if (impliedSpeedKmh > maxSegmentSpeedKmh) {
      maxSegmentSpeedKmh = impliedSpeedKmh;
    }
    // Altitude is best-effort (many devices/browsers never report it) - only
    // count a gain when both points in the segment actually have a reading.
    if (typeof prev.alt === 'number' && typeof curr.alt === 'number' && curr.alt > prev.alt) {
      elevationGainM += curr.alt - prev.alt;
    }
  }

  const durationSec = Math.max(0, Math.round((sorted[sorted.length - 1].ts - sorted[0].ts) / 1000));
  const avgSpeedKmh = durationSec > 0 ? distanceMeters / 1000 / (durationSec / 3600) : 0;
  // Prefer device-reported instantaneous speed where available (more accurate
  // than a segment average), but fall back to the segment-implied speed above
  // so this stat isn't 0 just because a browser/device never reports coords.speed.
  const maxReportedSpeedKmh = sorted.reduce((max, p) => {
    if (p.speedKmh && p.speedKmh <= MAX_RUNNING_SPEED_KMH && p.speedKmh > max) return p.speedKmh;
    return max;
  }, 0);
  const maxSpeedKmh = Math.max(maxReportedSpeedKmh, maxSegmentSpeedKmh);

  return {
    distanceMeters: Math.round(distanceMeters),
    durationSec,
    avgSpeedKmh: Math.round(avgSpeedKmh * 10) / 10,
    maxSpeedKmh: Math.round(maxSpeedKmh * 10) / 10,
    flaggedSegments,
    elevationGainM: Math.round(elevationGainM),
  };
}

@Injectable()
export class RunsService {
  constructor(private prisma: PrismaService) {}

  async startRun(userId: string, dto?: StartRunDto) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (user?.isBanned) {
      throw new ForbiddenException(
        user.bannedReason || "Hisobingiz takroriy shubhali tezlik faoliyati uchun to'xtatilgan.",
      );
    }

    // Guard against starting a second run while one is already in progress
    const existing = await this.prisma.run.findFirst({
      where: { userId, status: 'in_progress' },
    });
    if (existing) {
      return {
        ...existing,
        plannedRoutePath: existing.plannedRoutePath ? JSON.parse(existing.plannedRoutePath) : null,
      };
    }

    const run = await this.prisma.run.create({
      data: {
        userId,
        status: 'in_progress',
        plannedRoutePath: dto?.plannedRoutePath ? JSON.stringify(dto.plannedRoutePath) : null,
        plannedDistanceMeters: dto?.plannedDistanceMeters ?? null,
      },
    });

    return { ...run, plannedRoutePath: dto?.plannedRoutePath ?? null };
  }

  async finishRun(userId: string, runId: string, dto: FinishRunDto) {
    const run = await this.prisma.run.findUnique({ where: { id: runId } });
    if (!run) {
      throw new NotFoundException('Yugurish topilmadi');
    }
    if (run.userId !== userId) {
      throw new ForbiddenException('Bu yugurish sizga tegishli emas');
    }
    if (run.status !== 'in_progress') {
      throw new BadRequestException('Bu yugurish allaqachon tugatilgan yoki bekor qilingan');
    }

    const computed = computeStatsFromPath(dto.path);
    if (computed.distanceMeters <= 0) {
      throw new BadRequestException(
        computed.flaggedSegments > 0
          ? "Bu yugurishning barchasi yugurish tezligidan tez ko'rindi, shuning uchun hech narsa hisoblanmadi."
          : 'Bu yugurishda harakat aniqlanmadi',
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

    const speedViolationCount = stats.speedViolationCount + (computed.flaggedSegments > 0 ? 1 : 0);
    const shouldBan = speedViolationCount >= BAN_THRESHOLD_VIOLATIONS;

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
          flaggedSegments: computed.flaggedSegments,
          elevationGainM: computed.elevationGainM,
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
          speedViolationCount,
          totalElevationM: stats.totalElevationM + computed.elevationGainM,
        },
      }),
      ...(shouldBan
        ? [
            this.prisma.user.update({
              where: { id: userId },
              data: {
                isBanned: true,
                bannedReason: `${speedViolationCount} marta yugurish tezligidan tez harakatlangani uchun to'xtatildi.`,
              },
            }),
          ]
        : []),
    ]);

    return {
      ...updatedRun,
      plannedRoutePath: updatedRun.plannedRoutePath ? JSON.parse(updatedRun.plannedRoutePath) : null,
      warning:
        computed.flaggedSegments > 0
          ? `Bu yugurishning ${computed.flaggedSegments} qismi yugurish tezligidan tez bo'lgani uchun hisoblanmadi.`
          : null,
      banned: shouldBan,
    };
  }

  async discardRun(userId: string, runId: string) {
    const run = await this.prisma.run.findUnique({ where: { id: runId } });
    if (!run) {
      throw new NotFoundException('Yugurish topilmadi');
    }
    if (run.userId !== userId) {
      throw new ForbiddenException('Bu yugurish sizga tegishli emas');
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
      throw new NotFoundException('Yugurish topilmadi');
    }
    if (run.userId !== userId) {
      throw new ForbiddenException('Bu yugurish sizga tegishli emas');
    }
    return {
      ...run,
      path: run.path ? JSON.parse(run.path) : [],
      plannedRoutePath: run.plannedRoutePath ? JSON.parse(run.plannedRoutePath) : null,
    };
  }
}
