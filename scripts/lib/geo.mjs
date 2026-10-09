import { createHash } from "node:crypto";

export const COORD_DECIMALS = 5;

function roundCoord(value, decimals) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function mapRings(geometry, fn) {
  if (geometry.type === "Polygon") {
    return { ...geometry, coordinates: geometry.coordinates.map(fn) };
  }
  if (geometry.type === "MultiPolygon") {
    return {
      ...geometry,
      coordinates: geometry.coordinates.map((polygon) => polygon.map(fn)),
    };
  }
  return geometry;
}

export function roundGeometry(geometry, decimals = COORD_DECIMALS) {
  if (!geometry) {
    return geometry;
  }
  return mapRings(geometry, (ring) =>
    ring.map(([lng, lat, ...rest]) => {
      const rounded = [roundCoord(lng, decimals), roundCoord(lat, decimals)];
      return rest.length ? [...rounded, ...rest] : rounded;
    }),
  );
}

export function* positions(geometry) {
  if (!geometry) {
    return;
  }
  const polygons =
    geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
  for (const polygon of polygons || []) {
    for (const ring of polygon) {
      for (const position of ring) {
        yield position;
      }
    }
  }
}

export function computeBbox(geometry) {
  let minLng = Infinity;
  let minLat = Infinity;
  let maxLng = -Infinity;
  let maxLat = -Infinity;
  for (const [lng, lat] of positions(geometry)) {
    if (lng < minLng) minLng = lng;
    if (lat < minLat) minLat = lat;
    if (lng > maxLng) maxLng = lng;
    if (lat > maxLat) maxLat = lat;
  }
  return [minLng, minLat, maxLng, maxLat];
}

export function mergeBboxes(bboxes) {
  let minLng = Infinity;
  let minLat = Infinity;
  let maxLng = -Infinity;
  let maxLat = -Infinity;
  for (const bbox of bboxes) {
    if (bbox[0] < minLng) minLng = bbox[0];
    if (bbox[1] < minLat) minLat = bbox[1];
    if (bbox[2] > maxLng) maxLng = bbox[2];
    if (bbox[3] > maxLat) maxLat = bbox[3];
  }
  return [minLng, minLat, maxLng, maxLat];
}

export function bboxContains(outer, inner, tolerance = 0) {
  return (
    inner[0] >= outer[0] - tolerance &&
    inner[1] >= outer[1] - tolerance &&
    inner[2] <= outer[2] + tolerance &&
    inner[3] <= outer[3] + tolerance
  );
}

export function bboxesIntersect(a, b) {
  return a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3];
}

export function sha256(text) {
  return createHash("sha256").update(text).digest("hex");
}
