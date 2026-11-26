// ============================================================
//  INTERFACE — HUD da partida, minimapa, mochila, atributos
// ============================================================
import * as THREE from 'three';
import { CLASSES, ATTRS, WEAPONS, RARITIES, SKILLS, SKILL_KEY_LABELS } from './data.js';
import { skillCooldown } from './skills.js';
import { xpToNext, itemInfo, itemValue, deriveStats, countConsumable, saveProfile } from './rpg.js';
import { el, fmtMoney, escapeHtml } from './util.js';
import { sfx } from './audio.js';
import { icon } from './icons.js';
import { openSettings } from './settings.js';

// ---------- Toasts globais ----------
export function toast(html, cls = '', ms = 2600) {
  const box = document.getElementById('toasts');
  const t = el(`<div class="toast ${cls}">${html}</div>`);
  box.appendChild(t);
  while (box.children.length > 7) box.firstChild.remove();
  setTimeout(() => t.classList.add('out'), ms);
  setTimeout(() => t.remove(), ms + 400);
}

export function itemCardHtml(item, extra = '') {
  const i = itemInfo(item);
  return `<div class="item" data-uid="${item.uid}" style="--rc:${i.color}">
    <div class="item-icon" style="color:${i.color}">${icon(i.icon)}</div>
    <div class="item-body">
      <div class="item-name" style="color:${i.color}">${escapeHtml(i.name)}${item.qty > 1 ? ` <span class="qty">×${item.qty}</span>` : ''}</div>
      <div class="item-sub">${i.rarity}${item.kind === 'weapon' ? ' · ' + (WEAPONS[item.base]?.type === 'gun' ? 'Arma de fogo' : 'Lâmina') : ''} · ${i.desc}</div>
    </div>
    <div class="item-val">${fmtMoney(i.value)}</div>
    ${extra}
  </div>`;
}

// Painel de atributos reutilizado no acampamento e na partida
export function renderAttributes(container, profile, onChange) {
  const st = deriveStats(profile);
  container.innerHTML = `
    <div class="attr-head">Pontos disponíveis: <b class="${profile.points ? 'hl' : ''}">${profile.points}</b></div>
    ${Object.entries(ATTRS).map(([k, a]) => `
      <div class="attr">
        <div class="attr-ic">${icon(a.icon)}</div>
        <div class="attr-info"><div class="attr-name">${a.name} <b>${profile.attrs[k]}</b></div><div class="attr-desc">${a.desc}</div></div>
        <button class="btn sm" data-attr="${k}" ${profile.points ? '' : 'disabled'}>+</button>
      </div>`).join('')}
    <div class="stat-grid">
      <div><span>Vida máx.</span><b>${st.maxHp}</b></div>
      <div><span>Regeneração</span><b>${st.regen.toFixed(1)}/s</b></div>
      <div><span>Velocidade</span><b>${st.speed.toFixed(2)}</b></div>
      <div><span>Vel. ataque</span><b>×${st.atkSpeed.toFixed(2)}</b></div>
      <div><span>Dano corpo a corpo</span><b>×${st.melee.toFixed(2)}</b></div>
      <div><span>Dano armas de fogo</span><b>×${st.gun.toFixed(2)}</b></div>
      <div><span>Crítico</span><b>${(st.crit * 100).toFixed(1)}%</b></div>
      <div><span>Sorte no loot</span><b>+${(st.luck * 100).toFixed(0)}%</b></div>
      <div><span>Mochila</span><b>${st.bagSlots} espaços</b></div>
      <div><span>Poder de skill</span><b>×${st.skillPower.toFixed(2)}</b></div>
    </div>`;
  container.querySelectorAll('[data-attr]').forEach((b) => b.addEventListener('click', () => {
    if (profile.points <= 0) return;
    profile.points--;
    profile.attrs[b.dataset.attr]++;
    saveProfile(profile);
    sfx.click();
    renderAttributes(container, profile, onChange);
    onChange && onChange();
  }));
}

// ============================================================
export class HUD {
  constructor(game) {
    this.g = game;
    const p = game.profile, cls = CLASSES[p.cls];
    this.root = el(`<div class="screen" id="hud">
      <div class="hud-tl panel">
        <div class="hud-name"><span class="cls-ic">${icon(cls.icon)}</span> ${escapeHtml(p.name)} <span class="lvl">Nv <b id="h-lvl">${p.level}</b></span></div>
        <div class="bar hp"><div class="fill" id="h-hp"></div><span id="h-hpt"></span></div>
        <div class="bar xp"><div class="fill" id="h-xp"></div><span id="h-xpt"></span></div>
      </div>
      <div class="party panel hidden" id="h-party"></div>
      <div class="hud-top">
        <div class="objective panel" id="h-obj"></div>
        <div class="bossbar hidden" id="h-boss"><div class="boss-name" id="h-bossn"></div><div class="bar boss"><div class="fill" id="h-bossf"></div></div></div>
      </div>
      <div class="hud-tr">
        <canvas id="minimap" width="200" height="200"></canvas>
        <div class="mm-legend"><i class="dot" style="background:#5fd35f"></i>base <i class="dot" style="background:#a040ff"></i>ninho <i class="dot" style="background:#ffd23f"></i>saque <i class="dot" style="background:#ff2a2a"></i>boss</div>
      </div>
      <div class="hud-bottom">
        <div class="slot weapon" id="s-wpn"><div class="s-ic" id="s-wic"></div><div class="s-txt" id="s-wtxt"></div><div class="s-key">LMB</div></div>
        ${p.skills.slots.map((id, i) => { const S = id && SKILLS[id]; return `<div class="slot ${S ? '' : 'empty-slot'}" id="s-k${i}"><div class="s-ic">${S ? icon(S.icon) : ''}</div><div class="cd"></div><div class="cdt"></div><div class="s-key">${SKILL_KEY_LABELS[i]}</div>${S ? `<div class="rank">${'•'.repeat(p.skills.learned[id] || 1)}</div>` : ''}</div>`; }).join('')}
        <div class="slot" id="s-heavy"><div class="s-ic">${icon(p.cls === 'samurai' ? 'sismico' : 'chute')}</div><div class="cd"></div><div class="s-key">RMB</div></div>
        <div class="slot" id="s-dash"><div class="s-ic">${icon('esquiva')}</div><div class="cd"></div><div class="s-key">SHIFT</div></div>
        <div class="slot" id="s-1"><div class="s-ic">${icon('bandagem')}</div><div class="cnt" id="c-1"></div><div class="s-key">1</div></div>
        <div class="slot" id="s-2"><div class="s-ic">${icon('medkit')}</div><div class="cnt" id="c-2"></div><div class="s-key">2</div></div>
      </div>
      <div class="hud-br panel">
        <div>${icon('mochila')} <b id="h-bag"></b></div>
        <div>${icon('moeda')} <b id="h-bagv"></b> <span class="dim">na mochila</span></div>
        <div>${icon('caveira')} <b id="h-kills">0</b> abates</div>
      </div>
      <div class="hud-help panel" id="h-help">
        <b>Controles</b><br>
        WASD mover · Mouse mirar · LMB atacar/combo · RMB ataque pesado<br>
        Q F G V habilidades · Shift dash · Espaço pular · Shift+RMB ou botão do meio: mover até<br>
        R recarregar · X trocar arma (fogo ⇄ lâmina) · E saquear (segure)<br>
        1 bandagem · 2 kit médico · Tab mochila · Y trava câmera · Scroll zoom · M som · Esc pausa
        <div class="dim">(H esconde esta ajuda)</div>
      </div>
      <div class="combo hidden" id="h-combo"><b>0</b><span>COMBO</span><div class="cb-mult"></div><div class="cb-track"><div class="cb-bar"></div></div></div>
      <div class="prompt hidden" id="h-prompt"></div>
      <div class="banner hidden" id="h-banner"><div class="b-title"></div><div class="b-sub"></div></div>
      <div class="vignette" id="h-vig"></div>
      <div class="safe-tag hidden" id="h-safe">${icon('fogueira')} ZONA SEGURA — regeneração acelerada</div>
      <div class="modal hidden" id="m-inv"></div>
      <div class="modal hidden" id="m-pause">
        <div class="modal-box small">
          <h2>PAUSADO</h2>
          <button class="btn" data-act="resume">Continuar</button>
          <button class="btn ghost" data-act="settings">Configurações</button>
          <button class="btn danger" data-act="abandon">Abandonar partida <span class="dim">(perde a mochila)</span></button>
        </div>
      </div>
      <div class="modal hidden" id="m-end"></div>
    </div>`);
    document.getElementById('screens').appendChild(this.root);
    this.$ = (id) => this.root.querySelector('#' + id);
    this.els = {};
    for (const id of ['h-hp', 'h-hpt', 'h-xp', 'h-xpt', 'h-lvl', 'h-obj', 'h-boss', 'h-bossn', 'h-bossf', 's-wic', 's-wtxt', 'h-bag', 'h-bagv', 'h-kills', 'h-prompt', 'h-banner', 'h-vig', 'h-safe', 'c-1', 'c-2', 'h-help', 'h-combo', 'h-party']) this.els[id] = this.$(id);
    this.mm = this.$('minimap').getContext('2d');
    this.buildMinimapBase();
    this.bossRef = null;
    this.bannerQ = [];
    this.bannerT = 0;
    this.slowT = 0;
    this.vig = 0;
    if (localStorage.getItem('zonamorta.help') === 'off') this.els['h-help'].classList.add('hidden');
    this.$('m-pause').addEventListener('click', (e) => {
      const a = e.target.closest('[data-act]')?.dataset.act;
      if (a === 'resume') this.togglePause(false);
      if (a === 'settings') openSettings();
      if (a === 'abandon') { this.togglePause(false); this.g.endRun('abandon'); }
    });
    this.refreshWeapon();
    this.refreshBag();
    this.refreshXp();
    this._v = new THREE.Vector3();
  }

  dispose() { this.root.remove(); this.g.app.octx.clearRect(0, 0, innerWidth, innerHeight); }

  // ---------- Atualização ----------
  update(dt) {
    const g = this.g, p = g.player, e = this.els;
    if (g.input.pressed('KeyH')) {
      e['h-help'].classList.toggle('hidden');
      localStorage.setItem('zonamorta.help', e['h-help'].classList.contains('hidden') ? 'off' : 'on');
    }
    e['h-hp'].style.width = (p.hp / p.stats.maxHp) * 100 + '%';
    e['h-hpt'].textContent = `${Math.ceil(p.hp)} / ${p.stats.maxHp}`;
    // cooldowns
    g.profile.skills.slots.forEach((id, i) => { if (id) this.setCd('s-k' + i, p.cds[id] || 0, skillCooldown(id, g.profile.skills.learned[id] || 1)); });
    this.setCd('s-heavy', p.heavyCd, p.isGun ? 0.75 : 1.1);
    // contador de combo
    const c = g.combo, ce = this.els['h-combo'];
    if (c.n >= 3) {
      ce.classList.remove('hidden');
      if (this._comboN !== c.n) { this._comboN = c.n; ce.querySelector('b').textContent = c.n; ce.classList.remove('pop'); void ce.offsetWidth; ce.classList.add('pop'); ce.querySelector('.cb-mult').textContent = '+' + Math.round((g.comboMult() - 1) * 100) + '% dano'; }
      ce.querySelector('.cb-bar').style.width = (c.t / 2.5) * 100 + '%';
    } else ce.classList.add('hidden');
    this.setCd('s-dash', p.dashCd, p.stats.dashCd);
    if (p.isGun) {
      e['s-wtxt'].innerHTML = p.reloadT > 0 ? '<span class="dim">recarregando…</span>' : (p.rapidT > 0 ? '<b style="color:#ff9a1f">∞</b>' : `<b>${p.ammo}</b>/${p.w.mag}`);
    }
    // vinheta de dano/vida baixa
    this.vig = Math.max(0, this.vig - dt * 2);
    const low = p.hp / p.stats.maxHp < 0.3 ? 0.35 + Math.sin(g.time * 6) * 0.15 : 0;
    e['h-vig'].style.opacity = Math.max(this.vig, low);
    e['h-safe'].classList.toggle('hidden', !g.playerInSafeZone());

    this.slowT -= dt;
    if (this.slowT <= 0) {
      this.slowT = 0.2;
      const nests = g.world.nests.filter((n) => !n.mother);
      const dead = nests.filter((n) => !n.alive).length;
      const m = g.world.mother;
      let html = `<span>${icon('ninho')} Ninhos <b>${dead}/${nests.length}</b></span>`;
      html += `<span>${icon('colmeia')} Colmeia Mãe <b class="${m.alive ? (g.motherShielded() ? 'warn' : 'hl') : 'ok'}">${m.alive ? (g.motherShielded() ? 'PROTEGIDA' : 'VULNERÁVEL') : 'DESTRUÍDA'}</b></span>`;
      html += `<span>${icon('boss')} ${escapeHtml(g.boss ? g.boss.name : g.mapDef.boss.name)} <b class="${g.bossDead ? 'ok' : ''}">${g.bossDead ? 'MORTO' : !g.boss || g.boss.state === 'dormant' ? 'adormecido' : 'ATIVO'}</b></span>`;
      if (g.cleared) html = `<span class="ok"><b>${icon('check')} ZONA LIMPA</b> — volte à base e extraia com o loot</span>`;
      e['h-obj'].innerHTML = html;
      e['h-kills'].textContent = g.run.kills;
      this.drawMinimap();
      this.renderParty();
    }
    if (this.bossRef) {
      const b = this.bossRef;
      e['h-bossf'].style.width = Math.max(0, b.hp / b.maxHp) * 100 + '%';
      if (b.dead) this.showBoss(null);
    }
    // banners
    if (this.bannerT > 0) {
      this.bannerT -= dt;
      if (this.bannerT <= 0) e['h-banner'].classList.add('hidden');
    } else if (this.bannerQ.length) {
      const b = this.bannerQ.shift();
      e['h-banner'].className = 'banner ' + b.cls;
      e['h-banner'].querySelector('.b-title').textContent = b.title;
      e['h-banner'].querySelector('.b-sub').textContent = b.sub || '';
      this.bannerT = 2.6;
    }
  }

  // painel do grupo co-op: código da sala, convite e vida dos aliados
  renderParty() {
    const g = this.g, box = this.els['h-party'];
    if (!g.coop) { box.classList.add('hidden'); return; }
    box.classList.remove('hidden');
    const rows = [...g.coop.remotes.values()].map((r) => `<div class="pt-row ${r.dead ? 'dead' : ''}"><span>${escapeHtml(r.name)} <span class="dim">Nv ${r.level}</span></span><div class="bar hp sm"><div class="fill" style="width:${Math.max(0, (r.hp / (r.mhp || 1)) * 100)}%"></div></div></div>`).join('');
    const html = `<div class="pt-head">${icon('pessoa')} Sala <b>${g.coop.code}</b> ${g.coop.isHost ? '<span class="dim">(anfitrião)</span>' : ''}
      <button class="btn sm" id="pt-inv">${icon('exportar')} Convidar</button></div>${rows || '<div class="dim sm">Ninguém mais na sala ainda.</div>'}`;
    if (html !== this._partyHtml) {
      this._partyHtml = html; box.innerHTML = html;
      box.querySelector('#pt-inv').onclick = async () => {
        const link = location.origin + '/?sala=' + g.coop.code;
        try { await navigator.clipboard.writeText(link); this.toast(`${icon('check')} Link copiado: ${link}`, 'loot'); }
        catch { prompt('Copie o link de convite:', link); }
      };
    }
  }

  setCd(id, t, max) {
    const s = this.root.querySelector('#' + id);
    const cd = s.querySelector('.cd'), cdt = s.querySelector('.cdt');
    const k = Math.max(0, t) / max;
    cd.style.height = k * 100 + '%';
    if (cdt) cdt.textContent = t > 0 ? Math.ceil(t) : '';
    s.classList.toggle('ready', t <= 0);
  }

  refreshWeapon() {
    const w = this.g.profile.equipped, i = itemInfo(w);
    this.els['s-wic'].innerHTML = icon(i.icon);
    this.root.querySelector('#s-wpn').style.setProperty('--rc', i.color);
    if (!this.g.player.isGun) this.els['s-wtxt'].innerHTML = `<span style="color:${i.color}">${i.name}</span>`;
  }

  refreshBag() {
    const g = this.g;
    this.els['h-bag'].textContent = `${g.bag.length}/${g.player.stats.bagSlots}`;
    this.els['h-bagv'].textContent = fmtMoney(g.bag.reduce((a, it) => a + itemValue(it), 0));
    const st = g.profile.stash;
    this.els['c-1'].textContent = countConsumable(g.bag, 'bandagem') + countConsumable(st, 'bandagem');
    this.els['c-2'].textContent = countConsumable(g.bag, 'medkit') + countConsumable(st, 'medkit');
    if (g.invOpen) this.renderInventory();
  }

  refreshXp() {
    const p = this.g.profile, need = xpToNext(p.level);
    this.els['h-xp'].style.width = (p.xp / need) * 100 + '%';
    this.els['h-xpt'].textContent = `XP ${p.xp} / ${need}${p.points ? `  ·  ${p.points} pts` : ''}`;
    this.els['h-lvl'].textContent = p.level;
  }

  hurt() { this.vig = 0.6; }
  toast(html, cls) { toast(html, cls); }
  prompt(html) {
    const e = this.els['h-prompt'];
    if (!html) { e.classList.add('hidden'); this._lastPrompt = null; return; }
    e.classList.remove('hidden');
    if (this._lastPrompt !== html) { e.innerHTML = html; this._lastPrompt = html; }
  }
  banner(title, cls = '', sub = '') {
    this.bannerQ.push({ title, cls, sub });
    if (this.bannerQ.length > 4) this.bannerQ.shift();
  }
  showBoss(z) {
    this.bossRef = z;
    this.els['h-boss'].classList.toggle('hidden', !z);
    if (z) this.els['h-bossn'].innerHTML = `${icon('boss')} ${escapeHtml(z.name)}`;
  }

  togglePause(force) {
    const g = this.g;
    g.paused = force ?? !g.paused;
    this.$('m-pause').classList.toggle('hidden', !g.paused);
  }

  // ---------- Mochila ----------
  toggleInventory(force) {
    const g = this.g;
    g.invOpen = force ?? !g.invOpen;
    this.$('m-inv').classList.toggle('hidden', !g.invOpen);
    if (g.invOpen) this.renderInventory();
  }

  renderInventory() {
    const g = this.g, p = g.profile, box = this.$('m-inv');
    const total = g.bag.reduce((a, it) => a + itemValue(it), 0);
    box.innerHTML = `<div class="modal-box wide">
      <div class="modal-head"><h2>${icon('mochila')} MOCHILA <span class="dim">${g.bag.length}/${g.player.stats.bagSlots}</span></h2><button class="btn sm" data-act="close">Fechar (Tab)</button></div>
      <div class="inv-cols">
        <div class="inv-left">
          <div class="label">Na mão</div>
          ${itemCardHtml(p.equipped)}
          <div class="label">Reserva <span class="dim">(X troca)</span></div>
          ${p.secondary ? itemCardHtml(p.secondary) : '<div class="empty">Sem arma reserva.</div>'}
          <div class="label">Itens da partida · ${fmtMoney(total)} <span class="warn">— perdidos se você morrer. Extraia no acampamento!</span></div>
          <div class="item-list" id="inv-list">
            ${g.bag.length ? g.bag.map((it) => {
              const canEquip = it.kind === 'weapon'; // qualquer classe usa arma de fogo e lâmina
              const btns = `<div class="item-actions">
                ${canEquip ? `<button class="btn sm" data-eq="${it.uid}">Na mão</button><button class="btn sm" data-sec="${it.uid}">Reserva</button>` : ''}
                ${it.kind === 'consumable' ? `<button class="btn sm" data-use="${it.id}">Usar</button>` : ''}
                <button class="btn sm ghost" data-drop="${it.uid}">Largar</button></div>`;
              return itemCardHtml(it, btns);
            }).join('') : '<div class="empty">Vazia. Saqueie caixas, carros, armários e cofres com <kbd>E</kbd>.</div>'}
          </div>
        </div>
        <div class="inv-right">
          <div class="label">Atributos — Nível ${p.level}</div>
          <div id="inv-attrs"></div>
        </div>
      </div>
    </div>`;
    renderAttributes(box.querySelector('#inv-attrs'), p, () => { g.player.refreshStats(); this.refreshXp(); this.refreshBag(); });
    box.querySelector('[data-act="close"]').onclick = () => this.toggleInventory(false);
    box.querySelectorAll('[data-eq]').forEach((b) => b.onclick = () => {
      const i = g.bag.findIndex((x) => x.uid === b.dataset.eq);
      if (i < 0) return;
      const w = g.bag[i];
      g.bag[i] = p.equipped;
      g.player.equip(w);
      this.refreshWeapon();
      sfx.reload();
      this.refreshBag();
      this.renderInventory();
    });
    box.querySelectorAll('[data-sec]').forEach((b) => b.onclick = () => {
      const i = g.bag.findIndex((x) => x.uid === b.dataset.sec);
      if (i < 0) return;
      const w = g.bag[i];
      if (p.secondary) g.bag[i] = p.secondary; else g.bag.splice(i, 1);
      p.secondary = w;
      g.player.refreshHolster();
      sfx.reload();
      this.refreshBag();
      this.renderInventory();
    });
    box.querySelectorAll('[data-use]').forEach((b) => b.onclick = () => { g.player.useCd = 0; g.player.useConsumable(b.dataset.use); this.renderInventory(); });
    box.querySelectorAll('[data-drop]').forEach((b) => b.onclick = () => {
      const i = g.bag.findIndex((x) => x.uid === b.dataset.drop);
      if (i < 0) return;
      const [it] = g.bag.splice(i, 1);
      g.dropItem(it, g.player.pos.x, g.player.pos.z, 1.5);
      this.refreshBag();
      this.renderInventory();
    });
  }

  // ---------- Fim de partida ----------
  showEnd(kind) {
    const g = this.g, r = g.run;
    const mins = ((performance.now() - r.start) / 60000).toFixed(1);
    const val = g.bag.reduce((a, it) => a + itemValue(it), 0);
    const titles = {
      death: ['VOCÊ MORREU', 'A mochila foi perdida. XP e níveis foram mantidos.', 'death'],
      extract: ['EXTRAÇÃO CONCLUÍDA', `Loot levado ao acampamento: ${fmtMoney(val)}`, 'good'],
      abandon: ['PARTIDA ABANDONADA', 'A mochila foi perdida.', 'death'],
      hostleft: ['O ANFITRIÃO ENCERROU', `A sala foi fechada. Seu loot foi guardado: ${fmtMoney(val)}`, 'good'],
    };
    const [t, sub, cls] = titles[kind];
    this.prompt(null);
    this.showBoss(null);
    const box = this.$('m-end');
    box.classList.remove('hidden');
    box.innerHTML = `<div class="modal-box end ${cls}">
      <h1>${t}</h1>
      <p>${sub}</p>
      ${g.cleared ? `<p class="ok">${icon('check')} Mapa limpo! Você eliminou o boss e a Colmeia Mãe.</p>` : ''}
      <div class="stat-grid">
        <div><span>Abates</span><b>${r.kills}</b></div>
        <div><span>XP ganho</span><b>${r.xp}</b></div>
        <div><span>Ninhos destruídos</span><b>${r.nests}</b></div>
        <div><span>Contêineres saqueados</span><b>${r.looted}</b></div>
        <div><span>Tempo</span><b>${mins} min</b></div>
        <div><span>Nível atual</span><b>${g.profile.level}</b></div>
      </div>
      <button class="btn big" id="end-hub">Voltar ao acampamento</button>
    </div>`;
    box.querySelector('#end-hub').onclick = () => g.app.go('hub');
  }

  // ---------- Minimapa ----------
  buildMinimapBase() {
    const w = this.g.world, GW = w.GW;
    const c = document.createElement('canvas');
    c.width = c.height = GW;
    const ctx = c.getContext('2d');
    const img = ctx.createImageData(GW, GW);
    for (let i = 0; i < GW * GW; i++) {
      const b = w.blocked[i];
      img.data[i * 4] = b ? 120 : 38; img.data[i * 4 + 1] = b ? 112 : 36; img.data[i * 4 + 2] = b ? 104 : 34; img.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    this.mmBase = c;
  }

  drawMinimap() {
    const g = this.g, w = g.world, ctx = this.mm, S = 200, k = S / w.size, h = w.half;
    const X = (x) => (x + h) * k, Z = (z) => (z + h) * k;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.mmBase, 0, 0, S, S);
    // zona segura
    ctx.strokeStyle = '#5fd35f'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(X(w.safe.x), Z(w.safe.z), w.safe.r * k, 0, Math.PI * 2); ctx.stroke();
    // saque
    ctx.fillStyle = '#ffd23f';
    for (const c of w.containers) if (!c.looted) ctx.fillRect(X(c.x) - 1, Z(c.z) - 1, c.type === 'tesouro' ? 5 : 2, c.type === 'tesouro' ? 5 : 2);
    for (const d of g.drops) { ctx.fillStyle = itemInfo(d.item).color; ctx.fillRect(X(d.x) - 1.5, Z(d.z) - 1.5, 3, 3); }
    // ninhos
    for (const n of w.nests) {
      ctx.fillStyle = n.alive ? (n.mother ? '#d050ff' : '#a040ff') : '#4a3050';
      ctx.beginPath(); ctx.arc(X(n.x), Z(n.z), n.mother ? 6 : 4, 0, Math.PI * 2); ctx.fill();
      if (n.mother && n.alive && n.shieldOn) { ctx.strokeStyle = '#e0b0ff'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(X(n.x), Z(n.z), 8, 0, Math.PI * 2); ctx.stroke(); }
    }
    // zumbis próximos
    const p = g.player.pos;
    for (const z of g.zombies) {
      if (z.dead) continue;
      const big = z.rank === 'boss' || z.rank === 'miniboss';
      if (!big && Math.hypot(z.pos.x - p.x, z.pos.z - p.z) > 40) continue;
      ctx.fillStyle = z.rank === 'boss' ? '#ff2a2a' : z.rank === 'miniboss' ? '#ff7a1f' : z.rank === 'elite' ? '#ffd23f' : '#c84040';
      const s = z.rank === 'boss' ? 6 : big ? 4 : 2;
      ctx.fillRect(X(z.pos.x) - s / 2, Z(z.pos.z) - s / 2, s, s);
    }
    // jogador
    const a = g.player.facing;
    ctx.save();
    ctx.translate(X(p.x), Z(p.z));
    ctx.rotate(-a + Math.PI);
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.moveTo(0, -6); ctx.lineTo(4, 4); ctx.lineTo(-4, 4); ctx.closePath(); ctx.fill();
    ctx.restore();
    // vista da câmera
    ctx.strokeStyle = 'rgba(255,255,255,0.25)'; ctx.lineWidth = 1;
    const cw = g.cam.dist * 1.1 * k, ch = g.cam.dist * 0.75 * k;
    ctx.strokeRect(X(g.cam.target.x) - cw, Z(g.cam.target.z) - ch, cw * 2, ch * 2);
  }

  // ---------- Overlay 2D (barras de vida, números) ----------
  project(x, y, z) {
    const v = this._v.set(x, y, z).project(this.g.camera);
    if (v.z > 1) return null;
    return [(v.x * 0.5 + 0.5) * innerWidth, (-v.y * 0.5 + 0.5) * innerHeight];
  }

  drawOverlay(ctx) {
    const g = this.g;
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    ctx.textAlign = 'center';
    for (const z of g.zombies) {
      if (z.dead) continue;
      const special = z.rank !== 'normal';
      if (!special && z.hp >= z.maxHp) continue;
      if (z.rank === 'boss' && z.state === 'dormant') continue;
      const s = this.project(z.pos.x, 2.15 * z.scale + 0.2, z.pos.z);
      if (!s || s[0] < -50 || s[0] > innerWidth + 50 || s[1] < -50 || s[1] > innerHeight + 50) continue;
      const w = special ? 40 + z.scale * 18 : 34, hgt = special ? 6 : 4;
      ctx.fillStyle = 'rgba(0,0,0,0.65)';
      ctx.fillRect(s[0] - w / 2 - 1, s[1] - 1, w + 2, hgt + 2);
      ctx.fillStyle = z.rank === 'boss' ? '#ff2a2a' : z.rank === 'miniboss' ? '#ff7a1f' : z.rank === 'elite' ? '#ffd23f' : '#d23a3a';
      ctx.fillRect(s[0] - w / 2, s[1], w * Math.max(0, z.hp / z.maxHp), hgt);
      if (special) {
        ctx.font = '600 12px Rajdhani, sans-serif';
        ctx.fillStyle = '#fff';
        ctx.fillText(z.name, s[0], s[1] - 4);
      }
    }
    if (g.coop) for (const r of g.coop.remotes.values()) { // nomes e vida dos aliados
      const s = this.project(r.pos.x, 2.5, r.pos.z);
      if (!s) continue;
      ctx.font = '700 13px Rajdhani, sans-serif'; ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,0.8)';
      ctx.strokeText(r.name, s[0], s[1] - 6); ctx.fillStyle = r.dead ? '#888' : '#7fd8ff'; ctx.fillText(r.name, s[0], s[1] - 6);
      ctx.fillStyle = 'rgba(0,0,0,0.65)'; ctx.fillRect(s[0] - 21, s[1] - 1, 42, 6);
      ctx.fillStyle = '#5fd35f'; ctx.fillRect(s[0] - 20, s[1], 40 * Math.max(0, r.hp / (r.mhp || 1)), 4);
    }
    for (const n of g.world.nests) {
      if (!n.alive) continue;
      const s = this.project(n.x, n.mother ? 8 : 3.8, n.z);
      if (!s) continue;
      const w = n.mother ? 120 : 70;
      ctx.fillStyle = 'rgba(0,0,0,0.65)';
      ctx.fillRect(s[0] - w / 2 - 1, s[1] - 1, w + 2, 8);
      ctx.fillStyle = n.mother && n.shieldOn ? '#7a5a9a' : '#b040ff';
      ctx.fillRect(s[0] - w / 2, s[1], w * (n.hp / n.maxHp), 6);
      ctx.font = '700 12px Rajdhani, sans-serif';
      ctx.fillStyle = '#e8c8ff';
      ctx.fillText(n.mother ? (n.shieldOn ? 'COLMEIA MÃE (PROTEGIDA)' : 'COLMEIA MÃE') : 'NINHO', s[0], s[1] - 4);
    }
    for (const nb of g.effects.numbers) {
      const s = this.project(nb.x + nb.ox, nb.y + nb.t * 1.6, nb.z);
      if (!s) continue;
      const a = 1 - nb.t / nb.life;
      ctx.globalAlpha = a;
      ctx.font = `700 ${nb.size}px Rajdhani, sans-serif`;
      ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,0.8)';
      ctx.strokeText(nb.text, s[0], s[1]);
      ctx.fillStyle = nb.color;
      ctx.fillText(nb.text, s[0], s[1]);
      ctx.globalAlpha = 1;
    }
    // barra de canalização (saque / extração)
    if (g.channel) {
      const p = g.player.pos, s = this.project(p.x, 2.6, p.z);
      if (s) {
        const k = g.channel.t / g.channel.dur;
        ctx.lineWidth = 5; ctx.strokeStyle = 'rgba(0,0,0,0.6)';
        ctx.beginPath(); ctx.arc(s[0], s[1], 18, 0, Math.PI * 2); ctx.stroke();
        ctx.strokeStyle = '#ffd23f';
        ctx.beginPath(); ctx.arc(s[0], s[1], 18, -Math.PI / 2, -Math.PI / 2 + k * Math.PI * 2); ctx.stroke();
      }
    }
    // mira
    const inp = g.input;
    if (g.touch) { // celular: marca o alvo da mira automática
      const t = g.touch.target, s = t && this.project(t.x, 0.1, t.z);
      if (s && !g.uiBlocking) {
        ctx.strokeStyle = 'rgba(255,80,60,0.9)'; ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.arc(s[0], s[1], 16 + Math.sin(g.time * 8) * 2, 0, Math.PI * 2); ctx.stroke();
      }
    } else if (!g.uiBlocking) {
      const mx = g.fps ? innerWidth / 2 : inp.mx, my = g.fps ? innerHeight / 2 : inp.my; // 1ª pessoa: mira no centro
      ctx.strokeStyle = 'rgba(255,255,255,0.85)'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(mx, my, 9, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(mx - 14, my); ctx.lineTo(mx - 5, my);
      ctx.moveTo(mx + 5, my); ctx.lineTo(mx + 14, my);
      ctx.moveTo(mx, my - 14); ctx.lineTo(mx, my - 5);
      ctx.moveTo(mx, my + 5); ctx.lineTo(mx, my + 14);
      ctx.stroke();
    }
  }
}
