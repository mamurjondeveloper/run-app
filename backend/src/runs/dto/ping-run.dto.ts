import { IsLatitude, IsLongitude } from 'class-validator';

// Sent periodically (every ~25s - see mobile App.tsx) by the client while a
// run is in progress, purely so other users can see "who's running right
// now" (GET /runs/live below). Deliberately just lat/lng - no path history,
// no auth beyond ownership - this is a live "is someone out running" signal,
// not a data source anything else depends on, so losing an occasional ping
// (offline, a dropped request) is harmless.
export class PingRunDto {
  @IsLatitude()
  lat: number;

  @IsLongitude()
  lng: number;
}
