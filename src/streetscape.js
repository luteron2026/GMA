// Streets, road signs, utility poles, fences, gates, neighborhood colors and street props,
// from the Street View notes in data/streetscape.js.
import * as THREE from 'three';
import { CAMPUS } from './data/campus.js';
import { mat, GEOM } from './models.js';
import { pointInPoly, distToPolyline } from './physics.js';
import { heightAtCampus, inCore } from './terrain.js';
import { toCampus, COMPASS, project, pointAt, pathLength, offsetLine } from './geo.js';
import { BoxBatch, standingSign } from './buildings.js';
import {
  STREETS, SIGNS, MARKINGS, CROSSWALKS, SPEED_BUMPS, FENCES, GATES, NEIGHBORHOOD, TREE_NOTES, BEDS, PROPS,
} from './data/streetscape.js';

const ROADS = CAMPUS.roads;
const STREET_ROADS = ROADS.filter((r) => r.kind === 'street');
const DRIVES = ROADS.filter((r) => r.kind === 'service' || r.kind === 'aisle' || r.kind === 'driveway');

function nearestRoad(list, x, y) {
  let best = null;
  for (const r of list) {
    const p = project(r.pts, x, y);
    if (!best || p.d < best.d) best = { ...p, road: r };
  }
  return best;
}

// Building footprints with bounding boxes, for quick "is this spot free" checks
function makeChecks(world) {
  const bl = world.buildings.map((b) => {
    const xs = b.poly.map((p) => p[0]), ys = b.poly.map((p) => p[1]);
    return { poly: b.poly, minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
  });
  const nearBuilding = (x, y, m) => bl.some((b) => {
    if (x < b.minX - m || x > b.maxX + m || y < b.minY - m || y > b.maxY + m) return false;
    if (pointInPoly(x, y, b.poly)) return true;
    for (let i = 0; i < b.poly.length; i++) if (distToPolyline(x, y, [b.poly[i], b.poly[(i + 1) % b.poly.length]]) < m) return true;
    return false;
  });
  const nearRoad = (x, y, m, list = ROADS, except = null) => list.some((r) => r !== except && r.kind !== 'trail' && distToPolyline(x, y, r.pts) < r.width / 2 + m);
  const inLot = (x, y) => CAMPUS.lots.some((l) => pointInPoly(x, y, l.poly));
  return { nearBuilding, nearRoad, inLot };
}

// Push a point off any road surface onto the shoulder
function offRoad(x, y, margin = 1.3) {
  for (let k = 0; k < 3; k++) {
    const p = nearestRoad(ROADS.filter((r) => r.kind !== 'trail' && r.kind !== 'path'), x, y);
    if (!p || p.d >= p.road.width / 2 + margin - 0.01) break;
    const nx = -p.ty * p.side, ny = p.tx * p.side;
    x = p.px + nx * (p.road.width / 2 + margin); y = p.py + ny * (p.road.width / 2 + margin);
  }
  return [x, y];
}

// Work out where everything goes (before the ground texture is painted)
export function planStreetscape(world) {
  const { nearBuilding, nearRoad, inLot } = makeChecks(world);
  const plan = { poles: [], fences: [], gates: [], bumps: [], crosswalks: [], markings: [], signs: [], redCurbs: [], beds: [] };

  // Utility poles every ~45 m on one side, with streetlights where noted
  let chain = 0;
  for (const r of STREET_ROADS) {
    const st = STREETS[r.name];
    if (!st || !st.poles) continue;
    const want = { south: [0, -1], north: [0, 1], west: [-1, 0], east: [1, 0] }[st.poles];
    const L = pathLength(r.pts);
    let last = null, k = 0;
    chain++;
    for (let s = 6; s < L; s += 3) {
      const p = pointAt(r.pts, s);
      let nx = -p.ty, ny = p.tx;
      if (nx * want[0] + ny * want[1] < 0) { nx = -nx; ny = -ny; }
      const off = r.width / 2 + (st.shoulderW || 1) + 0.6;
      const x = p.x + nx * off, y = p.y + ny * off;
      if (last && Math.hypot(x - last[0], y - last[1]) < 44) continue;
      if (!inCore(x, y) || nearRoad(x, y, 2.5, ROADS, r) || nearBuilding(x, y, 1.5) || inLot(x, y)) continue;
      plan.poles.push({ x, y, nx, ny, light: !!st.lights && k++ % 2 === 0, chain });
      last = [x, y];
    }
  }

  // Fences and walls: follow the street between the two noted points, on their side
  for (const f of FENCES) {
    const a = toCampus(f.from), b = toCampus(f.to);
    let best = null;
    for (const r of ROADS.filter((q) => q.kind === 'street')) {
      const pa = project(r.pts, a[0], a[1]), pb = project(r.pts, b[0], b[1]);
      if (!best || pa.d + pb.d < best.pa.d + best.pb.d) best = { r, pa, pb };
    }
    const { r, pa, pb } = best;
    const st = STREETS[r.name] || {};
    let side = Math.sign(pa.side * pa.d + pb.side * pb.d) || pa.side; // both noted points vote, weighted by distance
    if (f.side) {
      // The noted side wins: map positions are a few meters off, the side isn't
      const mid = pointAt(r.pts, (pa.s + pb.s) / 2), c = COMPASS[f.side];
      side = -mid.ty * c[0] + mid.tx * c[1] >= 0 ? 1 : -1;
    }
    const dist = Math.max(r.width / 2 + (st.shoulderW || 1) + 0.8, Math.min(r.width / 2 + 9, (pa.d + pb.d) / 2));
    const s0 = Math.min(pa.s, pb.s), s1 = Math.max(pa.s, pb.s);
    const pts = [];
    for (let s = s0; s <= s1 + 0.01; s += 2.5) {
      const p = pointAt(r.pts, s);
      pts.push([p.x - p.ty * side * dist, p.y + p.tx * side * dist, -p.ty * side, p.tx * side]); // x, y, away-from-road normal
    }
    const segs = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const [x0, y0] = pts[i], [x1, y1] = pts[i + 1];
      const mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
      // Gaps for driveways, roads and buildings
      if (nearRoad(mx, my, 1.2, ROADS, r) || nearBuilding(mx, my, 0.8) || !inCore(mx, my)) continue;
      segs.push({ x0, y0, x1, y1, nx: pts[i][2], ny: pts[i][3] });
    }
    plan.fences.push({ kind: f.kind, segs });
  }
  // Where two noted fences cover the same stretch, the one listed later (more specific) wins
  for (let i = 0; i < plan.fences.length; i++) {
    const later = plan.fences.slice(i + 1).flatMap((f) => f.segs.map((q) => [(q.x0 + q.x1) / 2, (q.y0 + q.y1) / 2]));
    plan.fences[i].segs = plan.fences[i].segs.filter((q) => {
      const mx = (q.x0 + q.x1) / 2, my = (q.y0 + q.y1) / 2;
      return !later.some(([x, y]) => Math.hypot(x - mx, y - my) < 3);
    });
  }

  // Drive entrances: find the drive that leaves the street at each noted gate
  for (const g of GATES) {
    const [gx, gy] = toCampus(g.at);
    const sp = nearestRoad(STREET_ROADS, gx, gy);
    let best = null;
    for (const r of DRIVES) {
      for (const end of [0, r.pts.length - 1]) {
        const d = Math.hypot(r.pts[end][0] - gx, r.pts[end][1] - gy);
        if (d > 35) continue;
        // Prefer campus drives (not private driveways) heading off on the noted side of the street
        const inner = r.pts[end === 0 ? Math.min(1, r.pts.length - 1) : Math.max(0, r.pts.length - 2)];
        const ps = project(sp.road.pts, inner[0], inner[1]);
        const score = d + (r.kind === 'driveway' ? 15 : 0) + (ps.side !== sp.side && sp.d > 1.5 ? 30 : 0);
        if (!best || score < best.score) best = { d, r, end, score };
      }
    }
    if (!best) continue;
    const pts = best.end === 0 ? best.r.pts : [...best.r.pts].reverse();
    const street = nearestRoad(STREET_ROADS, pts[0][0], pts[0][1]);
    const s0 = street.road.width / 2 + 2.5;
    const m = pointAt(pts, s0);
    plan.gates.push({ ...g, x: m.x, y: m.y, tx: m.tx, ty: m.ty, nx: -m.ty, ny: m.tx, w: best.r.width, pts, s0 });
    if (g.redCurb) {
      const run = [];
      for (let s = street.road.width / 2; s < street.road.width / 2 + 22; s += 2) { const p = pointAt(pts, s); run.push([p.x, p.y]); }
      plan.redCurbs.push(offsetLine(run, best.r.width / 2), offsetLine(run, -best.r.width / 2));
    }
  }

  for (const at of SPEED_BUMPS) {
    const [x, y] = toCampus(at);
    const p = nearestRoad(STREET_ROADS, x, y);
    plan.bumps.push({ x: p.px, y: p.py, tx: p.tx, ty: p.ty, half: p.road.width / 2 - 0.4 });
  }
  for (const at of CROSSWALKS) {
    const [x, y] = toCampus(at);
    const p = nearestRoad(STREET_ROADS, x, y);
    plan.crosswalks.push({ x: p.px, y: p.py, tx: p.tx, ty: p.ty, w: p.road.width });
  }
  for (const m of MARKINGS) {
    const [x, y] = toCampus(m.at);
    const c = COMPASS[m.faces];
    // The nearby street that runs the way the lettering faces
    let p = null;
    for (const r of STREET_ROADS) {
      const q = project(r.pts, x, y);
      if (q.d > 18) continue;
      const score = q.d - 12 * Math.abs(q.tx * c[0] + q.ty * c[1]);
      if (!p || score < p.score) p = { ...q, road: r, score };
    }
    if (!p) continue;
    const sgn = p.tx * c[0] + p.ty * c[1] >= 0 ? 1 : -1;
    // Keep it in the lane drivers going that way use (right-hand traffic)
    const hx = p.tx * sgn, hy = p.ty * sgn;
    plan.markings.push({ text: m.text, x: p.px + hy * 3, y: p.py - hx * 3, hx, hy });
  }
  for (const s of SIGNS) {
    const [x, y] = offRoad(...toCampus(s.at));
    plan.signs.push({ ...s, x, y });
  }
  for (const b of BEDS) {
    const [x, y] = toCampus(b.at);
    plan.beds.push({ ...b, x, y });
  }
  return plan;
}

// Height of a speed bump under a campus point (for cars bouncing over them)
export function bumpHeight(plan, x, y) {
  for (const b of plan.bumps) {
    const dx = x - b.x, dy = y - b.y;
    const u = dx * b.tx + dy * b.ty, v = dx * -b.ty + dy * b.tx;
    if (Math.abs(u) < 0.6 && Math.abs(v) < b.half) return 0.12 * (1 - (u / 0.6) ** 2);
  }
  return 0;
}

// ---------- ground paint ----------

// Shoulders go down first so driveways and paths are painted over them
export function paintShoulders(stroke) {
  for (const r of STREET_ROADS) {
    const st = STREETS[r.name];
    stroke(r.pts, st ? st.shoulder : '#c9c4b8', r.width + 2 * (st ? st.shoulderW : 0.7));
  }
}

export function paintBeds(ctx, P, ppm, plan) {
  for (const b of plan.beds) {
    const [px, py] = P(b.x, b.y);
    ctx.fillStyle = '#6b5238'; ctx.beginPath(); ctx.arc(px, py, b.r * ppm, 0, Math.PI * 2); ctx.fill();
    let seed = Math.round(b.x * 7 + b.y * 13) || 1;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < b.r * b.r * 12; i++) {
      const a = rnd() * Math.PI * 2, r = Math.sqrt(rnd()) * b.r * ppm;
      ctx.fillStyle = b.colors[Math.floor(rnd() * b.colors.length)];
      ctx.fillRect(px + Math.cos(a) * r, py + Math.sin(a) * r, ppm * 0.35, ppm * 0.35);
    }
  }
}

// ---------- house colors ----------

// Wall/roof colors for a house from the street it's on
export function houseLook(b) {
  const [cx, cy] = b.obb;
  const p = nearestRoad(STREET_ROADS.filter((r) => r.name && NEIGHBORHOOD[r.name]), cx, cy);
  if (!p || p.d > 90) return null;
  const n = NEIGHBORHOOD[p.road.name];
  const h = Math.abs(parseInt(String(b.id).replace(/\D/g, ''), 10) || 7);
  return { wall: n.walls[h % n.walls.length], roof: n.roofs[Math.floor(h / 7) % n.roofs.length], shutters: !!n.shutters };
}

// ---------- trees ----------

// Looks for particular trees: index into TREES -> style, plus trees to add
export function treeNotes(trees, free = () => true) {
  const styles = new Map(), extra = [];
  // Nearest open ground to a noted spot (off the pavement, clear of the other added trees)
  const spot = (x0, y0) => {
    for (let r = 0; r < 30; r += 1) {
      for (let k = 0; k < Math.max(1, r * 6); k++) {
        const a = (k / Math.max(1, r * 6)) * Math.PI * 2, x = x0 + Math.cos(a) * r, y = y0 + Math.sin(a) * r;
        if (free(x, y) && !extra.some((e) => Math.hypot(e.x - x, e.y - y) < 4)) return [x, y];
      }
    }
    return null;
  };
  for (const n of TREE_NOTES) {
    if (n.at) {
      const [x, y] = toCampus(n.at);
      const near = trees.map((t, i) => [Math.hypot(t[0] - x, t[1] - y), i]).filter(([d]) => d < 12).sort((a, b) => a[0] - b[0]);
      near.slice(0, n.count).forEach(([, i]) => styles.set(i, n.kind));
      for (let k = near.length; k < n.count; k++) {
        const p = spot(x, y);
        if (p) extra.push({ x: p[0], y: p[1], h: n.kind === 'fanPalm' ? 18 : 11, r: 3, style: n.kind });
      }
    } else {
      const a = toCampus(n.from), b = toCampus(n.to);
      let found = 0;
      trees.forEach((t, i) => {
        if (distToPolyline(t[0], t[1], [a, b]) > n.width / 2) return;
        if (n.kind === 'stonePine' && t[2] < 9) return;
        if (n.kind === 'crapeMyrtle' && t[2] > 9) return;
        styles.set(i, n.kind); found++;
      });
      if (n.kind === 'crapeMyrtle' && found < 3) {
        const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
        for (let s = 0; s <= L; s += 11) {
          const p = spot(a[0] + ((b[0] - a[0]) * s) / L, a[1] + ((b[1] - a[1]) * s) / L);
          if (p) extra.push({ x: p[0], y: p[1], h: 5.5, r: 2.2, style: n.kind });
        }
      }
    }
  }
  return { styles, extra };
}

// ---------- 3D ----------

const signTexCache = new Map();
function signMat(kind) {
  if (signTexCache.has(kind)) return signTexCache.get(kind);
  const c = document.createElement('canvas');
  const wide = kind === 'plate';
  c.width = 256; c.height = wide ? 128 : 256;
  const ctx = c.getContext('2d');
  const W = c.width, H = c.height;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const diamond = (fill, border) => {
    ctx.beginPath(); ctx.moveTo(W / 2, 4); ctx.lineTo(W - 4, H / 2); ctx.lineTo(W / 2, H - 4); ctx.lineTo(4, H / 2); ctx.closePath();
    ctx.fillStyle = border; ctx.fill();
    ctx.beginPath(); ctx.moveTo(W / 2, 16); ctx.lineTo(W - 16, H / 2); ctx.lineTo(W / 2, H - 16); ctx.lineTo(16, H / 2); ctx.closePath();
    ctx.fillStyle = fill; ctx.fill();
  };
  if (kind === 'stop') {
    const oct = (r) => { ctx.beginPath(); for (let i = 0; i < 8; i++) { const a = Math.PI / 8 + (i * Math.PI) / 4; ctx.lineTo(W / 2 + Math.cos(a) * r, H / 2 + Math.sin(a) * r); } ctx.closePath(); };
    ctx.fillStyle = '#fff'; oct(126); ctx.fill(); ctx.fillStyle = '#c4161c'; oct(114); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.font = 'bold 76px Arial'; ctx.fillText('STOP', W / 2, H / 2 + 4, 220);
  } else if (kind === 'deadEnd' || kind === 'bump') {
    diamond('#f2c230', '#111');
    ctx.fillStyle = '#111';
    if (kind === 'deadEnd') { ctx.font = 'bold 44px Arial'; ctx.fillText('DEAD', W / 2, H / 2 - 22); ctx.fillText('END', W / 2, H / 2 + 26); }
    else { ctx.font = 'bold 50px Arial'; ctx.fillText('BUMP', W / 2, H / 2 + 2); }
  } else if (kind === 'marker') {
    diamond('#c4161c', '#8a0f12');
    ctx.fillStyle = '#ffd9d9';
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) { ctx.beginPath(); ctx.arc(W / 2 + i * 34, H / 2 + j * 34, 10, 0, Math.PI * 2); ctx.fill(); }
  } else if (kind === 'ped') {
    diamond('#c6e633', '#111');
    // Walking person
    ctx.strokeStyle = '#111'; ctx.fillStyle = '#111'; ctx.lineWidth = 14; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.arc(W / 2 + 6, H / 2 - 52, 15, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.moveTo(W / 2 + 2, H / 2 - 32); ctx.lineTo(W / 2 - 6, H / 2 + 14);
    ctx.moveTo(W / 2 - 6, H / 2 + 14); ctx.lineTo(W / 2 - 30, H / 2 + 58); ctx.moveTo(W / 2 - 6, H / 2 + 14); ctx.lineTo(W / 2 + 22, H / 2 + 58);
    ctx.moveTo(W / 2, H / 2 - 22); ctx.lineTo(W / 2 - 28, H / 2 + 2); ctx.moveTo(W / 2, H / 2 - 22); ctx.lineTo(W / 2 + 28, H / 2 - 2); ctx.stroke();
  } else if (kind === 'arrow') {
    ctx.fillStyle = '#c6e633'; ctx.fillRect(0, 48, W, 160); ctx.strokeStyle = '#111'; ctx.lineWidth = 8; ctx.strokeRect(6, 54, W - 12, 148);
    ctx.lineWidth = 16; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(170, 82); ctx.lineTo(86, 168); ctx.moveTo(86, 168); ctx.lineTo(86, 118); ctx.moveTo(86, 168); ctx.lineTo(136, 168); ctx.stroke();
  } else if (kind === 'doNotEnter') {
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(W / 2, H / 2, 126, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#c4161c'; ctx.beginPath(); ctx.arc(W / 2, H / 2, 116, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.fillRect(40, H / 2 - 18, W - 80, 36);
    ctx.font = 'bold 30px Arial'; ctx.fillText('DO NOT', W / 2, H / 2 - 52); ctx.fillText('ENTER', W / 2, H / 2 + 54);
  } else if (kind === 'plate') {
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H); ctx.strokeStyle = '#111'; ctx.lineWidth = 6; ctx.strokeRect(6, 6, W - 12, H - 12);
    ctx.fillStyle = '#111'; ctx.font = 'bold 30px Arial'; ctx.fillText('PRIVATE', W / 2, H / 2 - 18); ctx.fillText('PROPERTY', W / 2, H / 2 + 20);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
  const m = new THREE.MeshLambertMaterial({ map: tex, transparent: true, alphaTest: 0.5 });
  signTexCache.set(kind, m);
  return m;
}

const PLANE = new THREE.PlaneGeometry(1, 1);
function face(scene, material, x, y, z, w, h, ry) {
  const m = new THREE.Mesh(PLANE, material);
  m.scale.set(w, h, 1); m.position.set(x, y, z); m.rotation.y = ry;
  scene.add(m);
  return m;
}

export function buildStreetscape(world) {
  const scene = world.scene, colliders = world.colliders, plan = world.street;
  const boxes = new BoxBatch();
  const shadows = !world.lowSpec;
  const G = (x, y) => heightAtCampus(x, y);
  const { nearBuilding, nearRoad, inLot } = makeChecks(world);
  const ang = (tx, ty) => Math.atan2(ty, tx); // box heading laying local x along campus (tx, ty)
  const lantern = mat(0xffe2a0, { emissive: 0x6b5a2a });
  const black = 0x232323, wood = 0x6b5238, stone = 0x8a7f72, cap = 0x9a8f80;

  // Road signs
  const back = mat(0x9a9ea3);
  for (const s of plan.signs) {
    const g = G(s.x, s.y);
    const c = COMPASS[s.faces];
    const fx = -c[0], fy = -c[1]; // the face points at oncoming drivers
    const ry = Math.atan2(fx, -fy);
    const off = (d) => [s.x + fx * d, s.y + fy * d];
    const top = s.kind === 'pedBeacon' ? 3.4 : 2.9;
    boxes.add(0x7d8288, s.x, g + top / 2, -s.y, 0.08, top, 0.08, 0);
    colliders.addCircle(s.x, -s.y, 0.2);
    const [x1, y1] = off(0.06), [x0, y0] = off(0.05);
    const put = (kind, size, h, w = size) => {
      face(scene, signMat(kind), x1, g + h, -y1, w, size * (kind === 'plate' ? 0.5 : 1), ry);
      face(scene, back, x0, g + h, -y0, w * 0.98, size * (kind === 'plate' ? 0.48 : 0.98), ry + Math.PI);
    };
    if (s.kind === 'stop') { put('stop', 0.9, 2.45); if (s.plate) put('plate', 0.7, 1.75, 0.7); }
    else if (s.kind === 'deadEnd') put('deadEnd', 1.1, 2.4);
    else if (s.kind === 'bump') { put('bump', 1.0, 2.35); put('marker', 0.6, 1.5); }
    else if (s.kind === 'doNotEnter') put('doNotEnter', 0.9, 2.3);
    else if (s.kind === 'pedBeacon') {
      put('ped', 1.1, 2.55); put('arrow', 0.75, 1.75);
      // Flashing amber beacons, a solar panel on top and a push-button box
      const [lx, ly] = off(0.1);
      for (const v of [-0.3, 0.3]) boxes.add(0xffb000, lx + fy * v, g + 3.25, -(ly - fx * v), 0.18, 0.18, 0.12, ry);
      boxes.add(0x1d2b4a, s.x, g + 3.75, -s.y, 0.8, 0.05, 0.6, ry, 0, -0.5);
      const [bx, by] = off(-0.12); boxes.add(0xe6c229, bx, g + 1.1, -by, 0.18, 0.28, 0.14, ry);
    }
  }

  // Speed bumps are built with the pavement (surfaces.js)

  // Wooden utility poles with crossarms, wires and cobra-head streetlights
  const poleGeo = new THREE.CylinderGeometry(0.13, 0.18, 1, 7).translate(0, 0.5, 0);
  const poles = new THREE.InstancedMesh(poleGeo, mat(wood), Math.max(1, plan.poles.length));
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), v3 = new THREE.Vector3(), sc = new THREE.Vector3();
  const wire = [];
  plan.poles.forEach((p, i) => {
    const g = G(p.x, p.y);
    p.top = g + 10.4;
    m4.compose(v3.set(p.x, g - 0.3, -p.y), q.identity(), sc.set(1, 11, 1));
    poles.setMatrixAt(i, m4);
    boxes.add(wood, p.x, g + 10.1, -p.y, 0.14, 0.14, 2.6, ang(p.ny, -p.nx));
    colliders.addCircle(p.x, -p.y, 0.3, 'pole', g + 11);
    if (p.light) {
      // Arm reaching over the road (toward it: -n)
      const ax = p.x - p.nx * 1.4, ay = p.y - p.ny * 1.4;
      boxes.add(0x8d9096, ax, g + 8.4, -ay, 2.8, 0.1, 0.1, ang(-p.nx, -p.ny), 0.08);
      const hx = p.x - p.nx * 2.9, hy = p.y - p.ny * 2.9;
      boxes.add(0x8d9096, hx, g + 8.5, -hy, 0.9, 0.22, 0.42, ang(-p.nx, -p.ny));
      boxes.add(0xfff2c8, hx, g + 8.38, -hy, 0.7, 0.04, 0.3, ang(-p.nx, -p.ny));
    }
    const nxt = plan.poles[i + 1];
    if (nxt && nxt.chain === p.chain && Math.hypot(nxt.x - p.x, nxt.y - p.y) < 75) {
      const gn = G(nxt.x, nxt.y) + 10.4;
      for (const o of [-1.1, 0, 1.1]) {
        const ax = p.x + p.nx * o, ay = p.y + p.ny * o, bx = nxt.x + nxt.nx * o, by = nxt.y + nxt.ny * o; // along the crossarms
        let prev = null;
        for (let k = 0; k <= 8; k++) {
          const t = k / 8;
          const pt = [ax + (bx - ax) * t, p.top + 0.1 + (gn - p.top) * t - 0.7 * 4 * t * (1 - t), -(ay + (by - ay) * t)];
          if (prev) wire.push(...prev, ...pt);
          prev = pt;
        }
      }
    }
  });
  poles.count = plan.poles.length;
  poles.castShadow = shadows;
  scene.add(poles);
  if (wire.length) {
    const wg = new THREE.BufferGeometry();
    wg.setAttribute('position', new THREE.Float32BufferAttribute(wire, 3));
    scene.add(new THREE.LineSegments(wg, new THREE.LineBasicMaterial({ color: 0x2a2a2a })));
  }

  // Fences and walls
  for (const f of plan.fences) {
    for (const s of f.segs) {
      const L = Math.hypot(s.x1 - s.x0, s.y1 - s.y0);
      const tx = (s.x1 - s.x0) / L, ty = (s.y1 - s.y0) / L, a = ang(tx, ty);
      const g0 = G(s.x0, s.y0), g1 = G(s.x1, s.y1), tilt = Math.atan2(g1 - g0, L);
      const mx = (s.x0 + s.x1) / 2, my = (s.y0 + s.y1) / 2, gm = (g0 + g1) / 2;
      const run = (color, h, y, thick, out = 0) => boxes.add(color, mx + s.nx * out, gm + y, -(my + s.ny * out), L + 0.05, h, thick, a, tilt);
      const post = (color, h, w, out = 0) => boxes.add(color, s.x0 + s.nx * out, g0 + h / 2 - 0.1, -(s.y0 + s.ny * out), w, h + 0.2, w, a);
      const rails = (color, ys, out = 0, t = 0.1) => ys.forEach((y) => run(color, t, y, t, out));
      switch (f.kind) {
        case 'blockRail':
          run(0xcbb48e, 1.0, 0.3, 0.35); post(0x8b6a4e, 1.9, 0.15); rails(0x8b6a4e, [1.25, 1.65]); break;
        case 'vinylRanch':
          post(0xf4f4f2, 1.2, 0.13); rails(0xf4f4f2, [0.4, 0.75, 1.1], 0, 0.14); break;
        case 'pipeRail':
          post(0xf0f0ee, 1.0, 0.07); rails(0xf0f0ee, [0.5, 1.0], 0, 0.06); break;
        case 'lowWallHedge':
          run(0xcfc3ae, 0.6, 0.2, 0.3); run(0x4f6b34, 1.1, 0.55, 0.9, 0.85); run(0x9a3d2e, 0.12, 1.12, 0.8, 0.85); break;
        case 'railWindscreen':
          post(0x8b6a4e, 1.1, 0.15); rails(0x8b6a4e, [0.5, 0.95]);
          run(0x1f2a3a, 2.5, 1.25, 0.05, 1.6); run(0xe7b416, 0.08, 2.5, 0.09, 1.6); post(0x6a6e72, 2.5, 0.08, 1.6);
          colliders.addPoly([[s.x0 + s.nx * 1.4, -(s.y0 + s.ny * 1.4)], [s.x1 + s.nx * 1.4, -(s.y1 + s.ny * 1.4)], [s.x1 + s.nx * 1.8, -(s.y1 + s.ny * 1.8)], [s.x0 + s.nx * 1.8, -(s.y0 + s.ny * 1.8)]], 'fence');
          break;
        case 'brickIron':
          post(0xa5553a, 1.6, 0.6); boxes.add(0x7d3f2a, s.x0, g0 + 1.62, -s.y0, 0.72, 0.12, 0.72, a);
          run(0x2b2b2b, 1.2, 0.75, 0.05);
          if (Math.round(s.x0 * 3) % 4 === 0) { boxes.add(black, s.x0, g0 + 1.95, -s.y0, 0.08, 0.5, 0.08, a); boxes.add(0xffe2a0, s.x0, g0 + 2.3, -s.y0, 0.3, 0.35, 0.3, a); }
          break;
        case 'splitRail':
          post(0x9a7350, 1.0, 0.15); rails(0x9a7350, [0.45, 0.85]); break;
        case 'privacy':
          post(0xbfb098, 1.85, 0.12); run(0xcfc0a8, 1.8, 0.9, 0.06); break;
      }
      colliders.addPoly([[s.x0 - s.nx * 0.2, -(s.y0 - s.ny * 0.2)], [s.x1 - s.nx * 0.2, -(s.y1 - s.ny * 0.2)], [s.x1 + s.nx * 0.2, -(s.y1 + s.ny * 0.2)], [s.x0 + s.nx * 0.2, -(s.y0 + s.ny * 0.2)]], 'fence');
    }
  }

  // Drive entrances: stacked-stone pillars with a low wooden rail, lanterns, plaques, signs
  for (const gt of plan.gates) {
    for (const side of [-1, 1]) {
      const off = gt.w / 2 + 1.1;
      const px = gt.x + gt.nx * off * side, py = gt.y + gt.ny * off * side;
      const g = G(px, py), a = ang(gt.tx, gt.ty);
      boxes.add(stone, px, g + 0.75, -py, 1.0, 1.9, 1.0, a);
      boxes.add(cap, px, g + 1.75, -py, 1.2, 0.15, 1.2, a);
      colliders.addCircle(px, -py, 0.75);
      if (gt.lanterns) { boxes.add(black, px, g + 2.1, -py, 0.1, 0.6, 0.1, a); boxes.add(0xffe2a0, px, g + 2.5, -py, 0.34, 0.45, 0.34, a); }
      // Low rail running along the street away from the drive
      const ex = px + gt.nx * 3.6 * side, ey = py + gt.ny * 3.6 * side;
      if (!nearRoad(ex, ey, 0.5, ROADS) && !nearBuilding(ex, ey, 0.5)) {
        const mx = (px + ex) / 2, my = (py + ey) / 2, gm = G(mx, my);
        for (const y of [0.45, 0.85]) boxes.add(0x8b6a4e, mx, gm + y, -my, 0.1, 0.1, 3.6, a);
        boxes.add(0x8b6a4e, ex, G(ex, ey) + 0.5, -ey, 0.15, 1.1, 0.15, a);
        colliders.addPoly([[px, -py], [ex, -ey], [ex - gt.tx * 0.3, -(ey - gt.ty * 0.3)], [px - gt.tx * 0.3, -(py - gt.ty * 0.3)]], 'rail');
      }
      if (gt.plaque && side === 1) {
        const bx = px - gt.tx * 0.52, by = py - gt.ty * 0.52;
        face(scene, mat(0x8c6a32, { emissive: 0x1a1206 }), bx, g + 1.15, -by, 0.45, 0.55, Math.atan2(-gt.tx, gt.ty));
      }
    }
    if (gt.directory) {
      const off = gt.w / 2 + 6;
      const [sx, sy] = [gt.x + gt.nx * off - gt.tx * 0.5, gt.y + gt.ny * off - gt.ty * 0.5];
      if (!nearRoad(sx, sy, 0.8) && !nearBuilding(sx, sy, 1)) standingSign(world, boxes, sx, sy, -gt.tx, -gt.ty, gt.directory, 'stone');
    }
    if (gt.driveLamps) {
      for (let s = gt.s0 + 6; s < gt.s0 + 75; s += 14) {
        const p = pointAt(gt.pts, s);
        for (const side of [-1, 1]) {
          const lx = p.x - p.ty * side * (gt.w / 2 + 1.3), ly = p.y + p.tx * side * (gt.w / 2 + 1.3);
          if (nearRoad(lx, ly, 0.4) || nearBuilding(lx, ly, 1) || inLot(lx, ly)) continue;
          const g = G(lx, ly);
          boxes.add(stone, lx, g + 0.35, -ly, 0.6, 0.9, 0.6, 0);
          boxes.add(black, lx, g + 2.1, -ly, 0.12, 2.8, 0.12, 0);
          boxes.add(0xffe2a0, lx, g + 3.6, -ly, 0.36, 0.5, 0.36, 0);
          boxes.add(black, lx, g + 3.9, -ly, 0.48, 0.1, 0.48, 0);
          colliders.addCircle(lx, -ly, 0.35);
        }
      }
    }
  }

  // Flower and shrub beds
  const small = [];
  for (const b of plan.beds) {
    const n = Math.round(b.r * 3);
    for (let i = 0; i < n; i++) {
      const a = i * 2.4, r = Math.sqrt((i + 0.5) / n) * b.r * 0.85;
      const x = b.x + Math.cos(a) * r, y = b.y + Math.sin(a) * r;
      if (world.pavedAt(x, y, 0.5)) continue;
      small.push([x, y, 0.45 + ((i * 37) % 5) * 0.08, b.colors[i % b.colors.length]]);
    }
    if (b.boulders) for (let i = 0; i < 3; i++) {
      const a = i * 2.1 + 0.5, x = b.x + Math.cos(a) * b.r * 0.6, y = b.y + Math.sin(a) * b.r * 0.6;
      if (world.pavedAt(x, y, 0.6)) continue;
      boxes.add(0x9a9288, x, G(x, y) + 0.25, -y, 0.9, 0.6, 0.8, a, 0.2, 0.15);
    }
  }
  if (small.length) {
    const inst = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 0), new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true }), small.length);
    small.forEach(([x, y, s, c], i) => {
      m4.compose(v3.set(x, G(x, y) + s * 0.5, -y), q.identity(), sc.set(s, s * 0.8, s));
      inst.setMatrixAt(i, m4); inst.setColorAt(i, new THREE.Color(c));
    });
    scene.add(inst);
  }

  // Props
  for (const p of PROPS) {
    const [x0, y0] = toCampus(p.at);
    if (p.kind === 'flagpoles') {
      const st = nearestRoad(STREET_ROADS, x0, y0);
      const flagMats = [new THREE.MeshLambertMaterial({ color: 0x1f3a6e, side: THREE.DoubleSide }), new THREE.MeshLambertMaterial({ color: 0xf4f4f4, side: THREE.DoubleSide })];
      for (let k = 0; k < p.count; k++) {
        const d = (k - (p.count - 1) / 2) * 3.5;
        const [x, y] = [x0 + st.tx * d, y0 + st.ty * d];
        if (world.pavedAt(x, y, 0.4)) continue;
        const g = G(x, y);
        boxes.add(0xe8e8e8, x, g + 4.5, -y, 0.14, 9, 0.14, 0);
        boxes.add(0xd4af37, x, g + 9.05, -y, 0.22, 0.22, 0.22, 0);
        const fl = new THREE.Mesh(PLANE, flagMats[k % 2]);
        fl.scale.set(1.6, 1.0, 1); fl.position.set(x + st.tx * 0.85, g + 8.3, -(y + st.ty * 0.85)); fl.rotation.y = Math.atan2(st.ty, st.tx);
        scene.add(fl);
        colliders.addCircle(x, -y, 0.2, 'flagpole', g + 9.3);
      }
    } else if (p.kind === 'hydrant') {
      const [x, y] = offRoad(x0, y0, 1.6);
      const g = G(x, y);
      const yel = 0xe6c229;
      const body = new THREE.Mesh(GEOM.cyl, mat(yel)); body.scale.set(0.32, 0.75, 0.32); body.position.set(x, g + 0.38, -y); scene.add(body);
      const top = new THREE.Mesh(GEOM.sphere, mat(yel)); top.scale.set(0.34, 0.25, 0.34); top.position.set(x, g + 0.78, -y); scene.add(top);
      boxes.add(yel, x, g + 0.5, -y, 0.55, 0.12, 0.12, 0);
      const st = nearestRoad(ROADS, x, y);
      for (const d of [-1.1, 1.1]) {
        const bx = x + st.tx * d, by = y + st.ty * d;
        const bo = new THREE.Mesh(GEOM.cyl, mat(yel)); bo.scale.set(0.18, 1, 0.18); bo.position.set(bx, G(bx, by) + 0.5, -by); scene.add(bo);
        colliders.addCircle(bx, -by, 0.15);
      }
      colliders.addCircle(x, -y, 0.25);
    } else if (p.kind === 'lotLights') {
      let lot = null, bd = Infinity;
      for (const l of CAMPUS.lots) { const d = pointInPoly(x0, y0, l.poly) ? 0 : Math.min(...l.poly.map(([x, y]) => Math.hypot(x - x0, y - y0))); if (d < bd) { bd = d; lot = l; } }
      if (!lot) continue;
      const ring = [...lot.poly, lot.poly[0]];
      const L = pathLength(ring);
      for (let s = 5; s < L; s += 28) {
        const pt = pointAt(ring, s);
        let nx = -pt.ty, ny = pt.tx;
        if (!pointInPoly(pt.x + nx, pt.y + ny, lot.poly)) { nx = -nx; ny = -ny; }
        const x = pt.x + nx * 0.6, y = pt.y + ny * 0.6;
        if (nearRoad(x, y, 0.5) || nearBuilding(x, y, 1)) continue;
        if (world.data.stalls.some((st) => Math.hypot(st[0] - x, st[1] - y) < 3.2)) continue;
        if (Math.hypot(x - world.places.helipad[0], y + world.places.helipad[1]) < 9) continue;
        const g = G(x, y);
        boxes.add(black, x, g + 4.5, -y, 0.2, 9, 0.2, 0);
        boxes.add(black, x + nx * 0.5, g + 9, -(y + ny * 0.5), 1.2, 0.25, 0.5, ang(nx, ny));
        boxes.add(0xfff2c8, x + nx * 0.5, g + 8.86, -(y + ny * 0.5), 1.0, 0.04, 0.38, ang(nx, ny));
        colliders.addCircle(x, -y, 0.25, 'light', g + 9.3);
      }
    } else if (p.kind === 'trashBins') {
      const [x, y] = offRoad(x0, y0, 1.4);
      const st = nearestRoad(ROADS, x, y);
      for (const d of [-0.45, 0.45]) {
        const bx = x + st.tx * d, by = y + st.ty * d, g = G(bx, by);
        boxes.add(0x2e6b3a, bx, g + 0.5, -by, 0.6, 1.0, 0.7, ang(st.tx, st.ty));
        boxes.add(0x24552e, bx, g + 1.03, -by, 0.64, 0.06, 0.74, ang(st.tx, st.ty));
      }
      colliders.addCircle(x, -y, 0.8);
    } else if (p.kind === 'bikeRack') {
      // Nearest open spot to the noted point
      let spot = null;
      for (let r = 0; r < 40 && !spot; r += 1.5) {
        for (let k = 0; k < 12; k++) {
          const x = x0 + Math.cos(k * 0.52) * r, y = y0 + Math.sin(k * 0.52) * r;
          if (!nearBuilding(x, y, 2) && !nearRoad(x, y, 1) && !colliders.pointBlocked(x, -y, 1.5)) { spot = [x, y]; break; }
        }
      }
      if (!spot) continue;
      const [x, y] = spot, g = G(x, y);
      for (let k = 0; k < 3; k++) {
        const bx = x + k * 0.9;
        boxes.add(0x8d9096, bx, g + 0.4, -(y - 0.35), 0.06, 0.8, 0.06, 0);
        boxes.add(0x8d9096, bx, g + 0.4, -(y + 0.35), 0.06, 0.8, 0.06, 0);
        boxes.add(0x8d9096, bx, g + 0.8, -y, 0.06, 0.06, 0.76, 0);
      }
      colliders.addCircle(x + 0.9, -y, 1.2);
    }
  }

  boxes.flush(scene, shadows);
}
