// Trophy Coffee: a modern-farmhouse coffee shop front on the south end of the MacArthur
// Center. White board-and-batten siding, black steel windows looking into a warm, lit cafe
// (counter, espresso machine, pastry case, chalk menus, pendant lights), a flat steel awning
// on tie rods, gooseneck barn lamps over the sign, and a patio with farm tables, market
// umbrellas, bistro tables, planters and string lights.
import * as THREE from 'three';
import { heightAtCampus } from './terrain.js';
import { mat, GEOM } from './models.js';

const BLACK = 0x1b1b1b, WOOD = 0x9a7350, CREAM = 0xefe8d8, OLIVE = 0x8a9a6a;

function canvasTex(c, repeat) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(...repeat); }
  return t;
}

// One meter of white board-and-batten siding
function sidingTexture(w, h) {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 128;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#f3f1eb'; ctx.fillRect(0, 0, 128, 128);
  for (let x = 0; x < 128; x += 51.2) {
    ctx.fillStyle = 'rgba(0,0,0,0.10)'; ctx.fillRect(x + 7, 0, 3, 128); // shadow beside the batten
    ctx.fillStyle = '#fbfaf6'; ctx.fillRect(x, 0, 7, 128);
  }
  return canvasTex(c, [w, h]);
}

// The lit cafe seen through the windows: spans 8.8 m x 3.0 m of storefront
function interiorTexture() {
  const W = 1024, H = 350, m = W / 8.8;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  const Y = (h) => H - h * m; // meters above the ground -> canvas y
  // Back wall: warm white shiplap, a wood-plank accent wall in the middle
  ctx.fillStyle = '#efe3cf'; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = 'rgba(120,90,60,0.12)';
  for (let y = 4; y < H; y += 14) ctx.fillRect(0, y, W, 1.5);
  ctx.fillStyle = '#b48a63'; ctx.fillRect(330, 0, 360, Y(1.0));
  for (let y = 0; y < Y(1.0); y += 18) { ctx.fillStyle = `rgba(60,35,15,${0.12 + ((y * 7) % 5) * 0.03})`; ctx.fillRect(330, y, 360, 2); }
  // Chalk menu boards
  for (const [x, w] of [[350, 100], [460, 100], [570, 100]]) {
    ctx.fillStyle = '#202322'; ctx.fillRect(x, 40, w, 92);
    ctx.strokeStyle = '#7a5a3a'; ctx.lineWidth = 4; ctx.strokeRect(x, 40, w, 92);
    ctx.fillStyle = 'rgba(240,240,235,0.85)';
    ctx.font = 'bold 13px Georgia, serif'; ctx.textAlign = 'center';
    ctx.fillText(['ESPRESSO', 'COLD BREW', 'BAKERY'][(x - 350) / 110], x + w / 2, 58);
    for (let k = 0; k < 5; k++) ctx.fillRect(x + 10, 70 + k * 11, w - 34 - ((k * 13) % 20), 2.5);
  }
  // Shelves with coffee bags and plants on the left and right walls
  for (const sx of [40, 800]) {
    for (let k = 0; k < 3; k++) {
      const y = 70 + k * 55;
      ctx.fillStyle = '#7a5434'; ctx.fillRect(sx, y, 160, 6);
      for (let b = 0; b < 6; b++) {
        ctx.fillStyle = ['#2b2b2b', '#c9a227', '#f1ece0', '#2b2b2b', '#8a5a3a', '#f1ece0'][(b + k) % 6];
        ctx.fillRect(sx + 8 + b * 25, y - 30, 18, 30);
      }
    }
    ctx.fillStyle = '#5f7f45'; ctx.beginPath(); ctx.arc(sx + 140, 40, 18, 0, Math.PI * 2); ctx.fill();
  }
  // Pendant lights: black cords and dome shades with glowing bulbs
  for (let k = 0; k < 6; k++) {
    const x = 150 + k * 145;
    ctx.fillStyle = '#111'; ctx.fillRect(x - 1, 0, 2, 28);
    const g = ctx.createRadialGradient(x, 40, 0, x, 40, 60);
    g.addColorStop(0, 'rgba(255,220,150,0.9)'); g.addColorStop(1, 'rgba(255,200,120,0)');
    ctx.fillStyle = g; ctx.fillRect(x - 60, 0, 120, 110);
    ctx.fillStyle = '#151515'; ctx.beginPath(); ctx.moveTo(x - 18, 40); ctx.quadraticCurveTo(x, 18, x + 18, 40); ctx.fill();
    ctx.fillStyle = '#fff1c4'; ctx.beginPath(); ctx.arc(x, 42, 5, 0, Math.PI * 2); ctx.fill();
  }
  // Barista behind the counter, a customer in front of it
  const person = (x, top, shirt, apron) => {
    ctx.fillStyle = '#c99a7a'; ctx.beginPath(); ctx.arc(x, top + 14, 13, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#3a2a1e'; ctx.beginPath(); ctx.arc(x, top + 9, 13, Math.PI, 0); ctx.fill();
    ctx.fillStyle = shirt; ctx.fillRect(x - 20, top + 28, 40, 90);
    if (apron) { ctx.fillStyle = apron; ctx.fillRect(x - 15, top + 45, 30, 73); }
  };
  person(520, Y(1.95), '#f1ece0', '#222');
  // Counter: white quartz top on a wood front, with the espresso machine and pastry case
  ctx.fillStyle = '#7d5638'; ctx.fillRect(170, Y(1.05), 680, Y(0.25) - Y(1.05));
  for (let x = 170; x < 850; x += 22) { ctx.fillStyle = 'rgba(40,20,5,0.18)'; ctx.fillRect(x, Y(1.05), 2, Y(0.25) - Y(1.05)); }
  ctx.fillStyle = '#f6f4ee'; ctx.fillRect(160, Y(1.12), 700, 9);
  ctx.fillStyle = '#c8ccd0'; ctx.fillRect(250, Y(1.6), 120, Y(1.12) - Y(1.6)); // espresso machine
  ctx.fillStyle = '#2b2b2b'; ctx.fillRect(250, Y(1.6), 120, 10); ctx.fillRect(262, Y(1.3), 96, 8);
  ctx.fillStyle = '#e2e6ea'; for (const x of [275, 305, 335]) ctx.fillRect(x, Y(1.3) + 8, 8, 14);
  ctx.fillStyle = '#2b2b2b'; ctx.fillRect(400, Y(1.55), 26, Y(1.12) - Y(1.55)); // grinder
  ctx.fillStyle = 'rgba(210,235,245,0.55)'; ctx.fillRect(610, Y(1.5), 150, Y(1.12) - Y(1.5)); // pastry case
  for (let k = 0; k < 6; k++) { ctx.fillStyle = ['#d49a4a', '#b5652f', '#e8c27a'][k % 3]; ctx.beginPath(); ctx.ellipse(630 + k * 22, Y(1.25), 9, 6, 0, 0, Math.PI * 2); ctx.fill(); }
  ctx.fillStyle = '#2b2b2b'; ctx.fillRect(790, Y(1.38), 34, Y(1.12) - Y(1.38)); // register
  person(880, Y(1.8), '#2f5d8a');
  // Dark wood floor
  ctx.fillStyle = '#5a3f2b'; ctx.fillRect(0, Y(0.25), W, H);
  // Glass: a cool sky reflection at the top and a couple of diagonal glints
  const sky = ctx.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0, 'rgba(170,200,225,0.35)'); sky.addColorStop(0.5, 'rgba(170,200,225,0.08)'); sky.addColorStop(1, 'rgba(170,200,225,0.0)');
  ctx.fillStyle = sky; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = 'rgba(255,255,255,0.13)';
  for (const x of [120, 470, 760]) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x + 70, 0); ctx.lineTo(x - 60, H); ctx.lineTo(x - 130, H); ctx.fill(); }
  // Knee wall under the side windows (the door goes to the ground)
  ctx.fillStyle = '#26292b'; ctx.fillRect(0, Y(0.45), 395, H); ctx.fillRect(629, Y(0.45), W, H);
  // Hours and logo decals on the door glass
  ctx.fillStyle = 'rgba(245,240,230,0.9)'; ctx.font = 'bold 15px Georgia, serif'; ctx.textAlign = 'center';
  ctx.fillText('TROPHY COFFEE', 512, Y(1.55));
  ctx.font = '12px system-ui, sans-serif';
  ctx.fillText('MON–SAT 7AM–10PM · SUN 3–10PM', 512, Y(1.4));
  return canvasTex(c);
}

function signTexture() {
  const c = document.createElement('canvas');
  c.width = 1024; c.height = 220;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, 1024, 220);
  // Black cut-metal letters with a little trophy cup, mounted straight on the siding
  ctx.fillStyle = '#161616';
  ctx.beginPath(); ctx.moveTo(60, 48); ctx.lineTo(160, 48); ctx.quadraticCurveTo(155, 133, 110, 138); ctx.quadraticCurveTo(65, 133, 60, 48); ctx.fill();
  ctx.fillRect(102, 136, 16, 30); ctx.fillRect(78, 164, 64, 14);
  ctx.lineWidth = 9; ctx.strokeStyle = '#161616';
  ctx.beginPath(); ctx.arc(60, 78, 22, Math.PI * 0.5, Math.PI * 1.5); ctx.stroke();
  ctx.beginPath(); ctx.arc(160, 78, 22, -Math.PI * 0.5, Math.PI * 0.5); ctx.stroke();
  ctx.font = 'bold 112px Georgia, "Times New Roman", serif'; ctx.textBaseline = 'middle';
  ctx.fillText('TROPHY COFFEE', 205, 112, 800);
  return canvasTex(c);
}

export function buildTrophyCoffee(world, boxes) {
  const t = world.trophy;
  if (!t) return;
  const { P, tx, ty, nx, ny } = t;
  const scene = world.scene, colliders = world.colliders, shadows = !world.lowSpec;
  const wallA = Math.atan2(ty, tx), face = Math.atan2(nx, -ny);
  const g = heightAtCampus(...P(0, 1));
  // Local z of a box turned to wallA points out of the wall (+1) or into it (-1)
  const zOut = Math.sign(Math.sin(wallA) * nx - Math.cos(wallA) * ny) || 1;
  // Tilt (about the wall axis) that makes a box's local z run outward and drop by `drop`
  const tilt = (out, drop) => Math.atan2(drop, out * zOut);
  const plane = (w, h, material, a, o, y) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), material);
    const [x, yy] = P(a, o);
    m.position.set(x, g + y, -yy); m.rotation.y = face;
    scene.add(m);
    return m;
  };

  // ---- the shop front ----
  const SW = 11, SH = 5.2;
  plane(SW, SH, new THREE.MeshLambertMaterial({ map: sidingTexture(SW, SH) }), 0, 0.05, SH / 2 - 0.05).receiveShadow = true;
  { const [x, y] = P(0, 0.14); boxes.add(BLACK, x, g + SH - 0.05, -y, SW + 0.2, 0.2, 0.24, wallA); boxes.add(0x2a2c2e, x, g + 0.12, -y, SW, 0.24, 0.2, wallA); }
  // Windows and door, glowing a little so the cafe looks lit from inside
  const itex = interiorTexture();
  const glass = new THREE.MeshLambertMaterial({ map: itex, emissive: 0xffffff, emissiveMap: itex, emissiveIntensity: 0.35 });
  plane(8.8, 3.0, glass, 0, 0.08, 1.5);
  // Black steel frames: posts, sill, transom and head
  for (const a of [-4.4, -2.7, -1.0, 1.0, 2.7, 4.4]) { const [x, y] = P(a, 0.12); boxes.add(BLACK, x, g + 1.5, -y, 0.1, 3.0, 0.1, wallA); }
  for (const [h, a0, a1] of [[3.0, -4.45, 4.45], [2.45, -4.4, 4.4], [0.45, -4.4, -1.0], [0.45, 1.0, 4.4]]) {
    const [x, y] = P((a0 + a1) / 2, 0.12); boxes.add(BLACK, x, g + h, -y, a1 - a0, 0.09, 0.1, wallA);
  }
  for (const a of [-3.55, 3.55]) { const [x, y] = P(a, 0.12); boxes.add(BLACK, x, g + 1.45, -y, 0.04, 2.0, 0.06, wallA); } // thin muntins
  // Glass double door: frames and long brass pulls
  for (const a of [-0.92, 0, 0.92]) { const [x, y] = P(a, 0.13); boxes.add(BLACK, x, g + 1.22, -y, 0.08, 2.45, 0.08, wallA); }
  { const [x, y] = P(0, 0.13); boxes.add(BLACK, x, g + 0.08, -y, 1.9, 0.16, 0.1, wallA); }
  for (const a of [-0.18, 0.18]) { const [x, y] = P(a, 0.22); boxes.add(0xc9a227, x, g + 1.15, -y, 0.04, 0.9, 0.04, wallA); }
  // Flat black steel awning on tie rods
  {
    const [x, y] = P(0, 0.8);
    boxes.add(BLACK, x, g + 3.12, -y, 9.4, 0.08, 1.5, wallA, 0, tilt(1.5, 0.12));
    const [fx, fy] = P(0, 1.55); boxes.add(BLACK, fx, g + 3.04, -fy, 9.4, 0.2, 0.06, wallA);
    for (const a of [-4.2, 4.2]) { // outside the sign
      const [rx, ry] = P(a, 0.75); boxes.add(0x2b2b2b, rx, g + 3.55, -ry, 0.04, 0.04, 1.75, wallA, 0, tilt(1.4, 0.95));
    }
  }
  // The sign: black metal letters on the siding, lit by three gooseneck barn lamps
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(5.2, 1.12), new THREE.MeshLambertMaterial({ map: signTexture(), transparent: true }));
  { const [x, y] = P(0, 0.1); sign.position.set(x, g + 3.95, -y); sign.rotation.y = face; scene.add(sign); }
  const bulb = new THREE.MeshBasicMaterial({ color: 0xffe2a8 });
  for (const a of [-1.9, 0, 1.9]) {
    const [bx, by] = P(a, 0.1); boxes.add(BLACK, bx, g + 4.85, -by, 0.14, 0.2, 0.06, wallA); // wall plate
    const [ax, ay] = P(a, 0.35); boxes.add(BLACK, ax, g + 4.95, -ay, 0.04, 0.04, 0.55, wallA, 0, tilt(0.5, -0.15));
    const [sx, sy] = P(a, 0.66);
    const shade = new THREE.Mesh(GEOM.cone8, mat(BLACK)); shade.scale.set(0.42, 0.22, 0.42); shade.position.set(sx, g + 4.96, -sy); scene.add(shade);
    const b = new THREE.Mesh(GEOM.sphere, bulb); b.scale.set(0.12, 0.06, 0.12); b.position.set(sx, g + 4.84, -sy); scene.add(b);
  }

  // ---- the patio ----
  // Benches under the windows
  for (const a of [-2.7, 2.7]) {
    const [x, y] = P(a, 0.5), gb = heightAtCampus(x, y);
    boxes.add(WOOD, x, gb + 0.45, -y, 2.6, 0.08, 0.4, wallA);
    for (const s of [-1.1, 1.1]) { const [lx, ly] = P(a + s, 0.5); boxes.add(BLACK, lx, gb + 0.22, -ly, 0.06, 0.44, 0.36, wallA); }
    colliders.addCircle(x, -y, 0.35, 'bench', gb + 0.5);
  }
  // Two long farm tables with benches, each under a cream market umbrella
  const ALONG_O = wallA + Math.PI / 2;
  for (const a of [-3.5, 3.5]) {
    const [x, y] = P(a, 3.3), gt = heightAtCampus(x, y);
    boxes.add(WOOD, x, gt + 0.76, -y, 0.9, 0.06, 2.4, wallA);
    for (const o of [2.3, 4.3]) for (const s of [-0.35, 0.35]) { const [lx, ly] = P(a + s, o); boxes.add(BLACK, lx, gt + 0.37, -ly, 0.06, 0.74, 0.06, wallA); }
    for (const s of [-0.78, 0.78]) {
      const [bx, by] = P(a + s, 3.3);
      boxes.add(WOOD, bx, gt + 0.45, -by, 0.32, 0.06, 2.2, wallA);
      for (const o of [2.4, 4.2]) { const [lx, ly] = P(a + s, o); boxes.add(BLACK, lx, gt + 0.22, -ly, 0.06, 0.44, 0.06, wallA); }
    }
    boxes.add(0xd8d2c4, x, gt + 1.5, -y, 0.06, 1.5, 0.06, 0); // umbrella pole
    const um = new THREE.Mesh(GEOM.cone8, mat(CREAM)); um.scale.set(3.4, 0.55, 3.4); um.position.set(x, gt + 2.45, -y); um.rotation.y = ALONG_O + Math.PI / 8; um.castShadow = shadows; scene.add(um);
    const fin = new THREE.Mesh(GEOM.sphere, mat(0xb8ae98)); fin.scale.setScalar(0.12); fin.position.set(x, gt + 2.75, -y); scene.add(fin);
    for (const o of [2.6, 4.0]) { const [cx, cy] = P(a, o); colliders.addCircle(cx, -cy, 0.95, 'table', gt + 0.8); }
  }
  // Two little round bistro tables with black metal chairs near the front edge
  for (const a of [-1.7, 1.7]) {
    const [x, y] = P(a, 5.1), gt = heightAtCampus(x, y);
    const top = new THREE.Mesh(GEOM.cyl, mat(0x2b2b2b)); top.scale.set(0.7, 0.04, 0.7); top.position.set(x, gt + 0.74, -y); scene.add(top);
    boxes.add(BLACK, x, gt + 0.37, -y, 0.06, 0.74, 0.06, 0);
    boxes.add(BLACK, x, gt + 0.02, -y, 0.45, 0.04, 0.45, wallA);
    for (const s of [-0.55, 0.55]) {
      const [cx, cy] = P(a + s, 5.1), an = wallA + (s < 0 ? 0 : Math.PI);
      boxes.add(BLACK, cx, gt + 0.46, -cy, 0.4, 0.04, 0.4, an);
      const [kx, ky] = P(a + s * 1.36, 5.1); boxes.add(BLACK, kx, gt + 0.7, -ky, 0.04, 0.48, 0.38, an);
      for (const d of [-0.16, 0.16]) for (const e of [-0.16, 0.16]) { const [lx, ly] = P(a + s + d, 5.1 + e); boxes.add(BLACK, lx, gt + 0.23, -ly, 0.03, 0.46, 0.03, 0); }
    }
    colliders.addCircle(x, -y, 0.5, 'table', gt + 0.8);
  }
  // Black planters with little olive trees at the front corners; the string-light poles rise out of them
  const poles = [];
  for (const a of [-5.6, 5.6]) {
    const [x, y] = P(a, 5.6), gp = heightAtCampus(x, y);
    boxes.add(0x2a2a2a, x, gp + 0.35, -y, 0.8, 0.7, 0.8, wallA);
    boxes.add(0x4a3a2a, x, gp + 0.69, -y, 0.7, 0.04, 0.7, wallA);
    boxes.add(0x3b2f26, x, gp + 1.9, -y, 0.12, 3.3, 0.12, wallA); // light pole
    const [ox, oy] = P(a * 0.93, 5.3);
    boxes.add(0x6b5a46, ox, gp + 1.05, -oy, 0.08, 0.8, 0.08, 0.4);
    const crown = new THREE.Mesh(GEOM.sphere, mat(OLIVE, { flatShading: true })); crown.scale.set(1.0, 0.8, 1.0); crown.position.set(ox, gp + 1.7, -oy); crown.castShadow = shadows; scene.add(crown);
    colliders.addCircle(x, -y, 0.5, 'planter', gp + 0.7);
    poles.push([x, gp + 3.5, -y]);
  }
  // Café string lights: from the wall to each pole, crossing over the patio, and along the front
  const anchors = [-5.4, 5.4].map((a) => { const [x, y] = P(a, 0.15); return [x, g + 3.4, -y]; });
  const strands = [[anchors[0], poles[1]], [anchors[1], poles[0]], [poles[0], poles[1]], [anchors[0], poles[0]], [anchors[1], poles[1]]];
  const wirePts = [], bulbs = [];
  for (const [p0, p1] of strands) {
    const len = Math.hypot(p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]);
    const n = Math.max(4, Math.round(len / 0.55));
    let prev = null;
    for (let k = 0; k <= n; k++) {
      const u = k / n, sag = 0.45 * 4 * u * (1 - u);
      const p = new THREE.Vector3(p0[0] + (p1[0] - p0[0]) * u, p0[1] + (p1[1] - p0[1]) * u - sag, p0[2] + (p1[2] - p0[2]) * u);
      if (prev) wirePts.push(prev, p);
      if (k > 0 && k < n) bulbs.push(p);
      prev = p;
    }
  }
  const wires = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(wirePts), new THREE.LineBasicMaterial({ color: 0x222222 }));
  scene.add(wires);
  const bulbMesh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.06, 1), new THREE.MeshBasicMaterial({ color: 0xffe0a0 }), bulbs.length);
  const m4 = new THREE.Matrix4();
  bulbs.forEach((p, i) => { m4.makeTranslation(p.x, p.y - 0.06, p.z); bulbMesh.setMatrixAt(i, m4); });
  scene.add(bulbMesh);
  // Chalkboard A-frame by the door, and trash and recycling cans by the wall
  { const [mx, my] = P(1.5, 1.3), gm = heightAtCampus(mx, my); boxes.add(0x1f2a24, mx, gm + 0.5, -my, 0.6, 0.95, 0.06, wallA, 0, 0.18); boxes.add(0x6b4f33, mx, gm + 0.5, -my, 0.66, 1.0, 0.03, wallA, 0, 0.18); }
  for (const [a, color] of [[5.0, 0x3a3a3a], [5.6, 0x2f5d8a]]) {
    const [cx, cy] = P(a, 0.55), gc = heightAtCampus(cx, cy);
    boxes.add(color, cx, gc + 0.5, -cy, 0.5, 1.0, 0.5, wallA);
    boxes.add(0x222222, cx, gc + 1.02, -cy, 0.54, 0.06, 0.54, wallA);
  }
}
