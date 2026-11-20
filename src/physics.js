// Lightweight 2D collision on the ground plane (x, z).

const CELL = 24;

export class Colliders {
  constructor() {
    this.items = [];
    this.grid = new Map();
  }

  key(cx, cz) {
    return cx * 73856093 ^ cz * 19349663;
  }

  insert(item) {
    this.items.push(item);
    const x0 = Math.floor(item.minX / CELL), x1 = Math.floor(item.maxX / CELL);
    const z0 = Math.floor(item.minZ / CELL), z1 = Math.floor(item.maxZ / CELL);
    for (let cx = x0; cx <= x1; cx++) {
      for (let cz = z0; cz <= z1; cz++) {
        const k = this.key(cx, cz);
        let cell = this.grid.get(k);
        if (!cell) this.grid.set(k, (cell = []));
        cell.push(item);
      }
    }
  }

  // pts: array of [x, z] in world space
  addPoly(pts, tag) {
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const [x, z] of pts) {
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
    }
    this.insert({ type: 'poly', pts, minX, maxX, minZ, maxZ, tag });
  }

  addCircle(x, z, r, tag) {
    this.insert({ type: 'circle', x, z, r, minX: x - r, maxX: x + r, minZ: z - r, maxZ: z + r, tag });
  }

  nearby(x, z, r, out) {
    out.length = 0;
    const x0 = Math.floor((x - r) / CELL), x1 = Math.floor((x + r) / CELL);
    const z0 = Math.floor((z - r) / CELL), z1 = Math.floor((z + r) / CELL);
    const stamp = ++this._stamp || (this._stamp = 1);
    for (let cx = x0; cx <= x1; cx++) {
      for (let cz = z0; cz <= z1; cz++) {
        const cell = this.grid.get(this.key(cx, cz));
        if (!cell) continue;
        for (const it of cell) {
          if (it._s === stamp) continue;
          it._s = stamp;
          if (it.maxX < x - r || it.minX > x + r || it.maxZ < z - r || it.minZ > z + r) continue;
          out.push(it);
        }
      }
    }
    return out;
  }

  // Push a circle out of all colliders. Returns {x, z, hit, nx, nz}.
  resolve(x, z, r) {
    const res = { x, z, hit: false, nx: 0, nz: 0 };
    const list = this.nearby(x, z, r + 1, this._tmp || (this._tmp = []));
    for (let pass = 0; pass < 2; pass++) {
      for (const it of list) {
        if (it.type === 'circle') {
          const dx = res.x - it.x, dz = res.z - it.z;
          const d = Math.hypot(dx, dz), min = r + it.r;
          if (d < min) {
            const nx = d > 1e-6 ? dx / d : 1, nz = d > 1e-6 ? dz / d : 0;
            res.x = it.x + nx * min; res.z = it.z + nz * min;
            res.hit = true; res.nx = nx; res.nz = nz;
          }
        } else {
          pushOutOfPoly(res, it.pts, r);
        }
      }
    }
    return res;
  }

  // True if a segment from a to b crosses any collider (coarse, for line of sight / projectiles)
  pointBlocked(x, z, r = 0) {
    const list = this.nearby(x, z, r + 0.5, this._tmp2 || (this._tmp2 = []));
    for (const it of list) {
      if (it.type === 'circle') {
        if (Math.hypot(x - it.x, z - it.z) < it.r + r) return true;
      } else if (pointInPoly(x, z, it.pts)) return true;
    }
    return false;
  }
}

export function pointInPoly(x, z, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, zi] = pts[i], [xj, zj] = pts[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

function closestOnSeg(px, pz, ax, az, bx, bz) {
  const abx = bx - ax, abz = bz - az;
  const len2 = abx * abx + abz * abz;
  let t = len2 > 0 ? ((px - ax) * abx + (pz - az) * abz) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  return [ax + abx * t, az + abz * t];
}

export function distToPolyEdge(x, z, pts) {
  let best = Infinity, bx = 0, bz = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [cx, cz] = closestOnSeg(x, z, pts[j][0], pts[j][1], pts[i][0], pts[i][1]);
    const d = Math.hypot(x - cx, z - cz);
    if (d < best) { best = d; bx = cx; bz = cz; }
  }
  return { d: best, x: bx, z: bz };
}

function pushOutOfPoly(res, pts, r) {
  const inside = pointInPoly(res.x, res.z, pts);
  const e = distToPolyEdge(res.x, res.z, pts);
  if (!inside && e.d >= r) return;
  let nx = res.x - e.x, nz = res.z - e.z;
  let len = Math.hypot(nx, nz);
  if (len < 1e-6) { nx = 1; nz = 0; len = 1; }
  nx /= len; nz /= len;
  if (inside) { nx = -nx; nz = -nz; }
  res.x = e.x + nx * r;
  res.z = e.z + nz * r;
  res.hit = true; res.nx = nx; res.nz = nz;
}

export function distToPolyline(x, z, pts, loop = false) {
  let best = Infinity;
  const n = pts.length;
  const segs = loop ? n : n - 1;
  for (let i = 0; i < segs; i++) {
    const a = pts[i], b = pts[(i + 1) % n];
    const [cx, cz] = closestOnSeg(x, z, a[0], a[1], b[0], b[1]);
    best = Math.min(best, Math.hypot(x - cx, z - cz));
  }
  return best;
}

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export function angleDiff(a, b) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

// Small deterministic RNG so the campus looks the same every load
export function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
