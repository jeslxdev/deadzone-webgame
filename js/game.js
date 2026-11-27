// ============================================================
//  PARTIDA — loop principal no mapa (mundo livre)
// ============================================================
import * as THREE from 'three';
import { ZOMBIE_TYPES, RANKS, RARITIES } from './data.js';
import { createWorld } from './world.js';
import { Effects, makeRound } from './effects.js';
import { Input } from './input.js';
import { Player } from './player.js';
import { Zombie } from './zombies.js';
import { HUD } from './ui.js';
import { sfx, initAudio, toggleMute } from './audio.js';
import { rollLoot, zombieDrop, addToBag, grantXp, saveProfile, mergeInto, itemInfo, randomWeapon, deriveStats } from './rpg.js';
import { rand, randi, pick, weighted, clamp, uid, angleLerp } from './util.js';
import { icon } from './icons.js';
import { setting } from './settings.js';
import { TouchControls } from './touch.js';
import { isTouch, lowPower } from './device.js';
import { updateOcclusionWindow } from './occlusion.js';
import { Coop } from './coop.js';
import { net, playerInfo } from './net.js';
import { setMusicIntensity } from './audio.js';
import { auth } from './auth.js';
import { PIX } from './pixtex.js';

const MAX_ZOMBIES = 160;
// projéteis em bloco (estilo voxel): cubo de gosma ácida e granada quadrada com pixel art
const acidGeo = new THREE.BoxGeometry(1.5, 1.5, 1.5);
const acidMat = new THREE.MeshBasicMaterial({ map: PIX.acid() });
const grenadeGeo = new THREE.BoxGeometry(0.26, 0.3, 0.26);
const grenadeMat = new THREE.MeshStandardMaterial({ map: PIX.grenade(), roughness: 0.6, metalness: 0.2 });
const dropGeo = new THREE.BoxGeometry(0.4, 0.4, 0.4);
const beamGeo = new THREE.BoxGeometry(0.22, 3, 0.22);

export class Game {
  constructor(app, profile, mapDef, opts = {}) {
    this.app = app;
    this.profile = profile;
    this.mapDef = mapDef;
    this.presenceTimer = 0;
    this.setGamePresence(true);
    this.time = 0;
    this.ended = null;
    this.paused = false;
    this.invOpen = false;

    const C = mapDef.colors;
    const scene = (this.scene = new THREE.Scene());
    scene.background = new THREE.Color(C.sky);
    scene.fog = new THREE.Fog(C.fog, 45, 110);
    this.camera = new THREE.PerspectiveCamera(40, innerWidth / innerHeight, 0.5, 400);

    scene.add(new THREE.HemisphereLight(C.ambient, 0x2a241e, 1.7));
    const sun = (this.sun = new THREE.DirectionalLight(C.sun, 2.3));
    sun.castShadow = true;
    sun.shadow.mapSize.set(lowPower ? 1024 : 2048, lowPower ? 1024 : 2048);
    const sc = sun.shadow.camera;
    sc.left = -46; sc.right = 46; sc.top = 46; sc.bottom = -46; sc.near = 1; sc.far = 150;
    sun.shadow.bias = -0.0006;
    sun.shadow.normalBias = 0.03;
    scene.add(sun, sun.target);
    this.playerLight = new THREE.PointLight(0xffe2c0, 14, 16, 1.3);
    scene.add(this.playerLight);

    this.seed = opts.seed ?? ((Math.random() * 1e9) | 0);
    this.world = createWorld(scene, mapDef, this.seed);
    this.effects = new Effects(scene);
    this.input = new Input(app.renderer.domElement);

    // Mochila da partida (loot não extraído). Consumíveis do estoque ficam no "cinto":
    // podem ser usados durante a partida e não se perdem ao morrer.
    this.bag = [];

    this.player = new Player(this, profile);
    this.player.pos.set(this.world.safe.x + 2, 0, this.world.safe.z + 1);
    this.player._prev.copy(this.player.pos);
    this.zombies = [];
    this.bullets = [];
    this.shots = [];
    this.grenades = [];
    this.drops = [];
    this.skillObjs = [];
    this.combo = { n: 0, t: 0, best: 0 };
    this.channel = null;
    this.flow = this.world.newField();
    this.moveField = this.world.newField();
    this.flowT = 0; this.flowCell = -1;
    this.run = { kills: 0, xp: 0, nests: 0, looted: 0, start: performance.now() };
    this.cleared = false;
    this.bossDead = false;
    this.ambientT = 10;
    this.hordeT = rand(60, 90);
    this.autosaveT = 30;
    this.shakeAmt = 0;

    this.cam = { target: this.player.pos.clone(), dist: isTouch ? 27 : 34, pitch: 0.98, locked: true };
    this.fps = false; this.fpsYaw = 0; this.fpsPitch = 0; // visão em 1ª pessoa (tecla B / rolar até o fim)
    this.raycaster = new THREE.Raycaster();
    this.aimPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -1.0);
    this.groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

    this.nidSeq = 0; this.didSeq = 0;
    this.player.flow = this.flow;
    const role = opts.coop ? opts.coop.role : null;
    if (role !== 'client') { this.setupNestsAndBosses(); this.spawnInitial(); }
    else for (const n of this.world.nests) { n.maxHp = n.hp = 1; }
    if (opts.coop) this.coop = new Coop(this, role, opts.coop.code, opts.coop.join);
    if (!auth.on) profile.stats.runs++; // com servidor, ele conta

    this.hud = new HUD(this);
    if (isTouch) { this.touch = new TouchControls(this); this.resize(innerWidth, innerHeight); }
    this.hud.banner(mapDef.name, 'map', `Destrua os ${this.world.nests.length - 1} ninhos e a Colmeia Mãe`);
    this.world.computeField(this.player.pos.x, this.player.pos.z, this.flow);
  }

  // ---------- Spawns ----------
  setupNestsAndBosses() {
    const lvl = this.mapDef.level;
    for (const n of this.world.nests) {
      n.maxHp = n.hp = Math.round((n.mother ? 2400 : 520) * (1 + 0.35 * (lvl - 1)));
      if (!n.mother) {
        const pos = this.world.walkableNear(n.x, n.z, 6) || { x: n.x + 4, z: n.z };
        const t = pick(this.mapDef.minibossTypes);
        const mb = this.spawnZombie(t, 'miniboss', pos.x, pos.z, { force: true, name: `${ZOMBIE_TYPES[t].name} Alfa` });
        mb.home = { x: n.x, z: n.z };
        n.guardian = mb;
      }
    }
    const m = this.world.mother;
    const bd = this.mapDef.boss;
    const pos = this.world.walkableNear(m.x, m.z, 9) || { x: m.x - 8, z: m.z };
    this.boss = this.spawnZombie(bd.type, 'boss', pos.x, pos.z, { force: true, dormant: true, name: bd.name, abilities: bd.abilities });
    this.boss.home = { x: m.x, z: m.z };
  }

  randomType() { return weighted(this.mapDef.pool); }

  // Horda: grupo grande que surge longe do jogador e vem direto atrás dele
  spawnHorde() {
    if (this.playerInSafeZone() || this.player.dead) { this.hordeT = 20; return; }
    const p = this.player.pos, w = this.world;
    let q = null;
    for (let k = 0; k < 40 && !q; k++) {
      const a = Math.random() * Math.PI * 2, d = rand(30, 42);
      const x = p.x + Math.cos(a) * d, z = p.z + Math.sin(a) * d;
      if (!w.isBlocked(x, z) && Math.hypot(x - w.safe.x, z - w.safe.z) > w.safe.r + 8) q = { x, z };
    }
    if (!q) return;
    const n = 10 + Math.round(this.mapDef.level * 1.5);
    let made = 0;
    for (let i = 0; i < n; i++) {
      const s = w.walkableNear(q.x, q.z, 6) || q;
      const z = this.spawnZombie(this.randomType(), 'normal', s.x, s.z, { force: true });
      if (z) { z.wake(); z.home = { x: p.x, z: p.z }; made++; }
    }
    if (made) {
      this.sharedBanner('UMA HORDA SE APROXIMA', 'warn', `${made} infectados vindo em sua direção`);
    }
  }

  spawnZombie(type, rank, x, z, opts = {}) {
    if (!opts.force && this.aliveCount() >= MAX_ZOMBIES) return null;
    if (rank === 'normal' && Math.random() < 0.1 + this.mapDef.level * 0.006) rank = 'elite';
    const zb = new Zombie(this, type, rank, x, z, opts);
    zb.nid = ++this.nidSeq;
    this.zombies.push(zb);
    return zb;
  }

  aliveCount() { let n = 0; for (const z of this.zombies) if (!z.dead) n++; return n; }

  spawnInitial() {
    const w = this.world;
    const count = Math.round(((w.size * w.size) / 470) * this.mapDef.density);
    this.initialCount = count;
    let made = 0;
    while (made < count) {
      const p = w.randomWalkable([{ x: w.safe.x, z: w.safe.z, r: 24 }]);
      if (!p) break;
      const group = randi(3, 6);
      for (let i = 0; i < group && made < count; i++) {
        const q = w.walkableNear(p.x, p.z, 3) || p;
        this.spawnZombie(this.randomType(), 'normal', q.x, q.z);
        made++;
      }
    }
  }

  updateSpawns(dt) {
    if (this.cleared) return;
    const p = this.player.pos, w = this.world;
    for (const n of w.nests) {
      if (!n.alive) continue;
      n.spawnT -= dt;
      if (n.spawnT > 0) continue;
      n.spawnT = rand(3, 5.5) / (1 + this.mapDef.level * 0.05) * (n.mother ? 0.6 : 1);
      const cap = n.mother ? 14 : 10;
      if (n.children >= cap) continue;
      if (Math.hypot(p.x - n.x, p.z - n.z) > 75) continue;
      const pos = w.walkableNear(n.x, n.z, n.mother ? 9 : 5);
      if (!pos) continue;
      const z = this.spawnZombie(this.randomType(), 'normal', pos.x, pos.z, { nest: n });
      if (z) { n.children++; z.home = { x: n.x, z: n.z }; this.effects.particles(pos.x, 0.3, pos.z, 8, 0x8a2aff, 3, 0.6, 1, 4); }
    }
    this.hordeT -= dt;
    if (this.hordeT <= 0) { this.hordeT = rand(70, 110) / (1 + this.mapDef.level * 0.03); this.spawnHorde(); }
    this.ambientT -= dt;
    if (this.ambientT <= 0) {
      this.ambientT = 6;
      let normals = 0;
      for (const z of this.zombies) if (!z.dead && z.rank === 'normal' && !z.nest) normals++;
      if (normals < this.initialCount * 0.8) {
        const q = w.randomWalkable([{ x: p.x, z: p.z, r: 38 }, { x: w.safe.x, z: w.safe.z, r: 24 }]);
        if (q) for (let i = 0; i < randi(3, 6); i++) { const s = w.walkableNear(q.x, q.z, 3) || q; this.spawnZombie(this.randomType(), 'normal', s.x, s.z); }
      }
    }
  }

  // ---------- Projéteis ----------
  spawnBullet(x, y, z, ang, dmg, crit, range, pierce, weapon = 'fuzil') {
    const mesh = makeRound(weapon);
    mesh.position.set(x, y, z);
    mesh.rotation.y = ang;
    this.scene.add(mesh);
    this.bullets.push({ x, y, z, dx: Math.sin(ang), dz: Math.cos(ang), dmg, crit, left: range, pierce, hit: new Set(), mesh });
  }

  spawnEnemyShot(x, y, z, ang, speed, dmg, color, r) {
    const mesh = new THREE.Mesh(acidGeo, acidMat);
    mesh.scale.setScalar(r);
    mesh.position.set(x, y, z);
    this.scene.add(mesh);
    this.shots.push({ x, y, z, dx: Math.sin(ang), dz: Math.cos(ang), speed, dmg, r, left: 22, mesh });
  }

  spawnGrenade(sx, sz, tx, tz, dmg) {
    const mesh = new THREE.Mesh(grenadeGeo, grenadeMat);
    mesh.castShadow = true;
    this.scene.add(mesh);
    const tele = this.effects.telegraphCircle(tx, tz, 4.2, 0.7, 0xffa030);
    this.grenades.push({ sx, sz, tx, tz, t: 0, dur: 0.7, dmg, mesh, tele });
  }

  updateProjectiles(dt) {
    const w = this.world, zs = this.zombies;
    for (let i = this.bullets.length - 1; i >= 0; i--) {
      const b = this.bullets[i];
      let travel = 70 * dt, dead = false;
      while (travel > 0 && !dead) {
        const step = Math.min(0.5, travel);
        travel -= step; b.left -= step;
        b.x += b.dx * step; b.z += b.dz * step;
        if (b.left <= 0) { dead = true; break; }
        if (w.pointBlocked(b.x, b.z, b.y)) { this.effects.sparks(b.x, b.y, b.z); dead = true; break; }
        for (let k = 0; k < zs.length; k++) {
          const z = zs[k];
          if (z.dead || b.hit.has(z)) continue;
          const dx = z.pos.x - b.x, dz = z.pos.z - b.z, rr = z.radius + 0.2;
          if (dx * dx + dz * dz > rr * rr) continue;
          z.takeDamage(b.dmg, { crit: b.crit, kx: b.dx * 2.2, kz: b.dz * 2.2 });
          this.addCombo();
          b.hit.add(z);
          if (b.pierce-- <= 0) { dead = true; break; }
        }
        if (dead) break;
        for (const n of w.nests) {
          if (!n.alive) continue;
          if (Math.hypot(n.x - b.x, n.z - b.z) < n.radius) { this.damageNest(n, b.dmg, b.crit); dead = true; break; }
        }
      }
      b.mesh.position.set(b.x, b.y, b.z);
      b.mesh.children[0].visible = true;
      if (dead) { this.scene.remove(b.mesh); this.bullets.splice(i, 1); }
    }
    const p = this.player;
    for (let i = this.shots.length - 1; i >= 0; i--) {
      const s = this.shots[i];
      const step = s.speed * dt;
      s.x += s.dx * step; s.z += s.dz * step; s.left -= step;
      s.mesh.position.set(s.x, s.y, s.z);
      s.mesh.rotation.x += dt * 7; s.mesh.rotation.y += dt * 5; // gosma girando no ar
      let dead = s.left <= 0;
      if (!dead && w.pointBlocked(s.x, s.z, s.y)) { dead = true; this.effects.particles(s.x, s.y, s.z, 6, 0x9aff3a, 3, 0.4, 0.8); }
      if (!dead && this.coop) for (const r of this.coop.remotes.values()) {
        if (!r.dead && Math.hypot(r.pos.x - s.x, r.pos.z - s.z) < s.r + r.radius) { r.takeDamage(s.dmg); dead = true; break; }
      }
      if (!dead && !p.dead && Math.hypot(p.pos.x - s.x, p.pos.z - s.z) < s.r + p.radius) {
        p.takeDamage(s.dmg, null);
        this.effects.particles(s.x, s.y, s.z, 8, 0x9aff3a, 3, 0.4, 0.8);
        dead = true;
      }
      if (dead) { this.scene.remove(s.mesh); this.shots.splice(i, 1); }
    }
    for (let i = this.grenades.length - 1; i >= 0; i--) {
      const gr = this.grenades[i];
      gr.t += dt;
      const k = Math.min(1, gr.t / gr.dur);
      gr.mesh.position.set(gr.sx + (gr.tx - gr.sx) * k, 1.2 + Math.sin(Math.PI * k) * 3.5 - k * 1.0, gr.sz + (gr.tz - gr.sz) * k);
      gr.mesh.rotation.x += dt * 12;
      if (k >= 1) {
        this.scene.remove(gr.mesh);
        this.grenades.splice(i, 1);
        this.explode(gr.tx, gr.tz, 4.2, gr.dmg, { hurtZombies: true, fromPlayer: true });
      }
    }
  }

  explode(x, z, radius, dmg, opts = {}) {
    this.effects.explosion(x, z, radius, opts.color || 0xff7a2a);
    sfx.explode();
    const pd = Math.hypot(this.player.pos.x - x, this.player.pos.z - z);
    this.shake(Math.max(0.15, 0.7 - pd * 0.03));
    if (opts.hurtZombies) {
      for (const zb of this.zombies) {
        if (zb.dead || zb === opts.source) continue;
        const d = Math.hypot(zb.pos.x - x, zb.pos.z - z);
        if (d > radius + zb.radius) continue;
        const f = 1 - (d / (radius + zb.radius)) * 0.5;
        const mult = opts.fromPlayer ? 1 : 0.6;
        const crit = opts.fromPlayer && Math.random() < this.player.stats.crit;
        zb.takeDamage(dmg * f * mult * (crit ? this.player.stats.critMult : 1), { crit, kx: ((zb.pos.x - x) / (d || 1)) * 8, kz: ((zb.pos.z - z) / (d || 1)) * 8 });
      }
    }
    if (opts.fromPlayer) {
      for (const n of this.world.nests) if (n.alive && Math.hypot(n.x - x, n.z - z) < radius + n.radius) this.damageNest(n, dmg, false);
    }
    if (opts.hurtPlayer && this.coop) for (const r of this.coop.remotes.values()) {
      const d = Math.hypot(r.pos.x - x, r.pos.z - z);
      if (!r.dead && d < radius + r.radius) { r.takeDamage(dmg * (1 - (d / radius) * 0.5)); r.knock(((r.pos.x - x) / (d || 1)) * 9, ((r.pos.z - z) / (d || 1)) * 9); }
    }
    if (opts.hurtPlayer && pd < radius + this.player.radius) {
      this.player.takeDamage(dmg * (1 - (pd / radius) * 0.5), opts.source);
      this.player.knock(((this.player.pos.x - x) / (pd || 1)) * 9, ((this.player.pos.z - z) / (pd || 1)) * 9);
    }
  }

  shake(a) { this.shakeAmt = Math.max(this.shakeAmt, a); }
  // combo: cada acerto soma; dano extra de até +30%; zera após 2,5s sem acertar
  addCombo() { const c = this.combo; c.n++; c.t = 2.5; if (c.n > c.best) c.best = c.n; }
  comboMult() { return 1 + Math.min(0.3, this.combo.n * 0.01); }
  // "hit-stop": congela o mundo por um instante para dar peso ao golpe
  hitStop(t) { this.hitStopT = Math.max(this.hitStopT || 0, t); this.shake(0.12); }

  // ---------- Ninhos ----------
  motherShielded() { return this.world.nests.some((n) => !n.mother && n.alive); }

  damageNest(n, dmg, crit, fromPeer = null) {
    if (!n.alive) return;
    if (this.coop && this.coop.isClient) {
      this.effects.number(n.x, n.mother ? 5 : 3, n.z, Math.round(dmg), crit ? '#ffd23f' : '#d79cff', crit ? 20 : 15);
      net.sendTo(net.room.hostId, { k: 'nhit', i: this.world.nests.indexOf(n), dmg, crit });
      return;
    }
    if (n.mother && this.motherShielded()) {
      if (!this._immuneT || this.time - this._immuneT > 0.6) {
        this._immuneT = this.time;
        this.effects.number(n.x, 4, n.z, 'PROTEGIDA', '#c080ff', 16);
      }
      return;
    }
    n.hp -= dmg;
    n.hitT = this.time;
    this.effects.number(n.x, n.mother ? 5 : 3, n.z, Math.round(dmg), crit ? '#ffd23f' : '#d79cff', crit ? 20 : 15);
    this.effects.particles(n.x, 1.2, n.z, 3, 0x6a1a5a, 4, 0.5, 1);
    if (this.boss && n.mother) this.boss.wake();
    if (n.guardian && !n.guardian.dead) n.guardian.wake();
    if (n.hp <= 0) this.destroyNest(n);
  }

  nestDestroyedFx(n) {
    n.alive = false; n.hp = 0;
    sfx.nest();
    this.shake(0.8);
    n.core.scale.set(1, 0.25, 1);
    n.core.position.y = 0.3;
    n.flesh.emissiveIntensity = 0;
    n.flesh.color.setHex(0x2a1018);
    n.veins.visible = false;
    if (n.shield) n.shield.visible = false;
  }

  destroyNest(n) {
    const lvl = this.mapDef.level;
    this.effects.explosion(n.x, n.z, n.mother ? 9 : 5, 0xb040ff);
    this.effects.beam(n.x, n.z, 0xb040ff, 1.2);
    this.nestDestroyedFx(n);
    this.run.nests++;
    if (auth.on) {
      if (this.coop && this.coop.isHost) net.broadcast({ k: 'xp', nest: 1, mother: n.mother ? 1 : 0 });
      this.claim({ kind: 'nest', mother: n.mother }, n.x, n.z, 3);
    } else {
      this.sharedXp(Math.round((n.mother ? 700 : 160) * (1 + 0.25 * (lvl - 1))));
      this.profile.stats.nests++;
      const st = deriveStats(this.profile);
      const items = rollLoot(n.mother ? 'cofre' : 'militar', lvl, this.profile);
      if (Math.random() < 0.5) items.push(randomWeapon(this.profile.cls, lvl, st.luck, 2, 1));
      items.forEach((it) => this.dropItem(it, n.x, n.z, 3));
    }
    const left = this.world.nests.filter((x) => !x.mother && x.alive).length;
    const total = this.world.nests.length - 1;
    if (!n.mother) {
      this.sharedBanner('NINHO DESTRUÍDO', 'good', `${total - left}/${total} ninhos`);
      if (left === 0) setTimeout(() => !this.ended && this.sharedBanner('A COLMEIA MÃE ESTÁ VULNERÁVEL', 'boss', 'Vá até o canto inferior direito do mapa'), 2200);
    } else {
      this.sharedBanner('COLMEIA MÃE DESTRUÍDA', 'good', this.bossDead ? '' : `Derrote ${this.boss.name}!`);
    }
    this.checkCleared();
  }

  checkCleared() {
    if (this.cleared) return;
    if (this.world.mother.alive || !this.bossDead) return;
    this.cleared = true;
    const lvl = this.mapDef.level;
    const m = this.world.mother;
    const chestPos = this.world.walkableNear(m.x, m.z, 6) || { x: m.x, z: m.z + 6 };
    this.world.addTreasure(chestPos.x, chestPos.z);
    if (auth.on) {
      if (this.coop) net.broadcast({ k: 'cleared', x: chestPos.x, z: chestPos.z, bonus: Math.round(400 * lvl) });
      sfx.levelup();
      this.claim({ kind: 'clear' }).then((r) => {
        if (r && !this.ended) this.sharedBanner('ZONA LIMPA!', 'clear', `+$${r.money} · Tesouro da Colmeia revelado · Extraia no acampamento`);
      });
      return;
    }
    const bonus = Math.round(400 * lvl * deriveStats(this.profile).moneyMult);
    this.profile.money += bonus;
    if (!this.profile.cleared.includes(this.mapDef.id)) this.profile.cleared.push(this.mapDef.id);
    this.sharedXp(450 * lvl);
    if (this.coop) net.broadcast({ k: 'cleared', x: chestPos.x, z: chestPos.z, bonus: Math.round(400 * lvl) });
    saveProfile(this.profile);
    sfx.levelup();
    setTimeout(() => !this.ended && this.sharedBanner('ZONA LIMPA!', 'clear', `+$${bonus} · Tesouro da Colmeia revelado · Extraia no acampamento`), 1500);
  }

  // ---------- Loot ----------
  makeDropMesh(x, z, colorHex, big = false) {
    const color = new THREE.Color(colorHex);
    const g = new THREE.Group();
    const cube = new THREE.Mesh(dropGeo, new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.6 }));
    cube.position.y = 0.5;
    g.add(cube);
    const beam = new THREE.Mesh(beamGeo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false }));
    beam.position.y = 1.5;
    if (big) beam.scale.set(1.5, 1.6, 1.5);
    g.add(beam);
    g.position.set(x, 0, z);
    this.scene.add(g);
    return g;
  }

  dropItem(item, x, z, spread = 1) {
    const info = itemInfo(item);
    const color = new THREE.Color(info.color);
    const g = new THREE.Group();
    const cube = new THREE.Mesh(dropGeo, new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.6 }));
    cube.position.y = 0.5;
    g.add(cube);
    const beam = new THREE.Mesh(beamGeo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false }));
    beam.position.y = 1.5;
    if (item.kind === 'weapon' && item.rarity >= 2) beam.scale.set(1.5, 1.6, 1.5);
    g.add(beam);
    const a = Math.random() * Math.PI * 2, d = Math.random() * spread;
    let pos = { x: x + Math.cos(a) * d, z: z + Math.sin(a) * d };
    if (this.world.isBlocked(pos.x, pos.z)) pos = this.world.walkableNear(x, z, spread + 3) || this.world.walkableNear(x, z, spread + 7) || { x, z };
    g.position.set(pos.x, 0, pos.z);
    this.scene.add(g);
    this.drops.push({ item, x: pos.x, z: pos.z, mesh: g, cube, t: 0.6, did: ++this.didSeq, color: color.getHex() });
  }

  updateDrops(dt) {
    const p = this.player;
    const max = p.stats.bagSlots;
    for (let i = this.drops.length - 1; i >= 0; i--) {
      const d = this.drops[i];
      d.t -= dt;
      d.cube.rotation.y += dt * 2;
      d.cube.position.y = 0.5 + Math.sin(this.time * 3 + d.x) * 0.1;
      if (d.t > 0 || p.dead) continue;
      if (Math.hypot(p.pos.x - d.x, p.pos.z - d.z) < 1.4) {
        if (addToBag(this.bag, d.item, max)) {
          this.announceItem(d.item);
          this.scene.remove(d.mesh);
          d.mesh.traverse((o) => o.material && o.material.dispose());
          this.drops.splice(i, 1);
          this.hud.refreshBag();
        } else if (!this._fullT || this.time - this._fullT > 2) {
          this._fullT = this.time;
          this.hud.toast(`${icon('mochila')} Mochila cheia! Descarte itens (Tab)`, 'warn');
        }
      }
    }
  }

  announceItem(item) {
    const info = itemInfo(item);
    this.hud.toast(`${icon(info.icon)} <b style="color:${info.color}">${info.name}</b>${item.qty > 1 ? ' ×' + item.qty : ''}`, 'loot');
    if (item.kind === 'weapon' && item.rarity >= 3) sfx.rare(); else sfx.pickup();
  }

  lootContainer(c) {
    if (this.coop && this.coop.isClient) {
      this.world.markLooted(c);
      this.run.looted++; sfx.loot();
      const ci = this.world.containers.indexOf(c);
      net.sendTo(net.room.hostId, { k: 'loot', ci, cls: this.profile.cls, sor: this.profile.attrs.sor, own: auth.on ? 1 : 0 });
      if (auth.on) this.claim({ kind: 'loot', ctype: c.type, idx: ci }, c.x, c.z, 1.6, true);
      else this.gainXp(4);
      return;
    }
    if (auth.on) {
      this.world.markLooted(c);
      this.run.looted++;
      sfx.loot();
      this.claim({ kind: 'loot', ctype: c.type, idx: this.world.containers.indexOf(c) }, c.x, c.z, 1.6, true);
      return;
    }
    const items = c.type === 'tesouro' ? this.treasureLoot() : rollLoot(c.type, this.mapDef.level, this.profile);
    this.world.markLooted(c);
    this.run.looted++;
    sfx.loot();
    const max = this.player.stats.bagSlots;
    for (const it of items) {
      if (addToBag(this.bag, it, max)) this.announceItem(it);
      else this.dropItem(it, c.x, c.z, 1.6);
    }
    this.gainXp(4);
    this.hud.refreshBag();
  }

  treasureLoot() {
    const st = deriveStats(this.profile), lvl = this.mapDef.level;
    const items = rollLoot('tesouro', lvl, this.profile);
    items.push(randomWeapon(this.profile.cls, lvl + 1, st.luck, 4, 3));
    return items;
  }

  // ---------- Interação (tecla E) ----------
  findInteractable() {
    const p = this.player.pos;
    let best = null, bd = Infinity;
    for (const c of this.world.containers) {
      if (c.looted) continue;
      const d = Math.hypot(c.x - p.x, c.z - p.z);
      if (d < c.radius && d < bd) { bd = d; best = { kind: 'container', c, label: `Saquear ${c.def.name}`, time: c.def.time }; }
    }
    const e = this.world.extraction;
    const de = Math.hypot(e.x - p.x, e.z - p.z);
    if (de < 2.8 && de < bd) best = { kind: 'extract', label: 'Extrair — voltar ao acampamento com o loot', time: e.time };
    return best;
  }

  updateInteraction(dt) {
    const inp = this.input;
    if (this.player.dead) { this.channel = null; this.hud.prompt(null); return; }
    if (this.channel) {
      const moved = ['KeyW', 'KeyA', 'KeyS', 'KeyD'].some((k) => inp.key(k)) || inp.clicked(2);
      if (!inp.key('KeyE') || moved) { this.channel = null; }
      else {
        this.channel.t += dt;
        if (this.channel.t >= this.channel.dur) {
          const ch = this.channel;
          this.channel = null;
          if (ch.target.kind === 'container') this.lootContainer(ch.target.c);
          else if (ch.target.kind === 'extract') {
            if (this.coop && this.coop.isClient) {
              if (!this.extractRequested) { this.extractRequested = true; net.broadcast({ k: 'extract_req' }); this.hud.toast('Extração solicitada ao anfitrião. A equipe voltará junta ao acampamento.', 'dim'); }
            } else this.endRun('extract');
            return;
          }
        }
      }
    }
    const it = this.channel ? this.channel.target : this.findInteractable();
    this.hud.prompt(it ? `<kbd>E</kbd> ${it.label}${this.channel ? '' : ` <span class="dim">(segure ${it.time}s)</span>`}` : null);
    if (!this.channel && it && inp.pressed('KeyE')) {
      this.channel = { target: it, t: 0, dur: it.time / (1 + this.profile.attrs.agi * 0.01) };
    }
  }

  // ---------- Progressão ----------
  // Com servidor: pede o evento; o servidor devolve XP, nível e itens oficiais.
  // Itens caem no chão em (x, z) ou vão direto para a mochila (toBag).
  claim(body, x, z, spread = 1, toBag = false) {
    return auth.claim(this.profile, body).then((r) => {
      if (this.disposed) return r;
      if (r.xp) this.run.xp += r.xp;
      if (r.levels > 0) this.onLevelUp(r.levels); else this.hud.refreshXp();
      const max = this.player.stats.bagSlots;
      for (const it of r.items || []) {
        if (toBag && addToBag(this.bag, it, max)) this.announceItem(it);
        else if (x !== undefined) this.dropItem(it, x, z, spread);
      }
      if (toBag) this.hud.refreshBag();
      return r;
    }).catch((e) => { if (e.status !== 409) console.warn('servidor recusou:', body.kind, e.message); return null; });
  }

  gainXp(n) {
    if (auth.on) return; // XP só vem do servidor
    const lv = grantXp(this.profile, n);
    this.run.xp += n;
    if (lv > 0) this.onLevelUp(lv);
    this.hud.refreshXp();
  }

  onLevelUp(lv) {
    {
      this.player.refreshStats();
      this.player.heal(this.player.stats.maxHp * 0.3);
      this.hud.banner(`NÍVEL ${this.profile.level}!`, 'level', `+${lv * 3} pontos de atributo — abra a mochila (Tab)`);
      this.effects.beam(this.player.pos.x, this.player.pos.z, 0xffd23f, 0.9);
      sfx.levelup();
      saveProfile(this.profile);
    }
    this.hud.refreshXp();
  }

  onZombieKilled(z, opts) {
    const lvl = this.mapDef.level;
    if (auth.on) return this.onZombieKilledAuth(z, opts);
    const xp = Math.round(z.T.xp * z.R.xp * (1 + 0.2 * (lvl - 1)));
    if (opts && opts.fromPeer) net.sendTo(opts.fromPeer, { k: 'xp', a: xp, kill: 1 });
    else {
      this.run.kills++;
      this.profile.stats.kills++;
      this.gainXp(xp);
    }
    for (const it of zombieDrop(z.rank, lvl, this.profile)) this.dropItem(it, z.pos.x, z.pos.z, z.rank === 'normal' ? 0.5 : 2);
    if (z.rank === 'miniboss') {
      this.profile.stats.minibosses++;
      this.sharedBanner('MINI-BOSS DERROTADO', 'good', z.name);
      if (this.coop) net.broadcast({ k: 'xp', a: Math.round(xp * 0.5) }); // bônus para o grupo
    }
    if (z.rank === 'boss') {
      this.profile.stats.bosses++;
      this.bossDead = true;
      this.hud.showBoss(null);
      this.sharedBanner(`${z.name.toUpperCase()} CAIU`, 'good', this.world.mother.alive ? 'Agora destrua a Colmeia Mãe!' : '');
      if (this.coop) net.broadcast({ k: 'xp', a: Math.round(xp * 0.5) });
      for (let i = 0; i < 3; i++) this.dropItem(randomWeapon(this.profile.cls, lvl + 1, deriveStats(this.profile).luck, 3, 2), z.pos.x, z.pos.z, 3);
      this.checkCleared();
    }
  }

  onZombieKilledAuth(z, opts) {
    const peer = opts && opts.fromPeer;
    // quem abateu ganha o XP; o anfitrião (dono do mundo) sorteia os drops
    if (peer) net.sendTo(peer, { k: 'xp', kill: 1, type: z.type, rank: z.rank });
    else this.run.kills++;
    this.claim({ kind: 'kill', type: z.type, rank: z.rank, xp: !peer }, z.pos.x, z.pos.z, z.rank === 'normal' ? 0.5 : z.rank === 'boss' ? 3 : 2);
    if (z.rank === 'miniboss') {
      this.sharedBanner('MINI-BOSS DERROTADO', 'good', z.name);
      if (this.coop) net.broadcast({ k: 'xp', assist: 'miniboss', type: z.type, except: peer || null });
    }
    if (z.rank === 'boss') {
      this.bossDead = true;
      this.hud.showBoss(null);
      this.sharedBanner(`${z.name.toUpperCase()} CAIU`, 'good', this.world.mother.alive ? 'Agora destrua a Colmeia Mãe!' : '');
      if (this.coop) net.broadcast({ k: 'xp', assist: 'boss', type: z.type, except: peer || null });
      this.checkCleared();
    }
  }

  onBossAwake(z) {
    this.bossAwake = true;
    sfx.boss();
    this.shake(0.5);
    this.sharedBanner(`${z.name.toUpperCase()} DESPERTOU`, 'boss', 'Boss do mapa');
    this.hud.showBoss(z);
    if (this.coop) net.broadcast({ k: 'boss', nid: z.nid });
  }

  onPlayerDeath() {
    if (this.ended) return;
    this.ended = 'death';
    if (auth.on) auth.end(this.profile, 'death');
    else { this.profile.stats.deaths++; saveProfile(this.profile); }
    setTimeout(() => this.hud.showEnd('death'), 1400);
  }

  endRun(kind, { fromHost = false } = {}) {
    if (this.ended && kind !== 'death') return;
    this.ended = kind;
    if (kind === 'extract' || kind === 'hostleft') {
      mergeInto(this.profile.stash, this.bag);
      if (!auth.on) this.profile.stats.extracted++;
    }
    // com servidor: ele confere a mochila (só aceita itens que emitiu) e devolve o perfil oficial
    if (auth.on) auth.end(this.profile, kind === 'extract' || kind === 'hostleft' ? 'extract' : 'quit').then(() => saveProfile(this.profile));
    else saveProfile(this.profile);
    if (this.coop && kind === 'extract') {
      net.updateInfo(playerInfo(this.profile));
      if (this.coop.isHost && !fromHost) net.broadcast({ k: 'extracted' });
      if (this.coop.isHost) net.returnToLobby();
    } else if (this.coop && kind !== 'hostleft') net.leave();
    this.hud.showEnd(kind);
  }

  // ---------- co-op: utilidades ----------
  sharedBanner(title, cls, sub = '') {
    this.hud.banner(title, cls, sub);
    if (this.coop && this.coop.isHost) net.broadcast({ k: 'banner', a: [title, cls, sub] });
  }
  sharedXp(a) {
    this.gainXp(a);
    if (auth.on) return;
    if (this.coop && this.coop.isHost) net.broadcast({ k: 'xp', a });
  }
  inSafe(pos) {
    const s = this.world.safe;
    return Math.hypot(pos.x - s.x, pos.z - s.z) < s.r;
  }

  playerInSafeZone() {
    const s = this.world.safe, p = this.player.pos;
    return Math.hypot(p.x - s.x, p.z - s.z) < s.r;
  }

  // ---------- Câmera e mira ----------
  updateCamera(dt) {
    const inp = this.input, cam = this.cam, p = this.player.pos;
    if (inp.pressed('KeyY')) { cam.locked = !cam.locked; this.hud.toast(cam.locked ? `${icon('camera')} Câmera travada no personagem` : `${icon('camera')} Câmera livre (mouse nas bordas / setas)`, 'dim'); }
    if (inp.key('KeyC')) cam.target.lerp(p, 0.3);
    const pl = this.player, vx = pl.vel.x, vz = pl.vel.z;
    if (cam.locked) {
      // segue com leve atraso e antecipa movimento e mira (estilo câmera de ação)
      const lead = setting('camLead');
      const ax = lead ? clamp((inp.aim.x - p.x) * 0.16, -3.2, 3.2) : 0, az = lead ? clamp((inp.aim.z - p.z) * 0.16, -2.6, 2.6) : 0;
      const lx = lead ? clamp(vx * 0.3, -2.4, 2.4) : 0, lz = lead ? clamp(vz * 0.3, -2.4, 2.4) : 0;
      cam.goal = cam.goal || new THREE.Vector3();
      cam.goal.set(p.x + ax + lx, 0, p.z + az + lz);
      cam.target.lerp(cam.goal, 1 - Math.exp(-dt * 5.5));
    }
    else {
      const sp = 32 * (cam.dist / 27) * dt, m = 14;
      if (inp.mx < m || inp.key('ArrowLeft')) cam.target.x -= sp;
      if (inp.mx > innerWidth - m || inp.key('ArrowRight')) cam.target.x += sp;
      if (inp.my < m || inp.key('ArrowUp')) cam.target.z -= sp;
      if (inp.my > innerHeight - m || inp.key('ArrowDown')) cam.target.z += sp;
      const h = this.world.half;
      cam.target.x = clamp(cam.target.x, -h, h); cam.target.z = clamp(cam.target.z, -h, h);
    }
    // rolar: aproxima/afasta; no zoom máximo entra em 1ª pessoa, rolar para trás sai
    if (inp.wheel && !this.uiBlocking) {
      if (this.fps) { if (inp.wheel > 0) this.setFps(false); }
      else if (inp.wheel < 0 && cam.dist <= 18.01) this.setFps(true);
      else cam.dist = clamp(cam.dist + inp.wheel * 2.5, 18, 52);
    }
    if (this.fps) { this.updateFpsCamera(dt); return; }
    const c = this.camera;
    // balanço ao andar/correr + leve rolagem + FOV maior em corrida/esquiva
    const run = clamp(Math.hypot(vx, vz) / 8, 0, 1), gt = pl.gait;
    let bobY = 0, bobX = 0, roll = 0;
    if (setting('camBob') && !pl.dead) {
      bobY = Math.sin(gt.ph * 2) * 0.09 * gt.blend * (0.45 + run);
      bobX = Math.sin(gt.ph) * 0.06 * gt.blend * (0.45 + run);
      roll = Math.sin(gt.ph) * 0.005 * gt.blend * (0.4 + run);
    }
    const fov = 40 + 3.5 * run + (pl.dashT > 0 ? 5 : 0) + (pl.lunge ? 4 : 0);
    if (Math.abs(c.fov - fov) > 0.01) { c.fov += (fov - c.fov) * Math.min(1, dt * 6); c.updateProjectionMatrix(); }
    c.position.set(cam.target.x + bobX, cam.dist * Math.sin(cam.pitch) + bobY, cam.target.z + cam.dist * Math.cos(cam.pitch));
    c.lookAt(cam.target.x + bobX * 0.5, 0, cam.target.z);
    if (roll) c.rotateZ(roll);
    if (!setting('shake')) this.shakeAmt = 0;
    if (this.shakeAmt > 0.001) {
      c.position.x += (Math.random() - 0.5) * this.shakeAmt;
      c.position.y += (Math.random() - 0.5) * this.shakeAmt;
      this.shakeAmt *= Math.exp(-dt * 7);
    }
    this.sun.position.set(p.x - 22, 45, p.z + 18);
    this.sun.target.position.set(p.x, 0, p.z);
    this.playerLight.position.set(p.x, 3.2, p.z + 0.5);
    // só o prédio entre a câmera e o personagem fica transparente;
    // sem a janela circular pontilhada ao redor do personagem
    this.world.updateOcclusion(c, p, dt);
    updateOcclusionWindow(c, p, false);

    // Mira = interseção do mouse com plano y=1
    const ndc = new THREE.Vector2((inp.mx / innerWidth) * 2 - 1, -(inp.my / innerHeight) * 2 + 1);
    this.raycaster.setFromCamera(ndc, c);
    const hit = new THREE.Vector3();
    if (this.touch) this.touch.applyAim();
    else if (this.raycaster.ray.intersectPlane(this.aimPlane, hit)) { inp.aim.x = hit.x; inp.aim.z = hit.z; }
    if ((inp.clicked(1) || (inp.clicked(2) && (inp.key('ShiftLeft') || inp.key('ShiftRight')))) && !this.uiBlocking) {
      const g = new THREE.Vector3();
      if (this.raycaster.ray.intersectPlane(this.groundPlane, g)) {
        this.player.moveTarget = { x: g.x, z: g.z };
        this.world.computeField(g.x, g.z, this.moveField);
        this.effects.shock(g.x, g.z, 0.8, 0x5fd35f);
      }
    }
  }

  // ---------- 1ª pessoa ----------
  setFps(on) {
    if (on === this.fps || this.player.dead) return;
    this.fps = on;
    const pl = this.player, c = this.camera;
    if (on) {
      this.fpsYaw = pl.facing; this.fpsPitch = -0.08; c.near = 0.05;
      this.hud.toast(`${icon('camera')} Primeira pessoa · mouse olha (clique trava o cursor) · B ou rolar para trás para sair`, 'dim');
      this.requestLook();
    } else {
      c.near = 0.5; c.fov = 40;
      if (document.pointerLockElement) document.exitPointerLock();
      this.cam.target.copy(pl.pos);
      this.hud.toast(`${icon('camera')} Visão de cima`, 'dim');
    }
    c.updateProjectionMatrix();
    // a luz de preenchimento (pensada para a câmera de cima) fica colada na lâmina em 1ª pessoa: atenua
    if (this._plI === undefined) this._plI = this.playerLight.intensity;
    this.playerLight.intensity = on ? this._plI * 0.2 : this._plI;
    // a própria cabeça some (a câmera fica nos olhos) e a silhueta de raio-X é desligada
    pl.rig.head.visible = !on;
    pl.rig.root.traverse((o) => { if (o.userData.xray) o.visible = !on; });
  }
  requestLook() {
    if (this.touch) return;
    const el = this.app.renderer.domElement;
    if (document.pointerLockElement === el) return;
    try { const p = el.requestPointerLock(); if (p && p.catch) p.catch(() => {}); } catch {}
  }
  updateFpsCamera(dt) {
    const inp = this.input, pl = this.player, c = this.camera, p = pl.pos;
    if (!this.uiBlocking) {
      const sens = 0.0024;
      this.fpsYaw -= inp.lookDX * sens;
      this.fpsPitch = clamp(this.fpsPitch - inp.lookDY * sens, -1.2, 1.05);
      if (inp.key('ArrowLeft')) this.fpsYaw += dt * 2.4;
      if (inp.key('ArrowRight')) this.fpsYaw -= dt * 2.4;
      if (inp.key('ArrowUp')) this.fpsPitch = Math.min(1.05, this.fpsPitch + dt * 1.6);
      if (inp.key('ArrowDown')) this.fpsPitch = Math.max(-1.2, this.fpsPitch - dt * 1.6);
    }
    if (this.touch) { // celular: a visão acompanha a mira automática / arrasto do botão de ataque
      this.touch.applyAim();
      this.fpsYaw = angleLerp(this.fpsYaw, Math.atan2(inp.aim.x - p.x, inp.aim.z - p.z), Math.min(1, dt * 6));
    }
    const fx = Math.sin(this.fpsYaw), fz = Math.cos(this.fpsYaw), cp = Math.cos(this.fpsPitch);
    if (!this.touch) { inp.aim.x = p.x + fx * 14; inp.aim.z = p.z + fz * 14; }
    const head = this._headPos || (this._headPos = new THREE.Vector3());
    pl.rig.head.getWorldPosition(head);
    c.position.set(head.x + fx * 0.24, head.y + 0.17, head.z + fz * 0.24); // à frente do rosto: ombros e tronco ficam atrás da câmera
    c.lookAt(c.position.x + fx * cp, c.position.y + Math.sin(this.fpsPitch), c.position.z + fz * cp);
    const run = clamp(Math.hypot(pl.vel.x, pl.vel.z) / 8, 0, 1);
    const fov = 72 + 4 * run + (pl.dashT > 0 ? 6 : 0);
    if (Math.abs(c.fov - fov) > 0.01) { c.fov += (fov - c.fov) * Math.min(1, dt * 6); c.updateProjectionMatrix(); }
    if (!setting('shake')) this.shakeAmt = 0;
    if (this.shakeAmt > 0.001) { c.rotateX((Math.random() - 0.5) * this.shakeAmt * 0.05); c.rotateY((Math.random() - 0.5) * this.shakeAmt * 0.05); this.shakeAmt *= Math.exp(-dt * 7); }
    this.sun.position.set(p.x - 22, 45, p.z + 18);
    this.sun.target.position.set(p.x, 0, p.z);
    this.playerLight.position.set(p.x, 3.2, p.z + 0.5);
    updateOcclusionWindow(c, p, false); // nada fica transparente em 1ª pessoa
  }

  get uiBlocking() { return this.paused || this.invOpen || !!this.ended; }

  // ---------- Loop ----------
  update(dt) {
    const inp = this.input;
    if (inp.pressed('Escape')) {
      if (this.invOpen) this.hud.toggleInventory(false);
      else if (!this.ended) this.hud.togglePause();
    }
    if ((inp.pressed('Tab') || inp.pressed('KeyI')) && !this.ended && !this.paused) this.hud.toggleInventory();
    if (inp.pressed('KeyB') && !this.uiBlocking) this.setFps(!this.fps);
    if (this.fps && inp.clicked(0) && !this.uiBlocking && !document.pointerLockElement) this.requestLook();
    if (inp.pressed('KeyM')) this.hud.toast(toggleMute() ? `${icon('mudo')} Som desligado` : `${icon('som')} Som ligado`, 'dim');
    if (inp.clicked(0) || inp.justPressed.size) initAudio();

    if ((!this.paused && !this.invOpen) || this.coop) {
      if (this.hitStopT > 0) { this.hitStopT -= dt; dt *= 0.06; }
      this.time += dt;
      this.world.update(dt);
      this.player.update(dt, inp);
      this.flowT -= dt;
      const pc = this.world.cellOf(this.player.pos.x, this.player.pos.z);
      if (this.flowT <= 0 && pc !== this.flowCell) {
        this.flowT = 0.25; this.flowCell = pc;
        this.world.computeField(this.player.pos.x, this.player.pos.z, this.flow);
      }
      for (let i = this.zombies.length - 1; i >= 0; i--) {
        const z = this.zombies[i];
        // zumbis muito longe atualizam com menos frequência
        const far = Math.abs(z.pos.x - this.player.pos.x) + Math.abs(z.pos.z - this.player.pos.z) > 70 && !z.aggro;
        if (far && ((i + Math.floor(this.time * 10)) % 4 !== 0)) continue;
        if (z.update(far ? dt * 4 : dt)) { z.remove(); this.zombies.splice(i, 1); }
      }
      for (const n of this.world.nests) if (n.mother) n.shieldOn = n.alive && this.motherShielded();
      this.updateProjectiles(dt);
      for (let i = this.skillObjs.length - 1; i >= 0; i--) if (this.skillObjs[i].update(dt)) this.skillObjs.splice(i, 1);
      if (this.combo.t > 0) { this.combo.t -= dt; if (this.combo.t <= 0) this.combo.n = 0; }
      if (this.coop && this.coop.isClient) this.coop.updateClientDrops(dt);
      else { this.updateDrops(dt); this.updateSpawns(dt); }
      if (this.coop) this.coop.update(dt);
      if (!this.ended) this.updateInteraction(dt);
      this.effects.update(dt);
      let aggro = 0; for (const z of this.zombies) if (z.aggro && !z.dead) aggro++;
      setMusicIntensity(aggro / 8 + (this.bossAwake ? 0.5 : 0));
      this.autosaveT -= dt;
      if (this.autosaveT <= 0) { this.autosaveT = 30; saveProfile(this.profile); }
    }
    this.updateCamera(dt);
    this.presenceTimer -= dt;
    if (this.presenceTimer <= 0) { this.presenceTimer = 20; this.setGamePresence(true); }
    this.hud.update(dt);
    if (this.touch) this.touch.update();
    inp.endFrame();
  }

  render() {
    this.app.draw(this.scene, this.camera);
    this.hud.drawOverlay(this.app.octx);
  }

  resize(w, h) {
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    // celular em pé: câmera mais afastada para enxergar o suficiente dos lados
    if (this.touch && this.cam) this.cam.dist = h > w ? 40 : 27;
  }

  setGamePresence(active) {
    fetch('/api/game/presence', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ active }), keepalive: !active }).catch(() => {});
  }

  dispose() {
    this.disposed = true;
    this.setGamePresence(false);
    if (this.coop) this.coop.dispose();
    if (this.touch) this.touch.dispose();
    for (const z of this.zombies) z.remove();
    this.effects.clear();
    this.world.dispose();
    this.input.dispose();
    this.hud.dispose();
    if (document.pointerLockElement) document.exitPointerLock();
    this.player.dispose();
    this.player.rig.dispose();
    this.scene.clear();
  }
}
