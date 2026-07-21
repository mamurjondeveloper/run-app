import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { RoutesService } from './routes.service';
import { SuggestRouteDto } from './dto/suggest-route.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@UseGuards(JwtAuthGuard)
@Controller('routes')
export class RoutesController {
  constructor(private readonly routesService: RoutesService) {}

  @Post('suggest')
  async suggest(@Body() dto: SuggestRouteDto) {
    return this.routesService.suggestRoute(dto.lat, dto.lng, dto.targetKm);
  }
}
