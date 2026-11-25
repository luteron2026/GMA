// West Campus courts: four fenced pickleball courts (where the map has the hard court) with a
// playable pickleball game, and two sand volleyball courts with nets next to them.
import * as THREE from 'three';
import { CAMPUS } from './data/campus.js';
import { heightAtCampus } from './terrain.js';
import { pointInPoly, distToPolyline, clamp } from './physics.js';
import { mat, makeLabel, makePerson, randomLook, animatePerson, GEOM } from './models.js';

// Official pickleball court: 44 x 20 ft, non-volley zone 7 ft from the net
export const PB = { hl: 6.705, hw: 3.05, kitchen: 2.13, net: 0.91 };

// Lay out the courts on the map's court and sand areas. Campus space; each court has a
// center (cx, cy) and an angle a for its long axis (u), with v across it.
export function planCourts() {
  const court = CAMPUS.lawns.find((l) => l.kind === 'court' && l.lines);
  const sand = CAMPUS.lawns.find((l) => l.kind === 'sand' && l.lines);
  const out = { pickle: [], volley: [], block: null, sandBlock: null };
  const frame = ([cx, cy, w, h, a]) => {
    // Long side along u
    if (h > w) { [w, h] = [h, w]; a += Math.PI / 2; }
    const c = Math.cos(a), s = Math.sin(a);
    return { cx, cy, a, hu: w / 2, hv: h / 2, P: (u, v) => [cx + c * u - s * v, cy + s * u + c * v] };
  };
  if (court) {
    const b = frame(court.lines);
    out.block = b;
    // A tennis-court-sized pad holds four pickleball courts, two by two
    for (const u of [-8.5, 8.5]) for (const v of [-4.3, 4.3]) {
      const [x, y] = b.P(u, v);
      // fenceU: how far the fence is from this court's center, along the court (for the camera)
      out.pickle.push({ cx: x, cy: y, a: b.a, P: frame([x, y, PB.hl * 2, PB.hw * 2, b.a]).P, fenceU: b.hu - 0.3 - Math.abs(u), flip: u > 0 });
    }
    // Fence just inside the pad, with a gate on the side nearest a drive or lot
    const fu = b.hu - 0.3, fv = b.hv - 0.3;
    const sides = [[[-fu, -fv], [fu, -fv]], [[fu, -fv], [fu, fv]], [[fu, fv], [-fu, fv]], [[-fu, fv], [-fu, -fv]]];
    const paved = CAMPUS.roads.filter((r) => r.kind !== 'trail' && r.kind !== 'path');
    let gate = 0, bd = Infinity;
    sides.forEach(([p, q], i) => {
      const [x, y] = b.P((p[0] + q[0]) / 2 * 1.15, (p[1] + q[1]) / 2 * 1.15);
      let d = Math.min(...paved.map((r) => distToPolyline(x, y, r.pts) - r.width / 2));
      for (const l of CAMPUS.lots) d = Math.min(d, pointInPoly(x, y, l.poly) ? 0 : distToPolyline(x, y, l.poly, true));
      if (d < bd) { bd = d; gate = i; }
    });
    b.fence = { sides, gate, fu, fv };
    const [gp, gq] = sides[gate];
    b.gatePoint = b.P((gp[0] + gq[0]) / 2 * 1.06, (gp[1] + gq[1]) / 2 * 1.06);
    // Outline (campus) for keeping trees and walks out
    b.outline = [b.P(-b.hu, -b.hv), b.P(b.hu, -b.hv), b.P(b.hu, b.hv), b.P(-b.hu, b.hv)];
  }
  if (sand) {
    const b = frame(sand.lines);
    out.sandBlock = b;
    b.outline = [b.P(-b.hu, -b.hv), b.P(b.hu, -b.hv), b.P(b.hu, b.hv), b.P(-b.hu, b.hv)];
    // Two 16 x 8 m courts side by side
    for (const v of [-b.hv / 2, b.hv / 2]) {
      const [x, y] = b.P(0, v);
      out.volley.push({ cx: x, cy: y, a: b.a, P: frame([x, y, 16, 8, b.a]).P });
    }
  }
  return out;
}

// Court surfaces and lines, painted with the other pavement (surfaces.js)
export function paintCourts(S, courts) {
  const b = courts.block;
  if (b) {
    const rect = (layer, P, u0, v0, u1, v1, color) => S[layer].convex([P(u0, v0), P(u1, v0), P(u1, v1), P(u0, v1)], color);
    rect('courtBase', b.P, -b.hu, -b.hv, b.hu, b.hv, '#3e7a62');
    for (const c of courts.pickle) {
      // Blue service areas and the green kitchen between them (side by side, never overlapping)
      rect('courtTop', c.P, -PB.hl, -PB.hw, -PB.kitchen, PB.hw, '#2f6aa3');
      rect('courtTop', c.P, PB.kitchen, -PB.hw, PB.hl, PB.hw, '#2f6aa3');
      rect('courtTop', c.P, -PB.kitchen, -PB.hw, PB.kitchen, PB.hw, '#2a8a6a');
      const L = (u0, v0, u1, v1) => rect('paint', c.P, u0, v0, u1, v1, '#f4f4f0');
      const t = 0.025;
      L(-PB.hl, -PB.hw - t, PB.hl, -PB.hw + t); L(-PB.hl, PB.hw - t, PB.hl, PB.hw + t); // sidelines
      L(-PB.hl - t, -PB.hw, -PB.hl + t, PB.hw); L(PB.hl - t, -PB.hw, PB.hl + t, PB.hw); // baselines
      for (const k of [-PB.kitchen, PB.kitchen]) L(k - t, -PB.hw, k + t, PB.hw); // non-volley lines
      L(-PB.hl, -t, -PB.kitchen, t); L(PB.kitchen, -t, PB.hl, t); // center lines
    }
  }
  for (const c of courts.volley) {
    const L = (u0, v0, u1, v1) => S.paint.convex([c.P(u0, v0), c.P(u1, v0), c.P(u1, v1), c.P(u0, v1)], '#2a5fb8');
    const t = 0.03;
    L(-8, -4 - t, 8, -4 + t); L(-8, 4 - t, 8, 4 + t); L(-8 - t, -4, -8 + t, 4); L(8 - t, -4, 8 + t, 4);
  }
}

let linkTex = null;
function chainLink() {
  if (linkTex) return linkTex;
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const ctx = c.getContext('2d');
  ctx.strokeStyle = 'rgba(40,44,48,0.9)'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(32, 32); ctx.moveTo(32, 0); ctx.lineTo(0, 32); ctx.stroke();
  linkTex = new THREE.CanvasTexture(c);
  linkTex.wrapS = linkTex.wrapT = THREE.RepeatWrapping;
  linkTex.anisotropy = 4;
  return linkTex;
}

function netTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const ctx = c.getContext('2d');
  ctx.strokeStyle = 'rgba(20,20,20,0.95)'; ctx.lineWidth = 2;
  ctx.strokeRect(0, 0, 32, 32);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

// Fence, nets, posts and signs
export function buildCourts(world, boxes) {
  const { scene, colliders } = world;
  const courts = world.courts;
  const ang = (P, u0, v0, u1, v1) => { const [ax, ay] = P(u0, v0), [bx, by] = P(u1, v1); return Math.atan2(by - ay, bx - ax); };
  const b = courts.block;
  if (b) {
    const g0 = heightAtCampus(b.cx, b.cy);
    const H = 3;
    const link = new THREE.MeshLambertMaterial({ map: chainLink(), transparent: true, alphaTest: 0.3, side: THREE.DoubleSide });
    const { sides, gate } = b.fence;
    sides.forEach(([p, q], i) => {
      // The gate side is split around a 1.6 m opening
      const runs = [];
      if (i === gate) {
        const mu = (p[0] + q[0]) / 2, mv = (p[1] + q[1]) / 2, du = Math.sign(q[0] - p[0]), dv = Math.sign(q[1] - p[1]);
        runs.push([p, [mu - du * 0.8, mv - dv * 0.8]], [[mu + du * 0.8, mv + dv * 0.8], q]);
      } else runs.push([p, q]);
      for (const [r0, r1] of runs) {
        const [x0, y0] = b.P(...r0), [x1, y1] = b.P(...r1);
        const L = Math.hypot(x1 - x0, y1 - y0), a = Math.atan2(y1 - y0, x1 - x0);
        const mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
        const g = Math.min(heightAtCampus(x0, y0), heightAtCampus(x1, y1), g0);
        const geo = new THREE.PlaneGeometry(L, H);
        const uv = geo.getAttribute('uv');
        for (let k = 0; k < uv.count; k++) uv.setXY(k, uv.getX(k) * L / 0.12, uv.getY(k) * H / 0.12);
        const m = new THREE.Mesh(geo, link);
        m.position.set(mx, g + H / 2, -my); m.rotation.y = a;
        scene.add(m);
        boxes.add(0x2b2f33, mx, g + H, -my, L, 0.06, 0.06, a);
        boxes.add(0x2b2f33, mx, g + 0.05, -my, L, 0.05, 0.05, a);
        const n = Math.max(1, Math.round(L / 3));
        for (let k = 0; k <= n; k++) {
          const x = x0 + ((x1 - x0) * k) / n, y = y0 + ((y1 - y0) * k) / n;
          boxes.add(0x2b2f33, x, heightAtCampus(x, y) + H / 2 - 0.1, -y, 0.07, H + 0.2, 0.07, 0);
        }
        const nx = -(y1 - y0) / L * 0.12, ny = (x1 - x0) / L * 0.12;
        colliders.addPoly([[x0 - nx, -(y0 - ny)], [x1 - nx, -(y1 - ny)], [x1 + nx, -(y1 + ny)], [x0 + nx, -(y0 + ny)]], 'fence', g + H);
      }
    });
    // Pickleball nets: posts, mesh and a white top tape
    const netMat = new THREE.MeshLambertMaterial({ map: netTexture(), transparent: true, alphaTest: 0.3, side: THREE.DoubleSide });
    for (const c of courts.pickle) {
      const g = heightAtCampus(c.cx, c.cy);
      const a = ang(c.P, 0, -1, 0, 1);
      const w = PB.hw * 2 + 0.6;
      const geo = new THREE.PlaneGeometry(w, 0.75);
      const uv = geo.getAttribute('uv');
      for (let k = 0; k < uv.count; k++) uv.setXY(k, uv.getX(k) * w / 0.05, uv.getY(k) * 0.75 / 0.05);
      const net = new THREE.Mesh(geo, netMat);
      net.position.set(c.cx, g + 0.5, -c.cy); net.rotation.y = a;
      scene.add(net);
      boxes.add(0xf4f4f0, c.cx, g + PB.net - 0.02, -c.cy, w, 0.06, 0.03, a);
      for (const v of [-w / 2, w / 2]) { const [x, y] = c.P(0, v); boxes.add(0x26292c, x, g + 0.47, -y, 0.07, 0.94, 0.07, 0); colliders.addCircle(x, -y, 0.1, 'post', g + 1); }
      c.ground = g;
    }
    const lbl = makeLabel('Pickleball Courts', 'Press E inside to play', { width: 11 });
    lbl.position.set(b.cx, g0 + 5, -b.cy);
    scene.add(lbl);
    world.labels.push(lbl);
  }
  // Sand volleyball: tall posts, a net band with white tape, a bench per court
  const vnet = new THREE.MeshLambertMaterial({ map: netTexture(), transparent: true, alphaTest: 0.3, side: THREE.DoubleSide });
  for (const c of courts.volley) {
    const g = heightAtCampus(c.cx, c.cy);
    const a = ang(c.P, 0, -1, 0, 1);
    const w = 9;
    const geo = new THREE.PlaneGeometry(w, 1);
    const uv = geo.getAttribute('uv');
    for (let k = 0; k < uv.count; k++) uv.setXY(k, uv.getX(k) * w / 0.1, uv.getY(k) / 0.1);
    const net = new THREE.Mesh(geo, vnet);
    net.position.set(c.cx, g + 1.93, -c.cy); net.rotation.y = a;
    scene.add(net);
    boxes.add(0xf4f4f0, c.cx, g + 2.43, -c.cy, w, 0.07, 0.03, a);
    boxes.add(0xf4f4f0, c.cx, g + 1.43, -c.cy, w, 0.05, 0.03, a);
    for (const v of [-w / 2 - 0.1, w / 2 + 0.1]) {
      const [x, y] = c.P(0, v);
      boxes.add(0xd8d8d2, x, g + 1.25, -y, 0.11, 2.6, 0.11, 0);
      colliders.addCircle(x, -y, 0.15, 'post', g + 2.6);
    }
    const [bx, by] = c.P(0, -6.2);
    boxes.add(0x8b6a4e, bx, g + 0.45, -by, 2.4, 0.08, 0.45, a + Math.PI / 2);
    for (const o of [-1, 1]) { const [px, py] = c.P(o * 1.0, -6.2); boxes.add(0x3a3532, px, g + 0.22, -py, 0.08, 0.45, 0.45, a + Math.PI / 2); }
  }
  if (courts.sandBlock) {
    const sb = courts.sandBlock;
    const lbl = makeLabel('Sand Volleyball', null, { width: 9 });
    lbl.position.set(sb.cx, heightAtCampus(sb.cx, sb.cy) + 5, -sb.cy);
    scene.add(lbl);
    world.labels.push(lbl);
  }
}

// ---------- the game ----------

const OPPONENTS = ['Pastor Dave', 'Coach Ramirez', 'Dr. Ellison (Old Testament)', 'RA Brooke', 'Grandma Ruth from church'];
const WIN = 7;
const START_SPEED = 6.5, SPEEDUP = 1.07, MAX_SPEED = 24; // m/s, and how much faster each return gets
const REACH = 0.8; // how far from your middle the paddle still gets the ball (m)
const ME_SPEED = 7.5, OP_SPEED = 5.2;

// Pickleball played like Pong, on one court: you on the near baseline (u < 0), a campus
// regular on the far one. Slide side to side with A/D or the stick; the ball comes off your
// paddle at an angle that depends on where it hits, bounces off the sidelines, and gets a
// little faster with every return. Space serves (and, pressed just before contact, smashes).
// First to 7, win by 2.
export class Pickleball {
  constructor(game, court) {
    this.game = game;
    this.court = court;
    // You always play from the fence end (on the far courts that means turning the frame around)
    const a = court.a + (court.flip ? Math.PI : 0);
    this.c = Math.cos(a); this.s = Math.sin(a);
    this.g = court.ground ?? heightAtCampus(court.cx, court.cy);
    this.lineU = PB.hl - 0.3; // where the paddles slide, just inside the baselines
    this.me = { u: -this.lineU, v: 0, vel: 0, swing: 0, walk: 0, smash: 0 };
    this.op = { u: this.lineU, v: 0, vel: 0, swing: 0, walk: 0, aim: 0, name: OPPONENTS[Math.floor(Math.random() * OPPONENTS.length)] };
    this.score = [0, 0];
    this.server = 0; // 0 = you
    this.ball = null;
    this.rallyN = 0;
    this.best = 0;
    this.phase = 'serve';
    this.wait = 0.6;
    this.msg = '';
    const scene = game.scene;
    this.opMesh = makePerson(randomLook());
    scene.add(this.opMesh);
    this.ballMesh = new THREE.Mesh(new THREE.IcosahedronGeometry(0.11, 1), mat(0xe8e04a, { emissive: 0x3a3600 }));
    scene.add(this.ballMesh);
    // A short fading trail so you can see how fast it's going
    this.trail = [0.6, 0.4, 0.25, 0.12].map((o) => {
      const m = new THREE.Mesh(new THREE.IcosahedronGeometry(0.08, 1), new THREE.MeshBasicMaterial({ color: 0xf4ee7a, transparent: true, opacity: o, depthWrite: false }));
      scene.add(m);
      return m;
    });
    this.hist = [];
    this.shadow = new THREE.Mesh(new THREE.CircleGeometry(0.1, 12), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35 }));
    this.shadow.rotation.x = -Math.PI / 2;
    scene.add(this.shadow);
    this.paddles = [game.player.mesh, this.opMesh].map(() => {
      const p = new THREE.Mesh(GEOM.box, mat(0x1f3a6e));
      p.scale.set(0.2, 0.26, 0.03);
      scene.add(p);
      return p;
    });
    this.hud = document.createElement('div');
    this.hud.style.cssText = 'position:fixed;left:50%;top:70px;transform:translateX(-50%);background:rgba(15,30,60,0.85);color:#fff;padding:8px 16px;border-radius:12px;font:600 16px system-ui,sans-serif;text-align:center;z-index:20;pointer-events:none;border:2px solid #c9a227';
    document.body.appendChild(this.hud);
    this.updateHud();
    this.intro = `🏓 ${this.op.name} is up for a game. First to 7, win by 2.`;
  }

  exitPose() {
    const [x, , z] = this.W(this.me.u, clamp(this.me.v, -2, 2));
    return { x, z, heading: Math.atan2(this.c, -this.s) };
  }

  // Court frame (u along the court, v across, h up) -> world
  W(u, v, h = 0) {
    const x = this.court.cx + this.c * u - this.s * v, y = this.court.cy + this.s * u + this.c * v;
    return [x, this.g + h, -y];
  }

  updateHud() {
    const touch = this.game.input.isTouch;
    const help = touch ? 'Stick: slide side to side · 📖 serve / smash · ✋ quit' : '<b>A/D</b> slide side to side · <b>Space</b> serve (tap right before it hits you to smash) · <b>E</b> quit';
    const b = this.ball;
    const speed = b ? `Rally ${this.rallyN} · ${Math.round(b.speed * 2.237)} mph` : (this.best ? `Longest rally: ${this.best}` : '');
    this.hud.innerHTML = `🏓 <b>You ${this.score[0]}</b> – ${this.score[1]} ${this.op.name}<br><span style="font-weight:400;font-size:13px">${this.msg || help}</span>` +
      (speed ? `<br><span style="font-weight:600;font-size:13px;color:#ffd23f">${speed}</span>` : '');
  }

  // Send the ball from paddle `who` (0 you, 1 them) at `speed`, `ang` radians off straight
  send(who, v, speed, ang) {
    const dir = who === 0 ? 1 : -1;
    const u = who === 0 ? -this.lineU + 0.25 : this.lineU - 0.25;
    this.ball = { u, v, u0: u, speed, vu: dir * speed * Math.cos(ang), vv: speed * Math.sin(ang), hitter: who, h: 0.9 };
    this.hist.length = 0;
  }

  point(winner, why) {
    this.score[winner]++;
    this.server = winner;
    this.best = Math.max(this.best, this.rallyN);
    this.msg = `${winner === 0 ? '✅ Your point' : `❌ ${this.op.name}'s point`}: ${why}`;
    this.phase = 'between';
    this.wait = 1.4;
    this.ball = null;
    if (winner === 0) this.game.audio.pickup(); else this.game.audio.bump();
    this.updateHud();
    const [a, b] = this.score;
    if ((a >= WIN || b >= WIN) && Math.abs(a - b) >= 2) this.finish(a > b);
  }

  finish(won) {
    const g = this.game;
    if (won) {
      g.toast(`🏆 You beat ${this.op.name} ${this.score[0]}–${this.score[1]}! A humble handshake at the net.`);
      g.addCredits(100);
      g.goodDeed(30);
      g.audio.win();
    } else {
      g.toast(`🏓 ${this.op.name} wins ${this.score[1]}–${this.score[0]}. You shook hands and asked for a rematch. (+20 for sportsmanship)`);
      g.addCredits(20);
    }
    this.phase = 'done';
    this.wait = 2.5;
  }

  slide(who, target, maxSpeed, dt) {
    const lim = PB.hw + 0.4;
    const prev = who.v;
    const d = clamp(target, -lim, lim) - who.v;
    who.v += clamp(d, -maxSpeed * dt, maxSpeed * dt);
    who.vel = (who.v - prev) / Math.max(dt, 1e-3);
    who.walk += Math.abs(who.v - prev) * 3;
  }

  update(dt) {
    const g = this.game, inp = g.input;
    if (inp.wasPressed('action')) { g.toast('🏓 You left the court. Good game!'); g.endSport(); return; }
    if (this.phase === 'done') { this.wait -= dt; if (this.wait <= 0) g.endSport(); this.draw(dt); return; }
    // You: slide along your baseline (right on screen is -v)
    const prev = this.me.v;
    this.me.v = clamp(this.me.v - inp.turn * ME_SPEED * dt, -PB.hw - 0.4, PB.hw + 0.4);
    this.me.vel = (this.me.v - prev) / Math.max(dt, 1e-3);
    this.me.walk += Math.abs(this.me.v - prev) * 3;
    this.me.swing = Math.max(0, this.me.swing - dt);
    this.op.swing = Math.max(0, this.op.swing - dt);
    this.me.smash = Math.max(0, this.me.smash - dt);
    if (inp.wasPressed('throw') && this.phase === 'rally') { this.me.smash = 0.3; this.me.swing = 0.25; }

    if (this.phase === 'serve' || this.phase === 'between') {
      this.wait -= dt;
      if (this.phase === 'between' && this.wait <= 0) { this.phase = 'serve'; this.wait = 0.8; this.msg = ''; this.updateHud(); }
      if (this.server === 1) {
        this.slide(this.op, 0, OP_SPEED, dt);
        if (this.phase === 'serve' && this.wait <= 0) {
          this.op.swing = 0.3;
          this.rallyN = 0;
          this.send(1, this.op.v, START_SPEED, (Math.random() - 0.5) * 0.6);
          this.game.audio.throw();
          this.phase = 'rally';
          this.updateHud();
        }
      } else if (this.phase === 'serve') {
        this.slide(this.op, 0, OP_SPEED, dt);
        if (!this.msg) { this.msg = 'Your serve: press Space (📖)'; this.updateHud(); }
        if (inp.wasPressed('throw') && this.wait <= 0) {
          this.me.swing = 0.3;
          this.rallyN = 0;
          this.send(0, this.me.v, START_SPEED, clamp(-this.me.vel * 0.05, -0.4, 0.4) + (Math.random() - 0.5) * 0.3);
          this.game.audio.throw();
          this.phase = 'rally'; this.msg = ''; this.updateHud();
        }
      }
    }

    if (this.phase === 'rally' && this.ball) this.rally(dt);
    this.draw(dt);
  }

  rally(dt) {
    const b = this.ball;
    // Small steps so a fast ball can't skip past a paddle
    const steps = Math.ceil((b.speed * dt) / 0.15);
    const h = dt / steps;
    for (let k = 0; k < steps && this.ball; k++) {
      b.u += b.vu * h; b.v += b.vv * h;
      // Sidelines are the walls
      const wall = PB.hw - 0.05;
      if (b.v > wall && b.vv > 0) { b.v = 2 * wall - b.v; b.vv = -b.vv; this.game.audio.tone(700, 0.04, 'square', 0.05); }
      if (b.v < -wall && b.vv < 0) { b.v = -2 * wall - b.v; b.vv = -b.vv; this.game.audio.tone(700, 0.04, 'square', 0.05); }
      // Your paddle
      if (b.vu < 0 && b.u <= -this.lineU + 0.25 && b.u > -this.lineU - 0.6) {
        const off = b.v - this.me.v;
        if (Math.abs(off) <= REACH) { this.returnBall(0, off); continue; }
      }
      // Their paddle
      if (b.vu > 0 && b.u >= this.lineU - 0.25 && b.u < this.lineU + 0.6) {
        const off = b.v - this.op.v;
        if (Math.abs(off) <= REACH) { this.returnBall(1, off); continue; }
      }
      if (b.u < -this.lineU - 1.4) { this.point(1, this.rallyN > 6 ? `it got past you at ${Math.round(b.speed * 2.237)} mph` : 'it got past you'); return; }
      if (b.u > this.lineU + 1.4) { this.point(0, this.rallyN > 6 ? `${Math.round(b.speed * 2.237)} mph, too fast for them` : 'it got past them'); return; }
    }
    // Opponent: run to where the ball will cross their line (bouncing off the sidelines),
    // missing by a bit more the faster it comes; drift back to the middle otherwise
    if (b.vu > 0) {
      const t = (this.lineU - b.u) / b.vu;
      let v = b.v + b.vv * t;
      const wall = PB.hw - 0.05, span = 4 * wall;
      const m = (((v + wall) % span) + span) % span; // unfold the sideline bounces
      v = (m > 2 * wall ? span - m : m) - wall;
      this.slide(this.op, v + this.op.aim, OP_SPEED, dt);
    } else this.slide(this.op, b.v * 0.3, OP_SPEED * 0.6, dt);
    // Cosmetic height: one bounce on the receiver's side, over the net
    const f = clamp(Math.abs(b.u - b.u0) / (2 * this.lineU - 0.5), 0, 1);
    if (f < 0.72) { const s = f / 0.72; b.h = 0.9 * (1 - s) + 0.05 * s + 1.0 * 4 * s * (1 - s); } else b.h = 0.05 + 0.85 * Math.sin(((f - 0.72) / 0.28) * Math.PI / 2);
    if (f >= 0.72 && !b.bounced) { b.bounced = true; this.game.audio.tone(900, 0.04, 'square', 0.05); }
  }

  // Paddle `who` returns the ball; `off` is where on the paddle it hit (-REACH..REACH)
  returnBall(who, off) {
    const b = this.ball, p = who === 0 ? this.me : this.op;
    let speed = Math.min(MAX_SPEED, b.speed * SPEEDUP);
    let smash = false;
    if (who === 0 && this.me.smash > 0) { speed = Math.min(MAX_SPEED, speed * 1.18); smash = true; }
    // Off the edge of the paddle sends it out at a steep angle; moving adds a bit of spin
    let ang = (off / REACH) * 0.9 + clamp(p.vel * 0.03, -0.25, 0.25);
    ang = clamp(ang, -1.05, 1.05);
    p.swing = 0.3;
    this.rallyN++;
    this.send(who, b.v, speed, ang);
    // The opponent's next aim error grows with the speed of the ball
    this.op.aim = (Math.random() - 0.5) * 2 * (0.15 + Math.max(0, speed - 8) * 0.075);
    this.msg = smash ? '💥 Smash!' : '';
    this.game.audio.tone(who === 0 ? 520 : 440, 0.05, 'square', 0.12);
    this.updateHud();
  }

  draw(dt) {
    const face = Math.atan2(this.c, -this.s); // heading toward +u
    const pm = this.game.player.mesh;
    const place = (mesh, who, heading, paddle) => {
      const [x, y, z] = this.W(who.u, who.v);
      mesh.position.set(x, y, z);
      mesh.rotation.y = heading;
      mesh.visible = true;
      animatePerson(mesh, who.walk, Math.min(1, 0.6), { throwing: who.swing > 0.12 });
      // Paddle in the right hand, out front during a swing
      const side = who.swing > 0 ? 0.25 : 0.42, fwd = who.swing > 0 ? 0.55 : 0.2;
      const hx = Math.sin(heading), hz = Math.cos(heading), rx = -hz, rz = hx; // right of facing
      paddle.position.set(x - rx * side + hx * fwd, y + (who.swing > 0 ? 1.35 : 1.0), z - rz * side + hz * fwd);
      paddle.rotation.y = heading;
    };
    place(pm, this.me, face, this.paddles[0]);
    place(this.opMesh, this.op, face + Math.PI, this.paddles[1]);
    const b = this.ball;
    this.ballMesh.visible = this.shadow.visible = !!b;
    if (b) {
      const [x, y, z] = this.W(b.u, b.v, b.h);
      this.ballMesh.position.set(x, y, z);
      const [sx, sy, sz] = this.W(b.u, b.v, 0.06);
      this.shadow.position.set(sx, sy, sz);
      this.hist.unshift([x, y, z]);
      if (this.hist.length > 12) this.hist.length = 12;
    }
    // The trail stretches out as the ball speeds up
    this.trail.forEach((m, i) => {
      const p = this.hist[(i + 1) * 2];
      m.visible = !!(b && p && b.speed > 9);
      if (m.visible) m.position.set(...p);
    });
    // Camera behind you, looking down the court
    const cam = this.game.camera;
    // (kept inside the fence so the chain-link isn't in the way)
    // High enough to see the whole court, like a Pong screen tipped back
    const camU = Math.max(this.me.u - 4.5, -(this.court.fenceU ?? 12) + 0.6);
    const [cx, cy, cz] = this.W(camU, this.me.v * 0.25, 8.5);
    cam.position.lerp(new THREE.Vector3(cx, cy, cz), Math.min(1, dt * 5));
    const [lx, ly, lz] = this.W(-0.2, this.me.v * 0.1, 0);
    cam.lookAt(lx, ly, lz);
  }

  dispose() {
    const scene = this.game.scene;
    for (const m of [this.opMesh, this.ballMesh, this.shadow, ...this.paddles, ...this.trail]) scene.remove(m);
    this.hud.remove();
  }
}

// ---------- beach volleyball ----------

const V = { hl: 8, hw: 4, net: 2.43 }; // 16 x 8 m court
const VG = 6.4; // floaty, so there's time to get under it
const CONTACT_H = 1.0; // the height you play most balls at (the ring shows where that is)
const V_WIN = 11;
const BEACH_RIVALS = [['Pastor Dave', 'Coach Ramirez'], ['RA Brooke', 'RA Tyler'], ['Dr. Ellison', 'Dr. Ellison\'s TA'], ['The Smith Hall Twins', ''], ['Grandma Ruth', 'her grandson Kyle']];
const BEACH_MATES = ['Hannah', 'Josiah', 'Abby', 'Caleb', 'Naomi'];

// Two-on-two on the sand. You and a teammate on the near side (u < 0), two campus regulars on
// the far side. Get under the ball and press Space: the receiver passes, the partner sets, and
// the receiver attacks, beach-style. Near the net with a high set, Space jumps and spikes.
// Steer your hits over the net with WASD (left/right picks the line, W deep, S a short dink).
// Rally scoring, first to 11, win by 2.
export class Volleyball {
  constructor(game, court) {
    this.game = game;
    this.court = court;
    this.c = Math.cos(court.a); this.s = Math.sin(court.a);
    this.g = heightAtCampus(court.cx, court.cy);
    const pair = BEACH_RIVALS[Math.floor(Math.random() * BEACH_RIVALS.length)];
    this.opNames = pair[1] ? `${pair[0]} & ${pair[1]}` : pair[0];
    this.mateName = BEACH_MATES[Math.floor(Math.random() * BEACH_MATES.length)];
    const mk = (u, v, team, mesh) => ({ u, v, vu: 0, vv: 0, team, mesh, walk: 0, swing: 0, jump: 0, jv: 0, base: [u, v] });
    const scene = game.scene;
    const look = () => { const l = randomLook(); l.pants = 0x2b2f3a; return l; };
    this.me = mk(-5, -2, 0, game.player.mesh);
    this.mate = mk(-5, 2, 0, makePerson(Object.assign(look(), { shirt: 0x1f4fae })));
    this.ops = [mk(5, -2, 1, makePerson(Object.assign(look(), { shirt: 0xc0392b }))), mk(5, 2, 1, makePerson(Object.assign(look(), { shirt: 0xc0392b })))];
    this.all = [this.me, this.mate, ...this.ops];
    for (const p of [this.mate, ...this.ops]) scene.add(p.mesh);
    this.ball = { u: 0, v: 0, h: 1, vu: 0, vv: 0, vh: 0 };
    this.ballMesh = new THREE.Mesh(new THREE.IcosahedronGeometry(0.17, 1), new THREE.MeshLambertMaterial({ color: 0xf6f1e0, flatShading: true }));
    const stripe = new THREE.Mesh(new THREE.TorusGeometry(0.172, 0.025, 4, 16), mat(0x2a5fb8));
    this.ballMesh.add(stripe);
    scene.add(this.ballMesh);
    this.shadow = new THREE.Mesh(new THREE.CircleGeometry(0.16, 12), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35, depthWrite: false }));
    this.shadow.rotation.x = -Math.PI / 2;
    // Where the ball will come down on your side (green when it's yours to play)
    this.marker = new THREE.Mesh(new THREE.RingGeometry(0.45, 0.62, 24), new THREE.MeshBasicMaterial({ color: 0xffd23f, transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide }));
    this.marker.rotation.x = -Math.PI / 2;
    scene.add(this.shadow, this.marker);
    this.score = [0, 0];
    this.serveTeam = 0;
    this.servers = [this.me, this.ops[0]];
    this.touch = { team: -1, n: 0, last: null };
    this.buffer = 0;
    this.msg = '';
    this.hud = document.createElement('div');
    this.hud.style.cssText = 'position:fixed;left:50%;top:70px;transform:translateX(-50%);background:rgba(15,30,60,0.85);color:#fff;padding:8px 16px;border-radius:12px;font:600 16px system-ui,sans-serif;text-align:center;z-index:20;pointer-events:none;border:2px solid #c9a227;max-width:92vw';
    document.body.appendChild(this.hud);
    this.newServe();
    this.intro = `🏐 You and ${this.mateName} vs ${this.opNames}. First to ${V_WIN}, win by 2.`;
  }

  W(u, v, h = 0) {
    const x = this.court.cx + this.c * u - this.s * v, y = this.court.cy + this.s * u + this.c * v;
    return [x, this.g + h, -y];
  }

  exitPose() {
    const [x, , z] = this.W(clamp(this.me.u, -9, -1), clamp(this.me.v, -4, 4));
    return { x, z, heading: Math.atan2(this.c, -this.s) };
  }

  partner(p) { return p === this.me ? this.mate : p === this.mate ? this.me : p === this.ops[0] ? this.ops[1] : this.ops[0]; }
  side(p) { return p.team === 0 ? -1 : 1; } // which half of the court (sign of u)

  newServe() {
    const srv = this.servers[this.serveTeam];
    this.server = srv;
    this.phase = 'serve';
    this.wait = srv === this.me ? 0.4 : 1.3;
    this.touch = { team: -1, n: 0, last: null };
    this.missed = null;
    this.ball.spike = false;
    for (const p of this.all) { p.vu = p.vv = 0; p.jump = 0; }
    // Everyone to receive positions; the server steps behind the baseline
    this.me.u = -5; this.me.v = -2; this.mate.u = -5; this.mate.v = 2;
    this.ops[0].u = 5; this.ops[0].v = -2; this.ops[1].u = 5; this.ops[1].v = 2;
    srv.u = this.side(srv) * (V.hl + 0.8); srv.v = srv.v > 0 ? 1.5 : -1.5;
    if (srv === this.me) this.msg = 'Your serve: aim with WASD, press Space (📖)';
    this.updateHud();
  }

  // Send the ball from where it is to land at (tu, tv), peaking at `apex` meters
  lob(tu, tv, apex) {
    const b = this.ball;
    apex = Math.max(apex, b.h + 0.3);
    b.vh = Math.sqrt(2 * VG * (apex - b.h));
    const t = (b.vh + Math.sqrt(b.vh * b.vh + 2 * VG * b.h)) / VG;
    b.vu = (tu - b.u) / t; b.vv = (tv - b.v) / t;
  }

  // A hard driven hit (spike/serve) toward (tu, tv) at `speed`, straight down onto it
  drive(tu, tv, speed) {
    const b = this.ball;
    const d = Math.hypot(tu - b.u, tv - b.v), t = d / speed;
    b.vu = (tu - b.u) / t; b.vv = (tv - b.v) / t;
    b.vh = (0 - b.h + 0.5 * VG * t * t) / t;
  }

  // Ball height when it crosses the net on its current path (null if it won't)
  netHeight() {
    const b = this.ball;
    if (Math.abs(b.vu) < 1e-3 || Math.sign(-b.u) !== Math.sign(b.vu)) return null;
    const t = -b.u / b.vu;
    return b.h + b.vh * t - 0.5 * VG * t * t;
  }

  // When the ball next drops to height h (after the peak), and where it is then
  predict(h) {
    const b = this.ball;
    const disc = b.vh * b.vh + 2 * VG * (b.h - h);
    if (disc < 0) return null;
    const t = (b.vh + Math.sqrt(disc)) / VG;
    return { t, u: b.u + b.vu * t, v: b.v + b.vv * t };
  }

  // Where to stand to play the ball on your side: where it drops to contact height
  // (a spike comes in low and fast, so meet it a little lower)
  contactSpot() {
    const b = this.ball;
    const land = this.predict(b.spike ? 0.7 : CONTACT_H);
    return land && land.u < 0 ? land : null;
  }

  // The open spot on the other side: away from both defenders
  gap(team, depth) {
    const sg = team === 0 ? 1 : -1;
    const def = team === 0 ? this.ops : [this.me, this.mate];
    let best = null, bs = -1;
    for (let u = 1.8; u <= 7.4; u += 0.8) {
      for (let v = -3.4; v <= 3.4; v += 0.8) {
        const s = Math.min(...def.map((d) => Math.hypot(d.u - sg * u, d.v - v))) - (depth ? Math.abs(u - depth) * 0.4 : 0);
        if (s > bs) { bs = s; best = [sg * u, v]; }
      }
    }
    return best;
  }

  // `p` plays the ball. Which touch this is decides what they do with it.
  hit(p, aim = null) {
    const b = this.ball, sg = this.side(p);
    if (this.touch.team !== p.team) this.touch = { team: p.team, n: 0, last: null };
    this.touch.n++;
    this.touch.last = p;
    p.swing = 0.3;
    const mate = this.partner(p);
    const ai = p !== this.me;
    this.ball.spike = false;
    this.missed = null;
    const err = ai ? (p.team === 1 ? 1 : 0.6) : 0;
    const overNow = this.touch.n >= 3 || (aim && aim.over);
    this.game.audio.tone(this.touch.n === 3 || overNow ? 300 : 420, 0.06, 'triangle', 0.25);
    if (!overNow) {
      // Pass or set to your partner, close to the net in front of them
      const tu = sg * (this.touch.n === 1 ? 2.6 : 1.4), tv = clamp(mate.v, -3, 3);
      this.lob(tu + (Math.random() - 0.5) * err, tv + (Math.random() - 0.5) * err, this.touch.n === 1 ? 4.6 : 4.2);
      mate.target = [tu, tv];
      return;
    }
    // Over the net (whichever touch it was, it's the other side's ball now)
    this.touch.n = 3;
    let [tu, tv] = this.gap(p.team, aim && aim.depth);
    // Nobody but you finds the gap perfectly
    if (ai) { tu += (Math.random() - 0.5) * 2.4; tv += (Math.random() - 0.5) * 2.4; tu = Math.sign(tu) * clamp(Math.abs(tu), 1.5, V.hl - 0.3); tv = clamp(tv, -V.hw + 0.3, V.hw - 0.3); }
    if (aim && aim.v !== null) tv = aim.v;
    if (aim && aim.depth) tu = -sg * aim.depth;
    const spike = b.h > 2.25 && Math.abs(b.u) < 3.2;
    if (ai && Math.random() < (p.team === 1 ? 0.12 : 0.06)) {
      // Unforced error: long, wide, or into the net
      const r = Math.random();
      if (r < 0.4) tu = -sg * (V.hl + 1.5); else if (r < 0.8) tv = Math.sign(tv || 1) * (V.hw + 1.2);
      else { this.drive(-sg * 1, tv, 12); this.ball.vh = -2; return; }
    }
    if (spike) {
      if (ai) tu = Math.sign(tu) * Math.max(Math.abs(tu), 4.8); // aimed deep enough to clear the net
      // Their spikes are hard but readable; your teammate's (and yours) are the real thing
      this.drive(tu, tv, p.team === 1 ? 10 + Math.random() * 2.5 : ai ? 13 + Math.random() * 3 : 17);
      this.ball.spike = true;
      // Too flat to clear the net from here: hit it higher
      const nh = this.netHeight();
      if (nh !== null && nh < V.net + 0.15) this.lob(tu, tv, 3.6);
      else if (!ai) { this.msg = '💥 Spike!'; p.jump = 0.01; p.jv = 3.2; }
      else { p.jump = 0.01; p.jv = 3.2; }
    } else {
      this.lob(tu, tv, Math.max(4.2, b.h + 1.2));
    }
  }

  serve(p, aim) {
    const b = this.ball, sg = this.side(p);
    b.u = p.u - sg * 0.4; b.v = p.v; b.h = 2.4;
    let [tu, tv] = this.gap(p.team, 5.5);
    if (aim && aim.v !== null) tv = aim.v;
    if (aim && aim.depth) tu = -sg * aim.depth;
    if (p.team === 1 && Math.random() < 0.08) tu = -sg * (V.hl + 1.2); // long
    this.lob(tu, tv, 5.4);
    p.swing = 0.3;
    this.touch = { team: p.team, n: 3, last: p };
    this.phase = 'rally';
    this.game.audio.throw();
  }

  // Where you're steering the ball with the keys
  myAim() {
    const inp = this.game.input;
    const f = inp.forward, t = inp.turn;
    return { v: Math.abs(t) > 0.3 ? -t * 3.2 : null, depth: f > 0.3 ? 7 : f < -0.3 ? 2.2 : 0, over: f > 0.3 };
  }

  point(team, why) {
    this.score[team]++;
    this.msg = `${team === 0 ? '✅ Your point' : `❌ Their point`}: ${why}`;
    if (team === 0) this.game.audio.pickup(); else this.game.audio.bump();
    // Side-out: the team that wins the rally serves, switching servers each time they win it back
    if (this.serveTeam !== team) {
      this.serveTeam = team;
      const pair = team === 0 ? [this.me, this.mate] : this.ops;
      this.servers[team] = this.servers[team] === pair[0] ? pair[1] : pair[0];
    }
    this.phase = 'between';
    this.wait = 1.6;
    const [a, b] = this.score;
    if ((a >= V_WIN || b >= V_WIN) && Math.abs(a - b) >= 2) this.finish(a > b);
    this.updateHud();
  }

  finish(won) {
    const g = this.game;
    if (won) {
      g.toast(`🏆 You and ${this.mateName} beat ${this.opNames} ${this.score[0]}–${this.score[1]}! Sandy high-fives all round.`);
      g.addCredits(100);
      g.goodDeed(30);
      g.audio.win();
    } else {
      g.toast(`🏐 ${this.opNames} win ${this.score[1]}–${this.score[0]}. You helped rake the court afterwards. (+20 for sportsmanship)`);
      g.addCredits(20);
    }
    this.phase = 'done';
    this.wait = 2.5;
  }

  // Run toward (tu, tv), stopping smoothly
  run(p, tu, tv, speed, dt) {
    const du = tu - p.u, dv = tv - p.v, d = Math.hypot(du, dv);
    const want = d < 0.1 ? 0 : Math.min(speed, d * 3);
    const wu = d > 0 ? (du / d) * want : 0, wv = d > 0 ? (dv / d) * want : 0;
    const acc = 14 * dt;
    const eu = wu - p.vu, ev = wv - p.vv, el = Math.hypot(eu, ev);
    if (el > acc) { p.vu += (eu / el) * acc; p.vv += (ev / el) * acc; } else { p.vu = wu; p.vv = wv; }
  }

  // Can `p` reach the ball right now?
  inReach(p) {
    const b = this.ball;
    // AI hitters time their jump for the attack; you jump with Space near the net
    const attacking = p !== this.me && this.touch.team === p.team && this.touch.n === 2 && Math.abs(p.u) < 2.8;
    const top = p.jump > 0 || attacking ? 3.5 : 2.7;
    // You get a generous reach (more when diving for a spike); AI defenders a bit less
    const reach = p === this.me ? (b.spike ? 1.8 : 1.5) : 1.6;
    return Math.hypot(b.u - p.u, b.v - p.v) < reach && b.h > 0.25 && b.h < top && Math.sign(b.u || -1) === this.side(p);
  }

  // Who on `team` should play the next ball
  receiver(team) {
    const pair = team === 0 ? [this.me, this.mate] : this.ops;
    if (this.touch.team === team && this.touch.last) return this.partner(this.touch.last);
    const land = this.predict(1.0);
    if (!land) return pair[0];
    const d = pair.map((p) => Math.hypot(p.u - land.u, p.v - land.v));
    return d[0] <= d[1] ? pair[0] : pair[1];
  }

  update(dt) {
    const g = this.game, inp = g.input;
    if (inp.wasPressed('action')) { g.toast('🏐 You left the court. Good game!'); g.endSport(); return; }
    // Space arms your hit for a second: you play the ball as soon as it's in reach
    this.buffer = Math.max(0, this.buffer - dt);
    if (inp.wasPressed('throw')) this.buffer = 1.0;
    for (const p of this.all) {
      p.swing = Math.max(0, p.swing - dt);
      if (p.jump > 0) { p.jump += p.jv * dt; p.jv -= 9.8 * dt; if (p.jump <= 0) { p.jump = 0; p.jv = 0; } }
    }
    if (this.phase === 'done') { this.wait -= dt; if (this.wait <= 0) g.endSport(); this.draw(dt); return; }
    if (this.phase === 'between') { this.wait -= dt; if (this.wait <= 0) { this.msg = ''; this.newServe(); } this.draw(dt); return; }

    // You: run around your half (and a little beyond the lines)
    const sp = inp.isDown('sprint') ? 6.4 : 5.2;
    const f = inp.forward, t = inp.turn;
    const me = this.me;
    if (this.phase === 'serve' && this.server === me) {
      me.v = clamp(me.v - t * 3 * dt, -V.hw + 0.3, V.hw - 0.3);
      me.vu = me.vv = 0;
    } else {
      this.run(me, me.u + f * 3, me.v - t * 3, (Math.abs(f) + Math.abs(t) > 0.1 ? sp : 0), dt);
      if (Math.abs(f) + Math.abs(t) < 0.1) { me.vu *= Math.max(0, 1 - dt * 10); me.vv *= Math.max(0, 1 - dt * 10); }
      // Once you're close, you get pulled the last couple of steps under a ball that's yours
      const spot = this.phase === 'rally' && this.recv === me ? this.contactSpot() : null;
      if (spot) {
        const du = spot.u - me.u, dv = spot.v - me.v, d = Math.hypot(du, dv);
        if (d > 0.15 && d < 2.6) { const k = Math.min(1, dt * 4); me.u += du * k; me.v += dv * k; }
      }
    }

    const b = this.ball;
    if (this.phase === 'serve') {
      const srv = this.server;
      b.u = srv.u - this.side(srv) * 0.3; b.v = srv.v + 0.3; b.h = 1.2; b.vu = b.vv = b.vh = 0;
      this.wait -= dt;
      if (srv === me) {
        if (this.buffer > 0 && this.wait <= 0) { this.buffer = 0; this.msg = ''; this.serve(me, this.myAim()); }
      } else if (this.wait <= 0) { this.msg = ''; this.serve(srv, null); }
      this.position(dt, true);
      this.move(dt);
      this.draw(dt);
      return;
    }

    // Rally
    const prevU = b.u;
    b.u += b.vu * dt; b.v += b.vv * dt; b.h += b.vh * dt; b.vh -= VG * dt;
    // Into the net?
    if ((prevU < 0) !== (b.u < 0) && b.h < V.net + 0.05 && Math.abs(b.v) < V.hw + 0.6) {
      b.u = prevU < 0 ? -0.15 : 0.15; b.vu = 0; b.vv *= 0.2; b.vh = Math.min(b.vh, 0);
      const last = this.touch.last;
      this.game.audio.tone(200, 0.1, 'sine', 0.15);
      this.netFault = last ? last.team : 0;
    }
    if (b.h <= 0.17) {
      b.h = 0.17;
      const inCourt = Math.abs(b.u) <= V.hl + 0.1 && Math.abs(b.v) <= V.hw + 0.1;
      const hitter = this.touch.last ? this.touch.last.team : 0;
      if (this.netFault !== undefined) { const nf = this.netFault; this.netFault = undefined; this.point(1 - nf, nf === 0 ? 'into the net' : 'into the net on their side'); }
      else if (inCourt) this.point(b.u < 0 ? 1 : 0, b.u < 0 ? 'it landed in your court' : 'it landed in!');
      else this.point(1 - hitter, hitter === 0 ? 'your hit went out' : 'their hit went out');
      this.draw(dt);
      return;
    }

    // Who's playing it
    // Next to play it: the other side once it's been sent over (or served), else the same side
    const recvTeam = this.touch.n >= 3 ? 1 - this.touch.team : this.touch.team;
    this.recv = this.touch.team === recvTeam && this.touch.n >= 3 ? null : this.receiver(recvTeam);
    // AI players hit as soon as they can reach it; you press Space
    for (const p of [this.mate, ...this.ops]) {
      if (p === this.recv && this.inReach(p) && b.vh < 1 && this.touch.last !== p && this.missed !== p) {
        // Digging out a hard spike (or a ball they had to sprint for) doesn't always work
        if (this.touch.team !== p.team) {
          const stretch = Math.hypot(b.u - p.u, b.v - p.v);
          const pDig = p.team === 0 ? (b.spike ? 0.8 : 0.96) - Math.max(0, stretch - 1.2) * 0.3
            : (b.spike ? 0.65 : 0.9) - Math.max(0, stretch - 1) * 0.5;
          if (Math.random() > pDig) {
            this.missed = p;
            if (Math.random() < 0.5) {
              // Shanked off the arms
              b.vu = (Math.random() - 0.5) * 6; b.vv = (Math.random() - 0.5) * 8; b.vh = 3 + Math.random() * 2;
              this.touch = { team: p.team, n: 1, last: p };
              p.swing = 0.3;
              this.game.audio.tone(250, 0.05, 'triangle', 0.2);
            }
            break;
          }
        }
        if (b.h > 2.6) { p.jump = 0.01; p.jv = 3.0; }
        this.hit(p);
        break;
      }
    }
    if (this.buffer > 0 && this.recv === me && this.inReach(me) && this.touch.last !== me) {
      this.buffer = 0;
      // Up at the net on a high ball: jump into it
      if (b.h > 2.0 && Math.abs(me.u) < 3.4) { me.jump = 0.01; me.jv = 3.4; }
      this.hit(me, this.myAim());
      if (!this.msg.startsWith('💥')) this.msg = '';
    }
    // A spike needs a jump: if you're near the net and the set is coming down, jump on Space
    if (this.buffer > 0 && this.recv === me && !this.inReach(me) && me.jump === 0 && Math.abs(me.u) < 3.4 && b.h > 2.6 && b.vh < 0 &&
      Math.hypot(b.u - me.u, b.v - me.v) < 1.8) { me.jump = 0.01; me.jv = 3.4; }
    this.position(dt, false);
    this.move(dt);
    this.draw(dt);
  }

  // AI footwork
  position(dt, serving) {
    const b = this.ball;
    for (const p of [this.mate, ...this.ops]) {
      if (serving && p === this.server) { p.vu = p.vv = 0; continue; }
      const sg = this.side(p), spd = p.team === 1 ? 5.4 : 5.2;
      let tu = sg * 5, tv = p === this.mate ? clamp(this.me.v * -0.5 + 2, -3.2, 3.2) : p.base[1];
      if (!serving && p === this.recv) {
        // Get to where it'll drop to waist height (or under the set, if it's for you)
        const land = this.predict(1.0);
        if (land) { tu = land.u; tv = land.v; }
      } else if (!serving && this.touch.team === p.team && this.touch.last === p) {
        // Just passed: back off for the attack
        tu = sg * 3.8; tv = p.v;
      } else if (!serving && this.touch.team !== p.team && Math.sign(b.u) !== sg) {
        // Other side has it: split the court to defend
        const mateP = this.partner(p);
        tu = sg * 5; tv = p.v >= mateP.v ? 1.8 : -1.8;
      }
      tu = sg * clamp(Math.abs(tu), 0.6, V.hl + 2);
      this.run(p, tu, clamp(tv, -V.hw - 1.5, V.hw + 1.5), spd, dt);
    }
  }

  move(dt) {
    for (const p of this.all) {
      p.u += p.vu * dt; p.v += p.vv * dt;
      // Stay on your own side of the net
      const sg = this.side(p);
      p.u = sg * clamp(sg * p.u, 0.4, V.hl + 3);
      p.v = clamp(p.v, -V.hw - 2.5, V.hw + 2.5);
      p.walk += Math.hypot(p.vu, p.vv) * dt * 2.4;
    }
  }

  updateHud() {
    const touch = this.game.input.isTouch;
    const help = touch ? 'Stick: run to the ring · 📖 as the ball comes down (aim with the stick) · ✋ quit'
      : '<b>WASD</b> run to the ring · <b>Space</b> as the ball comes down (hold <b>A/D</b> to aim, <b>W</b> to send it over, <b>S</b> to dink) · <b>E</b> quit';
    const html = `🏐 <b>You & ${this.mateName} ${this.score[0]}</b> – ${this.score[1]} ${this.opNames}<br><span style="font-weight:400;font-size:13px">${this.msg || help}</span>`;
    if (html !== this._hud) { this.hud.innerHTML = html; this._hud = html; }
  }

  draw(dt) {
    const face = Math.atan2(this.c, -this.s); // heading toward +u
    for (const p of this.all) {
      const [x, y, z] = this.W(p.u, p.v, p.jump);
      p.mesh.position.set(x, y, z);
      p.mesh.rotation.y = p.team === 0 ? face : face + Math.PI;
      p.mesh.visible = true;
      animatePerson(p.mesh, p.walk, Math.min(1, Math.hypot(p.vu, p.vv) / 5), { throwing: p.swing > 0 || p.jump > 0 });
      const parts = p.mesh.userData.parts;
      if (parts && (p.swing > 0 || p.jump > 0)) parts.armL.rotation.x = -2.4;
    }
    const b = this.ball;
    const [bx, by, bz] = this.W(b.u, b.v, b.h);
    this.ballMesh.position.set(bx, by, bz);
    this.ballMesh.rotation.x += dt * 4; this.ballMesh.rotation.z += dt * 2;
    const [sx, sy, sz] = this.W(b.u, b.v, 0.03);
    this.shadow.position.set(sx, sy, sz);
    // Landing marker for balls coming to your side
    const land = this.phase === 'rally' ? this.contactSpot() : null;
    const show = land && b.vh < 6;
    this.marker.visible = !!show;
    if (show) {
      const [mx, my, mz] = this.W(land.u, land.v, 0.05);
      this.marker.position.set(mx, my, mz);
      this.marker.material.color.set(this.recv === this.me ? (this.inReach(this.me) ? 0x4cd964 : 0xffd23f) : 0x9fb4d8);
    }
    // Camera behind your baseline, high enough to see both sides
    const cam = this.game.camera;
    const [cx, cy, cz] = this.W(-15.5, this.me.v * 0.35, 7.5);
    cam.position.lerp(new THREE.Vector3(cx, cy, cz), Math.min(1, dt * 4));
    const [lx, ly, lz] = this.W(0.5, this.me.v * 0.15, 0.6);
    cam.lookAt(lx, ly, lz);
    this.updateHud();
  }

  dispose() {
    const scene = this.game.scene;
    for (const m of [this.mate.mesh, ...this.ops.map((o) => o.mesh), this.ballMesh, this.shadow, this.marker]) scene.remove(m);
    this.hud.remove();
  }
}
