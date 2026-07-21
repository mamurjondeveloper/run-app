import { IsArray, IsNumber, IsOptional, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

class RunPointDto {
  @IsNumber()
  lat: number;

  @IsNumber()
  lng: number;

  @IsNumber()
  ts: number;

  @IsOptional()
  @IsNumber()
  speedKmh?: number;
}

export class FinishRunDto {
  @IsNumber()
  @Min(0)
  distanceMeters: number;

  @IsNumber()
  @Min(0)
  durationSec: number;

  @IsNumber()
  @Min(0)
  avgSpeedKmh: number;

  @IsNumber()
  @Min(0)
  maxSpeedKmh: number;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RunPointDto)
  path?: RunPointDto[];
}
