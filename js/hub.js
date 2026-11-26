// ============================================================
//  ACAMPAMENTO (hub) — mapas, atributos, arsenal e mercado
// ============================================================
import * as THREE from 'three';
import { CLASSES, MAPS, WEAPONS, SHOP, RARITIES, ZOMBIE_TYPES, SKILLS, SKILL_KEY_LABELS, MAX_SKILL_RANK } from './data.js';
import { canLearn, learnSkill, storeMode } from './rpg.js';
import { skillCooldown } from './skills.js';
import { saveProfile, itemValue, itemInfo, xpToNext, exportProfile, randomWeapon, deriveStats, addToBag } from './rpg.js';
import { auth } from './auth.js';
import { buildHumanoid } from './character.js';
import { el, fmtMoney, escapeHtml, rand, uid } from './util.js';
import { toast, itemCardHtml, renderAttributes } from './ui.js';
import { idlePose } from './anim.js';
import { sfx, initAudio } from './audio.js';
import { icon } from './icons.js';
import { openSettings } from './settings.js';
import { net } from './net.js';
import { buildCampScene } from './camp.js';

const PANEL_W = 560;

// Cena do acampamento (reaproveitada no menu): js/camp.js
export { buildCampScene };

export class Hub {
  constructor(app, args = {}) {
    this.app = app;
    this.p = app.profile;
    this.tab = args.tab || 'maps';
    const camp = (this.camp = buildCampScene());
    this.scene = camp.scene;
    this.camera = new THREE.PerspectiveCamera(38, innerWidth / innerHeight, 0.1, 200);
    this.t = 0;
    this.lobbyActors = new Map();
    this.partyCenterX = -2;
    this.buildCharacter();

    this.root = el(`<div class="screen" id="hub">
      <div class="topbar">
        <div class="tb-left"><span class="logo-sm">ZONA MORTA</span> <span class="dim">Acampamento</span></div>
        <div class="tb-right">
          <span id="hb-name"></span>
          <span class="money" id="hb-money"></span>
          <button class="btn sm ghost" id="hb-settings">${icon('som')} Config.</button>
          <button class="btn sm ghost" id="hb-menu">Trocar personagem</button>
        </div>
      </div>
      <div class="side-panel right" style="width:${PANEL_W}px">
        <div class="tabs">
          <button data-tab="maps">${icon('mapa')} Mapas</button>
          <button data-tab="char">${icon('pessoa')} Personagem</button>
          <button data-tab="arsenal">${icon('mochila')} Arsenal</button>
          <button data-tab="skills">${icon('xp')} Habilidades</button>
          <button data-tab="shop">${icon('loja')} Mercado</button>
        </div>
        <div class="tab-body" id="hb-body"></div>
      </div>
    </div>`);
    document.getElementById('screens').appendChild(this.root);
    this.roomOffs = [
      net.on('room_state', () => { this.syncPartyCharacters(); if (this.app.screen === this && this.tab === 'maps') this.renderUI(); }),
      net.on('start_game', (m) => {
        if (this.app.screen !== this) return;
        const map = MAPS.find((x) => x.id === m.map);
        if (!map) { toast('O anfitrião escolheu um mapa desconhecido.', 'warn'); return; }
        this.app.startGame(map, { seed: m.seed, coop: { role: 'client', code: m.code, join: { peers: m.peers || [] } } });
      }),
    ];
    this.root.querySelectorAll('[data-tab]').forEach((b) => b.onclick = () => { this.tab = b.dataset.tab; sfx.click(); this.renderUI(); });
    this.root.querySelector('#hb-menu').onclick = () => app.go('menu');
    this.root.querySelector('#hb-settings').onclick = () => openSettings();
    this._click = () => initAudio();
    addEventListener('mousedown', this._click);
    this.renderUI();
    this.resize(innerWidth, innerHeight);
  }

  buildCharacter() {
    if (this.rig) { this.scene.remove(this.rig.root); this.rig.dispose(); }
    this.rig = buildHumanoid(this.p.appearance);
    this.rig.setWeapon(this.p.equipped);
    this.rig.root.position.set(-2.0, 0, -0.6);
    this.rig.root.rotation.y = 0.35;
    if (!this.fill) {
      this.fill = new THREE.PointLight(0xffc89a, 10, 9, 1.5);
      this.fill.position.set(-1.2, 2.4, 2.6);
      this.scene.add(this.fill);
    }
    this.scene.add(this.rig.root);
    this.isGun = WEAPONS[this.p.equipped.base].type === 'gun';
  }

  renderTop() {
    const p = this.p, c = CLASSES[p.cls];
    this.root.querySelector('#hb-name').innerHTML = `${icon(c.icon)} <b>${escapeHtml(p.name)}</b> · ${c.name} · Nv ${p.level}${p.points ? ` <span class="hl">(+${p.points} pts)</span>` : ''}`;
    this.root.querySelector('#hb-money').textContent = fmtMoney(p.money);
  }

  renderUI() {
    this.renderTop();
    this.root.querySelectorAll('[data-tab]').forEach((b) => b.classList.toggle('sel', b.dataset.tab === this.tab));
    const body = this.root.querySelector('#hb-body');
    if (this.tab === 'maps') this.renderMaps(body);
    if (this.tab === 'char') this.renderChar(body);
    if (this.tab === 'arsenal') this.renderArsenal(body);
    if (this.tab === 'shop') this.renderShop(body);
    if (this.tab === 'skills') this.renderSkills(body);
  }

  mapUnlocked(i) {
    if (i === 0) return true;
    return this.p.cleared.includes(MAPS[i - 1].id) || this.p.level >= MAPS[i].level;
  }

  renderMaps(body) {
    const p = this.p, online = storeMode() === 'server', inv = this.app.invite;
    const room = net.room;
    const roomPanel = room ? `<div class="room-box party-lobby">
        <b>${icon('pessoa')} ${room.phase === 'lobby' ? 'Grupo reunido no acampamento' : 'Sala co-op'} · código <code>${escapeHtml(room.code)}</code></b>
        <div class="party-roster">${(room.players || []).map((member) => `<div class="party-member ${member.host ? 'party-host' : ''} ${member.ready ? 'is-ready' : ''}"><span class="party-dot"></span><b>${escapeHtml(member.info?.name || 'Sobrevivente')}</b><small>${CLASSES[member.info?.cls]?.name || member.info?.cls || 'Classe'} · Nv ${member.info?.level || 1}${member.host ? ' · Anfitrião' : ''}</small><em>${room.phase === 'lobby' ? (member.ready ? 'Pronto' : 'Aguardando') : 'Na incursão'}</em></div>`).join('')}</div>
        ${room.phase === 'lobby' ? `<div class="dim sm">Todos voltaram da extração. Escolham os personagens e marquem Pronto; o anfitrião inicia o próximo mapa.</div><div class="row gap"><button class="btn sm" id="room-ready">${(room.players || []).find((x) => x.id === net.id)?.ready ? 'Cancelar Pronto' : 'Estou Pronto'}</button><button class="btn sm ghost" id="room-copy">Copiar convite</button></div>` : '<div class="dim sm">A sala permanece aberta. O grupo se reunirá aqui após a extração.</div>'}
      </div>` : `<div class="room-box ${inv ? 'invite' : ''}">
        <b>${icon('pessoa')} Jogar com amigos</b>
        <div class="dim sm">Ao explorar um mapa você vira anfitrião e recebe um código de sala (botão <b>Convidar</b> no jogo). Para entrar na sala de alguém, digite o código:</div>
        <div class="row gap"><input id="rm-code" maxlength="4" placeholder="ABCD" value="${inv ? inv.toUpperCase() : ''}"><button class="btn sm" id="rm-join">Entrar na sala</button></div>
      </div>`;
    body.innerHTML = (online ? roomPanel : '<p class="dim sm">Modo offline: para jogar com amigos, rode o jogo com <b>node server.js</b>.</p>') + `<p class="dim">Escolha uma zona. Saqueie, destrua os ninhos, mate o boss e <b>volte ao acampamento para extrair</b> o loot. Morrer = perder a mochila.</p>
      ${MAPS.map((m, i) => {
        const un = this.mapUnlocked(i), cl = p.cleared.includes(m.id);
        const theme = { city: 'Cidade', suburb: 'Subúrbio', port: 'Porto', military: 'Militar' }[m.theme];
        const types = Object.keys(m.pool).map((k) => ZOMBIE_TYPES[k].name).join(', ');
        return `<div class="map-card ${un ? '' : 'locked'} ${cl ? 'cleared' : ''} t-${m.theme}">
          <div class="mc-head"><div class="mc-name">${m.name}</div><div class="mc-lvl">Nv recomendado ${m.level}</div></div>
          <div class="mc-desc">${m.desc}</div>
          <div class="mc-info">${icon(m.theme === 'city' ? 'cidade' : m.theme === 'suburb' ? 'suburbio' : m.theme === 'port' ? 'porto' : 'militar')} ${theme} · ${icon('ninho')} ${m.nests} ninhos · ${icon('boss')} Boss: <b>${m.boss.name}</b></div>
          <div class="mc-info dim">Zumbis: ${types}</div>
          <div class="mc-foot">
            ${cl ? `<span class="ok">${icon('check')} Zona limpa</span>` : un ? '' : `<span class="warn">${icon('cadeado')} Limpe "${MAPS[i - 1].name}" ou alcance Nv ${m.level}</span>`}
            ${un ? `<button class="btn" data-go="${m.id}" ${room && (!room.host || !room.allReady) ? 'disabled' : ''}>${room ? (room.host ? 'Iniciar grupo' : 'Aguardando anfitrião') : 'Explorar'}</button>` : ''}
          </div>
        </div>`;
      }).join('')}`;
    const jb = body.querySelector('#rm-join');
    if (jb) jb.onclick = () => { const c = body.querySelector('#rm-code').value; if (c.trim().length === 4) this.app.joinRoom(c); else toast('Digite o código de 4 letras', 'warn'); };
    const ready = body.querySelector('#room-ready');
    if (ready) ready.onclick = () => { const mine = (net.room?.players || []).find((x) => x.id === net.id); net.setReady(!mine?.ready); };
    const copy = body.querySelector('#room-copy');
    if (copy) copy.onclick = () => navigator.clipboard.writeText(net.room?.code || '').then(() => toast('Código de convite copiado.')).catch(() => toast('Não foi possível copiar o convite.', 'warn'));
    body.querySelectorAll('[data-go]').forEach((b) => b.onclick = () => {
      sfx.click();
      const map = MAPS.find((m) => m.id === b.dataset.go);
      if (net.room) this.startPartyGame(map);
      else this.app.startGame(map);
    });
    this.syncPartyCharacters();
  }

  async startPartyGame(map) {
    if (!net.room?.host || !net.room.allReady) { toast('Aguarde todos os jogadores marcarem Pronto.', 'dim'); return; }
    const seed = (Math.random() * 1e9) | 0;
      try {
        await net.startRoom(map.id, seed);
        const peers = (net.room.players || []).filter((x) => x.id !== net.id).map((x) => ({ id: x.id, info: x.info }));
        this.app.startGame(map, { seed, coop: { role: 'host', code: net.room.code, join: { peers } } });
      }
    catch (e) { toast(e.message || 'Não foi possível iniciar a partida.', 'warn'); }
  }

  syncPartyCharacters() {
    const room = net.room, players = room?.players || [];
    if (!room || !players.length) {
      for (const actor of this.lobbyActors.values()) { this.scene.remove(actor.rig.root); actor.rig.dispose(); }
      this.lobbyActors.clear(); this.rig.root.position.x = -2; this.partyCenterX = -2; return;
    }
    const slot = players.findIndex((x) => x.id === net.id), count = players.length;
    this.partyCenterX = -2;
    this.rig.root.position.set(-2 + (slot - (count - 1) / 2) * 0.95, 0, -0.6);
    const keep = new Set();
    players.forEach((member, index) => {
      if (member.id === net.id) return;
      keep.add(member.id);
      let actor = this.lobbyActors.get(member.id);
      if (!actor) {
        const rig = buildHumanoid(member.info?.appearance || this.p.appearance);
        if (member.info?.equipped) rig.setWeapon(member.info.equipped);
        this.scene.add(rig.root); actor = { rig, phase: index * 1.4, info: member.info }; this.lobbyActors.set(member.id, actor);
      }
      actor.rig.root.position.set(-2 + (index - (count - 1) / 2) * 0.95, 0, -0.6);
      actor.rig.root.rotation.y = 0.2;
    });
    for (const [id, actor] of this.lobbyActors) if (!keep.has(id)) { this.scene.remove(actor.rig.root); actor.rig.dispose(); this.lobbyActors.delete(id); }
  }

  renderChar(body) {
    const p = this.p, s = p.stats, need = xpToNext(p.level);
    body.innerHTML = `
      <div class="xpline"><div class="bar xp"><div class="fill" style="width:${(p.xp / need) * 100}%"></div><span>Nível ${p.level} · XP ${p.xp}/${need}</span></div></div>
      <div id="hb-attrs"></div>
      <div class="label">Histórico</div>
      <div class="stat-grid">
        <div><span>Abates</span><b>${s.kills}</b></div><div><span>Mini-bosses</span><b>${s.minibosses}</b></div>
        <div><span>Bosses</span><b>${s.bosses}</b></div><div><span>Ninhos</span><b>${s.nests}</b></div>
        <div><span>Incursões</span><b>${s.runs}</b></div><div><span>Extrações</span><b>${s.extracted}</b></div>
        <div><span>Mortes</span><b>${s.deaths}</b></div><div><span>Mapas limpos</span><b>${p.cleared.length}/${MAPS.length}</b></div>
      </div>
      <div class="row gap">
        <button class="btn ghost" id="hb-edit">${icon('editar')} Editar visual</button>
        <button class="btn ghost" id="hb-export">${icon('exportar')} Exportar personagem</button>
      </div>
      <div id="hb-code" class="hidden">
        <p class="dim">Este código leva seu personagem (nível, atributos, arsenal) para outro navegador ou mundo. Use "Importar" no menu principal.</p>
        <textarea readonly rows="4"></textarea>
        <button class="btn sm" id="hb-copy">Copiar</button>
      </div>`;
    renderAttributes(body.querySelector('#hb-attrs'), p, () => this.renderTop());
    body.querySelector('#hb-edit').onclick = () => this.app.go('creator', { profile: p });
    body.querySelector('#hb-export').onclick = () => {
      const box = body.querySelector('#hb-code');
      box.classList.remove('hidden');
      const ta = box.querySelector('textarea');
      if (!auth.on) { ta.value = exportProfile(p); return; }
      ta.value = 'Gerando código...';
      auth.exportCode(p).then((code) => { ta.value = code; }).catch((e) => { ta.value = ''; toast('Não foi possível exportar: ' + e.message, 'warn'); });
    };
    body.querySelector('#hb-copy') && (body.querySelector('#hb-copy').onclick = async () => {
      const ta = body.querySelector('#hb-code textarea');
      try { await navigator.clipboard.writeText(ta.value); toast('Código copiado!'); } catch { ta.select(); document.execCommand('copy'); toast('Código copiado!'); }
    });
  }

  renderArsenal(body) {
    const p = this.p;
    const weapons = p.stash.filter((i) => i.kind === 'weapon').sort((a, b) => b.rarity - a.rarity);
    const vals = p.stash.filter((i) => i.kind === 'valuable');
    const cons = p.stash.filter((i) => i.kind === 'consumable');
    const valTotal = vals.reduce((a, it) => a + itemValue(it), 0);
    body.innerHTML = `
      <div class="label">Arma equipada</div>
      ${itemCardHtml(p.equipped)}
      <div class="label">Consumíveis <span class="dim">— ficam no cinto: usáveis em qualquer incursão (teclas 1 e 2)</span></div>
      <div class="item-list">${cons.length ? cons.map((it) => itemCardHtml(it)).join('') : '<div class="empty">Nenhum. Compre no Mercado.</div>'}</div>
      <div class="label">Armas guardadas (${weapons.length})</div>
      <div class="item-list">${weapons.length ? weapons.map((it) => {
        const can = WEAPONS[it.base].cls === p.cls;
        return itemCardHtml(it, `<div class="item-actions">${can ? `<button class="btn sm" data-eq="${it.uid}">Equipar</button>` : '<span class="dim sm">outra classe</span>'}<button class="btn sm ghost" data-sell="${it.uid}">Vender</button></div>`);
      }).join('') : '<div class="empty">Nenhuma arma extra.</div>'}</div>
      <div class="label">Itens de valor · ${fmtMoney(valTotal)} ${vals.length ? '<button class="btn sm" id="sell-all">Vender todos</button>' : ''}</div>
      <div class="item-list">${vals.length ? vals.map((it) => itemCardHtml(it, `<div class="item-actions"><button class="btn sm ghost" data-sell="${it.uid}">Vender</button></div>`)).join('') : '<div class="empty">Traga loot das zonas para vender aqui.</div>'}</div>`;
    const mm = deriveStats(p).moneyMult;
    body.querySelectorAll('[data-eq]').forEach((b) => b.onclick = () => {
      const i = p.stash.findIndex((x) => x.uid === b.dataset.eq);
      const w = p.stash[i];
      p.stash[i] = p.equipped;
      p.equipped = w;
      saveProfile(p); sfx.reload();
      this.buildCharacter();
      this.renderUI();
    });
    // com servidor: a venda acontece lá (o preço e o dinheiro são calculados no servidor)
    const sellOnServer = (uids, all) => auth.sell(p, uids, all)
      .then((r) => { r.total ? (all ? sfx.rare() : sfx.pickup()) : 0; toast(`${all ? 'Vendido: ' : ''}+${fmtMoney(r.total)}`, 'loot'); this.renderUI(); })
      .catch((e) => toast('Venda recusada: ' + e.message, 'warn'));
    body.querySelectorAll('[data-sell]').forEach((b) => b.onclick = () => {
      if (auth.on) { b.disabled = true; return sellOnServer([b.dataset.sell], false); }
      const i = p.stash.findIndex((x) => x.uid === b.dataset.sell);
      if (i < 0) return;
      const v = Math.round(itemValue(p.stash[i]) * mm);
      p.money += v;
      p.stash.splice(i, 1);
      saveProfile(p); sfx.pickup();
      toast(`+${fmtMoney(v)}`, 'loot');
      this.renderUI();
    });
    const sa = body.querySelector('#sell-all');
    if (sa) sa.onclick = () => {
      if (auth.on) { sa.disabled = true; return sellOnServer([], true); }
      const v = Math.round(valTotal * mm);
      p.money += v;
      p.stash = p.stash.filter((x) => x.kind !== 'valuable');
      saveProfile(p); sfx.rare();
      toast(`Vendido: +${fmtMoney(v)}`, 'loot');
      this.renderUI();
    };
  }

  renderSkills(body) {
    const p = this.p;
    const list = Object.entries(SKILLS).filter(([, S]) => S.cls === p.cls || S.cls === 'all').sort((a, b) => a[1].lvl - b[1].lvl);
    body.innerHTML = `<div class="sk-head">Pontos de habilidade: <b class="${p.sp ? 'hl' : ''}">${p.sp}</b> <span class="dim">(+1 por nível)</span></div>
      <div class="sk-slots">${p.skills.slots.map((id, i) => `<div class="sk-slot"><span class="s-key">${SKILL_KEY_LABELS[i]}</span>${id ? icon(SKILLS[id].icon) + '<span>' + SKILLS[id].name + '</span>' : '<span class="dim">vazio</span>'}</div>`).join('')}</div>
      <p class="dim sm">Combine golpes: LMB encadeia 3 ataques (o 3º é o finalizador), RMB é o ataque pesado, atacar logo após a esquiva dá +50% de dano. Acertos seguidos aumentam o COMBO (+1% de dano por acerto, até +30%).</p>
      ${list.map(([id, S]) => {
        const r = p.skills.learned[id] || 0, locked = p.level < S.lvl;
        const pips = Array.from({ length: MAX_SKILL_RANK }, (_, k) => `<i class="${k < r ? 'on' : ''}"></i>`).join('');
        return `<div class="skill-card ${r ? 'learned' : ''} ${locked ? 'locked' : ''}">
          <div class="sk-ic">${icon(S.icon)}</div>
          <div class="sk-body"><div class="sk-name">${S.name} <span class="pips">${pips}</span></div>
            <div class="sk-desc">${S.desc}</div>
            <div class="sk-meta">Recarga ${skillCooldown(id, Math.max(1, r)).toFixed(1)}s · ${S.cls === 'all' ? 'Universal' : CLASSES[S.cls].name} · ${locked ? '<span class="warn">Requer nível ' + S.lvl + '</span>' : 'Nível ' + S.lvl + '+'}</div>
          </div>
          <div class="sk-actions">
            ${canLearn(p, id) ? `<button class="btn sm" data-learn="${id}">${r ? 'Melhorar' : 'Aprender'} (1 pt)</button>` : ''}
            ${r ? `<div class="sk-keys">${SKILL_KEY_LABELS.map((k, i) => `<button class="chip ${p.skills.slots[i] === id ? 'sel' : ''}" data-slot="${i}" data-id="${id}">${k}</button>`).join('')}</div>` : ''}
          </div>
        </div>`;
      }).join('')}`;
    body.querySelectorAll('[data-learn]').forEach((b) => b.onclick = () => { if (learnSkill(p, b.dataset.learn)) { saveProfile(p); sfx.levelup(); this.renderUI(); } });
    body.querySelectorAll('[data-slot]').forEach((b) => b.onclick = () => {
      const i = Number(b.dataset.slot), id = b.dataset.id, slots = p.skills.slots;
      const prev = slots.indexOf(id);
      if (prev >= 0) slots[prev] = slots[i] === id ? null : slots[i];
      slots[i] = id;
      saveProfile(p); sfx.click(); this.renderUI();
    });
  }

  renderShop(body) {
    const p = this.p;
    body.innerHTML = `<p class="dim">Comerciantes do acampamento aceitam dinheiro do velho mundo.</p>
      ${SHOP.map((s) => `<div class="shop-item">
        <div class="item-icon">${icon(s.icon)}</div>
        <div class="item-body"><div class="item-name">${s.name}</div><div class="item-sub">${s.desc}</div></div>
        <button class="btn sm" data-buy="${s.id}" ${p.money >= s.price ? '' : 'disabled'}>${fmtMoney(s.price)}</button>
      </div>`).join('')}
      <p class="dim">Dica: atributos de <b>Sorte</b> aumentam a raridade do loot e o valor de venda.</p>`;
    body.querySelectorAll('[data-buy]').forEach((b) => b.onclick = () => {
      const s = SHOP.find((x) => x.id === b.dataset.buy);
      if (p.money < s.price) return;
      if (auth.on) { // compra feita no servidor: ele cobra e sorteia a arma
        b.disabled = true;
        auth.buy(p, s.id).then((r) => {
          if (r.got.kind === 'weapon') {
            const i = itemInfo(r.got);
            toast(`${icon(s.icon)} Você obteve: <b style="color:${i.color}">${i.name}</b> (${i.rarity})`, 'loot', 4000);
            r.got.rarity >= 3 ? sfx.rare() : sfx.pickup();
          } else { sfx.pickup(); toast(`Comprado: ${s.name}`); }
          this.renderUI();
        }).catch((e) => { toast('Compra recusada: ' + e.message, 'warn'); this.renderUI(); });
        return;
      }
      p.money -= s.price;
      if (s.give) addToBag(p.stash, { uid: uid(), ...s.give }, Infinity);
      if (s.crate) {
        const w = randomWeapon(p.cls, Math.max(1, p.level - 1), deriveStats(p).luck, s.crate.tier, s.crate.minRarity);
        p.stash.push(w);
        const i = itemInfo(w);
        toast(`${icon(s.icon)} Você obteve: <b style="color:${i.color}">${i.name}</b> (${i.rarity})`, 'loot', 4000);
        w.rarity >= 3 ? sfx.rare() : sfx.pickup();
      } else { sfx.pickup(); toast(`Comprado: ${s.name}`); }
      saveProfile(p);
      this.renderUI();
    });
  }

  update(dt) {
    this.t += dt;
    this.camp.update(dt);
    const r = this.rig;
    idlePose(r, this.t, this.isGun);
    for (const actor of this.lobbyActors.values()) idlePose(actor.rig, this.t + actor.phase, false);
    r.head.rotation.y = Math.sin(this.t * 0.5) * 0.3;
  }

  render() { this.app.draw(this.scene, this.camera); }

  resize(w, h) {
    const c = this.camera;
    c.aspect = w / h;
    c.updateProjectionMatrix();
    const dist = 7.5;
    const halfW = dist * Math.tan(THREE.MathUtils.degToRad(c.fov / 2)) * c.aspect;
    const shift = (PANEL_W / 2 / (w / 2)) * halfW;
    c.position.set(this.partyCenterX + shift, 2.4, -0.6 + dist);
    c.lookAt(this.partyCenterX, 1.1, -0.6);
  }

  dispose() {
    (this.roomOffs || []).forEach((off) => off());
    removeEventListener('mousedown', this._click);
    this.root.remove();
    this.rig.dispose();
    for (const actor of this.lobbyActors.values()) actor.rig.dispose();
    this.lobbyActors.clear();
    this.scene.clear();
  }
}
