import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';

export type LeaderboardPeriod = 'daily' | 'weekly' | 'alltime';

export interface LeaderboardEntry {
  rank: number;
  userId: string;
  username: string;
  avatarUrl: string | null;
  distanceMeters: number;
  points: number;
}

// The leaderboard changes slowly (only when someone finishes a run) but was
// being recomputed - a groupBy/aggregate over the whole Run/User tables -
// from scratch on every single request. A short in-memory cache means the
// heavy query runs at most once per period per TTL window instead of once
// per page view.
const CACHE_TTL_MS = 30_000;

@Injectable()
export class LeaderboardService {
  private cache = new Map<string, { expiresAt: number; data: LeaderboardEntry[] }>();

  constructor(private prisma: PrismaService) {}

  private periodStart(period: LeaderboardPeriod): Date | null {
    const now = new Date();
    if (period === 'daily') {
      return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    }
    if (period === 'weekly') {
      const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
      start.setUTCDate(start.getUTCDate() - 6);
      return start;
    }
    return null;
  }

  async getLeaderboard(period: LeaderboardPeriod, limit = 50): Promise<LeaderboardEntry[]> {
    const cacheKey = `${period}:${limit}`;
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.data;
    }

    const data = await this.computeLeaderboard(period, limit);
    this.cache.set(cacheKey, { expiresAt: Date.now() + CACHE_TTL_MS, data });
    return data;
  }

  private async computeLeaderboard(period: LeaderboardPeriod, limit: number): Promise<LeaderboardEntry[]> {
    if (period === 'alltime') {
      const stats = await this.prisma.userStats.findMany({
        where: { user: { isBanned: false } },
        orderBy: { totalPoints: 'desc' },
        take: limit,
        include: { user: { select: { username: true, avatarUrl: true } } },
      });
      return stats.map((s, idx) => ({
        rank: idx + 1,
        userId: s.userId,
        username: s.user.username,
        avatarUrl: s.user.avatarUrl,
        distanceMeters: s.totalDistanceM,
        points: s.totalPoints,
      }));
    }

    const start = this.periodStart(period);
    const grouped = await this.prisma.run.groupBy({
      by: ['userId'],
      where: { status: 'completed', startedAt: { gte: start ?? undefined } },
      _sum: { distanceMeters: true, pointsEarned: true },
      orderBy: { _sum: { pointsEarned: 'desc' } },
      take: limit,
    });

    const userIds = grouped.map((g) => g.userId);
    const users = await this.prisma.user.findMany({
      where: { id: { in: userIds }, isBanned: false },
      select: { id: true, username: true, avatarUrl: true },
    });
    const userMap = new Map(users.map((u) => [u.id, u]));

    return grouped
      .filter((g) => userMap.has(g.userId))
      .map((g, idx) => {
        const user = userMap.get(g.userId)!;
        return {
          rank: idx + 1,
          userId: g.userId,
          username: user.username,
          avatarUrl: user.avatarUrl,
          distanceMeters: g._sum.distanceMeters ?? 0,
          points: g._sum.pointsEarned ?? 0,
        };
      });
  }

  async getMyRank(userId: string, period: LeaderboardPeriod) {
    const board = await this.getLeaderboard(period, 1000);
    const idx = board.findIndex((entry) => entry.userId === userId);
    if (idx === -1) {
      return { rank: null, entry: null, neighbors: [] };
    }
    const neighbors = board.slice(Math.max(0, idx - 2), idx + 3);
    return { rank: idx + 1, entry: board[idx], neighbors };
  }
}
