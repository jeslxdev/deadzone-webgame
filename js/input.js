// Entrada: teclado e mouse
export class Input {
  constructor(canvas) {
    this.keys = new Set();
    this.justPressed = new Set();
    this.buttons = new Set();
    this.justClicked = new Set();
    this.mx = innerWidth / 2; this.my = innerHeight / 2;
    this.wheel = 0;
    this.aim = { x: 0, z: 0 };
    this.lookDX = 0; this.lookDY = 0; // deslocamento do mouse no quadro (1ª pessoa)
    this.enabled = true;
    const isTyping = (e) => ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName);
    this._kd = (e) => {
      if (isTyping(e)) return;
      if (!this.keys.has(e.code)) this.justPressed.add(e.code);
      this.keys.add(e.code);
      if (['Space', 'Tab', 'KeyQ', 'KeyF', 'KeyE'].includes(e.code) || e.code.startsWith('Arrow')) e.preventDefault();
    };
    this._ku = (e) => this.keys.delete(e.code);
    this._mm = (e) => { this.mx = e.clientX; this.my = e.clientY; this.lookDX += e.movementX || 0; this.lookDY += e.movementY || 0; };
    this._md = (e) => {
      if (e.target !== canvas && e.target.id !== 'overlay') return;
      this.buttons.add(e.button); this.justClicked.add(e.button);
    };
    this._mu = (e) => this.buttons.delete(e.button);
    this._wh = (e) => { if (e.target === canvas) this.wheel += Math.sign(e.deltaY); };
    this._cm = (e) => { if (e.target === canvas) e.preventDefault(); };
    this._blur = () => { this.keys.clear(); this.buttons.clear(); };
    addEventListener('keydown', this._kd);
    addEventListener('keyup', this._ku);
    addEventListener('mousemove', this._mm);
    addEventListener('mousedown', this._md);
    addEventListener('mouseup', this._mu);
    addEventListener('wheel', this._wh, { passive: true });
    addEventListener('contextmenu', this._cm);
    addEventListener('blur', this._blur);
  }
  key(c) { return this.enabled && this.keys.has(c); }
  pressed(c) { return this.enabled && this.justPressed.has(c); }
  mouseDown(b) { return this.enabled && this.buttons.has(b); }
  clicked(b) { return this.enabled && this.justClicked.has(b); }
  endFrame() { this.justPressed.clear(); this.justClicked.clear(); this.wheel = 0; this.lookDX = 0; this.lookDY = 0; }
  dispose() {
    removeEventListener('keydown', this._kd);
    removeEventListener('keyup', this._ku);
    removeEventListener('mousemove', this._mm);
    removeEventListener('mousedown', this._md);
    removeEventListener('mouseup', this._mu);
    removeEventListener('wheel', this._wh);
    removeEventListener('contextmenu', this._cm);
    removeEventListener('blur', this._blur);
  }
}
