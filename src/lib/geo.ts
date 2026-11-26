export interface GeoPoint {
  lat: number;
  lng: number;
  accuracy?: number;
}

const EARTH_RADIUS_METERS = 6_371_000;

function toRadians(deg: number): number {
  return (deg * Math.PI) / 180;
}

export function haversineDistanceMeters(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const dLat = toRadians(lat2 - lat1);
  const dLng = toRadians(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(lat1)) *
      Math.cos(toRadians(lat2)) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_METERS * c;
}

export function formatDistanceFr(meters: number): string {
  if (!Number.isFinite(meters) || meters < 0) return 'Distance inconnue';
  if (meters < 1000) {
    return `${Math.max(1, Math.round(meters))} m`;
  }
  const km = meters / 1000;
  if (km < 10) {
    return `${km.toFixed(1).replace('.', ',')} km`;
  }
  return `${Math.round(km)} km`;
}

export function formatRelativeAgeFr(updatedAtMs: number, nowMs: number): string {
  const diffSec = Math.max(0, Math.floor((nowMs - updatedAtMs) / 1000));
  if (diffSec < 15) return "à l'instant";
  if (diffSec < 60) return `il y a ${diffSec} s`;
  const mins = Math.floor(diffSec / 60);
  if (mins < 60) return `il y a ${mins} min`;
  const hours = Math.floor(mins / 60);
  return `il y a ${hours} h`;
}
