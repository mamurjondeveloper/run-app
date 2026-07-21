export interface RoutePoint {
  lat: number;
  lng: number;
}

interface Maneuver {
  index: number;
  type: 'left' | 'right';
  cumulativeDistance: number;
}

function toRad(d: number) {
  return (d * Math.PI) / 180;
}
function toDeg(r: number) {
  return (r * 180) / Math.PI;
}

export function haversineMeters(a: RoutePoint, b: RoutePoint): number {
  const R = 6371000;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(Math.min(1, h)));
}

function bearing(a: RoutePoint, b: RoutePoint): number {
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const dLng = toRad(b.lng - a.lng);
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

function bearingDelta(b1: number, b2: number): number {
  let d = b2 - b1;
  while (d > 180) d -= 360;
  while (d < -180) d += 360;
  return d; // positive = right turn, negative = left turn
}

const TURN_THRESHOLD_DEG = 30;
const MIN_LEG_METERS = 15; // ignore tiny zig-zags from GPS/route noise
const FAR_WARNING_METERS = 250;
const NEAR_WARNING_METERS = 40;
const STRAIGHT_CALLOUT_INTERVAL_METERS = 500;

function buildManeuvers(path: RoutePoint[]): { maneuvers: Maneuver[]; cumulativeDistances: number[] } {
  const cumulativeDistances: number[] = [0];
  for (let i = 1; i < path.length; i++) {
    cumulativeDistances.push(cumulativeDistances[i - 1] + haversineMeters(path[i - 1], path[i]));
  }

  const maneuvers: Maneuver[] = [];
  let lastManeuverIdx = 0;
  for (let i = 1; i < path.length - 1; i++) {
    let j = i - 1;
    while (j > lastManeuverIdx && cumulativeDistances[i] - cumulativeDistances[j] < MIN_LEG_METERS) j--;
    let k = i + 1;
    while (k < path.length - 1 && cumulativeDistances[k] - cumulativeDistances[i] < MIN_LEG_METERS) k++;

    const inBearing = bearing(path[j], path[i]);
    const outBearing = bearing(path[i], path[k]);
    const delta = bearingDelta(inBearing, outBearing);

    if (Math.abs(delta) >= TURN_THRESHOLD_DEG) {
      maneuvers.push({ index: i, type: delta > 0 ? 'right' : 'left', cumulativeDistance: cumulativeDistances[i] });
      lastManeuverIdx = i;
    }
  }
  return { maneuvers, cumulativeDistances };
}

export function speakText(text: string) {
  if (typeof window === 'undefined' || !window.speechSynthesis) return;
  window.speechSynthesis.cancel();
  const utter = new SpeechSynthesisUtterance(text);
  utter.lang = 'uz-UZ';
  utter.rate = 1;
  window.speechSynthesis.speak(utter);
}

/** Turn-by-turn voice guidance that compares live position against a planned route. */
export class RouteGuide {
  private path: RoutePoint[];
  private maneuvers: Maneuver[];
  private cumulativeDistances: number[];
  private announcedFar = new Set<number>();
  private announcedNear = new Set<number>();
  private lastStraightAnnounceDist = 0;
  private started = false;
  private onAnnounce: (text: string) => void;

  constructor(path: RoutePoint[], onAnnounce: (text: string) => void) {
    this.path = path;
    const built = buildManeuvers(path);
    this.maneuvers = built.maneuvers;
    this.cumulativeDistances = built.cumulativeDistances;
    this.onAnnounce = onAnnounce;
  }

  private announce(text: string) {
    speakText(text);
    this.onAnnounce(text);
  }

  private nearestIndex(pos: RoutePoint): number {
    let best = 0;
    let bestDist = Infinity;
    for (let i = 0; i < this.path.length; i++) {
      const d = haversineMeters(pos, this.path[i]);
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    }
    return best;
  }

  update(pos: RoutePoint) {
    if (!this.started) {
      this.started = true;
      this.announce("Marshrut boshlandi. To'g'riga yuring.");
    }

    const idx = this.nearestIndex(pos);
    const distAlong = this.cumulativeDistances[idx];

    const upcoming = this.maneuvers.find((m) => m.cumulativeDistance >= distAlong - 10 && !this.announcedNear.has(m.index));

    if (upcoming) {
      const remaining = upcoming.cumulativeDistance - distAlong;
      const dirWord = upcoming.type === 'right' ? "o'ngga" : 'chapga';

      if (remaining <= FAR_WARNING_METERS && remaining > NEAR_WARNING_METERS && !this.announcedFar.has(upcoming.index)) {
        this.announcedFar.add(upcoming.index);
        const roundedDist = Math.max(50, Math.round(remaining / 50) * 50);
        this.announce(`${roundedDist} metrdan so'ng ${dirWord} buriling`);
      } else if (remaining <= NEAR_WARNING_METERS && !this.announcedNear.has(upcoming.index)) {
        this.announcedNear.add(upcoming.index);
        this.lastStraightAnnounceDist = distAlong;
        this.announce(`Hozir ${dirWord} buriling`);
      }
    } else if (distAlong - this.lastStraightAnnounceDist >= STRAIGHT_CALLOUT_INTERVAL_METERS) {
      this.lastStraightAnnounceDist = distAlong;
      this.announce("500 metr to'g'ri yuring");
    }
  }
}
