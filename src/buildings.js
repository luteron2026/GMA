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
      const e = wallEdge(b, { dir: DIRS[L.pool.side] });
      if (e) {
        for (let d = 7; d < 16; d += 1) {
          const x = e.mx + e.nx * d, y = e.my + e.ny * d;
          const ang = Math.atan2(e.ty, e.tx);
          const ok = [[-7, -4], [7, -4], [7, 4], [-7, 4], [0, 0]].every(([u, v]) => clear(x + e.tx * u - e.ty * v, y + e.ty * u + e.tx * v, 1));
          if (ok) { site.pools.push({ x, y, ang, w: 12, h: 6 }); break; }
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

export function paintSite(ctx, P, ppm, site) {
  const circle = (x, y, r, color) => { const [px, py] = P(x, y); ctx.fillStyle = color; ctx.beginPath(); ctx.arc(px, py, r * ppm, 0, Math.PI * 2); ctx.fill(); };
  for (const c of site.courts) {
    ctx.beginPath();
    c.poly.forEach(([x, y], i) => { const [px, py] = P(x, y); if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py); });
    ctx.closePath(); ctx.fillStyle = '#cbc3b3'; ctx.fill();
  }
  for (const f of site.fountains) { circle(f.x, f.y, f.plaza + 0.4, '#b9b09e'); circle(f.x, f.y, f.plaza, '#d3cbbb'); }
  for (const pl of site.pools) {
    const [px, py] = P(pl.x, pl.y);
    ctx.save(); ctx.translate(px, py); ctx.rotate(-pl.ang); ctx.scale(ppm, ppm);
    ctx.fillStyle = '#d9d2c4'; ctx.fillRect(-pl.w / 2 - 2.5, -pl.h / 2 - 2.5, pl.w + 5, pl.h + 5);
    ctx.fillStyle = '#2f86b8'; ctx.fillRect(-pl.w / 2, -pl.h / 2, pl.w, pl.h);
    ctx.fillStyle = '#58b4e0'; ctx.fillRect(-pl.w / 2 + 0.4, -pl.h / 2 + 0.4, pl.w - 0.8, pl.h - 0.8);
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    for (let k = -pl.w / 2 + 1; k < pl.w / 2; k += 2.2) ctx.fillRect(k, -pl.h / 2 + 0.8, 0.5, pl.h - 1.6);
    ctx.restore();
  }
}

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
  const ang = (tx, ty) => Math.atan2(-ty, tx); // world heading that lays local +x along campus (tx, ty)
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

  // Stone or brick piers at the corners and along the walls
  if (look.piers) {
    const color = look.piers === 'brick' ? CAMPUS_STYLE.brick : stone;
    const spacing = look.piers === 'brick' ? 4.5 : 6;
    const p = b.poly;
    for (let i = 0; i < p.length; i++) {
      const [ax, ay] = p[i], [bx, by] = p[(i + 1) % p.length];
      const len = Math.hypot(bx - ax, by - ay);
      if (len < 2) continue;
      const e = wallEdgeAt(b, i);
      const n = Math.max(1, Math.round(len / spacing));
      for (let k = 0; k < n; k++) {
        const t = k / n;
        const x = ax + (bx - ax) * t + e.nx * 0.3, y = ay + (by - ay) * t + e.ny * 0.3;
        const top = topAt(x, y) - 0.15;
        boxes.add(color, x, (b.base + top) / 2, -y, 0.8, top - b.base, 0.8, ang(e.tx, e.ty));
      }
    }
  }

  // Second-floor walkway / balcony with a railing, all around
  if (look.balcony) {
    const y0 = ground0 + geo.floorH;
    const p = b.poly;
    for (let i = 0; i < p.length; i++) {
      const [ax, ay] = p[i], [bx, by] = p[(i + 1) % p.length];
      const len = Math.hypot(bx - ax, by - ay);
      if (len < 4) continue;
      const e = wallEdgeAt(b, i), a = ang(e.tx, e.ty);
      const mx = (ax + bx) / 2, my = (ay + by) / 2;
      const [dx, dz] = W(mx + e.nx * 0.8, my + e.ny * 0.8);
      boxes.add(0x8d8578, dx, y0, dz, len, 0.25, 1.6, a);
      const [rx, rz] = W(mx + e.nx * 1.55, my + e.ny * 1.55);
      boxes.add(look.balcony.rail, rx, y0 + 1.0, rz, len, 0.08, 0.08, a);
      boxes.add(look.balcony.rail, rx, y0 + 0.15, rz, len, 0.06, 0.06, a);
      for (let d = -len / 2 + 0.3; d <= len / 2 - 0.3; d += 0.35) {
        const [px, pz] = W(mx + e.nx * 1.55 + e.tx * d, my + e.ny * 1.55 + e.ty * d);
        boxes.add(look.balcony.rail, px, y0 + 0.58, pz, 0.04, 0.86, 0.04, a);
      }
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
  if (look.stair) {
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
  for (const pl of site.pools) {
    const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([u, v]) => {
      const x = pl.x + Math.cos(pl.ang) * u * pl.w / 2 - Math.sin(pl.ang) * v * pl.h / 2;
      const y = pl.y + Math.sin(pl.ang) * u * pl.w / 2 + Math.cos(pl.ang) * v * pl.h / 2;
      return [x, -y];
    });
    colliders.addPoly(corners, 'pool');
    // Lounge chairs along one side
    for (let k = -2; k <= 2; k++) {
      const x = pl.x + Math.cos(pl.ang) * k * 2.4 - Math.sin(pl.ang) * (pl.h / 2 + 1.5);
      const y = pl.y + Math.sin(pl.ang) * k * 2.4 + Math.cos(pl.ang) * (pl.h / 2 + 1.5);
      boxes.add(0xf2f2f2, x, heightAtCampus(x, y) + 0.3, -y, 0.7, 0.15, 1.9, Math.atan2(-Math.sin(pl.ang), Math.cos(pl.ang)));
    }
  }
  for (const c of site.courts) {
    // Wooden benches on the open concrete between the two buildings
    const xs = c.poly.map((p) => p[0]), ys = c.poly.map((p) => p[1]);
    const spots = [];
    for (let x = Math.min(...xs) + 2; x < Math.max(...xs) - 2; x += 3) {
      for (let y = Math.min(...ys) + 2; y < Math.max(...ys) - 2; y += 3) {
        if (!pointInPoly(x, y, c.poly) || pointInPoly(x, y, c.a.poly) || pointInPoly(x, y, c.b.poly)) continue;
        let near = Infinity;
        for (const b of [c.a, c.b]) for (let i = 0; i < b.poly.length; i++) near = Math.min(near, distToPolyline(x, y, [b.poly[i], b.poly[(i + 1) % b.poly.length]]));
        if (near > 3) spots.push([x, y, near]);
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
