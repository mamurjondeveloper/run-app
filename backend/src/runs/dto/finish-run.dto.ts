import { ArrayMaxSize, ArrayMinSize, IsArray, IsNumber, IsOptional, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class RunPointDto {
  @IsNumber()
  lat: number;

  @IsNumber()
  lng: number;

  @IsNumber()
  ts: number;

  @IsOptional()
  @IsNumber()
  speedKmh?: number;

  @IsOptional()
  @IsNumber()
  alt?: number;
}

export class FinishRunDto {
  // The GPS path is the only source of truth for a run's stats — the server
  // recomputes distance/duration/speed from these points itself rather than
  // trusting client-submitted numbers, since those would otherwise be
  // trivial to fake (anyone could POST a huge distanceMeters directly and
  // top the leaderboard without ever running).
  // Caps how much work computeStatsFromPath() can be made to do in one
  // request. Without this, an arbitrarily large array would be sorted and
  // walked synchronously on the Node event loop, blocking every other
  // in-flight request (all users' /runs/me, /leaderboard, /auth/me, ...)
  // for however long that takes. The mobile app samples roughly every 4s,
  // so 20000 points covers well over 20 hours of continuous tracking.
  @IsArray()
  @ArrayMinSize(2, { message: 'Yugurishni yozib olish uchun kamida 2 ta GPS nuqtasi kerak' })
  @ArrayMaxSize(20000, { message: "Yugurish ma'lumotlari juda katta" })
  @ValidateNested({ each: true })
  @Type(() => RunPointDto)
  path: RunPointDto[];
}
