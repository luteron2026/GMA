// Soccer on the Intramural Sports Field: real goals with nets at both ends, and a playable
// 4-a-side game (three outfield players and a keeper each). You play for the blue side with
// two teammates and a keeper; dribble by running with the ball, pass, call for the ball,
// tackle and shoot. First to 3 goals, or whoever leads when the clock runs out.
import * as THREE from 'three';
import { CAMPUS } from './data/campus.js';
import { heightAtCampus } from './terrain.js';
import { clamp } from './physics.js';
import { makeLabel, makePerson, randomLook, animatePerson } from './models.js';

export const GOAL_W = 6.4, GOAL_H = 2.3, GOAL_D = 1.8;

// The field's frame (campus space): u along the field toward the far goal, v across it.
// The lines sit 1.5 m inside the mowed area, like the painted pitch on the stadium field.
export function planPitch() {
  const f = CAMPUS.lawns.find((l) => l.kind === 'field' && l.lines);
  if (!f) return null;
  let [cx, cy, w, h, a] = f.lines;
  if (h > w) { [w, h] = [h, w]; a += Math.PI / 2; }
  const c = Math.cos(a), s = Math.sin(a);
  const hu = (w - 3) / 2, hv = (h - 3) / 2;
  const P = (u, v) => [cx + c * u - s * v, cy + s * u + c * v];
  // Penalty boxes and the center circle scale down to fit an intramural-sized field
  const box = { d: Math.min(16.5, hu * 0.32), w: Math.min(40.3, hv * 1.24) / 2 };
  const m = 1.2;
  return {
    cx, cy, a, c, s, hu, hv, P, box, circle: Math.min(9.15, hv * 0.34), lines: [cx, cy, w, h, a],
    outline: [P(-hu - m, -hv - m), P(hu + m, -hv - m), P(hu + m, hv + m), P(-hu - m, hv + m)],
  };
}

// Field markings on the ground texture (world.js paints them with the other fields)
export function paintPitch(ctx, P, ppm, pitch) {
  const [px, py] = P(pitch.cx, pitch.cy);
  ctx.save();
  ctx.translate(px, py);
  ctx.rotate(-pitch.a); // canvas y points south
  ctx.scale(ppm, ppm);
  ctx.fillStyle = '#f4f4f4';
  ctx.strokeStyle = '#f4f4f4';
  ctx.lineWidth = 0.22;
  const { hu, hv, box } = pitch;
  const add = (sx, sz, x, z) => ctx.fillRect(x - sx / 2, z - sz / 2, sx, sz);
  add(hu * 2, 0.22, 0, -hv); add(hu * 2, 0.22, 0, hv);
  add(0.22, hv * 2, -hu, 0); add(0.22, hv * 2, hu, 0);
  add(0.22, hv * 2, 0, 0);
  ctx.beginPath(); ctx.arc(0, 0, pitch.circle, 0, Math.PI * 2); ctx.stroke();
  ctx.beginPath(); ctx.arc(0, 0, 0.3, 0, Math.PI * 2); ctx.fill();
  for (const sg of [-1, 1]) {
    // Penalty area, goal area and the spot
    add(0.22, box.w * 2, sg * (hu - box.d), 0);
    add(box.d, 0.22, sg * (hu - box.d / 2), -box.w); add(box.d, 0.22, sg * (hu - box.d / 2), box.w);
    const gd = box.d * 0.33, gw = GOAL_W / 2 + gd;
    add(0.22, gw * 2, sg * (hu - gd), 0);
    add(gd, 0.22, sg * (hu - gd / 2), -gw); add(gd, 0.22, sg * (hu - gd / 2), gw);
    ctx.beginPath(); ctx.arc(sg * (hu - box.d * 0.67), 0, 0.25, 0, Math.PI * 2); ctx.fill();
    // Corner arcs
    for (const sv of [-1, 1]) { ctx.beginPath(); ctx.arc(sg * hu, sv * hv, 1, 0, Math.PI * 2); ctx.stroke(); }
  }
  ctx.restore();
}

function netTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const ctx = c.getContext('2d');
  ctx.strokeStyle = 'rgba(245,245,245,0.95)'; ctx.lineWidth = 2;
  ctx.strokeRect(0, 0, 32, 32);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

// Goals: white posts and crossbar, a net box behind, corner flags and a sign
export function buildPitch(world, boxes) {
  const pitch = world.pitch;
  if (!pitch) return;
  const { scene, colliders } = world;
  const netMat = new THREE.MeshLambertMaterial({ map: netTexture(), transparent: true, alphaTest: 0.3, side: THREE.DoubleSide });
  const ang = Math.atan2(pitch.s, pitch.c); // campus angle of +u (how boxes and planes are turned)
  const W3 = (u, v, h) => { const [x, y] = pitch.P(u, v); return [x, heightAtCampus(x, y) + h, -y]; };
  const plane = (w, h, u, v, hgt, rotY, rotX = 0) => {
    const geo = new THREE.PlaneGeometry(w, h);
    const uv = geo.getAttribute('uv');
    for (let k = 0; k < uv.count; k++) uv.setXY(k, uv.getX(k) * w / 0.18, uv.getY(k) * h / 0.18);
    const m = new THREE.Mesh(geo, netMat);
    const [x, y, z] = W3(u, v, hgt);
    m.position.set(x, y, z);
    m.rotation.set(rotX, rotY, 0, 'YXZ');
    scene.add(m);
  };
  for (const sg of [-1, 1]) {
    const gu = sg * pitch.hu;
    const g = heightAtCampus(...pitch.P(gu, 0));
    for (const sv of [-1, 1]) {
      const [x, y] = pitch.P(gu, sv * GOAL_W / 2);
      boxes.add(0xffffff, x, g + GOAL_H / 2, -y, 0.12, GOAL_H, 0.12, 0);
      colliders.addCircle(x, -y, 0.12, 'post', g + GOAL_H);
      // Back stanchions
      const [bx, by] = pitch.P(gu + sg * GOAL_D, sv * GOAL_W / 2);
      boxes.add(0xdedede, bx, g + GOAL_H * 0.45, -by, 0.06, GOAL_H * 0.9, 0.06, 0);
      const [mx, my] = pitch.P(gu + sg * GOAL_D / 2, sv * GOAL_W / 2);
      boxes.add(0xdedede, mx, g + 0.04, -my, GOAL_D, 0.05, 0.05, ang);
      // Side nets
      plane(GOAL_D, GOAL_H, gu + sg * GOAL_D / 2, sv * GOAL_W / 2, GOAL_H / 2, ang);
      // Corner flags
      const [fx, fy] = pitch.P(sg * pitch.hu, sv * pitch.hv);
      const fg = heightAtCampus(fx, fy);
      boxes.add(0xf2f2f2, fx, fg + 0.75, -fy, 0.04, 1.5, 0.04, 0);
      boxes.add(sg > 0 ? 0xc62828 : 0x1f3a6e, fx, fg + 1.35, -fy, 0.36, 0.28, 0.02, ang);
    }
    const [cx, cy] = pitch.P(gu, 0);
    boxes.add(0xffffff, cx, g + GOAL_H, -cy, GOAL_W + 0.12, 0.12, 0.12, ang + Math.PI / 2);
    // Back and roof nets
    plane(GOAL_W, GOAL_H * 0.95, gu + sg * GOAL_D, 0, GOAL_H * 0.475, ang + Math.PI / 2);
    plane(GOAL_W, GOAL_D, gu + sg * GOAL_D / 2, 0, GOAL_H - 0.02, ang + Math.PI / 2, Math.PI / 2);
  }
  const [lx, ly] = pitch.P(0, -pitch.hv - 3);
  const lbl = makeLabel('Intramural Field', 'Walk on and press E for soccer', { width: 11 });
  lbl.position.set(lx, heightAtCampus(lx, ly) + 5, -ly);
  scene.add(lbl);
  world.labels.push(lbl);
}

// ---------- the game ----------

const WIN_GOALS = 3, GAME_TIME = 300; // first to 3, or 5 minutes
const BALL_R = 0.11, G = 9.8;
const ME_RUN = 6.2, ME_SPRINT = 8.2, MATE_RUN = 5.7, OPP_RUN = 5.5, DRIBBLE = 0.9;
const RIVALS = ['the Seminary Saints', 'the Dorm Council XI', 'the Biblical Studies Profs', 'the RA All-Stars', 'Grace Community Church Men\'s League'];
const MATES = ['Josiah', 'Caleb', 'Hannah', 'Micah', 'Abby', 'Eli', 'Naomi', 'Levi'];
const BLUE = 0x1f4fae, RED = 0xc0392b;

export class Soccer {
  constructor(game, pitch) {
    this.game = game;
    this.pitch = pitch;
    // You always attack the goal at +u; the far end of the field from where you walked on
    const p = game.player;
    const [pu] = this.toFrame(p.x, -p.z, pitch);
    this.dir = pu > 0 ? -1 : 1;
    this.hu = pitch.hu; this.hv = pitch.hv;
    this.rival = RIVALS[Math.floor(Math.random() * RIVALS.length)];
    this.score = [0, 0];
    this.clock = GAME_TIME;
    this.charge = -1;
    this.msg = '';
    this.msgT = 0;
    const scene = game.scene;
    this.players = [];
    const names = MATES.slice().sort(() => Math.random() - 0.5);
    // Formation: a keeper, two wide and one up the middle; home spots for the side attacking +u
    const homes = [[-0.96, 0, 'gk'], [-0.42, -0.42, 'f'], [-0.42, 0.42, 'f'], [-0.12, 0, 'f']];
    for (const team of [0, 1]) {
      homes.forEach(([hu, hv, role], i) => {
        const me = team === 0 && i === 3;
        const look = randomLook();
        look.shirt = role === 'gk' ? (team ? 0x2e7d32 : 0xf2c94c) : (team ? RED : BLUE);
        look.pants = 0xf2f2f2;
        const mesh = me ? p.mesh : makePerson(look);
        if (!me) scene.add(mesh);
        const sg = team ? -1 : 1;
        this.players.push({
          team, role, me, mesh, name: me ? 'You' : team ? null : names.pop(),
          home: [sg * hu * this.hu, sg * hv * this.hv], u: 0, v: 0, vu: 0, vv: 0, face: team ? Math.PI : 0,
          walk: Math.random() * 6, kick: 0, cool: 0, think: Math.random() * 0.3, speed: me ? ME_RUN : team ? OPP_RUN : MATE_RUN,
        });
      });
    }
    this.me = this.players[3];
    this.ball = { u: 0, v: 0, h: BALL_R, vu: 0, vv: 0, vh: 0, owner: null, last: null, spin: 0, shot: 0, saveTried: null };
    this.ballMesh = new THREE.Mesh(new THREE.IcosahedronGeometry(BALL_R * 1.6, 1), new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true }));
    // A few dark patches so you can see it roll
    const patch = new THREE.Mesh(new THREE.IcosahedronGeometry(BALL_R * 1.62, 0), new THREE.MeshLambertMaterial({ color: 0x222222, wireframe: true }));
    this.ballMesh.add(patch);
    scene.add(this.ballMesh);
    this.shadow = new THREE.Mesh(new THREE.CircleGeometry(BALL_R * 1.6, 12), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35, depthWrite: false }));
    this.shadow.rotation.x = -Math.PI / 2;
    scene.add(this.shadow);
    // A yellow ring under you so you can find yourself in the scrum
    this.ring = new THREE.Mesh(new THREE.RingGeometry(0.55, 0.72, 24), new THREE.MeshBasicMaterial({ color: 0xffd23f, transparent: true, opacity: 0.85, depthWrite: false, side: THREE.DoubleSide }));
    this.ring.rotation.x = -Math.PI / 2;
    scene.add(this.ring);
    this.hud = document.createElement('div');
    this.hud.style.cssText = 'position:fixed;left:50%;top:70px;transform:translateX(-50%);background:rgba(15,30,60,0.85);color:#fff;padding:8px 16px;border-radius:12px;font:600 16px system-ui,sans-serif;text-align:center;z-index:20;pointer-events:none;border:2px solid #c9a227;max-width:92vw';
    document.body.appendChild(this.hud);
    this.kickoff(1);
    this.intro = `⚽ Kickoff against ${this.rival}! First to ${WIN_GOALS} goals.`;
  }

  toFrame(x, y, pitch = this.pitch) {
    const dx = x - pitch.cx, dy = y - pitch.cy;
    const u = dx * pitch.c + dy * pitch.s, v = -dx * pitch.s + dy * pitch.c;
    return this.dir === -1 ? [-u, -v] : [u, v];
  }

  // Game frame (u toward the goal you attack, v across, h up) -> world
  W(u, v, h = 0) {
    const fu = u * (this.dir || 1), fv = v * (this.dir || 1);
    const [x, y] = this.pitch.P(fu, fv);
    return [x, heightAtCampus(x, y) + h, -y];
  }

  exitPose() {
    const [x, , z] = this.W(this.me.u, this.me.v);
    const [ax, , az] = this.W(this.me.u + 1, this.me.v);
    return { x, z, heading: Math.atan2(ax - x, az - z) };
  }

  say(text, t = 2.2) { this.msg = text; this.msgT = t; }

  // Everyone back to their spots, ball on the center spot for `team`
  kickoff(team) {
    for (const p of this.players) {
      p.u = p.home[0] * (p.role === 'gk' ? 1 : 0.85); p.v = p.home[1]; p.vu = p.vv = 0;
      p.face = p.team ? Math.PI : 0;
    }
    const b = this.ball;
    Object.assign(b, { u: 0, v: 0, h: BALL_R, vu: 0, vv: 0, vh: 0, owner: null, last: null, shot: 0 });
    // The center forward of the kicking side stands on the ball
    const taker = this.players.find((p) => p.team === team && p.role === 'f' && Math.abs(p.home[1]) < 0.1);
    taker.u = team ? 0.6 : -0.6; taker.v = 0;
    this.restart = { taker, wait: 1.6, u: 0, v: 0, kind: 'kickoff' };
  }

  // Throw-ins, corners and goal kicks: the ball sits on the spot until the taker plays it
  setPiece(kind, team, u, v) {
    const b = this.ball;
    Object.assign(b, { u, v, h: BALL_R, vu: 0, vv: 0, vh: 0, owner: null, shot: 0 });
    let taker;
    if (kind === 'goal kick') taker = this.players.find((p) => p.team === team && p.role === 'gk');
    else {
      const cands = this.players.filter((p) => p.team === team && p.role === 'f');
      // You take your side's set pieces when you're closest
      taker = cands.sort((a, c) => Math.hypot(a.u - u, a.v - v) - Math.hypot(c.u - u, c.v - v))[0];
    }
    const out = Math.sign(u) || 1, side = Math.sign(v) || 1;
    taker.u = kind === 'throw-in' ? u : u + (kind === 'corner' ? out * 0.6 : -out * 0.8);
    taker.v = kind === 'throw-in' ? v + side * 0.5 : v + (kind === 'corner' ? side * 0.6 : 0);
    taker.vu = taker.vv = 0;
    // Nobody crowds the taker
    for (const p of this.players) {
      if (p === taker) continue;
      const d = Math.hypot(p.u - u, p.v - v);
      if (d < 6) { const k = 6 / Math.max(d, 0.1); p.u = u + (p.u - u) * k; p.v = clamp(v + (p.v - v) * k, -this.hv, this.hv); }
    }
    this.restart = { taker, wait: taker.me ? 0.3 : 1.1, u, v, kind };
    const who = team === 0 ? 'Our' : 'Their';
    this.say(`${who} ${kind}${taker.me ? ': pass (Shift) or shoot (Space)' : ''}`);
  }

  // ---------- ball ----------

  // Kick from `p` toward (tu, tv) at `speed`, lifted by `loft` m/s
  kick(p, tu, tv, speed, loft = 0, shot = false) {
    const b = this.ball;
    const du = tu - b.u, dv = tv - b.v, d = Math.hypot(du, dv) || 1;
    b.owner = null;
    b.vu = (du / d) * speed; b.vv = (dv / d) * speed; b.vh = loft;
    b.h = Math.max(b.h, BALL_R + 0.02);
    b.last = p;
    b.shot = shot ? speed : 0;
    b.saveTried = null;
    p.cool = 0.35;
    p.kick = 0.3;
    this.game.audio.tone(shot ? 160 : 220, 0.07, 'triangle', shot ? 0.35 : 0.2);
  }

  // Pass to `m`, leading a runner, along the ground (lofted when it's long)
  pass(p, m) {
    const lead = 0.5;
    const tu = m.u + m.vu * lead, tv = m.v + m.vv * lead;
    const d = Math.hypot(tu - this.ball.u, tv - this.ball.v);
    const long = d > 24;
    const speed = long ? clamp(7 + d * 0.38, 12, 21) : clamp(5 + d * 0.62, 7, 19);
    this.kick(p, tu, tv, speed, long ? clamp(d * 0.2, 3, 7) : 0.4);
    m.wantsBall = 0.8;
  }

  // Shoot at the goal the player attacks: aim is -1..1 across the mouth, power 0..1
  shoot(p, aim, power) {
    const sg = p.team ? -1 : 1;
    const tu = sg * (this.hu + 1), tv = sg * aim * (GOAL_W / 2 - 0.45);
    const speed = 15 + power * 13;
    const d = Math.hypot(tu - this.ball.u, tv - this.ball.v);
    // Harder shots rise; a full-power strike from close range can sail over
    const loft = clamp(0.8 + power * 4.2 - d * 0.03, 0.4, 6);
    this.kick(p, tu, tv, speed, loft, true);
  }

  updateBall(dt) {
    const b = this.ball;
    if (this.celebrate > 0) {
      // In the back of the net: let it drop and settle there
      b.u += b.vu * dt; b.v += b.vv * dt; b.h = Math.max(BALL_R, b.h + b.vh * dt); b.vh -= G * dt;
      b.vu *= Math.exp(-4 * dt); b.vv *= Math.exp(-4 * dt);
      const lim = this.hu + GOAL_D - 0.2;
      if (Math.abs(b.u) > lim) { b.u = Math.sign(b.u) * lim; b.vu = 0; }
      b.v = clamp(b.v, -GOAL_W / 2 + 0.2, GOAL_W / 2 - 0.2);
      return;
    }
    if (b.owner) {
      const o = b.owner;
      if (o.role === 'gk' && o.holding > 0) {
        b.u = o.u + Math.cos(o.face) * 0.35; b.v = o.v + Math.sin(o.face) * 0.35; b.h = 1.15;
      } else {
        // Dribbling: the ball runs just ahead of their feet
        const run = Math.hypot(o.vu, o.vv);
        const lead = 0.55 + run * 0.06;
        const tu = o.u + Math.cos(o.face) * lead, tv = o.v + Math.sin(o.face) * lead;
        const k = Math.min(1, dt * 14);
        b.u += (tu - b.u) * k; b.v += (tv - b.v) * k; b.h = BALL_R;
        b.spin += run * dt / BALL_R;
      }
      b.vu = o.vu; b.vv = o.vv; b.vh = 0;
      return;
    }
    const steps = Math.max(1, Math.ceil(Math.hypot(b.vu, b.vv) * dt / 0.25));
    const h = dt / steps;
    for (let i = 0; i < steps; i++) {
      const pu = b.u;
      b.u += b.vu * h; b.v += b.vv * h; b.h += b.vh * h;
      if (b.h > BALL_R) {
        b.vh -= G * h;
        const drag = Math.exp(-0.05 * h); b.vu *= drag; b.vv *= drag;
      } else {
        b.h = BALL_R;
        if (b.vh < -1.6) { b.vh = -b.vh * 0.45; this.game.audio.tone(140, 0.04, 'sine', 0.08); } else b.vh = 0;
        // Rolling on grass
        const sp = Math.hypot(b.vu, b.vv);
        if (sp > 0) { const ns = Math.max(0, sp - (1.3 + sp * 0.32) * h); b.vu *= ns / sp; b.vv *= ns / sp; }
      }
      b.spin += Math.hypot(b.vu, b.vv) * h / BALL_R;
      // Posts, crossbar and the goal line
      for (const sg of [-1, 1]) {
        const gl = sg * this.hu;
        if ((pu - gl) * (b.u - gl) > 0 || pu === gl) continue;
        const inMouth = Math.abs(b.v) < GOAL_W / 2 - 0.1 && b.h < GOAL_H - 0.08;
        const post = Math.abs(Math.abs(b.v) - GOAL_W / 2) < 0.22 && b.h < GOAL_H + 0.1;
        const bar = Math.abs(b.v) < GOAL_W / 2 + 0.1 && Math.abs(b.h - GOAL_H) < 0.18;
        if ((post || bar) && !inMouth) {
          b.u = gl - sg * 0.05; b.vu = -b.vu * 0.55; b.vv += (Math.random() - 0.5) * 3;
          if (bar) b.vh = -Math.abs(b.vh) * 0.5;
          this.game.audio.tone(1200, 0.12, 'square', 0.12);
          this.say(bar ? '🥅 Off the crossbar!' : '🥅 Off the post!');
          continue;
        }
        if (inMouth) { this.goal(sg > 0 ? 0 : 1); return; }
      }
    }
    // Into the net or out of play
    const last = b.last ? b.last.team : 0;
    if (Math.abs(b.v) > this.hv + 0.25) {
      this.setPiece('throw-in', 1 - last, clamp(b.u, -this.hu + 1, this.hu - 1), Math.sign(b.v) * this.hv);
      return;
    }
    if (Math.abs(b.u) > this.hu + 0.25) {
      const end = Math.sign(b.u); // +1: the goal blue attacks (red defends)
      const defending = end > 0 ? 1 : 0;
      if (last === defending) this.setPiece('corner', 1 - defending, end * this.hu, Math.sign(b.v || 1) * this.hv);
      else this.setPiece('goal kick', defending, end * (this.hu - 5), 0);
    }
  }

  goal(team) {
    this.score[team]++;
    const g = this.game;
    const scorer = this.ball.last;
    if (team === 0) {
      g.audio.win();
      this.say(scorer && scorer.me ? '⚽ GOOOAL! What a strike!' : `⚽ GOAL! ${scorer && scorer.name ? scorer.name : 'Blue'} scores!`, 3);
    } else {
      g.audio.bump();
      this.say(`😬 ${this.rival} score.`, 3);
    }
    this.ball.owner = null;
    if (this.score[team] >= WIN_GOALS) { this.finish(); return; }
    this.celebrate = 2.2;
    this.nextKick = 1 - team;
    // Let it hit the net before the reset
    this.ball.vu *= 0.2; this.ball.vv *= 0.2;
  }

  finish() {
    const g = this.game, [a, b] = this.score;
    if (a > b) {
      g.toast(`🏆 You beat ${this.rival} ${a}–${b}! Handshakes all round and a prayer at midfield.`);
      g.addCredits(120);
      g.goodDeed(30);
      g.audio.win();
    } else if (a === b) {
      g.toast(`🤝 ${a}–${b} draw with ${this.rival}. Everyone agrees it was "a good time of fellowship." (+40)`);
      g.addCredits(40);
    } else {
      g.toast(`⚽ ${this.rival} win ${b}–${a}. You helped pick up the cones afterwards. (+20 for sportsmanship)`);
      g.addCredits(20);
    }
    this.done = 2.5;
  }

  // ---------- players ----------

  // Steer toward (tu, tv), arriving rather than overshooting
  moveTo(p, tu, tv, speed, dt) {
    const du = tu - p.u, dv = tv - p.v, d = Math.hypot(du, dv);
    const want = d < 0.2 ? 0 : Math.min(speed, d * 2.5);
    const wu = d > 0 ? (du / d) * want : 0, wv = d > 0 ? (dv / d) * want : 0;
    this.steer(p, wu, wv, dt);
  }

  steer(p, wu, wv, dt) {
    const acc = 16 * dt;
    const du = wu - p.vu, dv = wv - p.vv, dl = Math.hypot(du, dv);
    if (dl > acc) { p.vu += (du / dl) * acc; p.vv += (dv / dl) * acc; } else { p.vu = wu; p.vv = wv; }
  }

  nearest(team, u, v, filter = () => true) {
    let best = null, bd = Infinity;
    for (const p of this.players) {
      if (p.team !== team || !filter(p)) continue;
      const d = Math.hypot(p.u - u, p.v - v);
      if (d < bd) { bd = d; best = p; }
    }
    return best;
  }

  // How open a pass from the ball to `m` is: distance from the line to the closest opponent
  openness(m) {
    const b = this.ball;
    const du = m.u - b.u, dv = m.v - b.v, L = Math.hypot(du, dv) || 1;
    let worst = 12;
    for (const o of this.players) {
      if (o.team === m.team) continue;
      const t = clamp(((o.u - b.u) * du + (o.v - b.v) * dv) / (L * L), 0, 1);
      worst = Math.min(worst, Math.hypot(b.u + du * t - o.u, b.v + dv * t - o.v));
    }
    return worst;
  }

  bestPass(p, prefer = null) {
    const sg = p.team ? -1 : 1;
    let best = null, bs = -Infinity;
    for (const m of this.players) {
      if (m.team !== p.team || m === p || m.role === 'gk') continue;
      const d = Math.hypot(m.u - p.u, m.v - p.v);
      if (d < 4 || d > 40) continue;
      let s = this.openness(m) * 1.4 + (m.u - p.u) * sg * 0.25 - d * 0.05;
      if (m.me) s += 2.5; // teammates like to give you the ball
      if (prefer) { const a = Math.atan2(m.v - p.v, m.u - p.u); s += Math.cos(a - prefer) * 6; }
      if (s > bs) { bs = s; best = m; }
    }
    return best;
  }

  aiOwner(p, dt) {
    const sg = p.team ? -1 : 1;
    const gu = sg * this.hu;
    const distGoal = Math.hypot(gu - p.u, p.v);
    // Run at goal, drifting toward the middle
    const tu = gu - sg * 2, tv = p.v * 0.6;
    this.moveTo(p, tu, tv, p.speed * 0.9, dt);
    p.think -= dt;
    if (p.think > 0) return;
    p.think = 0.25 + Math.random() * 0.2;
    // Pressure: an opponent close in front
    let press = 99;
    for (const o of this.players) {
      if (o.team === p.team) continue;
      const d = Math.hypot(o.u - p.u, o.v - p.v);
      if ((o.u - p.u) * sg > -1) press = Math.min(press, d);
    }
    if (distGoal < 20 + Math.random() * 6) {
      // Aim away from the keeper
      const gk = this.players.find((q) => q.team !== p.team && q.role === 'gk');
      const away = -Math.sign(gk.v * sg || Math.random() - 0.5); // the side the keeper isn't on
      const aim = clamp(away * (0.55 + Math.random() * 0.4) + (Math.random() - 0.5) * 0.5, -1.3, 1.3);
      this.shoot(p, aim, 0.35 + Math.random() * 0.5);
      return;
    }
    const m = this.bestPass(p);
    const mateCalling = m && m.calling > 0;
    if (m && (mateCalling || (press < 3.2 && Math.random() < 0.8) || (Math.random() < 0.12 && (m.u - p.u) * sg > 3))) this.pass(p, m);
  }

  aiPlayer(p, dt, owner) {
    const b = this.ball, sg = p.team ? -1 : 1;
    if (p.role === 'gk') return this.aiKeeper(p, dt);
    if (owner === p) return this.aiOwner(p, dt);
    const ours = owner && owner.team === p.team;
    const loose = !owner;
    // Chase a loose ball (or press the carrier) if you're the closest of your side
    const chaser = this.nearest(p.team, b.u + b.vu * 0.3, b.v + b.vv * 0.3, (q) => q.role === 'f' && !q.me);
    const youChase = p.team === 0 && Math.hypot(this.me.u - b.u, this.me.v - b.v) < Math.hypot(p.u - b.u, p.v - b.v) - 1;
    if ((loose || !ours) && chaser === p && !youChase) {
      const lead = loose ? 0.35 : 0.15;
      return this.moveTo(p, b.u + b.vu * lead, b.v + b.vv * lead, p.speed, dt);
    }
    if (p.wantsBall > 0 && loose) return this.moveTo(p, b.u + b.vu * 0.4, b.v + b.vv * 0.4, p.speed, dt);
    let tu, tv;
    if (ours) {
      // Get forward into space, spread across the field
      tu = clamp(b.u + sg * (8 + Math.abs(p.home[1]) * 0.15), -this.hu + 4, this.hu - 4);
      tv = p.home[1] * 1.15 + (Math.sin(this.t * 0.7 + p.home[1]) * 3);
      if (Math.abs(p.home[1]) < 1) tv = -Math.sign(b.v || 1) * this.hv * 0.35;
    } else {
      // Fall back between the ball and your goal, shading toward it
      const hu = p.home[0];
      tu = clamp((hu + b.u) / 2 - sg * 3, -this.hu + 3, this.hu - 3);
      tv = p.home[1] * 0.7 + b.v * 0.35;
    }
    this.moveTo(p, tu, tv, p.speed * 0.8, dt);
  }

  aiKeeper(p, dt) {
    const b = this.ball, sg = p.team ? -1 : 1;
    const gl = -sg * this.hu; // own goal line
    if (b.owner === p) {
      // Hold it a moment, then roll or punt it out to a teammate
      p.holding -= dt;
      this.moveTo(p, gl + sg * 2, 0, 2, dt);
      p.face = sg > 0 ? 0 : Math.PI;
      if (p.holding <= 0) {
        const m = this.bestPass(p) || this.players.find((q) => q.team === p.team && q.role === 'f');
        p.holding = 0;
        const d = Math.hypot(m.u - p.u, m.v - p.v);
        this.kick(p, m.u + m.vu * 0.6, m.v + m.vv * 0.6, clamp(8 + d * 0.42, 10, 22), clamp(d * 0.22, 1, 8));
      }
      return;
    }
    // Inside your box and nobody on it? Come and claim it
    const inBox = (gl - b.u) * -sg < this.pitch.box.d && Math.abs(b.v) < this.pitch.box.w;
    const foe = this.nearest(1 - p.team, b.u, b.v);
    if (!b.owner && inBox && Math.hypot(b.u - p.u, b.v - p.v) < Math.hypot(b.u - foe.u, b.v - foe.v) + 1.5 && Math.hypot(b.vu, b.vv) < 9) {
      return this.moveTo(p, b.u, b.v, 5.5, dt);
    }
    // Shot coming: get across to where it'll cross the line
    let tv = clamp(b.v * 0.45, -GOAL_W / 2 + 0.4, GOAL_W / 2 - 0.4);
    if (!b.owner && b.vu * sg < -4) {
      const t = (gl + sg * 0.8 - b.u) / b.vu;
      if (t > 0 && t < 2) tv = clamp(b.v + b.vv * t, -GOAL_W / 2 - 0.3, GOAL_W / 2 + 0.3);
    }
    const out = clamp(14 - Math.abs(b.u - gl), 0, 3.5);
    this.moveTo(p, gl + sg * (0.8 + out), tv, 6.5, dt);
  }

  // Who has the ball: loose balls go to whoever reaches them; carriers can be tackled
  control(dt) {
    const b = this.ball;
    if (b.owner) {
      const o = b.owner;
      if (o.role === 'gk' && o.holding > 0) return;
      for (const q of this.players) {
        if (q.team === o.team || q.cool > 0 || q.role === 'gk') continue;
        const d = Math.hypot(q.u - b.u, q.v - b.v);
        if (d > 0.95) continue;
        // AI defenders win it back sometimes; they're kinder to you than to each other
        const rate = q.me ? 0 : o.me ? 0.9 : 1.4;
        if (Math.random() < rate * dt) this.steal(q, o);
      }
      return;
    }
    for (const q of this.players) {
      if (q.cool > 0) continue;
      const d = Math.hypot(q.u - b.u, q.v - b.v);
      const sg = q.team ? -1 : 1;
      if (q.role === 'gk') {
        const gl = -sg * this.hu;
        const inBox = (gl - b.u) * -sg < this.pitch.box.d && Math.abs(b.v) < this.pitch.box.w + 1;
        if (!inBox || d > 1.6 || b.h > 2.5 || b.saveTried === q) continue;
        if (b.shot) b.saveTried = q; // one try at each shot; slow balls they just gather
        // A fierce, well-placed shot can beat the keeper
        const speed = Math.hypot(b.vu, b.vv);
        const pSave = b.shot ? clamp(1.05 - speed * 0.022 - d * 0.28 - Math.abs(b.v) * 0.06, 0.15, 0.92) : 0.97;
        if (Math.random() < pSave) {
          b.owner = q; b.last = q; q.holding = 1.0; b.shot = 0;
          if (speed > 14) this.say('🧤 Great save!');
          this.game.audio.tone(330, 0.08, 'square', 0.12);
        } else if (d < 1.2 && Math.random() < 0.5) {
          // Parried away
          b.vu = -b.vu * 0.35 + (Math.random() - 0.5) * 2; b.vv = (Math.random() - 0.5) * 8; b.vh = 3;
          b.last = q; b.shot = 0;
          this.say('🧤 Parried!');
        }
        continue;
      }
      if (d < DRIBBLE && b.h < 0.9) {
        b.owner = q; b.last = q; b.shot = 0;
        if (q.me) { this.game.audio.tone(600, 0.04, 'square', 0.06); }
      }
    }
  }

  steal(q, o) {
    const b = this.ball;
    b.owner = q; b.last = q;
    o.cool = 0.6;
    o.vu *= 0.3; o.vv *= 0.3;
    if (q.me) this.say('💪 Won it back!', 1.2);
    else if (o.me) this.say('Tackled!', 1.2);
    this.game.audio.bump();
  }

  // ---------- you ----------

  updateMe(dt, frozen = false) {
    const g = this.game, inp = g.input, me = this.me, b = this.ball;
    // Camera looks down the field toward the goal you attack: up = +u, right = -v
    const f = inp.forward, s = inp.turn;
    const mag = Math.min(1, Math.hypot(f, s));
    const sprint = inp.isDown('sprint');
    const sp = (sprint ? ME_SPRINT : ME_RUN) * (b.owner === me ? 0.9 : 1);
    if (mag > 0.1) {
      const wu = (f / Math.max(mag, 1e-3)) * mag * sp, wv = (-s / Math.max(mag, 1e-3)) * mag * sp;
      this.steer(me, wu, wv, dt * 1.3);
    } else this.steer(me, 0, 0, dt * 1.6);
    if (frozen) return; // waiting for a restart: you can move but not play the ball
    // Pass (or call for it)
    if (inp.wasPressed('sprint')) {
      if (b.owner === me) {
        const dir = mag > 0.1 ? Math.atan2(-s, f) : me.face;
        const m = this.bestPass(me, dir);
        if (m) { this.pass(me, m); this.say(`➡️ To ${m.name}`, 1); }
      } else if (b.owner && b.owner.team === 0 && b.owner.role !== 'gk') {
        b.owner.think = 0;
        me.calling = 1.2;
        this.say(`🙋 "${b.owner.name}! Here!"`, 1);
      }
    }
    // Shoot: hold Space to wind up, let go to strike
    const space = inp.isDown('throw');
    if (b.owner === me) {
      if (inp.wasPressed('throw')) this.charge = 0;
      if (this.charge >= 0 && space) this.charge = Math.min(1, this.charge + dt * 1.25);
      if (this.charge >= 0 && !space) {
        const power = Math.max(0.3, this.charge);
        this.charge = -1;
        // Facing the goal: aim with left/right; facing away: just boot it that way
        const toGoal = Math.cos(me.face) > -0.2;
        if (toGoal) this.shoot(me, clamp(-s + (Math.random() - 0.5) * 0.35, -1.25, 1.25), power);
        else this.kick(me, b.u + Math.cos(me.face) * 30, b.v + Math.sin(me.face) * 30, 12 + power * 12, 2 + power * 5);
      }
    } else {
      this.charge = -1;
      if (inp.wasPressed('throw')) {
        // Loose ball in reach: hit it first time toward goal. Otherwise slide in for a tackle.
        const d = Math.hypot(b.u - me.u, b.v - me.v);
        if (!b.owner && d < 2 && b.h < 1.8) {
          b.u = me.u + Math.cos(me.face) * 0.5; b.v = me.v + Math.sin(me.face) * 0.5;
          if (Math.cos(me.face) > -0.2) this.shoot(me, clamp(-s, -1, 1), 0.65); else this.kick(me, b.u + Math.cos(me.face) * 20, b.v + Math.sin(me.face) * 20, 18, 4);
        } else if (b.owner && b.owner.team === 1 && d < 2.2 && !(b.owner.role === 'gk' && b.owner.holding > 0)) {
          me.kick = 0.35;
          const a = Math.atan2(b.v - me.v, b.u - me.u);
          me.vu += Math.cos(a) * 4; me.vv += Math.sin(a) * 4;
          if (Math.random() < 0.72) this.steal(me, b.owner);
          else { me.cool = 0.5; this.say('Missed the tackle!', 1); }
        }
      }
    }
  }

  // ---------- frame ----------

  update(dt) {
    const g = this.game, inp = g.input;
    this.t = (this.t || 0) + dt;
    if (inp.wasPressed('action')) { g.toast('⚽ You left the match. Good game!'); g.endSport(); return; }
    if (this.done !== undefined) {
      this.done -= dt;
      this.animate(dt);
      if (this.done <= 0) g.endSport();
      return;
    }
    if (this.msgT > 0) { this.msgT -= dt; if (this.msgT <= 0) this.msg = ''; }
    for (const p of this.players) {
      p.cool = Math.max(0, p.cool - dt); p.kick = Math.max(0, p.kick - dt);
      p.wantsBall = Math.max(0, (p.wantsBall || 0) - dt); p.calling = Math.max(0, (p.calling || 0) - dt);
    }
    const b = this.ball;
    if (this.celebrate > 0) {
      for (const p of this.players) this.steer(p, 0, 0, dt);
      this.updateBall(dt);
      this.celebrate -= dt;
      if (this.celebrate <= 0) this.kickoff(this.nextKick);
      this.integrate(dt);
      this.animate(dt);
      return;
    }
    this.clock -= dt;
    if (this.clock <= 0) { this.clock = 0; this.finish(); this.animate(dt); return; }
    if (this.restart) {
      const r = this.restart;
      r.wait -= dt;
      for (const p of this.players) {
        if (p === r.taker) { this.steer(p, 0, 0, dt); continue; }
        if (p.me) { this.updateMe(dt, true); continue; }
        if (r.kind === 'kickoff') this.steer(p, 0, 0, dt); else this.aiPlayer(p, dt, null);
      }
      // Keep the taker on the ball
      r.taker.face = Math.atan2(-r.taker.v, (r.taker.team ? -1 : 1) * 10);
      if (r.wait <= 0) {
        this.restart = null;
        b.owner = r.taker; b.last = r.taker;
        if (r.taker.role === 'gk') r.taker.holding = 0.5;
        else if (!r.taker.me) r.taker.think = 0; // AI takes it straight away
        if (r.taker.me) this.say('Your ball: Space to shoot, Shift to pass', 1.6);
      } else {
        b.u = r.u; b.v = r.v; b.h = BALL_R; b.vu = b.vv = b.vh = 0;
        this.integrate(dt);
        this.animate(dt);
        return;
      }
    }
    const owner = b.owner;
    for (const p of this.players) if (!p.me) this.aiPlayer(p, dt, owner);
    this.updateMe(dt);
    this.integrate(dt);
    this.control(dt);
    this.updateBall(dt);
    this.animate(dt);
  }

  // Move everyone, keep them apart and on the field
  integrate(dt) {
    for (const p of this.players) {
      p.u += p.vu * dt; p.v += p.vv * dt;
      p.u = clamp(p.u, -this.hu - 2, this.hu + 2); p.v = clamp(p.v, -this.hv - 2, this.hv + 2);
      const sp = Math.hypot(p.vu, p.vv);
      if (sp > 0.4) p.face = Math.atan2(p.vv, p.vu);
      p.walk += sp * dt * 2.2;
    }
    for (let i = 0; i < this.players.length; i++) {
      for (let j = i + 1; j < this.players.length; j++) {
        const a = this.players[i], c = this.players[j];
        const du = c.u - a.u, dv = c.v - a.v, d = Math.hypot(du, dv);
        if (d > 0 && d < 0.75) {
          const push = (0.75 - d) / 2;
          a.u -= (du / d) * push; a.v -= (dv / d) * push; c.u += (du / d) * push; c.v += (dv / d) * push;
        }
      }
    }
  }

  animate(dt) {
    const sgn = this.dir;
    const headingOf = (face) => {
      // Frame angle -> world heading (meshes face +z, heading = atan2(dx, dz))
      const fu = Math.cos(face) * sgn, fv = Math.sin(face) * sgn;
      const dx = this.pitch.c * fu - this.pitch.s * fv, dy = this.pitch.s * fu + this.pitch.c * fv;
      return Math.atan2(dx, -dy);
    };
    for (const p of this.players) {
      const [x, y, z] = this.W(p.u, p.v);
      p.mesh.position.set(x, y, z);
      p.mesh.rotation.y = headingOf(p.face);
      p.mesh.visible = true;
      const sp = Math.hypot(p.vu, p.vv);
      animatePerson(p.mesh, p.walk, Math.min(1, sp / 6), { throwing: p.role === 'gk' && p.holding > 0 });
      const parts = p.mesh.userData.parts;
      if (p.kick > 0 && parts) parts.legR.rotation.x = -1.3 * Math.sin((p.kick / 0.3) * Math.PI);
      if (p.calling > 0 && parts) parts.armL.rotation.x = -2.6;
    }
    const b = this.ball;
    const [bx, by, bz] = this.W(b.u, b.v, b.h);
    this.ballMesh.position.set(bx, by, bz);
    this.ballMesh.rotation.set(b.spin, b.spin * 0.3, 0);
    const [sx, sy, sz] = this.W(b.u, b.v, 0.03);
    this.shadow.position.set(sx, sy, sz);
    const [rx, ry, rz] = this.W(this.me.u, this.me.v, 0.04);
    this.ring.position.set(rx, ry, rz);
    // Camera behind you, looking up the field; pulled back a bit to keep the ball in view
    const me = this.me;
    const fu = (me.u + b.u) / 2, fv = (me.v * 0.6 + b.v * 0.4);
    const cam = this.game.camera;
    const [cx, cy, cz] = this.W(Math.min(me.u, b.u) - 13, fv * 0.8, 10);
    const k = Math.min(1, dt * 3.5);
    cam.position.lerp(new THREE.Vector3(cx, cy, cz), k);
    const [lx, ly, lz] = this.W(fu + 5, fv, 0);
    this._look = this._look || new THREE.Vector3(lx, ly, lz);
    this._look.lerp(new THREE.Vector3(lx, ly, lz), k);
    cam.lookAt(this._look);
    this.updateHud();
  }

  updateHud() {
    const touch = this.game.input.isTouch;
    const help = touch
      ? 'Stick: run · 📖 hold &amp; release to shoot / tackle · ⚡ pass (or call for it) · ✋ quit'
      : '<b>WASD</b> run · <b>Space</b> hold &amp; release to shoot (A/D aims), tackle · <b>Shift</b> pass / call for it (hold to sprint) · <b>E</b> quit';
    const m = Math.floor(this.clock / 60), s = Math.floor(this.clock % 60);
    let power = '';
    if (this.charge >= 0) {
      const n = Math.round(this.charge * 10);
      power = `<br><span style="color:#ffd23f;letter-spacing:1px">Power ${'█'.repeat(n)}${'░'.repeat(10 - n)}</span>`;
    }
    const html = `⚽ <span style="color:#7fb2ff">Blue (you) ${this.score[0]}</span> – <span style="color:#ff8a7a">${this.score[1]} ${this.rival}</span> · ${m}:${String(s).padStart(2, '0')}` +
      `<br><span style="font-weight:400;font-size:13px">${this.msg || help}</span>${power}`;
    if (html !== this._hud) { this.hud.innerHTML = html; this._hud = html; }
  }

  dispose() {
    const scene = this.game.scene;
    for (const p of this.players) if (!p.me) scene.remove(p.mesh);
    for (const m of [this.ballMesh, this.shadow, this.ring]) scene.remove(m);
    this.hud.remove();
  }
}

