// Walk-in interiors, laid out from the photos on the university's campus map (cdn.maps.
// moderncampus.net map 530; written observations, no imagery copied). Each interior is its own
// small scene: press E at the building's door to go in, E at the door inside to come back out.
// Coordinates inside: meters, x across the room, z away from the entrance door (at z = 0),
// y up from the floor. The player walks the same way as outside (tank controls).
import * as THREE from 'three';
import { makePerson, animatePerson, randomLook, GEOM, mat } from './models.js';
import { clamp, lerp } from './physics.js';

// ---------- canvas textures ----------

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return [c, c.getContext('2d')];
}
function tex(c, repeat) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat[0], repeat[1]); }
  return t;
}
function rng(seed) { return () => ((seed = (seed * 16807) % 2147483647) / 2147483647); }
const hex = (c) => (typeof c === 'string' ? c : '#' + c.toString(16).padStart(6, '0'));

const T = {
  // Wood planks running along x; one tile = 2 m
  planks(base, seed = 3) {
    const [c, x] = canvas(256, 256), r = rng(seed);
    x.fillStyle = base; x.fillRect(0, 0, 256, 256);
    for (let row = 0; row < 16; row++) {
      let px = -r() * 200;
      while (px < 256) {
        const w = 90 + r() * 110;
        x.fillStyle = `rgba(${r() < 0.5 ? '0,0,0' : '255,255,255'},${0.03 + r() * 0.07})`;
        x.fillRect(px, row * 16, w, 16);
        x.fillStyle = 'rgba(0,0,0,0.25)'; x.fillRect(px, row * 16, 1.5, 16);
        px += w;
      }
      x.fillStyle = 'rgba(0,0,0,0.22)'; x.fillRect(0, row * 16, 256, 1);
    }
    return c;
  },
  herringbone(base) {
    const [c, x] = canvas(256, 256), r = rng(9);
    x.fillStyle = base; x.fillRect(0, 0, 256, 256);
    for (let i = -8; i < 16; i++) for (let j = -2; j < 10; j++) {
      const ox = i * 32 + j * 32, oy = j * 32 - i * 0;
      x.save(); x.translate(ox, oy + (i % 2) * 16);
      x.rotate((i % 2 ? 1 : -1) * Math.PI / 4);
      x.fillStyle = `rgba(${r() < 0.5 ? '60,40,25' : '255,240,220'},${0.08 + r() * 0.12})`;
      x.fillRect(0, 0, 44, 11); x.strokeStyle = 'rgba(50,35,25,0.35)'; x.strokeRect(0, 0, 44, 11);
      x.restore();
    }
    return c;
  },
  tiles(base, grout, n = 4, speck = 0.04) {
    const [c, x] = canvas(256, 256), r = rng(5);
    x.fillStyle = base; x.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 2500; i++) { x.fillStyle = `rgba(0,0,0,${r() * speck})`; x.fillRect(r() * 256, r() * 256, 2, 2); }
    x.fillStyle = grout;
    for (let k = 0; k <= n; k++) { x.fillRect(k * 256 / n - 1, 0, 2, 256); x.fillRect(0, k * 256 / n - 1, 256, 2); }
    return c;
  },
  mottled(base, amt = 0.06, seed = 4) {
    const [c, x] = canvas(256, 256), r = rng(seed);
    x.fillStyle = base; x.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 260; i++) {
      const g = x.createRadialGradient(0, 0, 0, 0, 0, 30);
      const tone = r() < 0.5 ? '0,0,0' : '255,255,255';
      g.addColorStop(0, `rgba(${tone},${r() * amt})`); g.addColorStop(1, `rgba(${tone},0)`);
      x.save(); x.translate(r() * 256, r() * 256); x.fillStyle = g; x.fillRect(-30, -30, 60, 60); x.restore();
    }
    return c;
  },
  carpet(base, seed = 6) {
    const [c, x] = canvas(256, 256), r = rng(seed);
    x.fillStyle = base; x.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 9000; i++) { x.fillStyle = `rgba(${r() < 0.5 ? '0,0,0' : '255,255,255'},${r() * 0.09})`; x.fillRect(r() * 256, r() * 256, 1.5, 1.5); }
    return c;
  },
  // Carpet tiles laid in alternating directions (the gray-blue office carpet)
  carpetTiles(base) {
    const [c, x] = canvas(256, 256), r = rng(8);
    x.fillStyle = base; x.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
      const v = (i + j) % 2;
      for (let k = 0; k < 64; k += 4) {
        x.fillStyle = `rgba(${v ? '255,255,255' : '0,0,0'},${0.04 + r() * 0.05})`;
        if (v) x.fillRect(i * 64 + k, j * 64, 2, 64); else x.fillRect(i * 64, j * 64 + k, 64, 2);
      }
    }
    return c;
  },
  brick(base, mortar, seed = 2) {
    const [c, x] = canvas(256, 256), r = rng(seed);
    x.fillStyle = mortar; x.fillRect(0, 0, 256, 256);
    for (let row = 0; row < 16; row++) for (let k = -1; k < 5; k++) {
      const bx = k * 64 + (row % 2) * 32, by = row * 16;
      const v = (r() - 0.5) * 26;
      const col = new THREE.Color(base); col.offsetHSL(0, 0, v / 255);
      x.fillStyle = '#' + col.getHexString(); x.fillRect(bx + 2, by + 2, 60, 12);
      x.fillStyle = `rgba(0,0,0,${r() * 0.08})`; x.fillRect(bx + 2 + r() * 40, by + 3, 18, 9);
    }
    return c;
  },
  // Stacked ledger stone: long thin stones in browns and grays
  ledger(seed = 7, tones = ['#8b7d6b', '#6f6457', '#a39380', '#5e544a', '#9a8a72', '#7b6e60']) {
    const [c, x] = canvas(256, 256), r = rng(seed);
    x.fillStyle = '#3e3832'; x.fillRect(0, 0, 256, 256);
    let y = 0;
    while (y < 256) {
      const h = 8 + r() * 14;
      let px = -r() * 60;
      while (px < 256) {
        const w = 30 + r() * 70;
        x.fillStyle = tones[Math.floor(r() * tones.length)];
        x.fillRect(px + 1, y + 1, w - 2, h - 2);
        x.fillStyle = 'rgba(255,255,255,0.08)'; x.fillRect(px + 1, y + 1, w - 2, 2);
        px += w;
      }
      y += h;
    }
    return c;
  },
  // A run of book spines on shelves: tile = one shelf unit (cols x shelves)
  books(shelves = 6, frame = '#3a2a1e', back = '#2a1f17', seed = 11) {
    const [c, x] = canvas(256, 384), r = rng(seed);
    x.fillStyle = frame; x.fillRect(0, 0, 256, 384);
    const sh = 384 / shelves;
    const COLORS = ['#7a1f2b', '#1f3a6e', '#2f5d3f', '#c9a227', '#e8e2d0', '#5a3a28', '#2b2b2b', '#8a5a3a', '#3d6e8f', '#a8402a', '#d8c9a0', '#4a3a6a'];
    for (let s = 0; s < shelves; s++) {
      const y0 = s * sh + 6, y1 = (s + 1) * sh - 4;
      x.fillStyle = back; x.fillRect(8, y0, 240, y1 - y0);
      let px = 10;
      while (px < 244) {
        const w = 6 + r() * 12, h = (y1 - y0) * (0.62 + r() * 0.36);
        if (r() < 0.06) { px += 10; continue; }
        x.fillStyle = COLORS[Math.floor(r() * COLORS.length)];
        x.fillRect(px, y1 - h, Math.min(w, 246 - px), h);
        x.fillStyle = 'rgba(255,255,255,0.18)'; x.fillRect(px + 1, y1 - h + 4, Math.min(w, 246 - px) - 2, 2);
        x.fillStyle = 'rgba(0,0,0,0.25)'; x.fillRect(px + w - 1, y1 - h, 1, h);
        px += w + 0.5;
      }
      x.fillStyle = frame; x.fillRect(0, y1, 256, 5);
    }
    x.fillStyle = frame; x.fillRect(0, 0, 8, 384); x.fillRect(248, 0, 8, 384);
    return c;
  },
  text(lines, { w = 512, h = 128, bg = null, color = '#fff', font = 'bold 72px Georgia, serif', stroke = null } = {}) {
    const [c, x] = canvas(w, h);
    if (bg) { x.fillStyle = bg; x.fillRect(0, 0, w, h); }
    x.textAlign = 'center'; x.textBaseline = 'middle';
    const L = Array.isArray(lines) ? lines : [lines];
    L.forEach((ln, i) => {
      const f = typeof ln === 'object' ? ln : { t: ln };
      x.font = f.font || font;
      const yy = h * (i + 0.5) / L.length + (f.dy || 0);
      if (f.stroke || stroke) { x.lineWidth = 8; x.strokeStyle = f.stroke || stroke; x.strokeText(f.t, w / 2, yy, w - 16); }
      x.fillStyle = f.color || color; x.fillText(f.t, w / 2, yy, w - 16);
    });
    return c;
  },
  flag() {
    const [c, x] = canvas(190, 100);
    for (let i = 0; i < 13; i++) { x.fillStyle = i % 2 ? '#f4f1ea' : '#b22234'; x.fillRect(0, i * 100 / 13, 190, 100 / 13 + 0.5); }
    x.fillStyle = '#3c3b6e'; x.fillRect(0, 0, 76, 54);
    x.fillStyle = '#fff';
    for (let i = 0; i < 9; i++) for (let j = 0; j < (i % 2 ? 5 : 6); j++) x.fillRect(5 + j * 12 + (i % 2) * 6, 4 + i * 5.5, 2.4, 2.4);
    return c;
  },
};

// ---------- the building kit ----------

const BOX = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0); // origin at the bottom
const INST_E = new THREE.Euler(0, 0, 0, 'YXZ');

class Kit {
  constructor(scene) {
    this.scene = scene;
    this.solids = []; // [x0, z0, x1, z1] footprints the player can't walk through
    this.people = [];
    this.anim = [];
    this.batches = new Map(); // instanced copies, drawn at flush()
  }
  // Many copies of one shape and color, drawn as one instanced mesh when the room is done.
  // (x, y, z) is the center; ry turns it about y, then rz/rx tilt it ('YXZ': rz tilts local x up)
  inst(geo, color, x, y, z, sx, sy, sz, { ry = 0, rz = 0, rx = 0, basic = false, double = false } = {}) {
    const key = geo.uuid + '|' + color + '|' + basic + '|' + double;
    let s = this.batches.get(key);
    if (!s) {
      const opts = double ? { side: THREE.DoubleSide } : {};
      this.batches.set(key, (s = { geo, material: basic ? new THREE.MeshBasicMaterial({ color, ...opts }) : mat(color, opts), list: [] }));
    }
    INST_E.set(rx, ry, rz);
    s.list.push(new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(INST_E), new THREE.Vector3(sx, sy, sz)));
  }
  // A beam between two points (instanced box of thickness t x d)
  member(color, a, b, t, d = t) {
    const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2], h = Math.hypot(dx, dz);
    this.inst(GEOM.box, color, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2, Math.hypot(h, dy), t, d, { ry: Math.atan2(-dz, dx), rz: Math.atan2(dy, h) });
  }
  flush() {
    for (const { geo, material, list } of this.batches.values()) {
      const m = new THREE.InstancedMesh(geo, material, list.length);
      list.forEach((mm, i) => m.setMatrixAt(i, mm));
      this.scene.add(m);
    }
    this.batches.clear();
  }
  m(color, opts) { return typeof color === 'object' && color.isMaterial ? color : mat(color, opts); }
  // A box standing on y (bottom), centered on x/z; rot turns it about y
  box(color, x, y, z, w, h, d, { rot = 0, solid = false, emissive } = {}) {
    const material = emissive ? new THREE.MeshLambertMaterial({ color, emissive, emissiveIntensity: 1 }) : this.m(color);
    const b = new THREE.Mesh(BOX, material);
    b.scale.set(w, h, d); b.position.set(x, y, z); b.rotation.y = rot;
    this.scene.add(b);
    if (solid) {
      const c = Math.abs(Math.cos(rot)), s = Math.abs(Math.sin(rot));
      const hw = (w * c + d * s) / 2, hd = (w * s + d * c) / 2;
      this.solids.push([x - hw, z - hd, x + hw, z + hd]);
    }
    return b;
  }
  solid(x0, z0, x1, z1) { this.solids.push([Math.min(x0, x1), Math.min(z0, z1), Math.max(x0, x1), Math.max(z0, z1)]); }
  cyl(color, x, y, z, r, h, seg = 12) {
    const c = new THREE.Mesh(GEOM.cyl, this.m(color));
    c.scale.set(r * 2, h, r * 2); c.position.set(x, y + h / 2, z);
    this.scene.add(c);
    return c;
  }
  ball(color, x, y, z, r, emissive) {
    const s = new THREE.Mesh(GEOM.sphere, emissive ? new THREE.MeshBasicMaterial({ color }) : this.m(color));
    s.scale.setScalar(r * 2); s.position.set(x, y, z);
    this.scene.add(s);
    return s;
  }
  // A textured vertical panel (two-sided); its front, where text reads right, faces -z at
  // rot 0 (back toward the entrance), +z at PI, +x at -PI/2 and -x at PI/2
  panel(material, x, y, z, w, h, rot = 0) {
    const m = material.isMaterial ? material : new THREE.MeshLambertMaterial({ map: material, transparent: true });
    m.side = THREE.DoubleSide;
    const p = new THREE.Mesh(new THREE.PlaneGeometry(w, h), m);
    p.position.set(x, y, z); p.rotation.y = rot + Math.PI;
    this.scene.add(p);
    return p;
  }
  floor(material, x0, z0, x1, z1, y = 0) {
    const f = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0, z1 - z0), material);
    f.rotation.x = -Math.PI / 2; f.position.set((x0 + x1) / 2, y, (z0 + z1) / 2);
    this.scene.add(f);
    return f;
  }
  ceiling(material, x0, z0, x1, z1, y) {
    const f = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0, z1 - z0), material);
    f.rotation.x = Math.PI / 2; f.position.set((x0 + x1) / 2, y, (z0 + z1) / 2);
    this.scene.add(f);
    return f;
  }
  // An axis-aligned wall from (x0,z0) to (x1,z1), with openings [from, to, top] measured
  // along it (top: lintel height, or the full height when omitted)
  wall(color, x0, z0, x1, z1, h, gaps = [], t = 0.2) {
    const alongX = Math.abs(x1 - x0) > Math.abs(z1 - z0);
    const len = alongX ? Math.abs(x1 - x0) : Math.abs(z1 - z0);
    const a0 = alongX ? Math.min(x0, x1) : Math.min(z0, z1);
    const at = (u, w, y, hh) => {
      if (w <= 0.01) return;
      const c = a0 + u + w / 2;
      if (alongX) this.box(color, c, y, z0, w, hh, t, { solid: y < 1 });
      else this.box(color, x0, y, c, t, hh, w, { solid: y < 1 });
    };
    let u = 0;
    for (const [g0, g1, top] of [...gaps].sort((p, q) => p[0] - q[0])) {
      at(u, g0 - u, 0, h);
      if (top != null && top < h) at(g0, g1 - g0, top, h - top);
      u = g1;
    }
    at(u, len - u, 0, h);
  }
  person(x, z, heading, { look, sit = 0, pose } = {}) {
    const p = makePerson(look || randomLook());
    p.position.set(x, sit ? sit - 0.92 + 0.02 : 0, z);
    p.rotation.y = heading;
    animatePerson(p, 0, 0, { sitting: !!sit });
    if (pose) pose(p.userData.parts);
    this.scene.add(p);
    this.people.push(p);
    if (!sit) this.solids.push([x - 0.3, z - 0.3, x + 0.3, z + 0.3]);
    return p;
  }
  // Furniture
  chair(color, x, z, rot, { seat = 0.46, legs = 0x222222, back = true } = {}) {
    this.box(color, x, seat - 0.04, z, 0.44, 0.05, 0.44, { rot });
    for (const [a, b] of [[-0.18, -0.18], [0.18, -0.18], [-0.18, 0.18], [0.18, 0.18]]) {
      const c = Math.cos(rot), s = Math.sin(rot);
      this.box(legs, x + a * c + b * s, 0, z - a * s + b * c, 0.04, seat - 0.04, 0.04);
    }
    if (back) { const c = Math.cos(rot), s = Math.sin(rot); this.box(color, x - 0.2 * s, seat, z - 0.2 * c, 0.44, 0.46, 0.05, { rot }); }
  }
  table(top, x, z, w, d, { h = 0.76, legs = 0x2a2a2a, rot = 0, round = false, solid = true } = {}) {
    if (round) {
      this.cyl(top, x, h - 0.04, z, w / 2, 0.04, 20);
      this.cyl(legs, x, 0, z, 0.04, h - 0.04);
      this.cyl(legs, x, 0, z, 0.25, 0.03);
    } else {
      this.box(top, x, h - 0.05, z, w, 0.05, d, { rot });
      const c = Math.cos(rot), s = Math.sin(rot);
      for (const [a, b] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        const lx = a * (w / 2 - 0.08), lz = b * (d / 2 - 0.08);
        this.box(legs, x + lx * c + lz * s, 0, z - lx * s + lz * c, 0.06, h - 0.05, 0.06);
      }
    }
    if (solid) {
      const c = Math.abs(Math.cos(rot)), s = Math.abs(Math.sin(rot));
      const hw = (w * c + d * s) / 2, hd = (w * s + d * c) / 2;
      this.solids.push([x - hw, z - hd, x + hw, z + hd]);
    }
  }
  plant(x, z, s = 1, pot = 0xf0ede6) {
    this.cyl(pot, x, 0, z, 0.22 * s, 0.4 * s);
    const g = mat(0x3f6e35, { flatShading: true });
    for (let k = 0; k < 5; k++) {
      const a = k * 1.3;
      const l = new THREE.Mesh(GEOM.sphere, g);
      l.scale.set(0.42 * s, 0.32 * s, 0.42 * s);
      l.position.set(x + Math.cos(a) * 0.15 * s, (0.6 + k * 0.22) * s, z + Math.sin(a) * 0.15 * s);
      this.scene.add(l);
    }
    this.solids.push([x - 0.25 * s, z - 0.25 * s, x + 0.25 * s, z + 0.25 * s]);
  }
  // A recessed glowing ceiling panel
  lightPanel(x, z, y, w = 1.2, d = 0.6) {
    const p = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshBasicMaterial({ color: 0xfdfcf5 }));
    p.rotation.x = Math.PI / 2; p.position.set(x, y - 0.01, z);
    this.scene.add(p);
  }
  pendant(x, z, y, drop, color = 0x1b1b1b, bulb = 0xffe7b8) {
    this.box(0x222222, x, y - drop, z, 0.015, drop, 0.015);
    const shade = new THREE.Mesh(GEOM.cone8, this.m(color));
    shade.scale.set(0.38, 0.26, 0.38); shade.position.set(x, y - drop - 0.06, z);
    this.scene.add(shade);
    this.ball(bulb, x, y - drop - 0.2, z, 0.07, true);
  }
  // A full-height window: glowing daylight panes in a frame (on a wall along x or z)
  window(x, y, z, w, h, rot = 0, frame = 0x1b1b1b, panes = 2) {
    const glass = new THREE.MeshBasicMaterial({ color: 0xb9d3e2 });
    this.panel(glass, x, y + h / 2, z, w, h, rot);
    const c = Math.cos(rot), s = Math.sin(rot);
    const off = 0.03;
    const px = x + s * -off, pz = z + c * -off;
    // frame
    this.box(frame, px, y - 0.04, pz, w + 0.1, 0.08, 0.08, { rot });
    this.box(frame, px, y + h - 0.04, pz, w + 0.1, 0.08, 0.08, { rot });
    for (let k = 0; k <= panes; k++) {
      const u = -w / 2 + (w * k) / panes;
      this.box(frame, px + u * c, y, pz - u * s, 0.07, h, 0.08, { rot });
    }
  }
}

// ---------- shared pieces ----------

function bookcase(k, x, z, w, h, rot, { frame = '#3a2a1e', back = '#2a1f17', color = 0x3a2a1e, seed = 11, shelves } = {}) {
  const t = tex(T.books(shelves || Math.round(h / 0.36), frame, back, seed), [Math.max(1, Math.round(w / 1.2)), 1]);
  const d = 0.4;
  k.box(color, x, 0, z, w, h, d, { rot, solid: true });
  const c = Math.cos(rot), s = Math.sin(rot);
  // books on the front face (local -z when rot = 0 faces the entrance... front is local +z rotated)
  const p = k.panel(new THREE.MeshLambertMaterial({ map: t }), x + s * (d / 2 + 0.01), h / 2, z + c * (d / 2 + 0.01), w, h, rot + Math.PI);
  return p;
}

function sconce(k, x, y, z, rot) {
  const c = Math.cos(rot), s = Math.sin(rot);
  k.box(0x1b1b1b, x, y, z, 0.12, 0.22, 0.05, { rot });
  k.ball(0xffe2a8, x + s * 0.14, y + 0.1, z + c * 0.14, 0.08, true);
  const cage = new THREE.Mesh(GEOM.cyl, new THREE.MeshLambertMaterial({ color: 0x1b1b1b, wireframe: true }));
  cage.scale.set(0.2, 0.26, 0.2); cage.position.set(x + s * 0.14, y + 0.1, z + c * 0.14); k.scene.add(cage);
}

function sofa(k, color, x, z, rot, w = 2.0) {
  const c = Math.cos(rot), s = Math.sin(rot);
  k.box(color, x, 0.12, z, w, 0.32, 0.9, { rot, solid: true });
  k.box(color, x - s * 0.38, 0.12, z - c * 0.38, w, 0.75, 0.2, { rot });
  for (const e of [-1, 1]) k.box(color, x + c * e * (w / 2 - 0.1), 0.12, z - s * e * (w / 2 - 0.1), 0.2, 0.55, 0.9, { rot });
  k.box(0x2a2a2a, x, 0, z, w - 0.1, 0.12, 0.8, { rot });
}

// ---------- the Mustang Grill ----------

// From photos of the dining hall: one long room under a black gable ceiling, carried on
// tan-painted trusses (W webs, bolted plates at the joints) running both ways, skylights
// along the ridge, rows of white prismatic-glass pendants; navy-gray carpet tiles with beige
// tile round the serving areas; white-topped tables on black T-legs with bentwood chairs; on
// the left a curved honey-wood serving counter with its pastry case under a curved white
// soffit hung with little amber pendants, queue stanchions in front; the open kitchen at the
// back (a stainless hood, a round cherry station, the hot line behind glass); the salad island
// under another curved soffit on the right; and along the deck side, floor-to-ceiling French
// doors between stacked-stone piers with a stone fireplace. Through the open doors: the deck
// under its timber roof, with patio heaters, slatted tables and the trees over Placerita.
// G0 is where the room starts along z. Returns its rooms, portals and spots.
const DOME = new THREE.SphereGeometry(0.5, 14, 5, 0, Math.PI * 2, 0, Math.PI / 2);
const SHELL = new THREE.CylinderGeometry(0.22, 0.22, 0.26, 10, 1, true, Math.PI - 1.05, 2.1);
const ROCK = new THREE.IcosahedronGeometry(1, 0);

const stoneMats = new Map();
function stone(k, x, y, z, w, h, d, seed = 7) {
  const key = [w, h, d, seed].map((v) => v.toFixed(1)).join('|');
  if (!stoneMats.has(key)) stoneMats.set(key, new THREE.MeshLambertMaterial({ map: tex(T.ledger(seed, ['#8d7b66', '#6f6254', '#a69178', '#5d544b', '#9a8670', '#7d6e60', '#b39c80', '#6a6a66']), [Math.max(w, d) / 1.3, h / 1.3]) }));
  return k.box(stoneMats.get(key), x, y, z, w, h, d, { solid: y < 1 });
}

// A curved counter: an arc of radius r about (cx, cz) from angle a0 to a1 (x = cx + r cos a,
// z = cz + r sin a), its front facing out
function curvedCounter(k, cx, cz, r, a0, a1, { front = 0xc9813f, band = 0xe8b678, top = 0xc4c7ca, depth = 0.8, guard = true, soffit = 0, lamps = 0 } = {}) {
  const t0 = Math.PI / 2 - a1, tl = a1 - a0; // three's cylinder angle runs from +z toward +x
  const add = (geo, m, y) => { const o = new THREE.Mesh(geo, m); o.position.set(cx, y, cz); k.scene.add(o); return o; };
  add(new THREE.CylinderGeometry(r, r, 0.74, 32, 1, true, t0, tl), mat(front, { side: THREE.DoubleSide }), 0.37);
  add(new THREE.CylinderGeometry(r + 0.01, r + 0.01, 0.18, 32, 1, true, t0, tl), mat(band, { side: THREE.DoubleSide }), 0.83);
  add(new THREE.CylinderGeometry(r - 0.04, r - 0.04, 0.1, 32, 1, true, t0, tl), mat(0x2a2420, { side: THREE.DoubleSide }), 0.05);
  add(new THREE.CylinderGeometry(r + 0.06, r + 0.06, 0.05, 32, 1, false, t0, tl), mat(top), 0.945);
  const hole = add(new THREE.CylinderGeometry(r - depth, r - depth, 0.06, 32, 1, false, t0, tl), mat(0x6a6460), 0.95);
  hole.scale.y = 1.05;
  if (guard) {
    add(new THREE.CylinderGeometry(r - 0.25, r - 0.25, 0.42, 32, 1, true, t0, tl), new THREE.MeshLambertMaterial({ color: 0xd6ecf2, transparent: true, opacity: 0.3, side: THREE.DoubleSide, depthWrite: false }), 1.27);
    add(new THREE.CylinderGeometry(r - 0.2, r - 0.2, 0.03, 32, 1, false, t0, tl), mat(0xc4c7ca), 1.5);
  }
  if (soffit) {
    add(new THREE.CylinderGeometry(soffit, soffit, 0.55, 40, 1, false, t0 - 0.15, tl + 0.3), mat(0xf7f6f2), 3.75);
    for (let a = a0 + 0.08; a < a1; a += 0.19) {
      const x = cx + Math.cos(a) * (r - 0.35), z = cz + Math.sin(a) * (r - 0.35);
      k.inst(GEOM.box, 0x1b1b1b, x, 3.05, z, 0.012, 0.9, 0.012);
      k.inst(GEOM.cyl, lamps || 0xf0b866, x, 2.5, z, 0.13, 0.22, 0.13, { basic: true });
    }
  }
  // what you bump into: little boxes along the arc
  for (let a = a0; a <= a1 + 1e-6; a += 0.16) {
    const x = cx + Math.cos(a) * (r - depth / 2), z = cz + Math.sin(a) * (r - depth / 2);
    k.solid(x - 0.45, z - 0.45, x + 0.45, z + 0.45);
  }
}

// White table on black T-legs with bentwood chairs, `seats` per side (x along the table)
function grillTable(k, x, z, r, seats = 2, people = 0.3) {
  k.inst(GEOM.box, 0xeeebe3, x, 0.74, z, 1.8, 0.04, 0.76);
  k.inst(GEOM.box, 0xb9b4aa, x, 0.715, z, 1.82, 0.012, 0.78);
  for (const dx of [-0.6, 0.6]) {
    k.inst(GEOM.cyl, 0x161616, x + dx, 0.36, z, 0.07, 0.72, 0.07);
    k.inst(GEOM.box, 0x161616, x + dx, 0.02, z, 0.06, 0.04, 0.62);
    k.inst(GEOM.box, 0x161616, x + dx, 0.7, z, 0.06, 0.03, 0.5);
  }
  k.solid(x - 0.9, z - 0.38, x + 0.9, z + 0.38);
  const offs = seats === 3 ? [-0.6, 0, 0.6] : [-0.45, 0.45];
  for (const side of [-1, 1]) for (const dx of offs) {
    const cxp = x + dx, czp = z + side * 0.72, face = side > 0 ? Math.PI : 0;
    bentwood(k, cxp, czp, face);
    if (r() < people) k.person(cxp, czp - side * 0.05, face, { sit: 0.47 });
  }
  if (r() < 0.55) { const dx = (r() - 0.5) * 1.0; k.inst(GEOM.box, 0x7a2a2a, x + dx, 0.77, z - 0.15, 0.42, 0.02, 0.32); k.inst(GEOM.cyl, 0xf4f1ea, x + dx, 0.79, z - 0.15, 0.26, 0.02, 0.26); }
}

// The round-backed bentwood chair: a wood seat and curved back on black legs, facing `face`
function bentwood(k, x, z, face) {
  const s = Math.sin(face), c = Math.cos(face);
  const wood = 0x8a4b26;
  k.inst(GEOM.cyl, wood, x, 0.46, z, 0.44, 0.045, 0.42);
  k.inst(SHELL, wood, x, 0.75, z, 1, 1, 1, { ry: face, double: true });
  for (const [a, b] of [[-0.17, -0.15], [0.17, -0.15], [-0.15, 0.16], [0.15, 0.16]]) k.inst(GEOM.cyl, 0x1b1b1b, x + a * c + b * s, 0.22, z - a * s + b * c, 0.025, 0.44, 0.025);
  for (const a of [-0.13, 0.13]) k.inst(GEOM.box, 0x1b1b1b, x + a * c - 0.19 * s, 0.56, z - a * s - 0.19 * c, 0.02, 0.2, 0.02);
}

// Slatted wood deck table with ladder-back chairs, and a patio heater
function deckTable(k, x, z, rot, r, round = false) {
  const wood = 0x5c3b25, c = Math.cos(rot), s = Math.sin(rot);
  if (round) k.inst(GEOM.cyl, wood, x, 0.74, z, 1.1, 0.05, 1.1);
  else {
    k.inst(GEOM.box, wood, x, 0.74, z, 1.6, 0.05, 0.9, { ry: rot });
    for (let i = 1; i < 6; i++) { const u = -0.8 + i * 0.267; k.inst(GEOM.box, 0x3a2618, x + u * c, 0.766, z - u * s, 0.02, 0.01, 0.88, { ry: rot }); }
  }
  k.inst(GEOM.box, 0x2a2420, x, 0.36, z, 0.08, 0.72, 0.08);
  k.inst(GEOM.box, 0x2a2420, x, 0.02, z, 0.7, 0.04, 0.6, { ry: rot });
  k.solid(x - 0.75, z - 0.75, x + 0.75, z + 0.75);
  const spots = round ? [0, 1, 2, 3].map((i) => [Math.cos(i * 1.57 + 0.5) * 0.95, Math.sin(i * 1.57 + 0.5) * 0.95]) : [[-0.42, -0.8], [0.42, -0.8], [-0.42, 0.8], [0.42, 0.8]];
  for (const [u, v] of spots) {
    const px = x + u * c + v * s, pz = z - u * s + v * c;
    const face = Math.atan2(x - px, z - pz);
    ladderChair(k, px, pz, face);
    if (r() < 0.3) k.person(px, pz, face, { sit: 0.47 });
  }
}
function ladderChair(k, x, z, face) {
  const s = Math.sin(face), c = Math.cos(face), wood = 0x4e3322;
  const at = (f, sd) => [x + s * f + c * sd, z + c * f - s * sd]; // f: forward, sd: sideways
  k.inst(GEOM.box, wood, x, 0.45, z, 0.44, 0.05, 0.42, { ry: face });
  for (const sd of [-0.19, 0.19]) {
    const [fx, fz] = at(0.18, sd); k.inst(GEOM.box, wood, fx, 0.22, fz, 0.045, 0.44, 0.045, { ry: face });
    const [bx, bz] = at(-0.19, sd); k.inst(GEOM.box, wood, bx, 0.49, bz, 0.05, 0.98, 0.05, { ry: face });
  }
  { const [bx, bz] = at(-0.19, 0); k.inst(GEOM.box, wood, bx, 0.93, bz, 0.42, 0.08, 0.04, { ry: face }); }
  for (const sd of [-0.11, -0.037, 0.037, 0.11]) { const [bx, bz] = at(-0.19, sd); k.inst(GEOM.box, wood, bx, 0.69, bz, 0.035, 0.42, 0.02, { ry: face }); }
}
function heater(k, x, z) {
  k.inst(GEOM.cyl, 0xb9bcbf, x, 0.35, z, 0.5, 0.7, 0.5);
  k.inst(GEOM.cyl, 0xb9bcbf, x, 1.3, z, 0.11, 1.3, 0.11);
  k.inst(GEOM.cyl, 0x2a2a2a, x, 2.05, z, 0.3, 0.32, 0.3);
  k.inst(GEOM.cyl, 0xff8a3a, x, 1.95, z, 0.24, 0.08, 0.24, { basic: true });
  k.inst(GEOM.cone8, 0x9a9da0, x, 2.35, z, 1.15, 0.28, 1.15);
  k.solid(x - 0.3, z - 0.3, x + 0.3, z + 0.3);
}

// A deck railing from (x0, z0) to (x1, z1): brown posts and top rail, black pickets
function deckRail(k, x0, z0, x1, z1) {
  const len = Math.hypot(x1 - x0, z1 - z0), ux = (x1 - x0) / len, uz = (z1 - z0) / len, ry = Math.atan2(-uz, ux);
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  k.inst(GEOM.box, 0x4a3426, cx, 1.07, cz, len, 0.07, 0.16, { ry });
  k.inst(GEOM.box, 0x1e1e1e, cx, 0.95, cz, len, 0.05, 0.05, { ry });
  k.inst(GEOM.box, 0x1e1e1e, cx, 0.13, cz, len, 0.05, 0.05, { ry });
  const n = Math.max(1, Math.round(len / 1.9));
  for (let i = 0; i <= n; i++) k.inst(GEOM.box, 0x4a3426, x0 + (x1 - x0) * i / n, 0.55, z0 + (z1 - z0) * i / n, 0.13, 1.1, 0.13, { ry });
  for (let d = 0.1; d < len; d += 0.12) k.inst(GEOM.box, 0x1e1e1e, x0 + ux * d, 0.54, z0 + uz * d, 0.022, 0.82, 0.022);
  k.solid(Math.min(x0, x1) - 0.08, Math.min(z0, z1) - 0.08, Math.max(x0, x1) + 0.08, Math.max(z0, z1) + 0.08);
}

// What you see from the deck: sky over the golden Placerita hills, oaks and pines below the
// rail, the road, the power line along it
function deckView(k, x0, zA, zB, floorY) {
  const [c, x] = canvas(1024, 512);
  const g = x.createLinearGradient(0, 0, 0, 512);
  g.addColorStop(0, '#7fa9d6'); g.addColorStop(0.52, '#cfe0ec'); g.addColorStop(0.6, '#e3ebe9'); g.addColorStop(1, '#9aa77a');
  x.fillStyle = g; x.fillRect(0, 0, 1024, 512);
  const r = rng(31);
  for (const [base, col, amp] of [[300, '#b9a678', 40], [318, '#a49466', 26], [330, '#7f8a5a', 14]]) {
    x.fillStyle = col; x.beginPath(); x.moveTo(0, 512);
    for (let i = 0; i <= 1024; i += 16) x.lineTo(i, base - amp * (0.5 + 0.5 * Math.sin(i * 0.006 + base)) - r() * amp * 0.3);
    x.lineTo(1024, 512); x.fill();
  }
  const sky = tex(c);
  const span = zB - zA;
  // three walls of view round the deck: out past the rail and both ends
  const H = 60, yC = floorY + 6;
  k.panel(new THREE.MeshBasicMaterial({ map: sky }), x0, yC, (zA + zB) / 2, span, H, Math.PI / 2);
  for (const [z, rot] of [[zA, 0], [zB, Math.PI]]) k.panel(new THREE.MeshBasicMaterial({ map: sky }), (x0 - 14) / 2, yC, z, -x0 - 14 + 30, H, rot);
  // the ground falling away below the deck
  const gr = new THREE.Mesh(new THREE.PlaneGeometry(-x0, span), new THREE.MeshLambertMaterial({ map: tex(T.mottled('#7d8f4e', 0.1), [8, 8]) }));
  gr.rotation.x = -Math.PI / 2; gr.position.set(x0 / 2, floorY - 4.6, (zA + zB) / 2); k.scene.add(gr);
  // Placerita Canyon Rd and the power line along it
  const roadX = -42;
  k.inst(GEOM.box, 0x3a3a3e, roadX, floorY - 4.58, (zA + zB) / 2, 9, 0.02, span);
  k.inst(GEOM.box, 0xe2c23a, roadX, floorY - 4.56, (zA + zB) / 2, 0.25, 0.02, span);
  for (let z = zA + 6; z < zB; z += 22) {
    k.inst(GEOM.cyl, 0x5a4434, roadX + 6, floorY + 2.4, z, 0.32, 14, 0.32);
    k.inst(GEOM.box, 0x5a4434, roadX + 6, floorY + 8.6, z, 0.16, 0.16, 2.4);
  }
  for (const dz of [-1.0, 0, 1.0]) k.inst(GEOM.box, 0x1a1a1a, roadX + 6 + dz, floorY + 8.75, (zA + zB) / 2, 0.025, 0.025, span);
  // oaks and pines
  const oak = [0x4f6b33, 0x5d7a3a, 0x3f5a2c, 0x6b7f40];
  for (let i = 0; i < 46; i++) {
    const tx = -24 - r() * 34, tz = zA + 2 + r() * (span - 4);
    if (Math.abs(tx - roadX) < 6) continue;
    const near = tx > -32;
    const h = (near ? 5.5 : 6.5) + r() * 3, cr = 2 + r() * 2.2;
    const base = floorY - 4.6;
    k.inst(GEOM.cyl, 0x4a3628, tx, base + h / 2, tz, 0.4, h, 0.4);
    if (r() < 0.18) k.inst(GEOM.cone8, 0x2f4a2c, tx, base + h + 1.5, tz, cr * 1.4, h * 0.9, cr * 1.4);
    else k.inst(ROCK, oak[i % 4], tx, base + h + cr * 0.4, tz, cr * 1.25, cr * 0.85, cr * 1.15, { ry: r() * 6 });
  }
  // a neighbor's roof through the trees
  k.inst(GEOM.box, 0x6e6a64, -37, floorY - 1.6, zA + span * 0.35, 8, 0.4, 10);
}

// Built mirrored (x -> -x), so that coming up the stairs the serving counter, the French
// doors and the deck are on your left and the salad island on your right, as in the photos.
// Text is flipped back so it still reads.
function mustangGrill(k, G0) {
  k.flush();
  const scene0 = k.scene, solids0 = k.solids.length;
  const group = new THREE.Group();
  group.scale.x = -1;
  scene0.add(group);
  k.scene = group;
  const out = mustangGrillRoom(k, G0);
  k.flush();
  k.scene = scene0;
  for (let i = solids0; i < k.solids.length; i++) { const [x0, z0, x1, z1] = k.solids[i]; k.solids[i] = [-x1, z0, -x0, z1]; }
  return {
    rooms: out.rooms.map(([x0, z0, x1, z1, h]) => [-x1, z0, -x0, z1, h]),
    arrive: [-out.arrive[0], out.arrive[1], -out.arrive[2]],
    portal: { ...out.portal, x: -out.portal.x },
    spots: out.spots.map((q) => ({ ...q, x: -q.x })),
  };
}

function mustangGrillRoom(k, G0) {
  const XL = -14, XR = 14, D = 22, HW = 4.6, HR = 7.0;
  const Z = (z) => G0 + z;
  const white = 0xf2f0ea, truss = 0xd2b680, plate = 0xb89c66;
  const r = rng(17);
  const ceilAt = (x) => HR - (Math.abs(x) / XR) * (HR - HW);

  // ---- floor: navy-gray carpet tiles, beige tile round the serving areas ----
  k.floor(new THREE.MeshLambertMaterial({ map: tex(T.carpetTiles('#3b4352'), [9, 7]) }), XL, G0, XR, Z(D));
  const tile = new THREE.MeshLambertMaterial({ map: tex(T.tiles('#ddd3c1', '#c6bcab', 4, 0.04), [1, 1]) });
  const tileArea = (x0, z0, x1, z1) => { const m = tile.clone(); m.map = tile.map.clone(); m.map.repeat.set((x1 - x0) / 2.4, (z1 - z0) / 2.4); m.map.needsUpdate = true; k.floor(m, x0, z0, x1, z1, 0.006); };
  tileArea(XL, G0, -8.4, Z(9.6));
  tileArea(XL, Z(16.2), XR, Z(D));
  tileArea(9.4, G0, XR, Z(16.2));
  // yellow "+" spacing markers along the queue and by the tables
  for (const [x, z] of [[-8.7, Z(2.2)], [-8.7, Z(4.4)], [-8.7, Z(6.6)], [-10.4, Z(8.4)], [6.0, Z(1.4)], [9.8, Z(14.8)]]) {
    k.inst(GEOM.box, 0xf2c200, x, 0.012, z, 0.34, 0.01, 0.07);
    k.inst(GEOM.box, 0xf2c200, x, 0.013, z, 0.07, 0.01, 0.34);
  }

  // ---- walls ----
  const SIDE = [[1.0, 4.1, 'win'], [5.0, 8.1, 'win'], [9.0, 11.2, 'door'], [16.6, 19.6, 'win']];
  const PIERS = [[4.1, 5.0], [8.1, 9.0], [11.2, 12.2], [15.6, 16.6], [19.6, 20.5]];
  k.wall(white, XL, G0, XL, Z(D), HW, SIDE.map(([a, b]) => [a, b, 3.5]));
  k.wall(0xd2bd98, XL - 0.16, G0, XL - 0.16, Z(D), HW, SIDE.map(([a, b]) => [a, b, 3.5]), 0.1); // tan stucco outside
  for (const [a, b, kind] of SIDE) {
    if (kind === 'door') {
      // the open French doors to the deck, leaves swung back against the wall
      for (const [z, s] of [[Z(a) + 0.08, 1], [Z(b) - 0.08, -1]]) { k.box(0x3a2a1e, XL - 0.55, 0, z, 1.05, 2.9, 0.06, { rot: 0 }); k.panel(new THREE.MeshBasicMaterial({ color: 0xb9d3e2 }), XL - 0.55, 1.45, z + s * 0.035, 0.85, 2.6, s > 0 ? Math.PI : 0); }
      k.box(0x3a2a1e, XL, 3.4, (Z(a) + Z(b)) / 2, 0.24, 0.12, b - a);
      k.window(XL + 0.12, 2.95, (Z(a) + Z(b)) / 2, b - a, 0.5, Math.PI / 2, 0x3a2a1e, 2);
    } else k.window(XL + 0.12, 0.02, (Z(a) + Z(b)) / 2, b - a, 3.4, Math.PI / 2, 0x3a2a1e, 4);
  }
  for (const [a, b] of PIERS) {
    stone(k, XL + 0.2, 0, (Z(a) + Z(b)) / 2, 0.5, HW, b - a, Math.round(a));
    stone(k, XL - 0.45, -4.6, (Z(a) + Z(b)) / 2, 0.55, HW + 4.6, b - a, Math.round(b));
  }
  // the stacked-stone fireplace, up to the trusses, a dark firebox with a fire in it
  {
    const zc = Z(13.9), w = 3.4;
    stone(k, XL + 0.45, 0, zc, 0.9, HW, w, 3);
    stone(k, XL + 0.95, 0, zc, 0.7, 0.42, w + 0.3, 5); // raised hearth
    k.panel(new THREE.MeshBasicMaterial({ color: 0x0d0b0a }), XL + 0.91, 0.95, zc, 1.4, 1.0, -Math.PI / 2);
    k.box(0x3a2a1e, XL + 0.97, 1.7, zc, 0.2, 0.22, 2.2); // mantel
    const fire = [];
    for (const [dz, h, col] of [[-0.3, 0.45, 0xff9a3a], [0.05, 0.6, 0xffc24a], [0.35, 0.4, 0xff7a2a]]) {
      const f = k.box(new THREE.MeshBasicMaterial({ color: col }), XL + 0.7, 0.5, zc + dz, 0.25, h, 0.22);
      fire.push([f, h]);
    }
    k.box(0x3a2418, XL + 0.7, 0.45, zc, 0.3, 0.1, 1.0);
    k.anim.push((dt, t) => { for (const [f, h] of fire) f.scale.y = h * (0.75 + 0.25 * Math.sin(t * 9 + h * 20) + 0.1 * Math.sin(t * 23 + h * 7)); });
    for (const dz of [-1.1, 1.1]) {
      // leather club chairs facing the fire
      const x = XL + 2.6, z = zc + dz;
      k.box(0x5a3020, x, 0.1, z, 0.85, 0.35, 0.85, { solid: true });
      k.box(0x5a3020, x + 0.36, 0.1, z, 0.15, 0.85, 0.85);
      for (const s of [-1, 1]) k.box(0x5a3020, x, 0.1, z + s * 0.38, 0.85, 0.6, 0.12);
    }
    k.person(XL + 2.5, zc - 1.1, -Math.PI / 2, { sit: 0.47, pose: (p) => { p.armL.rotation.x = -0.9; p.armR.rotation.x = -0.9; } });
  }
  k.wall(white, XR, G0, XR, Z(D), HW, [[18.4, 20.6, 1.6]]); // right, with the dish return window
  k.wall(white, XL, G0, XR, G0, HW, [[10.4, 12.4, 2.6]]); // front, the stairs down
  k.wall(white, XL, Z(D), XR, Z(D), HW);
  const gable = new THREE.ShapeGeometry(new THREE.Shape([new THREE.Vector2(XL, HW), new THREE.Vector2(XR, HW), new THREE.Vector2(0, HR)]));
  for (const z of [G0 + 0.1, Z(D) - 0.1]) { const m = new THREE.Mesh(gable, mat(white, { side: THREE.DoubleSide })); m.position.z = z; k.scene.add(m); }

  // ---- the black gable ceiling, skylights along the ridge ----
  const slope = Math.atan2(HR - HW, XR), sl = Math.hypot(XR, HR - HW);
  for (const s of [-1, 1]) {
    const c = new THREE.Mesh(new THREE.PlaneGeometry(sl, D), mat(0x232428, { side: THREE.DoubleSide }));
    c.rotation.set(Math.PI / 2, 0, -s * slope, 'ZXY');
    c.position.set(s * XR / 2, (HW + HR) / 2, Z(D / 2));
    k.scene.add(c);
    for (const zc of [Z(4.25), Z(8.75), Z(13.25), Z(17.75)]) {
      const p = new THREE.Mesh(new THREE.PlaneGeometry(1.7, 2.4), new THREE.MeshBasicMaterial({ color: 0xf3f7fa, side: THREE.DoubleSide }));
      p.rotation.set(Math.PI / 2, 0, -s * slope, 'ZXY');
      p.position.set(s * 2.0, ceilAt(2.0) - 0.03, zc);
      k.scene.add(p);
    }
  }
  // ---- tan trusses: across the room every 4.5 m, and two long ones down it ----
  const yB = 4.25;
  for (const z of [Z(2), Z(6.5), Z(11), Z(15.5), Z(20)]) {
    k.member(truss, [XL + 0.1, yB, z], [XR - 0.1, yB, z], 0.22, 0.2);
    for (const s of [-1, 1]) k.member(truss, [s * (XR - 0.1), ceilAt(XR) - 0.15, z], [0, HR - 0.15, z], 0.22, 0.2);
    const nodes = [-14, -10.5, -7, -3.5, 0, 3.5, 7, 10.5, 14];
    for (let i = 0; i < nodes.length - 1; i++) {
      const xa = nodes[i], xb = nodes[i + 1];
      const up = Math.abs(xa) > Math.abs(xb) ? xb : xa, down = up === xa ? xb : xa;
      k.member(truss, [down, yB, z], [up, ceilAt(up) - 0.18, z], 0.16, 0.16); // diagonal
      if (Math.abs(up) < 14) k.member(truss, [up, yB, z], [up, ceilAt(up) - 0.18, z], 0.14, 0.14); // vertical
      k.inst(GEOM.box, plate, xa, yB, z, 0.46, 0.34, 0.24);
    }
  }
  for (const x of [-5.25, 5.25]) {
    const yT = ceilAt(x) - 0.2;
    k.member(truss, [x, yB, G0 + 0.1], [x, yB, Z(D) - 0.1], 0.2, 0.2);
    k.member(truss, [x, yT, G0 + 0.1], [x, yT, Z(D) - 0.1], 0.2, 0.2);
    for (let z = 0; z < D - 0.1; z += 2.25) k.member(truss, [x, yB, Z(z)], [x, yT, Z(Math.min(D, z + 2.25))], 0.13, 0.13);
  }
  // ---- white prismatic-glass pendants on long cords ----
  for (const x of [-8.8, -2.6, 2.6, 8.8]) for (const z of [Z(4.25), Z(8.75), Z(13.25), Z(17.75)]) {
    const y = 3.15 + (Math.abs(x) > 5 ? 0.1 : 0.45);
    k.inst(GEOM.box, 0x1b1b1b, x, (y + ceilAt(x)) / 2, z, 0.015, ceilAt(x) - y, 0.015);
    k.inst(GEOM.cyl, 0x2a2a2a, x, y + 0.42, z, 0.16, 0.12, 0.16);
    k.inst(DOME, 0xf2eee3, x, y, z, 0.7, 0.85, 0.7, { basic: true, double: true });
    k.inst(GEOM.sphere, 0xfffbe8, x, y + 0.08, z, 0.18, 0.18, 0.18, { basic: true });
  }

  // ---- the stairs down, at the front ----
  k.box(0x26282c, -2.6, 0, G0 - 0.5, 2.0, 2.6, 0.8);
  k.panel(new THREE.MeshLambertMaterial({ map: tex(T.text('⬇ The Trough · UE · Mail', { w: 512, h: 72, bg: '#1d2b4a', color: '#f1ece0', font: 'bold 34px system-ui, sans-serif' })) }), -2.6, 2.95, G0 + 0.12, 2.4, 0.34, Math.PI).scale.x = -1;

  // ---- the curved serving counter on the left, its pastry case, the queue ----
  curvedCounter(k, XL, Z(5), 4.4, -1.25, 1.08, { soffit: 5.0 });
  {
    const a = -0.95, x = XL + Math.cos(a) * 4.05, z = Z(5) + Math.sin(a) * 4.05;
    k.box(0x1b1b1b, x, 0.95, z, 1.0, 0.06, 0.6, { rot: a });
    k.box(new THREE.MeshLambertMaterial({ color: 0xdcecf2, transparent: true, opacity: 0.4 }), x, 1.01, z, 1.0, 0.55, 0.6, { rot: a });
    for (let i = 0; i < 6; i++) k.ball(0xd9873a, x + (i % 3 - 1) * 0.25, 1.12 + Math.floor(i / 3) * 0.22, z + (Math.floor(i / 3) - 0.5) * 0.12, 0.08, true);
  }
  for (let a = -0.6; a < 1.0; a += 0.32) {
    const x = XL + Math.cos(a) * 3.95, z = Z(5) + Math.sin(a) * 3.95;
    k.inst(GEOM.box, [0xc9372c, 0xe8b923, 0x3f8f4a, 0xd9a066, 0xf1ece0][Math.round(a * 10 + 6) % 5], x, 1.0, z, 0.35, 0.08, 0.45, { ry: -a });
  }
  k.box(0xc4c7ca, XL + 0.45, 0, Z(5), 0.7, 0.92, 7.2); // back counter, urns on it
  for (const z of [Z(2.6), Z(3.4), Z(6.8)]) k.cyl(0xb9bcbf, XL + 0.45, 0.92, z, 0.18, 0.55);
  for (const [z, look] of [[Z(3.6), { skin: 0xc68863, hair: 0x111111, shirt: 0x1b1b1b, pants: 0x1c1c1c }], [Z(6.4), { skin: 0xf1c9a5, hair: 0x7b5230, shirt: 0x1b1b1b, pants: 0x1c1c1c, longHair: true }]]) k.person(XL + 1.6, z, Math.PI / 2, { look });
  // stanchions with black belts marking the queue to the counter
  const posts = [[-8.0, Z(1.3)], [-8.0, Z(3.0)], [-8.0, Z(4.7)], [-8.0, Z(6.4)], [-9.4, Z(6.4)], [-9.4, Z(4.7)], [-9.4, Z(3.0)]];
  for (let i = 0; i < posts.length; i++) {
    const [x, z] = posts[i];
    k.inst(GEOM.cyl, 0x1b1b1b, x, 0.47, z, 0.06, 0.94, 0.06);
    k.inst(GEOM.cyl, 0x1b1b1b, x, 0.015, z, 0.34, 0.03, 0.34);
    k.inst(GEOM.cyl, 0x2b2b2b, x, 0.96, z, 0.09, 0.06, 0.09);
    const nxt = posts[i + 1];
    if (nxt && !(i === 3)) {
      k.member(0x111111, [x, 0.88, z], [nxt[0], 0.88, nxt[1]], 0.05, 0.012);
      k.solid(Math.min(x, nxt[0]) - 0.06, Math.min(z, nxt[1]) - 0.06, Math.max(x, nxt[0]) + 0.06, Math.max(z, nxt[1]) + 0.06);
    }
  }
  k.person(-8.7, Z(5.6), Math.PI * 0.9); k.person(-8.7, Z(3.9), Math.PI * 0.95);

  // ---- the open kitchen at the back ----
  {
    const zl = Z(18.3);
    for (const [x0, x1] of [[-9.0, -3.4], [1.4, 9.0]]) {
      const cx = (x0 + x1) / 2, w = x1 - x0;
      k.box(0x7a3a22, cx, 0, zl, w, 0.92, 0.85, { solid: true });
      k.box(0xc4c7ca, cx, 0.92, zl, w + 0.05, 0.05, 0.9);
      k.box(new THREE.MeshLambertMaterial({ color: 0xd6ecf2, transparent: true, opacity: 0.35 }), cx, 1.05, zl - 0.25, w, 0.45, 0.03);
      k.box(0xc4c7ca, cx, 1.5, zl - 0.05, w, 0.03, 0.5);
      for (let x = x0 + 0.5; x < x1 - 0.2; x += 0.65) k.box([0xc9372c, 0xe8b923, 0x3f8f4a, 0xd9a066, 0xf1ece0, 0x8a4a26][Math.round(x * 3 + 30) % 6], x, 0.97, zl + 0.1, 0.5, 0.07, 0.4);
    }
    // the round cherry station in front of the hood
    const sx = -1.0, sz = Z(17.6);
    const st = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.4, 0.95, 28, 1, true, 0.6, Math.PI * 2 - 1.2), mat(0x7a3a22, { side: THREE.DoubleSide }));
    st.position.set(sx, 0.475, sz); st.rotation.y = Math.PI; k.scene.add(st);
    const stTop = new THREE.Mesh(new THREE.RingGeometry(0.9, 1.5, 28, 1, -Math.PI / 2 + 0.6, Math.PI * 2 - 1.2), mat(0xc4c7ca, { side: THREE.DoubleSide }));
    stTop.rotation.x = Math.PI / 2; stTop.rotation.z = 0; stTop.position.set(sx, 0.96, sz); k.scene.add(stTop);
    k.solid(sx - 1.4, sz - 1.4, sx + 1.4, sz + 0.4);
    k.person(sx, sz + 0.6, Math.PI, { look: { skin: 0x8d5a3b, hair: 0x111111, shirt: 0x1b1b1b, pants: 0x1c1c1c } });
    // the line behind: ranges, the flat-top, the stainless hood over it all
    k.box(0xc4c7ca, 0, 0, Z(21.3), 18, 0.9, 1.0, { solid: true });
    for (let x = -8; x <= 8; x += 2) k.box(x % 4 === 0 ? 0x2a2a2a : 0x8f9396, x, 0.9, Z(21.3), 1.7, 0.06, 0.8);
    k.box(0xb9bcbf, -0.5, 2.9, Z(21.0), 10, 0.9, 1.8);
    k.box(0xa9adb0, -0.5, 3.8, Z(21.6), 1.2, HR - 3.8, 0.8);
    k.panel(new THREE.MeshLambertMaterial({ map: tex(T.tiles('#f2f1ec', '#d8d6cf', 8, 0.01), [6, 1]) }), 0, 1.6, Z(D) - 0.11, 27.6, 2.2, Math.PI);
    for (const [x, sh] of [[-6.2, 0xf1c9a5], [4.2, 0xc68863], [6.8, 0xe0ac84]]) k.person(x, Z(19.2), Math.PI, { look: { skin: sh, hair: 0x2b1d12, shirt: 0x1b1b1b, pants: 0x1c1c1c } });
  }

  // ---- the salad island under the curved soffit on the right ----
  curvedCounter(k, XR, Z(11.2), 4.2, Math.PI * 0.62, Math.PI * 1.38, { front: 0x7a3a22, band: 0x8a4a2e, soffit: 4.8, lamps: 0xf6efe0 });
  for (let a = Math.PI * 0.68; a < Math.PI * 1.34; a += 0.2) {
    const x = XR + Math.cos(a) * 3.8, z = Z(11.2) + Math.sin(a) * 3.8;
    k.inst(GEOM.box, [0x3f8f4a, 0x6fae4a, 0xc9372c, 0xe8b923, 0xf1ece0][Math.round(a * 5) % 5], x, 1.0, z, 0.4, 0.09, 0.45, { ry: -a });
  }
  k.person(XR - 1.2, Z(11.2), -Math.PI / 2, { look: { skin: 0xe0ac84, hair: 0x4a2f1b, shirt: 0x1b1b1b, pants: 0x1c1c1c, longHair: true } });
  // dish return through the right wall, bins beside it
  k.box(0xc4c7ca, XR - 0.35, 0.95, Z(19.5), 0.7, 0.06, 2.2);
  k.panel(new THREE.MeshBasicMaterial({ color: 0x3a3d40 }), XR + 0.05, 1.6, Z(19.5), 2.2, 1.3, Math.PI / 2);
  k.panel(new THREE.MeshLambertMaterial({ map: tex(T.text('DISH RETURN', { w: 512, h: 80, bg: '#1d2b4a', color: '#f1ece0', font: 'bold 44px system-ui, sans-serif' })) }), XR - 0.12, 2.95, Z(19.5), 1.8, 0.28, Math.PI / 2).scale.x = -1;
  for (const [z, c] of [[Z(17.3), 0x5a5e63], [Z(16.6), 0x2b5d9a]]) k.box(c, XR - 0.45, 0, z, 0.55, 1.0, 0.55, { solid: true });

  // ---- dining: rows of white tables and bentwood chairs ----
  for (const x of [-4.6, -0.6, 3.4, 7.2]) for (const z of [3.0, 5.9, 8.8, 11.7, 14.4]) {
    if (x > 6 && z > 13) continue;
    grillTable(k, x, Z(z), r, x === -0.6 && z === 8.8 ? 3 : 2, 0.32);
  }
  k.person(1.4, Z(1.4), 0.3); k.person(6.4, Z(10.3), -2.4);
  k.plant(XR - 0.6, Z(1.0), 1.3, 0xf0ede6);

  // ---- the deck, through the French doors ----
  const DX = -22, DZ0 = Z(4), DZ1 = Z(21);
  k.floor(new THREE.MeshLambertMaterial({ map: tex(T.planks('#8c8477', 13), [2, 9]) }), DX, DZ0, XL - 0.2, DZ1);
  k.box(0x4a3426, (DX + XL) / 2, -1.0, DZ1 - 0.12, XL - DX, 1.0, 0.25);
  k.box(0x4a3426, DX + 0.12, -1.0, (DZ0 + DZ1) / 2, 0.25, 1.0, DZ1 - DZ0);
  k.box(0xd2bd98, (DX + XL) / 2 - 0.6, -4.6, DZ0 - 0.15, XL - DX + 1.4, 11.5, 0.3); // the building going on past the deck
  deckRail(k, DX + 0.15, DZ0 + 0.3, DX + 0.15, DZ1 - 0.15);
  deckRail(k, DX + 0.15, DZ1 - 0.15, XL - 0.6, DZ1 - 0.15);
  // stone piers up to the roof beam, pale caps, lanterns
  for (const z of [DZ0 + 0.55, (DZ0 + DZ1) / 2, DZ1 - 0.5]) {
    stone(k, DX + 0.5, -4.6, z, 0.9, 4.6 + 3.3, 0.9, Math.round(z));
    k.box(0xd8ccb2, DX + 0.5, 3.3, z, 1.04, 0.12, 1.04);
    k.box(0x2b2724, DX + 1.0, 2.5, z, 0.12, 0.36, 0.26); k.box(new THREE.MeshBasicMaterial({ color: 0xffd898 }), DX + 1.06, 2.56, z, 0.04, 0.24, 0.18);
  }
  stone(k, DX + 0.45, -4.6, (DZ0 + DZ1) / 2 - 4.2, 0.7, 4.6 + 1.2, 0.7, 9); // a short one past the rail
  k.box(0xd8ccb2, DX + 0.45, 1.2, (DZ0 + DZ1) / 2 - 4.2, 0.84, 0.1, 0.84);
  // timber roof: beam on the piers, joists back to the wall, plank ceiling, knee braces
  k.box(0x4a3426, DX + 0.5, 3.42, (DZ0 + DZ1) / 2, 0.45, 0.6, DZ1 - DZ0 + 0.6);
  for (let z = DZ0 + 0.3; z < DZ1; z += 1.4) k.box(0x4a3426, (DX + XL) / 2, 4.02, z, XL - DX + 0.8, 0.26, 0.16);
  k.ceiling(new THREE.MeshLambertMaterial({ map: tex(T.planks('#5b4232', 21), [3, 6]), side: THREE.DoubleSide }), DX - 0.6, DZ0, XL, DZ1 + 0.6, 4.3);
  for (const z of [DZ0 + 0.55, (DZ0 + DZ1) / 2, DZ1 - 0.5]) for (const s of [-1, 1]) {
    if ((z === DZ0 + 0.55 && s < 0) || (z === DZ1 - 0.5 && s > 0)) continue;
    k.member(0x4a3426, [DX + 0.5, 2.5, z + s * 0.45], [DX + 0.5, 3.15, z + s * 1.5], 0.16, 0.18);
  }
  // black lantern posts at the rail
  for (const z of [Z(8.6), Z(16.6)]) {
    k.inst(GEOM.box, 0x161616, DX + 0.15, 1.4, z, 0.09, 2.8, 0.09);
    k.inst(GEOM.box, 0x161616, DX + 0.15, 2.85, z, 0.3, 0.42, 0.3);
    k.inst(GEOM.box, 0xffe2a8, DX + 0.15, 2.85, z, 0.22, 0.3, 0.22, { basic: true });
    k.inst(GEOM.cone4, 0x161616, DX + 0.15, 3.15, z, 0.4, 0.2, 0.4, { ry: Math.PI / 4 });
  }
  // slatted tables, ladder-back chairs, patio heaters among them
  for (const [x, z, round] of [[-18.0, Z(6.6), false], [-20.0, Z(13.0), false], [-17.6, Z(15.6), true], [-20.0, Z(18.6), false], [-16.4, Z(19.2), true]]) deckTable(k, x, z, Math.PI / 2, r, round);
  for (const [x, z] of [[-20.4, Z(9.6)], [-16.2, Z(12.9)], [-15.4, Z(5.2)], [-18.4, Z(17.4)]]) heater(k, x, z);
  deckView(k, -70, Z(-36), Z(60), 0);

  return {
    rooms: [[XL, G0, XR, Z(D), HR - 0.3], [DX, DZ0, XL, DZ1, 4.1]],
    arrive: [-2.6, Z(1.6), 0],
    portal: { x: -2.6, z: G0 + 0.5, r: 1.1 },
    spots: [
      { x: -1.0, z: Z(15.6), r: 2.4, text: '🍽️ Grab a plate at the <b>Mustang Grill</b>', fn: (game) => { game.player.joy = 100; game.audio.pickup(); game.toast(['🍽️ Taco Tuesday. On a Thursday. You do not ask questions. Joy restored.', '🍔 A burger off the flat-top, fries on the side. Joy restored.', '🥧 There is apple pie today! Joy restored.', '🍽️ The chicken strips. Again. Perfect. Joy restored.'][Math.floor(Math.random() * 4)]); } },
      { x: -8.8, z: Z(7.6), r: 1.5, text: '🥐 Grab something from the <b>pastry case</b>', fn: (game) => { game.player.joy = Math.min(100, game.player.joy + 30); game.audio.pickup(); game.toast(['🥐 A warm croissant. Joy +30.', '🍪 A chocolate chip cookie the size of your hand. Joy +30.', '🧁 A muffin with the crunchy top. Joy +30.'][Math.floor(Math.random() * 3)]); } },
      { x: 8.6, z: Z(11.2), r: 1.6, text: '🥗 Build a salad', fn: (game) => { game.player.joy = Math.min(100, game.player.joy + 30); game.audio.pickup(); game.toast(['🥗 Spinach, chickpeas, too many croutons. Balanced. Joy +30.', '🥗 You make a salad. Then you go get pizza too. Joy +30.'][Math.floor(Math.random() * 2)]); } },
      { x: XL + 2.0, z: Z(13.9), r: 1.4, text: '🔥 Warm up by the fireplace', fn: (game) => { game.player.joy = 100; game.audio.pickup(); game.toast(['🔥 You sink into the leather chair by the fire. Joy restored.', '🔥 Someone is reading Psalms by the fire. You listen a while. Joy restored.'][Math.floor(Math.random() * 2)]); } },
      { x: XR - 1.4, z: Z(19.5), r: 1.4, text: '🍽️ Bus your tray', fn: (game, it) => {
        if (it.trayT && game.t - it.trayT < 60) { game.toast('🍽️ Your tray is already back. Nice.'); return; }
        it.trayT = game.t; game.addCredits(2); game.audio.pickup();
        game.toast(['🍽️ You bus your tray, and the one someone left behind. +2 Chapel Credits', '🍽️ Tray returned, napkin in the trash, chair pushed in. +2 Chapel Credits'][Math.floor(Math.random() * 2)]);
      } },
      { x: DX + 1.3, z: Z(11.0), r: 1.6, text: '🌄 Take in the view over Placerita Canyon', fn: (game) => { game.player.joy = 100; game.audio.pickup(); game.toast(['🌄 The hills go gold in the late sun. The power lines hum. Joy restored.', '🌄 The breeze comes up the canyon through the oaks. Joy restored.', '🌄 You can see the cross on the hill from here. Joy restored.'][Math.floor(Math.random() * 3)]); } },
      { x: -20.4, z: Z(9.6), r: 1.3, text: '🔥 Stand by the patio heater', fn: (game) => { game.player.joy = Math.min(100, game.player.joy + 40); game.toast('🔥 The heater ticks and glows. Your hands thaw. Joy +40.'); } },
    ],
  };
}

// ---------- the interiors ----------

const SITS = { sit: 0.47 };

export const INTERIORS = {
  // Trophy Coffee: vaulted white room with dark timber trusses, a white-painted brick back wall
  // with black barn sconces, deep-teal cabinets with white tops, a long farmhouse counter
  // faced in navy patterned tile, black metal shelving with plants, a flag over the bar,
  // polished concrete floors, black steel doors and windows
  trophy: {
    name: 'Trophy Coffee', door: 'trophy', w: 13, d: 9, ceil: 6.4,
    build(k, g) {
      const W = 13, D = 9, H = 3.6;
      k.floor(new THREE.MeshLambertMaterial({ map: tex(T.mottled('#c8c7c1', 0.07), [3, 2]) }), -W / 2, 0, W / 2, D);
      const white = 0xf3f2ee;
      k.wall(white, -W / 2, 0, W / 2, 0, H, [[5.6, 7.4, 2.5]]); // front, glass doors in the middle
      k.wall(white, -W / 2, 0, -W / 2, D, H);
      k.wall(white, W / 2, 0, W / 2, D, H);
      k.wall(white, -W / 2, D, W / 2, D, H);
      // Vaulted ceiling over the room: two slopes up to a ridge running front to back
      const ridge = 6.2, slope = Math.atan2(ridge - H, W / 2), sl = Math.hypot(W / 2, ridge - H);
      for (const sgn of [-1, 1]) {
        const r = new THREE.Mesh(new THREE.PlaneGeometry(sl, D), mat(0xf7f6f2, { side: THREE.DoubleSide }));
        r.rotation.set(Math.PI / 2, sgn * slope, 0);
        r.position.set(sgn * W / 4, (H + ridge) / 2, D / 2);
        k.scene.add(r);
        // gable ends
      }
      const gable = new THREE.Shape([new THREE.Vector2(-W / 2, H), new THREE.Vector2(W / 2, H), new THREE.Vector2(0, ridge)]);
      for (const z of [0.1, D - 0.1]) { const m = new THREE.Mesh(new THREE.ShapeGeometry(gable), mat(white, { side: THREE.DoubleSide })); m.position.z = z; k.scene.add(m); }
      // Dark timber trusses: tie beam and two rafters every 3 m
      const beam = 0x3a2a20;
      for (const z of [1.6, 4.5, 7.4]) {
        k.box(beam, 0, H - 0.1, z, W, 0.26, 0.2);
        for (const sgn of [-1, 1]) {
          const rf = k.box(beam, sgn * W / 4, (H + ridge) / 2 - 0.2, z, sl, 0.26, 0.2);
          rf.rotation.z = -sgn * slope; rf.position.y -= 0.13;
        }
        k.box(beam, 0, H, z, 0.2, ridge - H - 0.2, 0.2); // king post
      }
      k.box(beam, 0, ridge - 0.35, D / 2, 0.24, 0.26, D); // ridge beam
      // Back wall: white-painted brick to the ceiling line, three black barn sconces
      k.panel(new THREE.MeshLambertMaterial({ map: tex(T.brick('#ecebe6', '#d9d7d0'), [5, 1.4]) }), -1.2, H / 2, D - 0.11, 8.4, H, Math.PI);
      for (const x of [-3.2, -2.2, -1.2]) sconce(k, x, 2.4, D - 0.14, Math.PI);
      // Bar along the back: deep teal cabinets, white top, espresso machine, grinders, register
      const teal = 0x2e5a60;
      k.box(teal, -2.6, 0, D - 0.45, 6.2, 0.9, 0.7, { solid: true });
      k.box(0xf4f3f0, -2.6, 0.9, D - 0.45, 6.3, 0.05, 0.78);
      for (let i = 0; i < 7; i++) k.box(0x24494e, -5.3 + i * 0.9, 0.12, D - 0.81, 0.82, 0.68, 0.02); // door panels
      k.box(0xc9c9c9, -1.0, 0.95, D - 0.5, 1.1, 0.5, 0.55); // espresso machine
      k.box(0x8c8c8c, -1.0, 1.45, D - 0.5, 1.1, 0.06, 0.55);
      for (const x of [-1.9, -2.3]) { k.box(0x1b1b1b, x, 0.95, D - 0.5, 0.22, 0.38, 0.22); k.cyl(0x3a2a20, x, 1.33, D - 0.5, 0.09, 0.18); }
      k.box(0x1b1b1b, -3.5, 0.95, D - 0.55, 0.4, 0.3, 0.3); // register
      // Black metal shelving with plants and bags of beans, left of the bar
      for (const x of [-5.6]) {
        for (const y of [0.05, 0.6, 1.15, 1.7, 2.25]) k.box(0x1b1b1b, x, y, D - 0.45, 1.0, 0.03, 0.4);
        for (const dx of [-0.48, 0.48]) for (const dz of [-0.18, 0.18]) k.box(0x1b1b1b, x + dx, 0, D - 0.45 + dz, 0.03, 2.3, 0.03);
        for (const y of [0.62, 1.17]) for (const dx of [-0.3, 0, 0.3]) k.box([0xc9a227, 0x2b2b2b, 0xf1ece0][Math.round((dx + 0.3) * 3.4)], x + dx, y, D - 0.45, 0.2, 0.3, 0.14);
        for (const y of [1.72, 2.27]) { const l = k.ball(0x3f6e35, x, y + 0.25, D - 0.45, 0.32); l.scale.y = 0.4; }
      }
      // The flag over the bar
      k.panel(new THREE.MeshLambertMaterial({ map: tex(T.flag()) }), 1.0, 2.6, D - 0.12, 0.9, 1.5, 0).rotation.z = Math.PI / 2;
      // Back-right: a pick-up window and a pastry case
      k.box(0xf4f3f0, 2.6, 0, D - 0.4, 2.4, 1.05, 0.6, { solid: true });
      k.box(0xdcebf0, 2.6, 1.05, D - 0.4, 2.2, 0.45, 0.5);
      for (let i = 0; i < 6; i++) k.ball([0xd9a066, 0xb5773d, 0xf0d9a8][i % 3], 1.8 + i * 0.32, 1.17, D - 0.4, 0.1);
      // The long farmhouse counter: wood top, front faced in navy patterned tile
      const tileC = (() => {
        const [c, x] = canvas(128, 64);
        x.fillStyle = '#1f2c48'; x.fillRect(0, 0, 128, 64);
        x.strokeStyle = '#e8e4da'; x.lineWidth = 2;
        for (let i = 0; i < 4; i++) for (let j = 0; j < 2; j++) {
          const cx = 16 + i * 32, cy = 16 + j * 32;
          x.beginPath(); x.moveTo(cx, cy - 12); x.lineTo(cx + 12, cy); x.lineTo(cx, cy + 12); x.lineTo(cx - 12, cy); x.closePath(); x.stroke();
          x.beginPath(); x.arc(cx, cy, 4, 0, 7); x.stroke();
        }
        return c;
      })();
      const cz = 5.0, cx = 1.2;
      k.box(0xa77b52, cx, 0.95, cz, 4.4, 0.08, 1.1, { solid: true });
      k.box(0x5a4030, cx, 0, cz + 0.1, 4.2, 0.95, 0.7);
      k.panel(new THREE.MeshLambertMaterial({ map: tex(tileC, [6, 1.5]) }), cx, 0.47, cz - 0.26, 4.2, 0.94, 0);
      for (const dx of [-2.05, 2.05]) k.box(0x6b4c33, cx + dx, 0, cz, 0.14, 0.95, 1.0);
      k.box(0xd9d4ca, cx - 1.2, 1.03, cz + 0.1, 0.35, 0.3, 0.3); // cups
      k.box(0x1b1b1b, cx + 0.6, 1.03, cz + 0.1, 0.4, 0.04, 0.3); // tablet stand
      k.box(0x1b1b1b, cx + 0.6, 1.07, cz + 0.12, 0.3, 0.22, 0.03);
      k.panel(new THREE.MeshLambertMaterial({ map: tex(T.text(['ORDER HERE'], { w: 256, h: 64, bg: '#1f2c48', font: 'bold 30px system-ui, sans-serif' })) }), cx + 1.4, 1.35, cz + 0.05, 0.7, 0.18, 0);
      // The barista behind the counter
      k.person(cx - 0.3, cz + 1.0, Math.PI, { look: { skin: 0xe0ac84, hair: 0x2b1d12, shirt: 0x1f2c48, pants: 0x2b2f3a, longHair: true } });
      k.box(0x2b2b2b, cx - 0.3, 0.7, cz + 0.84, 0.44, 0.6, 0.02); // apron
      // Front: black steel glass doors and windows looking out onto the patio
      k.window(0, 0.05, 0.12, 1.8, 2.4, 0, 0x1b1b1b, 2);
      for (const x of [-4.4, -2.2, 2.2, 4.4]) k.window(x, 0.5, 0.12, 2.0, 2.6, 0, 0x1b1b1b, 1);
      k.window(W / 2 - 0.12, 0.6, 2.5, 2.2, 2.4, -Math.PI / 2, 0x1b1b1b, 1);
      k.panel(new THREE.MeshLambertMaterial({ map: tex(T.text([{ t: '★', font: 'bold 40px serif', color: '#c9a227' }, 'TROPHY', { t: 'COFFEE', font: 'bold 34px system-ui, sans-serif' }], { w: 256, h: 192, font: 'bold 64px "Arial Black", Impact, sans-serif', color: '#1f2c48' })) }), -W / 2 + 0.12, 2.3, 5.0, 2.4, 1.8, -Math.PI / 2);
      // Seating: marble bistro tables with blue-and-white rattan chairs; a big fiddle-leaf fig
      const rattan = 0x2d4f8a;
      for (const [x, z] of [[-4.6, 2.2], [-4.6, 4.8], [-2.2, 2.6], [4.4, 2.2]]) {
        k.table(0xeeeeea, x, z, 0.75, 0.75, { round: true, legs: 0x1b1b1b });
        k.chair(rattan, x - 0.65, z, Math.PI / 2, { legs: 0xd8c9a0 });
        k.chair(rattan, x + 0.65, z, -Math.PI / 2, { legs: 0xd8c9a0 });
      }
      k.person(-5.25, 2.2, Math.PI / 2, { sit: 0.47 });
      k.person(-1.55, 2.6, -Math.PI / 2, { sit: 0.47, look: { skin: 0xf1c9a5, hair: 0xc9a25a, shirt: 0xe8b4b8, pants: 0x3d4f6e, longHair: true } });
      k.person(3.75, 2.2, Math.PI / 2, { sit: 0.47 });
      k.plant(W / 2 - 0.6, 0.8, 1.6, 0xf0ede6);
      k.plant(-W / 2 + 0.6, 0.8, 1.3, 0x1b1b1b);
      k.plant(W / 2 - 0.6, D - 1.6, 1.4, 0xf0ede6);
      for (const x of [-2.5, 0, 2.5]) k.pendant(x, 5.0, 4.4, 1.6);
      return {
        spawn: [0, 1.3, 0],
        rooms: [[-W / 2, 0, W / 2, D, 5.6]],
        exits: [[0, 0.6]],
        spots: [
          { x: cx + 0.2, z: cz - 1.0, r: 1.6, text: '☕ Order a cold brew (5 Chapel Credits)', fn: (game) => game.buyCoffee() },
          { x: -5.6, z: D - 1.2, r: 1.3, text: '🫘 Smell the beans', fn: (game) => { game.toast('🫘 Ethiopian, washed process. You feel more sanctified already. Joy +10.'); game.player.joy = Math.min(100, game.player.joy + 10); } },
        ],
        light: 0xfff6e6,
      };
    },
  },

  // Bross Court in the MacArthur Center, where chapel meets: maple floor, navy painted keys and
  // out-of-bounds band with BROSS COURT along it, a navy-and-gold M at center court, navy
  // retractable bleachers along both sides, cream walls over a navy wainscot, a row of navy
  // championship banners, brown timber trusses, glass backboards hung from the ceiling
  chapel: {
    name: 'Bross Court', sub: 'MacArthur Center', w: 40, d: 30, ceil: 11,
    build(k, g) {
      const W = 40, D = 30, H = 10.5;
      const CL = 28.65, CW = 15.24; // court, long axis along x
      const ox = 0, oz = D / 2;
      // The court floor, painted on one canvas
      {
        const S = 40; // px per meter
        const [c, x] = canvas(W * S / 2, D * S / 2);
        const s = S / 2, X = (m) => (m + W / 2) * s, Z = (m) => m * s;
        x.fillStyle = '#d9b27c'; x.fillRect(0, 0, c.width, c.height);
        const r = rng(4);
        for (let i = 0; i < c.height; i += 3) { x.fillStyle = `rgba(${r() < 0.5 ? '120,70,20' : '255,235,200'},${0.05 + r() * 0.06})`; x.fillRect(0, i, c.width, 1.5); }
        for (let i = 0; i < 1800; i++) { x.fillStyle = 'rgba(110,60,20,0.08)'; x.fillRect(r() * c.width, Math.floor(r() * c.height / 3) * 3, 20 + r() * 40, 1.5); }
        // Navy out-of-bounds band
        x.fillStyle = '#1d2b4a';
        const bx0 = X(-CL / 2 - 2), bx1 = X(CL / 2 + 2), bz0 = Z(oz - CW / 2 - 2), bz1 = Z(oz + CW / 2 + 2);
        x.fillRect(bx0, bz0, bx1 - bx0, Z(2)); x.fillRect(bx0, bz1 - Z(2), bx1 - bx0, Z(2));
        x.fillRect(bx0, bz0, Z(2), bz1 - bz0); x.fillRect(bx1 - Z(2), bz0, Z(2), bz1 - bz0);
        x.fillStyle = '#f4f1ea'; x.font = `bold ${Z(1.3)}px "Arial Black", Impact, sans-serif`; x.textAlign = 'center'; x.textBaseline = 'middle';
        x.fillText('BROSS COURT', X(0), bz1 - Z(1));
        x.save(); x.translate(X(0), bz0 + Z(1)); x.rotate(Math.PI); x.fillText('BROSS COURT', 0, 0); x.restore();
        // Lines
        x.strokeStyle = '#f4f1ea'; x.lineWidth = Z(0.06);
        x.strokeRect(X(-CL / 2), Z(oz - CW / 2), Z(CL), Z(CW));
        x.beginPath(); x.moveTo(X(0), Z(oz - CW / 2)); x.lineTo(X(0), Z(oz + CW / 2)); x.stroke();
        x.beginPath(); x.arc(X(0), Z(oz), Z(1.8), 0, 7); x.stroke();
        for (const sgn of [-1, 1]) {
          const bx = X(sgn * (CL / 2)), fx = X(sgn * (CL / 2 - 5.8));
          // painted key
          x.fillStyle = '#1d2b4a';
          x.fillRect(Math.min(bx, fx), Z(oz - 2.45), Math.abs(fx - bx), Z(4.9));
          x.strokeRect(Math.min(bx, fx), Z(oz - 2.45), Math.abs(fx - bx), Z(4.9));
          x.beginPath(); x.arc(fx, Z(oz), Z(1.8), 0, 7); x.stroke();
          // three-point arc
          const hx = X(sgn * (CL / 2 - 1.6));
          x.beginPath(); x.arc(hx, Z(oz), Z(6.75), sgn > 0 ? Math.PI * 0.6 : -Math.PI * 0.4, sgn > 0 ? Math.PI * 1.4 : Math.PI * 0.4); x.stroke();
        }
        // The M at center court: navy with a gold edge
        x.font = `bold ${Z(3.6)}px Georgia, "Times New Roman", serif`;
        x.lineWidth = Z(0.18); x.strokeStyle = '#c9a227'; x.strokeText('M', X(0), Z(oz) + Z(0.2));
        x.fillStyle = '#1d2b4a'; x.fillText('M', X(0), Z(oz) + Z(0.2));
        k.floor(new THREE.MeshLambertMaterial({ map: tex(c) }), -W / 2, 0, W / 2, D);
      }
      // Walls: navy wainscot, cream above
      const cream = 0xeadcaa, navy = 0x1d2b4a;
      k.wall(cream, -W / 2, 0, W / 2, 0, H, [[W / 2 - 1.5, W / 2 + 1.5, 3]]);
      k.wall(cream, -W / 2, D, W / 2, D, H);
      k.wall(cream, -W / 2, 0, -W / 2, D, H);
      k.wall(cream, W / 2, 0, W / 2, D, H);
      for (const [x, z, w, rot] of [[0, 0.12, W, 0], [0, D - 0.12, W, Math.PI], [-W / 2 + 0.12, D / 2, D, Math.PI / 2], [W / 2 - 0.12, D / 2, D, -Math.PI / 2]]) {
        k.panel(new THREE.MeshLambertMaterial({ color: navy }), x, 1.5, z, w, 3, rot);
      }
      k.ceiling(mat(0xf0e4c0), -W / 2, 0, W / 2, D, H);
      // Timber trusses across the short span
      for (let x = -W / 2 + 4; x < W / 2; x += 4) {
        k.box(0x6b4a2e, x, H - 1.4, D / 2, 0.35, 0.45, D);
        k.box(0x6b4a2e, x, H - 0.45, D / 2, 0.3, 0.3, D);
        for (let z = 2; z < D; z += 3) k.box(0x6b4a2e, x, H - 1.0, z, 0.22, 0.6, 0.22);
        for (let z = 4; z < D; z += 6) k.lightPanel(x + 2, z, H, 0.9, 0.9);
      }
      // Navy banners along both long walls
      const banner = (i) => tex(T.text([{ t: '★', font: 'bold 50px serif', color: '#c9a227' }, { t: 'GSAC', font: 'bold 40px system-ui, sans-serif' }, { t: ['CHAMPIONS', 'TOURNAMENT', 'REGULAR SEASON'][i % 3], font: 'bold 22px system-ui, sans-serif' }, { t: String(2008 + ((i * 3) % 16)), font: 'bold 34px system-ui, sans-serif', color: '#c9a227' }], { w: 192, h: 320, bg: '#1d2b4a', font: 'bold 30px system-ui, sans-serif' }));
      for (let i = 0; i < 12; i++) {
        const x = -W / 2 + 3 + i * 3.1;
        k.panel(new THREE.MeshLambertMaterial({ map: banner(i) }), x, 6.6, D - 0.14, 1.3, 2.1, 0);
        k.panel(new THREE.MeshLambertMaterial({ map: banner(i + 5) }), x, 6.6, 0.14, 1.3, 2.1, Math.PI);
      }
      // Navy retractable bleachers along both long sides
      const seats = [];
      for (const [z0, dir] of [[oz + CW / 2 + 2.3, 1], [oz - CW / 2 - 2.3, -1]]) {
        // (the near side leaves an aisle in the middle, from the doors to the floor)
        for (const [x0, x1] of dir > 0 ? [[-15, 15]] : [[-15, -2.2], [2.2, 15]]) {
          const cx = (x0 + x1) / 2, w = x1 - x0;
          for (let r = 0; r < 6; r++) {
            const z = z0 + dir * (r * 0.75 + 0.37);
            k.box(0x2a2f38, cx, 0, z, w, 0.3 + r * 0.42, 0.75);
            k.box(navy, cx, 0.3 + r * 0.42, z - dir * 0.15, w, 0.08, 0.42);
            seats.push([z, 0.38 + r * 0.42, dir, x0, x1]);
          }
          k.solid(x0, z0, x1, z0 + dir * 4.6);
        }
      }
      // A crowd for chapel
      const r2 = rng(31);
      for (const [z, y, dir, x0, x1] of seats) for (let x = x0 + 0.6; x < x1 - 0.5; x += 0.9) {
        if (r2() < 0.55) continue;
        const p = k.person(x + r2() * 0.3, z, dir > 0 ? Math.PI : 0, { sit: y + 0.1 });
        if (r2() < 0.2) { p.userData.parts.armL.rotation.x = p.userData.parts.armR.rotation.x = -2.8; }
      }
      // Hoops: glass backboards on steel frames hung from the trusses, orange rims and nets
      const hoops = [];
      for (const sgn of [-1, 1]) {
        const bx = sgn * (CL / 2 - 1.2);
        k.box(0x2a2a2a, bx + sgn * 0.6, 4.0, oz, 0.12, H - 4, 0.12);
        k.box(0x2a2a2a, bx + sgn * 0.3, 3.9, oz, 0.7, 0.1, 0.1);
        const glass = new THREE.Mesh(BOX, new THREE.MeshLambertMaterial({ color: 0xeaf3f7, transparent: true, opacity: 0.45 }));
        glass.scale.set(0.05, 1.07, 1.83); glass.position.set(bx, 2.75, oz); k.scene.add(glass);
        k.box(0xf4f1ea, bx - sgn * 0.01, 2.9, oz, 0.06, 0.45, 0.59);
        const rim = new THREE.Mesh(new THREE.TorusGeometry(0.23, 0.02, 6, 20), mat(0xe2581d));
        rim.rotation.x = Math.PI / 2; rim.position.set(bx - sgn * 0.38, 3.05, oz); k.scene.add(rim);
        const net = new THREE.Mesh(new THREE.CylinderGeometry(0.23, 0.15, 0.42, 12, 1, true), new THREE.MeshLambertMaterial({ color: 0xffffff, wireframe: true }));
        net.position.set(bx - sgn * 0.38, 2.84, oz); k.scene.add(net);
        k.box(navy, bx + sgn * 0.3, 0, oz, 0.3, 0.02, 0.3); // floor plate
        hoops.push({ x: bx - sgn * 0.38, y: 3.05, z: oz, ft: bx - sgn * 4.6, sgn });
      }
      // Scoreboard and the flag on the end walls
      k.box(0x111111, 0, 6.2, D - 0.3, 5, 2.2, 0.4);
      k.panel(new THREE.MeshBasicMaterial({ map: tex(T.text([{ t: 'HOME  52 · 48  GUEST', color: '#ff5533' }, { t: 'PERIOD 2   12:00', color: '#ffcc33' }], { w: 512, h: 160, bg: '#111', font: 'bold 44px monospace' })) }), 0, 7.3, D - 0.51, 4.6, 1.6, 0);
      k.panel(new THREE.MeshLambertMaterial({ map: tex(T.flag()) }), -W / 2 + 0.14, 6.5, D / 2, 4.2, 2.2, -Math.PI / 2);
      // The worship team on a stage by the far baseline
      k.box(0x2a2a2a, W / 2 - 3.2, 0, oz, 3.4, 0.5, 9, { solid: true });
      for (const z of [oz - 2.5, oz, oz + 2.5]) { k.person(W / 2 - 3.2, z, -Math.PI / 2, { pose: (p) => { p.armR.rotation.x = -0.9; } }); k.people[k.people.length - 1].position.y = 0.5; k.solids.pop(); }
      k.box(0x1b1b1b, W / 2 - 4.6, 0.5, oz, 0.5, 1.05, 0.4); // pulpit
      const ball = k.ball(0xd2691e, 0, -10, 0, 0.12);
      return {
        spawn: [0, 1.8, 0],
        rooms: [[-W / 2, 0, W / 2, D, 9]],
        exits: [[0, 0.6]],
        spots: hoops.map((h) => ({
          x: h.ft, z: h.z, r: 1.4, text: '🏀 Shoot a free throw',
          fn: (game, inside) => inside.shoot(ball, h),
        })),
        light: 0xfff4dc,
      };
    },
  },
};

// A lounge-style dorm room off a lounge: two lofted wood beds with drawers, open wood shelves
// above them, desks, a window with the hills, a wall AC unit, photos and a garland on the wall
function dormRoom(k, x0, z0, x1, z1, H, { wood = 0xb98a55, floor = '#7a6450', seed = 1 } = {}) {
  k.floor(new THREE.MeshLambertMaterial({ map: tex(T.planks(floor, seed + 20), [2, 2]) }), x0, z0, x1, z1);
  k.ceiling(mat(0xf6f5f1), x0, z0, x1, z1, H);
  const cx = (x0 + x1) / 2;
  k.window(cx, 1.0, z1 - 0.12, 2.2, 1.3, Math.PI, 0x6b4f33, 3);
  k.box(0xd9d7d0, cx + 1.6, 0.4, z1 - 0.3, 0.9, 0.45, 0.35); // AC unit
  for (const sgn of [-1, 1]) {
    const bx = sgn > 0 ? x1 - 0.55 : x0 + 0.55, bz = (z0 + z1) / 2;
    k.box(wood, bx, 0, bz, 1.0, 0.45, 2.0, { solid: true }); // drawers base
    for (let i = 0; i < 3; i++) k.box(0x8a6238, bx - sgn * 0.5, 0.06, bz - 0.6 + i * 0.6, 0.02, 0.32, 0.52);
    k.box(0xf4f2ee, bx, 0.45, bz, 0.95, 0.18, 1.95); // mattress
    k.box([0x9fc3c9, 0xe8b4b8, 0xd9cdb8][(seed + sgn + 3) % 3], bx, 0.6, bz + 0.2, 0.97, 0.06, 1.4); // blanket
    k.box(0xffffff, bx, 0.6, bz - 0.75, 0.6, 0.14, 0.35); // pillow
    // open shelves above the bed
    k.box(wood, bx + sgn * 0.3, 1.7, bz, 0.35, 0.04, 2.0);
    k.box(wood, bx + sgn * 0.3, 2.2, bz, 0.35, 0.04, 2.0);
    for (const dz of [-1, 0, 1]) k.box(wood, bx + sgn * 0.3, 1.7, bz + dz * 0.98, 0.35, 0.54, 0.04);
    for (let i = 0; i < 5; i++) k.box([0x2b2b2b, 0xc9a227, 0x7a1f2b, 0x3d6e8f, 0xf1ece0][(i + seed) % 5], bx + sgn * 0.3, 1.74, bz - 0.8 + i * 0.35, 0.18, 0.2 + (i % 2) * 0.1, 0.16);
    // photos on the wall beside the bed
    const wallX = sgn > 0 ? x1 - 0.11 : x0 + 0.11;
    for (let i = 0; i < 6; i++) {
      const p = k.panel(new THREE.MeshLambertMaterial({ color: [0xf2c14e, 0x8fb8de, 0xe07a5f, 0x81b29a, 0xf4f1de, 0x3d405b][(i + seed) % 6] }), wallX, 1.0 + (i % 2) * 0.3, bz - 0.7 + Math.floor(i / 2) * 0.35, 0.22, 0.26, sgn > 0 ? -Math.PI / 2 : Math.PI / 2);
      p.position.x -= sgn * 0.01;
    }
    // desk and chair at the foot of the bed
    k.table(wood, bx, z1 - 0.8, 1.0, 0.55, { legs: wood });
    k.box(0x2b2b2b, bx, 0.76, z1 - 0.85, 0.35, 0.22, 0.02); // laptop screen
    k.chair(0x6b4f33, bx - sgn * 0.05, z1 - 1.35, Math.PI, { legs: 0x6b4f33 });
  }
  // a felt-ball garland over the left bed
  for (let i = 0; i < 14; i++) k.ball([0xe07a5f, 0xf2c14e, 0x81b29a, 0x3d405b][i % 4], x0 + 0.13, 2.0 - Math.sin((i / 13) * Math.PI) * 0.25, z0 + 0.7 + i * ((z1 - z0 - 1.4) / 13), 0.04);
  k.box(0xf0ede6, cx, 0, (z0 + z1) / 2, 1.6, 0.01, 2.2); // rug
}

// A dorm lounge (Hotchkiss, Dixon and Waldock are each a little different, from the photos)
function lounge(k, o) {
  const W = 12, D = 9, H = 2.9;
  const floorMat = o.carpet
    ? new THREE.MeshLambertMaterial({ map: tex(T.carpetTiles(o.carpet), [4, 3]) })
    : new THREE.MeshLambertMaterial({ map: tex(T.planks(o.floor || '#4a3a30', 9), [5, 4]) });
  k.floor(floorMat, -W / 2, 0, W / 2, D);
  k.ceiling(mat(0xf7f6f2), -W / 2, 0, W / 2, D, H);
  for (let x = -4; x <= 4; x += 4) for (const z of [2.5, 6.5]) k.lightPanel(x, z, H, 0.6, 0.6);
  const wc = o.wall || 0xf4f3ef;
  k.wall(wc, -W / 2, 0, W / 2, 0, H, [[5.2, 6.8, 2.3]]);
  k.wall(wc, -W / 2, D, W / 2, D, H);
  k.wall(wc, -W / 2, 0, -W / 2, D, H, [[6.3, 7.6, 2.2]]); // to the dorm room
  k.wall(wc, W / 2, 0, W / 2, D, H);
  if (o.wainscot) for (const [x, z, w, rot] of [[0, D - 0.11, W, Math.PI], [-W / 2 + 0.11, D / 2, D, Math.PI / 2], [W / 2 - 0.11, D / 2, D, -Math.PI / 2]]) k.panel(new THREE.MeshLambertMaterial({ color: o.wainscot }), x, 0.45, z, w, 0.9, rot);
  // The stacked-stone fireplace wall with a long linear fire and a wood mantel
  const fx = o.fire[0], fz = o.fire[1], frot = o.fire[2];
  const c = Math.cos(frot), s = Math.sin(frot);
  k.box(0x6f6457, fx, 0, fz, 2.6, H, 0.5, { rot: frot, solid: true });
  k.panel(new THREE.MeshLambertMaterial({ map: tex(T.ledger(o.seed || 7), [1.5, 1.6]) }), fx + s * 0.26, H / 2, fz + c * 0.26, 2.6, H, frot + Math.PI);
  k.box(0x111111, fx + s * 0.25, 0.85, fz + c * 0.25, 1.5, 0.36, 0.04, { rot: frot });
  const flame = k.box(0xff8a2a, fx + s * 0.27, 0.9, fz + c * 0.27, 1.3, 0.12, 0.02, { rot: frot, emissive: 0xff6a10 });
  k.anim.push((dt, t) => { flame.scale.y = 0.1 + 0.05 * Math.sin(t * 9) + 0.03 * Math.sin(t * 23); });
  k.box(0x6b4a2e, fx + s * 0.32, 1.55, fz + c * 0.32, 1.9, 0.14, 0.24, { rot: frot });
  if (o.xo) k.panel(new THREE.MeshLambertMaterial({ map: tex(T.text('XO', { w: 256, h: 128, color: '#f3f1eb', font: 'bold 96px Georgia, serif' })) }), fx + s * 0.28, 2.05, fz + c * 0.28, 0.7, 0.35, frot + Math.PI);
  // Built-in white bench with cubbies and baskets under the windows
  if (o.bench) {
    const [bx, bz, bw, brot] = o.bench;
    k.box(0xf4f3ef, bx, 0, bz, bw, 0.45, 0.5, { rot: brot, solid: true });
    const bc = Math.cos(brot), bs = Math.sin(brot);
    for (let i = 0; i < Math.floor(bw / 0.6); i++) {
      const u = -bw / 2 + 0.3 + i * 0.6;
      k.box(i % 2 ? 0xc9a273 : 0xb08a5a, bx + bc * u + bs * 0.05, 0.05, bz - bs * u + bc * 0.05, 0.4, 0.3, 0.38, { rot: brot });
    }
  }
  for (const w of o.windows || []) k.window(...w);
  // Couches, chairs and tables
  for (const [x, z, rot, wd] of o.sofas) sofa(k, o.sofa, x, z, rot, wd);
  if (o.rug) { k.box(o.rug[1], o.rug[0][0], 0, o.rug[0][1], 3.2, 0.012, 2.2); k.box(o.rug[2], o.rug[0][0], 0, o.rug[0][1], 2.8, 0.014, 1.8); }
  if (o.dining) {
    const [x, z] = o.dining;
    k.table(0x7a5434, x, z, 2.4, 1.0, { legs: 0x3a2a1e });
    for (const dx of [-0.8, 0, 0.8]) { k.chair(0x6b4a2e, x + dx, z - 0.75, 0); k.chair(0x6b4a2e, x + dx, z + 0.75, Math.PI); }
  }
  if (o.ice) k.box(0xbfc3c7, o.ice[0], 0, o.ice[1], 0.6, 1.4, 0.6, { solid: true });
  if (o.shelves) for (const [x, z, rot] of o.shelves) {
    for (const y of [0.5, 1.0, 1.5, 2.0]) k.box(0xf4f3ef, x, y, z, 0.9, 0.04, 0.3, { rot });
    for (const y of [1.0, 1.5, 2.0]) k.box([0xc9a273, 0x3f6e35, 0xe8e2d0][Math.round(y * 2) % 3], x, y + 0.04, z, 0.25, 0.22, 0.2, { rot });
  }
  dormRoom(k, -W / 2 - 4.6, 4.6, -W / 2, 9.8, 2.7, o.room || {});
  k.wall(wc, -W / 2 - 4.6, 4.6, -W / 2, 4.6, 2.7);
  k.wall(wc, -W / 2 - 4.6, 9.8, -W / 2, 9.8, 2.7);
  k.wall(wc, -W / 2 - 4.6, 4.6, -W / 2 - 4.6, 9.8, 2.7);
  // Residents hanging out
  for (const [x, z, h, sit] of o.people || []) k.person(x, z, h, sit ? { sit } : {});
  const roomFx = -W / 2 - 2.3;
  k.person(roomFx - 1.75, 7.0, Math.PI / 2, { sit: 0.62, pose: (p) => { p.armL.rotation.x = -1.0; p.armR.rotation.x = -0.7; } });
  k.box(0x8a5a2a, roomFx - 1.3, 0.85, 7.0, 0.55, 0.2, 0.12, { rot: 0.4 }); // the guitar
  return {
    spawn: [0, 1.8, 0],
    rooms: [[-W / 2, 0, W / 2, D, H], [-W / 2 - 4.6, 4.6, -W / 2, 9.8, 2.7]],
    exits: [[0, 0.6]],
    spots: [
      { x: fx - s * 1.2, z: fz - c * 1.2, r: 1.6, text: '🔥 Warm up by the fireplace', fn: (game) => { game.player.joy = 100; game.toast(['🔥 Somebody is reading Spurgeon out loud by the fire. Joy restored.', '🔥 You warm your hands. Someone offers you a mug of tea. Joy restored.', '🔥 A hall meeting breaks out around the fire. You stay for the prayer requests. Joy restored.'][Math.floor(Math.random() * 3)]); game.audio.pickup(); } },
      { x: roomFx + 1.4, z: 7.2, r: 1.4, text: '😴 Take a nap', fn: (game) => { game.time += 2 * 3600; game.player.joy = 100; game.toast('😴 You took a two-hour "power nap." Your roommate kept practicing guitar. Joy restored.'); } },
    ],
    light: 0xfff8ee,
  };
}

Object.assign(INTERIORS, {
  // The Dunkin Student Center, ground floor: The Trough (big beige tiles, cherry-wood counters
  // with steel tops, light-wood snack displays, glass coolers, a curved white soffit), the UE
  // bookstore through the wall (herringbone floor, charcoal bookcases, a white-brick wall with
  // big black UE letters between caged sconces, a POST OFFICE sign, a vintage bike display),
  // and the brass mailboxes down the hall. The Mustang Grill is upstairs: exposed timber
  // trusses under a dark ceiling, skylights, globe pendants, wood tables
  dunkin: {
    name: 'Dunkin Student Center', sub: 'The Trough · UE Bookstore · Mustang Grill',
    build(k) {
      const H = 3.4;
      const white = 0xf4f3ef;
      // ---- The Trough ----
      k.floor(new THREE.MeshLambertMaterial({ map: tex(T.tiles('#d9cfbf', '#bdb2a2', 4, 0.05), [6.5, 5.5]) }), -12, 0, 1, 11);
      k.ceiling(mat(0xf6f3ec), -12, 0, 12, 13.2, H);
      k.wall(white, -12, 0, 1, 0, H, [[6, 8, 2.4]]);
      k.wall(white, -12, 0, -12, 13.2, H);
      k.wall(white, 1, 0, 1, 11, H, [[3.5, 6.5, 2.6]]);
      k.wall(white, -12, 11, 1, 11, H, [[8.5, 10.5, 2.4]]);
      k.box(0xf9f7f2, -5.5, H - 0.45, 5.5, 9, 0.45, 5); // the curved soffit (squared off)
      for (let x = -10; x <= -1; x += 2.2) for (const z of [2.5, 8.5]) k.ball(0xfffaf0, x, H - 0.02, z, 0.09, true);
      // cherry counters with steel tops along the back, sneeze guard and pastry case
      k.box(0x7a3a22, -7.5, 0, 10.4, 8, 0.95, 0.8, { solid: true });
      k.box(0xb8bcc0, -7.5, 0.95, 10.4, 8.1, 0.05, 0.85);
      k.box(0xdcebf0, -9.5, 1.0, 10.3, 2.4, 0.5, 0.5);
      k.box(0x1b1b1b, -4.5, 1.0, 10.5, 0.5, 0.6, 0.45); // coffee brewers
      k.box(0x1b1b1b, -5.2, 1.0, 10.5, 0.5, 0.6, 0.45);
      k.box(0x7a3a22, -1.5, 0, 6.5, 0.8, 0.95, 4, { solid: true }); // register counter
      k.box(0xb8bcc0, -1.5, 0.95, 6.5, 0.85, 0.05, 4.1);
      k.box(0x1b1b1b, -1.5, 1.0, 5.6, 0.35, 0.3, 0.3);
      k.person(-0.7, 6.5, -Math.PI / 2, { look: { skin: 0xc68863, hair: 0x111111, shirt: 0x7a1f2b, pants: 0x1c1c1c } });
      // glass-door coolers along the left wall, lit inside
      for (let i = 0; i < 4; i++) {
        const z = 2 + i * 1.6;
        k.box(0x222222, -11.6, 0, z, 0.8, 2.1, 1.5, { solid: true });
        k.panel(new THREE.MeshBasicMaterial({ map: tex(T.books(5, '#333', '#e9f2f6', 40 + i)) }), -11.19, 1.05, z, 1.35, 1.9, -Math.PI / 2);
      }
      // two-sided light-wood snack displays in the middle
      for (const [x, z] of [[-6.5, 4.2], [-6.5, 7.2]]) {
        k.box(0xc9a273, x, 0, z, 3, 0.25, 1.1, { solid: true });
        for (let t = 0; t < 3; t++) {
          k.box(0xc9a273, x, 0.25 + t * 0.4, z, 3, 0.04, 0.9 - t * 0.25);
          for (let i = 0; i < 9; i++) k.box([0xc9372c, 0x2b6cb0, 0xe8b923, 0x3f8f4a, 0xf1ece0][(i + t) % 5], x - 1.3 + i * 0.32, 0.29 + t * 0.4, z, 0.22, 0.2, 0.7 - t * 0.25);
        }
      }
      // a bar-height table with stools by the windows
      k.table(0x3a2a1e, -10, 0.9, 3, 0.5, { h: 1.05 });
      for (const x of [-11, -10, -9]) { k.cyl(0x1b1b1b, x, 0, 1.6, 0.04, 0.72); k.cyl(0x1b1b1b, x, 0.72, 1.6, 0.18, 0.04); }
      for (const x of [-9.8, -3.5]) k.window(x, 1.0, 0.12, 2.2, 1.5, 0, 0x3a2a1e, 2);
      k.person(-10, 1.6, Math.PI, { sit: 0.76 });
      k.person(-3.5, 2.5, 0.4);
      // ---- UE, the University Exchange ----
      k.floor(new THREE.MeshLambertMaterial({ map: tex(T.herringbone('#a48767'), [4, 4]) }), 1, 0, 12, 11);
      k.wall(white, 1, 0, 12, 0, H);
      k.wall(white, 12, 0, 12, 11, H);
      k.wall(white, 1, 11, 12, 11, H);
      const charcoal = 0x30333a;
      for (const [x, z, w, rot] of [[6.5, 10.7, 10.4, Math.PI], [11.7, 8.6, 4, -Math.PI / 2], [1.3, 8.6, 4, Math.PI / 2], [1.3, 1.6, 2.6, Math.PI / 2]]) bookcase(k, x, z, w, 2.7, rot, { frame: '#30333a', back: '#22252b', color: charcoal, seed: Math.round(x * 7) });
      // the white-brick wall with big black UE letters between two caged sconces, counter below
      k.panel(new THREE.MeshLambertMaterial({ map: tex(T.brick('#e3e1dc', '#cfccc5', 5), [2.4, 1.4]) }), 11.88, H / 2, 3.6, 4.4, H, -Math.PI / 2);
      k.panel(new THREE.MeshLambertMaterial({ map: tex(T.text('UE', { w: 256, h: 128, color: '#2a2a30', font: 'bold 110px Georgia, serif' })), transparent: true }), 11.86, 2.3, 3.6, 1.6, 0.8, Math.PI / 2);
      for (const z of [2.3, 4.9]) sconce(k, 11.85, 2.2, z, -Math.PI / 2);
      k.box(charcoal, 10.9, 0, 3.6, 0.7, 1.0, 3.6, { solid: true });
      k.box(0xd8d6d0, 10.9, 1.0, 3.6, 0.8, 0.05, 3.7);
      for (const z of [2.8, 4.4]) { k.box(0x8a6a3a, 10.9, 1.05, z, 0.3, 0.02, 0.25); k.box(0x8a6a3a, 10.9, 1.07, z, 0.03, 0.25, 0.2, { rot: 0.3 }); }
      k.person(11.4, 3.6, -Math.PI / 2, { look: { skin: 0xf1c9a5, hair: 0x7b5230, shirt: 0x1f3a6e, pants: 0x2b2f3a, longHair: true } });
      // POST OFFICE sign hanging on chains
      k.panel(new THREE.MeshLambertMaterial({ map: tex(T.text(['POST', 'OFFICE'], { w: 256, h: 160, bg: '#1b1b1b', color: '#f1ece0', font: 'bold 54px Georgia, serif' })) }), 9.5, 2.75, 9.2, 0.9, 0.56, 0);
      // display tables: folded tees, caps, leather journals; the vintage bike with a basket
      for (const [x, z] of [[5.2, 4.5], [7.6, 7.2]]) {
        k.table(0x4a3a2e, x, z, 1.8, 0.9, { legs: 0x1b1b1b, h: 0.86 });
        for (let i = 0; i < 4; i++) k.box([0x1f3a6e, 0xf1ece0, 0x6d6d78, 0x1b1b1b][i], x - 0.65 + i * 0.43, 0.86, z, 0.36, 0.1 + (i % 2) * 0.06, 0.5);
        k.ball(0xf1ece0, x + 0.6, 0.95, z + 0.3, 0.12);
      }
      { const bx = 8.4, bz = 4.0; for (const dx of [-0.55, 0.55]) { const w = new THREE.Mesh(new THREE.TorusGeometry(0.33, 0.025, 6, 20), mat(0x1b1b1b)); w.position.set(bx + dx, 0.35, bz); k.scene.add(w); } k.box(0x6d8a8a, bx, 0.55, bz, 1.0, 0.05, 0.05, { rot: 0 }); k.box(0x6d8a8a, bx - 0.15, 0.35, bz, 0.05, 0.5, 0.05); k.box(0x1b1b1b, bx - 0.2, 0.85, bz, 0.25, 0.05, 0.12); k.box(0xc9a273, bx + 0.7, 0.75, bz, 0.35, 0.25, 0.3); k.solid(bx - 0.9, bz - 0.2, bx + 0.9, bz + 0.2); }
      for (const [x, z] of [[9.6, 5.1], [9.9, 5.6]]) { k.box(0xb08a5a, x, 0, z, 0.5, 0.45, 0.5, { solid: true }); }
      k.plant(2.0, 0.8, 1.1, 0xf0ede6);
      k.person(6.3, 6.0, 2.2);
      // ---- the mail hall with its wall of brass mailboxes ----
      k.floor(new THREE.MeshLambertMaterial({ map: tex(T.tiles('#cfcac2', '#b5afa6', 2, 0.03), [6, 1]) }), -12, 11, 1, 13.2);
      k.wall(white, -12, 13.2, 1, 13.2, 3.0);
      k.wall(white, 1, 11, 1, 13.2, 3.0);
      const brass = (() => {
        const [c, x] = canvas(256, 256);
        x.fillStyle = '#6b5a3a'; x.fillRect(0, 0, 256, 256);
        for (let i = 0; i < 8; i++) for (let j = 0; j < 8; j++) {
          x.fillStyle = '#b89656'; x.fillRect(i * 32 + 2, j * 32 + 2, 28, 28);
          x.fillStyle = '#d9bd7c'; x.fillRect(i * 32 + 2, j * 32 + 2, 28, 3);
          x.fillStyle = '#3a2f1e'; x.fillRect(i * 32 + 8, j * 32 + 10, 16, 6); x.beginPath(); x.arc(i * 32 + 16, j * 32 + 23, 3, 0, 7); x.fill();
        }
        return tex(c, [8, 1]);
      })();
      k.panel(new THREE.MeshLambertMaterial({ map: brass }), -4.5, 1.15, 13.08, 10, 1.9, Math.PI);
      for (const x of [-9, -5, -1]) k.ball(0xfffaf0, x, 2.98, 12.1, 0.08, true);
      k.panel(new THREE.MeshLambertMaterial({ map: tex(T.text('⬆ MUSTANG GRILL', { w: 512, h: 96, bg: '#1d2b4a', color: '#f1ece0', font: 'bold 50px system-ui, sans-serif' })) }), -11.88, 2.3, 12.1, 1.4, 0.26, -Math.PI / 2);
      for (let i = 0; i < 5; i++) k.box(0x8a8a86, -11.4, i * 0.18, 12.1, 1.0, 0.18, 1.6 - i * 0.3); // bottom of the stairs
      k.solid(-12, 11.3, -10.9, 13.2);

      // ---- the Mustang Grill, upstairs (its own floor, from z = G0 on) ----
      const G0 = 24;
      const grill = mustangGrill(k, G0);
      return {
        spawn: [-5, 1.8, 0],
        rooms: [[-12, 0, 1, 11, H], [1, 0, 12, 11, H], [-12, 11, 1, 13.2, 3.0], ...grill.rooms],
        exits: [[-5, 0.6]],
        portals: [
          { x: -10.2, z: 12.1, r: 1.3, text: '⬆ Upstairs to the <b>Mustang Grill</b>', to: grill.arrive },
          { ...grill.portal, text: '⬇ Downstairs to <b>The Trough</b>', to: [-9.6, 12.1, Math.PI / 2] },
        ],
        spots: [
          { x: -2.6, z: 6.5, r: 1.4, text: '🍫 Buy a snack at <b>The Trough</b> (3 Chapel Credits)', fn: (game) => {
            if (game.save.credits < 3) { game.toast('You need 3 Chapel Credits. Go do some good deeds!'); return; }
            game.addCredits(-3); game.player.joy = Math.min(100, game.player.joy + 25); game.audio.pickup();
            game.toast(['🍫 A granola bar and a Mustang-sized iced tea. Joy +25.', '🥨 Pretzels. The cashier says "God bless." Joy +25.', '🍪 A giant cookie. You share half. That counts. Joy +25.'][Math.floor(Math.random() * 3)]);
          } },
          { x: 10.0, z: 3.6, r: 1.5, text: '📚 Browse the <b>UE</b> bookstore', fn: (game) => game.toast(['📚 You flip through a systematic theology. It is 1,300 pages. You put it back reverently.', '🧢 A navy TMU cap catches your eye. Maybe after a few more good deeds.', '📓 A leather journal. Perfect for sermon notes.'][Math.floor(Math.random() * 3)]) },
          { x: -4.5, z: 12.2, r: 1.6, text: '📬 Check your mailbox', fn: (game, it) => {
            if (it.mailT && game.t - it.mailT < 120) { game.toast('📭 Empty. You just checked!'); return; }
            it.mailT = game.t;
            const n = 10 + Math.floor(Math.random() * 3) * 5;
            game.addCredits(n); game.audio.pickup();
            game.toast([`📬 A card from Grandma with a Bible verse and a little cash. +${n} Chapel Credits`, `📬 A care package from your home church! +${n} Chapel Credits`, `📬 A letter from your sponsor kid. You get a little teary. +${n} Chapel Credits`][Math.floor(Math.random() * 3)]);
          } },
          ...grill.spots,
        ],
        light: 0xfff6e8,
      };
    },
  },

  // Powell Library: a reading room under a coffered drop ceiling with glowing panels, walls of
  // books, warm wood tables and chairs, stacks with a study carrel at the end of an aisle; and
  // the Legacy Room through the side door: dark-stained wood paneling and glass-front cases,
  // a stacked-stone wall, a balcony walkway with a wood railing, a long conference table
  library: {
    name: 'Powell Library', sub: 'Legacy Room',
    build(k) {
      const W = 20, D = 14, H = 3.2;
      k.floor(new THREE.MeshLambertMaterial({ map: tex(T.carpet('#9a8f80'), [6, 4]) }), -W / 2, 0, W / 2, D);
      k.ceiling(mat(0xf3f1ec), -W / 2, 0, W / 2, D, H);
      const wc = 0xf1ece2;
      k.wall(wc, -W / 2, 0, W / 2, 0, H, [[9, 11, 2.4]]);
      k.wall(wc, -W / 2, D, W / 2, D, H);
      k.wall(wc, -W / 2, 0, -W / 2, D, H, [[5.5, 7.5, 2.6]]);
      k.wall(wc, W / 2, 0, W / 2, D, H);
      // coffers: a lit cove round each bay of panels
      for (const [x0, x1] of [[-9, -1], [1, 9]]) {
        k.box(0xffffff, (x0 + x1) / 2, H - 0.3, 6.5, x1 - x0, 0.3, 0.2);
        for (const x of [x0 + 2, x0 + 6]) for (const z of [3, 6, 10]) k.lightPanel(x, z, H, 1.2, 0.6);
      }
      // walls of books (dark cherry)
      bookcase(k, -3.5, D - 0.25, 12, 2.5, Math.PI, { seed: 3 });
      bookcase(k, -W / 2 + 0.25, 2.6, 4.6, 2.5, Math.PI / 2, { seed: 5 });
      bookcase(k, -W / 2 + 0.25, 10.6, 6.2, 2.5, Math.PI / 2, { seed: 6 });
      // stacks: rows of double-sided shelves with a study carrel at the end of the aisle
      for (const x of [3.4, 5.6, 7.8]) { bookcase(k, x, 9.0, 5.6, 2.2, Math.PI / 2, { seed: Math.round(x * 3) }); bookcase(k, x + 0.41, 9.0, 5.6, 2.2, -Math.PI / 2, { seed: Math.round(x * 5) }); }
      k.box(0xc9a273, 6.7, 0, D - 0.4, 1.0, 0.76, 0.6, { solid: true }); k.box(0xc9a273, 6.7, 0.76, D - 0.15, 1.0, 0.7, 0.05);
      k.chair(0x5a6e5a, 6.7, D - 1.0, Math.PI);
      k.person(6.7, D - 1.0, Math.PI, { sit: 0.47, look: { skin: 0xf1c9a5, hair: 0x2b1d12, shirt: 0xf4f4f4, pants: 0x3d4f6e } });
      // reading tables
      for (const [x, z] of [[-6.5, 4.5], [-2.0, 4.5], [-6.5, 8.6], [-2.0, 8.6]]) {
        k.table(0xa8683a, x, z, 2.8, 1.2, { legs: 0x6b3a1e });
        for (const dx of [-0.9, 0, 0.9]) { k.chair(0x8a4a24, x + dx, z - 0.85, 0, { legs: 0x6b3a1e }); k.chair(0x8a4a24, x + dx, z + 0.85, Math.PI, { legs: 0x6b3a1e }); }
      }
      for (const [x, z, h] of [[-7.4, 3.65, 0], [-1.1, 5.35, Math.PI], [-5.6, 9.45, Math.PI]]) {
        k.person(x, z, h, { sit: 0.47 });
        k.box(0xf1ece0, x, 0.76, z + (h ? -0.45 : 0.45), 0.35, 0.03, 0.25);
      }
      // circulation desk by the door
      k.box(0x6b3a1e, 6.2, 0, 2.0, 3.0, 1.05, 0.8, { solid: true });
      k.box(0x3a2a1e, 6.2, 1.05, 2.0, 3.1, 0.05, 0.9);
      k.box(0x1b1b1b, 6.6, 1.1, 2.15, 0.45, 0.32, 0.03);
      k.person(6.2, 2.9, Math.PI, { look: { skin: 0xe0ac84, hair: 0x8a8a8a, shirt: 0x7a1f2b, pants: 0x2b2f3a, longHair: true } });
      for (const x of [-8, -4]) k.window(x, 0.9, 0.12, 2.4, 1.6, 0, 0x3a2a1e, 3);
      // ---- the Legacy Room ----
      const L0 = -W / 2 - 11, L1 = -W / 2, LZ0 = 1.5, LZ1 = 12.5, LH = 6.4;
      const walnut = 0x4a2e1c;
      k.floor(new THREE.MeshLambertMaterial({ map: tex(T.carpet('#7d7466', 12), [3, 3]) }), L0, LZ0, L1, LZ1);
      k.ceiling(mat(0xe9dcc4), L0, LZ0, L1, LZ1, LH);
      k.wall(walnut, L0, LZ0, L1, LZ0, LH);
      k.wall(walnut, L0, LZ1, L1, LZ1, LH);
      k.wall(walnut, L0, LZ0, L0, LZ1, LH);
      k.panel(new THREE.MeshLambertMaterial({ map: tex(T.ledger(12), [2.5, 3]) }), L0 + 0.11, LH / 2, (LZ0 + LZ1) / 2, LZ1 - LZ0, LH, Math.PI / 2);
      for (let x = L0 + 1.5; x < L1; x += 2.5) k.box(0x3a2216, x, LH - 0.4, (LZ0 + LZ1) / 2, 0.25, 0.4, LZ1 - LZ0);
      // glass-front cases and bookcases in dark wood, two tall windows
      for (const x of [L0 + 2.2, L0 + 5.0, L0 + 8.4]) {
        bookcase(k, x, LZ1 - 0.25, 2.2, 2.8, Math.PI, { frame: '#3a2216', back: '#24150c', color: 0x3a2216, seed: Math.round(-x) });
        k.panel(new THREE.MeshLambertMaterial({ color: 0xcfe0e8, transparent: true, opacity: 0.18 }), x, 1.4, LZ1 - 0.47, 2.1, 2.7, Math.PI);
      }
      k.window(L0 + 3.6, 1.0, LZ0 + 0.12, 1.2, 3.6, 0, 0x3a2216, 2);
      k.window(L0 + 7.6, 1.0, LZ0 + 0.12, 1.2, 3.6, 0, 0x3a2216, 2);
      // the balcony walkway along the back and stone walls, with a wood railing
      k.box(0x3a2216, (L0 + L1) / 2, 3.2, LZ1 - 0.8, L1 - L0, 0.25, 1.6);
      for (let x = L0 + 0.3; x < L1; x += 0.25) k.box(0x5a3a24, x, 3.45, LZ1 - 1.6, 0.05, 0.9, 0.05);
      k.box(0x5a3a24, (L0 + L1) / 2, 4.35, LZ1 - 1.6, L1 - L0, 0.1, 0.14);
      bookcase(k, (L0 + L1) / 2, LZ1 - 0.25, L1 - L0 - 0.4, 2.6, Math.PI, { frame: '#3a2216', back: '#24150c', color: 0x3a2216, seed: 77 }).position.y = 4.75;
      // the long conference table with leather chairs, a horse bronze on it; the TV with the crest
      const tz = (LZ0 + LZ1) / 2 - 0.8, tx = (L0 + L1) / 2;
      k.table(0x8a5a32, tx, tz, 5.6, 1.5, { legs: 0x3a2216 });
      for (let i = 0; i < 5; i++) { const x = tx - 2.2 + i * 1.1; k.chair(0x2a1e18, x, tz - 1.0, 0, { seat: 0.5 }); k.chair(0x2a1e18, x, tz + 1.0, Math.PI, { seat: 0.5 }); }
      k.box(0x3a2a1e, tx, 0.76, tz, 0.3, 0.3, 0.12);
      k.box(0x111111, L0 + 0.3, 1.2, tz, 0.08, 1.0, 1.7);
      k.panel(new THREE.MeshBasicMaterial({ map: tex(T.text([{ t: '✝', font: 'bold 60px serif' }, "THE MASTER'S", { t: 'UNIVERSITY', font: 'bold 30px Georgia, serif' }], { w: 320, h: 192, bg: '#3b2f8a', font: 'bold 40px Georgia, serif' })) }), L0 + 0.35, 1.7, tz, 1.6, 0.9, -Math.PI / 2);
      const chand = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.15, 0.45, 8, 1, true), new THREE.MeshLambertMaterial({ color: 0xf0d8a0, emissive: 0xc08a3a, emissiveIntensity: 0.6, side: THREE.DoubleSide }));
      chand.position.set(tx, 3.6, tz); k.scene.add(chand); k.box(0x222222, tx, 3.8, tz, 0.02, LH - 3.8, 0.02);
      for (const dx of [-1.8, 1.8]) k.pendant(tx + dx, tz, LH, 2.8, 0xf0d8a0);
      return {
        spawn: [10, 1.8, 0],
        rooms: [[-W / 2, 0, W / 2, D, H], [L0, LZ0, L1, LZ1, 5.8]],
        exits: [[10, 0.6]],
        spots: [
          { x: -2.0, z: 3.0, r: 1.6, text: '📖 Sit and read for a while', fn: (game) => { game.time += 3600; game.player.joy = Math.min(100, game.player.joy + 30); game.toast(['📖 An hour in Romans. Time well spent. Joy +30.', '📖 You finish your Church History reading. Mostly. Joy +30.', '📖 You read the same paragraph of Calvin four times. Still worth it. Joy +30.'][Math.floor(Math.random() * 3)]); } },
          { x: 6.2, z: 3.4, r: 1.3, text: '📚 Return a book (it was overdue)', fn: (game) => { game.toast('📚 The librarian smiles and waives the fine. Grace! +5 Chapel Credits'); game.addCredits(5); game.audio.pickup(); } },
          { x: L0 + 5.0, z: LZ1 - 1.4, r: 1.6, text: '🏛️ Look at the display cases', fn: (game) => game.toast(['🏛️ Old Bibles and letters from the school\'s early years, behind glass.', '🏛️ Yearbooks, photos and keepsakes from decades of Mustangs.', '🏛️ A worn study Bible, its margins full of notes. Somebody really read this.'][Math.floor(Math.random() * 3)]) },
        ],
        light: 0xfff4e2,
      };
    },
  },

  // The ImpactOrtho Fitness Center: black rubber floor, white power racks with black bumper
  // plates on wood lifting platforms, benches, dumbbells under a mirror wall, a white truss rig
  // with med balls, drop ceiling with long light panels, the school name across the wall
  kinesiology: {
    name: 'ImpactOrtho Fitness Center',
    build(k) {
      const W = 22, D = 14, H = 3.2;
      k.floor(new THREE.MeshLambertMaterial({ map: tex(T.carpet('#2a2c30', 22), [6, 4]) }), -W / 2, 0, W / 2, D);
      k.ceiling(mat(0xe6e6e2), -W / 2, 0, W / 2, D, H);
      for (let x = -8; x <= 8; x += 4) for (const z of [2.5, 6, 9.5, 12.5]) k.lightPanel(x, z, H, 1.6, 0.5);
      const wc = 0xeeeeea;
      k.wall(wc, -W / 2, 0, W / 2, 0, H, [[1.5, 3.5, 2.4]]);
      k.wall(wc, -W / 2, D, W / 2, D, H);
      k.wall(wc, -W / 2, 0, -W / 2, D, H);
      k.wall(wc, W / 2, 0, W / 2, D, H);
      k.panel(new THREE.MeshLambertMaterial({ color: 0x9fa3a6 }), W / 2 - 0.11, 0.5, D / 2, D, 1.0, -Math.PI / 2);
      k.panel(new THREE.MeshLambertMaterial({ map: tex(T.text("THE MASTER'S UNIVERSITY  ✝  FOR CHRIST", { w: 1024, h: 96, color: '#1b1b1b', font: 'bold 64px "Arial Black", Impact, sans-serif' })), transparent: true }), 2, 2.6, D - 0.12, 9, 0.6, 0);
      // mirror wall over the dumbbell rack
      k.panel(new THREE.MeshLambertMaterial({ color: 0xc9d6dc, emissive: 0x303a40 }), -W / 2 + 0.12, 1.5, 7, 8, 1.6, Math.PI / 2);
      k.box(0x1b1b1b, -W / 2 + 0.6, 0, 7, 0.7, 0.75, 6, { solid: true });
      for (let i = 0; i < 14; i++) { const z = 4.3 + i * 0.4; for (const y of [0.45, 0.8]) { const d = k.box(0x2a2a2a, -W / 2 + 0.6, y, z, 0.12, 0.12, 0.34); d.rotation.x = Math.PI / 2; } }
      // power racks on lifting platforms, in two rows
      const plates = (x, y, z) => { for (const dx of [-0.95, 0.95]) { const p = new THREE.Mesh(GEOM.cyl, mat(0x111111)); p.scale.set(0.45, 0.06, 0.45); p.rotation.z = Math.PI / 2; p.position.set(x + dx, y, z); k.scene.add(p); } k.box(0x9a9a9a, x, y - 0.015, z, 2.2, 0.03, 0.03); };
      for (const x of [-6, -2, 2, 6]) for (const z of [4, 10]) {
        k.box(0xb88a5a, x, 0, z, 2.6, 0.03, 2.6); // wood platform
        for (const dx of [-0.6, 0.6]) for (const dz of [-0.5, 0.5]) k.box(0xf4f4f2, x + dx, 0, z + dz, 0.08, 2.3, 0.08);
        for (const dz of [-0.5, 0.5]) k.box(0xf4f4f2, x, 2.25, z + dz, 1.3, 0.08, 0.08);
        for (const dx of [-0.6, 0.6]) k.box(0xf4f4f2, x + dx, 2.25, z, 0.08, 0.08, 1.0);
        plates(x, 1.35, z - 0.4);
        k.box(0x2a2a2a, x, 0.35, z + 0.1, 0.35, 0.08, 1.3); // bench
        k.box(0xf4f4f2, x, 0, z + 0.1, 0.08, 0.35, 1.0);
        k.solid(x - 0.75, z - 0.6, x + 0.75, z + 0.6);
      }
      // the white truss rig with med balls along the right
      for (const z of [3, 7, 11]) k.box(0xf4f4f2, 8.8, 0, z, 0.12, 2.7, 0.12, { solid: true });
      k.box(0xf4f4f2, 8.8, 2.6, 7, 0.12, 0.12, 8.2);
      for (let i = 0; i < 6; i++) k.ball([0x2b6cb0, 0xc9372c, 0xe8b923, 0x3f8f4a][i % 4], 9.6, 0.25 + (i % 2) * 0.5, 3.8 + Math.floor(i / 2) * 1.6, 0.22);
      // lifters
      k.person(-2, 4.6, Math.PI, { pose: (p) => { p.armL.rotation.x = p.armR.rotation.x = -3.0; } });
      k.person(6, 10.4, Math.PI, { pose: (p) => { p.armL.rotation.x = p.armR.rotation.x = -0.4; } });
      k.person(-W / 2 + 1.6, 6.0, -Math.PI / 2, { pose: (p) => { p.armR.rotation.x = -1.6; } });
      for (const x of [-7, 7]) k.window(x, 1.2, 0.12, 2.2, 1.2, 0, 0x3a3a3a, 2);
      return {
        spawn: [2.5, 1.8, 0],
        rooms: [[-W / 2, 0, W / 2, D, H]],
        exits: [[2.5, 0.6]],
        spots: [
          { x: 2, z: 5.4, r: 1.4, text: '🏋️ Lift', fn: (game) => { game.player.joy = Math.min(100, game.player.joy + 20); game.audio.hit(); game.toast(['🏋️ Three sets of five. Your body is a temple, and the temple is getting renovated. Joy +20.', '🏋️ New PR! A football guy yells "LET\'S GO!" Joy +20.', '🏋️ You spot a friend and quote Philippians 4:13. In context, mostly. Joy +20.'][Math.floor(Math.random() * 3)]); } },
        ],
        light: 0xf4f8ff,
      };
    },
  },

  // The MRH recital hall in the Plew music building: gray acoustic panels between maroon
  // pillars, a speckled gray floor, curved choir risers, the black grand piano, rows of black
  // chairs and music stands, and the recording booth window up in the wall
  music: {
    name: 'MRH Recital Hall', sub: 'Plew School of Music',
    build(k) {
      const W = 18, D = 15, H = 7;
      k.floor(new THREE.MeshLambertMaterial({ map: tex(T.mottled('#bdb8b0', 0.08, 13), [5, 4]) }), -W / 2, 0, W / 2, D);
      k.ceiling(mat(0x1a1a1c), -W / 2, 0, W / 2, D, H);
      const panels = (() => { const [c, x] = canvas(128, 256); x.fillStyle = '#c8c7c3'; x.fillRect(0, 0, 128, 256); x.fillStyle = 'rgba(0,0,0,0.12)'; x.fillRect(0, 0, 3, 256); x.fillRect(64, 0, 2, 256); x.fillRect(0, 128, 128, 2); return tex(c, [6, 1]); })();
      k.wall(0x2a2a2c, -W / 2, 0, W / 2, 0, H, [[8, 10, 2.5]]);
      k.wall(0xc8c7c3, -W / 2, D, W / 2, D, H);
      k.wall(0xc8c7c3, -W / 2, 0, -W / 2, D, H);
      k.wall(0xc8c7c3, W / 2, 0, W / 2, D, H);
      for (const [x, z, w, rot] of [[0, D - 0.11, W, Math.PI], [-W / 2 + 0.11, D / 2, D, Math.PI / 2], [W / 2 - 0.11, D / 2, D, -Math.PI / 2]]) k.panel(new THREE.MeshLambertMaterial({ map: panels }), x, 2.6, z, w, 5.2, rot);
      for (let x = -W / 2 + 1; x < W / 2; x += 3.2) k.box(0x6e2a22, x, 0, D - 0.3, 0.7, H, 0.4);
      for (let z = 2; z < D; z += 3.2) { k.box(0x6e2a22, -W / 2 + 0.3, 0, z, 0.4, H, 0.7); k.box(0x6e2a22, W / 2 - 0.3, 0, z, 0.4, H, 0.7); }
      for (let x = -6; x <= 6; x += 3) for (const z of [4, 8, 12]) { k.box(0x111111, x, H - 0.4, z, 0.3, 0.3, 0.3); k.ball(0xfff4dc, x, H - 0.45, z, 0.1, true); }
      // curved choir risers in three steps
      for (let t = 0; t < 3; t++) {
        const R = 5.2 + t * 0.9;
        for (let a = -0.9; a <= 0.9; a += 0.15) {
          const x = Math.sin(a) * R, z = 13.6 - (R - Math.cos(a) * R) - 0.3 * 0 + (t * 0);
          k.box(0x8e8e8c, x, 0, z - (2 - t) * 0.0, 0.95, 0.22 * (t + 1), 0.9, { rot: a });
        }
      }
      k.solid(-5.5, 10.6, 5.5, 14.4);
      // the grand piano and bench
      const px = 3.6, pz = 7.4;
      k.box(0x0d0d0d, px, 0.65, pz, 1.5, 0.32, 2.2, { rot: -0.4, solid: true });
      const lid = k.box(0x0d0d0d, px + 0.2, 0.98, pz, 1.4, 0.03, 2.0, { rot: -0.4 }); lid.rotation.z = -0.5;
      k.box(0xf4f2ee, px - 0.55, 0.9, pz - 0.95, 1.2, 0.04, 0.18, { rot: -0.4 });
      for (const [dx, dz] of [[-0.5, -0.8], [0.5, -0.6], [0.2, 0.9]]) k.box(0x0d0d0d, px + dx, 0, pz + dz, 0.1, 0.65, 0.1);
      k.box(0x0d0d0d, px - 0.95, 0, pz - 1.55, 0.8, 0.5, 0.35, { rot: -0.4 });
      // rows of black chairs and music stands
      for (let row = 0; row < 3; row++) for (let i = -4; i <= 1; i++) {
        const x = i * 1.3 - 1.0, z = 3.6 + row * 1.5;
        k.chair(0x1b1b1b, x, z, 0);
        k.box(0x1b1b1b, x, 0, z + 0.55, 0.03, 1.1, 0.03);
        k.box(0x1b1b1b, x, 1.1, z + 0.55, 0.5, 0.35, 0.03, { rot: 0 }).rotation.x = -0.3;
      }
      k.solid(-6.8, 3.2, 1.0, 7.0);
      // the recording booth window, up in the side wall
      k.box(0x111111, -W / 2 + 0.12, 3.2, 7.5, 0.1, 1.4, 3.4);
      k.panel(new THREE.MeshBasicMaterial({ color: 0x3a4a55 }), -W / 2 + 0.2, 3.9, 7.5, 3.2, 1.2, Math.PI / 2);
      // the choir rehearsing
      for (let i = 0; i < 9; i++) { const a = -0.7 + i * 0.175, R = 6.1; const pp = k.person(Math.sin(a) * R, 13.3 - (R - Math.cos(a) * R), Math.PI + a, {}); pp.position.y = 0.44; k.solids.pop(); }
      return {
        spawn: [9, 1.8, 0],
        rooms: [[-W / 2, 0, W / 2, D, H]],
        exits: [[9, 0.6]],
        spots: [{ x: px - 1.1, z: pz - 1.9, r: 1.3, text: '🎹 Play the piano', fn: (game) => {
          // The Doxology (OLD HUNDREDTH): "Praise God, from whom all blessings flow"
          const N = { G4: 392, Fs4: 370, E4: 330, D4: 294, A4: 440, B4: 494, C5: 523 };
          const tune = [['G4', 1], ['G4', 1], ['Fs4', 1], ['E4', 1], ['D4', 2], ['G4', 1], ['A4', 1], ['B4', 2], ['B4', 1], ['B4', 1], ['A4', 1], ['G4', 1], ['C5', 1], ['B4', 1], ['A4', 2]];
          let t = 0;
          for (const [n, d] of tune) { game.audio.tone(N[n], d * 0.42, 'triangle', 0.22, t); game.audio.tone(N[n] / 2, d * 0.42, 'sine', 0.1, t); t += d * 0.45; }
          game.player.joy = 100;
          game.toast('🎹 You play the Doxology. The choir joins in. Joy restored.');
        } }],
        light: 0xfff2e0,
      };
    },
  },

  // Dorm lounges, each from its own photos
  hotchkiss: {
    name: 'Hotchkiss Hall', sub: 'Lounge',
    build: (k) => lounge(k, {
      floor: '#3e3129', seed: 7, fire: [5.7, 4.5, -Math.PI / 2], bench: [0, 8.65, 5, Math.PI],
      windows: [[-3.5, 0.9, 8.88, 1.8, 1.4, Math.PI, 0x1b1b1b, 2], [3.5, 0.9, 8.88, 1.8, 1.4, Math.PI, 0x1b1b1b, 2]],
      sofa: 0x8a8f96, sofas: [[3.0, 3.0, -Math.PI / 2, 2.2], [0.5, 5.0, Math.PI, 2.2]], dining: [-3.5, 3.5],
      people: [[0.5, 4.6, Math.PI, 0.47], [-3.5, 4.25, Math.PI, 0.47]],
    }),
  },
  dixon: {
    name: 'Dixon Hall', sub: 'Lounge',
    build: (k) => lounge(k, {
      floor: '#4a3a30', seed: 9, xo: true, fire: [1.5, 8.7, Math.PI], bench: [5.7, 4.5, 6, -Math.PI / 2],
      shelves: [[-0.4, 8.7, Math.PI], [3.4, 8.7, Math.PI]], ice: [-4.6, 8.4],
      windows: [[-5.88, 0.9, 2.5, 2.0, 1.5, Math.PI / 2, 0x6b5a4a, 2]],
      sofa: 0x9a9a92, sofas: [[1.5, 5.6, Math.PI, 2.4]], dining: [-2.5, 3.0],
      people: [[1.1, 5.2, Math.PI, 0.47], [1.9, 5.2, Math.PI, 0.47], [-2.5, 2.25, 0, 0.47]],
      room: { wood: 0x6b4a33, floor: '#8a7560', seed: 2 },
    }),
  },
  waldock: {
    name: 'Waldock Hall', sub: 'Lounge',
    build: (k) => lounge(k, {
      carpet: '#5b6470', wall: 0xefede6, wainscot: 0xd8d4ca, seed: 4, fire: [-3.5, 8.7, Math.PI],
      windows: [[0, 0.9, 8.88, 1.6, 2.0, Math.PI, 0x2a2a2a, 2], [2.4, 0.6, 8.88, 2.2, 2.0, Math.PI, 0x2a2a2a, 2], [5.88, 0.6, 3.0, 2.6, 2.0, -Math.PI / 2, 0x2a2a2a, 2], [5.88, 0.6, 6.0, 2.6, 2.0, -Math.PI / 2, 0x2a2a2a, 2]],
      sofa: 0x2c3e66, sofas: [[-3.2, 3.6, Math.PI / 2, 2.2], [0, 6.4, Math.PI, 2.2], [2.6, 3.6, -Math.PI / 2, 2.2]],
      rug: [[-0.3, 3.8], 0x8a2a2a, 0xc9b48a], dining: [3.4, 7.2],
      people: [[0, 6.0, Math.PI, 0.47], [2.2, 3.6, -Math.PI / 2, 0.47]],
      room: { wood: 0xc9945a, floor: '#7a6a5a', seed: 3 },
    }),
  },
});

// ---------- the interior runtime ----------

export class Interior {
  constructor(game, id, door) {
    this.game = game;
    this.id = id;
    this.def = INTERIORS[id];
    this.name = this.def.name;
    this.door = door; // { x, z, heading } outside, in world space
    this.built = false;
  }

  build() {
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x1a1a1a);
    const k = new Kit(scene);
    this.kit = k;
    const info = this.def.build(k, this.game);
    k.flush();
    this.info = info;
    scene.add(new THREE.HemisphereLight(info.light || 0xffffff, 0x8a7a6a, 2.3));
    const sun = new THREE.DirectionalLight(0xffffff, 0.9);
    sun.position.set(3, 10, -4);
    scene.add(sun);
    this.scene = scene;
    this.built = true;
  }

  enter() {
    if (!this.built) this.build();
    const p = this.game.player;
    const [x, z, h] = this.info.spawn;
    this.x = x; this.z = z; this.heading = h; this.speed = 0; this.phase = 0;
    this.scene.add(p.mesh);
    p.mesh.visible = true;
    this.room = this.roomAt(x, z) || this.info.rooms[0];
    this.camPos = new THREE.Vector3();
    this.snapCamera();
    this.shots = [];
  }

  leave() {
    this.game.scene.add(this.game.player.mesh);
    for (const s of this.shots) s.ball.position.y = -10;
  }

  roomAt(x, z) {
    for (const r of this.info.rooms) if (x > r[0] && x < r[2] && z > r[1] && z < r[3]) return r;
    return null;
  }

  blocked(x, z, rad) {
    for (const s of this.kit.solids) if (x > s[0] - rad && x < s[2] + rad && z > s[1] - rad && z < s[3] + rad) return true;
    return false;
  }

  // Push a circle out of every solid footprint
  resolve(x, z, rad) {
    for (let it = 0; it < 3; it++) {
      for (const s of this.kit.solids) {
        if (x <= s[0] - rad || x >= s[2] + rad || z <= s[1] - rad || z >= s[3] + rad) continue;
        const dl = x - (s[0] - rad), dr = s[2] + rad - x, dn = z - (s[1] - rad), df = s[3] + rad - z;
        const m = Math.min(dl, dr, dn, df);
        if (m === dl) x = s[0] - rad; else if (m === dr) x = s[2] + rad; else if (m === dn) z = s[1] - rad; else z = s[3] + rad;
      }
    }
    return [x, z];
  }

  interaction() {
    const near = (q) => Math.hypot(q.x - this.x, q.z - this.z) < (q.r || 1.4);
    for (const [ex, ez] of this.info.exits) if (Math.hypot(ex - this.x, ez - this.z) < 1.6) return { text: `🚪 Leave <b>${this.name}</b>`, fn: () => this.game.leaveInterior() };
    for (const pt of this.info.portals || []) if (near(pt)) return { text: pt.text, fn: () => { this.x = pt.to[0]; this.z = pt.to[1]; this.heading = pt.to[2]; this.speed = 0; this.room = this.roomAt(this.x, this.z) || this.room; this.snapCamera(); } };
    for (const s of this.info.spots) if (near(s)) return { text: s.text, fn: () => s.fn(this.game, this) };
    return null;
  }

  update(dt) {
    const g = this.game, inp = g.input, p = g.player;
    g.time += dt * 6;
    g.save.playTime += dt;
    const it = this.interaction();
    g.hud.setPrompt(it ? it.text : null);
    if (it && inp.wasPressed('action')) it.fn();
    if (inp.wasPressed('camera')) g.camFar = !g.camFar;
    if (!this.inside) return; // left through the door just now

    const sprint = inp.isDown('sprint');
    this.heading -= inp.turn * 3.0 * dt;
    const target = inp.forward * (inp.forward < 0 ? 2.2 : sprint ? 6 : 3.8);
    this.speed += (target - this.speed) * Math.min(1, dt * 10);
    [this.x, this.z] = this.resolve(this.x + Math.sin(this.heading) * this.speed * dt, this.z + Math.cos(this.heading) * this.speed * dt, 0.32);
    this.room = this.roomAt(this.x, this.z) || this.room;
    this.phase += Math.abs(this.speed) * dt * 2.4;
    animatePerson(p.mesh, this.phase, clamp(Math.abs(this.speed) / 4, 0, 1.2), {});
    p.mesh.position.set(this.x, 0, this.z);
    p.mesh.rotation.y = this.heading;
    if (p.joy < 100) p.joy = Math.min(100, p.joy + 3 * dt);
    if (inp.wasPressed('throw')) g.toast(['📖 Indoors? Put the Bible down. Read it instead.', '📖 Not in here. There are no imps indoors (you checked).', '📖 Indoor Bible-throwing voice, please.'][Math.floor(Math.random() * 3)]);

    for (const s of this.shots) this.updateShot(s, dt);
    for (const a of this.kit.anim) a(dt, g.t);

    const k = 1 - Math.exp(-dt * 6);
    const [tx, ty, tz] = this.camTarget();
    this.camPos.x = lerp(this.camPos.x, tx, k);
    this.camPos.z = lerp(this.camPos.z, tz, k);
    this.camPos.y = lerp(this.camPos.y, ty, k);
    this.aimCamera();
    g.hud.update();
  }

  // Camera: behind and above, kept inside the room you're in
  camTarget() {
    const r = this.room, far = this.game.camFar ? 1.5 : 1;
    const dist = 4.2 * far, height = Math.min(r[4] - 0.4, 2.5 * far);
    const fx = Math.sin(this.heading), fz = Math.cos(this.heading);
    const tx = clamp(this.x - fx * dist, r[0] + 0.35, r[2] - 0.35), tz = clamp(this.z - fz * dist, r[1] + 0.35, r[3] - 0.35);
    // Backed up against a wall: rise and look down over the shoulder instead
    const short = Math.max(0, dist - Math.hypot(tx - this.x, tz - this.z));
    return [tx, Math.min(r[4] - 0.3, height + short * 0.7), tz];
  }

  aimCamera() {
    const cam = this.game.camera;
    cam.position.copy(this.camPos);
    cam.lookAt(this.x + Math.sin(this.heading) * 2, 1.3, this.z + Math.cos(this.heading) * 2);
  }

  snapCamera() {
    this.camPos.set(...this.camTarget());
    this.aimCamera();
  }

  get inside() { return this.game.interior === this; }

  // ---- things to do ----

  // A free throw at Bross Court: the ball arcs to the rim; most of them go in
  shoot(ball, hoop) {
    if (this.shots.some((s) => s.t < 1.4)) return;
    const make = Math.random() < 0.62;
    const sx = this.x, sz = this.z;
    this.heading = Math.atan2(hoop.x - sx, hoop.z - sz);
    const miss = make ? [0, 0] : [(Math.random() - 0.5) * 0.7, (Math.random() < 0.5 ? -1 : 1) * (0.25 + Math.random() * 0.2)];
    this.shots = [{ ball, t: 0, from: [sx, 2.1, sz], to: [hoop.x + miss[1] * hoop.sgn, hoop.y + 0.1, hoop.z + miss[0]], make, done: false }];
    this.game.audio.throw();
  }

  updateShot(s, dt) {
    s.t += dt;
    const T1 = 1.05;
    if (s.t < T1) {
      const u = s.t / T1;
      s.ball.position.set(lerp(s.from[0], s.to[0], u), lerp(s.from[1], s.to[1], u) + Math.sin(u * Math.PI) * 2.0, lerp(s.from[2], s.to[2], u));
    } else if (s.t < 1.8) {
      const u = s.t - T1;
      if (s.make) s.ball.position.set(s.to[0], s.to[1] - u * 4, s.to[2]);
      else s.ball.position.set(s.to[0] + (s.to[0] - s.from[0]) * 0.08 * u * 3, s.to[1] + 1.2 * u - 5 * u * u, s.to[2] + (s.to[2] - s.from[2] || 1) * 0.1 * u * 3);
      if (!s.done) {
        s.done = true;
        const g = this.game;
        if (s.make) { g.addCredits(5); g.audio.pickup(); g.toast(['🏀 Swish! Nothing but net. +5 Chapel Credits', '🏀 Bottom of the net. The bleachers go "OHHH." +5', '🏀 Got it! Coach would be proud. +5'][Math.floor(Math.random() * 3)]); }
        else { g.audio.bump(); g.toast(['🏀 Clank. Off the back iron.', '🏀 In and out. So close.', '🏀 Brick. Bend your knees!'][Math.floor(Math.random() * 3)]); }
      }
    } else s.ball.position.y = -10;
  }
}
