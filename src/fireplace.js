// The Dixon fireplace: an outdoor stacked-stone fireplace with a chimney in the paved
// courtyard by Dixon Hall's fountain, with a crackling fire, Adirondack chairs around it and
// smoke curling out of the chimney. Walk up and press E to warm up.
import * as THREE from 'three';
import { heightAtCampus } from './terrain.js';
import { pointInPoly, distToPolyline } from './physics.js';
import { mat, makeLabel } from './models.js';
import { CAMPUS_STYLE } from './data/looks.js';

// Find a spot near the fountain on Dixon's courtyard side: clear of buildings, roads and
// lots, on fairly level ground, facing back toward the fountain. Campus space.
export function planDixonFireplace(world) {
  const dixon = world.buildings.find((b) => b.id === 'dixon');
  if (!dixon) return null;
  const [bx, by] = dixon.obb;
  const fountain = world.site.fountains.slice().sort((p, q) => Math.hypot(p.x - bx, p.y - by) - Math.hypot(q.x - bx, q.y - by))[0];
  const cx = fountain ? fountain.x : bx, cy = fountain ? fountain.y : by;
  const roads = world.data.roads.filter((r) => r.kind !== 'trail' && r.kind !== 'path');
  const nearWall = (x, y, r) => world.buildings.some((b) => pointInPoly(x, y, b.poly) || b.poly.some((p, i) => distToPolyline(x, y, [p, b.poly[(i + 1) % b.poly.length]]) < r));
  let best = null;
  for (let rad = 8; rad <= 18; rad += 0.5) {
    for (let k = 0; k < 36; k++) {
      const a = (k / 36) * Math.PI * 2;
      const x = cx + Math.cos(a) * rad, y = cy + Math.sin(a) * rad;
      // The fireplace faces the fountain; the seating sits between them
      const nx = (cx - x) / rad, ny = (cy - y) / rad, tx = -ny, ty = nx;
      const P = (s, o) => [x + tx * s + nx * o, y + ty * s + ny * o];
      const pad = [P(-3.8, -1.6), P(3.8, -1.6), P(3.8, 5.2), P(-3.8, 5.2)];
      const probe = pad.concat([P(0, 0), P(0, 2), P(0, 4), P(-2.5, 3.5), P(2.5, 3.5)]);
      if (probe.some(([px, py]) => nearWall(px, py, 1.5))) continue;
      if (probe.some(([px, py]) => roads.some((r) => distToPolyline(px, py, r.pts) < r.width / 2 + 1.5))) continue;
      if (probe.some(([px, py]) => world.lots.some((l) => pointInPoly(px, -py, l.wpts)))) continue;
      if (probe.some(([px, py]) => !world.inCampus(px, -py))) continue;
      const hs = probe.map(([px, py]) => heightAtCampus(px, py));
      const slope = Math.max(...hs) - Math.min(...hs);
      if (slope > 2.4) continue; // the plaza sits on a gentle hillside; each piece follows the ground
      // Right on the fountain plaza (where people actually gather), near Dixon, and flat
      const dWall = Math.min(...dixon.poly.map((p, i) => distToPolyline(x, y, [p, dixon.poly[(i + 1) % dixon.poly.length]])));
      const score = dWall * 0.25 + rad * 1.2 + slope * 2;
      if (!best || score < best.score) best = { score, x, y, tx, ty, nx, ny, P, pad };
    }
  }
  if (!best) return null;
  world.plazas.push(best.pad);
  world.places.dixonFire = [best.P(0, 2.4)[0], -best.P(0, 2.4)[1]];
  return best;
}

let stoneTex = null;
function stoneTexture() {
  if (stoneTex) return stoneTex;
  // One 1 m tile of stacked fieldstone: irregular courses of warm gray-brown stones
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#5b5249'; ctx.fillRect(0, 0, 256, 256); // mortar
  let seed = 11;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const base = new THREE.Color(CAMPUS_STYLE.stone);
  let y = 0;
  while (y < 256) {
    const rh = 22 + rnd() * 22;
    let x = -rnd() * 60;
    while (x < 256) {
      const sw = 34 + rnd() * 70;
      const col = base.clone().multiplyScalar(0.72 + rnd() * 0.5);
      col.offsetHSL((rnd() - 0.5) * 0.03, 0, 0);
      ctx.fillStyle = '#' + col.getHexString();
      const r = 6;
      ctx.beginPath();
      ctx.roundRect ? ctx.roundRect(x + 2, y + 2, sw - 4, rh - 4, r) : ctx.rect(x + 2, y + 2, sw - 4, rh - 4);
      ctx.fill();
      // A little shading along the bottom of each stone
      ctx.fillStyle = 'rgba(0,0,0,0.18)'; ctx.fillRect(x + 3, y + rh - 7, sw - 6, 4);
      ctx.fillStyle = 'rgba(255,255,255,0.08)'; ctx.fillRect(x + 4, y + 3, sw - 8, 3);
      x += sw;
    }
    y += rh;
  }
  stoneTex = new THREE.CanvasTexture(c);
  stoneTex.colorSpace = THREE.SRGBColorSpace;
  stoneTex.wrapS = stoneTex.wrapT = THREE.RepeatWrapping;
  stoneTex.anisotropy = 8;
  return stoneTex;
}

// A box with its texture repeated once per meter on every face
function stoneBox(w, h, d, material) {
  const geo = new THREE.BoxGeometry(w, h, d);
  const uv = geo.getAttribute('uv');
  const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]]; // +x -x +y -y +z -z
  for (let f = 0; f < 6; f++) for (let k = 0; k < 4; k++) {
    const i = f * 4 + k;
    uv.setXY(i, uv.getX(i) * dims[f][0], uv.getY(i) * dims[f][1]);
  }
  const m = new THREE.Mesh(geo, material);
  m.castShadow = true; m.receiveShadow = true;
  return m;
}

function glowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,210,120,1)');
  g.addColorStop(0.35, 'rgba(255,140,40,0.55)');
  g.addColorStop(1, 'rgba(255,90,0,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// Adirondack chair facing heading `face` (campus angle the sitter looks toward)
function chair(boxes, x, y, face, color) {
  const g = heightAtCampus(x, y);
  const tx = Math.cos(face), ty = Math.sin(face), rx = ty, ry = -tx; // forward, right
  const A = Math.atan2(ry, rx); // local x across the chair
  const at = (f, r) => [x + tx * f + rx * r, y + ty * f + ry * r];
  // Seat, sloping down toward the back
  { const [px, py] = at(0, 0); boxes.add(color, px, g + 0.38, -py, 0.68, 0.06, 0.62, A, 0, 0.12); }
  // Tall slatted back, leaning back
  for (const r of [-0.24, -0.08, 0.08, 0.24]) { const [px, py] = at(-0.38, r); boxes.add(color, px, g + 0.78, -py, 0.12, 0.85, 0.04, A, 0, 0.35); }
  // Wide flat arms on front posts
  for (const r of [-0.42, 0.42]) {
    const [ax, ay] = at(-0.02, r); boxes.add(color, ax, g + 0.62, -ay, 0.14, 0.04, 0.78, A);
    const [fx, fy] = at(0.28, r); boxes.add(color, fx, g + 0.3, -fy, 0.07, 0.6, 0.07, A);
    const [bx, by] = at(-0.3, r); boxes.add(color, bx, g + 0.22, -by, 0.07, 0.44, 0.07, A);
  }
}

export class DixonFireplace {
  constructor(world, spot, boxes) {
    this.world = world;
    const { x, y, tx, ty, nx, ny, P } = spot;
    const scene = world.scene, shadows = !world.lowSpec;
    const A = Math.atan2(ty, tx); // local x along the fireplace's width; local z points out its back
    const g = Math.max(...[P(-1.6, -0.6), P(1.6, -0.6), P(-1.6, 0.8), P(1.6, 0.8)].map(([px, py]) => heightAtCampus(px, py)));
    const stone = new THREE.MeshLambertMaterial({ map: stoneTexture() });
    const group = new THREE.Group();
    group.position.set(x, g, -y);
    group.rotation.y = A + Math.PI; // local -z faces the fountain
    // In the group, +z is the back (away from the fountain), -z the front
    const add = (m, px, py, pz) => { m.position.set(px, py, pz); m.castShadow = shadows; group.add(m); return m; };
    // A footing that reaches down into the slope so nothing floats
    add(stoneBox(3.6, 1.2, 1.9, stone), 0, -0.6 + 0.02, 0.05);
    // Raised hearth sticking out in front
    add(stoneBox(3.6, 0.45, 1.7, stone), 0, 0.225, -0.05);
    add(new THREE.Mesh(new THREE.BoxGeometry(3.75, 0.08, 0.6), mat(0x9a8f80)), 0, 0.49, -0.62); // hearth cap
    // Firebox: two stone cheeks, a back wall and a lintel, leaving a real opening
    add(stoneBox(0.75, 1.5, 1.1, stone), -1.12, 1.2, 0.3);
    add(stoneBox(0.75, 1.5, 1.1, stone), 1.12, 1.2, 0.3);
    add(stoneBox(1.5, 1.5, 0.35, stone), 0, 1.2, 0.68);
    add(stoneBox(3.0, 0.55, 1.1, stone), 0, 2.22, 0.3);
    // Soot-black inside of the firebox
    add(new THREE.Mesh(new THREE.BoxGeometry(1.48, 1.48, 0.02), mat(0x16120f)), 0, 1.2, 0.49);
    add(new THREE.Mesh(new THREE.BoxGeometry(0.02, 1.48, 0.7), mat(0x221c17)), -0.74, 1.2, 0.15);
    add(new THREE.Mesh(new THREE.BoxGeometry(0.02, 1.48, 0.7), mat(0x221c17)), 0.74, 1.2, 0.15);
    add(new THREE.Mesh(new THREE.BoxGeometry(1.48, 0.02, 0.7), mat(0x1d1813)), 0, 1.94, 0.15);
    // Timber mantel across the front
    add(new THREE.Mesh(new THREE.BoxGeometry(3.3, 0.24, 0.42), mat(CAMPUS_STYLE.timber)), 0, 2.08, -0.32);
    // Shoulders stepping in to the chimney, the chimney stack and its cap
    add(stoneBox(2.4, 0.5, 1.0, stone), 0, 2.74, 0.32);
    add(stoneBox(1.25, 2.3, 0.85, stone), 0, 4.14, 0.34);
    add(new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.14, 1.1), mat(0x9a8f80)), 0, 5.36, 0.34);
    add(new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.3, 0.45), mat(0x2a2420)), 0, 5.5, 0.34);
    // Iron fire grate and logs
    const iron = mat(0x1a1a1a);
    for (const s of [-0.45, 0.45]) add(new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.18, 0.55), iron), s, 0.56, 0.12);
    add(new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.04, 0.04), iron), 0, 0.64, -0.12);
    const wood = mat(0x5a3b24), charred = mat(0x2a1e16);
    const logs = [[0, 0.7, 0.12, 0.25, 0.95], [0, 0.7, 0.2, -0.25, 0.9], [0, 0.86, 0.15, 0.05, 0.85]];
    for (const [lx, ly, lz, rot, len] of logs) {
      const l = add(new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.1, len, 8), lz > 0.17 ? charred : wood), lx, ly, lz);
      l.rotation.set(0, rot, Math.PI / 2);
    }
    // Flames: a few cones that flicker, glowing embers under them, and a soft glow
    this.flames = [];
    const flameMats = [0xffd27a, 0xff9a2e, 0xff6a1a].map((c) => new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.9, depthWrite: false }));
    const flameSpots = [[-0.25, 0.1, 0.5], [0.2, 0.15, 0.6], [0, 0.05, 0.75], [-0.05, 0.25, 0.45], [0.35, 0.05, 0.4]];
    flameSpots.forEach(([fx, fz, h], i) => {
      const f = new THREE.Mesh(new THREE.ConeGeometry(0.16, 1, 7), flameMats[i % 3]);
      f.position.set(fx, 0.82 + h / 2, fz); f.scale.set(1, h, 1);
      f.castShadow = false;
      group.add(f);
      this.flames.push({ m: f, h, x: fx, phase: i * 1.7 });
    });
    const embers = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.06, 0.5), new THREE.MeshBasicMaterial({ color: 0xff5a14 }));
    embers.position.set(0, 0.62, 0.15); group.add(embers);
    this.glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.75 }));
    this.glow.position.set(0, 1.1, -0.1); this.glow.scale.set(2.6, 2.6, 1);
    group.add(this.glow);
    scene.add(group);
    this.group = group;
    // Smoke puffs drifting up out of the chimney
    this.smoke = [];
    const smokeMat = new THREE.MeshLambertMaterial({ color: 0xbdb8b2, transparent: true, opacity: 0.35, depthWrite: false });
    for (let k = 0; k < 6; k++) {
      const s = new THREE.Mesh(new THREE.IcosahedronGeometry(0.35, 1), smokeMat.clone());
      s.castShadow = false;
      group.add(s);
      this.smoke.push({ m: s, t: k / 6 });
    }
    // Solid to walk and drive into
    const [ox, oy] = P(0, -0.3);
    world.colliders.addCircle(ox, -oy, 1.5, 'fireplace', g + 5.4);
    for (const s of [-1.1, 1.1]) { const [qx, qy] = P(s, -0.3); world.colliders.addCircle(qx, -qy, 0.7, 'fireplace', g + 2.4); }
    // Four Adirondack chairs in an arc facing the fire, a log bench, and a side table
    const chairColors = [0xf2ede2, 0x2f5d8a, 0xf2ede2, 0x2f5d8a];
    [-2.4, -0.85, 0.85, 2.4].forEach((s, i) => {
      const o = 3.3 - Math.abs(s) * 0.25;
      const [cx, cy] = P(s, o);
      const [fx, fy] = P(0, 0.6);
      chair(boxes, cx, cy, Math.atan2(fy - cy, fx - cx), chairColors[i]);
      world.colliders.addCircle(cx, -cy, 0.45, 'chair', heightAtCampus(cx, cy) + 1.1);
    });
    {
      const [lx, ly] = P(3.1, 1.2), gl = heightAtCampus(lx, ly);
      boxes.add(0x6b4a30, lx, gl + 0.35, -ly, 0.45, 0.45, 0.45, A);
      const [sx, sy] = P(-3.2, 1.2), gs = heightAtCampus(sx, sy);
      // A stack of split firewood by the hearth
      for (let k = 0; k < 3; k++) boxes.add(0x7a5434, sx, gs + 0.12 + k * 0.2, -sy, 0.6, 0.18, 0.9 - k * 0.15, A + k * 0.08);
    }
    const lbl = makeLabel('Dixon Fireplace', 'Press E to warm up', { width: 9 });
    lbl.position.set(x + nx * 1.5, g + 7.2, -(y + ny * 1.5));
    scene.add(lbl);
    world.labels.push(lbl);
  }

  update(dt, t) {
    for (const f of this.flames) {
      const k = 0.75 + 0.25 * Math.sin(t * 11 + f.phase) + 0.12 * Math.sin(t * 23 + f.phase * 2.3);
      f.m.scale.set(0.85 + 0.2 * Math.sin(t * 7 + f.phase), f.h * k, 0.85 + 0.2 * Math.cos(t * 9 + f.phase));
      f.m.position.y = 0.82 + (f.h * k) / 2;
      f.m.position.x = f.x + 0.03 * Math.sin(t * 13 + f.phase);
    }
    const gl = 2.4 + 0.35 * Math.sin(t * 9) + 0.2 * Math.sin(t * 17.3);
    this.glow.scale.set(gl, gl, 1);
    for (const s of this.smoke) {
      s.t = (s.t + dt * 0.12) % 1;
      const u = s.t;
      s.m.position.set(0.15 * Math.sin(u * 6 + s.t * 20), 5.6 + u * 5, 0.34 + u * 1.6);
      const sc = 0.5 + u * 2.2;
      s.m.scale.set(sc, sc, sc);
      s.m.material.opacity = 0.32 * (1 - u) * Math.min(1, u * 8);
    }
  }
}
