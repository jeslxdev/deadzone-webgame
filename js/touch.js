// ============================================================
//  CONTROLES DE TOQUE (celular / tablet)
//  · Joystick flutuante à esquerda: movimento analógico
//  · Botão de ataque: segure para atacar; arraste para mirar
//    (sem arrastar = mira automática no inimigo mais próximo)
//  · Pesado, esquiva, pulo, 4 habilidades, itens, saquear,
//    recarregar, mochila, pausa e tela cheia
//  Os toques são convertidos nas mesmas entradas do teclado/mouse.
// ============================================================
import { SKILLS } from './data.js';
import { skillCooldown } from './skills.js';
import { icon } from './icons.js';
import { el } from './util.js';
import { initAudio } from './audio.js';

const wIcon = (b) => (b === 'precisao' ? 'rifle_precisao' : b);
const STICK_R = 58; // raio útil do joystick (px)

export class TouchControls {
  constructor(game) {
    this.g = game;
    const inp = game.input;
    inp.moveVec = null;
    this.aimVec = null; this.lastDir = [0, -1]; this.target = null;
    const p = game.profile, slots = p.skills.slots;
    const gun = game.player.isGun;
    const skillBtn = (i) => {
      const id = slots[i], S = id && SKILLS[id];
      return `<button class="t-btn t-skill t-s${i} ${S ? '' : 'empty'}" data-key="${['KeyQ', 'KeyF', 'KeyG', 'KeyV'][i]}" data-skill="${id || ''}">${S ? icon(S.icon) : ''}<span class="t-cd"></span></button>`;
    };
    this.root = el(`<div class="touch-ui" id="touch-ui">
      <div class="t-move" id="t-move"><div class="t-base hidden"><div class="t-knob"></div></div><div class="t-hint">Arraste para andar</div></div>
      <div class="t-top">
        <button class="t-mini" data-act="zoom-in" aria-label="Aproximar câmera">+</button>
        <button class="t-mini" data-act="zoom-out" aria-label="Afastar câmera">−</button>
        <button class="t-mini" data-key="KeyB" aria-label="Primeira pessoa">${icon('camera')}</button>
        <button class="t-mini" data-key="Tab">${icon('mochila')}</button>
        <button class="t-mini" data-key="Escape">${icon('fechar')}</button>
        <button class="t-mini" data-act="fs">${icon('exportar')}</button>
      </div>
      <button class="t-btn t-attack" data-act="attack">${icon(p.equipped.base === 'precisao' ? 'rifle_precisao' : p.equipped.base)}<span class="t-aim"></span></button>
      <button class="t-btn t-heavy" data-act="heavy">${icon(gun ? 'chute' : 'sismico')}<span class="t-cd"></span></button>
      <button class="t-btn t-dash" data-key="ShiftLeft">${icon('esquiva')}<span class="t-cd"></span></button>
      <button class="t-btn t-jump" data-key="Space">${icon('nivel')}</button>
      ${[0, 1, 2, 3].map(skillBtn).join('')}
      <button class="t-btn t-reload ${gun ? '' : 'hidden'}" data-key="KeyR">${icon('recarregar')}</button>
      <button class="t-btn t-swap ${p.secondary ? '' : 'hidden'}" data-key="KeyX" aria-label="Trocar arma">${p.secondary ? icon(wIcon(p.secondary.base)) : ''}<i>⇄</i></button>
      <button class="t-btn t-item t-i1" data-key="Digit1">${icon('bandagem')}<span class="t-cnt" id="t-c1"></span></button>
      <button class="t-btn t-item t-i2" data-key="Digit2">${icon('medkit')}<span class="t-cnt" id="t-c2"></span></button>
      <button class="t-btn t-use hidden" data-hold="KeyE">${icon('mochila')}<span>SAQUEAR</span></button>
      <div class="t-rotate-hint hidden">${icon('camera')} Dica: deite o celular para ver mais do mapa <button class="t-x">${icon('fechar')}</button></div>
    </div>`);
    document.getElementById('hud').appendChild(this.root);
    this.knobBase = this.root.querySelector('.t-base');
    this.knob = this.root.querySelector('.t-knob');
    this.useBtn = this.root.querySelector('.t-use');
    this.atkBtn = this.root.querySelector('.t-attack');
    this.aimDot = this.root.querySelector('.t-aim');
    this.ptrs = new Map();
    this.bind();
    // dica (não bloqueia) para jogar deitado
    const hint = this.root.querySelector('.t-rotate-hint');
    hint.querySelector('.t-x').addEventListener('pointerdown', (e) => { e.stopPropagation(); hint.remove(); localStorage.setItem('zonamorta.rotHint', '1'); });
    if (!localStorage.getItem('zonamorta.rotHint')) hint.classList.remove('hidden');
    setTimeout(() => hint.isConnected && hint.remove(), 9000);
  }

  bind() {
    const inp = this.g.input;
    const move = this.root.querySelector('#t-move');
    // joystick flutuante
    move.addEventListener('pointerdown', (e) => {
      e.preventDefault(); initAudio();
      if (this.movePtr != null) return;
      this.movePtr = e.pointerId; try { move.setPointerCapture(e.pointerId); } catch {}
      this.origin = [e.clientX, e.clientY];
      this.knobBase.classList.remove('hidden');
      this.knobBase.style.left = e.clientX + 'px'; this.knobBase.style.top = e.clientY + 'px';
      this.knob.style.transform = 'translate(-50%,-50%)';
      this.root.querySelector('.t-hint').classList.add('hidden');
    });
    move.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this.movePtr) return;
      let dx = e.clientX - this.origin[0], dy = e.clientY - this.origin[1];
      const d = Math.hypot(dx, dy);
      if (d > STICK_R) { dx *= STICK_R / d; dy *= STICK_R / d; }
      this.knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
      const k = Math.min(1, d / STICK_R);
      inp.moveVec = k > 0.18 ? [dx / STICK_R, dy / STICK_R] : null;
    });
    const endMove = (e) => {
      if (e.pointerId !== this.movePtr) return;
      this.movePtr = null; inp.moveVec = null;
      this.knobBase.classList.add('hidden');
    };
    move.addEventListener('pointerup', endMove);
    move.addEventListener('pointercancel', endMove);

    // botões
    this.root.querySelectorAll('.t-btn, .t-mini').forEach((b) => {
      b.addEventListener('pointerdown', (e) => {
        e.preventDefault(); e.stopPropagation(); initAudio();
        try { b.setPointerCapture(e.pointerId); } catch {}
        b.classList.add('down');
        const key = b.dataset.key, hold = b.dataset.hold, act = b.dataset.act;
        if (key) { inp.justPressed.add(key); inp.keys.add(key); }
        if (hold) { inp.justPressed.add(hold); inp.keys.add(hold); }
        if (act === 'attack') { this.atkPtr = e.pointerId; this.atkOrigin = [e.clientX, e.clientY]; this.aimVec = null; inp.buttons.add(0); inp.justClicked.add(0); }
        if (act === 'heavy') inp.justClicked.add(2);
        if (act === 'fs') this.fullscreen();
        if (act === 'zoom-in' || act === 'zoom-out') {
          this.g.mobileZoom = Math.max(0.72, Math.min(1.3, (this.g.mobileZoom || 1) + (act === 'zoom-in' ? -0.1 : 0.1)));
          this.g.resize(innerWidth, innerHeight);
        }
      });
      b.addEventListener('pointermove', (e) => {
        if (b.dataset.act !== 'attack' || e.pointerId !== this.atkPtr) return;
        const dx = e.clientX - this.atkOrigin[0], dy = e.clientY - this.atkOrigin[1], d = Math.hypot(dx, dy);
        this.aimVec = d > 14 ? [dx / d, dy / d] : null; // arrastar = mirar manualmente
        this.aimDot.style.transform = this.aimVec ? `translate(${(dx / d) * Math.min(d, 40)}px, ${(dy / d) * Math.min(d, 40)}px)` : '';
      });
      const up = (e) => {
        b.classList.remove('down');
        const key = b.dataset.key, hold = b.dataset.hold;
        if (key) inp.keys.delete(key);
        if (hold) inp.keys.delete(hold);
        if (b.dataset.act === 'attack' && e.pointerId === this.atkPtr) { this.atkPtr = null; inp.buttons.delete(0); this.aimVec = null; this.aimDot.style.transform = ''; }
      };
      b.addEventListener('pointerup', up);
      b.addEventListener('pointercancel', up);
    });
  }

  fullscreen() {
    const d = document.documentElement;
    const p = document.fullscreenElement ? document.exitFullscreen() : (d.requestFullscreen ? d.requestFullscreen({ navigationUI: 'hide' }) : null);
    if (p && p.then) p.then(() => { try { screen.orientation.lock('landscape').catch(() => {}); } catch {} }).catch(() => {});
  }

  // Mira: manual (arrastando o botão de ataque) ou automática (inimigo mais próximo)
  applyAim() {
    const g = this.g, inp = g.input, p = g.player.pos;
    let dir = this.aimVec, tx = null, tz = null;
    if (!dir) {
      let best = null, bd = g.player.isGun ? 18 : 9;
      for (const z of g.zombies) {
        if (z.dead) continue;
        const d = Math.hypot(z.pos.x - p.x, z.pos.z - p.z);
        if (d < bd && (d < 4 || g.world.hasLOS(p.x, p.z, z.pos.x, z.pos.z))) { bd = d; best = z.pos; }
      }
      if (!best) for (const n of g.world.nests) { if (n.alive) { const d = Math.hypot(n.x - p.x, n.z - p.z); if (d < bd) { bd = d; best = n; } } }
      if (best) { const dx = best.x - p.x, dz = best.z - p.z, d = Math.hypot(dx, dz) || 1; dir = [dx / d, dz / d]; tx = best.x; tz = best.z; }
      else if (inp.moveVec) { const d = Math.hypot(...inp.moveVec) || 1; dir = [inp.moveVec[0] / d, inp.moveVec[1] / d]; }
    }
    if (dir) this.lastDir = dir;
    this.target = tx != null ? { x: tx, z: tz } : null;
    inp.aim.x = tx ?? p.x + this.lastDir[0] * 6;
    inp.aim.z = tz ?? p.z + this.lastDir[1] * 6;
  }

  update() {
    const g = this.g, pl = g.player, slots = g.profile.skills.slots;
    const cd = (btn, t, max) => { const s = btn && btn.querySelector('.t-cd'); if (!s) return; s.style.height = Math.max(0, t / max) * 100 + '%'; btn.classList.toggle('cool', t > 0); };
    this.root.querySelectorAll('.t-skill').forEach((b, i) => { const id = slots[i]; if (id) cd(b, pl.cds[id] || 0, skillCooldown(id, g.profile.skills.learned[id] || 1)); });
    cd(this.root.querySelector('.t-heavy'), pl.heavyCd, pl.isGun ? 0.75 : 1.1);
    // botões acompanham a arma na mão (troca fogo ⇄ lâmina)
    const wk = g.profile.equipped.uid + '|' + (g.profile.secondary?.uid || '');
    if (wk !== this._wk) {
      this._wk = wk;
      const atk = this.root.querySelector('.t-attack'), hv = this.root.querySelector('.t-heavy'), sw = this.root.querySelector('.t-swap');
      atk.querySelector('svg').outerHTML = icon(wIcon(g.profile.equipped.base));
      hv.querySelector('svg').outerHTML = icon(pl.isGun ? 'chute' : 'sismico');
      this.root.querySelector('.t-reload').classList.toggle('hidden', !pl.isGun);
      sw.classList.toggle('hidden', !g.profile.secondary);
      const old = sw.querySelector('svg'); if (old) old.remove();
      if (g.profile.secondary) sw.insertAdjacentHTML('afterbegin', icon(wIcon(g.profile.secondary.base)));
    }
    cd(this.root.querySelector('.t-dash'), pl.dashCd, pl.stats.dashCd);
    // botão de saquear só aparece perto de algo saqueável
    const prompt = g.hud.els['h-prompt'];
    const canUse = prompt && !prompt.classList.contains('hidden');
    this.useBtn.classList.toggle('hidden', !canUse);
    if (canUse) this.useBtn.querySelector('span').textContent = (prompt.textContent || '').replace(/^E\s*/, '').split('(')[0].trim().slice(0, 22) || 'USAR';
    const c1 = document.getElementById('c-1'), c2 = document.getElementById('c-2');
    if (c1) this.root.querySelector('#t-c1').textContent = c1.textContent;
    if (c2) this.root.querySelector('#t-c2').textContent = c2.textContent;
  }

  dispose() { this.root.remove(); this.g.input.moveVec = null; }
}
