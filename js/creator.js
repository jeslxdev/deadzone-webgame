// ============================================================
//  EDITOR DE PERSONAGEM — visual + escolha de classe
// ============================================================
import * as THREE from 'three';
import { CLASSES, WEAPONS, SKIN_COLORS, HAIR_COLORS, CLOTH_COLORS, EYE_COLORS, HAIR_STYLES, BEARDS, ACCESSORIES, BUILDS, defaultAppearance } from './data.js';
import { createProfile, saveProfile, makeWeapon } from './rpg.js';
import { buildHumanoid } from './character.js';
import { el, hexToCss, pick, rand, escapeHtml } from './util.js';
import { sfx, initAudio } from './audio.js';
import { toast } from './ui.js';
import { idlePose } from './anim.js';
import { icon } from './icons.js';

const PANEL_W = 460;

export class Creator {
  constructor(app, args = {}) {
    this.app = app;
    this.editing = args.profile || null;
    this.ap = this.editing ? { ...this.editing.appearance } : defaultAppearance();
    this.cls = this.editing ? this.editing.cls : 'atirador';
    this.name = this.editing ? this.editing.name : '';
    this.rotY = 0.4; this.drag = null; this.t = 0; this.zoom = 0; this.zoomT = 0;

    const scene = (this.scene = new THREE.Scene());
    scene.background = new THREE.Color(0x14110f);
    scene.fog = new THREE.Fog(0x14110f, 8, 22);
    this.camera = new THREE.PerspectiveCamera(36, innerWidth / innerHeight, 0.1, 100);
    scene.add(new THREE.HemisphereLight(0x8a8aa0, 0x221a14, 1.0));
    const key = new THREE.SpotLight(0xffd0a0, 60, 20, 0.5, 0.5, 1.2);
    key.position.set(2.5, 6, 4); key.castShadow = true; key.shadow.mapSize.set(1024, 1024);
    scene.add(key, key.target);
    const rim = new THREE.PointLight(0x6a9aff, 8, 10); rim.position.set(-2.5, 2.5, -2.5); scene.add(rim);
    const ped = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.6, 0.25, 32), new THREE.MeshStandardMaterial({ color: 0x2a2624, roughness: 0.8 }));
    ped.position.y = -0.125; ped.receiveShadow = true; scene.add(ped);
    const ring = new THREE.Mesh(new THREE.RingGeometry(1.35, 1.42, 48), new THREE.MeshBasicMaterial({ color: 0xc0392b }));
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.01; scene.add(ring);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), new THREE.MeshStandardMaterial({ color: 0x1c1916, roughness: 1 }));
    floor.rotation.x = -Math.PI / 2; floor.position.y = -0.25; floor.receiveShadow = true; scene.add(floor);
    // escombros decorativos
    for (let i = 0; i < 18; i++) {
      const s = rand(0.3, 1.2);
      const m = new THREE.Mesh(new THREE.BoxGeometry(s, s * 0.6, s), new THREE.MeshStandardMaterial({ color: 0x3a3632, roughness: 1 }));
      const a = rand(Math.PI * 1.05, Math.PI * 1.95), d = rand(3.5, 9);
      m.position.set(Math.cos(a) * d, -0.25 + s * 0.3, Math.sin(a) * d - 1);
      m.rotation.y = rand(0, 3);
      m.castShadow = true;
      scene.add(m);
    }

    this.root = el(`<div class="screen" id="creator">
      <div class="side-panel left" style="width:${PANEL_W}px">
        <h1 class="title-sm">${this.editing ? 'EDITAR VISUAL' : 'CRIAR SOBREVIVENTE'}</h1>
        <div class="field"><label>Nome</label><input id="c-name" maxlength="18" placeholder="Seu nome de sobrevivente" value="${escapeHtml(this.name)}"></div>
        <div class="field"><label>Classe ${this.editing ? '<span class="dim">(fixa após criação)</span>' : ''}</label><div class="class-cards" id="c-cls"></div></div>
        <div class="field skin-field"><label>Skin personalizada (.png)</label>
          <div class="row gap tight">
            <label class="btn ghost sm file-btn">${icon('importar')} Carregar skin PNG<input type="file" accept="image/png" id="c-skin" hidden></label>
            <button class="btn sm ghost" id="c-skin-preset">Usar skin Corinthians</button>
            <a class="btn sm ghost" href="assets/skins/corinthians-256.png" download="deadzone-corinthians-256.png">Baixar PNG</a>
            <button class="btn sm ghost" id="c-skin-clear">${icon('fechar')} Remover</button>
          </div>
          <label class="dim sm" id="c-hair3d-row"><input type="checkbox" id="c-hair3d"> Cabelo 3D sobre a skin</label>
          <div class="dim sm" id="c-skin-info">Skin no layout Minecraft: 64×64, 64×32 ou alta resolução 256×256. A roupa é aplicada ao corpo 3D.</div>
        </div>
        <div id="c-opts"></div>
        <div class="row gap">
          <button class="btn ghost" id="c-rand">${icon('dado')} Aleatório</button>
          <button class="btn ghost" id="c-back">Voltar</button>
          <button class="btn big" id="c-ok">${this.editing ? 'Salvar' : 'Criar e ir ao acampamento'}</button>
        </div>
      </div>
      <div class="creator-hint">Arraste para girar · Scroll para aproximar do rosto</div>
    </div>`);
    document.getElementById('screens').appendChild(this.root);
    this.root.querySelector('#c-name').addEventListener('input', (e) => (this.name = e.target.value));
    this.root.querySelector('#c-rand').onclick = () => { this.randomize(); sfx.click(); };
    this.root.querySelector('#c-back').onclick = () => app.go(this.editing ? 'hub' : 'menu');
    this.root.querySelector('#c-ok').onclick = () => this.confirm();
    this.root.querySelector('#c-skin').addEventListener('change', (e) => this.loadSkin(e.target.files[0]));
    this.root.querySelector('#c-skin-clear').onclick = () => { delete this.ap.skinPng; delete this.ap.skinH; delete this.ap.modeledHair; this.updateSkinInfo(); this.rebuild(); };
    this.root.querySelector('#c-skin-preset').onclick = async () => {
      try {
        const response = await fetch('assets/skins/corinthians-256.png');
        if (!response.ok) throw new Error('Skin indisponível');
        const blob = await response.blob();
        this.ap.hair = 0x241b19; this.ap.hairStyle = 'curto';
        this.renderOptions();
        this.loadSkin(new File([blob], 'corinthians-256.png', { type: 'image/png' }), true);
      } catch { toast('Não foi possível carregar a skin Corinthians', 'warn'); }
    };
    this.root.querySelector('#c-hair3d').onchange = (e) => { this.ap.modeledHair = e.target.checked; this.updateSkinInfo(); this.rebuild(); };
    this.updateSkinInfo();

    const cv = app.renderer.domElement;
    this._down = (e) => { if (e.target === cv) this.drag = e.clientX; initAudio(); };
    this._move = (e) => { if (this.drag !== null) { this.rotY += (e.clientX - this.drag) * 0.01; this.drag = e.clientX; } };
    this._up = () => (this.drag = null);
    addEventListener('pointerdown', this._down); addEventListener('pointermove', this._move); addEventListener('pointerup', this._up);
    this._wheel = (e) => { if (e.target === cv) this.zoomT = Math.max(0, Math.min(1, this.zoomT - Math.sign(e.deltaY) * 0.25)); };
    addEventListener('wheel', this._wheel, { passive: true });

    this.renderClasses();
    this.renderOptions();
    this.rebuild();
    this.resize(innerWidth, innerHeight);
  }

  renderClasses() {
    const box = this.root.querySelector('#c-cls');
    box.innerHTML = Object.values(CLASSES).map((c) => `
      <div class="class-card ${this.cls === c.id ? 'sel' : ''} ${this.editing && this.cls !== c.id ? 'disabled' : ''}" data-cls="${c.id}">
        <div class="cc-icon">${icon(c.icon)}</div>
        <div class="cc-name">${c.name}</div>
        <div class="cc-desc">${c.desc}</div>
        <div class="cc-stats">${icon('vida')} ${c.hp} · ${icon('agilidade')} ${c.speed} · ${icon('escudo')} ${Math.round(c.armor * 100)}%</div>
        <div class="cc-skills">${icon(c.skills.q.icon)} ${c.skills.q.name} · ${icon(c.skills.f.icon)} ${c.skills.f.name}</div>
      </div>`).join('');
    box.querySelectorAll('[data-cls]').forEach((d) => d.onclick = () => {
      if (this.editing) return;
      this.cls = d.dataset.cls;
      if (this.cls === 'samurai' && this.ap.hairStyle === 'curto' && Math.random() < 0.5) this.ap.hairStyle = 'coque';
      sfx.click();
      this.renderClasses();
      this.rebuild();
    });
  }

  renderOptions() {
    const ap = this.ap;
    const sw = (key, list) => `<div class="swatches">${list.map((c) => `<button class="sw ${ap[key] === c ? 'sel' : ''}" data-k="${key}" data-v="${c}" style="background:${hexToCss(c)}"></button>`).join('')}</div>`;
    const ch = (key, obj) => `<div class="chips">${Object.entries(obj).map(([k, v]) => `<button class="chip ${ap[key] === k ? 'sel' : ''}" data-k="${key}" data-s="${k}">${v}</button>`).join('')}</div>`;
    const box = this.root.querySelector('#c-opts');
    box.innerHTML = `
      <div class="field"><label>Pele</label>${sw('skin', SKIN_COLORS)}</div>
      <div class="field skin-hair-field"><label>Cabelo</label>${ch('hairStyle', HAIR_STYLES)}${sw('hair', HAIR_COLORS)}</div>
      <div class="field"><label>Barba</label>${ch('beard', BEARDS)}</div>
      <div class="field"><label>Olhos</label>${sw('eyes', EYE_COLORS)}</div>
      <div class="field"><label>Acessório</label>${ch('accessory', ACCESSORIES)}</div>
      <div class="field"><label>Camisa / Jaqueta</label>${sw('top', CLOTH_COLORS)}</div>
      <div class="field"><label>Calça</label>${sw('pants', CLOTH_COLORS)}</div>
      <div class="field"><label>Calçado</label>${sw('shoes', CLOTH_COLORS)}</div>
      <div class="field"><label>Mochila</label>${sw('pack', CLOTH_COLORS)}</div>
      <div class="field"><label>Porte físico</label>${ch('build', BUILDS)}</div>
      <div class="field"><label>Altura <span class="dim" id="c-hv">${Math.round(ap.height * 180)} cm</span></label><input type="range" id="c-h" min="0.88" max="1.12" step="0.01" value="${ap.height}"></div>`;
    box.querySelectorAll('[data-v]').forEach((b) => b.onclick = () => { ap[b.dataset.k] = Number(b.dataset.v); this.afterChange(); });
    box.querySelectorAll('[data-s]').forEach((b) => b.onclick = () => { ap[b.dataset.k] = b.dataset.s; this.afterChange(); });
    box.querySelector('#c-h').oninput = (e) => { ap.height = Number(e.target.value); box.querySelector('#c-hv').textContent = Math.round(ap.height * 180) + ' cm'; this.rebuild(); };
  }

  loadSkin(file, modeledHair = true) {
    if (!file) return;
    if (file.size > 200 * 1024) { toast('Arquivo muito grande (máx. 200 KB)', 'warn'); return; }
    const fr = new FileReader();
    fr.onload = () => {
      const img = new Image();
      img.onload = () => {
        if (![64, 128, 256].includes(img.width) || (img.height !== img.width && img.height !== img.width / 2)) { toast('A skin precisa ter layout 64×64 ou 64×32 (até 256 px)', 'warn'); return; }
        this.ap.skinPng = fr.result; this.ap.skinH = img.height === img.width ? 64 : 32;
        this.ap.modeledHair = modeledHair;
        this.updateSkinInfo(); this.rebuild(); sfx.pickup();
        toast('Skin aplicada!');
      };
      img.onerror = () => toast('Imagem inválida', 'warn');
      img.src = fr.result;
    };
    fr.readAsDataURL(file);
  }

  updateSkinInfo() {
    const on = !!this.ap.skinPng;
    this.root.querySelector('#c-skin-clear').style.display = on ? '' : 'none';
    this.root.querySelector('#c-hair3d-row').style.display = on ? '' : 'none';
    this.root.querySelector('#c-hair3d').checked = on && this.ap.modeledHair !== false;
    this.root.querySelector('#c-opts').classList.toggle('disabled-opts', on);
    if (on) this.root.querySelector('#c-skin-info').innerHTML = `<span class="ok">Skin ativa.</span> Cabelo, porte físico e altura continuam editáveis.`;
    else this.root.querySelector('#c-skin-info').textContent = 'Skin no layout Minecraft: 64×64, 64×32 ou alta resolução 256×256. A roupa é aplicada ao corpo 3D.';
  }

  afterChange() { sfx.click(); this.renderOptions(); this.rebuild(); }

  randomize() {
    const ap = this.ap;
    ap.skin = pick(SKIN_COLORS); ap.hair = pick(HAIR_COLORS); ap.hairStyle = pick(Object.keys(HAIR_STYLES));
    ap.beard = pick(Object.keys(BEARDS)); ap.eyes = pick(EYE_COLORS); ap.accessory = pick(Object.keys(ACCESSORIES));
    ap.top = pick(CLOTH_COLORS); ap.pants = pick(CLOTH_COLORS); ap.shoes = pick(CLOTH_COLORS); ap.pack = pick(CLOTH_COLORS);
    ap.build = pick(Object.keys(BUILDS)); ap.height = Math.round(rand(0.9, 1.1) * 100) / 100;
    this.renderOptions();
    this.rebuild();
  }

  rebuild() {
    if (this.rig) { this.scene.remove(this.rig.root); this.rig.dispose(); }
    this.rig = buildHumanoid(this.ap);
    const w = this.editing ? this.editing.equipped : makeWeapon(CLASSES[this.cls].startWeapon, 0, 1);
    this.rig.setWeapon(w);
    this.isGun = WEAPONS[w.base].type === 'gun';
    this.scene.add(this.rig.root);
  }

  confirm() {
    const name = this.name.trim();
    if (name.length < 2) { toast('Digite um nome (mín. 2 letras)', 'warn'); return; }
    if (this.editing) {
      this.editing.name = name;
      this.editing.appearance = { ...this.ap };
      saveProfile(this.editing);
      this.app.profile = this.editing;
      this.app.go('hub');
      return;
    }
    const p = createProfile({ name, cls: this.cls, appearance: { ...this.ap } });
    saveProfile(p);
    this.app.profile = p;
    sfx.levelup();
    this.app.go('hub');
  }

  update(dt) {
    this.t += dt;
    const r = this.rig;
    if (!this.drag) this.rotY += dt * (this.zoom > 0.5 ? 0.08 : 0.25);
    if (Math.abs(this.zoom - this.zoomT) > 0.001) { this.zoom += (this.zoomT - this.zoom) * Math.min(1, dt * 6); this.resize(innerWidth, innerHeight); }
    r.root.rotation.y = this.rotY;
    idlePose(r, this.t, this.isGun);
    r.head.rotation.y = Math.sin(this.t * 0.7) * 0.2;
  }

  render() { this.app.renderer.render(this.scene, this.camera); }

  resize(w, h) {
    const c = this.camera;
    c.aspect = w / h;
    c.updateProjectionMatrix();
    const z = this.zoom || 0, hgt = (this.ap.height || 1);
    const dist = 5.8 - z * 4.6;
    const halfW = dist * Math.tan(THREE.MathUtils.degToRad(c.fov / 2)) * c.aspect;
    // tela pequena: painel ocupa a metade de baixo -> personagem centralizado no topo
    const compact = w <= 900 || h <= 520;
    if (compact) c.setViewOffset(w, h, 0, h * (w > h ? 0.2 : 0.26), w, h); else c.clearViewOffset();
    const shift = compact ? 0 : (PANEL_W / 2 / (w / 2)) * halfW;
    const ty = 1.0 + z * (1.68 * hgt - 1.0);
    c.position.set(-shift, ty + 0.6 - z * 0.55, dist);
    c.lookAt(-shift, ty, 0);
  }

  dispose() {
    removeEventListener('wheel', this._wheel);
    removeEventListener('pointerdown', this._down); removeEventListener('pointermove', this._move); removeEventListener('pointerup', this._up);
    this.root.remove();
    if (this.rig) this.rig.dispose();
    this.scene.clear();
  }
}
