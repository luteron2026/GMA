// Paved surfaces as real geometry: streets, drives, parking lots, walkways, painted lines,
// crosswalks, stall lines and speed bumps. Each flat piece is clipped to the triangles of the
// LiDAR ground mesh, so it lies exactly on the ground with crisp edges (painting them into the
// ground texture made them blurry and jagged).
import * as THREE from 'three';
import { CAMPUS } from './data/campus.js';
import { CORE, terrainStride, heightAtCampus } from './terrain.js';
import { pointInPoly, distToPolyline } from './physics.js';
import { offsetLine } from './geo.js';
import { STREETS } from './data/streetscape.js';
import { paintCourts } from './sports.js';
import { TRACED_PAVING, TRACED_WALKS, OPEN_GROUND } from './data/walks.js';

export const PAVE = {
  street: '#3d4046',
  service: '#4a4d53',
  aisle: '#4f5258',
  lot: '#4f5258',
  driveway: '#5c5e62',
  walk: '#c8c2b4',
  plaza: '#cdc6b6',
};
const LINE = { white: '#efefea', yellow: '#f2c94c', red: '#c4342b' };

// Draw order (higher wins where surfaces overlap)
const LAYER = { walk: 1, plaza: 1, lot: 2, courtBase: 2.3, courtTop: 2.6, driveway: 3, aisle: 4, service: 5, street: 6, paint: 7 };
const DECAL = 8;

// ---------- draping ----------

const signedArea = (p) => {
  let a = 0;
  for (let i = 0; i < p.length; i++) { const q = p[(i + 1) % p.length]; a += p[i][0] * q[1] - q[0] * p[i][1]; }
  return a / 2;
};

// Keep the part of a polygon left of each edge of a counter-clockwise triangle
function clipToTri(poly, tri) {
  let out = poly;
  for (let e = 0; e < 3 && out.length; e++) {
    const [ax, ay] = tri[e], [bx, by] = tri[(e + 1) % 3];
    const side = (p) => (bx - ax) * (p[1] - ay) - (by - ay) * (p[0] - ax);
    const inp = out;
    out = [];
    for (let i = 0; i < inp.length; i++) {
      const p = inp[i], q = inp[(i + 1) % inp.length];
      const sp = side(p), sq = side(q);
      if (sp >= 0) out.push(p);
      if ((sp >= 0) !== (sq >= 0)) {
        const t = sp / (sp - sq);
        out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]);
      }
    }
  }
  return out;
}

// Collects draped triangles with per-vertex colors for one draw layer
export class Surface {
  constructor(lift = 0.03) { this.pos = []; this.col = []; this.uv = []; this.lift = lift; this.c = new THREE.Color(); }

  // A convex polygon (campus space) laid on the ground. uvFn maps (x, y) -> [u, v].
  convex(poly, color, uvFn = null) {
    if (poly.length < 3) return;
    if (signedArea(poly) < 0) poly = [...poly].reverse();
    const g = CORE, st = terrainStride(), step = g.step * st;
    const cx = (g.nx - 1) / st, cy = (g.ny - 1) / st;
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const [x, y] of poly) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    const i0 = Math.max(0, Math.floor((x0 - g.x0) / step)), i1 = Math.min(cx - 1, Math.floor((x1 - g.x0) / step));
    const j0 = Math.max(0, Math.floor((y0 - g.y0) / step)), j1 = Math.min(cy - 1, Math.floor((y1 - g.y0) / step));
    this.c.set(color);
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const ax = g.x0 + i * step, ay = g.y0 + j * step, bx = ax + step, by = ay + step;
        // The same split as the ground mesh: (a, b, d) and (a, d, c)
        for (const tri of [[[ax, ay], [bx, ay], [bx, by]], [[ax, ay], [bx, by], [ax, by]]]) {
          const piece = clipToTri(poly, tri);
          if (piece.length < 3) continue;
          for (let k = 1; k < piece.length - 1; k++) this.tri(piece[0], piece[k], piece[k + 1], uvFn);
        }
      }
    }
  }

  tri(a, b, c, uvFn) {
    // Skip slivers left over from clipping
    if (Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])) < 1e-6) return;
    for (const [x, y] of [a, b, c]) {
      this.pos.push(x, heightAtCampus(x, y) + this.lift, -y);
      this.col.push(this.c.r, this.c.g, this.c.b);
      if (uvFn) { const [u, v] = uvFn(x, y); this.uv.push(u, v); } else this.uv.push(x / 7, y / 7);
    }
  }

  // Any simple polygon (concave is fine, holes optional): triangulate, then drape each triangle
  polygon(pts, color, holes = []) {
    const v2 = pts.map(([x, y]) => new THREE.Vector2(x, y));
    if (THREE.ShapeUtils.isClockWise(v2)) v2.reverse();
    const h2 = holes.map((h) => {
      const v = h.map(([x, y]) => new THREE.Vector2(x, y));
      if (!THREE.ShapeUtils.isClockWise(v)) v.reverse();
      return v;
    });
    const all = v2.concat(...h2);
    for (const t of THREE.ShapeUtils.triangulateShape(v2, h2)) this.convex(t.map((k) => [all[k].x, all[k].y]), color);
  }

  // A band of width w along a polyline, cut into short pieces, with round joins at bends.
  // keep(x, y) can drop pieces (gaps at intersections); dash = [on, off] in meters.
  band(pts, w, color, { keep = null, dash = null, joins = true, piece = 3 } = {}) {
    let s = 0;
    for (let i = 0; i < pts.length - 1; i++) {
      const [ax, ay] = pts[i], [bx, by] = pts[i + 1];
      const L = Math.hypot(bx - ax, by - ay);
      if (L < 1e-4) continue;
      const tx = (bx - ax) / L, ty = (by - ay) / L, nx = -ty * w / 2, ny = tx * w / 2;
      const n = Math.max(1, Math.ceil(L / piece));
      for (let k = 0; k < n; k++) {
        let d0 = (L * k) / n, d1 = (L * (k + 1)) / n;
        if (dash) {
          // Trim the piece to the painted part of the dash pattern
          const per = dash[0] + dash[1], ph0 = (s + d0) % per;
          if (ph0 >= dash[0]) continue;
          d1 = Math.min(d1, d0 + dash[0] - ph0);
        }
        const p0 = [ax + tx * d0, ay + ty * d0], p1 = [ax + tx * d1, ay + ty * d1];
        if (keep && !keep((p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2)) continue;
        this.convex([[p0[0] - nx, p0[1] - ny], [p1[0] - nx, p1[1] - ny], [p1[0] + nx, p1[1] + ny], [p0[0] + nx, p0[1] + ny]], color);
      }
      s += L;
      if (joins && i > 0 && !dash && (!keep || keep(ax, ay))) {
        // Round join where the line bends (fills the wedge between two pieces)
        const [px, py] = pts[i - 1];
        const turn = Math.abs(Math.atan2((ax - px) * ty - (ay - py) * tx, (ax - px) * tx + (ay - py) * ty));
        if (turn > 0.02) this.disc(ax, ay, w / 2, color, w > 1.5 ? 16 : 8);
      }
    }
  }

  disc(x, y, r, color, n = 16) {
    const p = [];
    for (let k = 0; k < n; k++) p.push([x + Math.cos((k / n) * Math.PI * 2) * r, y + Math.sin((k / n) * Math.PI * 2) * r]);
    this.convex(p, color);
  }

  // Oriented rectangle: center, unit direction (tx, ty) of the long side, length, width
  rect(x, y, tx, ty, len, wid, color, uvFn) {
    const ax = tx * len / 2, ay = ty * len / 2, bx = -ty * wid / 2, by = tx * wid / 2;
    this.convex([[x - ax - bx, y - ay - by], [x + ax - bx, y + ay - by], [x + ax + bx, y + ay + by], [x - ax + bx, y - ay + by]], color, uvFn);
  }

  mesh(material) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    geo.computeVertexNormals();
    geo.computeBoundingSphere();
    const m = new THREE.Mesh(geo, material);
    m.receiveShadow = true;
    return m;
  }
}

function layerMaterial(layer, opts = {}) {
  return new THREE.MeshLambertMaterial({
    vertexColors: true, polygonOffset: true, polygonOffsetFactor: -layer, polygonOffsetUnits: -layer * 4, ...opts,
  });
}

// Fine asphalt / concrete grain (multiplied over the vertex colors)
let grainTex = null;
function grain() {
  if (grainTex) return grainTex;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(128, 128);
  let seed = 11;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 128 * 128; i++) {
    const v = 222 + rnd() * 33 - (rnd() < 0.04 ? 30 : 0);
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v; img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  grainTex = new THREE.CanvasTexture(c);
  grainTex.colorSpace = THREE.SRGBColorSpace;
  grainTex.wrapS = grainTex.wrapT = THREE.RepeatWrapping;
  grainTex.anisotropy = 8;
  return grainTex;
}

// ---------- parking stalls ----------

export const STALL_W = 2.75, STALL_L = 5.4;

// Corners of a stall [x, y, a] ((cos a, sin a) points from the stall out to its aisle)
export function stallCorners([x, y, a], shrink = 0) {
  const tx = Math.cos(a), ty = Math.sin(a), hl = STALL_L / 2 - shrink, hw = STALL_W / 2 - shrink;
  return [[x - tx * hl + ty * hw, y - ty * hl - tx * hw], [x + tx * hl + ty * hw, y + ty * hl - tx * hw],
    [x + tx * hl - ty * hw, y + ty * hl + tx * hw], [x - tx * hl - ty * hw, y - ty * hl + tx * hw]];
}

export function obbOverlap(p, q) {
  for (const poly of [p, q]) {
    for (let i = 0; i < poly.length; i++) {
      const [ax, ay] = poly[i], [bx, by] = poly[(i + 1) % poly.length];
      const nx = -(by - ay), ny = bx - ax;
      let pmin = Infinity, pmax = -Infinity, qmin = Infinity, qmax = -Infinity;
      for (const [x, y] of p) { const d = x * nx + y * ny; pmin = Math.min(pmin, d); pmax = Math.max(pmax, d); }
      for (const [x, y] of q) { const d = x * nx + y * ny; qmin = Math.min(qmin, d); qmax = Math.max(qmax, d); }
      if (pmax <= qmin || qmax <= pmin) return false;
    }
  }
  return true;
}

// The generated stalls overlap where aisles meet or bend, and some poke into drives or out of
// the lot. Keep only clean ones, and snap neighbors in a row to a shared spacing.
export function cleanStalls(stalls, buildings) {
  const drives = CAMPUS.roads.filter((r) => r.kind !== 'trail');
  const kept = [];
  for (const s of stalls) {
    const c = stallCorners(s, 0.12);
    if (!c.every(([x, y]) => CAMPUS.lots.some((l) => pointInPoly(x, y, l.poly)))) continue;
    // Clear of every drive surface (its own aisle runs past the open end)
    const tip = [[c[1][0] * 0.8 + c[0][0] * 0.2, c[1][1] * 0.8 + c[0][1] * 0.2], [c[2][0] * 0.8 + c[3][0] * 0.2, c[2][1] * 0.8 + c[3][1] * 0.2]];
    if ([c[0], c[3], ...tip, [s[0], s[1]]].some(([x, y]) => drives.some((r) => distToPolyline(x, y, r.pts) < r.width / 2 - 0.05))) continue;
    if (c.some(([x, y]) => buildings.some((b) => pointInPoly(x, y, b.poly)))) continue;
    if (kept.some((k) => Math.abs(k[0] - s[0]) < 7 && Math.abs(k[1] - s[1]) < 7 && obbOverlap(c, stallCorners(k, 0.12)))) continue;
    kept.push(s);
  }
  return kept;
}

// ---------- build ----------

export function buildSurfaces(world) {
  const scene = world.scene, plan = world.street;
  const roads = CAMPUS.roads.filter((r) => r.kind !== 'trail');
  const streets = roads.filter((r) => r.kind === 'street');
  const S = {};
  for (const k of Object.keys(LAYER)) S[k] = new Surface();

  // Pavement
  for (const lot of CAMPUS.lots) S.lot.polygon(lot.poly, PAVE.lot);
  for (const r of roads) {
    const layer = r.kind === 'path' ? 'walk' : r.kind;
    S[layer].band(r.pts, r.width, r.kind === 'path' ? PAVE.walk : PAVE[r.kind]);
    // Round off the ends of drives so they meet streets and lots cleanly
    if (r.kind !== 'street') for (const p of [r.pts[0], r.pts[r.pts.length - 1]]) S[layer].disc(p[0], p[1], r.width / 2, r.kind === 'path' ? PAVE.walk : PAVE[r.kind]);
  }
  for (const w of world.walkways || []) S.walk.band(w.pts, w.width, PAVE.walk);
  // The real walks and plazas traced from the aerial photo
  for (const t of TRACED_PAVING) S.walk.polygon(t.poly, PAVE.walk, t.holes || []);
  for (const t of TRACED_WALKS) S.walk.band(t.pts, t.width, PAVE.walk);
  for (const p of world.plazas || []) S.plaza.polygon(p, PAVE.plaza);
  // Courtyards, and fountain plazas with a darker border ring
  for (const c of world.site.courts) S.plaza.polygon(c.poly, '#cbc3b3');
  for (const f of world.site.fountains) { S.lot.disc(f.x, f.y, f.plaza + 0.4, '#a79f8f', 40); S.plaza.disc(f.x, f.y, f.plaza, '#d3cbbb', 40); }

  // Center and edge lines, with gaps where other streets cross
  const crossing = (r, m) => (x, y) => !streets.some((o) => o !== r && o.name !== r.name && distToPolyline(x, y, o.pts) < o.width / 2 + m);
  const mouth = (r) => (x, y) => !roads.some((o) => o !== r && o.kind !== 'path' && o.name !== r.name && distToPolyline(x, y, o.pts) < o.width / 2 + 0.8);
  for (const r of streets) {
    const st = STREETS[r.name];
    if (!st) continue;
    const keep = crossing(r, 1.5);
    if (st.center === 'double') for (const o of [-0.17, 0.17]) S.paint.band(offsetLine(r.pts, o), 0.12, LINE.yellow, { keep, piece: 2 });
    else if (st.center === 'dashed') S.paint.band(r.pts, 0.14, LINE.yellow, { keep, dash: [3, 5] });
    if (st.edge) for (const o of [-1, 1]) S.paint.band(offsetLine(r.pts, o * (r.width / 2 - 0.5)), 0.14, LINE.white, { keep: mouth(r), piece: 2 });
  }
  for (const c of plan.redCurbs) S.paint.band(c, 0.35, LINE.red);
  for (const c of plan.crosswalks) {
    for (let k = -c.w / 2 + 0.8; k <= c.w / 2 - 0.8; k += 1.25) S.paint.rect(c.x - c.ty * k, c.y + c.tx * k, c.tx, c.ty, 3, 0.6, LINE.white);
  }
  for (const m of plan.markings) {
    // (hx, hy) is the way drivers read it; right of that is (hy, -hx)
    if (m.text === 'STOP') S.paint.rect(m.x + m.hx * 3.95, m.y + m.hy * 3.95, m.hy, -m.hx, 3.4, 0.45, LINE.white);
  }

  // Pickleball and volleyball courts
  if (world.courts) paintCourts(S, world.courts);

  // Helipad beside the Reese Center lot: a concrete pad with an asphalt edge, and a yellow
  // ring around a white H
  if (world.places.helipad) {
    const [hx, hz, ha] = world.places.helipad;
    const x = hx, y = -hz, ring = [];
    S.lot.disc(x, y, 7.7, '#55575c', 48);
    S.courtBase.disc(x, y, 7.2, '#b8b2a4', 48);
    for (let k = 0; k <= 48; k++) ring.push([x + Math.cos((k / 48) * Math.PI * 2) * 6.2, y + Math.sin((k / 48) * Math.PI * 2) * 6.2]);
    S.paint.band(ring, 0.45, LINE.yellow);
    // The H lines up with the chopper: its bars run along the nose direction (sin a, -cos a)
    const tx = Math.sin(ha), ty = -Math.cos(ha);
    for (const o of [-1.3, 1.3]) S.paint.rect(x - ty * o, y + tx * o, tx, ty, 4.2, 0.6, LINE.white);
    S.paint.rect(x, y, -ty, tx, 2.6, 0.6, LINE.white);
  }

  // Stall lines: one line between neighbors (stalls share them) plus a short end at the aisle
  const lines = [];
  const pad = world.places.helipad;
  for (const s of world.data.stalls) {
    if (pad && Math.hypot(s[0] - pad[0], s[1] + pad[1]) < 8.5) continue; // the helipad paints over these
    const tx = Math.cos(s[2]), ty = Math.sin(s[2]);
    for (const side of [-1, 1]) {
      const x = s[0] - ty * side * STALL_W / 2, y = s[1] + tx * side * STALL_W / 2;
      if (lines.some((l) => Math.hypot(l[0] - x, l[1] - y) < 0.6)) continue;
      lines.push([x, y, tx, ty]);
    }
  }
  for (const [x, y, tx, ty] of lines) S.paint.rect(x - tx * 0.1, y - ty * 0.1, tx, ty, STALL_L - 0.4, 0.12, LINE.white);

  const tex = grain();
  for (const [k, layer] of Object.entries(LAYER)) {
    const s = S[k];
    if (!s.pos.length) continue;
    const paved = k !== 'paint';
    scene.add(s.mesh(layerMaterial(layer, paved ? { map: tex } : {})));
  }
  // Painted words: one textured quad each
  for (const m of plan.markings) {
    const d = new Surface(0.035);
    const w = 3.2, h = 3;
    d.rect(m.x, m.y, m.hy, -m.hx, w, h, '#ffffff', (x, y) => {
      const dx = x - m.x, dy = y - m.y;
      return [(dx * m.hy - dy * m.hx) / w + 0.5, (dx * m.hx + dy * m.hy) / h + 0.5];
    });
    scene.add(d.mesh(layerMaterial(DECAL, { map: wordTexture(m.text), transparent: true, alphaTest: 0.4, vertexColors: false })));
  }

  buildBumps(world);
}

const wordCache = new Map();
function wordTexture(text) {
  if (wordCache.has(text)) return wordCache.get(text);
  const c = document.createElement('canvas');
  c.width = 256; c.height = 256;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#f4f4f0'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.font = 'bold 76px Arial, sans-serif';
  ctx.save(); ctx.translate(128, 128); ctx.scale(1, 2.6); ctx.fillText(text, 0, 2, 240); ctx.restore();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  wordCache.set(text, tex);
  return tex;
}

// Speed bumps: a rounded hump across the road, black with yellow stripes, following the
// ground under it. Its profile matches bumpHeight() in streetscape.js.
export const BUMP = { depth: 0.6, h: 0.12 };
function buildBumps(world) {
  const pos = [], col = [];
  const black = new THREE.Color('#2e3034'), yellow = new THREE.Color(LINE.yellow);
  const prof = (u) => BUMP.h * Math.max(0, 1 - (u / BUMP.depth) ** 2);
  for (const b of world.street.bumps) {
    const ax = -b.ty, ay = b.tx; // across the road
    // Alternating black and yellow strips across the road
    const cuts = [];
    for (let v = -b.half; v < b.half - 1e-3;) {
      const yel = cuts.length % 2 === 1;
      const nv = Math.min(b.half, v + (yel ? 0.6 : 1.0));
      cuts.push([v, nv, yel]);
      v = nv;
    }
    const at = (u, v) => {
      const x = b.x + b.tx * u + ax * v, y = b.y + b.ty * u + ay * v;
      return [x, heightAtCampus(x, y) + 0.02 + prof(u), -y];
    };
    const N = 8;
    for (const [v0, v1, yel] of cuts) {
      const c = yel ? yellow : black;
      for (let i = 0; i < N; i++) {
        const u0 = -BUMP.depth + (2 * BUMP.depth * i) / N, u1 = -BUMP.depth + (2 * BUMP.depth * (i + 1)) / N;
        const p = [at(u0, v0), at(u1, v0), at(u1, v1), at(u0, v1)];
        // Two triangles, wound to face up
        for (const k of [0, 2, 1, 0, 3, 2]) { pos.push(...p[k]); col.push(c.r, c.g, c.b); }
      }
      // End caps so the hump has no open sides at the curb
      for (const v of [v0, v1]) {
        if (v !== -b.half && v !== b.half) continue;
        for (let i = 0; i < N; i++) {
          const u0 = -BUMP.depth + (2 * BUMP.depth * i) / N, u1 = -BUMP.depth + (2 * BUMP.depth * (i + 1)) / N;
          const t0 = at(u0, v), t1 = at(u1, v);
          const g0 = [t0[0], t0[1] - prof(u0) - 0.02, t0[2]], g1 = [t1[0], t1[1] - prof(u1) - 0.02, t1[2]];
          for (const q of [t0, t1, g1, t0, g1, g0]) { pos.push(...q); col.push(black.r, black.g, black.b); }
        }
      }
    }
  }
  if (!pos.length) return;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.computeVertexNormals();
  const m = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -8, polygonOffsetUnits: -32 }));
  m.receiveShadow = true;
  world.scene.add(m);
}

// ---------- walkways ----------

// Is a campus point on pavement (streets, drives, lots, walkways, plazas)? margin widens it.
export function makePavedTest(world) {
  const items = [];
  const box = (pts, m) => {
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const [x, y] of pts) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    return { x0: x0 - m, x1: x1 + m, y0: y0 - m, y1: y1 + m };
  };
  for (const r of CAMPUS.roads) if (r.kind !== 'trail') items.push({ line: r.pts, half: r.width / 2, ...box(r.pts, r.width / 2 + 8) });
  for (const w of world.walkways || []) items.push({ line: w.pts, half: w.width / 2, ...box(w.pts, w.width / 2 + 8) });
  for (const l of CAMPUS.lots) items.push({ poly: l.poly, ...box(l.poly, 8) });
  for (const p of world.plazas || []) items.push({ poly: p, ...box(p, 8) });
  for (const t of TRACED_PAVING) items.push({ poly: t.poly, ...box(t.poly, 8) });
  for (const t of TRACED_WALKS) items.push({ line: t.pts, half: t.width / 2, ...box(t.pts, t.width / 2 + 8) });
  return (x, y, m = 0) => {
    for (const it of items) {
      if (x < it.x0 - m || x > it.x1 + m || y < it.y0 - m || y > it.y1 + m) continue;
      if (it.line) { if (distToPolyline(x, y, it.line) < it.half + m) return true; }
      else if (pointInPoly(x, y, it.poly)) return true;
      else if (m > 0 && distToPolyline(x, y, it.poly, true) < m) return true;
    }
    return false;
  };
}

// Concrete walks: a pad and a walk from every entrance to the nearest drive, lot or real walk
// (the real walks and plazas come from the aerial photo, data/walks.js).
export function planWalkways(world, doorEdge) {
  const walks = [], pads = [];
  const buildings = world.buildings;
  const bbox = buildings.map((b) => {
    const xs = b.poly.map((p) => p[0]), ys = b.poly.map((p) => p[1]);
    return [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  });
  const decks = world.site.pools.map((p) => p.deck);
  for (const b of [world.courts?.block, world.courts?.sandBlock]) if (b) decks.push(b.outline);
  const inBuilding = (x, y, m = 0.6) => decks.some((d) => pointInPoly(x, y, d)) || buildings.some((b, i) => {
    const [x0, x1, y0, y1] = bbox[i];
    if (x < x0 - m || x > x1 + m || y < y0 - m || y > y1 + m) return false;
    return pointInPoly(x, y, b.poly) || distToPolyline(x, y, b.poly, true) < m;
  });
  const inCampus = (x, y) => CAMPUS.campus.some((p) => pointInPoly(x, y, p));
  const drives = CAMPUS.roads.filter((r) => r.kind !== 'trail' && r.kind !== 'path');
  const streets = drives.filter((r) => r.kind === 'street');
  const onDrive = (x, y, m = 0) => drives.some((r) => distToPolyline(x, y, r.pts) < r.width / 2 + m);
  const inLot = (x, y) => CAMPUS.lots.some((l) => pointInPoly(x, y, l.poly));
  const samples = (a, b, step = 1) => {
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.max(1, Math.ceil(L / step)), out = [];
    for (let k = 0; k <= n; k++) out.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]);
    return out;
  };

  // Shortest clear walk from an entrance (start, then s just outside it) to a drive or lot
  const connect = (start, s) => {
    const cands = [];
    for (const r of drives) {
      // nearest point on the road edge
      let best = null;
      for (let i = 0; i < r.pts.length - 1; i++) {
        const [ax, ay] = r.pts[i], [bx, by] = r.pts[i + 1];
        const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy || 1e-9;
        const t = Math.max(0, Math.min(1, ((s[0] - ax) * dx + (s[1] - ay) * dy) / L2));
        const px = ax + dx * t, py = ay + dy * t, d = Math.hypot(s[0] - px, s[1] - py);
        if (!best || d < best.d) best = { d, px, py };
      }
      if (best.d < r.width / 2) continue;
      const k = (r.width / 2 - 0.4) / best.d;
      cands.push([best.d - r.width / 2, [best.px + (s[0] - best.px) * k, best.py + (s[1] - best.py) * k]]);
    }
    for (const l of CAMPUS.lots) {
      if (pointInPoly(s[0], s[1], l.poly)) continue;
      for (let i = 0; i < l.poly.length; i++) {
        const a = l.poly[i], c = l.poly[(i + 1) % l.poly.length];
        const dx = c[0] - a[0], dy = c[1] - a[1], L2 = dx * dx + dy * dy || 1e-9;
        const t = Math.max(0, Math.min(1, ((s[0] - a[0]) * dx + (s[1] - a[1]) * dy) / L2));
        const p = [a[0] + dx * t, a[1] + dy * t];
        cands.push([Math.hypot(s[0] - p[0], s[1] - p[1]), p]);
      }
    }
    // ...or the nearest real walk or plaza from the aerial photo
    const nearestOn = (line, closed) => {
      let bd = Infinity, bp = null;
      for (let i = 0; i < line.length - (closed ? 0 : 1); i++) {
        const a = line[i], c = line[(i + 1) % line.length];
        const dx = c[0] - a[0], dy = c[1] - a[1], L2 = dx * dx + dy * dy || 1e-9;
        const t = Math.max(0, Math.min(1, ((s[0] - a[0]) * dx + (s[1] - a[1]) * dy) / L2));
        const p = [a[0] + dx * t, a[1] + dy * t], d = Math.hypot(s[0] - p[0], s[1] - p[1]);
        if (d < bd) { bd = d; bp = p; }
      }
      return [bd, bp];
    };
    for (const t of TRACED_PAVING) { const [d, p] = nearestOn(t.poly, true); if (d < 70) cands.push([d, p]); }
    for (const t of TRACED_WALKS) { const [d, p] = nearestOn(t.pts, false); if (d < 70) cands.push([Math.max(0, d - t.width / 2), p]); }
    cands.sort((p, q) => p[0] - q[0]);
    for (const [d, p] of cands.slice(0, 12)) {
      if (d > 70) break;
      const pts = samples(s, p);
      if (pts.slice(1, -1).some(([x, y]) => inBuilding(x, y, 0.8))) continue;
      walks.push({ pts: [start, s, p], width: 2.4 });
      break;
    }
  };

  // 1. Entrances: a pad at the door, then the shortest clear walk to pavement
  const doors = [];
  for (const b of buildings) {
    if (!b.name) continue;
    const e = doorEdge(b);
    if (!e) continue;
    const { mx, my, nx, ny, tx, ty } = e;
    const pw = Math.min(8, e.len - 0.5);
    const cx = mx + nx * 1.6, cy = my + ny * 1.6;
    pads.push([[cx - tx * pw / 2 - nx * 1.6, cy - ty * pw / 2 - ny * 1.6], [cx + tx * pw / 2 - nx * 1.6, cy + ty * pw / 2 - ny * 1.6],
      [cx + tx * pw / 2 + nx * 1.6, cy + ty * pw / 2 + ny * 1.6], [cx - tx * pw / 2 + nx * 1.6, cy - ty * pw / 2 + ny * 1.6]]);
    const s = [mx + nx * 3, my + ny * 3];
    doors.push({ b, s });
    connect([mx + nx * 0.5, my + ny * 0.5], s);
  }
  // The pickleball court gate gets a walk too
  if (world.courts?.block) {
    const bl = world.courts.block, g = bl.gatePoint;
    const dx = g[0] - bl.cx, dy = g[1] - bl.cy, L = Math.hypot(dx, dy);
    connect(g, [g[0] + (dx / L) * 2, g[1] + (dy / L) * 2]);
  }

  // 2. Sidewalks along campus drives, wherever there's room
  for (const r of drives) {
    if (r.kind !== 'service') continue;
    for (const side of [-1, 1]) {
      const off = offsetLine(r.pts, side * (r.width / 2 + 1.3));
      const run = [];
      const flush = () => {
        let L = 0;
        for (let i = 1; i < run.length; i++) L += Math.hypot(run[i][0] - run[i - 1][0], run[i][1] - run[i - 1][1]);
        if (L > 10) walks.push({ pts: [...run], width: 1.8, guess: true });
        run.length = 0;
      };
      for (let i = 0; i < off.length - 1; i++) {
        for (const [x, y] of samples(off[i], off[i + 1], 2).slice(i ? 1 : 0)) {
          const ok = inCampus(x, y) && !inBuilding(x, y, 1.2) && !inLot(x, y) &&
            !drives.some((o) => o !== r && distToPolyline(x, y, o.pts) < o.width / 2 + 0.9);
          if (ok) run.push([x, y]); else flush();
        }
      }
      flush();
    }
  }

  // 3. Walks linking nearby entrances (a spanning tree over the doors)
  const edges = [];
  for (let i = 0; i < doors.length; i++) {
    for (let j = i + 1; j < doors.length; j++) {
      const a = doors[i].s, c = doors[j].s, d = Math.hypot(a[0] - c[0], a[1] - c[1]);
      if (d > 120 || d < 6) continue;
      const pts = samples(a, c, 1.5);
      if (pts.some(([x, y]) => inBuilding(x, y, 1) || inLot(x, y))) continue;
      if (pts.some(([x, y]) => streets.some((r) => distToPolyline(x, y, r.pts) < r.width / 2 + 1))) continue;
      if (pts.filter(([x, y]) => onDrive(x, y)).length > pts.length * 0.25) continue;
      edges.push([d, i, j]);
    }
  }
  edges.sort((p, q) => p[0] - q[0]);
  const parent = doors.map((_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (const [, i, j] of edges) {
    const a = find(i), c = find(j);
    if (a === c) continue;
    parent[a] = c;
    walks.push({ pts: [doors[i].s, doors[j].s], width: 2.4, guess: true });
  }
  // The sidewalks along drives and the walks between entrances were guesses; the aerial photo
  // now gives the real ones (TRACED_PAVING / TRACED_WALKS), so only each door's own short walk
  // stays, cut back where the photo shows open ground
  return { walks: pruneWalks(walks.filter((w) => !w.guess)), pads };
}

// Open lawn and bare ground in the aerial photo, as a 1 m grid (decoded once)
let openGrid = null;
export function openGroundAt(x, y) {
  const g = OPEN_GROUND;
  if (!openGrid) {
    openGrid = new Uint8Array(g.w * g.h);
    g.rle.split('|').forEach((row, r) => {
      let c = 0, v = 0;
      for (const n of row.split('.')) {
        const len = parseInt(n, 36);
        if (v) openGrid.fill(1, r * g.w + c, r * g.w + c + len);
        c += len; v = 1 - v;
      }
    });
  }
  const c = Math.floor(x - g.x0), r = Math.floor(g.y1 - y);
  return c >= 0 && r >= 0 && c < g.w && r < g.h && openGrid[r * g.w + c] === 1;
}

// The planned walks are a guess at where paths run. Cut them wherever the aerial photo shows
// open lawn or dirt under the walk's whole width for more than a few meters (under trees the
// photo can't tell, so those parts stay), and drop the leftover stubs.
function pruneWalks(walks) {
  const out = [];
  for (const w of walks) {
    const pts = w.pts, keep = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const [ax, ay] = pts[i], [bx, by] = pts[i + 1];
      const L = Math.hypot(bx - ax, by - ay), n = Math.max(1, Math.ceil(L / 0.5));
      const nx = -(by - ay) / (L || 1), ny = (bx - ax) / (L || 1), o = w.width * 0.35;
      for (let k = 0; k <= n; k++) {
        if (k === 0 && i > 0) continue;
        const x = ax + ((bx - ax) * k) / n, y = ay + ((by - ay) * k) / n;
        const open = openGroundAt(x, y) && openGroundAt(x + nx * o, y + ny * o) && openGroundAt(x - nx * o, y - ny * o);
        keep.push([x, y, open]);
      }
    }
    // A run of open ground longer than 3 m ends one piece of the walk; shorter ones are kept
    const finish = (run) => {
      if (run.length < 2 || Math.hypot(run[0][0] - run[run.length - 1][0], run[0][1] - run[run.length - 1][1]) <= 2.5) return;
      // (back to a point every 2 m; the walks are straight between their original corners)
      out.push({ ...w, pts: run.filter((_, k) => k % 4 === 0 || k === run.length - 1).map(([x, y]) => [x, y]) });
    };
    let cur = [], pend = [];
    for (const p of keep) {
      if (p[2]) { pend.push(p); continue; }
      if (pend.length * 0.5 <= 3) cur.push(...pend);
      else { finish(cur); cur = []; }
      pend = [];
      cur.push(p);
    }
    if (pend.length * 0.5 <= 3) cur.push(...pend);
    finish(cur);
  }
  return out;
}
