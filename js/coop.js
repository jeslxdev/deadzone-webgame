// ============================================================
//  CO-OP — partida compartilhada (até 4 jogadores)
//  Modelo "anfitrião autoritativo": o anfitrião simula zumbis,
//  ninhos, loot e drops e envia snapshots ~14x/s. Convidados
//  simulam o próprio personagem e enviam acertos/pedidos.
// ============================================================
import * as THREE from 'three';
import { ZOMBIE_TYPES, RANKS, WEAPONS, RARITIES } from './data.js';
import { buildHumanoid } from './character.js';
import { humanGait, newGait } from './anim.js';
import { addXraySilhouette, markCharacterOrder } from './occlusion.js';
import { Zombie } from './zombies.js';
import { rollLoot, randomWeapon, addToBag, itemInfo, saveProfile } from './rpg.js';
import { net } from './net.js';
import { auth } from './auth.js';

// Limites para dano enviado por convidados (evita "one-shot" vindo de um cliente alterado)
const MAX_HIT = 2500, MAX_DPS = 9000;
function capDamage(state, from, dmg) {
  dmg = Number(dmg);
  if (!Number.isFinite(dmg) || dmg <= 0) return 0;
  const now = performance.now() / 1000;
  const b = state.get(from) || { t: now, budget: MAX_DPS };
  b.budget = Math.min(MAX_DPS * 2, b.budget + (now - b.t) * MAX_DPS); b.t = now;
  dmg = Math.min(dmg, MAX_HIT, b.budget);
  b.budget -= dmg;
  state.set(from, b);
  return dmg;
}
const dmgState = new Map();
import { sfx } from './audio.js';
import { toast } from './ui.js';
import { icon } from './icons.js';
import { angleLerp, escapeHtml } from './util.js';

const TYPES = Object.keys(ZOMBIE_TYPES);
const RANK_K = Object.keys(RANKS);
const r1 = (v) => Math.round(v * 10) / 10;
const FX_METHODS = ['telegraphCircle', 'telegraphLine', 'shock', 'explosion', 'beam'];

// ---------- jogador remoto ----------
class RemotePlayer {
  constructor(g, id, info) {
    this.g = g; this.id = id; this.info = info;
    this.name = info.name;
    this.rig = buildHumanoid(info.appearance);
    addXraySilhouette(this.rig.root, 0x8dff9a); // aliados também aparecem atrás do cenário
    this.wkey = '';
    this.setWeapon(info.equipped);
    g.scene.add(this.rig.root);
    this.pos = new THREE.Vector3(g.world.safe.x, 0, g.world.safe.z);
    this.radius = 0.45; this.facing = 0; this.dead = false; this.hp = 100; this.mhp = 100; this.level = info.level;
    this.t = null; this.gait = newGait(); this.atk = 0; this.shot = 0; this.attackAnim = 0; this.swingDir = 1; this.recoil = 0;
    this.flow = null; this.flowT = 0; this.flowCell = -1;
    this.isRemote = true;
  }
  setWeapon(w) {
    const k = w.base + ':' + w.rarity;
    if (k === this.wkey) return;
    this.wkey = k; this.rig.setWeapon(w); markCharacterOrder(this.rig.root); this.isGun = WEAPONS[w.base].type === 'gun';
  }
  apply(s) {
    if (!this.t) this.pos.set(s.x, 0, s.z);
    this.t = s;
    this.hp = s.hp; this.mhp = s.mhp; this.level = s.lvl;
    if (s.dead && !this.dead) { this.dead = true; toast(`${icon('caveira')} ${escapeHtml(this.name)} caiu!`, 'warn'); }
    if (!s.dead) this.dead = false;
    if (s.w) this.setWeapon({ base: s.w[0], rarity: s.w[1] });
    if (s.at !== this.atk) { this.atk = s.at; this.attackAnim = 1; this.swingDir = s.sd || -this.swingDir; this.remoteSwing(); }
    if (s.sh !== this.shot) { this.shot = s.sh; this.remoteShot(); }
  }
  remoteSwing() {
    if (this.isGun) return;
    const a = this.facing, d = Math.hypot(this.pos.x - this.g.player.pos.x, this.pos.z - this.g.player.pos.z);
    this.g.effects.slash(this.pos.x + Math.sin(a) * 0.3, this.pos.z + Math.cos(a) * 0.3, a, 2.2, 2.9, 0xe8f4ff);
    if (d < 20) sfx.slash();
  }
  remoteShot() {
    const a = this.facing, mx = this.pos.x + Math.sin(a) * 0.9, mz = this.pos.z + Math.cos(a) * 0.9;
    this.g.effects.muzzle(mx, 1.3, mz);
    this.g.effects.tracer(mx, 1.3, mz, mx + Math.sin(a) * 14, mz + Math.cos(a) * 14);
    this.recoil = 1;
    const d = Math.hypot(this.pos.x - this.g.player.pos.x, this.pos.z - this.g.player.pos.z);
    if (d < 35) sfx.shot(this.wkey.split(':')[0]);
  }
  update(dt) {
    const s = this.t, rig = this.rig;
    let spd = 0;
    if (s) {
      const k = 1 - Math.exp(-dt * 14), px = this.pos.x, pz = this.pos.z;
      this.pos.x += (s.x - px) * k; this.pos.z += (s.z - pz) * k;
      spd = s.sp || 0;
      this.facing = angleLerp(this.facing, s.f, Math.min(1, dt * 14));
    }
    if (this.dead) {
      rig.body.rotation.x = Math.max(-Math.PI / 2, rig.body.rotation.x - dt * 5);
    } else {
      rig.body.rotation.x = 0;
      humanGait(rig, this.gait, dt, spd, { runAt: 8, freeArms: false, freeTorso: this.attackAnim <= 0 });
      this.recoil = Math.max(0, this.recoil - dt * 10);
      if (this.isGun) {
        rig.armR.rotation.set(-Math.PI / 2 + this.recoil * 0.22, 0.1, 0); rig.elbowR.rotation.x = -0.05;
        rig.armL.rotation.set(-1.05, -0.75, 0); rig.elbowL.rotation.x = -0.75;
      } else if (this.attackAnim > 0) {
        this.attackAnim = Math.max(0, this.attackAnim - dt / 0.25);
        const e = 1 - this.attackAnim, sd = this.swingDir;
        rig.armR.rotation.set(-1.45, sd * THREE.MathUtils.lerp(1.4, -1.3, e), 0); rig.elbowR.rotation.x = -0.4 * (1 - Math.sin(e * Math.PI));
        rig.torso.rotation.y = sd * THREE.MathUtils.lerp(0.6, -0.6, e);
      } else {
        rig.armR.rotation.set(-0.4, 0.12, -0.05); rig.elbowR.rotation.x = -0.7;
        rig.armL.rotation.set(Math.sin(this.gait.ph) * 0.4 * this.gait.blend, 0, 0.08); rig.elbowL.rotation.x = -0.3;
      }
    }
    rig.root.position.set(this.pos.x, s && s.ly ? s.ly : 0, this.pos.z);
    rig.root.rotation.y = s && s.spin ? this.g.time * 22 : this.facing;
  }
  // chamados pela IA dos zumbis no anfitrião
  takeDamage(a) { if (!this.dead) net.sendTo(this.id, { k: 'dmg', a }); }
  knock(x, z) { net.sendTo(this.id, { k: 'kn', x, z }); }
  dispose() { this.g.scene.remove(this.rig.root); this.rig.dispose(); }
}

// ---------- controlador da sessão co-op ----------
export class Coop {
  constructor(g, role, code, joinMsg = null) {
    this.g = g; this.role = role; this.code = code;
    this.remotes = new Map();
    this.zmap = new Map();      // convidado: nid -> zumbi
    this.cdrops = new Map();    // convidado: did -> drop visual
    this.shotMeshes = [];
    this.sendT = 0; this.snapT = 0; this.replaying = false;
    this.pendingLoot = new Set();
    // efeitos visuais compartilhados: todo efeito local relevante é repassado
    const fx = g.effects;
    for (const m of FX_METHODS) {
      const orig = fx[m].bind(fx);
      fx[m] = (...a) => { if (!this.replaying) net.broadcast({ k: 'fx', m, a }); return orig(...a); };
    }
    this.offs = [
      net.on('b', (m) => this.onMsg(m.from, m.d)),
      net.on('m', (m) => this.onMsg(m.from, m.d)),
      net.on('peer_join', (m) => this.addRemote(m.id, m.info, true)),
      net.on('peer_leave', (m) => this.removeRemote(m.id)),
      net.on('room_closed', () => this.onClosed()),
      net.on('close', () => this.onClosed()),
    ];
    if (joinMsg) for (const p of joinMsg.peers) this.addRemote(p.id, p.info, false);
  }
  get isHost() { return this.role === 'host'; }
  get isClient() { return this.role === 'client'; }

  addRemote(id, info, announce) {
    if (this.remotes.has(id) || id === net.id) return;
    this.remotes.set(id, new RemotePlayer(this.g, id, info));
    if (announce) { toast(`${icon('pessoa')} <b>${escapeHtml(info.name)}</b> entrou na sala`, 'loot'); sfx.pickup(); }
  }
  removeRemote(id) {
    const r = this.remotes.get(id);
    if (!r) return;
    toast(`${icon('pessoa')} ${escapeHtml(r.name)} saiu da sala`, 'dim');
    r.dispose(); this.remotes.delete(id);
  }
  onClosed() {
    if (this.closed) return;
    this.closed = true;
    if (this.isClient && !this.g.ended) this.g.endRun('hostleft');
  }
  dispose() {
    this.offs.forEach((off) => off());
    for (const r of this.remotes.values()) r.dispose();
    this.remotes.clear();
    for (const m of this.shotMeshes) this.g.scene.remove(m);
    if (net.room && this.g.ended !== 'extract') net.leave();
  }

  // alvos possíveis para os zumbis (anfitrião)
  targets() {
    const out = [];
    if (!this.g.player.dead) out.push(this.g.player);
    for (const r of this.remotes.values()) if (!r.dead && r.t) out.push(r);
    return out;
  }

  ownState() {
    const p = this.g.player, w = this.g.profile.equipped;
    return {
      k: 'p', x: r1(p.pos.x), z: r1(p.pos.z), f: Math.round(p.facing * 100) / 100, sp: r1(Math.hypot(p.vel.x, p.vel.z)),
      at: p.netAtk, sd: p.swingDir, sh: p.netShot, hp: Math.round(p.hp), mhp: p.stats.maxHp, lvl: this.g.profile.level,
      dead: p.dead ? 1 : 0, w: [w.base, w.rarity], spin: p.spinT > 0 ? 1 : 0, ly: r1((p.leapY || 0) + (p.y || 0)),
    };
  }

  update(dt) {
    const g = this.g;
    this.sendT -= dt;
    if (this.sendT <= 0) { this.sendT = 1 / 15; net.broadcast(this.ownState()); }
    if (this.isHost) {
      this.snapT -= dt;
      if (this.snapT <= 0) { this.snapT = 0.07; net.broadcast(this.snapshot()); }
      // campos de navegação para perseguir jogadores remotos
      for (const r of this.remotes.values()) {
        if (!r.flow) r.flow = g.world.newField();
        r.flowT -= dt;
        const c = g.world.cellOf(r.pos.x, r.pos.z);
        if (r.flowT <= 0 && c !== r.flowCell) { r.flowT = 0.3; r.flowCell = c; g.world.computeField(r.pos.x, r.pos.z, r.flow); }
      }
    }
    for (const r of this.remotes.values()) r.update(dt);
  }

  // ---------- anfitrião ----------
  snapshot() {
    const g = this.g;
    const z = [];
    for (const zb of g.zombies) {
      const fl = (zb.windup > 0 ? 1 : 0) | (zb.charge ? 2 : 0) | (zb.cast && !zb.charge ? 4 : 0) | (zb.dead ? 8 : 0) | (zb.stunT > 0 ? 16 : 0) | (zb.aggro ? 32 : 0) | (zb.fuse > 0 ? 64 : 0) | (zb.state === 'dormant' ? 128 : 0);
      z.push([zb.nid, TYPES.indexOf(zb.type), RANK_K.indexOf(zb.rank), zb.variant, r1(zb.pos.x), r1(zb.pos.z), Math.round(zb.facing * 100) / 100, Math.round((zb.hp / zb.maxHp) * 1000), fl]);
    }
    return {
      k: 's', z,
      n: g.world.nests.map((n) => [Math.round(n.hp), n.alive ? 1 : 0, n.maxHp]),
      d: g.drops.map((d) => [d.did, r1(d.x), r1(d.z), d.color]),
      l: g.world.containers.map((c, i) => (c.looted ? i : -1)).filter((i) => i >= 0),
      sh: g.shots.map((s) => [r1(s.x), r1(s.y), r1(s.z), s.r]),
      cl: g.cleared ? 1 : 0, bd: g.bossDead ? 1 : 0,
    };
  }

  // ---------- mensagens ----------
  onMsg(from, d) {
    if (!d || !d.k) return;
    const g = this.g;
    switch (d.k) {
      case 'p': { const r = this.remotes.get(from); if (r) r.apply(d); break; }
      case 'fx': {
        if (!FX_METHODS.includes(d.m)) break;
        this.replaying = true;
        try { g.effects[d.m](...d.a); } finally { this.replaying = false; }
        if (d.m === 'explosion') sfx.explode();
        break;
      }
      // ----- recebidas pelo anfitrião -----
      case 'hit': if (this.isHost) {
        const zb = g.zombies.find((z) => z.nid === d.id);
        const dmg = capDamage(dmgState, from, d.dmg);
        if (zb && !zb.dead && dmg > 0) zb.takeDamage(dmg, { crit: d.crit, kx: d.kx, kz: d.kz, stun: d.stun, melee: d.melee, heavy: d.heavy, fromPeer: from });
        break;
      }
      case 'extract_req': if (this.isHost && !g.ended) { g.endRun('extract'); break; }
      case 'nhit': if (this.isHost) { const n = g.world.nests[d.i]; const dmg = capDamage(dmgState, from, d.dmg); if (n && dmg > 0) g.damageNest(n, dmg, d.crit, from); break; }
      case 'loot': if (this.isHost) {
        const c = g.world.containers[d.ci];
        if (d.own) { if (c && !c.looted) g.world.markLooted(c); break; } // o convidado pede o loot ao servidor
        if (!c || c.looted) { net.sendTo(from, { k: 'items', items: [], msg: 'Já foi saqueado' }); break; }
        g.world.markLooted(c);
        const fake = { cls: d.cls, attrs: { for: 0, agi: 0, vit: 0, pre: 0, sor: d.sor || 0 }, level: 1 };
        let items = rollLoot(c.type, g.mapDef.level, fake);
        if (c.type === 'tesouro') items.push(randomWeapon(d.cls, g.mapDef.level + 1, (d.sor || 0) * 0.02, 4, 3));
        net.sendTo(from, { k: 'items', items });
        break;
      }
      case 'pick': if (this.isHost) {
        const i = g.drops.findIndex((x) => x.did === d.did);
        if (i < 0) break;
        const dr = g.drops[i];
        g.scene.remove(dr.mesh); g.drops.splice(i, 1);
        net.sendTo(from, { k: 'items', items: [dr.item], pick: 1 });
        break;
      }
      // ----- recebidas pelos convidados -----
      case 's': if (this.isClient) this.applySnapshot(d); break;
      case 'extracted': if (this.isClient && !g.ended) { g.endRun('extract', { fromHost: true }); break; }
      case 'dmg': g.player.takeDamage(d.a, null); break;
      case 'kn': g.player.knock(d.x, d.z); break;
      case 'xp':
        if (auth.on) { // o servidor confere cada evento na partida deste jogador
          if (d.kill) { g.run.kills++; g.claim({ kind: 'kill', type: d.type, rank: d.rank, drops: false }); }
          else if (d.assist && d.except !== net.id) g.claim({ kind: 'assist', rank: d.assist, type: d.type });
          else if (d.nest) g.claim({ kind: 'nest', mother: !!d.mother, drops: false });
          break;
        }
        if (typeof d.a === 'number') g.gainXp(d.a);
        if (d.kill) { g.run.kills++; g.profile.stats.kills++; }
        break;
      case 'items': {
        if (d.msg) g.hud.toast(d.msg, 'dim');
        const max = g.player.stats.bagSlots;
        if (auth.on && d.pick) { // item do chão: passa da partida do anfitrião para a deste jogador
          for (const it of d.items) {
            auth.claim(g.profile, { kind: 'pickup', uid: it.uid }).then((r) => {
              for (const x of r.items) { if (addToBag(g.bag, x, max)) g.announceItem(x); else g.hud.toast(`${icon('mochila')} Mochila cheia — item perdido`, 'warn'); }
              g.hud.refreshBag();
            }).catch(() => g.hud.toast('Item indisponível', 'dim'));
          }
          break;
        }
        if (auth.on) break; // itens só valem quando emitidos pelo servidor
        for (const it of d.items) { if (addToBag(g.bag, it, max)) g.announceItem(it); else g.hud.toast(`${icon('mochila')} Mochila cheia — item perdido`, 'warn'); }
        g.hud.refreshBag();
        break;
      }
      case 'banner': g.hud.banner(...d.a); break;
      case 'boss': { const zb = this.zmap.get(d.nid); if (zb) { g.hud.showBoss(zb); sfx.boss(); } break; }
      case 'cleared': if (this.isClient && !g.cleared) {
        g.cleared = true;
        g.world.addTreasure(d.x, d.z);
        if (auth.on) { g.claim({ kind: 'clear' }); sfx.levelup(); break; }
        const p = g.profile;
        if (!p.cleared.includes(g.mapDef.id)) p.cleared.push(g.mapDef.id);
        p.money += d.bonus; saveProfile(p); sfx.levelup();
        break;
      }
    }
  }

  // ---------- convidado: aplica o estado do anfitrião ----------
  applySnapshot(s) {
    const g = this.g, seen = new Set();
    for (const e of s.z) {
      const [nid, ti, ri, variant, x, z, f, hpk, fl] = e;
      seen.add(nid);
      let zb = this.zmap.get(nid);
      if (!zb) {
        const type = TYPES[ti], rank = RANK_K[ri];
        const name = rank === 'boss' ? g.mapDef.boss.name : rank === 'miniboss' ? `${ZOMBIE_TYPES[type].name} Alfa` : undefined;
        zb = new Zombie(g, type, rank, x, z, { remote: true, variant, name, dormant: !!(fl & 128) });
        zb.nid = nid; zb.facing = f;
        this.zmap.set(nid, zb); g.zombies.push(zb);
        if (rank === 'boss') g.boss = zb;
      }
      zb.netT = { x, z, f };
      zb.hp = (hpk / 1000) * zb.maxHp;
      zb.windup = fl & 1 ? 0.2 : 0;
      zb.charge = fl & 2 ? (zb.charge || {}) : null;
      zb.cast = fl & 4 ? (zb.cast || { kind: 'slam' }) : null;
      zb.stunT = fl & 16 ? 0.3 : 0;
      zb.aggro = !!(fl & 32);
      zb.fuse = fl & 64 ? 0.3 : 0;
      zb.state = fl & 128 ? 'dormant' : 'chase';
      if (fl & 8 && !zb.dead) zb.remoteDie();
    }
    for (const [nid, zb] of this.zmap) if (!seen.has(nid)) {
      zb.remove();
      const i = g.zombies.indexOf(zb); if (i >= 0) g.zombies.splice(i, 1);
      this.zmap.delete(nid);
    }
    s.n.forEach(([hp, alive, max], i) => {
      const n = g.world.nests[i]; if (!n) return;
      n.hp = hp; n.maxHp = max;
      if (n.alive && !alive) { n.alive = false; g.nestDestroyedFx(n); }
    });
    // drops
    const dseen = new Set();
    for (const [did, x, z, color] of s.d) {
      dseen.add(did);
      if (!this.cdrops.has(did)) this.cdrops.set(did, { did, x, z, mesh: g.makeDropMesh(x, z, color), t: 0.4 });
    }
    for (const [did, dr] of this.cdrops) if (!dseen.has(did)) { g.scene.remove(dr.mesh); this.cdrops.delete(did); }
    for (const i of s.l) { const c = g.world.containers[i]; if (c && !c.looted) g.world.markLooted(c); }
    // projéteis inimigos (apenas visuais)
    while (this.shotMeshes.length < s.sh.length) {
      const m = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 8), new THREE.MeshBasicMaterial({ color: 0x9aff3a }));
      g.scene.add(m); this.shotMeshes.push(m);
    }
    this.shotMeshes.forEach((m, i) => {
      const sh = s.sh[i];
      m.visible = !!sh;
      if (sh) { m.position.set(sh[0], sh[1], sh[2]); m.scale.setScalar(sh[3]); }
    });
    // "zona limpa" chega pelo evento "cleared" (traz a posição do tesouro)
    g.bossDead = !!s.bd;
  }

  // convidado: atualiza drops locais (coleta pede ao anfitrião)
  updateClientDrops(dt) {
    const g = this.g, p = g.player;
    for (const dr of this.cdrops.values()) {
      dr.t -= dt;
      dr.mesh.children[0].rotation.y += dt * 2;
      if (dr.t <= 0 && !dr.req && !p.dead && Math.hypot(p.pos.x - dr.x, p.pos.z - dr.z) < 1.4) {
        if (g.bag.length >= p.stats.bagSlots) { if (!this._fullT || g.time - this._fullT > 2) { this._fullT = g.time; g.hud.toast(`${icon('mochila')} Mochila cheia!`, 'warn'); } continue; }
        dr.req = true;
        net.sendTo(net.room.hostId, { k: 'pick', did: dr.did });
      }
    }
  }

  sendHit(zb, dmg, opts) {
    net.sendTo(net.room.hostId, { k: 'hit', id: zb.nid, dmg: Math.round(dmg * 10) / 10, crit: !!opts.crit, kx: r1(opts.kx || 0), kz: r1(opts.kz || 0), stun: opts.stun || 0, melee: !!opts.melee, heavy: !!opts.heavy });
  }
}
