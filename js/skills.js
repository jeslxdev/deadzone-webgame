// ============================================================
//  HABILIDADES — execução das skills e objetos de skill no mundo
//  (onda cortante, mina, torreta). Rank 1..3 aumenta poder e
//  reduz recarga.
// ============================================================
import * as THREE from 'three';
import { SKILLS } from './data.js';
import { sfx } from './audio.js';
import { icon } from './icons.js';
import { angleDiff } from './util.js';

export const skillPower = (rank) => 1 + 0.3 * (rank - 1);
export const skillCooldown = (id, rank) => SKILLS[id].cd * (1 - 0.12 * (rank - 1));

// Aplica dano a todos os zumbis numa área (círculo ou cone)
export function areaHit(pl, { x, z, r, cone, base, melee = true, knock = 6, stun = 0, set = null, heavy = false }) {
  const g = pl.game;
  let n = 0;
  for (const zb of g.zombies) {
    if (zb.dead || (set && set.has(zb))) continue;
    const dx = zb.pos.x - x, dz = zb.pos.z - z, d = Math.hypot(dx, dz);
    if (d > r + zb.radius) continue;
    if (cone && d > 0.5 && Math.abs(angleDiff(cone.ang, Math.atan2(dx, dz))) > cone.arc / 2) continue;
    pl.dealDamage(zb, base, { melee, kx: (dx / (d || 1)) * knock, kz: (dz / (d || 1)) * knock, stun, heavy });
    if (set) set.add(zb);
    n++;
  }
  for (const nest of g.world.nests) {
    if (!nest.alive || (set && set.has(nest))) continue;
    if (Math.hypot(nest.x - x, nest.z - z) > r + nest.radius) continue;
    const { dmg, crit } = pl.damageRoll(base, melee);
    g.damageNest(nest, dmg, crit);
    if (set) set.add(nest);
  }
  return n;
}

export function castSkill(pl, id, rank, aim, ang) {
  const g = pl.game, st = pl.stats, pw = skillPower(rank) * st.skillPower;
  const fx = g.effects, dx = Math.sin(ang), dz = Math.cos(ang), p = pl.pos;
  const toAim = (max) => {
    const ax = aim.x - p.x, az = aim.z - p.z, d = Math.hypot(ax, az), k = Math.min(1, max / (d || 1));
    return { x: p.x + ax * k, z: p.z + az * k };
  };
  switch (id) {
    case 'granada': {
      const t = toAim(13);
      g.spawnGrenade(p.x, p.z, t.x, t.z, 70 * st.gun * pw);
      break;
    }
    case 'rajada':
      pl.rapidT = 4 + (rank - 1); pl.ammo = pl.w.mag; pl.reloadT = 0;
      g.hud.toast(`${icon('rajada')} Rajada Tática!`, 'skill');
      break;
    case 'investida':
      pl.lunge = { t: 0.24, dx, dz, speed: 36, dmg: 48 * pw, hit: new Set() };
      pl.invuln = 0.35; pl.attackAnim = 1; pl.attackDur = 0.24;
      fx.slash(p.x, p.z, ang, 1.2, 3, 0xbfe6ff);
      sfx.dash(); sfx.slash(true);
      break;
    case 'tempestade':
      pl.spinT = 2.5 + 0.5 * (rank - 1); pl.spinTick = 0; pl.spinDmg = 15 * pw;
      break;
    case 'onda':
      g.skillObjs.push(new Wave(g, p.x, p.z, ang, 42 * st.melee * pw));
      pl.attackAnim = 1; pl.attackDur = 0.2; pl.swingDir *= -1;
      sfx.slash(true);
      break;
    case 'sismico': {
      const t = toAim(8);
      pl.leap = { t: 0, dur: 0.45, fx: p.x, fz: p.z, tx: t.x, tz: t.z, dmg: 62 * pw, r: 4.3 + 0.5 * (rank - 1) };
      pl.invuln = 0.55;
      sfx.dash();
      break;
    }
    case 'milcortes':
      pl.flurry = { n: 8 + 2 * (rank - 1), tick: 0, dmg: 14 * pw };
      break;
    case 'furia':
      pl.furiaT = 8 + 2 * (rank - 1);
      fx.beam(p.x, p.z, 0xff3020, 0.8);
      fx.shock(p.x, p.z, 4, 0xff3020);
      sfx.boss();
      g.hud.toast(`${icon('furia')} Fúria do Ronin!`, 'skill');
      break;
    case 'chumbo': {
      const n = areaHit(pl, { x: p.x, z: p.z, r: 7.5, cone: { ang, arc: 1.7 }, base: 45 * pw, melee: false, knock: 15, stun: 0.6 + 0.2 * rank, heavy: true });
      for (let i = 0; i < 12; i++) {
        const a = ang + (Math.random() - 0.5) * 1.6, L = 4 + Math.random() * 3.5;
        fx.tracer(p.x, 1.3, p.z, p.x + Math.sin(a) * L, p.z + Math.cos(a) * L, 0xffd08a);
      }
      fx.muzzle(p.x + dx * 0.9, 1.3, p.z + dz * 0.9);
      sfx.shot('escopeta'); g.shake(0.35);
      if (n) g.hitStop(0.06);
      pl.recoil = 1.5;
      break;
    }
    case 'mina': {
      const t = toAim(10);
      g.skillObjs.push(new Mine(g, t.x, t.z, 95 * st.gun * pw));
      sfx.reload();
      break;
    }
    case 'perfurante': {
      const L = 34, set = new Set();
      for (const zb of g.zombies) {
        if (zb.dead) continue;
        const rx = zb.pos.x - p.x, rz = zb.pos.z - p.z, along = rx * dx + rz * dz;
        if (along < 0 || along > L) continue;
        const perp = Math.abs(rx * dz - rz * dx);
        if (perp < zb.radius + 0.55) { pl.dealDamage(zb, 125 * pw, { melee: false, kx: dx * 6, kz: dz * 6, stun: 0.3, heavy: true }); set.add(zb); }
      }
      const ex = p.x + dx * L, ez = p.z + dz * L;
      fx.tracer(p.x, 1.3, p.z, ex, ez, 0xa0e0ff); fx.tracer(p.x, 1.32, p.z, ex, ez, 0xffffff);
      fx.muzzle(p.x + dx, 1.3, p.z + dz);
      sfx.shot('precisao'); g.shake(0.3);
      if (set.size) g.hitStop(0.07);
      pl.recoil = 2;
      break;
    }
    case 'torreta': {
      const tx = p.x + dx * 1.6, tz = p.z + dz * 1.6;
      g.skillObjs.push(new Turret(g, g.world.isBlocked(tx, tz) ? p.x : tx, g.world.isBlocked(tx, tz) ? p.z : tz, 9 * st.gun * pw, 12 + 3 * (rank - 1)));
      sfx.reload();
      break;
    }
    case 'chute': {
      pl.kickT = 0.32;
      const base = 16 * pw * (pl.isGun ? st.gun : 1);
      const n = areaHit(pl, { x: p.x, z: p.z, r: 2.5, cone: { ang, arc: 1.7 }, base, melee: !pl.isGun, knock: 18, stun: 1.0 + 0.2 * rank, heavy: true });
      sfx.hit(true);
      if (n) g.hitStop(0.06);
      break;
    }
    case 'grito': {
      areaHit(pl, { x: p.x, z: p.z, r: 6.5, base: 10 * pw, melee: false, knock: 10, stun: 1.4 + 0.3 * rank });
      fx.shock(p.x, p.z, 6.5, 0xffd060); fx.shock(p.x, p.z, 4, 0xffffff);
      sfx.boss(); g.shake(0.4);
      break;
    }
    case 'adrenalina':
      pl.adrenT = 4; pl.adrenHeal = (pl.stats.maxHp * 0.35 * pw) / 4;
      fx.particles(p.x, 1, p.z, 18, 0x5fd35f, 4, 0.8, 1, -3);
      g.hud.toast(`${icon('adrenalina')} Adrenalina!`, 'skill');
      break;
  }
}

// ---------- Objetos de skill ----------
const waveMat = new THREE.MeshBasicMaterial({ color: 0x9fe8ff, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
const waveGeo = new THREE.RingGeometry(1.1, 1.6, 24, 1, 0, 1.6);
class Wave {
  constructor(g, x, z, ang, dmg) {
    this.g = g; this.x = x; this.z = z; this.dx = Math.sin(ang); this.dz = Math.cos(ang); this.dmg = dmg; this.left = 16; this.hit = new Set();
    this.mesh = new THREE.Mesh(waveGeo, waveMat);
    this.mesh.rotation.x = -Math.PI / 2;
    this.mesh.rotation.z = ang - Math.PI / 2 - 0.8;
    this.mesh.position.set(x, 1.0, z);
    g.scene.add(this.mesh);
  }
  update(dt) {
    const g = this.g, step = 22 * dt;
    this.x += this.dx * step; this.z += this.dz * step; this.left -= step;
    this.mesh.position.set(this.x - this.dx * 1.2, 1.0, this.z - this.dz * 1.2);
    for (const zb of g.zombies) {
      if (zb.dead || this.hit.has(zb)) continue;
      if (Math.hypot(zb.pos.x - this.x, zb.pos.z - this.z) < zb.radius + 1.4) {
        this.hit.add(zb);
        g.player.dealDamage(zb, this.dmg, { melee: true, kx: this.dx * 5, kz: this.dz * 5, stun: 0.3, raw: true });
      }
    }
    if (this.left <= 0 || g.world.pointBlocked(this.x, this.z, 1)) { g.scene.remove(this.mesh); return true; }
    return false;
  }
}

const mineGeo = new THREE.CylinderGeometry(0.3, 0.34, 0.12, 14);
const mineMat = new THREE.MeshStandardMaterial({ color: 0x3a4a2a, roughness: 0.6, metalness: 0.4 });
const ledGeo = new THREE.SphereGeometry(0.06, 8, 6);
class Mine {
  constructor(g, x, z, dmg) {
    this.g = g; this.x = x; this.z = z; this.dmg = dmg; this.t = 0; this.life = 60;
    this.mesh = new THREE.Group();
    this.mesh.add(new THREE.Mesh(mineGeo, mineMat));
    this.led = new THREE.Mesh(ledGeo, new THREE.MeshBasicMaterial({ color: 0xff2020 }));
    this.led.position.y = 0.09;
    this.mesh.add(this.led);
    this.mesh.position.set(x, 0.06, z);
    g.scene.add(this.mesh);
  }
  update(dt) {
    const g = this.g;
    this.t += dt;
    this.led.visible = Math.sin(this.t * (this.t > 0.6 ? 14 : 4)) > 0;
    if (this.t > 0.6) {
      for (const zb of g.zombies) {
        if (!zb.dead && Math.hypot(zb.pos.x - this.x, zb.pos.z - this.z) < 1.6 + zb.radius) {
          g.explode(this.x, this.z, 4.2, this.dmg, { hurtZombies: true, fromPlayer: true });
          g.scene.remove(this.mesh); this.led.material.dispose();
          return true;
        }
      }
    }
    if (this.t > this.life) { g.scene.remove(this.mesh); this.led.material.dispose(); return true; }
    return false;
  }
}

const turMat = new THREE.MeshStandardMaterial({ color: 0x3a3e42, roughness: 0.5, metalness: 0.6 });
const turAcc = new THREE.MeshStandardMaterial({ color: 0xd8a020, roughness: 0.5, metalness: 0.3, emissive: 0x402800 });
class Turret {
  constructor(g, x, z, dmg, life) {
    this.g = g; this.x = x; this.z = z; this.dmg = dmg; this.life = life; this.cd = 0; this.ang = 0;
    const m = (this.mesh = new THREE.Group());
    for (let i = 0; i < 3; i++) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.9, 6), turMat);
      const a = (i / 3) * Math.PI * 2;
      leg.position.set(Math.cos(a) * 0.28, 0.4, Math.sin(a) * 0.28);
      leg.rotation.z = Math.cos(a) * 0.35; leg.rotation.x = -Math.sin(a) * 0.35;
      m.add(leg);
    }
    this.head = new THREE.Group();
    this.head.position.y = 0.95;
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.3, 0.5), turMat);
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.7, 8), turMat);
    barrel.rotation.x = Math.PI / 2; barrel.position.z = 0.5;
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.06, 0.3), turAcc);
    stripe.position.y = 0.16;
    this.head.add(body, barrel, stripe);
    m.add(this.head);
    m.position.set(x, 0, z);
    m.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    g.scene.add(m);
    g.world.colliders.push(this.col = { minX: x - 0.35, minZ: z - 0.35, maxX: x + 0.35, maxZ: z + 0.35, h: 1.2 });
  }
  update(dt) {
    const g = this.g;
    this.life -= dt; this.cd -= dt;
    let best = null, bd = 17;
    for (const zb of g.zombies) {
      if (zb.dead) continue;
      const d = Math.hypot(zb.pos.x - this.x, zb.pos.z - this.z);
      if (d < bd && g.world.hasLOS(this.x, this.z, zb.pos.x, zb.pos.z)) { bd = d; best = zb; }
    }
    if (best) {
      const a = Math.atan2(best.pos.x - this.x, best.pos.z - this.z);
      this.ang += angleDiff(this.ang, a) * Math.min(1, dt * 12);
      this.head.rotation.y = this.ang;
      if (this.cd <= 0 && Math.abs(angleDiff(this.ang, a)) < 0.2) {
        this.cd = 0.14;
        const mx = this.x + Math.sin(this.ang) * 0.85, mz = this.z + Math.cos(this.ang) * 0.85;
        g.spawnBullet(mx, 0.95, mz, this.ang + (Math.random() - 0.5) * 0.06, this.dmg, false, 18, 0);
        g.effects.muzzle(mx, 0.95, mz);
        sfx.shot('smg');
      }
    }
    if (this.life <= 0) {
      g.effects.particles(this.x, 0.8, this.z, 12, 0x5a5e62, 4, 0.6, 1);
      g.scene.remove(this.mesh);
      const i = g.world.colliders.indexOf(this.col);
      if (i >= 0) g.world.colliders.splice(i, 1);
      return true;
    }
    return false;
  }
}
