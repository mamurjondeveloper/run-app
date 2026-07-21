import { IsOptional, IsString, Matches } from 'class-validator';

export class UpdateProfileDto {
  @IsOptional()
  @IsString()
  @Matches(/^[a-zA-Z0-9_.-]{3,32}$/, {
    message: "Foydalanuvchi nomi 3-32 belgidan iborat bo'lishi kerak (harflar, raqamlar, _ . -)",
  })
  username?: string;
}
