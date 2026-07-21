import { ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
  ) {}

  async login(username: string, pass: string) {
    const user = await this.prisma.user.findUnique({
      where: { username },
    });

    if (!user) {
      throw new UnauthorizedException("Foydalanuvchi nomi yoki parol noto'g'ri");
    }

    const isMatch = await bcrypt.compare(pass, user.passwordHash);
    if (!isMatch) {
      throw new UnauthorizedException("Foydalanuvchi nomi yoki parol noto'g'ri");
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
      const existing = await this.prisma.user.findUnique({ where: { username } });
      if (existing && existing.id !== userId) {
        throw new ConflictException('Bu foydalanuvchi nomi allaqachon band');
      }
    }

    const user = await this.prisma.user.update({
      where: { id: userId },
      data: username ? { username } : {},
    });

    return {
      id: user.id,
      username: user.username,
      avatarUrl: user.avatarUrl,
      isBanned: user.isBanned,
      bannedReason: user.bannedReason,
    };
  }

  async updateAvatar(userId: string, file: Express.Multer.File) {
    const ext = path.extname(file.originalname) || '.jpg';
    const filename = `${userId}-${Date.now()}${ext}`;
    const avatarPath = path.join(process.cwd(), 'uploads/avatars', filename);
    fs.writeFileSync(avatarPath, file.buffer);

    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (user?.avatarUrl) {
      const oldPath = path.join(process.cwd(), user.avatarUrl);
      if (fs.existsSync(oldPath)) {
        try {
          fs.unlinkSync(oldPath);
        } catch (e: any) {
          console.warn('Could not delete old avatar file:', e.message);
        }
      }
    }

    const avatarUrl = `/uploads/avatars/${filename}`;
    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: { avatarUrl },
    });

    return {
      id: updated.id,
      username: updated.username,
      avatarUrl: updated.avatarUrl,
      isBanned: updated.isBanned,
      bannedReason: updated.bannedReason,
    };
  }

  async changePassword(userId: string, currentPassword: string, newPassword: string) {
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
    const startOfDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const startOfWeek = new Date(startOfDay);
    startOfWeek.setUTCDate(startOfWeek.getUTCDate() - 6);
    const startOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

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
        where: { userId, status: 'completed', startedAt: { gte: startOfMonth } },
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
    return this.prisma.user.findUnique({
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
  }
}
