// Solar carports over the parking rows: a tilted panel canopy on steel columns at the back of
// each row of stalls, high enough to drive and park under.
import * as THREE from 'three';
import { heightAtCampus } from './terrain.js';
import { pointInPoly } from './physics.js';
import { STALL_W, STALL_L, obbOverlap } from './surfaces.js';

const FRONT_H = 4.3, BACK_H = 3.5; // canopy underside over the aisle end and the back end

// Group stalls into straight rows (same angle, side by side)
function stallRows(stalls) {
  const parent = stalls.map((_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < stalls.length; i++) {
    for (let j = i + 1; j < stalls.length; j++) {
      const [x1, y1, a1] = stalls[i], [x2, y2, a2] = stalls[j];
      if (Math.abs(x1 - x2) > 4 || Math.abs(y1 - y2) > 4) continue;
      let da = Math.abs(a1 - a2) % (Math.PI * 2);
      if (da > Math.PI) da = Math.PI * 2 - da;
      if (da > 0.3) continue; // rows bend a little along curved aisles
      const tx = Math.cos(a1), ty = Math.sin(a1);
      const along = Math.abs((x2 - x1) * tx + (y2 - y1) * ty), side = Math.abs((x2 - x1) * -ty + (y2 - y1) * tx);
      if (along < 1.2 && side > 2 && side < 3.8) parent[find(i)] = find(j);
    }
  }
  const rows = new Map();
  stalls.forEach((s, i) => { const r = find(i); if (!rows.has(r)) rows.set(r, []); rows.get(r).push(s); });
  return [...rows.values()];
}

let panelTex = null;
function panelTexture() {
  if (panelTex) return panelTex;
  // One cell = a 1.0 x 1.7 m module: dark blue cells, thin silver frame
  const c = document.createElement('canvas');
  c.width = 64; c.height = 108;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#c7ccd2'; ctx.fillRect(0, 0, 64, 108);
  ctx.fillStyle = '#1b2a4a'; ctx.fillRect(2, 2, 60, 104);
  ctx.strokeStyle = 'rgba(140,160,200,0.35)'; ctx.lineWidth = 1;
  for (let x = 2; x < 62; x += 10) { ctx.beginPath(); ctx.moveTo(x + 0.5, 2); ctx.lineTo(x + 0.5, 106); ctx.stroke(); }
  for (let y = 2; y < 106; y += 10) { ctx.beginPath(); ctx.moveTo(2, y + 0.5); ctx.lineTo(62, y + 0.5); ctx.stroke(); }
  ctx.fillStyle = 'rgba(255,255,255,0.08)'; ctx.fillRect(4, 4, 20, 100);
  panelTex = new THREE.CanvasTexture(c);
  panelTex.colorSpace = THREE.SRGBColorSpace;
  panelTex.wrapS = panelTex.wrapT = THREE.RepeatWrapping;
  panelTex.anisotropy = 8;
  return panelTex;
}

// The real solar carports: the North Campus lot, and the lots in front of C.W. Smith and
// Waldock (the dorm lots on either side of that row)
const SOLAR_LOTS = ['northLot', 'smithLot', 'dormLot'];

export function buildSolarCarports(world, boxes) {
  const lots = SOLAR_LOTS.map((k) => world.places[k]).filter(Boolean)
    .map(([x, z]) => world.lots.find((l) => pointInPoly(x, z, l.wpts))).filter(Boolean);
  const inSolarLot = (x, y) => lots.some((l) => pointInPoly(x, -y, l.wpts));
  // Straight rows get long canopies; stalls fanned around a curve get one panel each,
  // which line up into a curved canopy
  const rows = [], singles = [];
  for (const r of stallRows(world.data.stalls)) {
    if (r.length >= 3) rows.push(r);
    else singles.push(...r);
  }
  // Only stalls that are part of a curved run (two neighbors close by), not strays at row ends
  for (let i = rows.length - 1; i >= 0; i--) if (!inSolarLot(rows[i][0][0], rows[i][0][1])) rows.splice(i, 1);
  for (const st of singles) {
    if (!inSolarLot(st[0], st[1])) continue;
    const near = singles.filter((o) => o !== st && Math.hypot(o[0] - st[0], o[1] - st[1]) < 4.2).length;
    if (near >= 2) rows.push([st]);
  }
  const carports = world.lotCarports || [];
  const pos = [], uv = [], under = [];
  const columns = [], placed = [];
  world.solarCanopies = placed;
  let count = 0;
  for (const row of rows) {
    // Average heading of the row (it may bend slightly)
    const a = Math.atan2(row.reduce((t, r) => t + Math.sin(r[2]), 0), row.reduce((t, r) => t + Math.cos(r[2]), 0));
    const dx = Math.cos(a), dy = Math.sin(a); // from the back of the stall toward its aisle
    const px = -dy, py = dx; // along the row
    let s0 = Infinity, s1 = -Infinity, cx = 0, cy = 0;
    for (const [x, y] of row) { cx += x / row.length; cy += y / row.length; }
    for (const [x, y] of row) { const s = (x - cx) * px + (y - cy) * py; s0 = Math.min(s0, s); s1 = Math.max(s1, s); }
    // Skip rows that already have a carport the LiDAR saw over them
    if (carports.some(([x, y, r]) => Math.hypot(x - cx, y - cy) < r + 3)) continue;
    // Split long rows into canopies of at most ~10 stalls
    const L = s1 - s0 + STALL_W;
    const parts = Math.max(1, Math.round(L / 29));
    const back = -STALL_L / 2 - 0.2, front = STALL_L / 2 - 0.6;
    const P = (s, d) => [cx + px * s + dx * d, cy + py * s + dy * d];
    const [hx, hz] = world.places.helipad;
    const nearPad = (a0, a1) => {
      const f = [P(a0, back), P(a1, back), P(a1, front), P(a0, front)];
      return f.some(([x, y]) => Math.hypot(x - hx, y + hz) < 7.5) || Math.hypot((f[0][0] + f[2][0]) / 2 - hx, (f[0][1] + f[2][1]) / 2 + hz) < 8;
    };
    const spans = [];
    for (let k = 0; k < parts; k++) {
      const a0 = s0 - STALL_W / 2 + (L * k) / parts + 0.15, a1 = s0 - STALL_W / 2 + (L * (k + 1)) / parts - 0.15;
      // A canopy reaching under the helicopter's rotor is cut back to the stalls clear of it
      if (nearPad(a0, a1) && row.length > 1) {
        for (const [x, y] of row) {
          const sc = (x - cx) * px + (y - cy) * py;
          if (sc < a0 || sc > a1) continue;
          spans.push([sc - STALL_W / 2 + 0.08, sc + STALL_W / 2 - 0.08]);
        }
      } else spans.push([a0, a1]);
    }
    for (const [a0, a1] of spans) {
      const corner = (s, d, h) => { const [x, y] = P(s, d); return [x, heightAtCampus(x, y) + h, -y]; };
      // Level along the row at each end: use the highest ground under that end
      const lift = (d) => {
        let g = -Infinity;
        for (let s = a0; s <= a1 + 0.01; s += (a1 - a0) / 4) g = Math.max(g, heightAtCampus(...P(s, d)));
        return g;
      };
      // Where two rows meet at a corner, the first canopy wins
      const foot = [P(a0, back), P(a1, back), P(a1, front), P(a0, front)];
      // (tested on slightly shrunk outlines so panels fanned around a curve can touch)
      const shrink = (f) => { const mx = (f[0][0] + f[2][0]) / 2, my = (f[0][1] + f[2][1]) / 2; return f.map(([x, y]) => [mx + (x - mx) * 0.8, my + (y - my) * 0.8]); };
      if (placed.some((f) => obbOverlap(shrink(f), shrink(foot)))) continue;
      if (nearPad(a0, a1)) continue; // keep the helipad open to the sky
      placed.push(foot);
      const gb = lift(back), gf = lift(front);
      const bh = gb + BACK_H, fh = Math.max(gf + FRONT_H, bh + 0.4);
      const q = [[a0, back, bh], [a1, back, bh], [a1, front, fh], [a0, front, fh]].map(([s, d, h]) => { const [x, y] = P(s, d); return [x, h, -y]; });
      const span = a1 - a0, depth = Math.hypot(front - back, fh - bh);
      const t = [[0, 0], [span / 1.0, 0], [span / 1.0, depth / 1.7], [0, depth / 1.7]];
      // Top (panels) and underside (steel), wound to face up and down
      for (const k3 of [0, 2, 1, 0, 3, 2]) { pos.push(...q[k3]); uv.push(...t[k3]); }
      for (const k3 of [0, 1, 2, 0, 2, 3]) under.push(...q[k3].map((v, i) => (i === 1 ? v - 0.12 : v)));
      // Columns along the back with a beam reaching forward under the panels
      const n = span < 4 ? 1 : Math.max(2, Math.round(span / 8) + 1);
      for (let c = 0; c < n; c++) {
        const s = n === 1 ? (a0 + a1) / 2 : a0 + 0.6 + ((span - 1.2) * c) / (n - 1);
        const [x, y] = P(s, back - 0.25);
        if (columns.some(([ox, oy]) => Math.hypot(ox - x, oy - y) < 0.9)) continue;
        const g = heightAtCampus(x, y);
        columns.push([x, y]);
        boxes.add(0x8a9099, x, (g + bh) / 2, -y, 0.35, bh - g, 0.35, 0);
        const [mx, my] = P(s, (back + front) / 2);
        const mh = (bh + fh) / 2 - 0.25;
        boxes.add(0x7b828b, mx, mh, -my, 0.18, 0.32, front - back, Math.atan2(dx, -dy), 0, -Math.atan2(fh - bh, front - back));
        world.colliders.addCircle(x, -y, 0.3, 'solar');
      }
      count++;
    }
  }
  if (!count) return;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.computeVertexNormals();
  const panels = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ map: panelTexture(), emissive: 0x05080f }));
  panels.castShadow = !world.lowSpec; panels.receiveShadow = true;
  world.scene.add(panels);
  const ug = new THREE.BufferGeometry();
  ug.setAttribute('position', new THREE.Float32BufferAttribute(under, 3));
  ug.computeVertexNormals();
  const um = new THREE.Mesh(ug, new THREE.MeshLambertMaterial({ color: 0x9aa0a8 }));
  um.castShadow = !world.lowSpec;
  world.scene.add(um);
}
