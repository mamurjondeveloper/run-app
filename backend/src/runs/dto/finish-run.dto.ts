import { ArrayMinSize, IsArray, IsNumber, IsOptional, ValidateNested } from 'class-validator';
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
  @IsArray()
  @ArrayMinSize(2, { message: 'A run needs at least 2 GPS points to be recorded' })
  @ValidateNested({ each: true })
  @Type(() => RunPointDto)
  path: RunPointDto[];
}
