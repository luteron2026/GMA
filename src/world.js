import * as THREE from 'three';
import { CAMPUS } from './data/campus.js';
import { Colliders, pointInPoly, distToPolyEdge, distToPolyline, mulberry32 } from './physics.js';
import { mat, makeLabel, GEOM } from './models.js';

// Convert campus (x east, y north) to world [x, z]
export const W = ([x, y]) => [x, -y];

const GROUND_COLORS = {
  quad: 0x6fa548,
  grass: 0x7fa652,
  field: 0x4f9a3c,
  track: 0xb0523a,
  diamond: 0xb98a5a,
  dirt: 0xb99a6a,
  wash: 0xd8c9a3,
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
    const b = CAMPUS.bounds;
    this.bounds = { minX: b.minX, maxX: b.maxX, minZ: -b.maxY, maxZ: -b.minY };
    this.labels = [];
    this.build();
  }

  build() {
    const s = this.scene;
    const b = this.bounds;

    // Base ground (dry Santa Clarita grass)
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(2400, 2400).rotateX(-Math.PI / 2), mat(0xb7a46a));
    ground.position.y = -0.12;
    ground.receiveShadow = true;
    s.add(ground);
    // Irrigated campus grounds
    const cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2;
    const campusGround = new THREE.Mesh(
      new THREE.PlaneGeometry(b.maxX - b.minX - 20, b.maxZ - b.minZ - 40).rotateX(-Math.PI / 2),
      mat(0x93a95c)
    );
    campusGround.position.set(cx, -0.04, cz + 10);
    campusGround.receiveShadow = true;
    s.add(campusGround);

    let y = 0.02;
    for (const lawn of CAMPUS.lawns) {
      y += 0.006;
      let mesh;
      if (lawn.circle) {
        const [x, z] = W(lawn.circle);
        mesh = new THREE.Mesh(new THREE.CircleGeometry(lawn.circle[2], 40).rotateX(-Math.PI / 2), mat(GROUND_COLORS[lawn.kind]));
        mesh.position.set(x, y, z);
      } else {
        mesh = new THREE.Mesh(polyGeometry(lawn.poly), mat(GROUND_COLORS[lawn.kind]));
        mesh.position.y = y;
      }
      mesh.receiveShadow = true;
      s.add(mesh);
      if (lawn.kind === 'field' && !lawn.poly[4]) this.addFieldLines(lawn.poly, y + 0.003);
    }

    // Parking lots
    for (const lot of this.lots) {
      const m = new THREE.Mesh(polyGeometry(lot.poly), mat(0x55585e));
      m.position.y = 0.07; m.receiveShadow = true; s.add(m);
      this.addLotLines(lot.poly);
    }

    // Roads
    for (const r of this.roads) {
      const color = r.dirt ? 0xa58a5e : 0x3d4046;
      const m = new THREE.Mesh(ribbonGeometry(r.wpts, r.width, r.loop), mat(color));
      m.position.y = 0.09; m.receiveShadow = true; s.add(m);
      if (!r.dirt) {
        const edge = new THREE.Mesh(ribbonGeometry(r.wpts, r.width + 1.4, r.loop), mat(0xc9c4b8));
        edge.position.y = 0.085; edge.receiveShadow = true; s.add(edge);
        if (r.width >= 10) this.addCenterLine(r);
      }
    }

    this.buildBuildings();
    this.buildProps();
    this.buildBoundary();
    this.buildTrees();
    this.buildHills();
    this.buildCreek();
    this.buildLaneHints();
  }

  addCenterLine(r) {
    const dash = new THREE.BoxGeometry(0.25, 0.02, 3);
    const mm = mat(0xf2c94c);
    const pts = r.wpts;
    const n = r.loop ? pts.length : pts.length - 1;
    const positions = [];
    for (let i = 0; i < n; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const ang = Math.atan2(b[0] - a[0], b[1] - a[1]);
      for (let d = 3; d < len - 3; d += 8) {
        const t = d / len;
        positions.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, ang]);
      }
    }
    const inst = new THREE.InstancedMesh(dash, mm, positions.length);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
    positions.forEach(([x, z, ang], i) => {
      q.setFromAxisAngle(up, ang);
      m4.compose(new THREE.Vector3(x, 0.11, z), q, new THREE.Vector3(1, 1, 1));
      inst.setMatrixAt(i, m4);
    });
    this.scene.add(inst);
  }

  addLotLines(poly) {
    const xs = poly.map((p) => p[0]), ys = poly.map((p) => p[1]);
    const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
    const geo = new THREE.BoxGeometry(0.15, 0.02, 5);
    const positions = [];
    for (let x = minX + 3; x < maxX - 1; x += 3) {
      positions.push([x, -(minY + 3)]);
      positions.push([x, -(maxY - 3)]);
    }
    const inst = new THREE.InstancedMesh(geo, mat(0xf0f0f0), positions.length);
    const m4 = new THREE.Matrix4();
    positions.forEach(([x, z], i) => { m4.makeTranslation(x, 0.08, z); inst.setMatrixAt(i, m4); });
    this.scene.add(inst);
  }

  addFieldLines(poly, y) {
    const xs = poly.map((p) => p[0]), ys = poly.map((p) => p[1]);
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2;
    const w = Math.max(...xs) - Math.min(...xs), h = Math.max(...ys) - Math.min(...ys);
    const lm = mat(0xf4f4f4);
    const add = (sx, sz, x, z) => {
      const m = new THREE.Mesh(GEOM.box, lm);
      m.scale.set(sx, 0.01, sz); m.position.set(x, y, z); this.scene.add(m);
    };
    add(w - 4, 0.3, cx, -cy);
    add(w - 4, 0.3, cx, -(cy + h / 2 - 2));
    add(w - 4, 0.3, cx, -(cy - h / 2 + 2));
    add(0.3, h - 4, cx - w / 2 + 2, -cy);
    add(0.3, h - 4, cx + w / 2 - 2, -cy);
  }

  buildBuildings() {
    const wallTex = makeWindowTexture();
    const dormTex = makeWindowTexture(true);
    for (const b of this.buildings) {
      const shape = new THREE.Shape(b.poly.map(([x, y]) => new THREE.Vector2(x, y)));
      const geo = new THREE.ExtrudeGeometry(shape, { depth: b.height, bevelEnabled: false });
      geo.rotateX(-Math.PI / 2);
      const tex = b.dorm ? dormTex : wallTex;
      const wallMat = new THREE.MeshLambertMaterial({ color: b.color, map: tex });
      const roofMat = mat(b.roofColor && b.roof !== 'gable' ? b.roofColor : shade(b.color, 0.78));
      const mesh = new THREE.Mesh(geo, [roofMat, wallMat]);
      mesh.castShadow = !this.lowSpec;
      mesh.receiveShadow = true;
      this.scene.add(mesh);
      this.colliders.addPoly(b.wpts, b.id);

      const xs = b.poly.map((p) => p[0]), ys = b.poly.map((p) => p[1]);
      const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
      const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
      b.center = [cx, -cy];
      b.size = [maxX - minX, maxY - minY];

      if (b.roof === 'gable') this.addGable(cx, cy, maxX - minX, maxY - minY, b.height, b.roofColor || 0xb5523b);
      if (b.steeple) this.addSteeple(maxX - 6, minY + 6, b.height);
      if (b.name && (!b.id.startsWith('home') || b.id === 'home1')) {
        const label = makeLabel(b.name, b.sub, { width: b.id.startsWith('home') ? 12 : 15 });
        const extra = b.roof === 'gable' ? Math.min(maxX - minX, maxY - minY) * 0.35 : 0;
        label.position.set(cx, b.height + extra + (b.steeple ? 4 : 3), -cy);
        this.scene.add(label);
        this.labels.push(label);
      }
      // Doors on the side facing the nearest road
      this.addDoor(b, minX, maxX, minY, maxY);
    }
  }

  addDoor(b, minX, maxX, minY, maxY) {
    if (b.id === 'bleachers') return;
    const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
    const cands = [
      [cx, minY - 0.05, 0], [cx, maxY + 0.05, Math.PI], [minX - 0.05, cy, -Math.PI / 2], [maxX + 0.05, cy, Math.PI / 2],
    ];
    let best = cands[0], bestD = Infinity;
    for (const c of cands) {
      let d = Infinity;
      for (const r of this.data.roads) d = Math.min(d, distToPolyline(c[0], c[1], r.pts, r.loop));
      if (b.id === 'dunkin' || b.id === 'library' || b.id === 'reece') d = Math.hypot(c[0] - 0, c[1] - 20);
      if (d < bestD) { bestD = d; best = c; }
    }
    const door = new THREE.Mesh(GEOM.box, mat(0x4a3424));
    door.scale.set(2.4, 3, 0.2);
    door.position.set(best[0], 1.5, -best[1]);
    door.rotation.y = best[2];
    this.scene.add(door);
    const awning = new THREE.Mesh(GEOM.box, mat(0x1f3a6e));
    awning.scale.set(3.6, 0.2, 1.6);
    awning.position.set(best[0], 3.3, -best[1]);
    awning.rotation.y = best[2];
    awning.translateZ(0.8);
    this.scene.add(awning);
  }

  addGable(cx, cy, w, h, height, color) {
    const alongX = w >= h;
    const span = alongX ? h : w, len = alongX ? w : h;
    const rise = span * 0.35;
    const tri = new THREE.Shape([new THREE.Vector2(-span / 2 - 0.6, 0), new THREE.Vector2(span / 2 + 0.6, 0), new THREE.Vector2(0, rise)]);
    const geo = new THREE.ExtrudeGeometry(tri, { depth: len + 1.2, bevelEnabled: false });
    geo.translate(0, 0, -(len + 1.2) / 2);
    const m = new THREE.Mesh(geo, mat(color));
    m.position.set(cx, height, -cy);
    if (alongX) m.rotation.y = Math.PI / 2;
    m.castShadow = !this.lowSpec;
    this.scene.add(m);
  }

  addSteeple(x, y, height) {
    const z = -y;
    const white = mat(0xf7f3ea);
    const tower = new THREE.Mesh(GEOM.box, white);
    tower.scale.set(6, height + 10, 6);
    tower.position.set(x, (height + 10) / 2, z);
    tower.castShadow = !this.lowSpec;
    this.scene.add(tower);
    const bell = new THREE.Mesh(GEOM.box, mat(0x2b2b2b));
    bell.scale.set(6.1, 2.4, 3);
    bell.position.set(x, height + 7, z);
    this.scene.add(bell);
    const spire = new THREE.Mesh(GEOM.cone4, white);
    spire.scale.set(8.4, 12, 8.4);
    spire.rotation.y = Math.PI / 4;
    spire.position.set(x, height + 16, z);
    spire.castShadow = !this.lowSpec;
    this.scene.add(spire);
    const gold = mat(0xd4af37, { emissive: 0x332200 });
    const c1 = new THREE.Mesh(GEOM.box, gold); c1.scale.set(0.4, 3.4, 0.4); c1.position.set(x, height + 23.5, z); this.scene.add(c1);
    const c2 = new THREE.Mesh(GEOM.box, gold); c2.scale.set(1.8, 0.4, 0.4); c2.position.set(x, height + 24.2, z); this.scene.add(c2);
    this.colliders.addCircle(x, z, 4.2, 'steeple');
  }

  buildProps() {
    for (const p of this.data.props) {
      const [x, z] = W([p.x, p.y]);
      if (p.kind === 'fountain') {
        const base = new THREE.Mesh(GEOM.cyl, mat(0xd9d2c2));
        base.scale.set(p.r * 2, 0.8, p.r * 2); base.position.set(x, 0.4, z); this.scene.add(base);
        const water = new THREE.Mesh(GEOM.cyl, mat(0x4aa3d8, { emissive: 0x0a2a44 }));
        water.scale.set(p.r * 1.8, 0.1, p.r * 1.8); water.position.set(x, 0.82, z); this.scene.add(water);
        const col = new THREE.Mesh(GEOM.cyl, mat(0xd9d2c2));
        col.scale.set(0.8, 2.6, 0.8); col.position.set(x, 1.6, z); this.scene.add(col);
        const top = new THREE.Mesh(GEOM.cyl, mat(0xd9d2c2));
        top.scale.set(2.2, 0.3, 2.2); top.position.set(x, 2.8, z); this.scene.add(top);
        this.colliders.addCircle(x, z, p.r, 'fountain');
        this.fountain = { x, z, water };
      } else if (p.kind === 'sign') {
        const wall = new THREE.Mesh(GEOM.box, mat(0xb9a98a));
        wall.scale.set(10, 2.2, 1.2); wall.position.set(x, 1.1, z); wall.castShadow = true; this.scene.add(wall);
        const lbl = makeLabel(p.text, 'Placerita Canyon', { width: 9, bg: 'rgba(31,58,110,0.95)' });
        lbl.position.set(x, 3.6, z); this.scene.add(lbl);
        this.colliders.addCircle(x - 3, z, 1.4); this.colliders.addCircle(x, z, 1.4); this.colliders.addCircle(x + 3, z, 1.4);
      } else if (p.kind === 'cross') {
        const wood = mat(0x6b4a2b);
        const v = new THREE.Mesh(GEOM.box, wood); v.scale.set(0.6, 9, 0.6); v.position.set(x, 4.5, z); v.castShadow = true; this.scene.add(v);
        const h = new THREE.Mesh(GEOM.box, wood); h.scale.set(4, 0.6, 0.6); h.position.set(x, 6.8, z); this.scene.add(h);
        this.colliders.addCircle(x, z, p.r);
      }
    }
    // Rocks ringing the Prayer Hill clearing (opening to the south for the trail)
    const [hx, hz] = W([0, 255]);
    const rock = mat(0x9a8b74);
    for (let i = 0; i < 26; i++) {
      const a = (i / 26) * Math.PI * 2;
      if (Math.abs(a - Math.PI / 2) < 0.22) continue; // trail gap (south in world +z)
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
    for (const r of this.data.roads) if (distToPolyline(x, y, r.pts, r.loop) < r.width / 2 + margin) return false;
    for (const b of this.data.buildings) {
      if (pointInPoly(x, y, b.poly) || distToPolyEdge(x, y, b.poly).d < margin + 1) return false;
    }
    for (const l of this.data.lots) if (pointInPoly(x, y, l.poly) || distToPolyEdge(x, y, l.poly).d < margin) return false;
    for (const lawn of this.data.lawns) {
      if (lawn.kind === 'quad' || lawn.kind === 'grass') continue;
      if (lawn.circle) { if (Math.hypot(x - lawn.circle[0], y - lawn.circle[1]) < lawn.circle[2] + margin) return false; }
      else if (pointInPoly(x, y, lawn.poly) || distToPolyEdge(x, y, lawn.poly).d < margin) return false;
    }
    for (const p of this.data.props) if (Math.hypot(x - p.x, y - p.y) < p.r + margin + 2) return false;
    // Keep the quad's middle clear
    if (Math.abs(x) < 30 && Math.abs(y - 20) < 25) return false;
    return true;
  }

  buildTrees() {
    const rng = mulberry32(1961);
    const b = this.data.bounds;
    const oaks = [], palms = [];
    const count = this.lowSpec ? 170 : 300;
    let tries = 0;
    while (oaks.length + palms.length < count && tries++ < 8000) {
      const x = b.minX + 6 + rng() * (b.maxX - b.minX - 12);
      const y = b.minY + 10 + rng() * (b.maxY - b.minY - 16);
      if (!this.isOpen(x, y, 3)) continue;
      // Palms line the loop road; oaks everywhere else
      let nearLoop = false;
      for (const r of this.data.roads) if (r.loop && distToPolyline(x, y, r.pts, true) < 12) nearLoop = true;
      const list = nearLoop && rng() < 0.55 ? palms : oaks;
      list.push([x, y, 0.75 + rng() * 0.6, rng() * Math.PI * 2]);
    }
    // Scenery outside the fence (no collision)
    const outside = [];
    for (let i = 0; i < (this.lowSpec ? 120 : 260); i++) {
      const ang = rng() * Math.PI * 2;
      const rad = 400 + rng() * 260;
      outside.push([60 + Math.cos(ang) * rad, 40 + Math.sin(ang) * rad * 0.8, 0.8 + rng() * 0.8, rng() * 6]);
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
  }

  buildHills() {
    // San Gabriel foothills surrounding Placerita Canyon
    const rng = mulberry32(91321);
    const geo = new THREE.IcosahedronGeometry(1, 1);
    const n = 46;
    const hills = new THREE.InstancedMesh(geo, mat(0xa8925f), n);
    const hills2 = new THREE.InstancedMesh(geo, mat(0x8c8a55), n);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), sc = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + rng() * 0.1;
      const rad = 620 + rng() * 200;
      const x = 0 + Math.cos(a) * rad, z = -40 + Math.sin(a) * rad * 0.85;
      const r = 110 + rng() * 120;
      const h = 60 + rng() * 120;
      m4.compose(v.set(x, -10, z), q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rng() * 3), sc.set(r, h, r * 0.8));
      (i % 2 ? hills : hills2).setMatrixAt(i, m4);
    }
    // Unused instances collapse to zero scale
    for (let i = 0; i < n; i++) {
      if (i % 2) hills2.setMatrixAt(i, new THREE.Matrix4().makeScale(0, 0, 0));
      else hills.setMatrixAt(i, new THREE.Matrix4().makeScale(0, 0, 0));
    }
    this.scene.add(hills, hills2);
    // Prayer Hill rise behind the clearing
    const ridge = new THREE.Mesh(geo, mat(0x9f8c5c));
    ridge.scale.set(140, 40, 50);
    ridge.position.set(0, -12, -372);
    this.scene.add(ridge);
  }

  buildCreek() {
    // Placerita Creek: a dry wash with rocks
    const rng = mulberry32(7);
    const rock = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 0), mat(0xb3a587), 80);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), sc = new THREE.Vector3();
    for (let i = 0; i < 80; i++) {
      const x = -330 + rng() * 660, y = -203 - rng() * 17;
      const s = 0.3 + rng() * 1.1;
      m4.compose(v.set(x, s * 0.2, -y), q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rng() * 3), sc.set(s, s * 0.6, s));
      rock.setMatrixAt(i, m4);
    }
    this.scene.add(rock);
    const label = makeLabel('Placerita Creek', null, { width: 10, bg: 'rgba(60,90,120,0.8)' });
    label.position.set(-120, 3, 212);
    this.scene.add(label);
    this.labels.push(label);
  }

  buildLaneHints() {
    // Precompute driving lanes for AI traffic (right-hand traffic)
    this.lanes = [];
    for (const r of this.roads) {
      if (r.traffic && r.loop) {
        this.lanes.push({ pts: offsetPath(r.wpts, 2.5, true), loop: true, name: r.name });
      }
      if (r.lanes === 2) {
        this.lanes.push({ pts: offsetPath(r.wpts, 3.3, false), loop: false, name: r.name + ' E' });
        this.lanes.push({ pts: offsetPath([...r.wpts].reverse(), 3.3, false), loop: false, name: r.name + ' W' });
      }
    }
  }

  onRoad(x, z) {
    for (const r of this.roads) if (distToPolyline(x, z, r.wpts, r.loop) < r.width / 2) return true;
    return false;
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
    return near ? [...near] : [0, -60];
  }

  inBounds(x, z, m = 0) {
    const b = this.bounds;
    return x > b.minX + m && x < b.maxX - m && z > b.minZ + m && z < b.maxZ - m;
  }

  update(dt, t) {
    if (this.fountain) this.fountain.water.position.y = 0.82 + Math.sin(t * 2) * 0.03;
  }
}

// ---------- geometry helpers ----------

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
    let nx = -dz, nz = dx;
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
function offsetPath(pts, off, loop) {
  const n = pts.length;
  const out = [];
  for (let i = 0; i < n; i++) {
    const prev = loop ? pts[(i - 1 + n) % n] : pts[Math.max(0, i - 1)];
    const next = loop ? pts[(i + 1) % n] : pts[Math.min(n - 1, i + 1)];
    let dx = next[0] - prev[0], dz = next[1] - prev[1];
    const l = Math.hypot(dx, dz) || 1;
    dx /= l; dz /= l;
    // Right of forward (dx,dz) in x/z plane viewed from above with -z north: right = (-dz, dx)
    out.push([pts[i][0] - dz * off, pts[i][1] + dx * off]);
  }
  return out;
}

function makeWindowTexture(dorm = false) {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, 64, 64);
  ctx.fillStyle = '#5d7590';
  if (dorm) {
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
