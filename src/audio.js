// Tiny synthesized sound effects (no audio files to download).

export class Audio {
  constructor() {
    this.ctx = null;
    this.muted = false;
    try { this.muted = localStorage.getItem('gma-muted') === '1'; } catch { /* ignore */ }
  }

  unlock() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.5;
    this.master.connect(this.ctx.destination);
    // Engine hum
    this.engine = this.ctx.createOscillator();
    this.engine.type = 'sawtooth';
    this.engineGain = this.ctx.createGain();
    this.engineGain.gain.value = 0;
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 600;
    this.engine.connect(lp); lp.connect(this.engineGain); this.engineGain.connect(this.master);
    this.engine.frequency.value = 50;
    this.engine.start();
    this.noiseBuf = this.ctx.createBuffer(1, this.ctx.sampleRate * 0.5, this.ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }

  toggleMute() {
    this.muted = !this.muted;
    try { localStorage.setItem('gma-muted', this.muted ? '1' : '0'); } catch { /* ignore */ }
    if (this.master) this.master.gain.value = this.muted ? 0 : 0.5;
    return this.muted;
  }

  tone(freq, dur = 0.15, type = 'sine', vol = 0.3, when = 0, slide = 0) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + when;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + dur + 0.05);
  }

  noise(dur = 0.2, vol = 0.3, freq = 1200, when = 0) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + when;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = this.ctx.createBiquadFilter();
    f.type = 'bandpass'; f.frequency.value = freq;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f); f.connect(g); g.connect(this.master);
    src.start(t); src.stop(t + dur);
  }

  throw() { this.noise(0.15, 0.25, 2400); }
  hit() { this.tone(180, 0.12, 'square', 0.2, 0, -100); this.noise(0.08, 0.2, 800); }
  banish() { this.tone(660, 0.12, 'triangle', 0.25); this.tone(990, 0.2, 'triangle', 0.2, 0.08); this.noise(0.3, 0.15, 3000); }
  hurt() { this.tone(220, 0.25, 'sawtooth', 0.2, 0, -120); }
  deed() { [523, 659, 784, 1046].forEach((f, i) => this.tone(f, 0.35, 'triangle', 0.18, i * 0.07)); }
  pickup() { this.tone(880, 0.1, 'square', 0.12); this.tone(1320, 0.15, 'square', 0.12, 0.06); }
  fail() { [392, 330, 262].forEach((f, i) => this.tone(f, 0.35, 'triangle', 0.2, i * 0.18)); }
  bump() { this.noise(0.12, 0.3, 300); }
  bell() { [0, 0.6, 1.2].forEach((w) => { this.tone(392, 1.2, 'sine', 0.25, w); this.tone(784, 0.8, 'sine', 0.08, w); }); }
  imp() { this.tone(500 + Math.random() * 200, 0.18, 'square', 0.06, 0, 300); }
  horn() {
    // "Hallelujah horn": a bright major chord
    [392, 494, 587, 784].forEach((f) => this.tone(f, 0.7, 'sawtooth', 0.07));
  }
  beep() { this.tone(440, 0.12, 'square', 0.1); this.tone(440, 0.12, 'square', 0.1, 0.18); }
  win() {
    const seq = [523, 659, 784, 1046, 784, 1046, 1318];
    seq.forEach((f, i) => this.tone(f, 0.3, 'triangle', 0.2, i * 0.11));
  }

  setEngine(speedFrac, on) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.engineGain.gain.setTargetAtTime(on ? 0.05 + speedFrac * 0.05 : 0, t, 0.1);
    this.engine.frequency.setTargetAtTime(45 + speedFrac * 110, t, 0.1);
  }
}
