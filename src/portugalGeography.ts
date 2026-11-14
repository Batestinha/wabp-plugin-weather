import boundaries from './data/portugal-boundaries.json';

export type PortugueseTideRegion = 'mainland' | 'madeira' | 'azores';
type Point = readonly number[];
type Polygon = readonly (readonly Point[])[];

/** Geographic coverage, independent of a caller's label, timezone or geocoder provider. */
export function portugueseTideLocation(latitude: number, longitude: number): {
  region: PortugueseTideRegion;
  coastal: boolean;
} | undefined {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) ||
    latitude < 29 || latitude > 43 || longitude < -32 || longitude > -6) return undefined;
  const point = [longitude, latitude];
  // Small-scale coastlines and port/gauge coordinates can differ by a few hundred metres.
  // The 2 km coastal margin never crosses onto Spanish land; land borders are not coast.
  if (boundaries.spainNearBorder.some((polygon) => insidePolygon(point, polygon))) return undefined;
  const coastDistance = coastDistanceKm(point);
  const onLand = boundaries.portugal.some((polygon) => insidePolygon(point, polygon));
  if (!onLand && coastDistance > 2) return undefined;
  return {
    region: portugueseRegion(latitude, longitude),
    coastal: coastDistance <= 35
  };
}

/** Only called for known Portuguese locations and published Portuguese tide stations. */
export function portugueseRegion(latitude: number, longitude: number): PortugueseTideRegion {
  return longitude < -20 ? 'azores' : latitude < 35 ? 'madeira' : 'mainland';
}

function insidePolygon(point: Point, polygon: Polygon): boolean {
  return Boolean(polygon[0] && insideRing(point, polygon[0])) &&
    !polygon.slice(1).some((ring) => insideRing(point, ring));
}

function insideRing(point: Point, ring: readonly Point[]): boolean {
  const [x, y] = point as readonly [number, number];
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]!; const b = ring[j]!;
    if ((a[1]! > y) !== (b[1]! > y) &&
      x < (b[0]! - a[0]!) * (y - a[1]!) / (b[1]! - a[1]!) + a[0]!) inside = !inside;
  }
  return inside;
}

function coastDistanceKm(point: Point): number {
  const longitudeKm = 111.195 * Math.cos(point[1]! * Math.PI / 180);
  let best = Number.POSITIVE_INFINITY;
  for (const line of boundaries.coast) {
    for (let i = 1; i < line.length; i += 1) {
      const a = line[i - 1]!; const b = line[i]!;
      const ax = (a[0]! - point[0]!) * longitudeKm;
      const ay = (a[1]! - point[1]!) * 111.195;
      const dx = (b[0]! - a[0]!) * longitudeKm;
      const dy = (b[1]! - a[1]!) * 111.195;
      const lengthSquared = dx * dx + dy * dy;
      const fraction = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / lengthSquared));
      best = Math.min(best, Math.hypot(ax + fraction * dx, ay + fraction * dy));
    }
  }
  return best;
}
