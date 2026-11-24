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
    if (inp.wasPressed('action')) { g.toast('🏓 You left the court. Good game!'); g.endPickleball(); return; }
    if (this.phase === 'done') { this.wait -= dt; if (this.wait <= 0) g.endPickleball(); this.draw(dt); return; }
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
