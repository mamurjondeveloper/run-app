import { Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit {
  async onModuleInit() {
    await this.$connect();

    // SQLite defaults to its rollback-journal mode, which locks the whole
    // file during any write and makes concurrent readers/writers block each
    // other - under real traffic (several users finishing runs around the
    // same time) that surfaces as "SQLITE_BUSY: database is locked" 500s to
    // the mobile app. WAL lets reads and writes proceed concurrently, and
    // busy_timeout makes a writer wait instead of failing immediately when
    // it does contend with another writer.
    // Both PRAGMAs return a result row (the mode/timeout they were set to),
    // so SQLite rejects them via $executeRawUnsafe ("Execute returned
    // results, which is not allowed") - they need $queryRawUnsafe instead.
    await this.$queryRawUnsafe('PRAGMA journal_mode = WAL;');
    await this.$queryRawUnsafe('PRAGMA busy_timeout = 5000;');
  }
}
