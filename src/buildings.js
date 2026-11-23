// Building looks (colors, windows, materials) and details (porches, piers, towers, signs...),
// from the Street View notes in data/looks.js. Shapes and roof heights come from the LiDAR.
import * as THREE from 'three';
import { mat, GEOM } from './models.js';
import { pointInPoly, distToPolyline } from './physics.js';
import { heightAtCampus } from './terrain.js';
import { CAMPUS_STYLE, LOOKS } from './data/looks.js';
import { toCampus } from './geo.js';

const TINT = { dark: '#2f3a44', clear: '#9fbccc', blue: '#5d7590' };
const DIRS = { N: [0, 1], S: [0, -1], E: [1, 0], W: [-1, 0] };

// Full look for a campus building (houses return null and keep their own palette)
export function lookFor(b) {
  if (b.kind === 'house') return null;
  const L = LOOKS[b.id] || {};
  return {
    ...L,
    wall: L.wall ?? CAMPUS_STYLE.wall,
    trim: L.trim ?? CAMPUS_STYLE.trim,
    windows: { ...CAMPUS_STYLE.windows, ...(b.dorm ? { size: 'medium', arrangement: 'even' } : {}), ...(L.windows || {}) },
  };
}

const hex = (c) => '#' + c.toString(16).padStart(6, '0');

// One repeating wall bay: wall color, window and frame baked in (material color stays white)
const texCache = new Map();
export function wallTexture(look) {
  const w = look.windows;
  const key = [look.wall, look.trim, w.shape, w.size, w.arrangement, w.tint, !!look.topBand].join('|');
  if (texCache.has(key)) return texCache.get(key);
  const bays = w.arrangement === 'scattered' ? 2 : 1;
  const bayW = w.size === 'storefront' ? 3 : 3.5, floorH = 3.6;
  const S = 128;
  const c = document.createElement('canvas');
  c.width = S * bays; c.height = S;
  const ctx = c.getContext('2d');
  ctx.fillStyle = hex(look.wall);
  ctx.fillRect(0, 0, c.width, S);
  // Stucco grain
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 900 * bays; i++) {
    ctx.fillStyle = rnd() < 0.5 ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.06)';
    ctx.fillRect(rnd() * c.width, rnd() * S, 2, 2);
  }
  if (look.topBand) { ctx.fillStyle = hex(look.trim); ctx.fillRect(0, 0, c.width, S * 0.1); }
  // Window size as fractions of the bay: [width, height, sill]
  const SIZE = { small: [0.3, 0.3, 0.4], medium: [0.44, 0.42, 0.32], tall: [0.38, 0.62, 0.16], storefront: [0.86, 0.76, 0.06] };
  let [fw, fh, sill] = SIZE[w.size] || SIZE.medium;
  if (w.shape === 'square') fh = fw * (bayW / floorH);
  const ribbon = w.arrangement === 'ribbon';
  if (ribbon) { fw = 1; fh = 0.36; sill = 0.36; }
  const glass = TINT[w.tint] || TINT.dark;
  const frame = hex(look.trim);
  const drawWindow = (cx) => {
    const ww = fw * S, wh = fh * S, x = cx - ww / 2, y = S * (1 - sill) - wh;
    ctx.beginPath();
    if (w.shape === 'arched') {
      // Round top: a semicircle in meters is an ellipse on the stretched canvas
      const rx = ww / 2, ry = rx * (bayW / floorH);
      ctx.moveTo(x, y + wh); ctx.lineTo(x, y + ry); ctx.ellipse(cx, y + ry, rx, ry, 0, Math.PI, 0); ctx.lineTo(x + ww, y + wh); ctx.closePath();
    } else ctx.rect(x, y, ww, wh);
    ctx.fillStyle = glass; ctx.fill();
    ctx.lineWidth = 5; ctx.strokeStyle = frame; ctx.stroke();
    // A soft reflection and mullions
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.fillRect(x + ww * 0.12, y + wh * 0.15, ww * 0.12, wh * 0.7);
    ctx.fillStyle = frame;
    if (ribbon) for (let k = 0.25; k < 1; k += 0.25) ctx.fillRect(x + ww * k - 2, y, 4, wh);
    else if (w.size !== 'small') ctx.fillRect(cx - 2, y, 4, wh);
    if (w.size === 'storefront') ctx.fillRect(x, y + wh * 0.72, ww, 4);
  };
  drawWindow(S / 2); // with 'scattered' the second bay stays blank
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  const out = { tex, bayW: bayW * bays };
  texCache.set(key, out);
  return out;
}

// The wall edge (campus space) of a building that faces a direction or a target point
export function wallEdge(b, { dir, target, score: scoreFn, minLen = 5 } = {}) {
  const poly = b.poly;
  let best = null, bestS = -Infinity;
  for (let i = 0; i < poly.length; i++) {
    const [ax, ay] = poly[i], [bx, by] = poly[(i + 1) % poly.length];
    const len = Math.hypot(bx - ax, by - ay);
    if (len < minLen) continue;
    let nx = (by - ay) / len, ny = -(bx - ax) / len;
    const mx = (ax + bx) / 2, my = (ay + by) / 2;
    if (pointInPoly(mx + nx * 0.5, my + ny * 0.5, poly)) { nx = -nx; ny = -ny; }
    let score;
    if (scoreFn) score = scoreFn(mx, my, nx, ny, len);
    else if (target) score = -Math.hypot(mx + nx * 3 - target[0], my + ny * 3 - target[1]);
    else score = (nx * dir[0] + ny * dir[1]) * 10 + Math.min(len, 30) * 0.05;
    if (score > bestS) { bestS = score; best = { ax, ay, bx, by, mx, my, nx, ny, len, tx: (bx - ax) / len, ty: (by - ay) / len }; }
  }
  return best;
}

// Ground features that get painted (plazas, pools, courtyards) and built later
export function planSite(world) {
  const site = { fountains: [], pools: [], courts: [] };
  const byId = Object.fromEntries(world.buildings.map((b) => [b.id, b]));
  const clear = (x, y, r) => {
    for (const b of world.buildings) {
      if (pointInPoly(x, y, b.poly)) return false;
      for (let i = 0; i < b.poly.length; i++) {
        if (distToPolyline(x, y, [b.poly[i], b.poly[(i + 1) % b.poly.length]]) < r) return false;
      }
    }
    for (const rd of world.data.roads) if (rd.kind !== 'path' && rd.kind !== 'trail' && distToPolyline(x, y, rd.pts) < rd.width / 2 + r) return false;
    return true;
  };
  for (const b of world.buildings) {
    const L = LOOKS[b.id];
    if (!L) continue;
    if (L.fountain && L.fountain.at) {
      const [x, y] = toCampus(L.fountain.at);
      site.fountains.push({ x, y, plaza: 8, bollards: !!L.fountain.bollards });
    } else if (L.fountain) {
      const e = L.fountain.side === 'door' ? wallEdge(b, { target: b.door }) : wallEdge(b, { dir: DIRS[L.fountain.side] });
      if (e) {
        // Step out until the plaza fits
        for (let d = L.fountain.dist; d < L.fountain.dist + 12; d += 1) {
          const x = e.mx + e.nx * d, y = e.my + e.ny * d;
          if (clear(x, y, 3.5)) { site.fountains.push({ x, y, plaza: 8, bollards: !!L.fountain.bollards }); break; }
        }
      }
    }
    if (L.pool) {
      // Next to the noted end of the building, on the flattest open ground that fits the
      // pool and its deck (the slope around Hotchkiss would otherwise need a tall platform)
      const e = wallEdge(b, { dir: DIRS[L.pool.side], minLen: 3 });
      if (e) {
        let best = null;
        for (let d = 6; d <= 34; d += 2) {
          for (let o = -18; o <= 18; o += 3) {
            for (const turn of [0, Math.PI / 2]) {
              const ang = Math.atan2(e.ty, e.tx) + turn;
              const c = Math.cos(ang), sn = Math.sin(ang);
              const x = e.mx + e.nx * d + e.tx * o, y = e.my + e.ny * d + e.ty * o;
              const pt = (u, v) => [x + c * u - sn * v, y + sn * u + c * v];
              const ok = [[-9.5, -6.5], [9.5, -6.5], [9.5, 6.5], [-9.5, 6.5], [0, 0], [0, 6.5], [0, -6.5], [9.5, 0], [-9.5, 0]].every(([u, v]) => clear(...pt(u, v), 1));
              if (!ok) continue;
              let lo = Infinity, hi = -Infinity;
              for (let u = -9.5; u <= 9.5; u += 3.8) for (let v = -6.5; v <= 6.5; v += 3.25) { const g = heightAtCampus(...pt(u, v)); lo = Math.min(lo, g); hi = Math.max(hi, g); }
              const score = (hi - lo) * 10 + d * 0.15 + Math.abs(o) * 0.1;
              if (!best || score < best.score) best = { score, x, y, ang, pt };
            }
          }
        }
        if (best) {
          const deck = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([u, v]) => best.pt(u * 9.5, v * 6.5));
          site.pools.push({ x: best.x, y: best.y, ang: best.ang, w: 12, h: 6, deck });
        }
      }
    }
    if (L.courtyardWith && byId[L.courtyardWith]) {
      const pts = hull([...b.poly, ...byId[L.courtyardWith].poly]);
      site.courts.push({ poly: pts, a: b, b: byId[L.courtyardWith] });
    }
  }
  return site;
}

function hull(points) {
  const p = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [], up = [];
  for (const q of p) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
  for (const q of p.reverse()) { while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop(); up.push(q); }
  return lo.slice(0, -1).concat(up.slice(0, -1));
}

// Plazas, courtyards and the pool deck are paved geometry now (surfaces.js), so nothing
// about the site is painted into the ground texture any more
export function paintSite() {}

// Many small boxes in a few colors, drawn as one instanced mesh per color
export class BoxBatch {
  constructor() { this.byColor = new Map(); this.m4 = new THREE.Matrix4(); this.q = new THREE.Quaternion(); this.e = new THREE.Euler(0, 0, 0, 'YXZ'); }
  // Center (x, y, z) in world space, size, rotation about y (heading), then tilt about local z and x
  add(color, x, y, z, sx, sy, sz, ry = 0, rz = 0, rx = 0) {
    let list = this.byColor.get(color);
    if (!list) this.byColor.set(color, (list = []));
    this.e.set(rx, ry, rz);
    list.push(this.m4.compose(new THREE.Vector3(x, y, z), this.q.setFromEuler(this.e), new THREE.Vector3(sx, sy, sz)).clone());
  }
  flush(scene, shadows) {
    for (const [color, list] of this.byColor) {
      const inst = new THREE.InstancedMesh(GEOM.box, mat(color), list.length);
      list.forEach((m, i) => inst.setMatrixAt(i, m));
      inst.castShadow = shadows; inst.receiveShadow = true;
      scene.add(inst);
    }
    this.byColor.clear();
  }
}

// Navy campus sign texture (white lettering)
const signCache = new Map();
function signMaterial(text, w, h) {
  const key = text + w + h;
  if (signCache.has(key)) return signCache.get(key);
  const c = document.createElement('canvas');
  c.width = 512; c.height = Math.round((512 * h) / w);
  const ctx = c.getContext('2d');
  ctx.fillStyle = CAMPUS_STYLE.sign; ctx.fillRect(0, 0, c.width, c.height);
  ctx.strokeStyle = '#c9a227'; ctx.lineWidth = 6; ctx.strokeRect(8, 8, c.width - 16, c.height - 16);
  ctx.fillStyle = '#ffffff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.font = `bold ${Math.min(c.height * 0.42, 64)}px "Trebuchet MS", Arial, sans-serif`;
  ctx.fillText(text, c.width / 2, c.height / 2 + 2, c.width - 40);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const m = new THREE.MeshLambertMaterial({ map: tex });
  signCache.set(key, m);
  return m;
}

// A two-sided flat panel (world space) facing heading `ry`
function panel(scene, material, x, y, z, w, h, ry) {
  const g = new THREE.PlaneGeometry(w, h);
  const front = new THREE.Mesh(g, material); front.position.set(x, y, z); front.rotation.y = ry; scene.add(front);
  const back = new THREE.Mesh(g, material); back.position.set(x, y, z); back.rotation.y = ry + Math.PI; scene.add(back);
}

// Everything around one campus building. `door` is the wall edge the door is on (campus space),
// `geo` has the LiDAR roof outline (verts with absolute z) and the floor height.
export function addDetails(world, b, look, door, geo, boxes) {
  const scene = world.scene, colliders = world.colliders;
  const W = (x, y) => [x, -y];
  const ang = (tx, ty) => Math.atan2(ty, tx); // world heading that lays local +x along campus (tx, ty)
  const ground0 = b.base + 0.3;
  const topAt = (x, y) => {
    let best = geo.verts[0], bd = Infinity;
    for (let k = 0; k < geo.n; k++) { const v = geo.verts[k]; const d = (v[0] - x) ** 2 + (v[1] - y) ** 2; if (d < bd) { bd = d; best = v; } }
    return best[2];
  };
  const stone = CAMPUS_STYLE.stone, timber = CAMPUS_STYLE.timber;
  const shadows = !world.lowSpec;

  // Stacked-stone base along every wall
  if (look.stoneBase) {
    const p = b.poly;
    for (let i = 0; i < p.length; i++) {
      const [ax, ay] = p[i], [bx, by] = p[(i + 1) % p.length];
      const len = Math.hypot(bx - ax, by - ay);
      if (len < 0.5) continue;
      const e = wallEdgeAt(b, i);
      const cx = (ax + bx) / 2 + e.nx * 0.1, cy = (ay + by) / 2 + e.ny * 0.1;
      const top = Math.max(heightAtCampus(ax, ay), heightAtCampus(bx, by)) + 0.9;
      boxes.add(stone, cx, (b.base + top) / 2, -cy, len + 0.2, top - b.base, 0.3, ang(e.tx, e.ty));
    }
  }

  // Covered second-floor walkway all around: a continuous mitered deck with a picket railing,
  // a roof over it, columns along its outer edge, and a steel stair up from the ground
  const BW = 1.8; // walkway depth
  let ring = null;
  if (look.balcony) {
    ring = walkwayRing(b.poly, BW);
    const y0 = ground0 + geo.floorH;
    const eaves = geo.verts.slice(0, geo.n).map((v) => v[2]).sort((p, q) => p - q);
    const eave = eaves[Math.floor(eaves.length / 2)];
    // Deck and cover: rings between the walls and the offset outline
    scene.add(ringSlab(ring, y0 - 0.25, 0.25, 0x8d8578, shadows));
    if (eave > y0 + 2.6) scene.add(ringSlab(ring, eave - 0.3, 0.22, look.roof ?? CAMPUS_STYLE.roof, shadows));
    const rail = look.balcony.rail;
    // Bridge across the courtyard to the neighbor (Biblical Studies -> Plew Center)
    const other = look.courtyardWith && world.buildings.find((o) => o.id === look.courtyardWith);
    if (other) courtyardBridge(world, b, ring, other, y0, boxes, rail);
    for (let i = 0; i < ring.outer.length; i++) {
      const [ax, ay] = ring.outer[i], [bx, by] = ring.outer[(i + 1) % ring.outer.length];
      const len = Math.hypot(bx - ax, by - ay);
      if (len < 0.3) continue;
      const tx = (bx - ax) / len, ty = (by - ay) / len, a = ang(tx, ty);
      // Railing set just inside the deck edge
      const ix = -ty * 0.12, iy = tx * 0.12; // toward the building for a counter-clockwise ring
      const mx = (ax + bx) / 2 + ix, my = (ay + by) / 2 + iy;
      boxes.add(rail, mx, y0 + 1.05, -my, len, 0.07, 0.07, a);
      boxes.add(rail, mx, y0 + 0.12, -my, len, 0.05, 0.05, a);
      for (let d = 0.08; d < len; d += 0.16) {
        const x = ax + tx * d + ix, y = ay + ty * d + iy;
        boxes.add(rail, x, y0 + 0.58, -y, 0.03, 0.9, 0.03, a);
      }
    }
  }

  // Stone or brick piers at the corners and along the walls (along the walkway's outer edge
  // when there is one, holding up its cover)
  if (look.piers) {
    const color = look.piers === 'brick' ? CAMPUS_STYLE.brick : stone;
    const spacing = look.piers === 'brick' ? 4.5 : 6;
    const p = ring ? ring.outer : b.poly;
    const out = ring ? -0.35 : 0.3;
    for (let i = 0; i < p.length; i++) {
      const [ax, ay] = p[i], [bx, by] = p[(i + 1) % p.length];
      const len = Math.hypot(bx - ax, by - ay);
      if (len < 2) continue;
      const tx = (bx - ax) / len, ty = (by - ay) / len;
      // Outward normal of a counter-clockwise ring
      const nx = ty, ny = -tx;
      const n = Math.max(1, Math.round(len / spacing));
      for (let k = 0; k < n; k++) {
        const t = k / n;
        const x = ax + (bx - ax) * t + nx * out, y = ay + (by - ay) * t + ny * out;
        if (ring && world.pavedAt(x, y, 0.3)) continue; // the drive runs right past this wall
        const top = topAt(x, y) - 0.15;
        const g = Math.min(b.base, heightAtCampus(x, y) - 0.2);
        boxes.add(color, x, (g + top) / 2, -y, 0.7, top - g, 0.7, ang(tx, ty));
        if (ring) world.colliders.addCircle(x, -y, 0.45);
      }
    }
  }

  // Steel stair from the ground up to the walkway, along the outside of the entrance wall
  if (ring && door) {
    const y0 = ground0 + geo.floorH;
    const H = y0 - heightAtCampus(door.mx, door.my);
    const L = H * 1.6;
    if (door.len > L + 6) {
      // Runs along the wall just outside the deck, ending at the deck edge near the corner
      const off = BW + 0.7;
      const v1 = door.len / 2 - 1, v0 = v1 - L;
      const p0 = [door.mx + door.nx * off + door.tx * v0, door.my + door.ny * off + door.ty * v0];
      const p1 = [door.mx + door.nx * off + door.tx * v1, door.my + door.ny * off + door.ty * v1];
      const g0 = heightAtCampus(...p0);
      const cx = (p0[0] + p1[0]) / 2, cy = (p0[1] + p1[1]) / 2;
      const slope = Math.atan2(y0 - g0, L);
      boxes.add(0x5a5e63, cx, (g0 + y0) / 2, -cy, Math.hypot(L, y0 - g0), 0.2, 1.3, ang(door.tx, door.ty), slope);
      // Treads and a handrail
      for (let k = 1; k < Math.round((y0 - g0) / 0.18); k++) {
        const t = k / Math.round((y0 - g0) / 0.18);
        boxes.add(0x6b7075, p0[0] + (p1[0] - p0[0]) * t, g0 + (y0 - g0) * t + 0.1, -(p0[1] + (p1[1] - p0[1]) * t), 0.28, 0.05, 1.3, ang(door.tx, door.ty));
      }
      const hx = door.nx * 0.65, hy = door.ny * 0.65;
      boxes.add(0x1e1e1e, cx + hx, (g0 + y0) / 2 + 1, -(cy + hy), Math.hypot(L, y0 - g0), 0.06, 0.06, ang(door.tx, door.ty), slope);
      const sx = (p0[0] + p1[0]) / 2, sy = (p0[1] + p1[1]) / 2;
      world.colliders.addPoly([[p0[0] + hx, -(p0[1] + hy)], [p1[0] + hx, -(p1[1] + hy)], [p1[0] - hx, -(p1[1] - hy)], [p0[0] - hx, -(p0[1] - hy)]], 'stair');
      void sx; void sy;
    }
  }

  if (!door) return;
  const { mx, my, nx, ny, tx, ty } = door;
  const gy = heightAtCampus(mx + nx * 1.5, my + ny * 1.5);
  const wallA = ang(tx, ty);
  const at = (u, v) => [mx + nx * u + tx * v, my + ny * u + ty * v]; // u out from the wall, v along it

  // Entrance porches
  if (look.porch === 'gable' || look.porch === 'posts') {
    const deep = look.porch === 'posts' ? 4.2 : 3.6, wide = look.porch === 'posts' ? 7 : 5.4, h = look.porch === 'posts' ? 3.2 : 3.8;
    const posts = look.porch === 'posts' ? [-wide / 2 + 0.3, 0, wide / 2 - 0.3] : [-wide / 2 + 0.5, wide / 2 - 0.5];
    for (const v of posts) {
      const [x, y] = at(deep, v);
      const g = heightAtCampus(x, y);
      const s = look.porch === 'gable' ? 0.85 : 0.32;
      boxes.add(look.porch === 'gable' ? stone : timber, x, (g + gy + h) / 2, -y, s, gy + h - g, s, wallA);
      const [wx, wz] = W(x, y);
      colliders.addCircle(wx, wz, s * 0.6);
    }
    const [bx, by] = at(deep, 0);
    boxes.add(timber, bx, gy + h - 0.15, -by, wide + 0.4, 0.3, 0.35, wallA); // beam across the posts
    const roofColor = look.porch === 'gable' ? timber : (look.roof ?? CAMPUS_STYLE.roof);
    const rise = look.porch === 'gable' ? 1.7 : 0.8;
    const tri = new THREE.Shape([new THREE.Vector2(-wide / 2 - 0.5, 0), new THREE.Vector2(wide / 2 + 0.5, 0), new THREE.Vector2(0, rise)]);
    const g = new THREE.ExtrudeGeometry(tri, { depth: deep + 0.6, bevelEnabled: false });
    const roof = new THREE.Mesh(g, mat(roofColor));
    // Shape x runs along the wall, extrusion (+z) runs out from it
    const [rx, rz] = W(mx, my);
    roof.position.set(rx, gy + h, rz);
    roof.rotation.order = 'YXZ';
    roof.rotation.y = Math.atan2(nx, -ny);
    roof.castShadow = shadows;
    scene.add(roof);
    if (look.porch === 'gable') {
      // Exposed trusses under the gable
      for (const u of [0.8, deep / 2, deep]) {
        const [x, y] = at(u, 0);
        boxes.add(timber, x, gy + h + 0.1, -y, wide, 0.18, 0.18, wallA);
        boxes.add(timber, x, gy + h + rise * 0.45, -y, 0.15, rise * 0.9, 0.15, wallA);
      }
    }
  } else if (look.porch === 'deck') {
    const [x, y] = at(1.4, 0);
    boxes.add(0x8b6a4e, x, gy + 0.2, -y, 4.2, 0.5, 2.6, wallA);
    // Ramp down along the wall
    const [rx, ry] = at(1.2, 4.6);
    boxes.add(0x8b6a4e, rx, gy + 0.2, -ry, 5.2, 0.12, 1.3, wallA, -Math.atan2(0.45, 5));
    for (const v of [-2.1, 2.1]) { const [px, py] = at(2.6, v); boxes.add(0x6b4f3a, px, gy + 0.9, -py, 0.08, 1, 0.08, wallA); }
    const [hx, hy] = at(2.6, 0); boxes.add(0x6b4f3a, hx, gy + 1.4, -hy, 4.2, 0.07, 0.07, wallA);
  }

  // Bell tower with an open belfry and a slender spire, beside the entrance
  if (look.tower) {
    const s = 4.4;
    const [x, y] = at(-0.6, 6);
    const g0 = heightAtCampus(x, y) - 0.5;
    const H = Math.max(b.top + 6, gy + 14);
    const wall = look.wall;
    boxes.add(wall, x, (g0 + H - 3) / 2, -y, s, H - 3 - g0, s, wallA);
    for (const [u, v] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      const [px, py] = [x + (nx * u + tx * v) * (s / 2 - 0.4), y + (ny * u + ty * v) * (s / 2 - 0.4)];
      boxes.add(wall, px, H - 1.5, -py, 0.8, 3, 0.8, wallA);
    }
    boxes.add(look.trim, x, H + 0.15, -y, s + 0.5, 0.35, s + 0.5, wallA);
    const bell = new THREE.Mesh(GEOM.sphere, mat(0xb08d3a));
    bell.scale.set(1.2, 1.3, 1.2); bell.position.set(x, H - 1.6, -y); scene.add(bell);
    const spire = new THREE.Mesh(GEOM.cone4, mat(look.roof ?? CAMPUS_STYLE.roof));
    spire.scale.set(s * 0.95, 7, s * 0.95); spire.position.set(x, H + 0.3 + 3.5, -y);
    spire.rotation.y = wallA + Math.PI / 4; spire.castShadow = shadows;
    scene.add(spire);
    const c = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([u, v]) => W(x + (nx * u + tx * v) * s / 2, y + (ny * u + ty * v) * s / 2));
    colliders.addPoly(c, 'tower');
  }

  // Exterior stair running up the entrance wall to a second-floor door
  let upperDoor = null;
  if (look.stair && geo.stories >= 2) {
    const L = Math.min(12, door.len / 2 - 3);
    if (L >= 4) {
      // Run along t = (-ny, nx) so (t, up, n) is a right-handed frame for the wedge
      const tx = -ny, ty = nx, wallA = ang(tx, ty);
      const at = (u, v) => [mx + nx * u + tx * v, my + ny * u + ty * v];
      const v0 = 2.2, H = geo.floorH, wdt = 1.8;
      const [sx, sy] = at(0, v0);
      const gs = heightAtCampus(sx + nx, sy + ny);
      if (look.stair.walls) {
        // Solid stucco-walled ramp: a wedge from the ground up to the upper door
        const geoW = new THREE.ExtrudeGeometry(new THREE.Shape([new THREE.Vector2(0, -1), new THREE.Vector2(L, -1), new THREE.Vector2(L, H + 1.1), new THREE.Vector2(L - 0.3, H + 1.1), new THREE.Vector2(0, 1.1)]), { depth: wdt, bevelEnabled: false });
        const m = new THREE.Mesh(geoW, mat(look.wall));
        const [wx, wz] = W(sx, sy);
        m.position.set(wx, gs, wz);
        // Shape x along the wall (campus t), extrusion z out from the wall (campus n)
        const basis = new THREE.Matrix4().makeBasis(new THREE.Vector3(tx, 0, -ty), new THREE.Vector3(0, 1, 0), new THREE.Vector3(nx, 0, -ny));
        m.quaternion.setFromRotationMatrix(basis);
        m.castShadow = shadows;
        scene.add(m);
      } else {
        const slope = Math.atan2(H, L);
        const [cx, cy] = at(wdt / 2 + 0.1, v0 + L / 2);
        boxes.add(0x5a5e63, cx, gs + H / 2, -cy, Math.hypot(L, H), 0.25, wdt, wallA, slope);
        const [rx, ry] = at(wdt + 0.1, v0 + L / 2);
        boxes.add(0x2b2b2b, rx, gs + H / 2 + 1, -ry, Math.hypot(L, H), 0.07, 0.07, wallA, slope);
      }
      const c = [at(0, v0), at(0, v0 + L), at(wdt + 0.2, v0 + L), at(wdt + 0.2, v0)].map(([x, y]) => W(x, y));
      colliders.addPoly(c, 'stair');
      const [ux, uy] = at(0.08, v0 + L + 1.4);
      upperDoor = { x: ux, y: uy, h: gs + H };
      boxes.add(0x4a3424, ux, gs + H + 1.2, -uy, 1.6, 2.4, 0.2, wallA);
      boxes.add(0x8d8578, ux + nx * 0.9, gs + H - 0.1, -(uy + ny * 0.9), 2.4, 0.25, 1.8, wallA); // landing
    }
  }

  // Building number plaque
  if (look.number) {
    const p = upperDoor || { x: mx + nx * 0.07, y: my + ny * 0.07, h: gy };
    const px = p.x + nx * 0.07, py = p.y + ny * 0.07;
    const m = signMaterial(look.number, 0.8, 0.55);
    const g = new THREE.PlaneGeometry(0.8, 0.55);
    const s = new THREE.Mesh(g, m);
    s.position.set(px, p.h + 3.1, -py); s.rotation.y = Math.atan2(nx, -ny);
    scene.add(s);
  }

  // Navy campus sign by the entrance
  if (look.sign) {
    const face = Math.atan2(nx, -ny);
    const text = look.sign.text;
    if (look.sign.base === 'wall') {
      const [x, y] = at(0.07, -2.6);
      const s = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 0.8), signMaterial(text, 2.2, 0.8));
      s.position.set(x, heightAtCampus(x, y) + 2.2, -y); s.rotation.y = face; scene.add(s);
    } else {
      const [x, y] = at(6, -4);
      standingSign(world, boxes, x, y, nx, ny, text, look.sign.base);
    }
  }
}

// Navy campus sign facing campus direction (nx, ny): on a stacked-stone base or on two posts
export function standingSign(world, boxes, x, y, nx, ny, text, base = 'stone') {
  const g = heightAtCampus(x, y);
  const face = Math.atan2(nx, -ny), along = face; // a box rotated by `face` has local x across the face
  const tx = -ny, ty = nx;
  if (base === 'stone') {
    boxes.add(CAMPUS_STYLE.stone, x, g + 0.5, -y, 2.0, 1.2, 0.8, along);
    panel(world.scene, signMaterial(text, 1.8, 0.7), x, g + 1.5, -y, 1.8, 0.7, face);
    boxes.add(CAMPUS_STYLE.stone, x, g + 1.9, -y, 2.1, 0.12, 0.3, along);
  } else {
    for (const v of [-1.1, 1.1]) boxes.add(0x2b2b2b, x + tx * v, g + 1.2, -(y + ty * v), 0.12, 2.4, 0.12, along);
    panel(world.scene, signMaterial(text, 2.4, 0.8), x, g + 1.7, -y, 2.4, 0.8, face);
  }
  world.colliders.addCircle(x, -y, 0.9);
}

// Info for edge i of a building polygon (outward normal, direction)
function wallEdgeAt(b, i) {
  const p = b.poly;
  const [ax, ay] = p[i], [bx, by] = p[(i + 1) % p.length];
  const len = Math.hypot(bx - ax, by - ay) || 1;
  let nx = (by - ay) / len, ny = -(bx - ax) / len;
  if (pointInPoly((ax + bx) / 2 + nx * 0.3, (ay + by) / 2 + ny * 0.3, p)) { nx = -nx; ny = -ny; }
  return { nx, ny, tx: (bx - ax) / len, ty: (by - ay) / len };
}

// Fountains, pool furniture and courtyard benches
export function addSite(world, site, boxes) {
  const scene = world.scene, colliders = world.colliders;
  for (const f of site.fountains) {
    const g = heightAtCampus(f.x, f.y);
    const basin = new THREE.Mesh(new THREE.CylinderGeometry(2.8, 3, 0.7, 24), mat(0xcfc6b4));
    basin.position.set(f.x, g + 0.3, -f.y); scene.add(basin);
    const water = new THREE.Mesh(new THREE.CylinderGeometry(2.45, 2.45, 0.1, 24), mat(0x4a8fc4, { emissive: 0x0a1a2a }));
    water.position.set(f.x, g + 0.62, -f.y); scene.add(water);
    const col = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.5, 1.8, 10), mat(0xcfc6b4));
    col.position.set(f.x, g + 1.1, -f.y); scene.add(col);
    const bowl = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 0.5, 0.35, 16), mat(0xcfc6b4));
    bowl.position.set(f.x, g + 2.0, -f.y); scene.add(bowl);
    colliders.addCircle(f.x, -f.y, 3);
    if (f.bollards) {
      for (let k = 0; k < 12; k++) {
        const a = (k / 12) * Math.PI * 2 + 0.26;
        const x = f.x + Math.cos(a) * (f.plaza - 0.4), y = f.y + Math.sin(a) * (f.plaza - 0.4);
        const gb = heightAtCampus(x, y);
        boxes.add(0xb3a990, x, gb + 0.45, -y, 0.35, 0.9, 0.35, a);
        boxes.add(0x8a7f72, x, gb + 0.95, -y, 0.5, 0.12, 0.5, a);
      }
    }
  }
  for (const pl of site.pools) buildPool(world, pl, boxes);
  for (const c of site.courts) {
    // Wooden benches on the open concrete between the two buildings
    const xs = c.poly.map((p) => p[0]), ys = c.poly.map((p) => p[1]);
    const spots = [];
    for (let x = Math.min(...xs) + 2; x < Math.max(...xs) - 2; x += 3) {
      for (let y = Math.min(...ys) + 2; y < Math.max(...ys) - 2; y += 3) {
        if (!pointInPoly(x, y, c.poly) || pointInPoly(x, y, c.a.poly) || pointInPoly(x, y, c.b.poly)) continue;
        let near = Infinity;
        for (const b of [c.a, c.b]) for (let i = 0; i < b.poly.length; i++) near = Math.min(near, distToPolyline(x, y, [b.poly[i], b.poly[(i + 1) % b.poly.length]]));
        if (near > 3 && !world.pavedAt(x, y, 1)) spots.push([x, y, near]);
      }
    }
    spots.sort((p, q) => q[2] - p[2]);
    const picked = [];
    for (const s of spots) {
      if (picked.length >= 6) break;
      if (picked.every((p) => Math.hypot(p[0] - s[0], p[1] - s[1]) > 6)) picked.push(s);
    }
    for (const [x, y] of picked) {
      const g = heightAtCampus(x, y);
      boxes.add(0x8b6a4e, x, g + 0.45, -y, 1.9, 0.1, 0.5, 0);
      boxes.add(0x8b6a4e, x, g + 0.8, -y - 0.22, 1.9, 0.5, 0.08, 0);
      for (const v of [-0.8, 0.8]) boxes.add(0x3a3532, x + v, g + 0.22, -y, 0.08, 0.45, 0.45, 0);
      colliders.addCircle(x, -y, 0.6);
    }
  }
}

// Stone monument with raised lettering and a wood-slat panel at the main entrance
export function entranceMonument(scene, look, x, z, gy, ang, shadows) {
  const [w, h] = look.size;
  const c = document.createElement('canvas');
  c.width = 1024; c.height = Math.round((1024 * h) / w);
  const ctx = c.getContext('2d');
  ctx.fillStyle = hex(look.stone); ctx.fillRect(0, 0, c.width, c.height);
  // Stacked stone courses
  let seed = 3;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const rows = 6, rh = c.height / rows;
  for (let r = 0; r < rows; r++) {
    let x0 = -rnd() * 80;
    while (x0 < c.width) {
      const sw = 60 + rnd() * 120, shade = 0.82 + rnd() * 0.3;
      const base = new THREE.Color(look.stone).multiplyScalar(shade);
      ctx.fillStyle = '#' + base.getHexString();
      ctx.fillRect(x0 + 2, r * rh + 2, sw - 4, rh - 4);
      x0 += sw;
    }
  }
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.font = `bold ${Math.round(c.height * 0.3)}px Georgia, "Times New Roman", serif`;
  ctx.fillStyle = 'rgba(0,0,0,0.45)'; ctx.fillText(look.text, c.width / 2 + 4, c.height / 2 + 5, c.width - 60);
  ctx.fillStyle = look.letters; ctx.fillText(look.text, c.width / 2, c.height / 2, c.width - 60);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
  const face = new THREE.MeshLambertMaterial({ map: tex });
  const side = mat(look.stone);
  const g = new THREE.Group();
  const wall = new THREE.Mesh(new THREE.BoxGeometry(w, h + 1, 0.8), [side, side, side, side, face, face]);
  wall.position.y = (h + 1) / 2 - 1; wall.castShadow = shadows; g.add(wall);
  const cap = new THREE.Mesh(GEOM.box, mat(0x9a8f80)); cap.scale.set(w + 0.3, 0.18, 1); cap.position.y = h + 0.09; g.add(cap);
  // Horizontal wood-slat fence panel beside it
  const slat = mat(look.slats);
  for (let k = 0; k < 7; k++) {
    const s = new THREE.Mesh(GEOM.box, slat);
    s.scale.set(3.2, 0.14, 0.08); s.position.set(w / 2 + 1.9, 0.25 + k * 0.2, 0); g.add(s);
  }
  for (const px of [w / 2 + 0.3, w / 2 + 3.5]) {
    const p = new THREE.Mesh(GEOM.box, mat(0x6b4f3a)); p.scale.set(0.15, 1.7, 0.15); p.position.set(px, 0.75, 0); g.add(p);
  }
  g.position.set(x, gy, z);
  g.rotation.y = ang;
  scene.add(g);
  return g;
}

// An in-ground pool on a level concrete deck: tiled coping, water with lane lines, a
// ladder, lounge chairs, umbrellas, a lifeguard chair and an iron fence with a gate
function buildPool(world, pl, boxes) {
  const scene = world.scene, colliders = world.colliders;
  const c = Math.cos(pl.ang), s = Math.sin(pl.ang);
  const at = (u, v) => [pl.x + c * u - s * v, pl.y + s * u + c * v]; // pool frame -> campus
  const ry = Math.atan2(s, c); // box heading that lays local x along the pool's length
  const DW = pl.w / 2 + 3.5, DH = pl.h / 2 + 3.5; // deck half sizes
  let lo = Infinity, hi = -Infinity;
  for (let u = -DW; u <= DW; u += DW / 3) for (let v = -DH; v <= DH; v += DH / 2) {
    const g = heightAtCampus(...at(u, v)); lo = Math.min(lo, g); hi = Math.max(hi, g);
  }
  const top = hi + 0.12; // level deck surface
  const [dx, dy] = at(0, 0);
  // Deck slab (shows a low retaining edge where the ground falls away)
  boxes.add(0xd6cfc0, dx, (lo - 0.4 + top) / 2, -dy, DW * 2, top - lo + 0.4, DH * 2, ry);
  // Coping around the water
  const cop = 0xe9e4d8;
  for (const v of [-1, 1]) { const [x, y] = at(0, v * (pl.h / 2 + 0.25)); boxes.add(cop, x, top + 0.04, -y, pl.w + 1, 0.1, 0.5, ry); }
  for (const u of [-1, 1]) { const [x, y] = at(u * (pl.w / 2 + 0.25), 0); boxes.add(cop, x, top + 0.04, -y, 0.5, 0.1, pl.h, ry); }
  // Water: a tiled-blue texture with dark lane lines, sitting just under the coping
  const cv = document.createElement('canvas');
  cv.width = 256; cv.height = 128;
  const ctx = cv.getContext('2d');
  const grad = ctx.createLinearGradient(0, 0, 256, 0);
  grad.addColorStop(0, '#4fb7e3'); grad.addColorStop(0.5, '#2a8fc8'); grad.addColorStop(1, '#3aa3d6');
  ctx.fillStyle = grad; ctx.fillRect(0, 0, 256, 128);
  ctx.fillStyle = '#1d4f86';
  for (let k = 1; k < 4; k++) { ctx.fillRect(12, (k * 128) / 4 - 2, 232, 4); ctx.fillRect(8, (k * 128) / 4 - 8, 4, 16); ctx.fillRect(244, (k * 128) / 4 - 8, 4, 16); }
  ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 6; ctx.strokeRect(3, 3, 250, 122);
  ctx.fillStyle = 'rgba(255,255,255,0.18)';
  for (let k = 0; k < 40; k++) ctx.fillRect((k * 53) % 256, (k * 31) % 128, 18, 3);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  const water = new THREE.Mesh(new THREE.PlaneGeometry(pl.w, pl.h), new THREE.MeshLambertMaterial({ map: tex, emissive: 0x0a2a40 }));
  water.rotation.order = 'YXZ'; water.rotation.y = ry; water.rotation.x = -Math.PI / 2;
  water.position.set(dx, top + 0.02, -dy);
  water.receiveShadow = true;
  scene.add(water);
  // Ladder at the deep end
  {
    const [lx, ly] = at(pl.w / 2 - 1.2, -pl.h / 2 + 0.1);
    for (const o of [-0.3, 0.3]) {
      const x = lx + c * o, y = ly + s * o;
      boxes.add(0xd8dde2, x, top + 0.45, -y, 0.06, 0.9, 0.06, ry);
      const [hx, hy] = [x - -s * 0.25, y - c * 0.25];
      boxes.add(0xd8dde2, (x + hx) / 2, top + 0.9, -(y + hy) / 2, 0.06, 0.06, 0.3, ry);
    }
  }
  // Lounge chairs and umbrellas along the long sides
  for (const side of [-1, 1]) {
    for (let k = -2; k <= 2; k++) {
      if (side === -1 && k % 2) continue;
      const [x, y] = at(k * 2.3, side * (pl.h / 2 + 2));
      boxes.add(0xf2f2f2, x, top + 0.3, -y, 0.7, 0.12, 1.9, ry);
      const [bx, by] = at(k * 2.3, side * (pl.h / 2 + 2.75));
      boxes.add(0xf2f2f2, bx, top + 0.55, -by, 0.7, 0.55, 0.12, ry, 0, side * 0.5);
      if (k % 2 === 0 && side === 1) {
        const [ux, uy] = at(k * 2.3 + 1.15, side * (pl.h / 2 + 2.3));
        boxes.add(0x6b5238, ux, top + 1.2, -uy, 0.07, 2.4, 0.07, 0);
        const shade = new THREE.Mesh(GEOM.cone8, mat(k ? 0x1f3a6e : 0xc9a227));
        shade.scale.set(2.6, 0.6, 2.6); shade.position.set(ux, top + 2.5, -uy); shade.castShadow = !world.lowSpec;
        scene.add(shade);
      }
    }
  }
  // Lifeguard chair at the middle of the far side
  {
    const [x, y] = at(0, -(pl.h / 2 + 1.6));
    for (const o of [-0.4, 0.4]) { const [px, py] = at(o, -(pl.h / 2 + 1.6)); boxes.add(0xf4f4f4, px, top + 0.9, -py, 0.1, 1.8, 0.1, ry); }
    boxes.add(0xf4f4f4, x, top + 1.8, -y, 1.0, 0.12, 0.7, ry);
    boxes.add(0xc4342b, x, top + 2.2, -y, 1.0, 0.7, 0.1, ry);
  }
  // Black iron fence around the deck, with a gate gap toward the building
  const fence = 0x262626;
  const runFence = (u0, v0, u1, v1) => {
    const L = Math.hypot(u1 - u0, v1 - v0);
    const [x0, y0] = at(u0, v0), [x1, y1] = at(u1, v1);
    const mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
    const a = Math.atan2(y1 - y0, x1 - x0);
    boxes.add(fence, mx, top + 1.35, -my, L, 0.06, 0.06, a);
    boxes.add(fence, mx, top + 0.15, -my, L, 0.06, 0.06, a);
    for (let d = 0; d <= L; d += 0.3) {
      const t = d / L;
      boxes.add(fence, x0 + (x1 - x0) * t, top + 0.75, -(y0 + (y1 - y0) * t), 0.035, 1.3, 0.035, a);
    }
    const px = -(y1 - y0) / L * 0.12, py = (x1 - x0) / L * 0.12;
    colliders.addPoly([[x0 - px, -(y0 - py)], [x1 - px, -(y1 - py)], [x1 + px, -(y1 + py)], [x0 + px, -(y0 + py)]], 'fence');
  };
  const f = 0.2;
  runFence(-DW + f, -DH + f, DW - f, -DH + f);
  runFence(-DW + f, DH - f, DW - f, DH - f);
  runFence(-DW + f, -DH + f, -DW + f, DH - f);
  runFence(DW - f, -DH + f, DW - f, -1);
  runFence(DW - f, 1, DW - f, DH - f);
  // The water itself
  const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([u, v]) => { const [x, y] = at(u * pl.w / 2, v * pl.h / 2); return [x, -y]; });
  colliders.addPoly(corners, 'pool');
  // Pool sign
  const lbl = makePoolSign();
  const [sx, sy] = at(DW - 0.2, 1.6);
  lbl.position.set(sx, top + 1.7, -sy); lbl.rotation.y = Math.atan2(c, -s);
  scene.add(lbl);
}

function makePoolSign() {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 96;
  const ctx = c.getContext('2d');
  ctx.fillStyle = CAMPUS_STYLE.sign; ctx.fillRect(0, 0, 256, 96);
  ctx.strokeStyle = '#c9a227'; ctx.lineWidth = 5; ctx.strokeRect(5, 5, 246, 86);
  ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.font = 'bold 30px "Trebuchet MS", Arial, sans-serif';
  ctx.fillText('HOTCHKISS POOL', 128, 36);
  ctx.font = '18px Arial, sans-serif'; ctx.fillText('No lifeguard on duty', 128, 68);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 0.52), new THREE.MeshLambertMaterial({ map: tex, side: THREE.DoubleSide }));
  return m;
}

// A building's outline and the same outline pushed out by `d` (mitered), both counter-clockwise.
// Very short edges are merged first so the offset doesn't fold over itself.
export function walkwayRing(poly, d) {
  let p = poly.map((q) => [...q]);
  let area = 0;
  for (let i = 0; i < p.length; i++) { const q = p[(i + 1) % p.length]; area += p[i][0] * q[1] - q[0] * p[i][1]; }
  if (area < 0) p.reverse();
  // Drop a vertex wherever it makes an edge shorter than 1.2 m
  for (let i = 0; p.length > 4 && i < p.length;) {
    const q = p[(i + 1) % p.length];
    if (Math.hypot(q[0] - p[i][0], q[1] - p[i][1]) < 1.2) p.splice((i + 1) % p.length, 1);
    else i++;
  }
  const n = p.length, outer = [];
  for (let i = 0; i < n; i++) {
    const a = p[(i - 1 + n) % n], b = p[i], c = p[(i + 1) % n];
    const l1 = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, l2 = Math.hypot(c[0] - b[0], c[1] - b[1]) || 1;
    const n1 = [(b[1] - a[1]) / l1, -(b[0] - a[0]) / l1], n2 = [(c[1] - b[1]) / l2, -(c[0] - b[0]) / l2];
    let mx = n1[0] + n2[0], my = n1[1] + n2[1];
    const ml = Math.hypot(mx, my) || 1;
    mx /= ml; my /= ml;
    const k = Math.min(3 * d, d / Math.max(0.2, mx * n1[0] + my * n1[1]));
    outer.push([b[0] + mx * k, b[1] + my * k]);
  }
  return { inner: p, outer };
}

// Horizontal slab filling the ring between a building outline and its offset
function ringSlab(ring, y, thick, color, shadows) {
  const shape = new THREE.Shape(ring.outer.map(([x, yy]) => new THREE.Vector2(x, yy)));
  shape.holes.push(new THREE.Path([...ring.inner].reverse().map(([x, yy]) => new THREE.Vector2(x, yy))));
  const g = new THREE.ExtrudeGeometry(shape, { depth: thick, bevelEnabled: false });
  g.rotateX(-Math.PI / 2); // campus (x, y) -> world (x, -y); extrusion goes up
  const m = new THREE.Mesh(g, mat(color));
  m.position.y = y;
  m.castShadow = shadows; m.receiveShadow = true;
  return m;
}

// A covered bridge at walkway level from one building's walkway to another building's wall
export function courtyardBridge(world, from, ring, b, y0, boxes, rail) {
  // Closest point pair between the walkway's outer edge and the other building
  let best = null;
  for (const p of ring.outer) {
    for (let i = 0; i < b.poly.length; i++) {
      const q0 = b.poly[i], q1 = b.poly[(i + 1) % b.poly.length];
      const dx = q1[0] - q0[0], dy = q1[1] - q0[1], L2 = dx * dx + dy * dy || 1e-9;
      const t = Math.max(0.15, Math.min(0.85, ((p[0] - q0[0]) * dx + (p[1] - q0[1]) * dy) / L2));
      const q = [q0[0] + dx * t, q0[1] + dy * t], d = Math.hypot(q[0] - p[0], q[1] - p[1]);
      if (!best || d < best.d) best = { d, p, q };
    }
  }
  // Use the middle of the closest walkway edge instead of a corner
  if (!best || best.d > 25 || best.d < 2) return;
  let mid = null;
  for (let i = 0; i < ring.outer.length; i++) {
    const p0 = ring.outer[i], p1 = ring.outer[(i + 1) % ring.outer.length];
    const m = [(p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2];
    let d = Infinity, q = null;
    for (let k = 0; k < b.poly.length; k++) {
      const q0 = b.poly[k], q1 = b.poly[(k + 1) % b.poly.length];
      const dx = q1[0] - q0[0], dy = q1[1] - q0[1], L2 = dx * dx + dy * dy || 1e-9;
      const t = Math.max(0, Math.min(1, ((m[0] - q0[0]) * dx + (m[1] - q0[1]) * dy) / L2));
      const qq = [q0[0] + dx * t, q0[1] + dy * t], dd = Math.hypot(qq[0] - m[0], qq[1] - m[1]);
      if (dd < d) { d = dd; q = qq; }
    }
    const len = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
    if (len > 6 && d < 25 && (!mid || d < mid.d)) mid = { d, p: m, q };
  }
  const { p, q } = mid || best;
  const L = Math.hypot(q[0] - p[0], q[1] - p[1]);
  const tx = (q[0] - p[0]) / L, ty = (q[1] - p[1]) / L, a = Math.atan2(ty, tx);
  const cx = (p[0] + q[0]) / 2, cy = (p[1] + q[1]) / 2;
  boxes.add(0x8d8578, cx, y0 - 0.12, -cy, L + 0.4, 0.25, 2.2, a);
  for (const side of [-1, 1]) {
    const ox = -ty * 1.0 * side, oy = tx * 1.0 * side;
    boxes.add(rail, cx + ox, y0 + 1.05, -(cy + oy), L, 0.07, 0.07, a);
    for (let d = 0.1; d < L; d += 0.16) boxes.add(rail, p[0] + tx * d + ox, y0 + 0.55, -(p[1] + ty * d + oy), 0.03, 0.95, 0.03, a);
  }
  // Brick columns under the middle of the span, and a door into the other building
  const g = heightAtCampus(cx, cy);
  for (const side of [-1, 1]) {
    const x = cx - ty * 1.2 * side, y = cy + tx * 1.2 * side;
    if (world.pavedAt(x, y, 0.3)) continue;
    boxes.add(CAMPUS_STYLE.brick, x, (g + y0) / 2, -y, 0.6, y0 - g, 0.6, a);
    world.colliders.addCircle(x, -y, 0.4);
  }
  boxes.add(0x3a2c22, q[0] - tx * 0.05, y0 + 1.2, -(q[1] - ty * 0.05), 0.15, 2.4, 1.4, a);
}
