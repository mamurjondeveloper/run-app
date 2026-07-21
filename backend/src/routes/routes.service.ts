import { BadRequestException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface SuggestedRoute {
  distanceMeters: number;
  durationSec: number;
  path: { lat: number; lng: number }[];
}

@Injectable()
export class RoutesService {
  constructor(private configService: ConfigService) {}

  // Generates a walking/running loop of ~targetKm starting and ending at
  // (lat, lng) using OpenRouteService's round-trip directions feature, so
  // the suggested route follows real streets/paths instead of just drawing
  // a circle over buildings and rivers.
  async suggestRoute(lat: number, lng: number, targetKm: number): Promise<SuggestedRoute> {
    const apiKey = this.configService.get<string>('ORS_API_KEY');
    if (!apiKey) {
      throw new ServiceUnavailableException('Route suggestions are not configured on this server yet');
    }

    const response = await fetch('https://api.openrouteservice.org/v2/directions/foot-walking/geojson', {
      method: 'POST',
      headers: {
        Authorization: apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        coordinates: [[lng, lat]],
        options: {
          round_trip: {
            length: Math.round(targetKm * 1000),
            points: 4,
          },
        },
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new BadRequestException(`Could not generate a route: ${text.slice(0, 300)}`);
    }

    const data = await response.json();
    const feature = data?.features?.[0];
    if (!feature) {
      throw new BadRequestException('No route could be found near this location');
    }

    const coordinates: [number, number][] = feature.geometry.coordinates;
    return {
      distanceMeters: Math.round(feature.properties.summary.distance),
      durationSec: Math.round(feature.properties.summary.duration),
      path: coordinates.map(([routeLng, routeLat]) => ({ lat: routeLat, lng: routeLng })),
    };
  }
}
