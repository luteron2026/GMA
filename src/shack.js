// The Campus Safety guard shack at the entrance drive off Placerita Canyon Rd, from the
// university's campus map (its marker and photos; the aerial photo shows the brown roof
// about 7 m west of the marker, on the south edge of the drive). A tan board-and-batten booth
// on a low concrete pad, dark brown trim at the corners, a dark shingle hip roof with a deep
// overhang, sliding windows all round (the wide one faces the drive), a window AC unit at the
// back end, a door on the far side, and yellow-striped pavement in front.
import * as THREE from 'three';
import { heightAtCampus } from './terrain.js';
import { mat, GEOM, makePerson } from './models.js';
import { CAMPUS } from './data/campus.js';
import { toCampus, project } from './geo.js';

const MARKER = [34.382364, -118.519493];
const TAN = 0xc6b08a, BATTEN = 0xb39c76, TRIM = 0x5a4535, ROOF = 0x4a3d35, GLASS = 0x2f3a44, FRAME = 0xeeeae0;

export function planGuardShack(world) {
  const [mx, my] = toCampus(MARKER);
  // The drive it watches: the nearest service road
  let best = null;
  for (const r of CAMPUS.roads) {
    if (r.kind === 'trail' || r.kind === 'street') continue;
    const p = project(r.pts, mx, my);
    if (!best || p.d < best.p.d) best = { r, p };
  }
  if (!best) return;
  const { r, p } = best;
  // 7 m west along the drive, then out of the lane to its south side
  const sgn = p.tx < 0 ? 1 : -1; // walk toward the west
  let tx = p.tx * sgn, ty = p.ty * sgn;
  const ax = p.px + tx * 7, ay = p.py + ty * 7;
  let nx = -ty, ny = tx;
  if (ny > 0) { nx = -nx; ny = -ny; } // the south side
  const off = r.width / 2 + 1.55;
  const x = ax + nx * off, y = ay + ny * off;
  world.shack = { x, y, tx, ty, nx, ny };
  world.places.shack = [x + nx * -2.2, -(y + ny * -2.2)]; // the window, from the lane
  // The Campus Safety cart parked beside it, nose to the drive
  const [cx, cy] = [x - tx * 3.6, y - ty * 3.6];
  world.places.safetyCart = [cx, -cy, Math.atan2(-nx, ny)];
}

export function buildGuardShack(world, boxes) {
  const s = world.shack;
  if (!s) return;
  const { x, y, tx, ty, nx, ny } = s;
  const scene = world.scene, shadows = !world.lowSpec;
  const A = Math.atan2(ty, tx); // local x runs along the drive
  const P = (a, o) => [x + tx * a + nx * o, y + ty * a + ny * o]; // a along the drive, o away from it
  const g = Math.min(heightAtCampus(x, y), heightAtCampus(...P(-1.5, 0)), heightAtCampus(...P(1.5, 0))) ;
  const L = 3.0, Wd = 2.3, H = 2.45, base = g + 0.15;
  const at = (a, o, yy, w, h, d, color, rz = 0) => { const [px, py] = P(a, o); boxes.add(color, px, yy, -py, w, h, d, A, rz); };
  // Pad and body
  at(0, 0, g + 0.075, L + 0.8, 0.15 + 0.3, Wd + 0.8, 0xb9b5ad);
  at(0, 0, base + H / 2, L, H, Wd, TAN);
  // Board and batten
  for (let a = -L / 2 + 0.2; a < L / 2; a += 0.4) for (const o of [-Wd / 2 - 0.02, Wd / 2 + 0.02]) at(a, o, base + H / 2, 0.06, H, 0.04, BATTEN);
  for (let o = -Wd / 2 + 0.2; o < Wd / 2; o += 0.4) for (const a of [-L / 2 - 0.02, L / 2 + 0.02]) at(a, o, base + H / 2, 0.04, H, 0.06, BATTEN);
  // Corner boards and a band at the top
  for (const a of [-L / 2, L / 2]) for (const o of [-Wd / 2, Wd / 2]) at(a, o, base + H / 2, 0.14, H, 0.14, TRIM);
  at(0, 0, base + H - 0.08, L + 0.06, 0.16, Wd + 0.06, TRIM);
  // Windows: a wide one toward the drive (o < 0), one at each end, a small one at the back
  const win = (a, o, w, h, along) => {
    const [px, py] = P(a, o);
    const sx = along ? w : 0.08, sz = along ? 0.08 : w;
    boxes.add(FRAME, px, base + 1.45, -py, sx + 0.12, h + 0.12, sz + 0.02, A);
    const [qx, qy] = P(a + (along ? 0 : Math.sign(a) * 0.02), o + (along ? Math.sign(o) * 0.02 : 0));
    boxes.add(GLASS, qx, base + 1.45, -qy, along ? w : 0.06, h, along ? 0.06 : w, A);
    boxes.add(FRAME, qx, base + 1.45, -qy, along ? 0.05 : 0.07, h, along ? 0.07 : 0.05, A); // the slider's meeting rail
  };
  win(0, -Wd / 2 - 0.03, 2.0, 1.05, true);
  win(-L / 2 - 0.03, 0, 1.3, 1.05, false);
  win(L / 2 + 0.03, -0.3, 0.8, 1.05, false);
  // A window AC unit at the east end, below the window line... and the door on the far side
  at(L / 2 + 0.22, 0.55, base + 1.15, 0.45, 0.45, 0.6, 0xd9d7d0);
  at(L / 2 + 0.45, 0.55, base + 1.15, 0.02, 0.38, 0.5, 0x9a9a96);
  at(0.6, Wd / 2 + 0.04, base + 1.05, 0.9, 2.05, 0.06, TRIM);
  at(0.95, Wd / 2 + 0.1, base + 1.05, 0.06, 0.06, 0.08, 0xc9a227);
  // The deep overhang and dark shingle hip roof
  at(0, 0, base + H + 0.06, L + 1.0, 0.12, Wd + 1.0, TRIM);
  {
    const [rx, ry] = P(0, 0);
    // A 4-sided cone has its corners on its axes: turned 45° (and widened by √2) its edges
    // line up with the walls; a parent group then stretches it to the roof's footprint
    const roof = new THREE.Mesh(GEOM.cone4, mat(ROOF, { flatShading: true }));
    roof.rotation.y = Math.PI / 4;
    roof.scale.set(Math.SQRT2, 0.85, Math.SQRT2);
    roof.castShadow = shadows;
    const holder = new THREE.Group();
    holder.position.set(rx, base + H + 0.12 + 0.425, -ry);
    holder.rotation.y = A;
    const stretch = new THREE.Group(); stretch.scale.set(L + 1.0, 1, Wd + 1.0);
    stretch.add(roof); holder.add(stretch); scene.add(holder);
  }
  // The sign over the drive window
  {
    const c = document.createElement('canvas'); c.width = 512; c.height = 96;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#7a1f2b'; ctx.fillRect(0, 0, 512, 96);
    ctx.strokeStyle = '#e8e2d0'; ctx.lineWidth = 6; ctx.strokeRect(6, 6, 500, 84);
    ctx.fillStyle = '#f4f1ea'; ctx.font = 'bold 52px Georgia, serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('CAMPUS SAFETY', 256, 50);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.3), new THREE.MeshLambertMaterial({ map: t }));
    const [px, py] = P(0, -Wd / 2 - 0.07);
    sign.position.set(px, base + 2.17, -py);
    sign.rotation.y = Math.atan2(-nx, ny);
    scene.add(sign);
  }
  // The officer on duty, inside at the window
  {
    const officer = makePerson({ skin: 0xe0ac84, hair: 0x3b2a1a, shirt: 0x1b1b1b, pants: 0x2b2f3a, longHair: false });
    const [px, py] = P(-0.3, -0.35);
    officer.position.set(px, base, -py);
    officer.rotation.y = Math.atan2(-nx, ny);
    scene.add(officer);
  }
  // Yellow stripes on the pavement between the shack and the lane, and the curb painted yellow
  for (let k = -3; k <= 3; k++) {
    const [px, py] = P(k * 0.75, -Wd / 2 - 0.95);
    boxes.add(0xe8c22a, px, heightAtCampus(px, py) + 0.03, -py, 0.22, 0.03, 1.2, A + Math.PI / 4);
  }
  at(0, -Wd / 2 - 0.5, g + 0.12, L + 0.8, 0.06, 0.12, 0xe8c22a);
  world.colliders.addPoly([P(-L / 2 - 0.4, -Wd / 2 - 0.4), P(L / 2 + 0.4, -Wd / 2 - 0.4), P(L / 2 + 0.4, Wd / 2 + 0.4), P(-L / 2 - 0.4, Wd / 2 + 0.4)].map(([a, b]) => [a, -b]), 'shack', base + H + 1);
}
