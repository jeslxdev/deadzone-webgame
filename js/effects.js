// ============================================================
//  EFEITOS — partículas, traçantes, cortes, explosões,
//  avisos de habilidades (telegraph) e números de dano.
// ============================================================
import * as THREE from 'three';

const pGeo = new THREE.BoxGeometry(0.12, 0.12, 0.12);
const tracerGeo = new THREE.BoxGeometry(0.05, 0.05, 1);
const sphereGeo = new THREE.SphereGeometry(1, 16, 12);
const cubeGeo = new THREE.BoxGeometry(1, 1, 1);
// clarão de disparo em blocos: núcleo + 3 barras cruzadas (uma "estrela" quadrada)
const flashGeo = [new THREE.BoxGeometry(0.9, 0.9, 0.9), new THREE.BoxGeometry(2.6, 0.32, 0.32), new THREE.BoxGeometry(0.32, 2.2, 0.32), new THREE.BoxGeometry(0.32, 0.32, 2.6)];
const circleGeo = new THREE.CircleGeometry(1, 40);
const ringGeo = new THREE.RingGeometry(0.92, 1, 48);
const ringBlockGeo = new THREE.RingGeometry(0.86, 1, 8); // onda de choque low-poly (octógono)
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

// Texturas de poça/respingo de sangue em PIXEL ART (estilo blocos):
// 32×32 px com filtro "nearest" — bordas em degraus, gotas quadradas, escorridos retos.
function pixelCanvas(n) { const c = document.createElement('canvas'); c.width = c.height = n; return c; }
function pixTex(c) {
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter; t.generateMipmaps = false;
  return t;
}
let splatMats = null;
function splats() {
  if (splatMats) return splatMats;
  splatMats = [];
  for (let v = 0; v < 5; v++) {
    const N = 32, c = pixelCanvas(N), g = c.getContext('2d');
    const col = (k, a = 1) => `rgba(${(70 + Math.random() * 30) * k | 0},${(6 + Math.random() * 8) * k | 0},${(8 + Math.random() * 6) * k | 0},${a})`;
    const rx = 5 + Math.random() * 3, ry = 4 + Math.random() * 3;
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) { // poça central irregular, pixel a pixel
      const dx = (x - 16) / rx, dy = (y - 16) / ry, d = dx * dx + dy * dy + (Math.random() - 0.5) * 0.5;
      if (d < 1) { g.fillStyle = col(d < 0.35 ? 0.75 : 1, 0.92); g.fillRect(x, y, 1, 1); }
    }
    for (let i = 0; i < 12; i++) { // gotas quadradas ao redor
      const a = Math.random() * Math.PI * 2, d = 7 + Math.random() * 8, sz = Math.random() < 0.3 ? 2 : 1;
      g.fillStyle = col(1, 0.85); g.fillRect(Math.round(16 + Math.cos(a) * d), Math.round(16 + Math.sin(a) * d), sz, sz);
    }
    for (let i = 0; i < 3; i++) { // escorridos retos
      const a = Math.floor(Math.random() * 4) * Math.PI / 2, len = 4 + Math.random() * 6;
      g.fillStyle = col(0.85, 0.85);
      for (let k = 0; k < len; k++) g.fillRect(Math.round(16 + Math.cos(a) * (rx + k)), Math.round(16 + Math.sin(a) * (ry + k)), 1, 1);
    }
    g.fillStyle = 'rgba(160,40,40,0.5)'; g.fillRect(14, 14, 2, 1); // brilho úmido
    splatMats.push(new THREE.MeshBasicMaterial({ map: pixTex(c), transparent: true, alphaTest: 0.05, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }));
  }
  return splatMats;
}
const decalGeo = new THREE.PlaneGeometry(1, 1);

// Rachadura no chão (impactos pesados), em pixel art: linhas em degraus a partir do centro
let crackMat = null;
function crackMaterial() {
  if (crackMat) return crackMat;
  const N = 48, c = pixelCanvas(N), g = c.getContext('2d');
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) { // mancha escura de impacto
    const d = Math.hypot(x - 24, y - 24) / 13 + (Math.random() - 0.5) * 0.35;
    if (d < 1) { g.fillStyle = `rgba(18,14,12,${(0.75 * (1 - d)).toFixed(2)})`; g.fillRect(x, y, 1, 1); }
  }
  g.fillStyle = 'rgba(10,8,6,0.95)';
  for (let i = 0; i < 8; i++) {
    let a = (i / 8) * Math.PI * 2 + Math.random() * 0.5, x = 24, y = 24, w = 2;
    for (let k = 0; k < 20; k++) {
      if (k % 4 === 0) a += (Math.random() - 0.5) * 0.9;
      x += Math.cos(a); y += Math.sin(a);
      g.fillRect(Math.round(x), Math.round(y), w, w);
      if (k === 8) w = 1;
    }
  }
  for (let i = 0; i < 14; i++) { g.fillStyle = 'rgba(120,110,100,0.6)'; g.fillRect(16 + Math.random() * 16 | 0, 16 + Math.random() * 16 | 0, 1, 1); } // lascas
  crackMat = new THREE.MeshBasicMaterial({ map: pixTex(c), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3 });
  return crackMat;
}

// ============================================================
//  Rastro da lâmina: fita que segue a ponta da arma e se desfaz
//  (estilo hack-and-slash). A forma do rastro mostra o golpe:
//  diagonal, ascendente, giro, estocada, golpe descendente.
// ============================================================
export class SwordTrail {
  constructor(scene, n = 18, life = 0.16) {
    this.n = n; this.life = life;
    this.samples = [];
    const pos = new Float32Array(n * 2 * 3), col = new Float32Array(n * 2 * 3);
    const idx = [];
    for (let i = 0; i < n - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    this.geo.setIndex(idx);
    this.mat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false });
    this.mesh = new THREE.Mesh(this.geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 4;
    this.mesh.visible = false;
    scene.add(this.mesh);
    this.scene = scene;
    this.color = new THREE.Color();
  }
  // base/ponta em coordenadas de mundo; active = a lâmina está cortando agora
  update(dt, base, tip, active, colorHex = 0xdff2ff) {
    for (const s of this.samples) s.age += dt;
    while (this.samples.length && this.samples[this.samples.length - 1].age > this.life) this.samples.pop();
    if (active) {
      this.samples.unshift({ b: base.clone(), t: tip.clone(), age: 0 });
      if (this.samples.length > this.n) this.samples.length = this.n;
    }
    const m = this.samples.length;
    this.mesh.visible = m >= 2;
    if (m < 2) return;
    this.color.setHex(colorHex);
    const pos = this.geo.attributes.position.array, col = this.geo.attributes.color.array;
    for (let i = 0; i < m; i++) {
      const s = this.samples[i], k = 1 - s.age / this.life, a = Math.max(0, k) ** 1.4;
      pos.set([s.b.x, s.b.y, s.b.z, s.t.x, s.t.y, s.t.z], i * 6);
      const cb = a * 0.12, ct = a; // base quase invisível, ponta brilhante
      col.set([this.color.r * cb, this.color.g * cb, this.color.b * cb, this.color.r * ct, this.color.g * ct, this.color.b * ct], i * 6);
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.color.needsUpdate = true;
    this.geo.setDrawRange(0, (m - 1) * 6);
  }
  dispose() { this.scene.remove(this.mesh); this.geo.dispose(); this.mat.dispose(); }
}

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

  muzzle(x, y, z, size = 1) {
    this.flash.position.set(x, y + 0.3, z);
    this.flash.color.setHex(0xffb060);
    this.flash.intensity = 8 * Math.min(2, size);
    this.flashT = 0.05;
    // clarão em blocos (girado ao acaso para variar a forma a cada tiro)
    const m = basic(0xffd08a, true, 0.95);
    for (const pg of flashGeo) {
      const mesh = new THREE.Mesh(pg, m);
      mesh.position.set(x, y, z);
      mesh.rotation.set(Math.random() * 0.6, Math.random() * Math.PI, Math.random() * 0.6);
      mesh.scale.setScalar(0.12 * size);
      this.scene.add(mesh);
      this.fx.push({ mesh, t: 0, life: 0.05, kind: 'fade', base: 0.95 });
    }
  }

  // Cápsula de munição ejetada para a direita da arma, quica no chão
  casing(x, y, z, facing, color = 0xc9a24a) {
    const mesh = new THREE.Mesh(pGeo, basic(color, false, 1));
    mesh.position.set(x, y, z);
    const rx = -Math.cos(facing), rz = Math.sin(facing); // direita do personagem
    const sp = 2.2 + Math.random() * 1.2;
    this.scene.add(mesh);
    this.parts.push({ mesh, vx: rx * sp + (Math.random() - 0.5), vy: 2.5 + Math.random() * 1.5, vz: rz * sp + (Math.random() - 0.5), life: 0.9, max: 0.9, s: 0.32, g: 16 });
  }
  // Rastro reto de estocada / tiro pesado
  streak(x, y, z, angle, len, color = 0xffffff, width = 0.12, life = 0.16) {
    const mesh = new THREE.Mesh(tracerGeo, basic(color, true, 0.95));
    mesh.position.set(x + Math.sin(angle) * len / 2, y, z + Math.cos(angle) * len / 2);
    mesh.scale.set(width / 0.05, width / 0.05 * 0.4, len);
    mesh.rotation.y = angle;
    this.scene.add(mesh);
    this.fx.push({ mesh, t: 0, life, kind: 'fade', base: 0.95 });
  }
  // Rachadura no chão após impacto pesado (some em alguns segundos)
  crack(x, z, size = 3) {
    const mesh = new THREE.Mesh(decalGeo, crackMaterial());
    mesh.rotation.x = -Math.PI / 2; mesh.rotation.z = Math.random() * 6.28;
    mesh.position.set(x, 0.03, z);
    mesh.scale.set(size, size, 1);
    this.scene.add(mesh);
    this.fx.push({ mesh, t: 0, life: 3.5, kind: 'fade', base: 1 });
  }
  makeTrail() { return new SwordTrail(this.scene); }

  slash(x, z, angle, arc, reach, color = 0xe8f4ff, y = 1.0, strength = 1) {
    const geo = new THREE.RingGeometry(reach * 0.35, reach, 24, 1, 0, arc);
    const mesh = new THREE.Mesh(geo, basic(color, true, 0.75 * strength));
    mesh.rotation.x = -Math.PI / 2;
    // Ring começa no eixo +X local; após rotação x, ângulo local θ vira direção (cosθ, -sinθ).
    // Direção de mira (sin a, cos a) => θ = a - π/2. Centraliza o arco nela.
    mesh.rotation.z = angle - Math.PI / 2 - arc / 2;
    mesh.position.set(x, y, z);
    this.scene.add(mesh);
    this.fx.push({ mesh, t: 0, life: 0.16, kind: 'fade', base: 0.75 * strength, ownGeo: true, grow: 0.15 });
    const edgeGeo = new THREE.RingGeometry(reach * 0.92, reach * 1.02, 28, 1, 0, arc);
    const edge = new THREE.Mesh(edgeGeo, basic(0xffffff, true, 0.95 * Math.min(1, strength * 1.5)));
    edge.rotation.copy(mesh.rotation); edge.position.copy(mesh.position); edge.position.y += 0.02;
    this.scene.add(edge);
    this.fx.push({ mesh: edge, t: 0, life: 0.11, kind: 'fade', base: 0.95 * Math.min(1, strength * 1.5), ownGeo: true, grow: 0.08 });
  }

  explosion(x, z, radius, color = 0xff7a2a) {
    // bola de fogo em blocos: dois cubos girados (núcleo claro + casca colorida)
    for (const [c, k, rot] of [[color, 1, 0], [0xffe0a0, 0.6, 0.78]]) {
      const mesh = new THREE.Mesh(cubeGeo, basic(c, true, 0.85));
      mesh.position.set(x, 0.7, z);
      mesh.rotation.set(rot, rot * 0.7 + Math.random(), rot * 0.4);
      mesh.scale.setScalar(0.3 * k);
      this.scene.add(mesh);
      this.fx.push({ mesh, t: 0, life: 0.2, kind: 'boom', radius: radius * 0.4 * k, base: 0.85 }); // clarão rápido
    }
    this.particles(x, 0.7, z, 18, 0xffa040, radius * 2.2, 0.45, 2.4, 2); // labaredas em blocos
    this.particles(x, 0.7, z, 8, 0xffe0a0, radius * 1.6, 0.3, 1.6, 1);
    this.shock(x, z, radius, color);
    this.particles(x, 0.6, z, 16, 0x3a3a3a, 7, 0.9, 2.2, 6); // entulho
    this.particles(x, 0.6, z, 14, color, 9, 0.4, 1.4, 4); // fagulhas
    this.particles(x, 0.9, z, 10, 0x4a4642, 1.6, 1.6, 3.6, -1.2); // fumaça em cubos subindo devagar
    this.flash.position.set(x, 2.5, z);
    this.flash.color.setHex(color);
    this.flash.intensity = 40;
    this.flashT = 0.2;
  }

  shock(x, z, radius, color = 0xffffff) {
    const mesh = new THREE.Mesh(ringBlockGeo, basic(color, true, 0.9));
    mesh.rotation.x = -Math.PI / 2; mesh.rotation.z = Math.PI / 8;
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
