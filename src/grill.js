// The Mustang Grill's decks on the Dunkin Student Center, from photos of the building
// (written observations, no imagery copied). The Grill is the dining hall upstairs; its deck
// sits in the notch on the north side where the entrance wing meets the main building (the
// LiDAR sees it there as two unmapped structures), looking out over Placerita Canyon Rd:
//
// - a big timber gable pavilion over the deck, gable end out, its open king-post truss and
//   knee braces in dark-stained timber, carried on tall stacked-stone piers with pale caps
//   and lantern sconces that run from the lower patio all the way up
// - a pergola deck running east along the building: stone piers rising past the rail to
//   doubled beams, a row of rafters from the wall out past them
// - a deep brown fascia round the deck edge (a "2" on it), brown wood posts and top rail with
//   black metal picket panels between, slatted wood tables, ladder-back chairs and patio
//   heaters up top
// - under it all, the lower patio: warm downlights, stone-clad walls by the doors, cafe
//   tables, and in front, stone lantern bollards among ornamental grasses, red yucca spikes
//   and boulders
import * as THREE from 'three';
import { heightAtCampus } from './terrain.js';
import { mat, GEOM } from './models.js';
import { pointInPoly } from './physics.js';

const TIMBER = 0x4a3426, ROOF = 0x4e3b30, RAIL = 0x1e1e1e, CAP = 0xd8ccb2, DECK = 0x8d8476;
const UNDER = 0x7a5f48, TABLE = 0x5a3a26, STEEL = 0xb9bcbf, IRON = 0x2b2724;
const UP = new THREE.Vector3(0, 1, 0);

// ---- plan: the deck's outline in a frame squared up with the building ----

export function planMustangGrill(world) {
  const b = world.buildings.find((q) => q.id === 'dunkin');
  if (!b) return;
  const find = (x, y) => b.poly.find((p) => Math.hypot(p[0] - x, p[1] - y) < 2.5);
  // the corner where the main north wall steps out, its east end, the jog and the wing
  const o = find(193.9, -88.1), e = find(206.9, -91.7), jog = find(194.3, -86.7), wing = find(188.5, -85.1);
  if (!o || !e || !jog || !wing) return;
  const L = Math.hypot(e[0] - o[0], e[1] - o[1]);
  const tx = (e[0] - o[0]) / L, ty = (e[1] - o[1]) / L; // u: along the wall, east
  const nx = -ty, ny = tx; // v: out from the wall, north
  const P = (u, v) => [o[0] + tx * u + nx * v, o[1] + ty * u + ny * v];
  const U = (p) => (p[0] - o[0]) * tx + (p[1] - o[1]) * ty, V = (p) => (p[0] - o[0]) * nx + (p[1] - o[1]) * ny;
  const u0 = U(wing), jogV = V(jog); // the wing's east face; the jog in the wall
  const u1 = 3; // east side of the pavilion
  const vP = 9.4; // how far the pavilion reaches out
  const vD = 4.6; // depth of the pergola deck
  const local = [[u0, jogV], [0, jogV], [0, 0], [L, 0], [L, vD], [u1, vD], [u1, vP], [u0, vP]];
  const deck = local.map(([u, v]) => P(u, v));
  // The lower patio: the deck's footprint plus a margin out front, paved (trees keep off)
  const m = 1.8;
  const patio = [[u0, jogV], [0, jogV], [0, 0], [L + m, 0], [L + m, vD + m], [u1 + m, vD + m], [u1 + m, vP + m], [u0, vP + m]].map(([u, v]) => P(u, v));
  world.plazas.push(patio);
  world.grill = {
    b, P, U, V, tx, ty, nx, ny, L, u0, u1, jogV, vP, vD, deck, patio, local,
    covers: (x, y) => pointInPoly(x, y, patio),
  };
}

// ---- textures and merged geometry ----

let stoneTex = null;
function ledgerStone() {
  if (stoneTex) return stoneTex;
  const c = document.createElement('canvas');
  c.width = 256; c.height = 256;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#433b33'; ctx.fillRect(0, 0, 256, 256);
  let seed = 11;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  // stacked ledger stone: long thin stones in warm browns, tans and slate grays
  const tones = ['#8d7b66', '#6f6254', '#a69178', '#5d544b', '#9a8670', '#7d6e60', '#b39c80', '#6a6a66', '#8a7a6e'];
  for (let y = 0; y < 256;) {
    const h = 7 + rnd() * 12;
    for (let x = -rnd() * 50; x < 256;) {
      const w = 24 + rnd() * 70;
      ctx.fillStyle = tones[Math.floor(rnd() * tones.length)];
      ctx.fillRect(x + 1.5, y + 1.5, w - 3, h - 3);
      ctx.fillStyle = 'rgba(255,255,255,0.10)'; ctx.fillRect(x + 1.5, y + 1.5, w - 3, 2);
      ctx.fillStyle = 'rgba(0,0,0,0.18)'; ctx.fillRect(x + 1.5, y + h - 3.5, w - 3, 2);
      x += w;
    }
    y += h;
  }
  stoneTex = new THREE.CanvasTexture(c);
  stoneTex.colorSpace = THREE.SRGBColorSpace;
  stoneTex.wrapS = stoneTex.wrapT = THREE.RepeatWrapping;
  stoneTex.anisotropy = 4;
  return stoneTex;
}

// Boxes merged into one mesh with UVs in meters, so a texture keeps its scale on every face
class Merge {
  constructor(scale = 1.3) { this.pos = []; this.nrm = []; this.uv = []; this.scale = scale; this.m4 = new THREE.Matrix4(); this.q = new THREE.Quaternion(); }
  add(x, y, z, w, h, d, ry = 0) {
    const g = new THREE.BoxGeometry(w, h, d).toNonIndexed();
    const uv = g.getAttribute('uv');
    const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]]; // +x -x +y -y +z -z
    for (let i = 0; i < uv.count; i++) { const f = dims[Math.floor(i / 6)]; uv.setXY(i, uv.getX(i) * f[0] / this.scale, uv.getY(i) * f[1] / this.scale + y * 0.37); }
    g.applyMatrix4(this.m4.compose(new THREE.Vector3(x, y, z), this.q.setFromAxisAngle(UP, ry), new THREE.Vector3(1, 1, 1)));
    this.pos.push(...g.getAttribute('position').array); this.nrm.push(...g.getAttribute('normal').array); this.uv.push(...uv.array);
  }
  mesh(material, shadows) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.computeBoundingSphere();
    const m = new THREE.Mesh(g, material);
    m.castShadow = shadows; m.receiveShadow = true;
    return m;
  }
}

// Many copies of one shape in one color, drawn as an instanced mesh
class Instances {
  constructor() { this.sets = new Map(); this.e = new THREE.Euler(0, 0, 0, 'YXZ'); this.q = new THREE.Quaternion(); }
  add(key, geo, material, x, y, z, sx, sy, sz, ry = 0, rz = 0, rx = 0) {
    let s = this.sets.get(key);
    if (!s) this.sets.set(key, (s = { geo, material, list: [] }));
    this.e.set(rx, ry, rz);
    s.list.push(new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), this.q.setFromEuler(this.e).clone(), new THREE.Vector3(sx, sy, sz)));
  }
  flush(scene, shadows) {
    for (const { geo, material, list } of this.sets.values()) {
      const m = new THREE.InstancedMesh(geo, material, list.length);
      list.forEach((mm, i) => m.setMatrixAt(i, mm));
      m.castShadow = shadows && !material.isMeshBasicMaterial; m.receiveShadow = !material.isMeshBasicMaterial;
      scene.add(m);
    }
  }
}

// An ornamental grass clump: a fountain of thin blades
function grassGeometry() {
  const pos = [];
  let seed = 5;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let k = 0; k < 16; k++) {
    const a = (k / 16) * Math.PI * 2 + rnd() * 0.4, lean = 0.25 + rnd() * 0.45, h = 0.75 + rnd() * 0.35;
    const ca = Math.cos(a), sa = Math.sin(a), w = 0.045;
    const tip = [ca * lean, h, sa * lean];
    pos.push(-sa * w, 0, ca * w, sa * w, 0, -ca * w, ...tip);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

// ---- build ----

export function buildMustangGrill(world, boxes) {
  const G = world.grill;
  if (!G) return;
  const { b, P, tx, ty, L, u0, u1, jogV, vP, vD } = G;
  const scene = world.scene, colliders = world.colliders, shadows = !world.lowSpec;
  const A = Math.atan2(ty, tx); // heading that lays a box's local x along u
  const y0 = b.base + 0.3 + (b.floorH || 4.4); // the deck, level with the Grill's floor
  const gAt = (u, v) => heightAtCampus(...P(u, v));
  // A box in the deck frame: center (u, v), center height y, sizes along u / up / along v,
  // tilted rz about the v axis (positive lifts its +u end)
  const B = (color, u, v, y, su, sy, sv, rz = 0) => { const [x, yy] = P(u, v); boxes.add(color, x, y, -yy, su, sy, sv, A, rz); };
  // A member between two points in the u-y plane at depth v
  const member = (color, v, ua, ya, ub, yb, t, d = t) => {
    const len = Math.hypot(ub - ua, yb - ya);
    B(color, (ua + ub) / 2, v, (ya + yb) / 2, len, t, d, Math.atan2(yb - ya, ub - ua));
  };
  const stone = new Merge(1.3);
  const inst = new Instances();
  const glowMat = new THREE.MeshBasicMaterial({ color: 0xffd898 });
  const glow = (u, v, y, su, sy, sv) => { const [x, yy] = P(u, v); inst.add('glow', GEOM.box, glowMat, x, y, -yy, su, sy, sv, A); };
  const S = (u, v, yBot, yTop, w = 0.8, d = w) => { const [x, yy] = P(u, v); stone.add(x, (yBot + yTop) / 2, -yy, w, yTop - yBot, d, A); };

  // -- the deck: a slab level with the Grill's floor, its underside warm-lit wood --
  {
    const shape = new THREE.Shape(G.deck.map(([x, y]) => new THREE.Vector2(x, y)));
    const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.32, bevelEnabled: false });
    geo.rotateX(-Math.PI / 2); // shape (x, y) -> world (x, 0, -y), extruded up
    const m = new THREE.Mesh(geo, mat(DECK));
    m.position.y = y0 - 0.32;
    m.castShadow = shadows; m.receiveShadow = true;
    scene.add(m);
    const under = new THREE.Mesh(new THREE.ShapeGeometry(shape).rotateX(Math.PI / 2), mat(UNDER, { side: THREE.DoubleSide }));
    under.position.y = y0 - 0.34; under.scale.z = -1; // ShapeGeometry rotated +x maps y -> +z: flip back
    scene.add(under);
    // decking boards: thin seams across the planks
    for (let u = u0 + 0.6; u < L; u += 1.2) {
      const vTop = u < u1 ? vP : vD, vBot = u < 0 ? jogV : 0;
      B(0x7b7468, u, (vTop + vBot) / 2, y0 + 0.005, 0.03, 0.01, vTop - vBot - 0.1);
    }
  }

  // The deck's outer edges, in order, each with its railing and fascia
  const edges = [[[L, 0], [L, vD]], [[L, vD], [u1, vD]], [[u1, vD], [u1, vP]], [[u1, vP], [u0, vP]]];
  for (const [[ua, va], [ub, vb]] of edges) {
    const len = Math.hypot(ub - ua, vb - va), du = (ub - ua) / len, dv = (vb - va) / len;
    const alongU = Math.abs(du) > 0.5;
    const cu = (ua + ub) / 2, cv = (va + vb) / 2;
    // deep brown fascia round the edge
    B(TIMBER, cu, cv, y0 - 0.45, alongU ? len + 0.25 : 0.25, 1.0, alongU ? 0.25 : len + 0.25);
    // railing set just inside the edge: brown posts and top rail, black picket panels
    const inU = alongU ? 0 : -0.12, inV = alongU ? -0.12 : 0; // the deck lies toward -u / -v of every outer edge
    const ru = cu + inU, rv = cv + inV;
    B(TIMBER, ru, rv, y0 + 1.07, alongU ? len : 0.16, 0.07, alongU ? 0.16 : len);
    B(RAIL, ru, rv, y0 + 0.95, alongU ? len : 0.05, 0.05, alongU ? 0.05 : len);
    B(RAIL, ru, rv, y0 + 0.13, alongU ? len : 0.05, 0.05, alongU ? 0.05 : len);
    const nPost = Math.max(1, Math.round(len / 1.9));
    for (let k = 0; k <= nPost; k++) { const t = k / nPost; B(TIMBER, ua + (ub - ua) * t + inU, va + (vb - va) * t + inV, y0 + 0.55, 0.13, 1.1, 0.13); }
    for (let d = 0.1; d < len; d += 0.12) B(RAIL, ua + du * d + inU, va + dv * d + inV, y0 + 0.54, 0.022, 0.82, 0.022);
  }
  // the deck's level number on the fascia, as in the photos
  {
    const c = document.createElement('canvas'); c.width = 64; c.height = 96;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#2c3a48'; ctx.font = 'bold 84px Georgia, serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('2', 32, 52);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
    const [x, y] = P(u1 + 2.2, vD + 0.14);
    const s = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.6), new THREE.MeshLambertMaterial({ map: t, transparent: true }));
    s.position.set(x, y0 - 0.45, -y); s.rotation.y = Math.atan2(G.nx, -G.ny);
    scene.add(s);
  }

  // -- stacked-stone piers, from the lower patio up --
  const pier = (u, v, top, w = 0.85, lights = true) => {
    const g = Math.min(gAt(u, v), b.base + 0.3) - 0.25;
    S(u, v, g, top, w);
    B(CAP, u, v, top + 0.06, w + 0.14, 0.12, w + 0.14); // pale cap
    const [x, y] = P(u, v);
    colliders.addCircle(x, -y, w * 0.62, 'pier', top + 0.2);
    if (!lights) return;
    // lantern sconces on the outward face: one up by the cap, one down on the patio
    for (const ly of [top - 0.55, Math.min(gAt(u, v) + 2.6, y0 - 1.1)]) {
      B(IRON, u, v + w / 2 + 0.06, ly, 0.26, 0.36, 0.12);
      glow(u, v + w / 2 + 0.13, ly, 0.18, 0.24, 0.04);
    }
  };
  const hP = y0 + 3.25; // pavilion pier tops
  const hG = y0 + 2.75; // pergola pier tops
  pier(u0 + 0.55, vP - 0.45, hP, 1.0);
  pier(u1 - 0.5, vP - 0.45, hP, 1.0);
  pier((u0 + u1) / 2, vP - 0.4, y0 + 1.2, 0.75); // mid pier: up past the rail
  pier(u1 - 0.45, vD - 0.4, hG);
  pier((u1 + L) / 2, vD - 0.4, hG);
  pier(L - 0.45, vD - 0.4, hG);
  // smaller piers under the deck, near the wall
  for (const [u, v] of [[u0 + 0.5, (jogV + vP) / 2], [(u1 + L) / 2, 0.6]]) pier(u, v, y0 - 0.35, 0.6, false);

  // -- the timber gable pavilion --
  {
    const uc = (u0 + u1) / 2, hw = (u1 - u0) / 2 + 1.0; // half span incl. the overhang
    const yE = hP + 0.75; // eave: the top of the beam on the piers
    const rise = hw * 0.8;
    const yR = yE + rise;
    const vBack = -1.2, vFront = vP + 1.4, depth = vFront - vBack, vMid = (vBack + vFront) / 2;
    // beams on the pier tops: across the front and down each side to the wall
    B(TIMBER, uc, vP - 0.45, hP + 0.38, u1 - u0 + 1.4, 0.62, 0.42);
    for (const u of [u0 + 0.55, u1 - 0.5]) B(TIMBER, u, (jogV + vP) / 2 - 0.2, hP + 0.38, 0.38, 0.55, vP - jogV + 0.6);
    // the roof: two slopes of dark brown shingle, a thick barge board along each gable edge
    const slope = Math.atan2(rise, hw), sl = Math.hypot(hw, rise);
    for (const s of [-1, 1]) {
      B(ROOF, uc + s * hw / 2, vMid, yE + rise / 2 + 0.12, sl + 0.25, 0.2, depth, -s * slope);
      B(TIMBER, uc + s * hw / 2, vFront + 0.08, yE + rise / 2 + 0.02, sl + 0.2, 0.42, 0.16, -s * slope);
      // purlins and rafters under the roof, seen from the deck
      for (const f of [0.25, 0.55, 0.85]) B(TIMBER, uc + s * hw * (1 - f), vMid, yE + rise * f - 0.12, 0.2, 0.24, depth - 0.3);
      for (let v = vBack + 0.8; v < vFront; v += 1.6) member(TIMBER, v, uc + s * (hw - 0.3), yE - 0.05, uc, yR - 0.25, 0.16, 0.14);
    }
    B(TIMBER, uc, vMid, yR - 0.05, 0.3, 0.32, depth); // ridge beam
    // the open king-post truss at the gable end, and a second one inside
    for (const v of [vP - 0.45, vP / 2]) {
      B(TIMBER, uc, v, yE - 0.05, (u1 - u0) + 1.2, 0.4, 0.3); // tie beam
      B(TIMBER, uc, v, (yE + yR) / 2, 0.32, yR - yE, 0.3); // king post
      for (const s of [-1, 1]) {
        member(TIMBER, v, uc, yE + 0.25, uc + s * hw * 0.55, yE + rise * 0.45, 0.24, 0.26); // struts
        member(TIMBER, v, uc + s * (hw - 0.2), yE - 0.05, uc, yR - 0.2, 0.3, 0.32); // principal rafters
      }
      B(TIMBER, uc, v, yE + rise * 0.6, hw * 0.75, 0.24, 0.26); // collar
    }
    // knee braces from the front piers up to the beam
    member(TIMBER, vP - 0.45, u1 - 0.5, hP - 0.9, u1 - 1.9, hP + 0.2, 0.18, 0.2);
    member(TIMBER, vP - 0.45, u0 + 0.55, hP - 0.9, u0 + 1.95, hP + 0.2, 0.18, 0.2);
    // the back gable, closed in stucco where it rises over the building's roof
    const tri = new THREE.Shape([new THREE.Vector2(-hw + 0.3, 0), new THREE.Vector2(hw - 0.3, 0), new THREE.Vector2(0, rise - 0.25)]);
    const geo = new THREE.ExtrudeGeometry(tri, { depth: 1.6, bevelEnabled: false });
    const m = new THREE.Mesh(geo, mat(0xcbb89a));
    const [bx, by] = P(uc, vBack + 0.2);
    m.position.set(bx, yE - 0.05, -by);
    // shape x along -u (the triangle is symmetric; this keeps the frame right-handed),
    // extrusion out along +v
    m.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(new THREE.Vector3(-tx, 0, ty), UP, new THREE.Vector3(G.nx, 0, -G.ny)));
    m.castShadow = shadows;
    scene.add(m);
  }

  // -- the pergola over the deck to the east --
  {
    const ua = u1 - 0.45, ub = L + 0.7;
    for (const dv of [-0.3, 0.3]) B(TIMBER, (ua + ub) / 2, vD - 0.4 + dv, hG + 0.3, ub - ua + 0.4, 0.36, 0.11); // doubled beams
    B(TIMBER, (ua + ub) / 2, 0.12, hG + 0.3, ub - ua, 0.32, 0.18); // ledger on the wall
    for (let u = u1 + 0.1; u < L + 0.5; u += 0.6) {
      B(TIMBER, u, vD / 2 + 0.25, hG + 0.6, 0.11, 0.28, vD + 1.3); // rafters out past the beams
    }
    // angled tails: the rafter ends cut back underneath
    for (let u = u1 + 0.1; u < L + 0.5; u += 0.6) {
      const [x, y] = P(u, vD + 0.85);
      boxes.add(TIMBER, x, hG + 0.52, -y, 0.11, 0.14, 0.35, A, 0, 0.5);
    }
  }

  // -- stone on the lower walls by the doors, under the pavilion --
  {
    const g0 = b.base + 0.1, top = y0 - 0.36;
    S(u0 + 0.12, (jogV + vP) / 2 + 0.5, g0, top, 0.24, vP - jogV - 1.2); // wing face
    S(-1.6, jogV + 0.12, g0, top, 2.4, 0.24); // the wall at the back of the notch
    S(2.0, 0.12, g0, top, 1.6, 0.24);
  }

  // -- the lower patio: downlights under the deck, cafe tables --
  for (let u = u0 + 1.6; u < L - 0.8; u += 2.8) {
    for (let v = 1.4; v < (u < u1 ? vP : vD) - 0.8; v += 2.8) {
      if (u < 0 && v < jogV + 0.5) continue;
      glow(u, v, y0 - 0.37, 0.26, 0.03, 0.26);
    }
  }
  const chair = (u, v, yb, face, color) => {
    // ladder-back chair facing local direction `face` (radians in the u-v plane): legs, a
    // seat, two back posts with a top rail and vertical slats between
    const cu = Math.cos(face), cv = Math.sin(face);
    const at = (f, sd) => P(u + cu * f - cv * sd, v + cv * f + cu * sd); // f: forward, sd: sideways
    const rot = A + face + Math.PI / 2; // local x across the chair
    const put = (f, sd, y, w, h, d) => { const [x, yy] = at(f, sd); boxes.add(color, x, yb + y, -yy, w, h, d, rot); };
    put(0, 0, 0.45, 0.44, 0.05, 0.42);
    for (const sd of [-0.19, 0.19]) { put(0.18, sd, 0.22, 0.045, 0.44, 0.045); put(-0.19, sd, 0.49, 0.05, 0.98, 0.05); }
    put(-0.19, 0, 0.93, 0.42, 0.08, 0.04);
    for (const sd of [-0.11, -0.037, 0.037, 0.11]) put(-0.19, sd, 0.69, 0.035, 0.42, 0.02);
  };
  const table = (u, v, yb, { round = false, w = 1.6, d = 0.85, h = 0.76, color = TABLE, seats = 4, chairColor = 0x4e3322 } = {}) => {
    const [x, y] = P(u, v);
    if (round) inst.add('rtop' + color, GEOM.cyl, mat(color), x, yb + h - 0.03, -y, w, 0.05, w);
    else {
      B(color, u, v, yb + h - 0.03, w, 0.05, d);
      for (let k = 1; k < 6; k++) B(0x3a2618, u - w / 2 + (w * k) / 6, v, yb + h - 0.005, 0.02, 0.01, d - 0.02); // slat gaps
    }
    B(IRON, u, v, yb + (h - 0.05) / 2, 0.08, h - 0.05, 0.08);
    B(IRON, u, v, yb + 0.02, round ? 0.5 : 0.7, 0.04, round ? 0.5 : 0.55);
    colliders.addCircle(x, -y, round ? w / 2 + 0.1 : 0.85, 'table', yb + h);
    const r = round ? w / 2 + 0.38 : null;
    const spots = round ? [0, 1, 2, 3].slice(0, seats).map((k) => [u + Math.cos(k * Math.PI / 2 + 0.6) * r, v + Math.sin(k * Math.PI / 2 + 0.6) * r, k * Math.PI / 2 + 0.6 + Math.PI])
      : [[u - w / 4, v - d / 2 - 0.35, Math.PI / 2], [u + w / 4, v - d / 2 - 0.35, Math.PI / 2], [u - w / 4, v + d / 2 + 0.35, -Math.PI / 2], [u + w / 4, v + d / 2 + 0.35, -Math.PI / 2]].slice(0, seats);
    for (const [cu, cv, f] of spots) chair(cu, cv, yb, f, chairColor);
  };
  const heater = (u, v, yb) => {
    const [x, y] = P(u, v);
    inst.add('hbase', GEOM.cyl, mat(STEEL), x, yb + 0.35, -y, 0.5, 0.7, 0.5);
    inst.add('hpole', GEOM.cyl, mat(STEEL), x, yb + 1.3, -y, 0.11, 1.3, 0.11);
    inst.add('hhead', GEOM.cyl, mat(0x2a2a2a), x, yb + 2.05, -y, 0.3, 0.32, 0.3);
    inst.add('hhood', GEOM.cone8, mat(0x9a9da0), x, yb + 2.35, -y, 1.15, 0.28, 1.15);
    colliders.addCircle(x, -y, 0.3, 'heater', yb + 2.4);
  };
  // up on the deck (as in the photos from the deck: slatted tables, heaters among them)
  table(u0 + 2.2, 3.4 + jogV * 0.4, y0); table(u0 + 2.2, vP - 2.4, y0); table(u1 - 2.3, vP - 2.4, y0);
  heater((u0 + u1) / 2 + 0.2, 4.4, y0); heater(u1 - 1.2, 2.0, y0);
  table(u1 + 2.6, vD / 2 - 0.3, y0, { round: true, w: 1.1 }); table(u1 + 6.4, vD / 2 - 0.3, y0, { round: true, w: 1.1 });
  table(L - 2.0, vD / 2 - 0.3, y0, { round: true, w: 1.1, seats: 3 });
  heater(u1 + 4.5, 1.0, y0); heater(L - 4.0, vD - 1.1, y0);
  // down on the patio: dark cafe tables and high-tops
  const g = (u, v) => gAt(u, v);
  table(u0 + 2.0, vP - 2.6, g(u0 + 2, vP - 2.6), { w: 0.9, d: 0.9, color: 0x3b2a20 });
  table(u1 - 2.1, vP - 2.6, g(u1 - 2, vP - 2.6), { w: 0.9, d: 0.9, color: 0x3b2a20 });
  table((u0 + u1) / 2, jogV + 2.4, g((u0 + u1) / 2, jogV + 2.4), { w: 0.9, d: 0.9, color: 0x3b2a20, seats: 2 });
  for (const u of [u1 + 2.4, u1 + 5.8, L - 2.2]) table(u, 2.2, g(u, 2.2), { round: true, w: 0.8, h: 1.05, seats: 2, color: 0x3b2a20, chairColor: 0x2e2a26 });

  // -- in front: stone lantern bollards among the grasses --
  const bollard = (u, v) => {
    const [x, y] = P(u, v);
    if (world.pavedAt(x, y, 0.2)) return;
    const gb = heightAtCampus(x, y);
    S(u, v, gb - 0.2, gb + 0.85, 0.6);
    B(CAP, u, v, gb + 0.9, 0.72, 0.1, 0.72);
    B(IRON, u, v, gb + 1.17, 0.42, 0.06, 0.42);
    glow(u, v, gb + 1.03, 0.32, 0.22, 0.32);
    B(IRON, u, v, gb + 1.25, 0.46, 0.08, 0.46);
    colliders.addCircle(x, -y, 0.4, 'bollard', gb + 1.3);
  };
  bollard(u1 + 2.6, vP + 2.6); bollard(L + 2.6, vD + 2.6); bollard((u1 + L) / 2 + 1, vD + 2.6);

  // grasses, red yucca and boulders in the beds round the patio
  {
    const grass = grassGeometry();
    const greens = [new THREE.MeshLambertMaterial({ color: 0x748448, side: THREE.DoubleSide }), new THREE.MeshLambertMaterial({ color: 0x8e9c7c, side: THREE.DoubleSide }), new THREE.MeshLambertMaterial({ color: 0x5f7040, side: THREE.DoubleSide })];
    let seed = 21;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const ok = (x, y) => !world.pavedAt(x, y, 0.4) && !world.buildings.some((q) => pointInPoly(x, y, q.poly)) && !pointInPoly(x, y, G.patio);
    const bed = [];
    for (let u = u0 - 2; u < L + 6; u += 0.9) for (let v = 0; v < vP + 7; v += 0.9) {
      const ju = u + (rnd() - 0.5) * 0.7, jv = v + (rnd() - 0.5) * 0.7;
      const [x, y] = P(ju, jv);
      if (!ok(x, y)) continue;
      // only the band just out from the patio's edge
      const front = ju < u1 + 1.8 ? vP + 1.8 : vD + 1.8;
      const out = Math.max(0, ju - (L + 1.8)) + Math.max(0, jv - front);
      if (out > 4.5 || rnd() < 0.35) continue;
      bed.push([x, y]);
    }
    for (const [x, y] of bed) {
      const s = 0.8 + rnd() * 0.6;
      inst.add('grass' + (Math.floor(rnd() * 3)), grass, greens[Math.floor(rnd() * 3)], x, heightAtCampus(x, y) - 0.05, -y, s, s * (0.8 + rnd() * 0.5), s, rnd() * 6.28);
      if (rnd() < 0.12) {
        // red yucca: a slender flower spike over the clump
        for (let k = 0; k < 2; k++) inst.add('yucca', GEOM.cone8, mat(0xc4554a), x + (rnd() - 0.5) * 0.3, heightAtCampus(x, y) + 0.75, -y + (rnd() - 0.5) * 0.3, 0.05, 1.3, 0.05, 0, (rnd() - 0.5) * 0.25);
      }
    }
    const rock = new THREE.IcosahedronGeometry(1, 0);
    const rockMat = mat(0xb5ab9c, { flatShading: true });
    for (let k = 0; k < bed.length; k += 9) {
      const [x, y] = bed[k];
      inst.add('rock', rock, rockMat, x, heightAtCampus(x, y) + 0.05, -y, 0.5 + rnd() * 0.4, 0.3 + rnd() * 0.2, 0.4 + rnd() * 0.3, rnd() * 6.28);
    }
  }

  scene.add(stone.mesh(new THREE.MeshLambertMaterial({ map: ledgerStone() }), shadows));
  inst.flush(scene, shadows);
}
