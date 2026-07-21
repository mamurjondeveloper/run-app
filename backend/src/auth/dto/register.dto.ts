import { IsNotEmpty, IsString, Matches, MinLength } from 'class-validator';

export class RegisterDto {
  @IsString()
  @IsNotEmpty()
  @Matches(/^[a-zA-Z0-9_.-]{3,32}$/, {
    message: "Foydalanuvchi nomi 3-32 belgidan iborat bo'lishi kerak (harflar, raqamlar, _ . -)",
  })
  username: string;

  @IsString()
  @IsNotEmpty()
  @MinLength(6, { message: 'Parol kamida 6 belgidan iborat bo\'lishi kerak' })
  password: string;
}
