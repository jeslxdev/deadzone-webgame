// ============================================================
//  ZUMBIS — tipos, ranks (normal/elite/mini-boss/boss), IA
// ============================================================
import * as THREE from 'three';
import { ZOMBIE_TYPES, RANKS } from './data.js';
import { buildHumanoid, zombieAppearance, decorateZombie, ZOMBIE_VARIANTS } from './character.js';
import { rand, pick, angleLerp, angleDiff } from './util.js';
import { sfx } from './audio.js';
import { hasModel, instanceModel } from './models.js';
import { zombieGait, newGait } from './anim.js';

const ringGeo = new THREE.RingGeometry(0.75, 0.92, 28);
const blobGeo = new THREE.CircleGeometry(1, 20);
const blobMat = (() => {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(0,0,0,0.55)');
  grd.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
  return new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false });
})();

export class Zombie {
  constructor(game, type, rank, x, z, opts = {}) {
    this.game = game;
    this.type = type;
    this.rank = rank;
    const T = (this.T = ZOMBIE_TYPES[type]);
    const R = (this.R = RANKS[rank]);
    const lvl = game.mapDef.level;
    const hpScale = 1 + 0.36 * (lvl - 1), dmgScale = 1 + 0.2 * (lvl - 1);
    this.maxHp = Math.round(T.hp * R.hp * hpScale);
    this.hp = this.maxHp;
    this.dmg = T.dmg * R.dmg * dmgScale;
    this.baseSpeed = T.speed * rand(0.9, 1.12) * (rank === 'boss' ? 1.15 : rank === 'miniboss' ? 1.1 : 1);
    this.scale = R.scale;
    this.radius = 0.42 * R.scale * (T.build === 'gordo' ? 1.25 : 1);
    this.pos = new THREE.Vector3(x, 0, z);
    this.kx = 0; this.kz = 0; // knockback
    this.facing = Math.random() * Math.PI * 2;
    this.home = { x, z };
    this.nest = opts.nest || null;
    this.state = opts.dormant ? 'dormant' : 'wander';
    this.remote = !!opts.remote;
    this.aggro = false;
    this.name = opts.name || (R.name ? `${T.name} ${R.name}` : T.name);
    this.abilities = opts.abilities || (rank === 'miniboss' ? [pick(['slam', 'charge'])] : []);
    this.abilityCd = rand(2, 4);
    this.cast = null;
    this.atkCd = rand(0, 0.5);
    this.windup = 0;
    this.fuse = 0;
    this.hitFlash = 0;
    this.dead = false;
    this.deathT = 0;
    this.walkPh = Math.random() * 10;
    this.gait = newGait();
    this.gait.ph = Math.random() * 10;
    this.wanderT = 0;
    this.wanderTarget = null;
    this.armor = T.armor || 0;
    this.enraged = false;

    const big = rank === 'boss' || rank === 'miniboss';
    const modelKey = rank === 'boss' && hasModel('boss_' + type) ? 'boss_' + type : 'zombie_' + type;
    let rig;
    if (hasModel(modelKey)) {
      rig = instanceModel(modelKey, { shadows: big });
      this.extras = {};
      rig.play('idle');
    } else {
      this.variant = opts.variant ?? Math.floor(Math.random() * ZOMBIE_VARIANTS);
      rig = buildHumanoid(zombieAppearance(type, this.variant), { zombie: true, shadows: big });
      this.extras = decorateZombie(rig, type);
    }
    this.rig = rig;
    rig.root.scale.setScalar(R.scale);
    rig.root.position.copy(this.pos);
    // sombra circular barata (hordas grandes sem custo de shadow map)
    const blob = new THREE.Mesh(blobGeo, blobMat);
    blob.rotation.x = -Math.PI / 2;
    blob.position.y = 0.04;
    blob.scale.setScalar(T.build === 'gordo' ? 0.75 : 0.55);
    rig.root.add(blob);
    this.blob = blob;
    if (R.color) {
      const ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: R.color, transparent: true, opacity: 0.85, depthWrite: false }));
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.06;
      rig.root.add(ring);
      this.ring = ring;
      rig.setEyeColor(R.color);
    }
    game.scene.add(rig.root);
  }

  get alive() { return !this.dead; }

  wake() {
    if (this.state === 'dormant') {
      this.state = 'chase';
      if (this.rank === 'boss') this.game.onBossAwake(this);
    }
    if (!this.aggro && this.type === 'corredor') sfx.scream();
    this.aggro = true;
  }

  takeDamage(amount, opts = {}) {
    if (this.dead) return 0;
    const raw = amount;
    if (!this.remote) this.wake();
    amount *= 1 - this.armor;
    if (this.rank === 'boss' && this.cast && this.cast.kind === 'summon') amount *= 0.5;
    this.hp -= amount;
    this.hitFlash = 0.12;
    const g = this.game;
    const bcol = this.type === 'cuspidor' ? 0x5a8a1a : 0x6a0d0d;
    const kl = Math.hypot(opts.kx || 0, opts.kz || 0) || 1;
    const dx = (opts.kx || 0) / kl, dz = (opts.kz || 0) / kl;
    if (opts.melee) {
      g.effects.bloodSpray(this.pos.x, 1.15 * this.scale, this.pos.z, dx, dz, opts.heavy ? 26 : 16, bcol, opts.heavy ? 9 : 7);
      if (Math.random() < 0.6) g.effects.decal(this.pos.x + dx * 0.8, this.pos.z + dz * 0.8, opts.heavy ? 1.3 : 0.9);
      sfx.slice(!!opts.heavy);
    } else {
      g.effects.bloodSpray(this.pos.x, 1.2 * this.scale, this.pos.z, dx, dz, opts.crit ? 9 : 5, bcol, 4);
      if (Math.random() < 0.2) g.effects.decal(this.pos.x + dx * 0.5, this.pos.z + dz * 0.5, 0.6);
      sfx.bulletHit();
    }
    if (this.hp - amount > 0) sfx.zombieHurt();
    g.effects.number(this.pos.x, 2.2 * this.scale, this.pos.z, Math.round(amount), opts.crit ? '#ffd23f' : '#ffffff', opts.crit ? 22 : 16);
    if (this.remote) { // co-op (convidado): o anfitrião decide o dano real
      g.coop.sendHit(this, raw, opts);
      this.hp = Math.max(1, this.hp);
      this.lastLocalHit = { t: g.time, ...opts };
      return amount;
    }
    if (opts.kx !== undefined) {
      const resist = this.rank === 'boss' ? 0.1 : this.rank === 'miniboss' ? 0.3 : this.T.build === 'gordo' ? 0.5 : 1;
      this.kx += opts.kx * resist; this.kz += opts.kz * resist;
    }
    if (!this.enraged && this.rank === 'boss' && this.hp < this.maxHp * 0.4) {
      this.enraged = true;
      g.hud.banner(`${this.name} ENFURECEU!`, 'boss');
    }
    if (opts.stun && this.hp > 0) {
      const k = this.rank === 'boss' ? 0.2 : this.rank === 'miniboss' ? 0.5 : 1;
      this.stunT = Math.max(this.stunT || 0, opts.stun * k);
      this.windup = 0;
      if (this.rank !== 'boss' && this.cast && !this.charge) { this.cast.tele && (this.cast.tele.dead = true); this.cast = null; }
    }
    if (this.hp <= 0) this.die(opts);
    return amount;
  }

  die(opts = {}) {
    if (this.dead) return;
    this.dead = true;
    this.hp = 0;
    this.cast && this.cast.tele && (this.cast.tele.dead = true);
    if (this.T.explode && !opts.noExplode) this.explode(0.6);
    if (this.nest) this.nest.children = Math.max(0, this.nest.children - 1);
    const g = this.game;
    sfx.zombieDeath(this.rank);
    g.effects.decal(this.pos.x, this.pos.z, 1.4 * this.scale);
    // decapitação em golpes de lâmina
    if (opts.melee && !this.rig.gltf && this.rank !== 'boss' && Math.random() < (opts.heavy ? 0.75 : 0.45)) this.decapitate(opts);
    g.onZombieKilled(this, opts);
  }

  decapitate(opts) {
    const g = this.game, rig = this.rig, head = rig.head;
    g.scene.attach(head); // mantém posição/rotação no mundo
    const kl = Math.hypot(opts.kx || 0, opts.kz || 0) || 1;
    const dx = (opts.kx || 0) / kl, dz = (opts.kz || 0) / kl;
    g.effects.debris(head, dx * 4 + (Math.random() - 0.5) * 2, 5 + Math.random() * 2, dz * 4 + (Math.random() - 0.5) * 2, 14, 2.6);
    g.effects.emitter(rig.torso, new THREE.Vector3(0, 0.82, 0), 1.0);
    g.effects.bloodSpray(this.pos.x, 1.7 * this.scale, this.pos.z, dx, dz, 22, 0x7a0d0d, 6);
    sfx.decap();
    this.headless = head;
  }

  explode(mult = 1) {
    const g = this.game;
    this.T.explode && this.extras.belly && (this.extras.belly.visible = false);
    g.explode(this.pos.x, this.pos.z, 3.6 * Math.sqrt(this.scale), this.dmg * mult, { hurtPlayer: true, hurtZombies: true, source: this, color: 0x9aff3a });
  }

  remove() {
    if (this.headless && this.headless.parent) this.headless.parent.remove(this.headless);
    this.game.scene.remove(this.rig.root);
    this.rig.dispose();
    if (this.ring) this.ring.material.dispose();
  }

  update(dt) {
    const g = this.game, rig = this.rig, w = g.world;
    let p = g.player;
    if (this.dead) {
      this.deathT += dt;
      if (rig.gltf) { rig.play('death', 0.1); rig.update(dt); }
      if (!rig.gltf || !rig.hasDeath) {
        const k = Math.min(1, this.deathT / 0.55);
        rig.kneeL.rotation.x = rig.kneeR.rotation.x = 1.4 * Math.min(1, k * 2);
        rig.body.position.y = -0.35 * Math.min(1, k * 2);
        rig.body.rotation.x = -Math.PI / 2 * Math.max(0, k * k);
        rig.armL.rotation.x = rig.armR.rotation.x = -2.6 * k;
      }
      if (this.blob) this.blob.visible = false;
      rig.body.position.y = Math.min(0, rig.body.position.y);
      if (this.deathT > 1.6) rig.root.position.y -= dt * 0.8;
      if (this.ring) this.ring.visible = false;
      return this.deathT > 3;
    }
    if (this.hitFlash > 0) { this.hitFlash -= dt; rig.setFlash(Math.max(0, this.hitFlash) * 6); }
    else if (this.fuse > 0) rig.setFlash((Math.sin(g.time * 30) * 0.5 + 0.5) * 0.8);
    if (this.remote) return this.updateRemote(dt);
    if (g.coop) p = this.pickTarget(dt);
    this.tgt = p;

    const dx = p.pos.x - this.pos.x, dz = p.pos.z - this.pos.z;
    const dist = Math.hypot(dx, dz);
    const toPlayer = Math.atan2(dx, dz);
    const speedMult = (this.enraged ? 1.3 : 1);
    let speed = this.baseSpeed * speedMult;
    let mx = 0, mz = 0, wantFace = null;

    // Percepção
    if (this.state === 'dormant') {
      if (!p.dead && dist < this.R.aggro) this.wake();
    } else if (!this.aggro && !p.dead) {
      if (dist < this.R.aggro && (dist < 5 || w.hasLOS(this.pos.x, this.pos.z, p.pos.x, p.pos.z))) this.wake();
    }
    const playerSafe = g.inSafe(p.pos);
    if (p.dead || (playerSafe && this.rank !== 'boss')) { if (this.aggro && dist > 2) { this.aggro = false; this.state = 'wander'; this.wanderTarget = null; } }
    if (this.rank === 'boss' && (p.dead || playerSafe || dist > 60) && this.state !== 'dormant') { this.aggro = false; this.state = 'wander'; }

    const stunned = this.stunT > 0;
    if (stunned) {
      this.stunT -= dt;
      if (Math.random() < dt * 6) g.effects.particles(this.pos.x, 2.1 * this.scale, this.pos.z, 1, 0xffe060, 1.2, 0.5, 0.7, -1);
    }
    // Habilidades (mini-boss / boss)
    if (stunned) {
      speed = 0;
    } else if (this.cast) {
      this.updateCast(dt, dist, toPlayer);
      speed = 0;
    } else if (this.abilities.length && this.aggro) {
      this.abilityCd -= dt * (this.enraged ? 1.5 : 1);
      if (this.abilityCd <= 0 && dist < 22) this.startCast(pick(this.abilities), dist, toPlayer);
    }

    if (!stunned && !this.cast && this.state !== 'dormant') {
      if (this.aggro) {
        this.state = 'chase';
        wantFace = toPlayer;
        if (this.T.ranged) {
          const los = dist < 4 || w.hasLOS(this.pos.x, this.pos.z, p.pos.x, p.pos.z);
          if (dist > this.T.range * 0.85 || !los) [mx, mz] = this.pathTo(dist, dx, dz, los);
          else if (dist < this.T.range * 0.4) { mx = -dx / dist; mz = -dz / dist; speed *= 0.8; }
          this.atkCd -= dt;
          if (los && dist < this.T.range && this.atkCd <= 0) {
            this.atkCd = 1 / this.T.atkRate * rand(0.8, 1.2);
            this.spit(toPlayer);
          }
        } else if (this.T.explode) {
          if (this.fuse > 0) {
            this.fuse -= dt; speed = 0;
            const s = 1 + (0.7 - this.fuse) * 0.6;
            this.extras.belly && this.extras.belly.scale.setScalar(s);
            if (this.fuse <= 0) { this.explode(1); this.die({ noExplode: true, selfKill: true }); return false; }
          } else if (dist < this.T.range) { this.fuse = 0.7; }
          else [mx, mz] = this.pathTo(dist, dx, dz);
        } else {
          const reach = this.T.range * Math.sqrt(this.scale) + p.radius;
          if (this.windup > 0) {
            this.windup -= dt;
            speed *= 0.25;
            if (dist > 0.5) { mx = dx / dist; mz = dz / dist; }
            if (this.windup <= 0) {
              if (dist < reach + 0.4 && Math.abs(angleDiff(this.facing, toPlayer)) < 1.2) {
                p.takeDamage(this.dmg, this);
                if (this.T.knockback) p.knock(dx / dist * this.T.knockback, dz / dist * this.T.knockback);
              }
              this.atkCd = 1 / this.T.atkRate;
            }
          } else {
            this.atkCd -= dt;
            if (dist < reach) {
              if (this.atkCd <= 0) { this.windup = 0.38; sfx.zombieAttack(this.rank); }
            } else [mx, mz] = this.pathTo(dist, dx, dz);
          }
        }
        if (Math.random() < dt * 0.12 && dist < 26) sfx.zombie(dist, Math.max(-1, Math.min(1, -dx / 22)));
      } else {
        // vagando perto de casa
        this.wanderT -= dt;
        if (!this.wanderTarget || this.wanderT <= 0) {
          this.wanderTarget = w.walkableNear(this.home.x, this.home.z, this.rank === 'normal' ? 9 : 4);
          this.wanderT = rand(3, 7);
        }
        if (this.wanderTarget) {
          const wx = this.wanderTarget.x - this.pos.x, wz = this.wanderTarget.z - this.pos.z, wd = Math.hypot(wx, wz);
          if (wd > 0.6) { mx = wx / wd; mz = wz / wd; wantFace = Math.atan2(wx, wz); }
        }
        speed *= 0.32;
      }
    }

    // Separação entre zumbis
    let sx = 0, sz = 0;
    const zs = g.zombies;
    for (let i = 0; i < zs.length; i++) {
      const o = zs[i];
      if (o === this || o.dead) continue;
      const ox = this.pos.x - o.pos.x, oz = this.pos.z - o.pos.z;
      const rr = this.radius + o.radius;
      if (Math.abs(ox) > rr || Math.abs(oz) > rr) continue;
      const d2 = ox * ox + oz * oz;
      if (d2 < rr * rr && d2 > 1e-6) { const d = Math.sqrt(d2); const push = (rr - d) / d; sx += ox * push; sz += oz * push; }
    }

    let vx = mx * speed + this.kx, vz = mz * speed + this.kz;
    if (this.charge) { vx = this.charge.dx * this.charge.speed; vz = this.charge.dz * this.charge.speed; }
    this.pos.x += vx * dt + sx * 0.5;
    this.pos.z += vz * dt + sz * 0.5;
    const decay = Math.exp(-dt * 8);
    this.kx *= decay; this.kz *= decay;

    // Empurra para fora do jogador
    const pdx = this.pos.x - p.pos.x, pdz = this.pos.z - p.pos.z, pr = this.radius + p.radius;
    const pd2 = pdx * pdx + pdz * pdz;
    if (pd2 < pr * pr && pd2 > 1e-6 && !p.dead) { const d = Math.sqrt(pd2); this.pos.x += (pdx / d) * (pr - d); this.pos.z += (pdz / d) * (pr - d); }

    const bx = this.pos.x, bz = this.pos.z;
    w.collide(this.pos, this.radius);
    if (this.charge && (Math.abs(bx - this.pos.x) > 0.01 || Math.abs(bz - this.pos.z) > 0.01)) this.endCharge(true);

    // Zumbis comuns não entram na zona segura
    const s = w.safe, sdx = this.pos.x - s.x, sdz = this.pos.z - s.z, sd = Math.hypot(sdx, sdz);
    if (sd < s.r + 1 && this.rank !== 'boss') { this.pos.x = s.x + (sdx / (sd || 1)) * (s.r + 1); this.pos.z = s.z + (sdz / (sd || 1)) * (s.r + 1); }

    // Direção visual
    const moving = Math.hypot(vx, vz) > 0.2;
    if (wantFace === null && moving) wantFace = Math.atan2(vx, vz);
    if (wantFace !== null) this.facing = angleLerp(this.facing, wantFace, Math.min(1, dt * 8));
    this.animate(dt, moving ? Math.hypot(vx, vz) : 0);
    rig.root.position.set(this.pos.x, 0, this.pos.z);
    rig.root.rotation.y = this.facing;
    return false;
  }

  // co-op: persegue o jogador vivo mais próximo
  pickTarget(dt) {
    this.tgtT = (this.tgtT || 0) - dt;
    if (this.tgtT <= 0 || !this.tgt || this.tgt.dead) {
      this.tgtT = 0.4;
      let best = this.game.player, bd = Infinity;
      for (const t of this.game.coop.targets()) { const d = Math.hypot(t.pos.x - this.pos.x, t.pos.z - this.pos.z); if (d < bd) { bd = d; best = t; } }
      this.tgt = best;
    }
    return this.tgt;
  }

  // convidado: segue o estado enviado pelo anfitrião
  updateRemote(dt) {
    const rig = this.rig, t = this.netT;
    let spd = 0;
    if (t) {
      const k = 1 - Math.exp(-dt * 12), px = this.pos.x, pz = this.pos.z;
      this.pos.x += (t.x - px) * k; this.pos.z += (t.z - pz) * k;
      spd = dt > 0 ? Math.hypot(this.pos.x - px, this.pos.z - pz) / dt : 0;
      this.facing = angleLerp(this.facing, t.f, Math.min(1, dt * 10));
    }
    this.animate(dt, spd > 0.25 ? spd : 0);
    rig.root.position.set(this.pos.x, 0, this.pos.z);
    rig.root.rotation.y = this.facing;
    return false;
  }
  remoteDie() {
    const g = this.game;
    this.dead = true; this.hp = 0; this.deathT = 0;
    sfx.zombieDeath(this.rank);
    g.effects.decal(this.pos.x, this.pos.z, 1.4 * this.scale);
    const h = this.lastLocalHit;
    if (h && h.melee && g.time - h.t < 0.6 && !this.rig.gltf && this.rank !== 'boss' && Math.random() < (h.heavy ? 0.75 : 0.45)) this.decapitate(h);
    if (g.hud.bossRef === this) g.hud.showBoss(null);
  }

  pathTo(dist, dx, dz, los = null) {
    const g = this.game;
    const t = this.tgt || g.player;
    if (dist < 7 && (los ?? g.world.hasLOS(this.pos.x, this.pos.z, t.pos.x, t.pos.z))) return [dx / dist, dz / dist];
    const f = g.world.flowDir(t.flow || g.flow, this.pos.x, this.pos.z);
    if (f) return f;
    return [dx / dist, dz / dist];
  }

  spit(ang) {
    const g = this.game;
    sfx.spit();
    const sp = this.rank === 'normal' ? 0 : 0.25;
    const n = this.rank === 'normal' ? 1 : 3;
    for (let i = 0; i < n; i++) {
      const a = ang + (n > 1 ? (i - (n - 1) / 2) * sp : 0);
      g.spawnEnemyShot(this.pos.x, 1.5 * this.scale, this.pos.z, a, 13, this.dmg, 0x9aff3a, 0.32);
    }
    this.extras.sac && this.extras.sac.scale.setScalar(1.4);
  }

  // ---------- Habilidades ----------
  startCast(kind, dist, toPlayer) {
    const g = this.game, big = this.rank === 'boss';
    this.abilityCd = big ? rand(3.5, 5.5) : rand(6, 9);
    if (kind === 'slam') {
      const r = big ? 7 : 4.8;
      this.cast = { kind, t: 0, dur: big ? 1.1 : 1.0, r, tele: g.effects.telegraphCircle(this.pos.x, this.pos.z, r, big ? 1.1 : 1.0) };
    } else if (kind === 'charge') {
      const len = big ? 18 : 13;
      this.facing = toPlayer;
      this.cast = { kind, t: 0, dur: 0.75, ang: toPlayer, len, tele: g.effects.telegraphLine(this.pos.x, this.pos.z, toPlayer, len, 2.2 * Math.sqrt(this.scale), 0.75) };
    } else if (kind === 'summon') {
      this.cast = { kind, t: 0, dur: 1.0 };
      g.hud.banner(`${this.name} invoca a horda!`, 'warn');
    } else if (kind === 'volley') {
      this.facing = toPlayer;
      this.cast = { kind, t: 0, dur: 0.7, ang: toPlayer };
    }
  }

  updateCast(dt, dist, toPlayer) {
    const c = this.cast, g = this.game, p = this.tgt || g.player;
    c.t += dt;
    const rig = this.rig;
    if (c.kind === 'slam') {
      rig.armL.rotation.x = rig.armR.rotation.x = -2.8 * Math.min(1, c.t / c.dur);
      if (c.t >= c.dur) {
        g.effects.shock(this.pos.x, this.pos.z, c.r, 0xff5a3a);
        g.effects.particles(this.pos.x, 0.3, this.pos.z, 20, 0x5a5048, 8, 0.7, 1.6);
        g.shake(0.6);
        sfx.explode();
        if (dist < c.r + p.radius) {
          p.takeDamage(this.dmg * 1.6, this);
          p.knock((p.pos.x - this.pos.x) / (dist || 1) * 10, (p.pos.z - this.pos.z) / (dist || 1) * 10);
        }
        this.cast = null;
      }
    } else if (c.kind === 'charge') {
      if (!this.charge && c.t >= c.dur) {
        this.charge = { dx: Math.sin(c.ang), dz: Math.cos(c.ang), speed: this.rank === 'boss' ? 24 : 20, left: c.len, hit: false };
      }
      if (this.charge) {
        this.charge.left -= this.charge.speed * dt;
        if (!this.charge.hit && dist < this.radius + p.radius + 0.6) {
          this.charge.hit = true;
          p.takeDamage(this.dmg * 1.4, this);
          p.knock(this.charge.dx * 14, this.charge.dz * 14);
          g.shake(0.4);
        }
        if (this.charge.left <= 0) this.endCharge(false);
        // durante o avanço a velocidade é aplicada no update principal
        this.cast && (this.cast.charging = true);
      }
    } else if (c.kind === 'summon') {
      rig.armL.rotation.x = rig.armR.rotation.x = -3;
      if (c.t >= c.dur) {
        const n = this.rank === 'boss' ? 5 : 3;
        for (let i = 0; i < n; i++) {
          const pos = g.world.walkableNear(this.pos.x, this.pos.z, 5);
          if (pos) { const z = g.spawnZombie(pick(['andarilho', 'corredor', 'andarilho']), 'normal', pos.x, pos.z); z && z.wake(); }
        }
        g.effects.shock(this.pos.x, this.pos.z, 6, 0xb040ff);
        this.cast = null;
      }
    } else if (c.kind === 'volley') {
      this.facing = angleLerp(this.facing, toPlayer, dt * 4);
      if (c.t >= c.dur) {
        const n = 11;
        for (let i = 0; i < n; i++) {
          const a = toPlayer + (i - (n - 1) / 2) * 0.13;
          g.spawnEnemyShot(this.pos.x, 1.6 * Math.min(2, this.scale), this.pos.z, a, 12, this.dmg * 0.55, 0x9aff3a, 0.38);
        }
        sfx.spit();
        this.cast = null;
      }
    }
  }

  endCharge(hitWall) {
    this.charge = null;
    this.cast = null;
    if (hitWall) { this.game.shake(0.3); this.game.effects.particles(this.pos.x, 1, this.pos.z, 10, 0x5a5048, 5, 0.5, 1.2); }
  }

  animate(dt, speed) {
    const rig = this.rig;
    if (rig.gltf) {
      const attacking = this.windup > 0 || this.fuse > 0 || (this.cast && !this.charge);
      rig.play(attacking ? 'attack' : speed > 3.2 || this.charge ? 'run' : speed > 0.2 ? 'walk' : 'idle');
      rig.update(dt * (speed > 0.2 ? Math.max(0.6, speed / 2.3) : 1));
      return;
    }
    const big = this.rank === 'boss' || this.rank === 'miniboss';
    const step = zombieGait(rig, this.gait, dt, speed, { runner: this.type === 'corredor' || !!this.charge || (speed > 4.5) });
    this.walkPh = this.gait.ph;
    if (step) {
      const p = this.game.player.pos, d = Math.hypot(p.x - this.pos.x, p.z - this.pos.z);
      if (big && d < 30) { sfx.heavyStep(d, this.rank === 'boss'); if (this.rank === 'boss' && d < 14) this.game.shake(0.12); }
      else if (d < 9) sfx.shuffle(d);
    }
    if (this.T.build === 'gordo') rig.torso.rotation.x += 0.08;
    if (this.stunT > 0) { // atordoado: cambaleia de cabeça baixa
      const t = this.gait.breath;
      rig.head.rotation.z = Math.sin(t * 9) * 0.45; rig.head.rotation.x = 0.4;
      rig.torso.rotation.x = 0.35 + Math.sin(t * 5) * 0.08;
      rig.armL.rotation.set(-0.3, 0, 0.25); rig.armR.rotation.set(-0.2, 0, -0.25);
      rig.elbowL.rotation.x = rig.elbowR.rotation.x = -0.2;
      return;
    }
    if (this.cast && (this.cast.kind === 'slam' || this.cast.kind === 'summon')) { rig.elbowL.rotation.x = rig.elbowR.rotation.x = -0.4; return; }
    if (this.charge) { rig.torso.rotation.x = 0.7; rig.armL.rotation.set(0.7, 0, 0.3); rig.armR.rotation.set(0.7, 0, -0.3); return; }
    const t = this.gait.breath;
    let armX = -1.3 + Math.sin(t * 1.1) * 0.12, elb = -0.25 + Math.sin(t * 1.7) * 0.15;
    if (this.windup > 0) { const k = 1 - this.windup / 0.38; armX = -2.4 + k * 0.3; elb = -0.9; }
    else if (this.atkCd > 1 / this.T.atkRate - 0.15) { armX = -0.8; elb = -0.05; } // golpe descendo
    if (this.T.ranged) { armX = -0.25 + Math.sin(this.gait.ph) * 0.25; elb = -0.4; }
    if (this.type === 'corredor' && this.aggro && this.windup <= 0) { armX = -0.6 + Math.sin(this.gait.ph) * 0.9; elb = -0.9; } // braços se debatendo
    rig.armL.rotation.set(armX + Math.sin(this.gait.ph) * 0.12, -0.08, 0.12);
    rig.armR.rotation.set(armX - Math.sin(this.gait.ph) * 0.12 + 0.15, 0.08, -0.12); // braço direito mais caído
    rig.elbowL.rotation.x = elb; rig.elbowR.rotation.x = elb - 0.2;
    if (this.extras.sac) this.extras.sac.scale.lerp(new THREE.Vector3(1, 1, 1), dt * 3);
    if (this.extras.belly && this.fuse <= 0) this.extras.belly.scale.setScalar(1 + Math.sin(this.gait.breath * 3) * 0.05); // pivô (tamanho real na malha interna)
  }
}
