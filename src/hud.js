// DOM heads-up display + minimap.

const $ = (id) => document.getElementById(id);

export class HUD {
  constructor(game) {
    this.game = game;
    this.el = $('hud');
    this.starsEl = $('stars');
    this.creditsEl = $('credits');
    this.joyEl = $('joy-fill');
    this.objEl = $('objective');
    this.timerEl = $('timer');
    this.promptEl = $('prompt');
    this.toastsEl = $('toasts');
    this.bigEl = $('bigmsg');
    this.vehEl = $('vehicle');
    this.clockEl = $('clock');
    this.hurtEl = $('hurt');
    this.mini = $('minimap');
    this.mctx = this.mini.getContext('2d');
    this.lastStars = -1;
    this.lastCredits = -1;
    this.bigTimer = null;
    this.buildMapImage();
  }

  buildMapImage() {
    const w = this.game.world;
    const b = w.bounds;
    const scale = 2; // px per meter in the cached image
    const c = document.createElement('canvas');
    c.width = (b.maxX - b.minX + 80) * scale;
    c.height = (b.maxZ - b.minZ + 80) * scale;
    const ctx = c.getContext('2d');
    const tx = (x) => (x - b.minX + 40) * scale, tz = (z) => (z - b.minZ + 40) * scale;
    ctx.fillStyle = '#8b8a5c';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.fillStyle = '#9fb36a';
    ctx.fillRect(tx(b.minX), tz(b.minZ), (b.maxX - b.minX) * scale, (b.maxZ - b.minZ) * scale);
    const poly = (pts, fill) => {
      ctx.beginPath();
      pts.forEach(([x, z], i) => (i ? ctx.lineTo(tx(x), tz(z)) : ctx.moveTo(tx(x), tz(z))));
      ctx.closePath(); ctx.fillStyle = fill; ctx.fill();
    };
    const colors = { quad: '#7dbb52', field: '#5ea844', track: '#b9614a', diamond: '#c49a66', dirt: '#c4a676', wash: '#ddd0aa', grass: '#8fb85e' };
    for (const l of w.data.lawns) {
      if (l.circle) {
        ctx.beginPath(); ctx.arc(tx(l.circle[0]), tz(-l.circle[1]), l.circle[2] * scale, 0, Math.PI * 2);
        ctx.fillStyle = colors[l.kind]; ctx.fill();
      } else poly(l.poly.map(([x, y]) => [x, -y]), colors[l.kind] || '#8fb85e');
    }
    for (const l of w.lots) poly(l.wpts, '#6b6e74');
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (const r of w.roads) {
      ctx.beginPath();
      r.wpts.forEach(([x, z], i) => (i ? ctx.lineTo(tx(x), tz(z)) : ctx.moveTo(tx(x), tz(z))));
      if (r.loop) ctx.closePath();
      ctx.strokeStyle = r.dirt ? '#b49562' : '#3d4046';
      ctx.lineWidth = r.width * scale;
      ctx.stroke();
    }
    for (const bd of w.buildings) poly(bd.wpts, bd.id === 'chapel' ? '#ffffff' : bd.dorm ? '#e9c98a' : '#d9cdb5');
    this.mapImg = c;
    this.mapScale = scale;
    this.mapOrigin = [b.minX - 40, b.minZ - 40];
  }

  drawMinimap() {
    const g = this.game, ctx = this.mctx, cv = this.mini;
    const W = cv.width, H = cv.height;
    const p = g.player;
    const zoom = 1.4; // canvas px per meter
    const s = zoom / this.mapScale;
    ctx.save();
    ctx.clearRect(0, 0, W, H);
    ctx.beginPath(); ctx.arc(W / 2, H / 2, W / 2 - 2, 0, Math.PI * 2); ctx.clip();
    ctx.fillStyle = '#8b8a5c'; ctx.fillRect(0, 0, W, H);
    // Rotate so the player's heading is up
    ctx.translate(W / 2, H / 2);
    ctx.rotate(p.heading - Math.PI);
    const ox = (p.x - this.mapOrigin[0]) * this.mapScale, oz = (p.z - this.mapOrigin[1]) * this.mapScale;
    ctx.scale(s, s);
    ctx.drawImage(this.mapImg, -ox, -oz);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    // Blips
    const toMini = (x, z) => {
      const dx = (x - p.x) * zoom, dz = (z - p.z) * zoom;
      // rotate by the same transform as the map
      const rx = dx * Math.cos(p.heading - Math.PI) - dz * Math.sin(p.heading - Math.PI);
      const rz = dx * Math.sin(p.heading - Math.PI) + dz * Math.cos(p.heading - Math.PI);
      return [W / 2 + rx, H / 2 + rz];
    };
    const clampEdge = ([x, y]) => {
      const dx = x - W / 2, dy = y - H / 2, d = Math.hypot(dx, dy), R = W / 2 - 8;
      if (d > R) return [W / 2 + (dx / d) * R, H / 2 + (dy / d) * R, true];
      return [x, y, false];
    };
    for (const e of g.allEnemies()) {
      if (e.dead) continue;
      const [x, y, edge] = clampEdge(toMini(e.x, e.z));
      if (edge) continue;
      ctx.fillStyle = '#e0241b';
      ctx.beginPath(); ctx.arc(x, y, e.radius > 1 ? 6 : 3, 0, Math.PI * 2); ctx.fill();
    }
    for (const m of g.missions.blips()) {
      const [x, y, edge] = clampEdge(toMini(m.x, m.z));
      ctx.fillStyle = m.color;
      ctx.strokeStyle = '#1a1a1a'; ctx.lineWidth = 2;
      ctx.beginPath();
      if (m.kind === 'target') { ctx.arc(x, y, edge ? 6 : 7, 0, Math.PI * 2); }
      else { ctx.rect(x - 5, y - 5, 10, 10); }
      ctx.fill(); ctx.stroke();
      if (m.letter && !edge) {
        ctx.fillStyle = '#1a1a1a'; ctx.font = 'bold 9px Arial'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(m.letter, x, y + 0.5);
      }
    }
    // Player arrow
    ctx.fillStyle = '#ffffff'; ctx.strokeStyle = '#1f3a6e'; ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(W / 2, H / 2 - 8); ctx.lineTo(W / 2 + 6, H / 2 + 6); ctx.lineTo(W / 2, H / 2 + 3); ctx.lineTo(W / 2 - 6, H / 2 + 6);
    ctx.closePath(); ctx.fill(); ctx.stroke();
    // North marker
    const [nx, ny] = clampEdge(toMini(p.x, p.z - 10000));
    ctx.fillStyle = '#fff'; ctx.font = 'bold 12px Arial'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('N', nx, ny);
    ctx.restore();
    ctx.strokeStyle = 'rgba(255,255,255,0.8)'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(W / 2, H / 2, W / 2 - 2, 0, Math.PI * 2); ctx.stroke();
  }

  update() {
    const g = this.game;
    const stars = g.stars;
    if (stars !== this.lastStars) {
      this.lastStars = stars;
      let html = '';
      for (let i = 0; i < 5; i++) html += `<span class="star ${i < stars ? 'on' : ''}">★</span>`;
      this.starsEl.innerHTML = html;
      this.starsEl.classList.toggle('pulse', stars > 0);
    }
    const c = Math.floor(g.save.credits);
    if (c !== this.lastCredits) {
      this.lastCredits = c;
      this.creditsEl.textContent = c.toLocaleString();
    }
    this.joyEl.style.width = `${g.player.joy}%`;
    this.joyEl.classList.toggle('low', g.player.joy < 30);
    const v = g.player.vehicle;
    this.vehEl.textContent = v ? `${v.name} · ${Math.round(Math.abs(v.speed) * 2.237)} mph` : '';
    this.clockEl.textContent = g.clockText();
    this.drawMinimap();
  }

  setObjective(text) {
    this.objEl.innerHTML = text || '';
    this.objEl.style.display = text ? 'block' : 'none';
  }

  setTimer(sec, label) {
    if (sec == null) { this.timerEl.style.display = 'none'; return; }
    this.timerEl.style.display = 'block';
    if (label) { this.timerEl.textContent = label; return; }
    const m = Math.floor(sec / 60), s = Math.floor(sec % 60);
    this.timerEl.textContent = `${m}:${String(s).padStart(2, '0')}`;
    this.timerEl.classList.toggle('urgent', sec < 10);
  }

  setPrompt(text) {
    if (this.promptText === text) return;
    this.promptText = text;
    const key = this.game.input.isTouch ? '' : '<kbd>E</kbd> ';
    this.promptEl.innerHTML = text ? key + text : '';
    this.promptEl.style.display = text ? 'block' : 'none';
  }

  toast(text, cls = '') {
    const d = document.createElement('div');
    d.className = 'toast ' + cls;
    d.innerHTML = text;
    this.toastsEl.appendChild(d);
    while (this.toastsEl.children.length > 4) this.toastsEl.firstChild.remove();
    setTimeout(() => d.classList.add('out'), 3200);
    setTimeout(() => d.remove(), 3800);
  }

  big(title, sub, cls = '') {
    this.bigEl.innerHTML = `<div class="big-title ${cls}">${title}</div>${sub ? `<div class="big-sub">${sub}</div>` : ''}`;
    this.bigEl.classList.add('show');
    clearTimeout(this.bigTimer);
    this.bigTimer = setTimeout(() => this.bigEl.classList.remove('show'), 3800);
  }

  flashHurt() {
    this.hurtEl.classList.remove('flash');
    void this.hurtEl.offsetWidth;
    this.hurtEl.classList.add('flash');
  }
}
