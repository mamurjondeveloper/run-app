import { IsOptional, IsString, Matches } from 'class-validator';

export class UpdateProfileDto {
  @IsOptional()
  @IsString()
  @Matches(/^[a-zA-Z0-9_.-]{3,32}$/, {
    message: 'Username must be 3-32 characters (letters, numbers, _ . -)',
  })
  username?: string;
}
