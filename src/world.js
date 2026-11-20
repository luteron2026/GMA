import * as THREE from 'three';
import { CAMPUS } from './data/campus.js';
import { Colliders, pointInPoly, distToPolyEdge, distToPolyline, mulberry32 } from './physics.js';
import { mat, makeLabel, GEOM } from './models.js';

// Convert campus (x east, y north) to world [x, z]
export const W = ([x, y]) => [x, -y];

const GROUND_COLORS = {
  campus: 0x93a95c,
  grass: 0x7fa652,
  field: 0x5f9e45,
  turf: 0x4f9a3c,
  pitch: 0x44a040,
  court: 0x9a4a3c,
  sand: 0xe0cf9a,
  dirt: 0xb99a6a,
};

const ROAD_STYLE = {
  street: { color: 0x3d4046, y: 0.1, curb: true },
  service: { color: 0x4a4d53, y: 0.095 },
  aisle: { color: 0x4f5258, y: 0.09 },
  driveway: { color: 0x5c5e62, y: 0.085 },
  path: { color: 0xcfc8b8, y: 0.08 },
  trail: { color: 0xa58a5e, y: 0.075 },
};

export class World {
  constructor(scene, { lowSpec = false } = {}) {
    this.scene = scene;
    this.lowSpec = lowSpec;
    this.data = CAMPUS;
    this.colliders = new Colliders();
    this.places = {};
    for (const [k, v] of Object.entries(CAMPUS.places)) this.places[k] = W(v);
    this.roads = CAMPUS.roads.map((r) => ({ ...r, wpts: r.pts.map(W) }));
    this.buildings = CAMPUS.buildings.map((b) => ({ ...b, wpts: b.poly.map(W) }));
    this.lots = CAMPUS.lots.map((l) => ({ ...l, wpts: l.poly.map(W) }));
    this.campusAreas = CAMPUS.campus.map((p) => p.map(W));
    this.namedRoads = this.roads.filter((r) => r.name);
    const b = CAMPUS.bounds;
    this.bounds = { minX: b.minX, maxX: b.maxX, minZ: -b.maxY, maxZ: -b.minY };
    this.labels = [];
    this.build();
  }

  build() {
    const s = this.scene;

    // Base ground: dry Santa Clarita grass
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(2600, 2600).rotateX(-Math.PI / 2), mat(0xb7a46a));
    ground.position.y = -0.12;
    ground.receiveShadow = true;
    s.add(ground);

    // Irrigated campus grounds, lawns, fields and courts (real outlines)
    let y = 0.0;
    for (const lawn of CAMPUS.lawns) {
      y += 0.004;
      const mesh = new THREE.Mesh(polyGeometry(lawn.poly), mat(GROUND_COLORS[lawn.kind]));
      mesh.position.y = y;
      mesh.receiveShadow = true;
      s.add(mesh);
      if (lawn.lines && (lawn.kind === 'pitch' || lawn.kind === 'court')) this.addFieldLines(lawn.lines, y + 0.003, lawn.kind === 'pitch');
    }
    this.buildDiamond(y + 0.004);
    // Prayer Hill clearing
    const [hx, hz] = this.places.hill;
    const clearing = new THREE.Mesh(new THREE.CircleGeometry(34, 40).rotateX(-Math.PI / 2), mat(GROUND_COLORS.dirt));
    clearing.position.set(hx, 0.03, hz);
    clearing.receiveShadow = true;
    s.add(clearing);

    this.buildWashes();

    // Parking lots
    for (const lot of this.lots) {
      const m = new THREE.Mesh(polyGeometry(lot.poly), mat(0x55585e));
      m.position.y = 0.07; m.receiveShadow = true; s.add(m);
    }
    this.addStallLines();

    // Roads, streets, paths and trails
    // (batched into one mesh per road style to keep draw calls low)
    const roadBatch = new Batcher();
    for (const r of this.roads) {
      const st = ROAD_STYLE[r.kind] || ROAD_STYLE.service;
      roadBatch.add(r.kind, ribbonGeometry(r.wpts, r.width, false).translate(0, st.y, 0), st.color);
      if (st.curb) {
        roadBatch.add('curb', ribbonGeometry(r.wpts, r.width + 1.4, false).translate(0, st.y - 0.008, 0), 0xc9c4b8);
        this.addCenterLine(r);
      }
    }
    for (const m of roadBatch.meshes(() => new THREE.MeshLambertMaterial({ vertexColors: true }))) {
      m.receiveShadow = true; s.add(m);
    }

    this.buildBuildings();
    this.buildStadium();
    this.buildProps();
    this.buildStreetSigns();
    this.buildBoundary();
    this.buildTrees();
    this.buildHills();
    this.buildLaneHints();
  }

  addCenterLine(r) {
    const dash = new THREE.BoxGeometry(0.25, 0.02, 3);
    const pts = r.wpts;
    const positions = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const ang = Math.atan2(b[0] - a[0], b[1] - a[1]);
      for (let d = 3; d < len - 3; d += 8) {
        const t = d / len;
        positions.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, ang]);
      }
    }
    const inst = new THREE.InstancedMesh(dash, mat(0xf2c94c), positions.length);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
    positions.forEach(([x, z, ang], i) => {
      q.setFromAxisAngle(up, ang);
      m4.compose(new THREE.Vector3(x, 0.12, z), q, new THREE.Vector3(1, 1, 1));
      inst.setMatrixAt(i, m4);
    });
    this.scene.add(inst);
  }

  // White lines between parking stalls
  addStallLines() {
    const stalls = CAMPUS.stalls;
    const geo = new THREE.BoxGeometry(0.15, 0.02, 4.8);
    const inst = new THREE.InstancedMesh(geo, mat(0xf0f0f0), stalls.length * 2);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), one = new THREE.Vector3(1, 1, 1);
    let i = 0;
    for (const [x, y, a] of stalls) {
      // a: direction the stall opens toward (campus space); stall lines run parallel to it
      const dx = Math.cos(a), dy = Math.sin(a);
      const px = -dy, py = dx;
      const rot = Math.atan2(dx, -dy); // world heading of (dx, -dy)
      q.setFromAxisAngle(up, rot);
      for (const side of [-1.35, 1.35]) {
        m4.compose(new THREE.Vector3(x + px * side, 0.08, -(y + py * side)), q, one);
        inst.setMatrixAt(i++, m4);
      }
    }
    inst.count = i;
    this.scene.add(inst);
  }

  // Rotated field markings from an oriented box [cx, cy, w, h, angle]
  addFieldLines([cx, cy, w, h, a], y, soccer) {
    const lm = mat(0xf4f4f4);
    const g = new THREE.Group();
    const add = (sx, sz, x, z) => {
      const m = new THREE.Mesh(GEOM.box, lm);
      m.scale.set(sx, 0.01, sz); m.position.set(x, 0, z); g.add(m);
    };
    const iw = w - 3, ih = h - 3;
    add(iw, 0.25, 0, -ih / 2); add(iw, 0.25, 0, ih / 2);
    add(0.25, ih, -iw / 2, 0); add(0.25, ih, iw / 2, 0);
    if (soccer) {
      add(0.25, ih, 0, 0);
      const circle = new THREE.Mesh(new THREE.RingGeometry(8.9, 9.15, 40).rotateX(-Math.PI / 2), lm);
      g.add(circle);
      for (const sgn of [-1, 1]) {
        add(0.25, 40, sgn * (iw / 2 - 16.5), 0);
        add(16.5, 0.25, sgn * (iw / 2 - 8.25), -20); add(16.5, 0.25, sgn * (iw / 2 - 8.25), 20);
        const goal = new THREE.Mesh(GEOM.box, mat(0xffffff));
        goal.scale.set(0.3, 2.4, 7.3); goal.position.set(sgn * (iw / 2 + 0.6), 1.2, 0); g.add(goal);
      }
    } else {
      add(0.2, ih, 0, 0);
    }
    g.position.set(cx, y, -cy);
    g.rotation.y = a; // local +x lies along the box's long side
    this.scene.add(g);
  }

  buildDiamond(y) {
    const d = CAMPUS.diamond;
    const dirt = new THREE.Mesh(polyGeometry(d.dirt), mat(0xb5683f));
    dirt.position.y = y; dirt.receiveShadow = true; this.scene.add(dirt);
    const grass = new THREE.Mesh(polyGeometry(d.grass), mat(GROUND_COLORS.turf));
    grass.position.y = y + 0.003; grass.receiveShadow = true; this.scene.add(grass);
    d.bases.forEach(([x, by], i) => {
      const base = new THREE.Mesh(GEOM.box, mat(0xffffff));
      base.scale.set(i ? 0.5 : 0.6, 0.08, i ? 0.5 : 0.6);
      base.rotation.y = Math.PI / 4;
      base.position.set(x, y + 0.04, -by);
      this.scene.add(base);
    });
    // Pitcher's mound
    const [hx, hy] = d.bases[0], [sx, sy] = d.bases[2];
    const mound = new THREE.Mesh(new THREE.CircleGeometry(2.7, 20).rotateX(-Math.PI / 2), mat(0xb5683f));
    mound.position.set(hx + (sx - hx) * 0.47, y + 0.006, -(hy + (sy - hy) * 0.47));
    this.scene.add(mound);
  }

  // Lou Herwaldt Stadium: bleachers and a backstop behind home plate
  buildStadium() {
    const [hx, hy] = CAMPUS.diamond.bases[0], [sx, sy] = CAMPUS.diamond.bases[2];
    const len = Math.hypot(sx - hx, sy - hy);
    const dx = (sx - hx) / len, dy = (sy - hy) / len;
    const cx = hx - dx * 9, cy = hy - dy * 9;
    const g = new THREE.Group();
    const steel = mat(0x8a95a5), seat = mat(0x1f3a6e);
    // Rows rise away from the field (local +z); the backstop net sits on the field side
    for (let k = 0; k < 4; k++) {
      const step = new THREE.Mesh(GEOM.box, k % 2 ? steel : seat);
      step.scale.set(22, 0.6 + k * 0.7, 1.4);
      step.position.set(0, (0.6 + k * 0.7) / 2, -1 + 1.4 * k);
      step.castShadow = !this.lowSpec;
      g.add(step);
    }
    const net = new THREE.Mesh(GEOM.box, new THREE.MeshLambertMaterial({ color: 0x333333, transparent: true, opacity: 0.35 }));
    net.scale.set(16, 6, 0.1); net.position.set(0, 3, -3); g.add(net);
    g.position.set(cx, 0, -cy);
    // Local -z points at the field: world (dx, -dy) = (-sin θ, -cos θ)
    const th = Math.atan2(-dx, dy);
    g.rotation.y = th;
    this.scene.add(g);
    // Collider box around the stands and net
    const ax = [Math.cos(th), -Math.sin(th)], az = [Math.sin(th), Math.cos(th)];
    const corners = [[-11, -3.2], [11, -3.2], [11, 4], [-11, 4]].map(([a, b]) => [cx + ax[0] * a + az[0] * b, -cy + ax[1] * a + az[1] * b]);
    this.colliders.addPoly(corners, 'bleachers');
    const label = makeLabel('Lou Herwaldt Stadium', 'Reese Field', { width: 15 });
    const [px, pz] = this.places.stadium;
    label.position.set(px, 9, pz);
    this.scene.add(label);
    this.labels.push(label);
  }

  buildWashes() {
    // Placerita Creek and Newhall Creek: dry, rocky washes
    const rng = mulberry32(7);
    const rocks = [];
    for (const w of CAMPUS.washes) {
      const pts = w.pts.map(W);
      const m = new THREE.Mesh(ribbonGeometry(pts, w.width, false), mat(0xd8c9a3));
      m.position.y = 0.05; m.receiveShadow = true; this.scene.add(m);
      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i], b = pts[i + 1];
        const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
        for (let d = 0; d < len; d += 9) {
          const t = d / len;
          rocks.push([a[0] + (b[0] - a[0]) * t + (rng() - 0.5) * w.width * 0.7, a[1] + (b[1] - a[1]) * t + (rng() - 0.5) * w.width * 0.7, 0.3 + rng() * 1.1]);
        }
      }
      // Label the stretch nearest the middle of the play area
      let best = null, bd = Infinity;
      for (const p of pts) {
        if (!this.inBounds(p[0], p[1], 20)) continue;
        const d = Math.hypot(p[0] + 30, p[1] - 20);
        if (d < bd) { bd = d; best = p; }
      }
      if (best && w.name) {
        const label = makeLabel(w.name, null, { width: 10, bg: 'rgba(60,90,120,0.8)' });
        label.position.set(best[0], 3, best[1]);
        this.scene.add(label);
        this.labels.push(label);
      }
    }
    const inst = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 0), mat(0xb3a587), rocks.length);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), sc = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
    rocks.forEach(([x, z, s], i) => {
      m4.compose(v.set(x, s * 0.2, z), q.setFromAxisAngle(up, rng() * 3), sc.set(s, s * 0.6, s));
      inst.setMatrixAt(i, m4);
    });
    this.scene.add(inst);
  }

  buildBuildings() {
    const wallTex = makeWindowTexture();
    const dormTex = makeWindowTexture(true);
    const houseTex = makeWindowTexture(false, true);
    // Named buildings get their own meshes; the ~130 houses and minor buildings are merged
    // into a handful of meshes (one per texture) so phones don't choke on draw calls.
    const batch = new Batcher();
    for (const b of this.buildings) {
      const shape = new THREE.Shape(b.poly.map(([x, y]) => new THREE.Vector2(x, y)));
      const geo = new THREE.ExtrudeGeometry(shape, { depth: b.height, bevelEnabled: false });
      geo.rotateX(-Math.PI / 2);
      const roofColor = b.roofColor && b.roof !== 'gable' ? b.roofColor : shade(b.color, 0.78);
      if (b.name) {
        const tex = b.dorm ? dormTex : wallTex;
        const wallMat = new THREE.MeshLambertMaterial({ color: b.color, map: tex });
        const mesh = new THREE.Mesh(geo, [mat(roofColor), wallMat]);
        mesh.castShadow = !this.lowSpec;
        mesh.receiveShadow = true;
        this.scene.add(mesh);
      } else {
        const wallKey = b.kind === 'house' ? 'houseWalls' : 'campusWalls';
        batch.add('roofs', geo, roofColor, 0);
        batch.add(wallKey, geo, b.color, 1);
      }
      this.colliders.addPoly(b.wpts, b.id);

      const [cx, cy] = b.obb;
      b.center = [cx, -cy];
      if (b.roof === 'gable') {
        if (b.name) this.addGable(b.obb, b.height, b.roofColor || 0xb5523b);
        else batch.add('roofs', gableGeometry(b.obb, b.height), b.roofColor || 0xb5523b);
      }
      if (b.id === 'chapel') this.addRoofCross(cx, cy, b.height);
      if (b.name) {
        const label = makeLabel(b.name, b.sub, { width: b.small ? 11 : 15 });
        label.position.set(cx, b.height + (b.small ? 2.5 : 3.5), -cy);
        this.scene.add(label);
        this.labels.push(label);
        this.addDoor(b);
      }
    }
    const texFor = { houseWalls: houseTex, campusWalls: wallTex };
    for (const m of batch.meshes((key) => new THREE.MeshLambertMaterial({ vertexColors: true, map: texFor[key] || null }))) {
      m.castShadow = !this.lowSpec;
      m.receiveShadow = true;
      this.scene.add(m);
    }
  }

  // Door + navy awning on the wall by the building's mission spot (or else the nearest road)
  addDoor(b) {
    const poly = b.poly;
    let best = null, bestD = Infinity;
    for (let i = 0; i < poly.length; i++) {
      const [ax, ay] = poly[i], [bx, by] = poly[(i + 1) % poly.length];
      const len = Math.hypot(bx - ax, by - ay);
      if (len < 5) continue;
      let nx = (by - ay) / len, ny = -(bx - ax) / len;
      const mx = (ax + bx) / 2, my = (ay + by) / 2;
      if (pointInPoly(mx + nx * 0.5, my + ny * 0.5, poly)) { nx = -nx; ny = -ny; }
      const px = mx + nx * 3, py = my + ny * 3;
      let d = Infinity;
      if (b.door) d = Math.hypot(px - b.door[0], py - b.door[1]);
      else {
        for (const r of this.data.roads) {
          if (r.kind === 'trail') continue;
          d = Math.min(d, distToPolyline(px, py, r.pts) - r.width / 2);
        }
      }
      if (d < bestD) { bestD = d; best = { mx, my, nx, ny }; }
    }
    if (!best) return;
    const { mx, my, nx, ny } = best;
    const rot = Math.atan2(nx, -ny); // world heading of the outward normal (nx, -ny)
    const door = new THREE.Mesh(GEOM.box, mat(0x4a3424));
    door.scale.set(2.4, 3, 0.2);
    door.position.set(mx + nx * 0.06, 1.5, -(my + ny * 0.06));
    door.rotation.y = rot;
    this.scene.add(door);
    const awning = new THREE.Mesh(GEOM.box, mat(0x1f3a6e));
    awning.scale.set(3.6, 0.2, 1.6);
    awning.position.set(mx + nx * 0.8, 3.3, -(my + ny * 0.8));
    awning.rotation.y = rot;
    this.scene.add(awning);
  }

  // Pitched roof along an oriented box [cx, cy, w, h, angle]
  addGable(box, height, color) {
    const m = new THREE.Mesh(gableGeometry(box, height), mat(color));
    m.castShadow = !this.lowSpec;
    this.scene.add(m);
  }

  addRoofCross(x, y, height) {
    const gold = mat(0xd4af37, { emissive: 0x332200 });
    const v = new THREE.Mesh(GEOM.box, gold); v.scale.set(0.5, 5, 0.5); v.position.set(x, height + 2.5, -y); this.scene.add(v);
    const hbar = new THREE.Mesh(GEOM.box, gold); hbar.scale.set(2.6, 0.5, 0.5); hbar.position.set(x, height + 3.6, -y); this.scene.add(hbar);
  }

  buildProps() {
    // University sign at the main entrance on Placerita Canyon Rd
    const [ex, ez] = this.places.mainEntrance;
    const road = this.namedRoads.find((r) => r.name === 'Placerita Canyon Road');
    const ang = road ? roadAngleAt(road.wpts, ex, ez) : 0;
    const sign = new THREE.Group();
    const wall = new THREE.Mesh(GEOM.box, mat(0xb9a98a));
    wall.scale.set(10, 2.2, 1.2); wall.position.y = 1.1; wall.castShadow = true; sign.add(wall);
    sign.position.set(ex, 0, ez);
    sign.rotation.y = ang;
    this.scene.add(sign);
    const lbl = makeLabel("The Master's University", 'Placerita Canyon', { width: 9, bg: 'rgba(31,58,110,0.95)' });
    lbl.position.set(ex, 3.6, ez); this.scene.add(lbl);
    for (const k of [-3, 0, 3]) this.colliders.addCircle(ex + Math.cos(ang) * k, ez - Math.sin(ang) * k, 1.4);

    // Prayer Hill: a wooden cross in a clearing ringed with rocks, open toward the trail
    const [hx, hz] = this.places.hill;
    const wood = mat(0x6b4a2b);
    const v = new THREE.Mesh(GEOM.box, wood); v.scale.set(0.6, 9, 0.6); v.position.set(hx, 4.5, hz - 22); v.castShadow = true; this.scene.add(v);
    const hb = new THREE.Mesh(GEOM.box, wood); hb.scale.set(4, 0.6, 0.6); hb.position.set(hx, 6.8, hz - 22); this.scene.add(hb);
    this.colliders.addCircle(hx, hz - 22, 1);
    const [bx, bz] = this.places.hillBase;
    const gap = Math.atan2(bz - hz, bx - hx);
    const rock = mat(0x9a8b74);
    for (let i = 0; i < 26; i++) {
      const a = (i / 26) * Math.PI * 2;
      let da = Math.abs(a - gap) % (Math.PI * 2);
      if (da > Math.PI) da = Math.PI * 2 - da;
      if (da < 0.3) continue; // trail gap
      const r = 35;
      const x = hx + Math.cos(a) * r, z = hz + Math.sin(a) * r;
      const m = new THREE.Mesh(GEOM.sphere, rock);
      const sc = 3 + ((i * 37) % 5) * 0.4;
      m.scale.set(sc, sc * 0.7, sc);
      m.position.set(x, sc * 0.2, z);
      m.castShadow = !this.lowSpec;
      this.scene.add(m);
      this.colliders.addCircle(x, z, sc * 0.5);
    }
    const hl = makeLabel('Prayer Hill', null, { width: 9, bg: 'rgba(90,60,30,0.85)' });
    hl.position.set(hx, 12, hz - 22);
    this.scene.add(hl);
    this.labels.push(hl);
  }

  // Green street-name signs at intersections, like the real ones
  buildStreetSigns() {
    const cache = new Map();
    const bladeMat = (text) => {
      if (cache.has(text)) return cache.get(text);
      const c = document.createElement('canvas');
      c.width = 512; c.height = 72;
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#0f6b3a'; ctx.fillRect(0, 0, 512, 72);
      ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 4; ctx.strokeRect(5, 5, 502, 62);
      ctx.fillStyle = '#ffffff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.font = 'bold 42px "Highway Gothic", "Arial Narrow", Arial, sans-serif';
      ctx.fillText(text, 256, 38, 480);
      const tex = new THREE.CanvasTexture(c);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = 4;
      const m = new THREE.MeshBasicMaterial({ map: tex });
      cache.set(text, m);
      return m;
    };
    const plane = new THREE.PlaneGeometry(3.6, 0.5);
    const pole = mat(0x7d8288);
    for (const sgn of CAMPUS.signs) {
      const [x, z] = W([sgn.x, sgn.y]);
      const g = new THREE.Group();
      const post = new THREE.Mesh(GEOM.cyl, pole);
      post.scale.set(0.14, 3.6, 0.14); post.position.y = 1.8; post.castShadow = !this.lowSpec;
      g.add(post);
      sgn.names.forEach((name, i) => {
        const m = bladeMat(name);
        const blade = new THREE.Group();
        const front = new THREE.Mesh(plane, m);
        const back = new THREE.Mesh(plane, m); back.rotation.y = Math.PI;
        front.position.z = 0.02; back.position.z = -0.02;
        blade.add(front, back);
        blade.position.y = 3.4 - i * 0.55;
        blade.rotation.y = sgn.angles[i]; // local x along the street
        g.add(blade);
      });
      g.position.set(x, 0, z);
      this.scene.add(g);
      this.colliders.addCircle(x, z, 0.25);
    }
  }

  buildBoundary() {
    const b = this.bounds;
    const fence = mat(0x8a7a5e);
    const t = 1;
    const sides = [
      [[b.minX, b.minZ], [b.maxX, b.minZ]], [[b.maxX, b.minZ], [b.maxX, b.maxZ]],
      [[b.maxX, b.maxZ], [b.minX, b.maxZ]], [[b.minX, b.maxZ], [b.minX, b.minZ]],
    ];
    for (const [a, c] of sides) {
      const len = Math.hypot(c[0] - a[0], c[1] - a[1]);
      const m = new THREE.Mesh(GEOM.box, fence);
      m.scale.set(len, 1.2, 0.3);
      m.position.set((a[0] + c[0]) / 2, 0.6, (a[1] + c[1]) / 2);
      m.rotation.y = -Math.atan2(c[1] - a[1], c[0] - a[0]);
      this.scene.add(m);
    }
    this.colliders.addPoly([[b.minX - 50, b.minZ - 50], [b.maxX + 50, b.minZ - 50], [b.maxX + 50, b.minZ - t], [b.minX - 50, b.minZ - t]]);
    this.colliders.addPoly([[b.minX - 50, b.maxZ + t], [b.maxX + 50, b.maxZ + t], [b.maxX + 50, b.maxZ + 50], [b.minX - 50, b.maxZ + 50]]);
    this.colliders.addPoly([[b.minX - 50, b.minZ - 50], [b.minX - t, b.minZ - 50], [b.minX - t, b.maxZ + 50], [b.minX - 50, b.maxZ + 50]]);
    this.colliders.addPoly([[b.maxX + t, b.minZ - 50], [b.maxX + 50, b.minZ - 50], [b.maxX + 50, b.maxZ + 50], [b.maxX + t, b.maxZ + 50]]);
  }

  // Is this campus-space point clear for scenery?
  isOpen(x, y, margin) {
    if (this.colliders.pointBlocked(x, -y, margin + 1)) return false;
    for (const r of this.data.roads) if (distToPolyline(x, y, r.pts) < r.width / 2 + margin) return false;
    for (const l of this.data.lots) if (pointInPoly(x, y, l.poly) || distToPolyEdge(x, y, l.poly).d < margin) return false;
    for (const lawn of this.data.lawns) {
      if (lawn.kind === 'campus' || lawn.kind === 'grass') continue;
      if (pointInPoly(x, y, lawn.poly) || distToPolyEdge(x, y, lawn.poly).d < margin) return false;
    }
    for (const w of this.data.washes) if (distToPolyline(x, y, w.pts) < w.width / 2 + margin) return false;
    const [hx, hy] = this.data.places.hill;
    if (Math.hypot(x - hx, y - hy) < 40) return false;
    for (const key of ['quad', 'spawn', 'herwaldtLawn', 'northLawn']) {
      const [px, py] = this.data.places[key];
      if (Math.hypot(x - px, y - py) < 10) return false;
    }
    return true;
  }

  inCampus(x, z) {
    for (const a of this.campusAreas) if (pointInPoly(x, z, a)) return true;
    return false;
  }

  buildTrees() {
    const rng = mulberry32(1961);
    const b = this.data.bounds;
    const oaks = [], palms = [], bushes = [];
    const count = this.lowSpec ? 230 : 420;
    let tries = 0;
    while (oaks.length + palms.length < count && tries++ < 12000) {
      const x = b.minX + 6 + rng() * (b.maxX - b.minX - 12);
      const y = b.minY + 6 + rng() * (b.maxY - b.minY - 12);
      // The hillside south of campus is chaparral, not trees
      if (y < -175 && !this.inCampus(x, -y)) continue;
      if (!this.isOpen(x, y, 3)) continue;
      // Palms line the streets; oaks everywhere else
      let nearStreet = false;
      for (const r of this.namedRoads) if (distToPolyline(x, y, r.pts) < 13) { nearStreet = true; break; }
      const list = nearStreet && rng() < 0.5 ? palms : oaks;
      list.push([x, y, 0.75 + rng() * 0.6, rng() * Math.PI * 2]);
    }
    // Chaparral on the hills
    tries = 0;
    const nb = this.lowSpec ? 140 : 320;
    while (bushes.length < nb && tries++ < 6000) {
      const x = b.minX + 4 + rng() * (b.maxX - b.minX - 8);
      const y = b.minY + 4 + rng() * (-170 - b.minY);
      if (this.inCampus(x, -y) || !this.isOpen(x, y, 1.5)) continue;
      bushes.push([x, y, 0.8 + rng() * 1.2]);
    }
    // Scenery outside the fence (no collision)
    const outside = [];
    for (let i = 0; i < (this.lowSpec ? 120 : 260); i++) {
      const ang = rng() * Math.PI * 2;
      const rad = 470 + rng() * 260;
      outside.push([-30 + Math.cos(ang) * rad, Math.sin(ang) * rad * 0.85, 0.8 + rng() * 0.8, rng() * 6]);
    }
    const trunkGeo = new THREE.CylinderGeometry(0.35, 0.5, 1, 6).translate(0, 0.5, 0);
    const crownGeo = new THREE.IcosahedronGeometry(1, 0);
    const trunkMat = mat(0x6b4f33);
    const crownMat = mat(0x4f7a3a);
    const crownMat2 = mat(0x6a8a3f);
    const all = oaks.concat(outside);
    const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, all.length);
    const crowns = new THREE.InstancedMesh(crownGeo, crownMat, all.length);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), sc = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    all.forEach(([x, y, s, rot], i) => {
      const z = -y;
      q.setFromAxisAngle(up, rot);
      m4.compose(v.set(x, 0, z), q, sc.set(s, 3.2 * s, s)); trunks.setMatrixAt(i, m4);
      m4.compose(v.set(x, 4.2 * s, z), q, sc.set(4 * s, 2.8 * s, 4 * s)); crowns.setMatrixAt(i, m4);
      if (i < oaks.length) this.colliders.addCircle(x, z, 0.7 * s);
    });
    trunks.castShadow = crowns.castShadow = !this.lowSpec;
    this.scene.add(trunks, crowns);
    // Lighter second crown layer for a bit of variety
    const crowns2 = new THREE.InstancedMesh(crownGeo, crownMat2, oaks.length);
    oaks.forEach(([x, y, s, rot], i) => {
      q.setFromAxisAngle(up, rot + 1);
      m4.compose(v.set(x + 0.8 * s, 5.2 * s, -y + 0.5 * s), q, sc.set(2.6 * s, 2 * s, 2.6 * s));
      crowns2.setMatrixAt(i, m4);
    });
    this.scene.add(crowns2);

    // Palms
    const pTrunk = new THREE.CylinderGeometry(0.22, 0.32, 1, 6).translate(0, 0.5, 0);
    const frond = new THREE.ConeGeometry(0.6, 3.6, 4).rotateX(Math.PI / 2).translate(0, 0, 1.6);
    const ptr = new THREE.InstancedMesh(pTrunk, mat(0x8a6d4d), palms.length);
    const pfr = new THREE.InstancedMesh(frond, mat(0x3f7a35), palms.length * 6);
    palms.forEach(([x, y, s], i) => {
      const h = 9 + s * 5;
      m4.compose(v.set(x, 0, -y), q.identity(), sc.set(1, h, 1)); ptr.setMatrixAt(i, m4);
      for (let k = 0; k < 6; k++) {
        const e = new THREE.Euler(0.35, (k / 6) * Math.PI * 2 + s, 0, 'YXZ');
        q.setFromEuler(e);
        m4.compose(v.set(x, h, -y), q, sc.set(1, 1, 1));
        pfr.setMatrixAt(i * 6 + k, m4);
      }
      this.colliders.addCircle(x, -y, 0.45);
    });
    this.scene.add(ptr, pfr);

    // Bushes (walk-through)
    const bush = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 0), mat(0x6f7a45), bushes.length);
    bushes.forEach(([x, y, s], i) => {
      m4.compose(v.set(x, s * 0.35, -y), q.setFromAxisAngle(up, s * 5), sc.set(s * 1.3, s * 0.8, s * 1.1));
      bush.setMatrixAt(i, m4);
    });
    this.scene.add(bush);
  }

  buildHills() {
    // San Gabriel foothills around Placerita Canyon, steepest to the south
    const rng = mulberry32(91321);
    const geo = new THREE.IcosahedronGeometry(1, 1);
    const n = 46;
    const hills = new THREE.InstancedMesh(geo, mat(0xa8925f), n + 12);
    const hills2 = new THREE.InstancedMesh(geo, mat(0x8c8a55), n + 12);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), sc = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    let i1 = 0, i2 = 0;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + rng() * 0.1;
      const rad = 700 + rng() * 200;
      const x = -30 + Math.cos(a) * rad, z = Math.sin(a) * rad * 0.85;
      const r = 110 + rng() * 120;
      const h = 60 + rng() * 120;
      m4.compose(v.set(x, -10, z), q.setFromAxisAngle(up, rng() * 3), sc.set(r, h, r * 0.8));
      if (i % 2) hills.setMatrixAt(i1++, m4); else hills2.setMatrixAt(i2++, m4);
    }
    // The ridge right behind campus (Prayer Hill side)
    for (let i = 0; i < 12; i++) {
      const x = -460 + i * 80 + rng() * 30;
      const z = 470 + rng() * 60;
      const r = 70 + rng() * 50;
      m4.compose(v.set(x, -14, z), q.setFromAxisAngle(up, rng() * 3), sc.set(r, 45 + rng() * 45, r * 0.9));
      if (i % 2) hills.setMatrixAt(i1++, m4); else hills2.setMatrixAt(i2++, m4);
    }
    hills.count = i1; hills2.count = i2;
    this.scene.add(hills, hills2);
  }

  buildLaneHints() {
    // Driving lanes for AI traffic (right-hand traffic)
    this.lanes = [];
    const add = (pts, kind, name) => {
      // Keep only the parts inside the fence so cars never drive into it
      for (const run of this.clipToBounds(pts, 8)) {
        const length = pathLength(run);
        if (run.length >= 2 && length > 40) this.lanes.push({ pts: densify(run, 20), kind, name, length, loop: false });
      }
    };
    for (const r of this.roads) {
      if (r.traffic && r.lanes === 2) {
        add(offsetPath(r.wpts, 3.1), 'car', r.name);
        add(offsetPath([...r.wpts].reverse(), 3.1), 'car', r.name);
      } else if (r.cart) {
        add(offsetPath(r.wpts, 1.5), 'cart');
        add(offsetPath([...r.wpts].reverse(), 1.5), 'cart');
      }
    }
  }

  // Split a world polyline into the runs that lie inside the play area
  clipToBounds(pts, m) {
    const runs = [];
    let cur = [];
    const inside = (p) => this.inBounds(p[0], p[1], m);
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      if (i > 0) {
        const a = pts[i - 1];
        const ia = inside(a), ib = inside(p);
        if (ia !== ib) {
          // Binary-search the crossing point
          let lo = 0, hi = 1;
          for (let k = 0; k < 20; k++) {
            const mid = (lo + hi) / 2;
            const q = [a[0] + (p[0] - a[0]) * mid, a[1] + (p[1] - a[1]) * mid];
            if (inside(q) === ia) lo = mid; else hi = mid;
          }
          const t = ia ? lo : hi;
          const q = [a[0] + (p[0] - a[0]) * t, a[1] + (p[1] - a[1]) * t];
          if (ia) { cur.push(q); runs.push(cur); cur = []; } else cur = [q];
        }
      }
      if (inside(p)) cur.push(p);
    }
    if (cur.length) runs.push(cur);
    return runs;
  }

  onRoad(x, z) {
    for (const r of this.roads) {
      if (r.kind === 'path' || r.kind === 'trail') continue;
      if (distToPolyline(x, z, r.wpts) < r.width / 2) return true;
    }
    return false;
  }

  // Name of the street at a world point, if any
  streetAt(x, z) {
    let best = null, bd = Infinity;
    for (const r of this.namedRoads) {
      const d = distToPolyline(x, z, r.wpts) - r.width / 2;
      if (d < 3 && d < bd) { bd = d; best = r; }
    }
    return best ? best.short : null;
  }

  // Random open spot (world coords [x, z]) near a world point
  randomOpenSpot(rng = Math.random, near, radius = 60, offRoad = false) {
    const b = this.bounds;
    for (let i = 0; i < 60; i++) {
      let x, z;
      if (near) {
        const a = rng() * Math.PI * 2, r = rng() * radius;
        x = near[0] + Math.cos(a) * r; z = near[1] + Math.sin(a) * r;
      } else {
        x = b.minX + 10 + rng() * (b.maxX - b.minX - 20);
        z = b.minZ + 30 + rng() * (b.maxZ - b.minZ - 60);
      }
      if (!this.inBounds(x, z, 4)) continue;
      if (this.colliders.pointBlocked(x, z, 1.2)) continue;
      if (offRoad && this.onRoad(x, z)) continue;
      return [x, z];
    }
    return near ? [...near] : [...this.places.spawn];
  }

  inBounds(x, z, m = 0) {
    const b = this.bounds;
    return x > b.minX + m && x < b.maxX - m && z > b.minZ + m && z < b.maxZ - m;
  }

  update() {}
}

// ---------- geometry helpers ----------

// Pitched-roof geometry in world space for an oriented box [cx, cy, w, h, angle]
function gableGeometry([cx, cy, w, h, a], height) {
  const span = h, len = w;
  const rise = Math.min(4, span * 0.32);
  const tri = new THREE.Shape([new THREE.Vector2(-span / 2 - 0.5, 0), new THREE.Vector2(span / 2 + 0.5, 0), new THREE.Vector2(0, rise)]);
  const geo = new THREE.ExtrudeGeometry(tri, { depth: len + 1, bevelEnabled: false });
  geo.translate(0, 0, -(len + 1) / 2);
  // ridge (local +z) along the long side: campus direction (cos a, sin a) -> world (cos a, -sin a)
  geo.rotateY(Math.atan2(Math.cos(a), -Math.sin(a)));
  geo.translate(cx, height, -cy);
  return geo;
}

// Merges many geometries into one mesh per key, with per-vertex colors.
class Batcher {
  constructor() { this.parts = new Map(); }

  // group: index of the geometry group to take (e.g. ExtrudeGeometry 0 = caps, 1 = sides), or null for all
  add(key, geo, color, group = null) {
    const g = geo.index ? geo.toNonIndexed() : geo;
    let start = 0, count = g.getAttribute('position').count;
    if (group != null && g.groups.length) {
      const gr = g.groups.filter((x) => x.materialIndex === group);
      if (!gr.length) return;
      // ExtrudeGeometry emits one contiguous range per group
      start = gr[0].start; count = gr.reduce((n, x) => n + x.count, 0);
    }
    let p = this.parts.get(key);
    if (!p) this.parts.set(key, (p = { pos: [], nrm: [], uv: [], col: [] }));
    const pos = g.getAttribute('position'), nrm = g.getAttribute('normal'), uv = g.getAttribute('uv');
    const c = new THREE.Color(color);
    for (let i = start; i < start + count; i++) {
      p.pos.push(pos.getX(i), pos.getY(i), pos.getZ(i));
      if (nrm) p.nrm.push(nrm.getX(i), nrm.getY(i), nrm.getZ(i)); else p.nrm.push(0, 1, 0);
      if (uv) p.uv.push(uv.getX(i), uv.getY(i)); else p.uv.push(0, 0);
      p.col.push(c.r, c.g, c.b);
    }
  }

  meshes(makeMaterial) {
    const out = [];
    for (const [key, p] of this.parts) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(p.pos, 3));
      geo.setAttribute('normal', new THREE.Float32BufferAttribute(p.nrm, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(p.uv, 2));
      geo.setAttribute('color', new THREE.Float32BufferAttribute(p.col, 3));
      geo.computeBoundingSphere();
      out.push(new THREE.Mesh(geo, makeMaterial(key)));
    }
    return out;
  }
}

// Add points so no segment is longer than `step` (smoother AI steering on long straights)
function densify(pts, step) {
  const out = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const n = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / step);
    for (let k = 1; k <= n; k++) out.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]);
  }
  return out;
}

function pathLength(pts) {
  let L = 0;
  for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  return L;
}

// World heading (rotation.y) that lays an object's local x axis along a road near (x, z)
function roadAngleAt(pts, x, z) {
  let best = 0, bd = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    const d = distToPolyline(x, z, [a, b]);
    if (d < bd) { bd = d; best = Math.atan2(-(b[1] - a[1]), b[0] - a[0]); }
  }
  return best;
}

function polyGeometry(poly) {
  const shape = new THREE.Shape(poly.map(([x, y]) => new THREE.Vector2(x, y)));
  return new THREE.ShapeGeometry(shape).rotateX(-Math.PI / 2);
}

// Flat ribbon along a world-space polyline [[x,z],...]
function ribbonGeometry(pts, width, loop) {
  const half = width / 2;
  const n = pts.length;
  const pos = [], idx = [];
  const count = loop ? n + 1 : n;
  for (let k = 0; k < count; k++) {
    const i = k % n;
    const prev = loop ? pts[(i - 1 + n) % n] : pts[Math.max(0, i - 1)];
    const next = loop ? pts[(i + 1) % n] : pts[Math.min(n - 1, i + 1)];
    let dx = next[0] - prev[0], dz = next[1] - prev[1];
    const l = Math.hypot(dx, dz) || 1;
    dx /= l; dz /= l;
    const nx = -dz, nz = dx;
    // Miter scale
    let miter = 1;
    if ((loop || (i > 0 && i < n - 1))) {
      const a = pts[(i - 1 + n) % n];
      const d1x = pts[i][0] - a[0], d1z = pts[i][1] - a[1];
      const l1 = Math.hypot(d1x, d1z) || 1;
      const n1x = -d1z / l1, n1z = d1x / l1;
      miter = 1 / Math.max(0.5, nx * n1x + nz * n1z);
    }
    const p = pts[i];
    pos.push(p[0] + nx * half * miter, 0, p[1] + nz * half * miter);
    pos.push(p[0] - nx * half * miter, 0, p[1] - nz * half * miter);
    if (k > 0) {
      const a = (k - 1) * 2, b = k * 2;
      idx.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  // Ensure normals face up
  const nrm = geo.getAttribute('normal');
  for (let i = 0; i < nrm.count; i++) nrm.setXYZ(i, 0, 1, 0);
  // Fix winding so the top face is visible
  const index = geo.getIndex();
  for (let i = 0; i < index.count; i += 3) {
    const a = index.getX(i), b = index.getX(i + 1), c = index.getX(i + 2);
    const ax = pos[a * 3], az = pos[a * 3 + 2], bx = pos[b * 3], bz = pos[b * 3 + 2], cx = pos[c * 3], cz = pos[c * 3 + 2];
    const cross = (bx - ax) * (cz - az) - (bz - az) * (cx - ax);
    if (cross > 0) { index.setX(i + 1, c); index.setX(i + 2, b); }
  }
  return geo;
}

// Offset a world polyline to the right of travel direction (right-hand traffic)
function offsetPath(pts, off) {
  const n = pts.length;
  const out = [];
  for (let i = 0; i < n; i++) {
    const prev = pts[Math.max(0, i - 1)];
    const next = pts[Math.min(n - 1, i + 1)];
    let dx = next[0] - prev[0], dz = next[1] - prev[1];
    const l = Math.hypot(dx, dz) || 1;
    dx /= l; dz /= l;
    // Right of forward (dx,dz) in x/z plane viewed from above with -z north: right = (-dz, dx)
    out.push([pts[i][0] - dz * off, pts[i][1] + dx * off]);
  }
  return out;
}

function makeWindowTexture(dorm = false, house = false) {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, 64, 64);
  ctx.fillStyle = '#5d7590';
  if (house) {
    ctx.fillRect(18, 18, 28, 22);
    ctx.fillStyle = '#e8e8e8';
    ctx.fillRect(31, 18, 2, 22);
  } else if (dorm) {
    ctx.fillRect(14, 14, 36, 26);
    ctx.fillStyle = '#d8d0c0';
    ctx.fillRect(14, 40, 36, 4);
  } else {
    ctx.fillRect(10, 12, 44, 30);
    ctx.fillStyle = '#e8e8e8';
    ctx.fillRect(31, 12, 2, 30);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(1 / 4, 1 / 3.5);
  return tex;
}

function shade(hex, f) {
  const c = new THREE.Color(hex);
  c.multiplyScalar(f);
  return c.getHex();
}
