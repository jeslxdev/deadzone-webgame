// ============================================================
//  JOGADOR — movimento, combate (Atirador / Samurai), skills
// ============================================================
import * as THREE from 'three';
import { CLASSES, CONSUMABLES } from './data.js';
import { deriveStats, weaponStats, takeConsumable } from './rpg.js';
import { buildHumanoid } from './character.js';
import { angleLerp, angleDiff, clamp, rand } from './util.js';
import { sfx } from './audio.js';
import { humanGait, newGait } from './anim.js';
import { addXraySilhouette, markCharacterOrder } from './occlusion.js';
import { SKILLS, SKILL_KEYS } from './data.js';
import { castSkill, skillCooldown, areaHit } from './skills.js';
import { icon } from './icons.js';

export class Player {
  constructor(game, profile) {
    this.game = game;
    this.profile = profile;
    this.cls = CLASSES[profile.cls];
    this.rig = buildHumanoid(profile.appearance);
    this.xray = addXraySilhouette(this.rig.root, 0x6fd8ff);
    game.scene.add(this.rig.root);
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this._prev = new THREE.Vector3();
    this.radius = 0.45;
    this.facing = 0;
    this.kx = 0; this.kz = 0;
    this.atkCd = 0; this.reloadT = 0; this.ammo = 0;
    this.dashT = 0; this.dashCd = 0; this.dashDir = [0, 1];
    this.jump = null; this.jumpY = 0;
    this.invuln = 0;
    this.cds = {};          // recarga por habilidade
    this.comboStep = 0; this.lastSwingEnd = -9; this.lastDash = -9;
    this.heavy = null; this.heavyCd = 0;
    this.netAtk = 0; this.netShot = 0; // contadores enviados no co-op
    this.flurry = null; this.leap = null; this.furiaT = 0; this.adrenT = 0; this.kickT = 0;
    this.rapidT = 0; this.spinT = 0; this.spinTick = 0; this.lunge = null;
    this.attackAnim = 0; this.swingDir = 1; this.recoil = 0;
    this.lastHurt = -99; this.useCd = 0;
    this.walkPh = 0;
    this.gait = newGait();
    this.dead = false;
    this.moveTarget = null;
    this.refreshStats(true);
  }

  refreshStats(full = false) {
    const prevMax = this.stats ? this.stats.maxHp : 0;
    this.stats = deriveStats(this.profile);
    if (full) this.hp = this.stats.maxHp;
    else if (prevMax) this.hp = Math.min(this.stats.maxHp, this.hp + Math.max(0, this.stats.maxHp - prevMax));
    this.equip(this.profile.equipped, full);
  }

  equip(w, refill = true) {
    this.profile.equipped = w;
    this.w = weaponStats(w);
    this.rig.setWeapon(w);
    markCharacterOrder(this.rig.root);
    if (this.w.type === 'gun' && (refill || this.ammo > this.w.mag)) this.ammo = this.w.mag;
    this.reloadT = 0;
  }

  get isGun() { return this.w.type === 'gun'; }

  takeDamage(amount, src) {
    if (this.dead || this.invuln > 0 || this.game.ended) return;
    amount *= 1 - this.stats.armor;
    this.hp -= amount;
    this.lastHurt = this.game.time;
    this.rig.setFlash(0.8);
    this.hurtFlash = 0.15;
    this.game.effects.blood(this.pos.x, 1.2, this.pos.z, 6);
    this.game.effects.number(this.pos.x, 2.3, this.pos.z, Math.round(amount), '#ff5050', 18);
    this.game.hud.hurt();
    sfx.hurt();
    if (this.hp <= 0) { this.hp = 0; this.dead = true; this.game.onPlayerDeath(); }
  }

  knock(x, z) { this.kx += x; this.kz += z; }

  heal(n) {
    const before = this.hp;
    this.hp = Math.min(this.stats.maxHp, this.hp + n);
    const d = this.hp - before;
    if (d > 0.5) this.game.effects.number(this.pos.x, 2.4, this.pos.z, '+' + Math.round(d), '#5fd35f', 16);
  }

  useConsumable(id) {
    if (this.useCd > 0 || this.dead) return;
    const g = this.game;
    if (this.hp >= this.stats.maxHp) { g.hud.toast('Vida cheia', 'dim'); return; }
    if (!takeConsumable(g.bag, id) && !takeConsumable(this.profile.stash, id)) { g.hud.toast(`Sem ${CONSUMABLES[id].name}`, 'dim'); return; }
    const c = CONSUMABLES[id];
    this.heal(c.heal + c.healPct * this.stats.maxHp);
    this.useCd = 0.8;
    g.effects.particles(this.pos.x, 1, this.pos.z, 10, 0x5fd35f, 3, 0.6, 0.8, -2);
    g.hud.refreshBag();
  }

  damageRoll(base, melee = !this.isGun, raw = false) {
    const crit = Math.random() < this.stats.crit;
    const mult = raw ? 1 : melee ? this.stats.melee : this.stats.gun;
    return { dmg: base * mult * (crit ? this.stats.critMult : 1) * this.game.comboMult(), crit };
  }

  // Dano do jogador em um zumbi (combo, crítico, roubo de vida, atordoamento)
  dealDamage(z, base, opts = {}) {
    const melee = opts.melee ?? !this.isGun;
    const { dmg, crit } = this.damageRoll(base, melee, opts.raw);
    const dealt = z.takeDamage(dmg, { ...opts, melee, crit, heavy: opts.heavy || crit });
    const ls = (melee ? this.stats.lifesteal : 0) + (this.furiaT > 0 ? 0.06 : 0);
    if (ls && dealt) this.heal(dealt * ls);
    this.game.addCombo();
    return dealt;
  }

  rankOf(id) { return this.profile.skills.learned[id] || 0; }
  slotReady(i) { const id = this.profile.skills.slots[i]; return id ? (this.cds[id] || 0) : 0; }

  useSkill(i, aim, aimAng) {
    const id = this.profile.skills.slots[i];
    if (!id || (this.cds[id] || 0) > 0) return;
    const rank = this.rankOf(id);
    if (!rank) return;
    castSkill(this, id, rank, aim, aimAng);
    this.cds[id] = skillCooldown(id, rank);
  }

  update(dt, input) {
    const g = this.game, rig = this.rig;
    if (this.dead) {
      rig.body.rotation.x = Math.max(-Math.PI / 2, rig.body.rotation.x - dt * 5);
      return;
    }
    this.atkCd -= dt; this.dashCd -= dt; this.invuln -= dt; this.useCd -= dt;
    if (this.jump) {
      this.jump.t += dt;
      const k = this.jump.t / this.jump.dur;
      if (k >= 1) {
        this.jump = null; this.jumpY = 0;
        g.effects.particles(this.pos.x, 0.08, this.pos.z, 6, 0x8b8172, 1.8, 0.22, 0.5, -1);
        sfx.land();
      } else this.jumpY = Math.sin(k * Math.PI) * 1.15;
    }
    for (const k in this.cds) this.cds[k] -= dt;
    this.heavyCd -= dt; this.kickT -= dt;
    if (this.rapidT > 0) this.rapidT -= dt;
    if (this.furiaT > 0) this.furiaT -= dt;
    if (this.adrenT > 0) { this.adrenT -= dt; this.heal(this.adrenHeal * dt); }
    if (this.hurtFlash > 0) { this.hurtFlash -= dt; if (this.hurtFlash <= 0) rig.setFlash(0); }

    // Regeneração (mais forte fora de combate)
    const outOfCombat = g.time - this.lastHurt > 5;
    this.heal(this.stats.regen * (outOfCombat ? 3 : 1) * dt * (g.playerInSafeZone() ? 4 : 1));

    // Mira
    const aim = input.aim;
    const adx = aim.x - this.pos.x, adz = aim.z - this.pos.z;
    const aimAng = Math.atan2(adx, adz);

    // Movimento
    let mx = 0, mz = 0;
    if (input.key('KeyW')) mz -= 1;
    if (input.key('KeyS')) mz += 1;
    if (input.key('KeyA')) mx -= 1;
    if (input.key('KeyD')) mx += 1;
    let analog = 1;
    if (!mx && !mz && input.moveVec) { [mx, mz] = input.moveVec; analog = Math.min(1, Math.max(0.35, Math.hypot(mx, mz))); } // joystick de toque
    if (mx || mz) { this.moveTarget = null; const l = Math.hypot(mx, mz); mx = (mx / l) * analog; mz = (mz / l) * analog; }
    else if (this.moveTarget) {
      const t = this.moveTarget, tdx = t.x - this.pos.x, tdz = t.z - this.pos.z, td = Math.hypot(tdx, tdz);
      if (td < 0.4) this.moveTarget = null;
      else {
        let dir = null;
        if (td > 3 && !g.world.hasLOS(this.pos.x, this.pos.z, t.x, t.z)) dir = g.world.flowDir(g.moveField, this.pos.x, this.pos.z);
        if (!dir) dir = [tdx / td, tdz / td];
        [mx, mz] = dir;
      }
    }
    if (g.channel) { mx = 0; mz = 0; }

    let speed = this.stats.speed * (this.spinT > 0 ? 0.85 : 1) * (this.isGun && input.mouseDown(0) ? 0.85 : 1) * (this.adrenT > 0 ? 1.3 : 1) * (this.flurry || this.heavy ? 0.3 : 1);
    if (this.dashT > 0) {
      this.dashT -= dt;
      mx = this.dashDir[0]; mz = this.dashDir[1];
      speed = this.stats.speed * 3.4;
      if (Math.random() < 0.6) g.effects.particles(this.pos.x, 0.4, this.pos.z, 1, 0xcfcfcf, 1, 0.3, 1.2, 0);
    }
    if (this.lunge) {
      this.lunge.t -= dt;
      mx = this.lunge.dx; mz = this.lunge.dz; speed = this.lunge.speed;
      this.hitAround(1.9, null, this.lunge.dmg, this.lunge.hit, 6, 0.3);
      if (this.lunge.t <= 0) this.lunge = null;
    }

    if (this.leap) {
      // Golpe Sísmico: salto em arco até o alvo e impacto em área
      const L = this.leap;
      L.t += dt;
      const k = Math.min(1, L.t / L.dur);
      this.pos.x = L.fx + (L.tx - L.fx) * k; this.pos.z = L.fz + (L.tz - L.fz) * k;
      this.leapY = Math.sin(k * Math.PI) * 2.4;
      if (k >= 1) {
        this.leap = null; this.leapY = 0;
        g.world.collide(this.pos, this.radius);
        areaHit(this, { x: this.pos.x, z: this.pos.z, r: L.r, base: L.dmg, melee: true, knock: 12, stun: 1.6, heavy: true });
        g.effects.shock(this.pos.x, this.pos.z, L.r, 0xffb060); g.effects.shock(this.pos.x, this.pos.z, L.r * 0.6, 0xffffff);
        g.effects.particles(this.pos.x, 0.3, this.pos.z, 26, 0x5a5048, 9, 0.8, 1.8);
        g.shake(0.8); g.hitStop(0.09); sfx.heavyStep(0, true); sfx.slash(true);
      }
    } else {
      this.leapY = 0;
      this.pos.x += (mx * speed + this.kx) * dt;
      this.pos.z += (mz * speed + this.kz) * dt;
    }
    const kd = Math.exp(-dt * 9);
    this.kx *= kd; this.kz *= kd;
    if (!this.leap) g.world.collide(this.pos, this.radius);
    if (dt > 0) this.vel.set((this.pos.x - this._prev.x) / dt, 0, (this.pos.z - this._prev.z) / dt);
    this._prev.copy(this.pos);

    // Ações
    const shiftTap = input.pressed('ShiftLeft') || input.pressed('ShiftRight');
    const shiftMoveClick = input.clicked(1) || input.clicked(2);
    if (shiftTap && !shiftMoveClick && this.dashCd <= 0 && !g.channel) {
      this.dashT = 0.17; this.dashCd = this.stats.dashCd; this.invuln = 0.28;
      this.dashDir = (mx || mz) ? [mx, mz] : [Math.sin(aimAng), Math.cos(aimAng)];
      this.lastDash = g.time;
      sfx.dash();
    }
    if (input.pressed('Space') && !this.jump && !this.leap && !g.channel) {
      this.jump = { t: 0, dur: 0.62 };
      this.jumpY = 0;
      sfx.jump();
    }
    if (input.pressed('KeyR') && this.isGun && this.ammo < this.w.mag && this.reloadT <= 0) this.startReload();
    if (input.pressed('Digit1')) this.useConsumable('bandagem');
    if (input.pressed('Digit2')) this.useConsumable('medkit');
    if (!g.channel && !this.leap) SKILL_KEYS.forEach((k, i) => { if (input.pressed(k)) this.useSkill(i, aim, aimAng); });
    // ataque pesado (botão direito; Shift+direito = mover até o ponto)
    const shift = input.key('ShiftLeft') || input.key('ShiftRight');
    if (input.clicked(2) && !shift && !g.uiBlocking && !g.channel && this.heavyCd <= 0 && !this.heavy && !this.leap) this.startHeavy(aimAng);
    if (this.heavy) {
      this.heavy.t += dt;
      this.facing = angleLerp(this.facing, aimAng, Math.min(1, dt * 10));
      if (!this.heavy.done && this.heavy.t >= this.heavy.wind) this.releaseHeavy();
      if (this.heavy.t >= this.heavy.wind + 0.25) this.heavy = null;
    }
    // Mil Cortes
    if (this.flurry) {
      this.flurry.tick -= dt;
      if (this.flurry.tick <= 0) {
        this.flurry.tick = 0.085;
        this.swingDir *= -1; this.attackAnim = 1; this.attackDur = 0.08;
        const a = aimAng + (Math.random() - 0.5) * 0.6;
        const hit = this.hitAround(this.w.reach + 0.4, { ang: a, arc: 1.9 }, this.flurry.dmg, null, 2, 0.25);
        g.effects.slash(this.pos.x, this.pos.z, a, 1.9, this.w.reach + 0.5, 0xbfe6ff);
        sfx.slash();
        if (hit) g.hitStop(0.02);
        if (--this.flurry.n <= 0) this.flurry = null;
      }
    }

    if (this.reloadT > 0) {
      this.reloadT -= dt;
      if (this.reloadT <= 0) { this.ammo = this.w.mag; sfx.reload(); }
    }

    const attacking = input.mouseDown(0) && !g.uiBlocking && !g.channel && !this.heavy && !this.flurry && !this.leap;
    if (attacking) {
      if (this.isGun) this.fire(aimAng);
      else this.swing(aimAng);
    }

    // Tempestade de lâminas
    if (this.spinT > 0) {
      this.spinT -= dt; this.spinTick -= dt;
      if (this.spinTick <= 0) {
        this.spinTick = 0.25;
        this.hitAround(3.7, null, this.spinDmg || 15 * this.stats.skillPower, null, 3);
        g.effects.shock(this.pos.x, this.pos.z, 3.7, 0xbfe6ff);
        sfx.slash();
      }
    }

    // Orientação
    const moving = Math.hypot(mx, mz) > 0.1;
    let face = aimAng;
    if (!attacking && moving && this.moveTarget) face = Math.atan2(mx, mz);
    this.facing = angleLerp(this.facing, face, Math.min(1, dt * 18));

    this.animate(dt, moving ? speed : 0);
    rig.root.position.set(this.pos.x, (this.leapY || 0) + (this.jumpY || 0), this.pos.z);
    rig.root.rotation.y = this.spinT > 0 ? g.time * 22 : this.facing;
  }

  startReload() {
    if (this.reloadT > 0) return;
    this.reloadT = this.w.reload / this.stats.atkSpeed;
    sfx.reload();
  }

  fire(ang) {
    if (this.reloadT > 0 || this.atkCd > 0) return;
    const g = this.game;
    if (this.ammo <= 0) { sfx.empty(); this.startReload(); return; }
    const rate = this.w.rate * this.stats.atkSpeed * (this.rapidT > 0 ? 2 : 1);
    this.atkCd = 1 / rate;
    if (this.rapidT <= 0) this.ammo--;
    this.netShot++;
    const mp = new THREE.Vector3();
    (this.rig.muzzle || this.rig.handR).getWorldPosition(mp);
    const spread = this.w.spread * this.stats.spreadMult;
    for (let i = 0; i < this.w.pellets; i++) {
      const a = ang + (Math.random() - 0.5) * 2 * spread;
      const { dmg, crit } = this.damageRoll(this.w.dmg);
      g.spawnBullet(mp.x, 1.3, mp.z, a, dmg, crit, this.w.range, this.w.pierce || 0);
    }
    g.effects.muzzle(mp.x, 1.3, mp.z);
    this.recoil = 1;
    sfx.shot(this.profile.equipped.base);
    if (this.ammo <= 0 && this.rapidT <= 0) this.startReload();
  }

  swing(ang) {
    if (this.atkCd > 0) return;
    const g = this.game;
    const rate = this.w.rate * this.stats.atkSpeed * (this.furiaT > 0 ? 1.5 : 1);
    // combo: golpes encadeados dentro da janela viram sequência; o 3º é o finalizador
    this.comboStep = g.time - this.lastSwingEnd < 0.55 ? (this.comboStep + 1) % 3 : 0;
    const finisher = this.comboStep === 2;
    const dashStrike = g.time - this.lastDash < 0.4;
    this.atkCd = (1 / rate) * (finisher ? 1.35 : 1);
    this.attackAnim = 1; this.netAtk++;
    this.attackDur = Math.min(finisher ? 0.34 : 0.28, this.atkCd * 0.9);
    this.overhead = finisher;
    this.swingDir *= -1;
    this.lastSwingEnd = g.time + this.attackDur;
    const mult = (finisher ? 1.8 : 1) * (dashStrike ? 1.5 : 1);
    const arc = this.w.arc * (finisher ? 1.25 : 1), reach = this.w.reach + (finisher ? 0.5 : 0);
    const hit = this.hitAround(reach, { ang, arc }, this.w.dmg * mult, null, finisher ? 10 : 4, finisher ? 0.7 : 0.12, finisher || dashStrike);
    g.effects.slash(this.pos.x + Math.sin(ang) * 0.3, this.pos.z + Math.cos(ang) * 0.3, ang, arc, reach + 0.3, finisher ? 0xffe0a0 : this.profile.equipped.rarity >= 3 ? 0xffc8f0 : 0xe8f4ff);
    if (finisher) { g.effects.shock(this.pos.x + Math.sin(ang) * 1.5, this.pos.z + Math.cos(ang) * 1.5, 2.2, 0xffe0a0); g.shake(0.25); }
    sfx.slash(finisher || this.w.dmg > 40 || !!this.w.pole);
    if (hit) g.hitStop(finisher ? 0.09 : this.w.dmg > 40 ? 0.075 : 0.045);
  }

  // Ataque pesado: samurai = golpe descendente carregado; atirador = coronhada
  startHeavy(ang) {
    this.heavy = { t: 0, wind: this.isGun ? 0.12 : 0.3, ang, done: false };
    this.heavyCd = this.isGun ? 0.75 : 1.1;
    this.attackAnim = 0;
  }
  releaseHeavy() {
    const g = this.game, h = this.heavy, ang = this.facing;
    h.done = true; this.netAtk++;
    if (this.isGun) {
      const base = this.w.dmg * 1.3 + 14;
      const hit = this.hitAround(2.3, { ang, arc: 1.9 }, base, null, 12, 0.8, true, false);
      g.effects.slash(this.pos.x, this.pos.z, ang, 1.6, 2.4, 0xd8d8d8);
      sfx.swing(); if (hit) { sfx.hit(true); g.hitStop(0.06); }
    } else {
      const hit = this.hitAround(this.w.reach + 0.9, { ang, arc: 1.5 }, this.w.dmg * 2.6, null, 13, 1.1, true);
      const fx = this.pos.x + Math.sin(ang) * 2, fz = this.pos.z + Math.cos(ang) * 2;
      g.effects.slash(this.pos.x, this.pos.z, ang, 1.5, this.w.reach + 1.1, 0xffffff);
      g.effects.shock(fx, fz, 2.6, 0xffd080);
      g.effects.particles(fx, 0.2, fz, 14, 0x5a5048, 6, 0.6, 1.4);
      g.shake(0.4); sfx.slash(true); sfx.heavyStep(2, false);
      if (hit) g.hitStop(0.1);
    }
  }

  // Aplica dano corpo a corpo em zumbis e ninhos ao redor. cone = {ang, arc} ou null (360°)
  hitAround(reach, cone, baseDmg, hitSet, knock = 4, stun = 0, heavy = false, melee = true) {
    const g = this.game;
    let any = false;
    for (const z of g.zombies) {
      if (z.dead || (hitSet && hitSet.has(z))) continue;
      const dx = z.pos.x - this.pos.x, dz = z.pos.z - this.pos.z, d = Math.hypot(dx, dz);
      if (d > reach + z.radius) continue;
      if (cone && d > 0.6 && Math.abs(angleDiff(cone.ang, Math.atan2(dx, dz))) > cone.arc / 2) continue;
      this.dealDamage(z, baseDmg, { kx: (dx / (d || 1)) * knock, kz: (dz / (d || 1)) * knock, melee, stun, heavy: heavy || baseDmg > 40 });
      if (hitSet) hitSet.add(z);
      any = true;
    }
    for (const n of g.world.nests) {
      if (!n.alive || (hitSet && hitSet.has(n))) continue;
      const dx = n.x - this.pos.x, dz = n.z - this.pos.z, d = Math.hypot(dx, dz);
      if (d > reach + n.radius) continue;
      if (cone && Math.abs(angleDiff(cone.ang, Math.atan2(dx, dz))) > cone.arc / 2 + 0.3) continue;
      const { dmg, crit } = this.damageRoll(baseDmg, melee);
      g.damageNest(n, dmg, crit);
      if (hitSet) hitSet.add(n);
      any = true;
    }
    return any;
  }

  animate(dt, speed) {
    const rig = this.rig, M = THREE.MathUtils;
    const attacking = this.attackAnim > 0;
    if (this.attackAnim <= 0) this.overhead = false;
    const step = humanGait(rig, this.gait, dt, this.dashT > 0 ? 0 : speed, { runAt: 8, freeArms: false, freeTorso: !attacking && !this.isGun });
    if (step) sfx.step(speed > 7 ? 1 : 0, this.game.mapDef.theme);
    this.recoil = Math.max(0, this.recoil - dt * 10);
    const m = this.gait.blend, s = Math.sin(this.gait.ph);
    if (this.dashT > 0) {
      // esquiva: corpo baixo e inclinado, pernas recolhidas
      rig.torso.rotation.x = 0.55; rig.body.position.y = -0.12;
      rig.kneeL.rotation.x = rig.kneeR.rotation.x = 1.0;
      rig.legL.rotation.x = -0.6; rig.legR.rotation.x = 0.2;
    }
    if (this.isGun) {
      const reloading = this.reloadT > 0;
      // braço direito aponta a arma; esquerdo apoia na empunhadura frontal
      rig.armR.rotation.set(-Math.PI / 2 + this.recoil * 0.22 + (reloading ? 0.55 : 0), 0.1, 0);
      rig.elbowR.rotation.x = -0.05 - this.recoil * 0.15 - (reloading ? 0.7 : 0);
      rig.armL.rotation.set(-1.05 + (reloading ? 0.35 : 0), -0.75, 0);
      rig.elbowL.rotation.x = -0.75 - (reloading ? 0.6 : 0);
      rig.torso.rotation.y = M.lerp(rig.torso.rotation.y, -0.12, 0.2);
      rig.head.rotation.y = 0.1;
    } else if (this.heavy && !this.isGun) {
      // carrega acima da cabeça e desce
      const h = this.heavy, k = Math.min(1, h.t / h.wind), down = h.done ? Math.min(1, (h.t - h.wind) / 0.12) : 0;
      rig.armR.rotation.set(-2.9 * k + down * 2.2, 0, 0); rig.elbowR.rotation.x = -0.6 * k + down * 0.5;
      rig.armL.rotation.set(-2.7 * k + down * 2.0, -0.3, 0); rig.elbowL.rotation.x = -0.7 * k;
      rig.torso.rotation.x = -0.15 * k + down * 0.5;
    } else if (attacking && this.overhead && !this.isGun) {
      this.attackAnim = Math.max(0, this.attackAnim - dt / (this.attackDur || 0.3));
      const e = 1 - this.attackAnim;
      rig.armR.rotation.set(M.lerp(-2.8, -0.5, e), 0.1, 0); rig.elbowR.rotation.x = -0.4 * (1 - e);
      rig.torso.rotation.x = M.lerp(-0.1, 0.45, e); rig.torso.rotation.y = 0;
      if (rig.weaponL) { rig.armL.rotation.set(M.lerp(-2.8, -0.5, e), -0.1, 0); rig.elbowL.rotation.x = -0.4 * (1 - e); }
      else { rig.armL.rotation.set(M.lerp(-2.6, -0.6, e), -0.2, 0); rig.elbowL.rotation.x = -0.5; }
    } else if (attacking) {
      this.attackAnim = Math.max(0, this.attackAnim - dt / (this.attackDur || 0.25));
      const k = 1 - this.attackAnim;
      const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
      const sd = this.swingDir;
      // golpe horizontal: braço estende no meio do arco, tronco gira junto
      rig.armR.rotation.set(-1.45, sd * M.lerp(1.4, -1.3, e), 0);
      rig.elbowR.rotation.x = -0.9 * (1 - Math.sin(e * Math.PI)) - 0.05;
      rig.torso.rotation.y = sd * M.lerp(0.6, -0.6, e);
      rig.head.rotation.y = -rig.torso.rotation.y * 0.6;
      if (rig.weaponL) { rig.armL.rotation.set(-1.45, -sd * M.lerp(-1.3, 1.4, e), 0); rig.elbowL.rotation.x = -0.9 * (1 - Math.sin(e * Math.PI)) - 0.05; }
      else { rig.armL.rotation.set(-0.7, -0.5, 0.2); rig.elbowL.rotation.x = -1.2; }
      rig.legL.rotation.x += -0.15 * sd; rig.legR.rotation.x += 0.15 * sd; // base firme
    } else {
      // guarda: lâmina à frente, braços acompanham a passada
      rig.armR.rotation.set(-0.35 - s * 0.15 * m, 0.12, -0.05);
      rig.elbowR.rotation.x = -0.6 - 0.25 * m;
      if (rig.weaponL) { rig.armL.rotation.set(-0.35 + s * 0.15 * m, -0.12, 0.05); rig.elbowL.rotation.x = -0.6 - 0.25 * m; }
      else { rig.armL.rotation.set(s * 0.5 * m, 0, 0.08); rig.elbowL.rotation.x = -(0.2 + 0.8 * Math.min(1, speed / 8) * m); }
    }
    if (this.kickT > 0) { // chute frontal
      const k = Math.sin((1 - this.kickT / 0.32) * Math.PI);
      rig.legR.rotation.x = -1.5 * k; rig.kneeR.rotation.x = 0.2 * (1 - k); rig.torso.rotation.x = -0.25 * k;
    }
    if (this.jump) {
      const k = this.jump.t / this.jump.dur, crouch = Math.sin(Math.min(1, k * 2) * Math.PI / 2);
      rig.legL.rotation.x = -0.35 - 0.35 * crouch; rig.legR.rotation.x = -0.3 - 0.35 * crouch;
      rig.kneeL.rotation.x = 0.45 + 0.55 * Math.sin(k * Math.PI); rig.kneeR.rotation.x = 0.4 + 0.5 * Math.sin(k * Math.PI);
      rig.torso.rotation.x = k < 0.2 ? -0.18 : 0.08;
      rig.armL.rotation.x = -0.9; rig.armR.rotation.x = -0.9;
    }
    if (this.leap) { rig.legL.rotation.x = -0.9; rig.legR.rotation.x = 0.3; rig.kneeL.rotation.x = 1.2; rig.kneeR.rotation.x = 1.0; rig.armR.rotation.set(-2.8, 0, 0); rig.torso.rotation.x = 0.2; }
    if (this.flurry) rig.torso.rotation.y = Math.sin(this.game.time * 40) * 0.35;
  }
}
