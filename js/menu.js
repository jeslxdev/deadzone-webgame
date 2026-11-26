// ============================================================
//  MENU PRINCIPAL — estilo jogo: menu vertical à esquerda,
//  sobrevivente selecionado junto à fogueira à direita, zumbis
//  à espreita na borda da luz e câmera cinematográfica lenta.
// ============================================================
import * as THREE from 'three';
import { CLASSES, WEAPONS } from './data.js';
import { listProfiles, deleteProfile, importProfile, saveProfile, getProfile, storeMode, getSession, restoreSession, initStore } from './rpg.js';
import { auth } from './auth.js';
import { buildHumanoid, zombieAppearance, decorateZombie } from './character.js';
import { buildCampScene } from './camp.js';
import { idlePose } from './anim.js';
import { el, escapeHtml, rand, pick } from './util.js';
import { toast } from './ui.js';
import { sfx, initAudio } from './audio.js';
import { icon } from './icons.js';
import { openSettings } from './settings.js';

const LAST = 'zonamorta.last';

export class Menu {
  constructor(app) {
    this.app = app;
    const camp = (this.camp = buildCampScene());
    this.scene = camp.scene;
    this.camera = new THREE.PerspectiveCamera(36, innerWidth / innerHeight, 0.1, 200);
    this.t = 0;
    this.panel = null;

    // zumbis à espreita, no limite da luz da fogueira (atrás e dos lados)
    this.zs = [];
    for (let i = 0; i < 6; i++) {
      const type = pick(['andarilho', 'andarilho', 'brutamontes', 'corredor', 'cuspidor', 'andarilho']);
      const rig = buildHumanoid(zombieAppearance(type), { zombie: true });
      decorateZombie(rig, type);
      const a = -Math.PI / 2 + (i - 2.5) * 0.38 + rand(-0.08, 0.08), d = rand(9.5, 13);
      rig.root.position.set(Math.cos(a) * d + 1.5, 0, Math.sin(a) * d);
      rig.root.rotation.y = Math.atan2(-rig.root.position.x, -rig.root.position.z);
      rig.armL.rotation.x = rig.armR.rotation.x = -1.1;
      rig.torso.rotation.x = 0.25;
      if (type === 'brutamontes') rig.root.scale.setScalar(1.25);
      this.scene.add(rig.root);
      this.zs.push({ rig, ph: Math.random() * 6 });
    }

    this.root = el(`<div class="screen" id="menu">
      <div class="mm-shade"></div>
      <div class="mm-left">
        <div class="mm-brand"><h1 class="logo mm-logo">ZONA MORTA</h1><div class="mm-tag">Saqueie. Sobreviva. Limpe a cidade.</div></div>
        <nav class="mm-nav" id="mm-nav"></nav>
        <div class="mm-foot dim"><span>v0.2 · pré-beta</span></div>
      </div>
      <div class="mm-panel hidden" id="mm-panel"></div>
      <div class="mm-hero" id="mm-hero"></div>
    </div>`);
    document.getElementById('screens').appendChild(this.root);
    this.selectProfile(this.defaultProfile());
    this.renderNav();
    this.resize(innerWidth, innerHeight);
    this.onKey = (e) => {
      if (e.key === 'Escape' && this.panel) { this.openPanel(null); return; }
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      const items = [...this.root.querySelectorAll('.mm-item')];
      if (!items.length) return;
      const i = items.indexOf(document.activeElement);
      items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length].focus();
      e.preventDefault();
    };
    addEventListener('keydown', this.onKey);
  }

  defaultProfile() {
    return getProfile(localStorage.getItem(LAST)) || this.sorted()[0] || null;
  }
  sorted() { return listProfiles().slice().sort((a, b) => (b.updated || 0) - (a.updated || 0)); }

  // ---------- menu vertical ----------
  renderNav() {
    const p = this.selected, list = this.sorted();
    const item = (id, label, sub = '', cls = '') => `<button class="mm-item ${cls} ${this.panel === id ? 'open' : ''}" data-act="${id}"><span class="mm-label">${label}</span>${sub ? `<span class="mm-sub">${sub}</span>` : ''}</button>`;
    const nav = this.root.querySelector('#mm-nav');
    nav.innerHTML = [
      p ? item('play', 'Continuar', `${escapeHtml(p.name)} · ${CLASSES[p.cls].name} · Nv ${p.level}`, 'primary') : item('new', 'Começar', 'Crie seu primeiro sobrevivente', 'primary'),
      list.length ? item('profiles', 'Sobreviventes', `${list.length} personagem(ns)`) : '',
      p ? item('new', 'Novo sobrevivente') : '',
      item('import', 'Importar personagem'),
      item('settings', 'Configurações'),
      storeMode() === 'server' ? item('session', 'Sessão e aparelhos') : '',
    ].join('');
    nav.querySelectorAll('[data-act]').forEach((b) => {
      b.onclick = () => { initAudio(); sfx.click(); this.act(b.dataset.act); };
    });
  }

  act(a) {
    if (a === 'play') { if (!this.selected) return; localStorage.setItem(LAST, this.selected.id); this.app.profile = this.selected; this.app.go('hub'); return; }
    if (a === 'new') { this.app.go('creator'); return; }
    if (a === 'settings') { openSettings(); return; }
    this.openPanel(this.panel === a ? null : a);
  }

  // ---------- painéis (sobreviventes / importar / sessão) ----------
  openPanel(kind) {
    this.panel = kind;
    const box = this.root.querySelector('#mm-panel');
    this.root.querySelectorAll('.mm-item').forEach((b) => b.classList.toggle('open', b.dataset.act === kind));
    if (!kind) { box.classList.add('hidden'); box.innerHTML = ''; return; }
    box.classList.remove('hidden');
    const head = (title) => `<div class="mm-ph"><h2>${title}</h2><button class="mm-x" aria-label="Fechar">${icon('fechar')}</button></div>`;
    if (kind === 'profiles') {
      box.innerHTML = head('Sobreviventes') + `<div class="mm-plist">${this.sorted().map((p) => {
        const c = CLASSES[p.cls];
        return `<div class="mm-pcard ${p.id === this.selected?.id ? 'sel' : ''}" data-id="${p.id}" tabindex="0">
          <div class="pc-ic">${icon(c.icon)}</div>
          <div class="pc-body"><div class="pc-name">${escapeHtml(p.name)}</div><div class="pc-sub">${c.name} · Nível ${p.level} · ${p.stats.kills} abates · ${p.cleared.length} zona(s) limpa(s)</div></div>
          <button class="btn sm" data-play="${p.id}">Jogar</button>
          <button class="btn sm ghost danger" data-del="${p.id}" title="Excluir">${icon('fechar')}</button>
        </div>`;
      }).join('')}</div>`;
      box.querySelectorAll('.mm-pcard').forEach((c) => {
        c.onclick = (e) => { if (e.target.closest('button')) return; sfx.click(); this.selectProfile(getProfile(c.dataset.id)); this.openPanel('profiles'); };
        c.onkeydown = (e) => { if (e.key === 'Enter') c.click(); };
      });
      box.querySelectorAll('[data-play]').forEach((b) => b.onclick = () => { initAudio(); sfx.click(); this.selectProfile(getProfile(b.dataset.play)); this.act('play'); });
      box.querySelectorAll('[data-del]').forEach((b) => b.onclick = () => {
        const p = getProfile(b.dataset.del);
        if (!confirm(`Excluir ${p.name} (Nv ${p.level}) permanentemente? Isso não pode ser desfeito.`)) return;
        deleteProfile(p.id);
        if (this.selected?.id === p.id) this.selectProfile(this.defaultProfile());
        this.sorted().length ? this.openPanel('profiles') : this.openPanel(null);
        this.renderNav();
      });
    }
    if (kind === 'import') {
      box.innerHTML = head('Importar personagem') + `<p class="dim">Cole o código gerado em <b>Personagem → Exportar</b> no acampamento. O personagem é movido para esta sessão.</p>
        <textarea id="m-code" rows="4" placeholder="ZM2:..."></textarea>
        <button class="btn" id="m-doimport">Importar</button>`;
      box.querySelector('#m-doimport').onclick = () => this.doImport(box.querySelector('#m-code').value);
    }
    if (kind === 'session') {
      box.innerHTML = head('Sessão e aparelhos') + `<p class="dim">Seus personagens ficam salvos no servidor, na sua sessão. Para jogar em outro aparelho, use o código abaixo.</p><div id="mm-sess" class="dim">Carregando…</div>`;
      getSession().then((s) => {
        const tgt = box.querySelector('#mm-sess');
        if (!tgt) return;
        if (!s) { tgt.textContent = 'Não foi possível carregar a sessão.'; return; }
        tgt.innerHTML = `<code class="mm-code">${s.sid}</code><div class="row gap"><button class="btn sm" id="mm-copy">Copiar código</button><button class="btn sm ghost" id="mm-use">Usar outro código</button></div>`;
        tgt.querySelector('#mm-copy').onclick = () => navigator.clipboard.writeText(s.sid).then(() => toast('Código copiado'));
        tgt.querySelector('#mm-use').onclick = async () => {
          const code = prompt('Cole o código da sessão:');
          if (!code) return;
          try { await restoreSession(code); toast('Sessão carregada!'); this.selectProfile(this.defaultProfile()); this.openPanel(null); this.renderNav(); }
          catch (e) { toast(e.message, 'warn'); }
        };
      });
    }
    box.querySelector('.mm-x').onclick = () => this.openPanel(null);
  }

  async doImport(code) {
    try {
      let p;
      if (auth.on) { const r = await auth.importCode(code); await initStore(); p = getProfile(r.profile.id); toast(r.moved ? `${escapeHtml(r.profile.name)} trazido para esta sessão` : `${escapeHtml(r.profile.name)} importado!`); }
      else { p = importProfile(code); saveProfile(p); toast(`${escapeHtml(p.name)} importado!`); }
      this.selectProfile(p); this.openPanel('profiles'); this.renderNav();
    } catch (e) { toast('Código inválido: ' + e.message, 'warn'); }
  }

  // ---------- sobrevivente em destaque (3D + cartão) ----------
  selectProfile(p) {
    this.selected = p || null;
    if (this.hero) { this.scene.remove(this.hero.root); this.hero.dispose(); this.hero = null; }
    const card = this.root.querySelector('#mm-hero');
    if (p) {
      localStorage.setItem(LAST, p.id);
      const rig = buildHumanoid(p.appearance);
      rig.setWeapon(p.equipped);
      rig.setHolster(p.secondary);
      rig.root.position.set(2.15, 0, 0.35);
      rig.root.rotation.y = -0.75; // de frente para a câmera, perto do fogo
      this.scene.add(rig.root);
      this.hero = rig;
      this.isGun = WEAPONS[p.equipped.base]?.type === 'gun';
      const c = CLASSES[p.cls];
      card.innerHTML = `<div class="mm-hcard"><div class="mm-hname">${escapeHtml(p.name)}</div><div class="mm-hsub">${icon(c.icon)} ${c.name} · Nível ${p.level}</div>
        <div class="mm-hstats"><span><b>${p.stats.kills}</b> abates</span><span><b>${p.stats.extracted || 0}</b> extrações</span><span><b>${p.cleared.length}</b> zonas limpas</span></div></div>`;
    } else card.innerHTML = '';
    if (this.root.querySelector('#mm-nav').children.length) this.renderNav();
  }

  update(dt) {
    this.t += dt;
    this.camp.update(dt);
    // câmera: leve deriva de "respiração", enquadrando o herói e a fogueira à direita
    const t = this.t;
    if (this.portrait) { // celular em pé: herói e fogueira centralizados na metade de cima
      this.camera.position.set(1.1 + Math.sin(t * 0.07) * 0.2, 1.6 + Math.sin(t * 0.11) * 0.05, 9.4);
      this.camera.lookAt(1.1, 0.7, 0);
    } else {
      this.camera.position.set(-1.6 + Math.sin(t * 0.07) * 0.35, 1.75 + Math.sin(t * 0.11) * 0.08, 6.4 + Math.cos(t * 0.07) * 0.25);
      this.camera.lookAt(-0.35, 1.05, -0.2);
    }
    if (this.hero) {
      idlePose(this.hero, t, this.isGun);
      this.hero.head.rotation.y = Math.sin(t * 0.4) * 0.25 - 0.1;
    }
    for (const z of this.zs) {
      z.rig.head.rotation.z = Math.sin(t * 0.9 + z.ph) * 0.18;
      z.rig.body.rotation.z = Math.sin(t * 0.6 + z.ph) * 0.05;
      z.rig.armL.rotation.x = -1.1 + Math.sin(t * 1.3 + z.ph) * 0.1;
      z.rig.armR.rotation.x = -1.1 - Math.sin(t * 1.3 + z.ph) * 0.1;
    }
  }

  render() { this.app.draw(this.scene, this.camera); }
  resize(w, h) {
    const c = this.camera;
    c.aspect = w / h;
    this.portrait = w < h;
    c.fov = this.portrait ? 44 : 36;
    c.clearViewOffset();
    c.updateProjectionMatrix();
  }
  dispose() {
    removeEventListener('keydown', this.onKey);
    this.root.remove();
    for (const z of this.zs) z.rig.dispose();
    if (this.hero) this.hero.dispose();
    this.camp.dispose();
    this.scene.clear();
  }
}
