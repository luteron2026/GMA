// Keyboard + touch input, mapped to the same small set of actions.

const KEYMAP = {
  KeyW: 'up', ArrowUp: 'up',
  KeyS: 'down', ArrowDown: 'down',
  KeyA: 'left', ArrowLeft: 'left',
  KeyD: 'right', ArrowRight: 'right',
  Space: 'throw', KeyJ: 'throw',
  KeyE: 'action', KeyF: 'action', Enter: 'action',
  ShiftLeft: 'sprint', ShiftRight: 'sprint', KeyK: 'sprint',
  Escape: 'pause', KeyP: 'pause',
  KeyM: 'mute',
  KeyC: 'camera',
};

export class Input {
  constructor() {
    this.down = new Set();
    this.pressed = new Set();
    this.joy = { x: 0, y: 0, active: false };
    this.touchButtons = new Set();
    this.isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;

    addEventListener('keydown', (e) => {
      const a = KEYMAP[e.code];
      if (!a) return;
      if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
      if (!this.down.has(a)) this.pressed.add(a);
      this.down.add(a);
    });
    addEventListener('keyup', (e) => {
      const a = KEYMAP[e.code];
      if (a) this.down.delete(a);
    });
    addEventListener('blur', () => { this.down.clear(); this.touchButtons.clear(); });
  }

  bindCanvas(canvas) {
    canvas.addEventListener('mousedown', (e) => {
      if (e.button === 0 && !this.isTouch) { this.pressed.add('throw'); }
    });
  }

  bindTouch(root) {
    const stick = root.querySelector('#joystick');
    const knob = root.querySelector('#joystick .knob');
    let pid = null, cx = 0, cy = 0;
    const R = 50;
    const move = (e) => {
      let dx = e.clientX - cx, dy = e.clientY - cy;
      const d = Math.hypot(dx, dy);
      if (d > R) { dx = (dx / d) * R; dy = (dy / d) * R; }
      knob.style.transform = `translate(${dx}px, ${dy}px)`;
      this.joy.x = dx / R;
      this.joy.y = dy / R;
    };
    stick.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      pid = e.pointerId;
      stick.setPointerCapture(pid);
      const r = stick.getBoundingClientRect();
      cx = r.left + r.width / 2; cy = r.top + r.height / 2;
      this.joy.active = true;
      move(e);
    });
    stick.addEventListener('pointermove', (e) => { if (e.pointerId === pid) move(e); });
    const end = (e) => {
      if (e.pointerId !== pid) return;
      pid = null;
      this.joy.active = false; this.joy.x = this.joy.y = 0;
      knob.style.transform = '';
    };
    stick.addEventListener('pointerup', end);
    stick.addEventListener('pointercancel', end);

    for (const btn of root.querySelectorAll('[data-action]')) {
      const a = btn.dataset.action;
      btn.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        btn.setPointerCapture(e.pointerId);
        if (!this.touchButtons.has(a)) this.pressed.add(a);
        this.touchButtons.add(a);
        btn.classList.add('on');
      });
      const up = () => { this.touchButtons.delete(a); btn.classList.remove('on'); };
      btn.addEventListener('pointerup', up);
      btn.addEventListener('pointercancel', up);
    }
  }

  isDown(a) { return this.down.has(a) || this.touchButtons.has(a); }
  wasPressed(a) { return this.pressed.has(a); }

  // -1..1 (positive = forward)
  get forward() {
    let v = (this.isDown('up') ? 1 : 0) - (this.isDown('down') ? 1 : 0);
    if (this.joy.active) v += -this.joy.y;
    return Math.max(-1, Math.min(1, v));
  }

  // -1..1 (positive = right)
  get turn() {
    let v = (this.isDown('right') ? 1 : 0) - (this.isDown('left') ? 1 : 0);
    if (this.joy.active) v += this.joy.x;
    return Math.max(-1, Math.min(1, v));
  }

  endFrame() { this.pressed.clear(); }
}
