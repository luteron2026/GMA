import * as THREE from 'three';
import { CAMPUS } from './data/campus.js';
import { Colliders, pointInPoly, distToPolyline, mulberry32 } from './physics.js';
import { mat, makeLabel, GEOM } from './models.js';
import { CORE, OUTER, groundY, heightAtCampus, shrubAt, inCore, roofFor, TREES, STRUCTURES, setTerrainStride } from './terrain.js';
import { lookFor, wallTexture, wallEdge, planSite, paintSite, BoxBatch, addDetails, addSite, entranceMonument } from './buildings.js';
import { CAMPUS_STYLE, ENTRANCE_SIGN } from './data/looks.js';
import { planStreetscape, paintShoulders, paintBeds, buildStreetscape, bumpHeight, houseLook, treeNotes } from './streetscape.js';
import { buildSurfaces, cleanStalls, planWalkways, makePavedTest } from './surfaces.js';
import { buildSolarCarports } from './solar.js';
import { planCourts, buildCourts } from './sports.js';

// Convert campus (x east, y north) to world [x, z]
export const W = ([x, y]) => [x, -y];

const GROUND_COLORS = {
  campus: '#93a95c',
  grass: '#7fa652',
  field: '#5f9e45',
  turf: '#4f9a3c',
  pitch: '#44a040',
  court: '#9a4a3c',
  sand: '#e0cf9a',
  dirt: '#b99a6a',
};

const ROAD_COLORS = {
  street: '#3d4046',
  service: '#4a4d53',
  aisle: '#4f5258',
  driveway: '#5c5e62',
  path: '#cfc8b8',
  trail: '#a58a5e',
};

export class World {
  constructor(scene, { lowSpec = false } = {}) {
    this.scene = scene;
    this.lowSpec = lowSpec;
    // Stalls that overlap each other, drives or buildings are dropped
    this.data = { ...CAMPUS, stalls: cleanStalls(CAMPUS.stalls, CAMPUS.buildings) };
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
    this.groundY = groundY;
    setTerrainStride(lowSpec ? 2 : 1);
    this.site = planSite(this); // fountains, pool, courtyards from the Street View notes
    this.street = planStreetscape(this); // signs, poles, fences, gates from the Street View notes
    this.courts = planCourts(); // pickleball and sand volleyball at West Campus
    // Concrete walks between entrances, drives and lots; trees and shrubs keep off them
    const walks = planWalkways(this, (b) => this.doorEdge(b));
    this.walkways = walks.walks;
    this.plazas = walks.pads;
    this.planTrophy();
    this.pavedAt = makePavedTest(this); // campus-space test: streets, drives, lots, walks
    this.planVehicleSpots();
    this.build();
  }

  build() {
    this.buildTerrain();
    this.buildFieldGoals();
    this.buildWashRocks();
    this.buildBuildings();
    buildSurfaces(this);
    this.buildStadium();
    this.buildProps();
    this.buildStreetSigns();
    this.buildStopSigns();
    buildStreetscape(this);
    this.buildBoundary();
    this.buildTrees();
    this.buildStructures();
    const extra = new BoxBatch();
    buildSolarCarports(this, extra);
    buildCourts(this, extra);
    this.buildTrophy(extra);
    extra.flush(this.scene, !this.lowSpec);
    this.buildLaneHints();
  }

  // ---------- ground ----------

  buildTerrain() {
    // Detailed ground from the LiDAR, with lawns, lots, roads and markings painted on
    const g = CORE, st = this.lowSpec ? 2 : 1;
    const nx = (g.nx - 1) / st + 1, ny = (g.ny - 1) / st + 1;
    const pos = new Float32Array(nx * ny * 3), uv = new Float32Array(nx * ny * 2);
    const wx = g.x1 - g.x0, wy = g.y1 - g.y0;
    for (let j = 0, k = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++, k++) {
        const x = g.x0 + i * st * g.step, y = g.y0 + j * st * g.step;
        pos[k * 3] = x; pos[k * 3 + 1] = g.h[j * st * g.nx + i * st]; pos[k * 3 + 2] = -y;
        uv[k * 2] = (x - g.x0) / wx; uv[k * 2 + 1] = (y - g.y0) / wy;
      }
    }
    const idx = new Uint32Array((nx - 1) * (ny - 1) * 6);
    let n = 0;
    for (let j = 0; j < ny - 1; j++) {
      for (let i = 0; i < nx - 1; i++) {
        const a = j * nx + i, b = a + 1, c = a + nx, d = c + 1;
        // Same diagonal (a-d) as terrain.js uses for heights; wound to face up in world space
        idx[n++] = a; idx[n++] = b; idx[n++] = d;
        idx[n++] = a; idx[n++] = d; idx[n++] = c;
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.computeVertexNormals();
    const tex = new THREE.CanvasTexture(this.paintGround(this.lowSpec ? 2 : 3));
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    const ground = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ map: tex }));
    ground.receiveShadow = true;
    this.scene.add(ground);
    this.groundMesh = ground;

    // The mountains around Placerita Canyon, from terrain tiles (coarser, vertex-colored)
    const o = OUTER;
    const opos = new Float32Array(o.nx * o.ny * 3), col = new Float32Array(o.nx * o.ny * 3);
    const rng = mulberry32(31);
    const dry = new THREE.Color(0xb3a066), brush = new THREE.Color(0x7d7d4a), rock = new THREE.Color(0xa08c6c), c = new THREE.Color();
    for (let j = 0, k = 0; j < o.ny; j++) {
      for (let i = 0; i < o.nx; i++, k++) {
        const x = o.x0 + i * o.step, y = o.y0 + j * o.step;
        opos[k * 3] = x; opos[k * 3 + 1] = o.h[k]; opos[k * 3 + 2] = -y;
        const hx = (o.h[Math.min(k + 1, o.h.length - 1)] - o.h[Math.max(k - 1, 0)]) / (2 * o.step);
        const hy = (o.h[Math.min(k + o.nx, o.h.length - 1)] - o.h[Math.max(k - o.nx, 0)]) / (2 * o.step);
        const slope = Math.hypot(hx, hy);
        // North-facing slopes hold more chaparral; steep ones show rock
        const north = hy < 0 ? Math.min(1, -hy * 2) : 0;
        c.copy(dry).lerp(brush, Math.min(1, 0.25 + north * 0.6 + rng() * 0.25)).lerp(rock, Math.min(0.7, Math.max(0, slope - 0.6)));
        col[k * 3] = c.r; col[k * 3 + 1] = c.g; col[k * 3 + 2] = c.b;
      }
    }
    const oidx = [];
    const m = o.step * 1.01;
    for (let j = 0; j < o.ny - 1; j++) {
      for (let i = 0; i < o.nx - 1; i++) {
        const x = o.x0 + i * o.step, y = o.y0 + j * o.step;
        // Skip cells the detailed ground covers completely
        if (x >= g.x0 + m && x + o.step <= g.x1 - m && y >= g.y0 + m && y + o.step <= g.y1 - m) continue;
        const a = j * o.nx + i, b = a + 1, cc = a + o.nx, d = cc + 1;
        oidx.push(a, b, d, a, d, cc);
      }
    }
    const ogeo = new THREE.BufferGeometry();
    ogeo.setAttribute('position', new THREE.BufferAttribute(opos, 3));
    ogeo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    ogeo.setIndex(oidx);
    ogeo.computeVertexNormals();
    const mountains = new THREE.Mesh(ogeo, new THREE.MeshLambertMaterial({ vertexColors: true }));
    mountains.receiveShadow = true;
    this.scene.add(mountains);
  }

  // Paint the ground texture: natural cover from the LiDAR, then everything from the map
  paintGround(ppm) {
    const g = CORE;
    const wx = g.x1 - g.x0, wy = g.y1 - g.y0;
    const cv = document.createElement('canvas');
    cv.width = Math.round(wx * ppm); cv.height = Math.round(wy * ppm);
    const ctx = cv.getContext('2d');
    const P = (x, y) => [(x - g.x0) * ppm, (g.y1 - y) * ppm];

    // 1. Dry grass, chaparral and bare slopes, one pixel per 2 m height sample
    const small = document.createElement('canvas');
    small.width = g.nx; small.height = g.ny;
    const sctx = small.getContext('2d');
    const img = sctx.createImageData(g.nx, g.ny);
    const rng = mulberry32(5);
    const dry = [190, 170, 112], brush = [112, 118, 72], bare = [176, 150, 110];
    for (let j = 0; j < g.ny; j++) {
      for (let i = 0; i < g.nx; i++) {
        const k = j * g.nx + i;
        const i0 = Math.max(0, i - 1), i1 = Math.min(g.nx - 1, i + 1), j0 = Math.max(0, j - 1), j1 = Math.min(g.ny - 1, j + 1);
        const sx = (g.h[j * g.nx + i1] - g.h[j * g.nx + i0]) / ((i1 - i0) * g.step);
        const sy = (g.h[j1 * g.nx + i] - g.h[j0 * g.nx + i]) / ((j1 - j0) * g.step);
        const slope = Math.hypot(sx, sy);
        const x = g.x0 + i * g.step, y = g.y0 + j * g.step;
        const s = Math.min(1, shrubAt(x, y) * 1.6);
        const b = Math.min(0.8, Math.max(0, (slope - 0.5) * 1.2)) * (1 - s);
        const nz = 0.92 + rng() * 0.12;
        const row = (g.ny - 1 - j) * g.nx + i; // canvas rows run north to south
        for (let ch = 0; ch < 3; ch++) {
          const v = dry[ch] * (1 - s) + brush[ch] * s;
          img.data[row * 4 + ch] = (v * (1 - b) + bare[ch] * b) * nz;
        }
        img.data[row * 4 + 3] = 255;
      }
    }
    sctx.putImageData(img, 0, 0);
    ctx.imageSmoothingEnabled = true;
    // Each small pixel is centered on its height sample
    const sp = g.step * ppm;
    ctx.drawImage(small, -sp / 2, -sp / 2, g.nx * sp, g.ny * sp);

    const path = (pts) => {
      ctx.beginPath();
      pts.forEach(([x, y], i) => { const [px, py] = P(x, y); if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py); });
    };
    const fillPoly = (pts, color) => { path(pts); ctx.closePath(); ctx.fillStyle = color; ctx.fill(); };
    const stroke = (pts, color, width, dash) => {
      path(pts);
      ctx.strokeStyle = color; ctx.lineWidth = width * ppm;
      ctx.setLineDash(dash ? dash.map((d) => d * ppm) : []);
      ctx.stroke();
    };
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';

    // 2. Irrigated lawns, fields and courts (real outlines)
    for (const lawn of CAMPUS.lawns) fillPoly(lawn.poly, GROUND_COLORS[lawn.kind]);
    for (const lawn of CAMPUS.lawns) {
      if (lawn.lines && (lawn.kind === 'pitch' || lawn.kind === 'court')) this.paintFieldLines(ctx, P, ppm, lawn.lines, lawn.kind === 'pitch');
    }
    // Baseball diamond
    const d = CAMPUS.diamond;
    fillPoly(d.dirt, '#b5683f');
    fillPoly(d.grass, GROUND_COLORS.turf);
    const [hx, hy] = d.bases[0], [sx, sy] = d.bases[2];
    const [mx, my] = P(hx + (sx - hx) * 0.47, hy + (sy - hy) * 0.47);
    ctx.fillStyle = '#b5683f'; ctx.beginPath(); ctx.arc(mx, my, 2.7 * ppm, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#ffffff';
    d.bases.forEach(([x, y], i) => {
      const [px, py] = P(x, y), s = (i ? 0.5 : 0.6) * ppm;
      ctx.save(); ctx.translate(px, py); ctx.rotate(Math.PI / 4); ctx.fillRect(-s / 2, -s / 2, s, s); ctx.restore();
    });
    // Prayer Hill clearing
    const [phx, phy] = CAMPUS.places.hill;
    const [cpx, cpy] = P(phx, phy);
    ctx.fillStyle = GROUND_COLORS.dirt; ctx.beginPath(); ctx.arc(cpx, cpy, 34 * ppm, 0, Math.PI * 2); ctx.fill();

    // Plazas, the pool and courtyards
    paintSite(ctx, P, ppm, this.site);

    // 3. Dry creek washes
    for (const w of CAMPUS.washes) stroke(w.pts, '#d8c9a3', w.width);

    // 4. Street shoulders and trails. Pavement, lots and painted lines are real geometry
    // (surfaces.js) so their edges stay crisp up close.
    paintShoulders(stroke);
    for (const r of CAMPUS.roads) if (r.kind === 'trail') stroke(r.pts, ROAD_COLORS.trail, r.width);
    // Soft dark verge under pavement edges so they sit into the ground
    for (const lot of CAMPUS.lots) { path(lot.poly); ctx.closePath(); ctx.strokeStyle = 'rgba(70,64,52,0.35)'; ctx.lineWidth = 1.2 * ppm; ctx.stroke(); }
    paintBeds(ctx, P, ppm, this.street);
    ctx.lineCap = 'round';

    // 6. Fine grain so close-up ground isn't flat color
    const tile = document.createElement('canvas');
    tile.width = tile.height = 128;
    const tctx = tile.getContext('2d');
    const timg = tctx.createImageData(128, 128);
    for (let i = 0; i < 128 * 128; i++) {
      const v = 215 + rng() * 40;
      timg.data[i * 4] = timg.data[i * 4 + 1] = timg.data[i * 4 + 2] = v; timg.data[i * 4 + 3] = 255;
    }
    tctx.putImageData(timg, 0, 0);
    ctx.globalCompositeOperation = 'multiply';
    ctx.fillStyle = ctx.createPattern(tile, 'repeat');
    ctx.fillRect(0, 0, cv.width, cv.height);
    ctx.globalCompositeOperation = 'source-over';
    return cv;
  }

  // Field markings from an oriented box [cx, cy, w, h, angle] (campus space)
  paintFieldLines(ctx, P, ppm, [cx, cy, w, h, a], soccer) {
    const [px, py] = P(cx, cy);
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(-a); // canvas y points south
    ctx.scale(ppm, ppm);
    ctx.fillStyle = '#f4f4f4';
    const add = (sx, sz, x, z) => ctx.fillRect(x - sx / 2, z - sz / 2, sx, sz);
    const iw = w - 3, ih = h - 3;
    add(iw, 0.25, 0, -ih / 2); add(iw, 0.25, 0, ih / 2);
    add(0.25, ih, -iw / 2, 0); add(0.25, ih, iw / 2, 0);
    if (soccer) {
      add(0.25, ih, 0, 0);
      ctx.strokeStyle = '#f4f4f4'; ctx.lineWidth = 0.25;
      ctx.beginPath(); ctx.arc(0, 0, 9.15, 0, Math.PI * 2); ctx.stroke();
      for (const sgn of [-1, 1]) {
        add(0.25, 40, sgn * (iw / 2 - 16.5), 0);
        add(16.5, 0.25, sgn * (iw / 2 - 8.25), -20); add(16.5, 0.25, sgn * (iw / 2 - 8.25), 20);
      }
    } else {
      add(0.2, ih, 0, 0);
    }
    ctx.restore();
  }

  buildFieldGoals() {
    for (const lawn of CAMPUS.lawns) {
      if (lawn.kind !== 'pitch' || !lawn.lines) continue;
      const [cx, cy, w, , a] = lawn.lines;
      const iw = w - 3;
      for (const sgn of [-1, 1]) {
        const d = sgn * (iw / 2 + 0.6);
        const x = cx + Math.cos(a) * d, y = cy + Math.sin(a) * d;
        const goal = new THREE.Mesh(GEOM.box, mat(0xffffff));
        goal.scale.set(0.3, 2.4, 7.3);
        goal.position.set(x, heightAtCampus(x, y) + 1.2, -y);
        goal.rotation.y = a;
        this.scene.add(goal);
      }
    }
  }

  buildWashRocks() {
    // Placerita Creek and Newhall Creek: dry, rocky washes
    const rng = mulberry32(7);
    const rocks = [];
    for (const w of CAMPUS.washes) {
      const pts = w.pts.map(W);
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
        label.position.set(best[0], groundY(best[0], best[1]) + 3, best[1]);
        this.scene.add(label);
        this.labels.push(label);
      }
    }
    // No boulders where a road or walk crosses the wash
    for (let i = rocks.length - 1; i >= 0; i--) if (this.pavedAt(rocks[i][0], -rocks[i][1], rocks[i][2] + 0.5)) rocks.splice(i, 1);
    const inst = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 0), mat(0xb3a587), rocks.length);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), sc = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
    rocks.forEach(([x, z, s], i) => {
      m4.compose(v.set(x, groundY(x, z) + s * 0.2, z), q.setFromAxisAngle(up, rng() * 3), sc.set(s, s * 0.6, s));
      inst.setMatrixAt(i, m4);
    });
    this.scene.add(inst);
  }

  // ---------- buildings ----------

  buildBuildings() {
    const houseTex = makeWindowTexture(false, true);
    // Unnamed campus buildings share the campus style from the Street View notes
    const campusStyle = wallTexture(lookFor({ kind: 'campus', id: '' }));
    const campusTex = campusStyle.tex.clone();
    campusTex.repeat.set(1 / campusStyle.bayW, 1 / 3.6);
    campusTex.needsUpdate = true;
    // Named buildings get their own meshes; the ~130 houses and minor buildings are merged
    // into a handful of meshes (one per texture) so phones don't choke on draw calls.
    const batch = new Batcher();
    const boxes = new BoxBatch();
    const rng = mulberry32(77);
    const shadows = !this.lowSpec;
    for (const b of this.buildings) {
      const geo = buildingGeometry(b, roofFor(b.id));
      const { walls, roof, top, base, pitched } = geo;
      b.top = top; b.base = base;
      const look = lookFor(b);
      let roofColor;
      if (!look) roofColor = b.roofColor || (pitched ? 0x8c4a3a : 0x8f8a80);
      else roofColor = look.roof ?? (pitched ? CAMPUS_STYLE.roof : CAMPUS_STYLE.flatRoof);
      // Floor height from the LiDAR wall height and the number of stories
      const eaves = geo.verts.slice(0, geo.n).map((v) => v[2] - (base + 0.3)).sort((a, c) => a - c);
      const eave = eaves[Math.floor(eaves.length / 2)] || 3.6;
      const fit = Math.max(1, Math.round(eave / 3.6));
      // A noted story count only if the walls are tall enough for it
      const stories = look && look.stories ? Math.min(look.stories, Math.max(1, Math.floor(eave / 2.7))) : fit;
      geo.stories = stories;
      geo.floorH = Math.min(5, Math.max(2.8, eave / stories));
      if (b.name) {
        const wt = wallTexture(look);
        const tex = wt.tex.clone();
        tex.repeat.set(1 / wt.bayW, 1 / geo.floorH);
        tex.needsUpdate = true;
        const wm = new THREE.Mesh(walls, new THREE.MeshLambertMaterial({ map: tex }));
        const rm = new THREE.Mesh(roof, mat(roofColor));
        for (const m of [wm, rm]) { m.castShadow = shadows; m.receiveShadow = true; this.scene.add(m); }
      } else if (look) {
        const v = 0.9 + rng() * 0.1;
        batch.add('campusWalls', walls, new THREE.Color(v, v, v));
        batch.add('roofs', roof, roofColor);
      } else {
        // Colors typical of the street the house is on (Street View notes)
        const hl = houseLook(b);
        batch.add(hl && hl.shutters ? 'shutterWalls' : 'houseWalls', walls, hl ? hl.wall : b.color);
        batch.add('roofs', roof, hl ? hl.roof : roofColor);
      }
      this.colliders.addPoly(b.wpts, b.id, top);
      // Keep the roof triangles so the helicopter can land on it
      {
        const pos = roof.getAttribute('position').array;
        let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
        for (let i = 0; i < pos.length; i += 3) { minX = Math.min(minX, pos[i]); maxX = Math.max(maxX, pos[i]); minZ = Math.min(minZ, pos[i + 2]); maxZ = Math.max(maxZ, pos[i + 2]); }
        (this.roofSurfaces = this.roofSurfaces || []).push({ minX, maxX, minZ, maxZ, pos });
      }

      const [cx, cy] = b.obb;
      b.center = [cx, -cy];
      if (b.id === 'chapel') this.addRoofCross(cx, cy, top);
      if (b.name) {
        const label = makeLabel(b.name, b.sub, { width: b.small ? 11 : 15 });
        label.position.set(cx, top + (b.small ? 2.5 : 3.5), -cy);
        this.scene.add(label);
        this.labels.push(label);
        const door = this.addDoor(b, look);
        addDetails(this, b, look, door, geo, boxes);
      }
    }
    addSite(this, this.site, boxes);
    boxes.flush(this.scene, shadows);
    const texFor = { houseWalls: houseTex, shutterWalls: makeWindowTexture(false, true, true), campusWalls: campusTex };
    for (const m of batch.meshes((key) => new THREE.MeshLambertMaterial({ vertexColors: true, map: texFor[key] || null }))) {
      m.castShadow = shadows;
      m.receiveShadow = true;
      this.scene.add(m);
    }
  }

  // Trophy Coffee: the coffee shop at the south end of the MacArthur Center, by the lot
  // along Placerita Canyon Rd. Storefront on the south wall near its east corner, a patio
  // in front (campus space).
  planTrophy() {
    const b = this.buildings.find((q) => q.id === 'chapel');
    if (!b) return;
    const e = wallEdge(b, { dir: [0, -1], minLen: 12 });
    const sgn = e.tx >= 0 ? 1 : -1; // along the wall toward its east end
    const tx = e.tx * sgn, ty = e.ty * sgn, nx = e.nx, ny = e.ny;
    const v = e.len / 2 - 7;
    const x = e.mx + tx * v, y = e.my + ty * v;
    const deep = 6, wide = 12;
    const P = (a, o) => [x + tx * a + nx * o, y + ty * a + ny * o]; // a along the wall, o out from it
    const patio = [P(-wide / 2, 0.2), P(wide / 2, 0.2), P(wide / 2, deep), P(-wide / 2, deep)];
    this.plazas.push(patio);
    this.trophy = { x, y, tx, ty, nx, ny, P, patio };
    this.places.trophy = [P(0, 4)[0], -P(0, 4)[1]];
  }

  buildTrophy(boxes) {
    const t = this.trophy;
    if (!t) return;
    const { P, tx, ty, nx, ny } = t;
    const wallA = Math.atan2(ty, tx), face = Math.atan2(nx, -ny);
    const g = heightAtCampus(...P(0, 1));
    const shadows = !this.lowSpec;
    // Glass storefront with a black frame, and a door in the middle
    const [sx, sy] = P(0, 0.1);
    boxes.add(0x22303c, sx, g + 1.45, -sy, 7.2, 2.7, 0.12, wallA);
    for (const a of [-3.6, -1.8, 0, 1.8, 3.6]) { const [fx, fy] = P(a, 0.16); boxes.add(0x151515, fx, g + 1.45, -fy, 0.12, 2.75, 0.08, wallA); }
    { const [fx, fy] = P(0, 0.16); boxes.add(0x151515, fx, g + 2.82, -fy, 7.4, 0.12, 0.08, wallA); }
    { const [dx, dy] = P(0, 0.2); boxes.add(0x2b1d14, dx, g + 1.15, -dy, 1.1, 2.3, 0.08, wallA); boxes.add(0xc9a227, dx + tx * 0.4, g + 1.1, -(dy + ty * 0.4), 0.05, 0.4, 0.12, wallA); }
    // Black awning with a gold edge
    { const [ax, ay] = P(0, 0.9); boxes.add(0x1c1c1c, ax, g + 3.15, -ay, 8, 0.12, 1.8, wallA, 0, -0.2); const [ex, ey] = P(0, 1.78); boxes.add(0xc9a227, ex, g + 2.98, -ey, 8, 0.22, 0.06, wallA); }
    // Sign over the awning
    const c = document.createElement('canvas');
    c.width = 1024; c.height = 220;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#141414'; ctx.fillRect(0, 0, 1024, 220);
    ctx.strokeStyle = '#c9a227'; ctx.lineWidth = 8; ctx.strokeRect(8, 8, 1008, 204);
    // A little trophy cup
    ctx.fillStyle = '#d9b23a';
    ctx.beginPath(); ctx.moveTo(70, 50); ctx.lineTo(170, 50); ctx.quadraticCurveTo(165, 135, 120, 140); ctx.quadraticCurveTo(75, 135, 70, 50); ctx.fill();
    ctx.fillRect(112, 138, 16, 30); ctx.fillRect(88, 166, 64, 14);
    ctx.lineWidth = 9; ctx.strokeStyle = '#d9b23a';
    ctx.beginPath(); ctx.arc(70, 80, 22, Math.PI * 0.5, Math.PI * 1.5); ctx.stroke();
    ctx.beginPath(); ctx.arc(170, 80, 22, -Math.PI * 0.5, Math.PI * 0.5); ctx.stroke();
    ctx.fillStyle = '#f2e6c8'; ctx.font = 'bold 108px Georgia, "Times New Roman", serif'; ctx.textBaseline = 'middle';
    ctx.fillText('TROPHY COFFEE', 215, 118, 780);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(5, 1.07), new THREE.MeshLambertMaterial({ map: tex, emissive: 0x111111 }));
    const [gx, gy] = P(0, 0.14);
    sign.position.set(gx, g + 3.9, -gy); sign.rotation.y = face;
    this.scene.add(sign);
    // Patio: round tables with chairs and black-and-gold umbrellas
    const top = mat(0x2b2b2b);
    for (const [a, o, color] of [[-4, 3, 0x1c1c1c], [0, 4.2, 0xc9a227], [4, 3, 0x1c1c1c]]) {
      const [x, y] = P(a, o), gt = heightAtCampus(x, y);
      const tbl = new THREE.Mesh(GEOM.cyl, top); tbl.scale.set(1.0, 0.06, 1.0); tbl.position.set(x, gt + 0.75, -y); this.scene.add(tbl);
      boxes.add(0x2b2b2b, x, gt + 0.37, -y, 0.08, 0.75, 0.08, 0);
      for (const k of [0, 1, 2]) {
        const an = (k / 3) * Math.PI * 2 + a;
        const cx = x + Math.cos(an) * 0.85, cy = y + Math.sin(an) * 0.85;
        boxes.add(0x3a3a3a, cx, gt + 0.45, -cy, 0.42, 0.05, 0.42, an);
        boxes.add(0x3a3a3a, cx + Math.cos(an) * 0.2, gt + 0.7, -(cy + Math.sin(an) * 0.2), 0.05, 0.5, 0.42, an);
      }
      boxes.add(0x6b6b6b, x, gt + 1.3, -y, 0.05, 1.1, 0.05, 0);
      const um = new THREE.Mesh(GEOM.cone8, mat(color)); um.scale.set(2.4, 0.5, 2.4); um.position.set(x, gt + 2.05, -y); um.castShadow = shadows;
      this.scene.add(um);
      this.colliders.addCircle(x, -y, 0.55, 'table', gt + 2.3);
    }
    // Chalkboard A-frame menu by the door
    { const [mx, my] = P(2.2, 1.3), gm = heightAtCampus(mx, my); boxes.add(0x1f2a24, mx, gm + 0.5, -my, 0.6, 0.95, 0.06, wallA, 0, 0.18); boxes.add(0x6b4f33, mx, gm + 0.5, -my, 0.66, 1.0, 0.03, wallA, 0, 0.18); }
    const lbl = makeLabel('Trophy Coffee', 'Coffee · Pastries', { width: 10 });
    const [lx, ly] = P(0, 3);
    lbl.position.set(lx, g + 6, -ly);
    this.scene.add(lbl);
    this.labels.push(lbl);
  }

  // Where the tank and the helicopter park (world [x, z, heading])
  planVehicleSpots() {
    const spiral = (cx, cy, maxR, ok) => {
      for (let r = 0; r <= maxR; r += 1.5) {
        const n = Math.max(1, Math.round(r * 2));
        for (let k = 0; k < n; k++) {
          const a = (k / n) * Math.PI * 2, x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
          if (ok(x, y)) return [x, y];
        }
      }
      return [cx, cy];
    };
    const nearBuilding = (x, y, m) => this.buildings.some((b) => pointInPoly(x, y, b.poly) || distToPolyline(x, y, b.poly, true) < m);
    // Helipad: open pavement in the Reese Center lot, with room for the rotor
    const [ex, ey] = W(this.places.eastLot); // back to campus space
    // The open spot that covers the fewest parking stalls (so the lot keeps its rows)
    let pad = [ex, ey], best = Infinity;
    for (let gx = ex - 60; gx <= ex + 60; gx += 1.5) {
      for (let gy = ey - 60; gy <= ey + 60; gy += 1.5) {
        const d = Math.hypot(gx - ex, gy - ey);
        if (d < 12 || d > 60) continue; // off the mission marker, but in this lot
        const lot = CAMPUS.lots.find((l) => pointInPoly(gx, gy, l.poly));
        if (!lot || distToPolyline(gx, gy, lot.poly, true) < 6 || nearBuilding(gx, gy, 9)) continue;
        const stalls = this.data.stalls.filter((st) => Math.hypot(st[0] - gx, st[1] - gy) < 8.5).length;
        const score = stalls * 10 + d * 0.1;
        if (score < best) { best = score; pad = [gx, gy]; }
      }
    }
    // Line the chopper up with the nearest aisle
    let ang = 0, bd = Infinity;
    for (const r of CAMPUS.roads) {
      if (r.kind !== 'aisle' && r.kind !== 'service') continue;
      for (let i = 0; i < r.pts.length - 1; i++) {
        const d = distToPolyline(pad[0], pad[1], [r.pts[i], r.pts[i + 1]]);
        if (d < bd) { bd = d; ang = Math.atan2(r.pts[i + 1][0] - r.pts[i][0], -(r.pts[i + 1][1] - r.pts[i][1])); }
      }
    }
    this.places.helipad = [pad[0], -pad[1], ang];
    // Tank: open lawn at North Campus, off the walks and clear of the buildings
    const [nx, ny] = W(this.places.northLawn);
    const tank = spiral(nx, ny, 60, (x, y) => !this.pavedAt(x, y, 2.5) && !nearBuilding(x, y, 6) &&
      Math.abs(heightAtCampus(x + 4, y) - heightAtCampus(x - 4, y)) < 0.8 && Math.abs(heightAtCampus(x, y + 4) - heightAtCampus(x, y - 4)) < 0.8);
    // Facing the nearest street, like it's guarding the place
    this.places.tankSpot = [tank[0], -tank[1], Math.PI * 0.85];
    // Forklift: parked beside the Trophy Coffee patio, forks toward the wall
    if (this.trophy) {
      const t = this.trophy;
      const [fx, fy] = t.P(-9.5, 3.5);
      const spot = spiral(fx, fy, 20, (x, y) => !nearBuilding(x, y, 2) && !this.pavedAt(x, y, 0.5) && !CAMPUS.roads.some((r) => r.kind !== 'trail' && distToPolyline(x, y, r.pts) < r.width / 2 + 2));
      this.places.forkliftSpot = [spot[0], -spot[1], Math.atan2(-t.nx, t.ny)];
    }
  }

  // The wall with the real entrance: the one by the building's mission spot, or else the
  // wall nearest a road (cached; the walkway planner uses it too)
  doorEdge(b) {
    if (b._door !== undefined) return b._door;
    b._door = b.door
      ? wallEdge(b, { target: b.door })
      : wallEdge(b, {
        score: (mx, my, nx, ny) => {
          let d = Infinity;
          for (const r of this.data.roads) if (r.kind !== 'trail') d = Math.min(d, distToPolyline(mx + nx * 3, my + ny * 3, r.pts) - r.width / 2);
          return -d;
        },
      });
    return b._door;
  }

  // Door (with an awning unless the building has a porch) on the entrance wall
  addDoor(b, look) {
    const e = this.doorEdge(b);
    if (!e) return null;
    const { mx, my, nx, ny } = e;
    const gy = heightAtCampus(mx + nx * 1.5, my + ny * 1.5);
    const rot = Math.atan2(nx, -ny); // world heading of the outward normal (nx, -ny)
    const door = new THREE.Mesh(GEOM.box, mat(0x3a2c22));
    door.scale.set(2.4, 3, 0.2);
    door.position.set(mx + nx * 0.06, gy + 1.5, -(my + ny * 0.06));
    door.rotation.y = rot;
    this.scene.add(door);
    if (look.porch !== 'gable' && look.porch !== 'posts') {
      const awning = new THREE.Mesh(GEOM.box, mat(look.awning ?? look.trim));
      awning.scale.set(3.6, 0.2, 1.6);
      awning.position.set(mx + nx * 0.8, gy + 3.3, -(my + ny * 0.8));
      awning.rotation.y = rot;
      this.scene.add(awning);
    }
    return e;
  }

  addRoofCross(x, y, top) {
    const gold = mat(0xd4af37, { emissive: 0x332200 });
    const v = new THREE.Mesh(GEOM.box, gold); v.scale.set(0.5, 5, 0.5); v.position.set(x, top + 2.5, -y); this.scene.add(v);
    const hbar = new THREE.Mesh(GEOM.box, gold); hbar.scale.set(2.6, 0.5, 0.5); hbar.position.set(x, top + 3.6, -y); this.scene.add(hbar);
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
      step.scale.set(22, 1.2 + k * 0.7, 1.4);
      step.position.set(0, (0.6 + k * 0.7) / 2 - 0.3, -1 + 1.4 * k);
      step.castShadow = !this.lowSpec;
      g.add(step);
    }
    const net = new THREE.Mesh(GEOM.box, new THREE.MeshLambertMaterial({ color: 0x333333, transparent: true, opacity: 0.35 }));
    net.scale.set(16, 6, 0.1); net.position.set(0, 3, -3); g.add(net);
    g.position.set(cx, heightAtCampus(cx, cy), -cy);
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
    label.position.set(px, groundY(px, pz) + 9, pz);
    this.scene.add(label);
    this.labels.push(label);
  }

  buildProps() {
    // University sign at the main entrance on Placerita Canyon Rd
    const [ex, ez] = this.places.mainEntrance;
    const road = this.namedRoads.find((r) => r.name === 'Placerita Canyon Road');
    const ang = road ? roadAngleAt(road.wpts, ex, ez) : 0;
    // Stacked-stone monument with raised lettering and a wood-slat panel (Street View notes)
    entranceMonument(this.scene, ENTRANCE_SIGN, ex, ez, groundY(ex, ez), ang, !this.lowSpec);
    for (const k of [-2, 0, 2, 4.4]) this.colliders.addCircle(ex + Math.cos(ang) * k, ez - Math.sin(ang) * k, 1);

    // Prayer Hill: a wooden cross in a clearing ringed with rocks, open toward the trail
    const [hx, hz] = this.places.hill;
    const wood = mat(0x6b4a2b);
    const cy = groundY(hx, hz - 22);
    const v = new THREE.Mesh(GEOM.box, wood); v.scale.set(0.6, 10, 0.6); v.position.set(hx, cy + 4, hz - 22); v.castShadow = true; this.scene.add(v);
    const hb = new THREE.Mesh(GEOM.box, wood); hb.scale.set(4, 0.6, 0.6); hb.position.set(hx, cy + 6.8, hz - 22); this.scene.add(hb);
    this.colliders.addCircle(hx, hz - 22, 1, 'cross', cy + 9);
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
      m.position.set(x, groundY(x, z) + sc * 0.1, z);
      m.castShadow = !this.lowSpec;
      this.scene.add(m);
      this.colliders.addCircle(x, z, sc * 0.5);
    }
    const hl = makeLabel('Prayer Hill', null, { width: 9, bg: 'rgba(90,60,30,0.85)' });
    hl.position.set(hx, cy + 13, hz - 22);
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
      g.position.set(x, groundY(x, z), z);
      this.scene.add(g);
      this.colliders.addCircle(x, z, 0.25);
    }
  }

  // Red octagonal stop signs where the map has them, facing the traffic they stop
  buildStopSigns() {
    if (!CAMPUS.stops || !CAMPUS.stops.length) return;
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const ctx = c.getContext('2d');
    const oct = (r) => {
      ctx.beginPath();
      for (let i = 0; i < 8; i++) {
        const a = Math.PI / 8 + (i * Math.PI) / 4;
        ctx.lineTo(64 + Math.cos(a) * r, 64 + Math.sin(a) * r);
      }
      ctx.closePath();
    };
    ctx.fillStyle = '#ffffff'; oct(63); ctx.fill();
    ctx.fillStyle = '#c4161c'; oct(57); ctx.fill();
    ctx.fillStyle = '#ffffff'; ctx.font = 'bold 38px Arial, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('STOP', 64, 66, 110);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const face = new THREE.MeshBasicMaterial({ map: tex, transparent: true, alphaTest: 0.5 });
    const back = mat(0x9a9ea3);
    const plate = new THREE.PlaneGeometry(0.9, 0.9);
    const pole = mat(0x7d8288);
    for (const [sx, sy, facing] of CAMPUS.stops) {
      const [x, z] = W([sx, sy]);
      const g = new THREE.Group();
      const post = new THREE.Mesh(GEOM.cyl, pole);
      post.scale.set(0.09, 2.4, 0.09); post.position.y = 1.2; g.add(post);
      const f = new THREE.Mesh(plate, face); f.position.set(0, 2.4, 0.06); g.add(f);
      const b = new THREE.Mesh(plate, back); b.rotation.y = Math.PI; b.position.set(0, 2.4, 0.05); g.add(b);
      g.position.set(x, groundY(x, z), z);
      // facing: campus-space direction the sign's face points toward (at oncoming drivers)
      g.rotation.y = Math.atan2(Math.cos(facing), -Math.sin(facing));
      this.scene.add(g);
      this.colliders.addCircle(x, z, 0.2);
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
    // Short sections that follow the ground
    const pieces = [];
    for (const [a, c] of sides) {
      const len = Math.hypot(c[0] - a[0], c[1] - a[1]);
      const n = Math.ceil(len / 6);
      for (let i = 0; i < n; i++) {
        const p = [a[0] + ((c[0] - a[0]) * i) / n, a[1] + ((c[1] - a[1]) * i) / n];
        const q = [a[0] + ((c[0] - a[0]) * (i + 1)) / n, a[1] + ((c[1] - a[1]) * (i + 1)) / n];
        pieces.push([p, q]);
      }
    }
    const inst = new THREE.InstancedMesh(GEOM.box, fence, pieces.length);
    const m4 = new THREE.Matrix4(), q4 = new THREE.Quaternion(), e = new THREE.Euler(0, 0, 0, 'YXZ'), v = new THREE.Vector3(), sc = new THREE.Vector3();
    pieces.forEach(([p, q], i) => {
      const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
      const hp = groundY(p[0], p[1]), hq = groundY(q[0], q[1]);
      e.set(0, -Math.atan2(q[1] - p[1], q[0] - p[0]), Math.atan2(hq - hp, len));
      m4.compose(v.set((p[0] + q[0]) / 2, (hp + hq) / 2 + 0.5, (p[1] + q[1]) / 2), q4.setFromEuler(e), sc.set(Math.hypot(len, hq - hp) + 0.05, 1.4, 0.3));
      inst.setMatrixAt(i, m4);
    });
    this.scene.add(inst);
    this.colliders.addPoly([[b.minX - 50, b.minZ - 50], [b.maxX + 50, b.minZ - 50], [b.maxX + 50, b.minZ - t], [b.minX - 50, b.minZ - t]]);
    this.colliders.addPoly([[b.minX - 50, b.maxZ + t], [b.maxX + 50, b.maxZ + t], [b.maxX + 50, b.maxZ + 50], [b.minX - 50, b.maxZ + 50]]);
    this.colliders.addPoly([[b.minX - 50, b.minZ - 50], [b.minX - t, b.minZ - 50], [b.minX - t, b.maxZ + 50], [b.minX - 50, b.maxZ + 50]]);
    this.colliders.addPoly([[b.maxX + t, b.minZ - 50], [b.maxX + 50, b.minZ - 50], [b.maxX + 50, b.maxZ + 50], [b.maxX + t, b.maxZ + 50]]);
  }

  inCampus(x, z) {
    for (const a of this.campusAreas) if (pointInPoly(x, z, a)) return true;
    return false;
  }

  // ---------- trees, shrubs and structures ----------

  // Can a tree or shrub grow at this campus point? Not on pavement (with a margin), in or
  // against a building, on a playing field or court, or on the pool deck.
  plantable(x, y, m = 0) {
    if (!this._plantCheck) {
      const blds = this.buildings.map((b) => {
        const xs = b.poly.map((p) => p[0]), ys = b.poly.map((p) => p[1]);
        return { poly: b.poly, x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
      });
      const fields = CAMPUS.lawns.filter((l) => ['pitch', 'court', 'turf', 'sand'].includes(l.kind)).map((l) => l.poly)
        .concat([CAMPUS.diamond.dirt, CAMPUS.diamond.grass]);
      const pools = this.site.pools.map((pl) => pl.deck);
      this._plantCheck = { blds, fields, pools };
    }
    const { blds, fields, pools } = this._plantCheck;
    if (this.pavedAt(x, y, m)) return false;
    // Room for the parked tank and the helicopter's rotor
    const spots = [[...this.places.tankSpot, 6], [...this.places.helipad, 8]];
    if (this.places.forkliftSpot) spots.push([...this.places.forkliftSpot, 3.5]);
    for (const [px, pz, , r] of spots) if (Math.hypot(x - px, y + pz) < r) return false;
    for (const b of blds) {
      if (x < b.x0 - 1 || x > b.x1 + 1 || y < b.y0 - 1 || y > b.y1 + 1) continue;
      if (pointInPoly(x, y, b.poly) || distToPolyline(x, y, b.poly, true) < 1) return false;
    }
    if (fields.some((p) => pointInPoly(x, y, p))) return false;
    if (pools.some((p) => pointInPoly(x, y, p))) return false;
    if (this.site.fountains.some((f) => Math.hypot(x - f.x, y - f.y) < f.plaza + 0.5)) return false;
    return true;
  }

  // Every tree the LiDAR found, at its real spot, height and crown size
  buildTrees() {
    const rng = mulberry32(1961);
    const broad = [], palms = [], conifers = [];
    // Particular trees from the Street View notes (palm species, stone pines, crape myrtles)
    const notes = treeNotes(TREES, (x, y) => this.plantable(x, y, 2.5));
    const all0 = TREES.map((t, i) => ({ t, style: notes.styles.get(i) }))
      .concat(notes.extra.map((e) => ({ t: [e.x, e.y, e.h, e.r, e.style.endsWith('Palm') ? 1 : 0, e.style.endsWith('Palm') ? 0.85 : 0.35, 0, 0], style: e.style })));
    for (const { t, style } of all0) {
      let [tx, ty, h, r, kind, cb, dx, dy] = t;
      // Nothing growing out of pavement, buildings, sports fields or the pool deck
      if (!this.plantable(tx, ty, 0.6)) continue;
      // The LiDAR crown can sit a few meters off the trunk; past ~1.5 m the trunk leans
      // unnaturally, so pull the crown back over it
      const lean = Math.hypot(dx, dy), maxLean = Math.min(1.5, h * 0.12);
      if (lean > maxLean) { dx *= maxLean / lean; dy *= maxLean / lean; }
      const [x, z] = W([tx, ty]);
      const g = groundY(x, z);
      const tree = { x, z, g, h, r, cb: Math.max(0.12, Math.min(0.75, cb)) * h, cx: x + dx, cz: z - dy, rot: rng() * Math.PI * 2, c: rng() };
      if (style === 'canaryPalm') { kind = 1; tree.h = Math.max(h, 10); tree.trunkW = 1.7; tree.frond = 5; tree.cx = x; tree.cz = z; }
      else if (style === 'fanPalm') { kind = 1; tree.h = Math.max(h, 16); tree.trunkW = 0.75; tree.frond = 2.2; tree.cx = x; tree.cz = z; }
      else if (style === 'stonePine') { kind = 0; tree.cb = 0.68 * tree.h; tree.r = r * 1.15; tree.color = 0x3f5f33; }
      else if (style === 'crapeMyrtle') { kind = 0; tree.color = 0xd77aa8; }
      (kind === 1 ? palms : kind === 2 ? conifers : broad).push(tree);
      if (this.inBounds(x, z, -2)) this.colliders.addCircle(x, z, Math.min(0.9, 0.3 + tree.h * 0.025 * (tree.trunkW || 1)), 'tree', tree.g + tree.h);
    }
    // Scenery beyond the LiDAR area: oaks in the canyons around (no collision)
    const outside = [];
    const nOut = this.lowSpec ? 220 : 520;
    for (let tries = 0; outside.length < nOut && tries < 20000; tries++) {
      const a = rng() * Math.PI * 2, rad = 420 + rng() * 900;
      const x = -30 + Math.cos(a) * rad, y = Math.sin(a) * rad;
      if (inCore(x, y)) continue;
      // Oaks favor the canyon bottoms
      const h0 = heightAtCampus(x, y), around = (heightAtCampus(x + 40, y) + heightAtCampus(x - 40, y) + heightAtCampus(x, y + 40) + heightAtCampus(x, y - 40)) / 4;
      if (h0 > around + 2 && rng() < 0.8) continue;
      const h = 6 + rng() * 7;
      outside.push({ x, z: -y, g: h0, h, r: 2.5 + rng() * 3, cb: h * 0.3, cx: x, cz: -y, rot: rng() * 6, c: rng() });
    }
    const all = broad.concat(outside);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), sc = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0), dir = new THREE.Vector3(), col = new THREE.Color();
    const shadow = !this.lowSpec;

    // Broadleaf: trunk leaning toward the crown, then two leafy blobs
    const trunkGeo = new THREE.CylinderGeometry(0.7, 1, 1, 6).translate(0, 0.5, 0);
    const crownGeo = new THREE.IcosahedronGeometry(1, this.lowSpec ? 0 : 1);
    const trunks = new THREE.InstancedMesh(trunkGeo, mat(0x6b4f33), all.length);
    const crowns = new THREE.InstancedMesh(crownGeo, fadeNearCamera(new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true })), all.length * 2);
    const leaf = [new THREE.Color(0x4f7a3a), new THREE.Color(0x667f3c), new THREE.Color(0x3f6b35), new THREE.Color(0x7a8a4a)];
    let ci = 0;
    all.forEach((t, i) => {
      const crownH = Math.max(1.6, t.h - t.cb);
      const midY = t.g + t.cb + crownH / 2;
      dir.set(t.cx - t.x, t.cb + crownH * 0.3, t.cz - t.z);
      const L = dir.length();
      q.setFromUnitVectors(up, dir.normalize());
      const tw = 0.18 + t.h * 0.022;
      m4.compose(v.set(t.x, t.g - 0.3, t.z), q, sc.set(tw, L + 0.3, tw));
      trunks.setMatrixAt(i, m4);
      q.setFromAxisAngle(up, t.rot);
      m4.compose(v.set(t.cx, midY, t.cz), q, sc.set(t.r, crownH / 2, t.r * 0.92));
      crowns.setMatrixAt(ci, m4);
      if (t.color) col.set(t.color).multiplyScalar(0.92 + t.c * 0.12);
      else col.copy(leaf[Math.floor(t.c * leaf.length)]).multiplyScalar(0.9 + t.c * 0.2);
      crowns.setColorAt(ci++, col);
      const off = t.r * 0.35;
      m4.compose(v.set(t.cx + Math.cos(t.rot) * off, midY + crownH * 0.22, t.cz + Math.sin(t.rot) * off), q, sc.set(t.r * 0.7, crownH * 0.36, t.r * 0.7));
      crowns.setMatrixAt(ci, m4);
      col.multiplyScalar(1.12);
      crowns.setColorAt(ci++, col);
    });
    crowns.count = ci;
    trunks.castShadow = crowns.castShadow = shadow;
    this.scene.add(trunks, crowns);

    // Palms: tall bare trunk with a head of fronds
    const pTrunk = new THREE.CylinderGeometry(0.2, 0.3, 1, 6).translate(0, 0.5, 0);
    const frond = new THREE.ConeGeometry(0.45, 1, 4).rotateX(Math.PI / 2).translate(0, 0, 0.5);
    const ptr = new THREE.InstancedMesh(pTrunk, mat(0x8a6d4d), palms.length);
    const pfr = new THREE.InstancedMesh(frond, fadeNearCamera(new THREE.MeshLambertMaterial({ color: 0x3f7a35 })), palms.length * 8);
    const e = new THREE.Euler(0, 0, 0, 'YXZ');
    palms.forEach((t, i) => {
      const top = t.h - 0.8;
      const tw = t.trunkW || 1;
      m4.compose(v.set(t.x, t.g - 0.2, t.z), q.identity(), sc.set(tw, top + 0.2, tw)); ptr.setMatrixAt(i, m4);
      const fl = t.frond || Math.max(2.4, t.r * 1.15);
      for (let k = 0; k < 8; k++) {
        e.set(0.25 + (k % 2) * 0.3, (k / 8) * Math.PI * 2 + t.rot, 0);
        q.setFromEuler(e);
        m4.compose(v.set(t.x, t.g + top, t.z), q, sc.set(tw, tw, fl));
        pfr.setMatrixAt(i * 8 + k, m4);
      }
    });
    ptr.castShadow = pfr.castShadow = shadow;
    this.scene.add(ptr, pfr);

    // Conifers (pines, cedars, cypress): narrow cones
    const cone = new THREE.ConeGeometry(1, 1, 7).translate(0, 0.5, 0);
    const ctr = new THREE.InstancedMesh(trunkGeo, mat(0x5a4330), conifers.length);
    const cco = new THREE.InstancedMesh(cone, fadeNearCamera(new THREE.MeshLambertMaterial({ color: 0x35583a, flatShading: true })), conifers.length);
    conifers.forEach((t, i) => {
      m4.compose(v.set(t.x, t.g - 0.2, t.z), q.identity(), sc.set(0.25, t.cb + 1.2, 0.25)); ctr.setMatrixAt(i, m4);
      m4.compose(v.set(t.cx, t.g + t.cb, t.cz), q.setFromAxisAngle(up, t.rot), sc.set(t.r, t.h - t.cb, t.r)); cco.setMatrixAt(i, m4);
    });
    ctr.castShadow = cco.castShadow = shadow;
    this.scene.add(ctr, cco);

    this.buildShrubs(rng);
  }

  // Chaparral, hedges and brush where the LiDAR found low vegetation (walk-through)
  buildShrubs(rng) {
    const g = CORE;
    const bushes = [];
    const max = this.lowSpec ? 1800 : 4500;
    for (let y = g.y0 + 2; y < g.y1 - 2; y += 4) {
      for (let x = g.x0 + 2; x < g.x1 - 2; x += 4) {
        const d = shrubAt(x, y);
        if (d < 0.2 || rng() > d * 0.85) continue;
        const px = x + (rng() - 0.5) * 3, py = y + (rng() - 0.5) * 3;
        const [wx, wz] = W([px, py]);
        if (this.colliders.pointBlocked(wx, wz, 0.8) || !this.plantable(px, py, 1.4)) continue;
        bushes.push([wx, wz, 0.7 + d * 1.3 + rng() * 0.5, rng()]);
      }
    }
    // Brush on the mountains outside the LiDAR area
    const nOut = this.lowSpec ? 500 : 1400;
    for (let i = 0; i < nOut; i++) {
      const a = rng() * Math.PI * 2, rad = 420 + rng() * 800;
      const x = -30 + Math.cos(a) * rad, y = Math.sin(a) * rad;
      if (inCore(x, y)) continue;
      bushes.push([x, -y, 2 + rng() * 2.5, rng()]);
    }
    // Keep the closest to campus if there are too many
    if (bushes.length > max) {
      bushes.sort((a, b) => Math.hypot(a[0] + 30, a[1]) - Math.hypot(b[0] + 30, b[1]));
      bushes.length = max;
    }
    const inst = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 0), new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true }), bushes.length);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), sc = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
    const shades = [new THREE.Color(0x6f7a45), new THREE.Color(0x5f6b3e), new THREE.Color(0x857f50), new THREE.Color(0x76844a)];
    bushes.forEach(([x, z, s, c], i) => {
      m4.compose(v.set(x, groundY(x, z) + s * 0.3, z), q.setFromAxisAngle(up, c * 9), sc.set(s * 1.2, s * 0.75, s * 1.05));
      inst.setMatrixAt(i, m4);
      inst.setColorAt(i, shades[Math.floor(c * shades.length)]);
    });
    this.scene.add(inst);
  }

  // Carports, sheds and other structures the LiDAR sees that the map doesn't have
  buildStructures() {
    const walls = [], caps = [], tops = [], posts = [];
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), sc = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
    for (const [cx, cy, len, wid, ang, h] of STRUCTURES) {
      const [x, z] = W([cx, cy]);
      const gy = groundY(x, z);
      const inLot = this.lots.some((l) => pointInPoly(x, z, l.wpts));
      const c = Math.cos(ang), s = Math.sin(ang);
      const at = (a, b) => [x + a * c - b * s, z - (a * s + b * c)]; // local (a, b) -> world
      // Most of these overlapping a mapped building are parts of it (a wing, a roof
      // structure) that the footprint already covers: drawing them made gray boxes
      const probe = [[0, 0], [-0.3, -0.3], [0.3, -0.3], [0.3, 0.3], [-0.3, 0.3]].map(([a, b]) => at(a * len, b * wid));
      const covered = probe.filter(([px, pz]) => this.buildings.some((b) => pointInPoly(px, pz, b.wpts))).length;
      if (covered >= 2) continue;
      if (!inLot && this.pavedAt(cx, cy, 0)) continue; // nothing standing in the road
      // In a lot, a canopy whose posts would stand in a drive aisle is something parked
      if (inLot && [[-0.45, -0.42], [0.45, -0.42], [0.45, 0.42], [-0.45, 0.42]].some(([a, b]) => {
        const [px, pz] = at(a * len, b * wid);
        return this.roads.some((r) => r.kind !== 'trail' && distToPolyline(px, pz, r.wpts) < r.width / 2 + 0.3);
      })) continue;
      const campus = this.inCampus(x, z);
      q.setFromAxisAngle(up, ang); // local x along the long side
      if (inLot) (this.lotCarports = this.lotCarports || []).push([cx, cy, Math.max(len, wid) / 2]);
      if (inLot || len > 14) {
        // Open carport / shade canopy: roof on posts, drive under it
        tops.push([m4.compose(v.set(x, gy + h - 0.15, z), q, sc.set(len, 0.3, wid)).clone(), campus && !inLot ? CAMPUS_STYLE.roof : 0x7d7f80]);
        for (const sx of [-0.45, 0.45]) for (const sz of [-0.42, 0.42]) {
          const [px, pz] = at(sx * len, sz * wid);
          const pg = groundY(px, pz);
          posts.push([m4.compose(v.set(px, (pg + gy + h) / 2, pz), q, sc.set(0.25, gy + h - pg, 0.25)).clone(), campus && !inLot ? CAMPUS_STYLE.trim : 0x6c6e70]);
          this.colliders.addCircle(px, pz, 0.25, 'carport', gy + h);
        }
      } else {
        // A shed or outbuilding: stucco on campus, plain siding elsewhere, with a roof cap
        walls.push([m4.compose(v.set(x, gy + (h - 1) / 2, z), q, sc.set(len, h + 1, wid)).clone(), campus ? CAMPUS_STYLE.wall : 0xd8cdb8]);
        caps.push([m4.compose(v.set(x, gy + h + 0.1, z), q, sc.set(len + 0.4, 0.25, wid + 0.4)).clone(), campus ? CAMPUS_STYLE.roof : 0x7a6a5a]);
        this.colliders.addPoly([at(-len / 2, -wid / 2), at(len / 2, -wid / 2), at(len / 2, wid / 2), at(-len / 2, wid / 2)], 'structure', gy + h + 0.3);
      }
    }
    const byColor = new Map();
    for (const [m, color] of [...walls, ...caps, ...tops, ...posts]) {
      if (!byColor.has(color)) byColor.set(color, []);
      byColor.get(color).push(m);
    }
    for (const [color, list] of byColor) {
      const inst = new THREE.InstancedMesh(GEOM.box, mat(color), list.length);
      list.forEach((m, i) => inst.setMatrixAt(i, m));
      inst.castShadow = !this.lowSpec; inst.receiveShadow = true;
      this.scene.add(inst);
    }
  }

  // ---------- traffic ----------

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

  onRoad(x, z, withPaths = false) {
    for (const r of this.roads) {
      if (!withPaths && (r.kind === 'path' || r.kind === 'trail')) continue;
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

  // Highest thing to stand or land on at a world point: the ground or a building's roof
  surfaceAt(x, z) {
    let h = groundY(x, z);
    for (const r of this.roofSurfaces || []) {
      if (x < r.minX || x > r.maxX || z < r.minZ || z > r.maxZ) continue;
      const p = r.pos;
      for (let i = 0; i < p.length; i += 9) {
        const ax = p[i], az = p[i + 2], bx = p[i + 3], bz = p[i + 5], cx = p[i + 6], cz = p[i + 8];
        const d = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
        if (Math.abs(d) < 1e-9) continue;
        const u = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / d;
        const v = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / d;
        if (u < -1e-4 || v < -1e-4 || u + v > 1 + 1e-4) continue;
        h = Math.max(h, u * p[i + 1] + v * p[i + 4] + (1 - u - v) * p[i + 7]);
      }
    }
    return h;
  }

  // Height of a speed bump at a world point (cars bounce over them)
  bumpHeight(x, z) { return bumpHeight(this.street, x, -z); }

  inBounds(x, z, m = 0) {
    const b = this.bounds;
    return x > b.minX + m && x < b.maxX - m && z > b.minZ + m && z < b.maxZ - m;
  }

  update() {}
}

// ---------- geometry helpers ----------

// Cut away foliage right around the camera so a tree crown never hides the player
function fadeNearCamera(material, radius = 6.5) {
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = 'varying vec3 vFadeWP;\n' + shader.vertexShader.replace('#include <project_vertex>', `#include <project_vertex>
      vec4 fadeP = vec4(transformed, 1.0);
      #ifdef USE_INSTANCING
        fadeP = instanceMatrix * fadeP;
      #endif
      vFadeWP = (modelMatrix * fadeP).xyz;`);
    shader.fragmentShader = 'varying vec3 vFadeWP;\n' + shader.fragmentShader.replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
      if (distance(vFadeWP, cameraPosition) < ${radius.toFixed(1)}) discard;`);
  };
  return material;
}

// Walls and roof for one building, from its LiDAR roof (or a flat fallback)
function buildingGeometry(b, roof) {
  if (!roof) {
    let base = Infinity;
    for (const [x, y] of b.poly) base = Math.min(base, heightAtCampus(x, y));
    base -= 0.3;
    roof = { base, n: b.poly.length, verts: b.poly.map(([x, y]) => [x, y, base + 0.3 + b.height]), tris: null, pitched: false };
  }
  const { base, n } = roof;
  let verts = roof.verts;
  // Where the LiDAR roof comes out lower than a person on the uphill side (or the footprint
  // is off), raise the whole roof so every wall is at least 2.6 m tall
  let lift = 0;
  for (let k = 0; k < n; k++) lift = Math.max(lift, heightAtCampus(verts[k][0], verts[k][1]) + 2.6 - verts[k][2]);
  if (lift > 0) verts = verts.map(([x, y, z]) => [x, y, z + lift]);
  const wall = { pos: [], nrm: [], uv: [] };
  let s = 0;
  for (let k = 0; k < n; k++) {
    const a = verts[k], c = verts[(k + 1) % n];
    const len = Math.hypot(c[0] - a[0], c[1] - a[1]);
    if (len < 1e-3) continue;
    // Outward normal for a counter-clockwise ring (campus space), in world space
    const nx = (c[1] - a[1]) / len, nz = (c[0] - a[0]) / len;
    const A0 = [a[0], base, -a[1]], C0 = [c[0], base, -c[1]], A1 = [a[0], a[2], -a[1]], C1 = [c[0], c[2], -c[1]];
    const uA = s / 1, uC = (s + len) / 1;
    pushTri(wall, [A0, C0, C1], [[uA, 0], [uC, 0], [uC, c[2] - base]], [nx, 0, nz]);
    pushTri(wall, [A0, C1, A1], [[uA, 0], [uC, c[2] - base], [uA, a[2] - base]], [nx, 0, nz]);
    s += len;
  }
  const rf = { pos: [], nrm: [], uv: [] };
  let top = -Infinity;
  for (const v of verts) top = Math.max(top, v[2]);
  if (roof.tris) {
    for (let i = 0; i < roof.tris.length; i += 3) {
      const p = [roof.tris[i], roof.tris[i + 1], roof.tris[i + 2]].map((k) => [verts[k][0], verts[k][2], -verts[k][1]]);
      pushTri(rf, p, [[0, 0], [0, 0], [0, 0]], [0, 1, 0], true);
    }
  } else {
    const shape = new THREE.Shape(verts.map(([x, y]) => new THREE.Vector2(x, y)));
    const tris = THREE.ShapeUtils.triangulateShape(shape.getPoints(), []);
    for (const t of tris) pushTri(rf, t.map((k) => [verts[k][0], verts[k][2], -verts[k][1]]), [[0, 0], [0, 0], [0, 0]], [0, 1, 0], true);
  }
  return { walls: toGeometry(wall), roof: toGeometry(rf), top, base, pitched: roof.pitched, verts, n };
}

// Add a triangle facing `want` (flips the winding if needed); flat normal
function pushTri(buf, p, uv, want, faceNormal = false) {
  const ux = p[1][0] - p[0][0], uy = p[1][1] - p[0][1], uz = p[1][2] - p[0][2];
  const vx = p[2][0] - p[0][0], vy = p[2][1] - p[0][1], vz = p[2][2] - p[0][2];
  let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
  let order = [0, 1, 2];
  if (nx * want[0] + ny * want[1] + nz * want[2] < 0) { order = [0, 2, 1]; nx = -nx; ny = -ny; nz = -nz; }
  const l = Math.hypot(nx, ny, nz) || 1;
  const n = faceNormal ? [nx / l, ny / l, nz / l] : want;
  for (const k of order) {
    buf.pos.push(p[k][0], p[k][1], p[k][2]);
    buf.nrm.push(n[0], n[1], n[2]);
    buf.uv.push(uv[k][0], uv[k][1]);
  }
}

function toGeometry(buf) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(buf.pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(buf.nrm, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(buf.uv, 2));
  geo.computeBoundingSphere();
  return geo;
}

// Merges many geometries into one mesh per key, with per-vertex colors.
class Batcher {
  constructor() { this.parts = new Map(); }

  add(key, geo, color) {
    const g = geo.index ? geo.toNonIndexed() : geo;
    let p = this.parts.get(key);
    if (!p) this.parts.set(key, (p = { pos: [], nrm: [], uv: [], col: [] }));
    const pos = g.getAttribute('position'), nrm = g.getAttribute('normal'), uv = g.getAttribute('uv');
    const c = new THREE.Color(color);
    for (let i = 0; i < pos.count; i++) {
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

function makeWindowTexture(dorm = false, house = false, shutters = false) {
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
    if (shutters) { ctx.fillStyle = '#1c1c1c'; ctx.fillRect(9, 17, 8, 24); ctx.fillRect(47, 17, 8, 24); }
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
