// Small geometry helpers in campus space (meters; x east, y north)
import { CAMPUS } from './data/campus.js';

const [LAT0, LON0] = CAMPUS.origin;
const KX = 111320 * Math.cos((LAT0 * Math.PI) / 180), KY = 110574; // same as tools/osm_to_campus.py

// [lat, lon] -> [x, y] campus meters
export const toCampus = ([lat, lon]) => [(lon - LON0) * KX, (lat - LAT0) * KY];

export const COMPASS = { N: [0, 1], S: [0, -1], E: [1, 0], W: [-1, 0] };

export function pathLength(pts) {
  let L = 0;
  for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  return L;
}

// Nearest point on a polyline: distance d, point (px, py), unit tangent (tx, ty), arc length s,
// and side (+1 left of the direction of travel, -1 right)
export function project(pts, x, y) {
  let best = { d: Infinity }, s = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, ay] = pts[i], [bx, by] = pts[i + 1];
    const dx = bx - ax, dy = by - ay, L = Math.hypot(dx, dy) || 1e-9;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (L * L)));
    const px = ax + dx * t, py = ay + dy * t, d = Math.hypot(x - px, y - py);
    if (d < best.d) best = { d, px, py, tx: dx / L, ty: dy / L, s: s + t * L };
    s += L;
  }
  best.side = Math.sign(best.tx * (y - best.py) - best.ty * (x - best.px)) || 1;
  return best;
}

// Point and unit tangent at arc length s along a polyline
export function pointAt(pts, s) {
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, ay] = pts[i], [bx, by] = pts[i + 1];
    const L = Math.hypot(bx - ax, by - ay) || 1e-9;
    if (s <= L || i === pts.length - 2) {
      const t = Math.max(0, Math.min(1, s / L));
      return { x: ax + (bx - ax) * t, y: ay + (by - ay) * t, tx: (bx - ax) / L, ty: (by - ay) / L };
    }
    s -= L;
  }
  return { x: pts[0][0], y: pts[0][1], tx: 1, ty: 0 };
}

// Polyline shifted sideways (positive = left of the direction of travel)
export function offsetLine(pts, off) {
  const n = pts.length;
  return pts.map((p, i) => {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    return [p[0] - ((b[1] - a[1]) / L) * off, p[1] + ((b[0] - a[0]) / L) * off];
  });
}
