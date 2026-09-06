import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import * as fs from 'fs';
import * as path from 'path';
import sharp from 'sharp';

export interface SafeUser {
  id: string;
  username: string;
  avatarUrl: string | null;
  isBanned: boolean;
  bannedReason: string | null;
  createdAt: Date;
}

// validateUserById() runs on EVERY authenticated request (it's the Passport
// JWT strategy's validate() callback - see jwt.strategy.ts), so without a
// cache, every single API call was doing its own SQLite read just to
// re-confirm a user still exists and isn't banned. That's a lot of
// redundant contention on the same rows a request's own handler is often
// about to read/write anyway. A short TTL is enough to absorb the request
// bursts that matter (e.g. the mobile app firing off several calls in a
// row on app open) while still noticing a ban within a few seconds; writes
// that change these fields (updateProfile, updateAvatar, a run-service ban)
// also invalidate the entry immediately so this is never stale for longer
// than the TTL AND never stale after an action the user themselves took.
const USER_CACHE_TTL_MS = 15_000;

@Injectable()
export class AuthService {
  private userCache = new Map<string, { expiresAt: number; user: SafeUser }>();

  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
  ) {}

  /** Called by RunsService after banning a user, and internally after any
   * profile/avatar update, so the next request sees fresh data instead of
   * waiting out the TTL above. */
  invalidateUserCache(userId: string) {
    this.userCache.delete(userId);
  }

  async login(username: string, pass: string) {
    const user = await this.prisma.user.findUnique({
      where: { username },
    });

    if (!user) {
      throw new UnauthorizedException(
        "Foydalanuvchi nomi yoki parol noto'g'ri",
      );
    }

    const isMatch = await bcrypt.compare(pass, user.passwordHash);
    if (!isMatch) {
      throw new UnauthorizedException(
        "Foydalanuvchi nomi yoki parol noto'g'ri",
      );
    }

    return this.buildAuthResponse(user);
  }

  async register(username: string, pass: string) {
    const existing = await this.prisma.user.findUnique({ where: { username } });
    if (existing) {
      throw new ConflictException('Bu foydalanuvchi nomi allaqachon band');
    }

    const passwordHash = await bcrypt.hash(pass, 10);
    const user = await this.prisma.user.create({
      data: {
        username,
        passwordHash,
        stats: { create: {} },
      },
    });

    return this.buildAuthResponse(user);
  }

  private buildAuthResponse(user: {
    id: string;
    username: string;
    avatarUrl: string | null;
    isBanned: boolean;
    bannedReason: string | null;
  }) {
    const payload = { sub: user.id, username: user.username };
    return {
      access_token: this.jwtService.sign(payload),
      user: {
        id: user.id,
        username: user.username,
        avatarUrl: user.avatarUrl,
        isBanned: user.isBanned,
        bannedReason: user.bannedReason,
      },
    };
  }

  async updateProfile(userId: string, username?: string) {
    if (username) {
      const existing = await this.prisma.user.findUnique({
        where: { username },
      });
      if (existing && existing.id !== userId) {
        throw new ConflictException('Bu foydalanuvchi nomi allaqachon band');
      }
    }

    const user = await this.prisma.user.update({
      where: { id: userId },
      data: username ? { username } : {},
    });
    this.invalidateUserCache(userId);

    return {
      id: user.id,
      username: user.username,
      avatarUrl: user.avatarUrl,
      isBanned: user.isBanned,
      bannedReason: user.bannedReason,
    };
  }

  async updateAvatar(userId: string, file: Express.Multer.File) {
    // Whatever the client sent (a straight-off-the-camera JPEG can easily be
    // 10+ megapixels), avatars only ever render at small sizes in the app
    // (leaderboard rows, profile header) - re-encoding once here to a fixed
    // max dimension and JPEG quality means every future request for this
    // avatar (leaderboard included, on every viewer's device) downloads a
    // few KB instead of megabytes. Always output .jpg regardless of input
    // format, so a PNG/WEBP upload doesn't keep an alpha channel that's
    // never used (flatten() fills transparency with white).
    const filename = `${userId}-${Date.now()}.jpg`;
    const avatarPath = path.join(process.cwd(), 'uploads/avatars', filename);
    await sharp(file.buffer)
      .resize(512, 512, { fit: 'cover', withoutEnlargement: true })
      .flatten({ background: '#ffffff' })
      .jpeg({ quality: 82 })
      .toFile(avatarPath);

    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (user?.avatarUrl) {
      const oldPath = path.join(process.cwd(), user.avatarUrl);
      try {
        await fs.promises.unlink(oldPath);
      } catch (e: any) {
        // ENOENT (already gone) is fine to ignore; anything else is worth a log.
        if (e.code !== 'ENOENT')
          console.warn('Could not delete old avatar file:', e.message);
      }
    }

    const avatarUrl = `/uploads/avatars/${filename}`;
    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: { avatarUrl },
    });
    this.invalidateUserCache(userId);

    return {
      id: updated.id,
      username: updated.username,
      avatarUrl: updated.avatarUrl,
      isBanned: updated.isBanned,
      bannedReason: updated.bannedReason,
    };
  }

  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
  ) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new UnauthorizedException();
    }

    const isMatch = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!isMatch) {
      throw new UnauthorizedException("Joriy parol noto'g'ri");
    }

    const passwordHash = await bcrypt.hash(newPassword, 10);
    await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash },
    });

    return { success: true };
  }

  async getStats(userId: string) {
    const stats = await this.prisma.userStats.upsert({
      where: { userId },
      create: { userId },
      update: {},
    });
    const agg = await this.prisma.run.aggregate({
      where: { userId, status: 'completed' },
      _avg: { avgSpeedKmh: true },
    });

    const now = new Date();
    const startOfDay = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
    );
    const startOfWeek = new Date(startOfDay);
    startOfWeek.setUTCDate(startOfWeek.getUTCDate() - 6);
    const startOfMonth = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
    );

    const [todayAgg, weekAgg, monthAgg] = await Promise.all([
      this.prisma.run.aggregate({
        where: { userId, status: 'completed', startedAt: { gte: startOfDay } },
        _sum: { distanceMeters: true },
      }),
      this.prisma.run.aggregate({
        where: { userId, status: 'completed', startedAt: { gte: startOfWeek } },
        _sum: { distanceMeters: true },
      }),
      this.prisma.run.aggregate({
        where: {
          userId,
          status: 'completed',
          startedAt: { gte: startOfMonth },
        },
        _sum: { distanceMeters: true },
      }),
    ]);

    return {
      ...stats,
      avgSpeedKmh: Math.round((agg._avg.avgSpeedKmh ?? 0) * 10) / 10,
      todayDistanceM: todayAgg._sum.distanceMeters ?? 0,
      weekDistanceM: weekAgg._sum.distanceMeters ?? 0,
      monthDistanceM: monthAgg._sum.distanceMeters ?? 0,
    };
  }

  async validateUserById(id: string) {
    const cached = this.userCache.get(id);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.user;
    }

    const user = await this.prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        username: true,
        avatarUrl: true,
        isBanned: true,
        bannedReason: true,
        createdAt: true,
      },
    });
    if (user) {
      this.userCache.set(id, {
        expiresAt: Date.now() + USER_CACHE_TTL_MS,
        user,
      });
    } else {
      this.userCache.delete(id);
    }
    return user;
  }
}
