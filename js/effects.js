// ============================================================
//  EFEITOS — partículas, traçantes, cortes, explosões,
//  avisos de habilidades (telegraph) e números de dano.
// ============================================================
import * as THREE from 'three';

const pGeo = new THREE.BoxGeometry(0.12, 0.12, 0.12);
const tracerGeo = new THREE.BoxGeometry(0.05, 0.05, 1);
const sphereGeo = new THREE.SphereGeometry(1, 16, 12);
const circleGeo = new THREE.CircleGeometry(1, 40);
const ringGeo = new THREE.RingGeometry(0.92, 1, 48);
const planeGeo = new THREE.PlaneGeometry(1, 1);

const matCache = new Map();
function basic(color, additive = false, opacity = 1) {
  const k = color + '_' + additive + '_' + opacity;
  let m = matCache.get(k);
  if (!m) {
    m = new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending });
    matCache.set(k, m);
  }
  return m;
}

// Texturas de poça/respingo de sangue (variações)
let splatMats = null;
function splats() {
  if (splatMats) return splatMats;
  splatMats = [];
  for (let v = 0; v < 4; v++) {
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const g = c.getContext('2d');
    const col = (a) => `rgba(${70 + Math.random() * 30 | 0},${4 + Math.random() * 8 | 0},${6 + Math.random() * 6 | 0},${a})`;
    g.fillStyle = col(0.85);
    g.beginPath(); g.ellipse(64, 64, 26 + Math.random() * 12, 20 + Math.random() * 12, Math.random() * 3, 0, Math.PI * 2); g.fill();
    for (let i = 0; i < 14; i++) {
      const a = Math.random() * Math.PI * 2, d = 20 + Math.random() * 38, r = 2 + Math.random() * 9;
      g.fillStyle = col(0.6 + Math.random() * 0.35);
      g.beginPath(); g.arc(64 + Math.cos(a) * d, 64 + Math.sin(a) * d, r, 0, Math.PI * 2); g.fill();
    }
    for (let i = 0; i < 6; i++) { // escorrido
      const a = Math.random() * Math.PI * 2;
      g.strokeStyle = col(0.7); g.lineWidth = 3 + Math.random() * 4; g.lineCap = 'round';
      g.beginPath(); g.moveTo(64 + Math.cos(a) * 18, 64 + Math.sin(a) * 18); g.lineTo(64 + Math.cos(a) * (40 + Math.random() * 20), 64 + Math.sin(a) * (40 + Math.random() * 20)); g.stroke();
    }
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
    splatMats.push(new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }));
  }
  return splatMats;
}
const decalGeo = new THREE.PlaneGeometry(1, 1);

export class Effects {
  constructor(scene) {
    this.scene = scene;
    this.decals = [];
    this.debrisList = [];
    this.emitters = [];
    this.parts = [];
    this.fx = [];
    this.numbers = [];
    this.flash = new THREE.PointLight(0xffaa55, 0, 14, 1.6);
    this.flash.position.y = 2;
    scene.add(this.flash);
    this.flashT = 0;
  }

  particles(x, y, z, n, color, speed = 4, life = 0.6, size = 1, gravity = 14) {
    const m = basic(color);
    for (let i = 0; i < n; i++) {
      if (this.parts.length > 450) { const old = this.parts.shift(); this.scene.remove(old.mesh); }
      const mesh = new THREE.Mesh(pGeo, m);
      mesh.position.set(x, y, z);
      const s = size * (0.6 + Math.random() * 0.8);
      mesh.scale.setScalar(s);
      this.scene.add(mesh);
      const a = Math.random() * Math.PI * 2, up = Math.random();
      this.parts.push({ mesh, vx: Math.cos(a) * speed * Math.random(), vy: up * speed * 0.9, vz: Math.sin(a) * speed * Math.random(), life, max: life, g: gravity, s });
    }
  }
  blood(x, y, z, n = 8, color = 0x7a0d0d) { this.particles(x, y, z, n, color, 4.5, 0.55, 1); }

  // Jato de sangue na direção do golpe (dx,dz normalizado)
  bloodSpray(x, y, z, dx, dz, n = 16, color = 0x7a0d0d, force = 7) {
    const m = basic(color);
    for (let i = 0; i < n; i++) {
      if (this.parts.length > 520) { const old = this.parts.shift(); this.scene.remove(old.mesh); }
      const mesh = new THREE.Mesh(pGeo, m);
      mesh.position.set(x, y, z);
      const sz = 0.5 + Math.random() * 0.9;
      mesh.scale.setScalar(sz);
      this.scene.add(mesh);
      const sp = force * (0.4 + Math.random() * 0.8), spread = 0.7;
      const px = -dz, pz = dx; // perpendicular: leque do corte
      const lat = (Math.random() - 0.5) * 2 * spread;
      this.parts.push({ mesh, vx: (dx + px * lat) * sp, vy: 1.5 + Math.random() * 3.5, vz: (dz + pz * lat) * sp, life: 0.7, max: 0.7, g: 16, s: sz, stain: Math.random() < 0.35 });
    }
  }

  // Mancha de sangue persistente no chão
  decal(x, z, size = 1.2) {
    const mats = splats();
    const mesh = new THREE.Mesh(decalGeo, mats[(Math.random() * mats.length) | 0]);
    mesh.rotation.x = -Math.PI / 2;
    mesh.rotation.z = Math.random() * Math.PI * 2;
    mesh.position.set(x, 0.025 + Math.random() * 0.01, z);
    mesh.scale.setScalar(size * (0.7 + Math.random() * 0.6));
    mesh.renderOrder = 1;
    this.scene.add(mesh);
    this.decals.push(mesh);
    if (this.decals.length > 180) this.scene.remove(this.decals.shift());
  }

  // Objeto arremessado com física simples (ex.: cabeça decepada)
  debris(obj, vx, vy, vz, spin = 8, life = 2.6) {
    this.debrisList.push({ obj, vx, vy, vz, sx: (Math.random() - 0.5) * spin, sz: (Math.random() - 0.5) * spin, life, bounced: 0 });
  }

  // Emissor contínuo de sangue preso a um objeto (pescoço)
  emitter(obj, offset, life = 0.9, color = 0x7a0d0d) {
    this.emitters.push({ obj, offset, life, color, acc: 0 });
  }
  sparks(x, y, z) { this.particles(x, y, z, 5, 0xffd27a, 6, 0.25, 0.6, 6); }

  tracer(x1, y, z1, x2, z2, color = 0xffe08a) {
    const mesh = new THREE.Mesh(tracerGeo, basic(color, true, 0.9));
    const dx = x2 - x1, dz = z2 - z1, len = Math.hypot(dx, dz);
    mesh.position.set((x1 + x2) / 2, y, (z1 + z2) / 2);
    mesh.scale.set(1, 1, len);
    mesh.rotation.y = Math.atan2(dx, dz);
    this.scene.add(mesh);
    this.fx.push({ mesh, t: 0, life: 0.06, kind: 'fade', base: 0.9 });
  }

  muzzle(x, y, z) {
    this.flash.position.set(x, y + 0.3, z);
    this.flash.color.setHex(0xffb060);
    this.flash.intensity = 8;
    this.flashT = 0.05;
    const mesh = new THREE.Mesh(sphereGeo, basic(0xffd08a, true, 0.9));
    mesh.position.set(x, y, z);
    mesh.scale.setScalar(0.18);
    this.scene.add(mesh);
    this.fx.push({ mesh, t: 0, life: 0.05, kind: 'fade', base: 0.9 });
  }

  slash(x, z, angle, arc, reach, color = 0xe8f4ff) {
    const geo = new THREE.RingGeometry(reach * 0.35, reach, 24, 1, 0, arc);
    const mesh = new THREE.Mesh(geo, basic(color, true, 0.75));
    mesh.rotation.x = -Math.PI / 2;
    // Ring começa no eixo +X local; após rotação x, ângulo local θ vira direção (cosθ, -sinθ).
    // Direção de mira (sin a, cos a) => θ = a - π/2. Centraliza o arco nela.
    mesh.rotation.z = angle - Math.PI / 2 - arc / 2;
    mesh.position.set(x, 1.0, z);
    this.scene.add(mesh);
    this.fx.push({ mesh, t: 0, life: 0.16, kind: 'fade', base: 0.75, ownGeo: true, grow: 0.15 });
    const edgeGeo = new THREE.RingGeometry(reach * 0.92, reach * 1.02, 28, 1, 0, arc);
    const edge = new THREE.Mesh(edgeGeo, basic(0xffffff, true, 0.95));
    edge.rotation.copy(mesh.rotation); edge.position.copy(mesh.position); edge.position.y += 0.02;
    this.scene.add(edge);
    this.fx.push({ mesh: edge, t: 0, life: 0.11, kind: 'fade', base: 0.95, ownGeo: true, grow: 0.08 });
  }

  explosion(x, z, radius, color = 0xff7a2a) {
    const mesh = new THREE.Mesh(sphereGeo, basic(color, true, 0.8));
    mesh.position.set(x, 0.6, z);
    mesh.scale.setScalar(0.3);
    this.scene.add(mesh);
    this.fx.push({ mesh, t: 0, life: 0.35, kind: 'boom', radius, base: 0.8 });
    this.shock(x, z, radius, color);
    this.particles(x, 0.6, z, 22, 0x3a3a3a, 7, 0.9, 2.2, 6);
    this.particles(x, 0.6, z, 14, color, 9, 0.4, 1.2, 4);
    this.flash.position.set(x, 2.5, z);
    this.flash.color.setHex(color);
    this.flash.intensity = 40;
    this.flashT = 0.2;
  }

  shock(x, z, radius, color = 0xffffff) {
    const mesh = new THREE.Mesh(ringGeo, basic(color, true, 0.9));
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(x, 0.12, z);
    mesh.scale.setScalar(0.2);
    this.scene.add(mesh);
    this.fx.push({ mesh, t: 0, life: 0.3, kind: 'ring', radius, base: 0.9 });
  }

  // Círculo de aviso no chão (habilidades de boss / granada)
  telegraphCircle(x, z, radius, dur, color = 0xff2020) {
    const g = new THREE.Group();
    g.position.set(x, 0.08, z);
    const outer = new THREE.Mesh(circleGeo, basic(color, false, 0.18));
    outer.rotation.x = -Math.PI / 2; outer.scale.setScalar(radius);
    const edge = new THREE.Mesh(ringGeo, basic(color, true, 0.7));
    edge.rotation.x = -Math.PI / 2; edge.scale.setScalar(radius);
    const inner = new THREE.Mesh(circleGeo, basic(color, false, 0.3));
    inner.rotation.x = -Math.PI / 2; inner.scale.setScalar(0.01); inner.position.y = 0.01;
    g.add(outer, edge, inner);
    this.scene.add(g);
    const fx = { mesh: g, inner, t: 0, life: dur, kind: 'tele', radius };
    this.fx.push(fx);
    return fx;
  }

  telegraphLine(x, z, angle, len, width, dur, color = 0xff2020) {
    const g = new THREE.Group();
    g.position.set(x, 0.08, z);
    g.rotation.y = angle;
    const rect = new THREE.Mesh(planeGeo, basic(color, false, 0.22));
    rect.rotation.x = -Math.PI / 2;
    rect.scale.set(width, len, 1);
    rect.position.z = len / 2;
    const inner = new THREE.Mesh(planeGeo, basic(color, false, 0.35));
    inner.rotation.x = -Math.PI / 2;
    inner.scale.set(width, 0.01, 1);
    inner.position.y = 0.01;
    g.add(rect, inner);
    this.scene.add(g);
    const fx = { mesh: g, inner, t: 0, life: dur, kind: 'teleLine', len };
    this.fx.push(fx);
    return fx;
  }

  beam(x, z, color, life = 0.6) {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, 14, 12, 1, true), basic(color, true, 0.5));
    mesh.position.set(x, 7, z);
    this.scene.add(mesh);
    this.fx.push({ mesh, t: 0, life, kind: 'fade', base: 0.5, ownGeo: true });
  }

  number(x, y, z, text, color = '#fff', size = 16) {
    this.numbers.push({ x, y, z, text: String(text), color, size, t: 0, life: 0.8, ox: (Math.random() - 0.5) * 0.6 });
  }

  update(dt) {
    for (let i = this.parts.length - 1; i >= 0; i--) {
      const p = this.parts[i];
      p.life -= dt;
      p.vy -= p.g * dt;
      p.mesh.position.x += p.vx * dt;
      p.mesh.position.y += p.vy * dt;
      p.mesh.position.z += p.vz * dt;
      if (p.mesh.position.y < 0.05) {
        if (p.stain) { p.stain = false; this.decal(p.mesh.position.x, p.mesh.position.z, 0.35 + Math.random() * 0.35); }
        p.mesh.position.y = 0.05; p.vx *= 0.6; p.vz *= 0.6; p.vy = 0;
      }
      p.mesh.scale.setScalar(p.s * Math.max(0.1, p.life / p.max));
      if (p.life <= 0) { this.scene.remove(p.mesh); this.parts.splice(i, 1); }
    }
    for (let i = this.fx.length - 1; i >= 0; i--) {
      const f = this.fx[i];
      f.t += dt;
      const k = Math.min(1, f.t / f.life);
      if (f.kind === 'fade') {
        f.mesh.material = f.mesh.material; // compartilhado
        f.mesh.visible = true;
        if (f.grow) f.mesh.scale.setScalar(1 + k * f.grow);
        setOpacity(f, f.base * (1 - k));
      } else if (f.kind === 'boom') {
        f.mesh.scale.setScalar(0.3 + f.radius * k);
        setOpacity(f, f.base * (1 - k));
      } else if (f.kind === 'ring') {
        f.mesh.scale.setScalar(0.2 + f.radius * k);
        setOpacity(f, f.base * (1 - k));
      } else if (f.kind === 'tele') {
        f.inner.scale.setScalar(Math.max(0.01, f.radius * k));
      } else if (f.kind === 'teleLine') {
        f.inner.scale.y = Math.max(0.01, f.len * k);
        f.inner.position.z = (f.len * k) / 2;
      }
      if (f.t >= f.life || f.dead) {
        this.scene.remove(f.mesh);
        if (f.ownGeo) f.mesh.geometry.dispose();
        if (f.ownMat) f.mesh.material.dispose();
        this.fx.splice(i, 1);
      }
    }
    for (let i = this.debrisList.length - 1; i >= 0; i--) {
      const d = this.debrisList[i], o = d.obj;
      d.life -= dt;
      d.vy -= 18 * dt;
      o.position.x += d.vx * dt; o.position.y += d.vy * dt; o.position.z += d.vz * dt;
      o.rotation.x += d.sx * dt; o.rotation.z += d.sz * dt;
      if (o.position.y < 0.12) {
        o.position.y = 0.12;
        if (d.bounced < 2 && d.vy < -2) { d.vy = -d.vy * 0.35; d.bounced++; this.decal(o.position.x, o.position.z, 0.6); }
        else d.vy = 0;
        d.vx *= 0.6; d.vz *= 0.6; d.sx *= 0.6; d.sz *= 0.6;
      }
      if (d.life <= 0) { o.parent && o.parent.remove(o); this.debrisList.splice(i, 1); }
    }
    const _w = new THREE.Vector3();
    for (let i = this.emitters.length - 1; i >= 0; i--) {
      const e = this.emitters[i];
      e.life -= dt; e.acc += dt;
      if (e.acc > 0.04) {
        e.acc = 0;
        _w.copy(e.offset); e.obj.localToWorld(_w);
        this.particles(_w.x, _w.y, _w.z, 2, e.color, 3.2, 0.5, 0.9, 12);
      }
      if (e.life <= 0) this.emitters.splice(i, 1);
    }
    for (let i = this.numbers.length - 1; i >= 0; i--) {
      const n = this.numbers[i];
      n.t += dt;
      if (n.t > n.life) this.numbers.splice(i, 1);
    }
    if (this.flashT > 0) { this.flashT -= dt; if (this.flashT <= 0) this.flash.intensity = 0; }
  }

  clear() {
    for (const d of this.decals) this.scene.remove(d);
    for (const d of this.debrisList) d.obj.parent && d.obj.parent.remove(d.obj);
    this.decals = []; this.debrisList = []; this.emitters = [];
    for (const p of this.parts) this.scene.remove(p.mesh);
    for (const f of this.fx) this.scene.remove(f.mesh);
    this.parts = []; this.fx = []; this.numbers = [];
  }
}

// Opacidade individual: clona o material na primeira alteração.
function setOpacity(f, o) {
  if (!f.ownMat) { f.mesh.material = f.mesh.material.clone(); f.ownMat = true; }
  f.mesh.material.opacity = Math.max(0, o);
}
