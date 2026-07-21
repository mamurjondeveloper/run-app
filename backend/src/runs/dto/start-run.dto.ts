import { ArrayMinSize, IsArray, IsNumber, IsOptional, Max, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class PlannedRoutePointDto {
  @IsNumber() lat: number;
  @IsNumber() lng: number;
}

export class StartRunDto {
  @IsOptional()
  @IsArray()
  @ArrayMinSize(2)
  @ValidateNested({ each: true })
  @Type(() => PlannedRoutePointDto)
  plannedRoutePath?: PlannedRoutePointDto[];

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(200000)
  plannedDistanceMeters?: number;
}
