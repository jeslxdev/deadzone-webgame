// ============================================================
//  MENU PRINCIPAL — seleção de personagens, criar, importar
// ============================================================
import * as THREE from 'three';
import { CLASSES } from './data.js';
import { listProfiles, deleteProfile, importProfile, saveProfile, getProfile, storeMode, getSession, restoreSession } from './rpg.js';
import { buildHumanoid, zombieAppearance, decorateZombie } from './character.js';
import { buildCampScene } from './hub.js';
import { el, escapeHtml, rand, pick } from './util.js';
import { toast } from './ui.js';
import { sfx, initAudio } from './audio.js';
import { icon } from './icons.js';
import { openSettings } from './settings.js';

export class Menu {
  constructor(app) {
    this.app = app;
    const camp = (this.camp = buildCampScene());
    this.scene = camp.scene;
    this.camera = new THREE.PerspectiveCamera(42, innerWidth / innerHeight, 0.1, 200);
    this.t = 0;
    // zumbis espreitando no escuro
    this.zs = [];
    for (let i = 0; i < 7; i++) {
      const type = pick(['andarilho', 'andarilho', 'brutamontes', 'corredor', 'cuspidor']);
      const rig = buildHumanoid(zombieAppearance(type), { zombie: true });
      decorateZombie(rig, type);
      const a = -Math.PI / 2 + rand(-1.1, 1.1), d = rand(9, 14);
      rig.root.position.set(Math.cos(a) * d, 0, Math.sin(a) * d);
      rig.root.rotation.y = Math.atan2(-rig.root.position.x, -rig.root.position.z);
      rig.armL.rotation.x = rig.armR.rotation.x = -1.3;
      rig.torso.rotation.x = 0.2;
      if (type === 'brutamontes') rig.root.scale.setScalar(1.3);
      this.scene.add(rig.root);
      this.zs.push({ rig, ph: Math.random() * 6 });
    }

    this.root = el(`<div class="screen" id="menu">
      <div class="menu-center">
        <h1 class="logo">ZONA MORTA</h1>
        <div class="tagline">Saqueie. Sobreviva. Limpe a cidade.</div>
        <div class="profiles" id="m-profiles"></div>
        <div class="row gap center">
          <button class="btn big" id="m-new">${icon('mais')} Novo personagem</button>
          <button class="btn ghost" id="m-import">${icon('importar')} Importar personagem</button>
          <button class="btn ghost" id="m-settings">${icon('som')} Configurações</button>
        </div>
        <div class="import-box hidden" id="m-ibox">
          <textarea id="m-code" rows="3" placeholder="Cole aqui o código ZM1:..."></textarea>
          <button class="btn sm" id="m-doimport">Importar</button>
        </div>
        <div class="session-box dim" id="m-session"></div>
        <div class="menu-foot dim">v0.1 · protótipo · progresso salvo neste navegador</div>
      </div>
    </div>`);
    document.getElementById('screens').appendChild(this.root);
    this.root.querySelector('#m-new').onclick = () => { initAudio(); sfx.click(); app.go('creator'); };
    this.root.querySelector('#m-settings').onclick = () => openSettings();
    this.root.querySelector('#m-import').onclick = () => this.root.querySelector('#m-ibox').classList.toggle('hidden');
    this.root.querySelector('#m-doimport').onclick = () => {
      try {
        const p = importProfile(this.root.querySelector('#m-code').value);
        const exists = getProfile(p.id);
        saveProfile(p);
        toast(exists ? `Personagem ${escapeHtml(p.name)} atualizado` : `Personagem ${escapeHtml(p.name)} importado!`);
        this.renderProfiles();
      } catch (e) { toast('Código inválido: ' + e.message, 'warn'); }
    };
    this.renderProfiles();
    this.renderSession();
    this.resize(innerWidth, innerHeight);
  }

  async renderSession() {
    const box = this.root.querySelector('#m-session');
    if (storeMode() !== 'server') { box.innerHTML = 'Modo offline: personagens salvos neste navegador.'; return; }
    const s = await getSession();
    if (!s) return;
    box.innerHTML = `Seus personagens ficam salvos no servidor, só na sua sessão. Código da sessão (para usar em outro aparelho): <code>${s.sid}</code>
      <button class="btn sm ghost" id="m-sess-copy">Copiar</button> <button class="btn sm ghost" id="m-sess-use">Usar outro código</button>`;
    box.querySelector('#m-sess-copy').onclick = () => { navigator.clipboard.writeText(s.sid).then(() => toast('Código copiado')); };
    box.querySelector('#m-sess-use').onclick = async () => {
      const code = prompt('Cole o código da sessão:');
      if (!code) return;
      try { await restoreSession(code); toast('Sessão carregada!'); this.renderProfiles(); this.renderSession(); }
      catch (e) { toast(e.message, 'warn'); }
    };
  }

  renderProfiles() {
    const list = listProfiles().sort((a, b) => (b.updated || 0) - (a.updated || 0));
    const box = this.root.querySelector('#m-profiles');
    if (!list.length) { box.innerHTML = '<div class="empty">Nenhum sobrevivente ainda. Crie o seu!</div>'; return; }
    box.innerHTML = list.map((p) => {
      const c = CLASSES[p.cls];
      return `<div class="profile-card" data-id="${p.id}">
        <div class="pc-ic">${icon(c.icon)}</div>
        <div class="pc-body"><div class="pc-name">${escapeHtml(p.name)}</div><div class="pc-sub">${c.name} · Nível ${p.level} · ${p.stats.kills} abates · ${p.cleared.length} mapa(s) limpo(s)</div></div>
        <button class="btn" data-play="${p.id}">Jogar</button>
        <button class="btn sm ghost danger" data-del="${p.id}" title="Excluir">${icon('fechar')}</button>
      </div>`;
    }).join('');
    box.querySelectorAll('[data-play]').forEach((b) => b.onclick = () => {
      initAudio(); sfx.click();
      this.app.profile = getProfile(b.dataset.play);
      this.app.go('hub');
    });
    box.querySelectorAll('[data-del]').forEach((b) => b.onclick = () => {
      const p = getProfile(b.dataset.del);
      if (confirm(`Excluir ${p.name} (Nv ${p.level}) permanentemente? Isso não pode ser desfeito.`)) { deleteProfile(p.id); this.renderProfiles(); }
    });
  }

  update(dt) {
    this.t += dt;
    this.camp.update(dt);
    const a = this.t * 0.05;
    this.camera.position.set(Math.sin(a) * 9, 4.2, Math.cos(a) * 9);
    this.camera.lookAt(0, 1, 0);
    for (const z of this.zs) {
      z.rig.head.rotation.z = Math.sin(this.t + z.ph) * 0.2;
      z.rig.armL.rotation.x = -1.3 + Math.sin(this.t * 1.3 + z.ph) * 0.1;
      z.rig.armR.rotation.x = -1.3 - Math.sin(this.t * 1.3 + z.ph) * 0.1;
    }
  }

  render() { this.app.renderer.render(this.scene, this.camera); }
  resize(w, h) { this.camera.aspect = w / h; this.camera.updateProjectionMatrix(); }
  dispose() {
    this.root.remove();
    for (const z of this.zs) z.rig.dispose();
    this.scene.clear();
  }
}
