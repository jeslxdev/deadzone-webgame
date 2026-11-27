// ============================================================
//  NINHOS DE ZUMBI (pontos de spawn) e COLMEIA MÃE — blocos + pixel art
//  Inspirado num "spawner": gaiola de ferro vazada com um coração de
//  carne pulsando dentro, olhos e veias brilhantes, pedestal de pedra
//  corrompida, tentáculos segmentados com garra de osso, ovos (alguns
//  chocados), caveiras, ossos, esporos flutuando e chão de "creep".
//
//  API compatível com o mundo/jogo:
//    nestMesh(mother) -> { g, core, veins, flesh }
//      core  : malha que pulsa (escala y = 1,25) e murcha ao morrer
//      veins : grupo dos detalhes brilhantes (olhos, veias, esporos) — some ao morrer
//      flesh : material da carne (o jogo escurece ao destruir)
//    motherSpire(h, rnd) -> THREE.Group (pilares em volta da colmeia mãe)
// ============================================================
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mulberry32 } from './util.js';

// ---------- pintor de pixel art (cor + camada de brilho) ----------
class Pix {
  constructor(w, h, seed, alpha = false) {
    this.w = w; this.h = h; this.r = mulberry32(seed);
    const mk = () => { const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d'); return { c, g, img: g.createImageData(w, h) }; };
    this.base = mk(); this.glow = mk();
    const d = this.base.img.data;
    for (let i = 3; i < d.length; i += 4) d[i] = alpha ? 0 : 255;
    const gd = this.glow.img.data;
    for (let i = 3; i < gd.length; i += 4) gd[i] = 255;
  }
  idx(x, y) { x = ((x % this.w) + this.w) % this.w; y = ((y % this.h) + this.h) % this.h; return (y * this.w + x) * 4; }
  p(x, y, c, glow = null) {
    const i = this.idx(x, y), d = this.base.img.data;
    d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; d[i + 3] = 255;
    const g = this.glow.img.data, gc = glow || [0, 0, 0];
    g[i] = gc[0]; g[i + 1] = gc[1]; g[i + 2] = gc[2];
  }
  rect(x, y, w, h, c, noise = 0, glow = null) { for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) this.p(i, j, noise ? sh(c, 1 + (this.r() - 0.5) * 2 * noise) : c, glow); }
  speck(c, n, x = 0, y = 0, w = this.w, h = this.h, glow = null) { for (let i = 0; i < n; i++) this.p(x + ((this.r() * w) | 0), y + ((this.r() * h) | 0), c, glow); }
  // caminho aleatório (veias, rachaduras)
  walk(x, y, n, c, glow, dir = null) {
    for (let k = 0; k < n; k++) {
      this.p(x, y, c, glow);
      if (dir) { x += Math.round(dir[0] + (this.r() - 0.5) * 1.4); y += Math.round(dir[1] + (this.r() - 0.5) * 1.4); }
      else if (this.r() < 0.5) x += this.r() < 0.5 ? 1 : -1; else y += this.r() < 0.5 ? 1 : -1;
    }
  }
  tex(which = 'base') {
    const L = this[which];
    L.g.putImageData(L.img, 0, 0);
    const t = new THREE.CanvasTexture(L.c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestMipmapLinearFilter;
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4;
    return t;
  }
}
const sh = (c, k) => c.map((v) => Math.max(0, Math.min(255, (v * k) | 0)));
const VEIN = [196, 72, 255], VEIN_G = [210, 90, 255];

// ---------- texturas ----------
let TX = null;
function textures() {
  if (TX) return TX;
  TX = {};
  // carne do coração: fibras diagonais, poros, rede de veias e pústulas (veias/pústulas brilham)
  {
    const P = new Pix(32, 32, 9101);
    P.rect(0, 0, 32, 32, [104, 26, 56], 0.1);
    for (let i = -32; i < 32; i += 4) for (let k = 0; k < 32; k++) if (P.r() < 0.8) P.p(i + k, k, [126, 36, 66]); // fibras
    P.speck([62, 12, 34], 40);
    for (let i = 0; i < 7; i++) P.walk((P.r() * 32) | 0, (P.r() * 32) | 0, 18, VEIN, VEIN_G);
    for (let i = 0; i < 5; i++) { const x = (P.r() * 30) | 0, y = (P.r() * 30) | 0; P.rect(x, y, 2, 2, [170, 200, 70], 0, [90, 120, 20]); P.p(x, y, [235, 255, 160], [160, 200, 60]); }
    TX.flesh = P.tex(); TX.fleshGlow = P.tex('glow');
  }
  // gaiola de ferro vazada (estilo spawner): moldura + grade 3×3, rebites, ferrugem
  {
    const P = new Pix(16, 16, 9202, true);
    const I = [44, 42, 50], HI = [96, 92, 104], LO = [24, 22, 28];
    for (const k of [0, 15]) for (let t = 0; t < 16; t++) { P.p(t, k, k ? LO : HI); P.p(k, t, k ? LO : HI); }
    for (const k of [5, 10]) for (let t = 1; t < 15; t++) { P.p(k, t, I); P.p(t, k, I); }
    for (const [x, y] of [[0, 0], [15, 0], [0, 15], [15, 15], [5, 5], [10, 5], [5, 10], [10, 10]]) P.p(x, y, [130, 124, 132]);
    for (let i = 0; i < 9; i++) { const k = [0, 5, 10, 15][(P.r() * 4) | 0], t = (P.r() * 16) | 0; P.r() < 0.5 ? P.p(k, t, [110, 58, 32]) : P.p(t, k, [110, 58, 32]); }
    TX.cage = P.tex();
  }
  // pedra corrompida do pedestal: tijolos escuros, rejunte e rachaduras roxas brilhando
  {
    const P = new Pix(16, 16, 9303);
    for (let row = 0; row < 4; row++) {
      const off = row % 2 ? 4 : 0;
      for (let b = 0; b < 3; b++) P.rect(((b * 8 + off) % 16), row * 4, 8, 4, sh([48, 42, 56], 0.85 + P.r() * 0.3), 0.08);
      P.rect(0, row * 4 + 3, 16, 1, [26, 22, 30]);
      for (let b = 0; b < 2; b++) P.rect((b * 8 + off) % 16, row * 4, 1, 3, [26, 22, 30]);
    }
    for (let i = 0; i < 3; i++) P.walk((P.r() * 16) | 0, (P.r() * 16) | 0, 7, [150, 50, 210], [170, 60, 240]);
    P.speck([78, 70, 86], 10);
    TX.stone = P.tex(); TX.stoneGlow = P.tex('glow');
  }
  // osso: marfim com sombra na base e trincas
  {
    const P = new Pix(8, 8, 9404);
    P.rect(0, 0, 8, 8, [214, 204, 176], 0.05);
    P.rect(0, 6, 8, 2, [168, 156, 128], 0.05);
    P.p(2, 2, [150, 140, 116]); P.p(3, 3, [150, 140, 116]); P.p(5, 1, [236, 230, 210]);
    TX.bone = P.tex();
  }
  // rosto de caveira (placa frontal)
  {
    const P = new Pix(8, 8, 9505);
    P.rect(0, 0, 8, 8, [214, 204, 176], 0.05);
    P.rect(1, 2, 2, 2, [24, 18, 20]); P.rect(5, 2, 2, 2, [24, 18, 20]);
    P.p(2, 3, [150, 60, 220], [150, 60, 220]); P.p(5, 3, [150, 60, 220], [150, 60, 220]);
    P.p(3, 4, [60, 50, 46]); P.p(4, 4, [60, 50, 46]);
    for (let x = 1; x < 7; x++) P.p(x, 6, x % 2 ? [236, 230, 210] : [70, 60, 54]);
    P.rect(0, 7, 8, 1, [150, 140, 116]);
    TX.skull = P.tex(); TX.skullGlow = P.tex('glow');
  }
  // ovo: membrana translúcida com veias e embrião escuro encolhido (brilho fraco no centro)
  {
    const P = new Pix(8, 8, 9606);
    P.rect(0, 0, 8, 8, [112, 70, 112], 0.08);
    P.rect(0, 6, 8, 2, [78, 44, 80], 0.08); // base em sombra
    P.rect(2, 2, 4, 4, [70, 30, 74]); P.rect(3, 2, 2, 4, [120, 40, 150], 0, [150, 50, 200]); P.p(4, 3, [210, 120, 255], [220, 130, 255]); // embrião brilhando
    P.p(1, 1, [190, 160, 200]); P.p(2, 1, [190, 160, 200]); // reflexo úmido
    P.p(6, 2, [150, 60, 190], [90, 30, 120]); P.p(6, 3, [150, 60, 190], [90, 30, 120]); P.p(1, 4, [150, 60, 190], [90, 30, 120]); // veias
    TX.egg = P.tex(); TX.eggGlow = P.tex('glow');
  }
  // olho: esclera amarelada, íris roxa, pupila em fenda e reflexo
  {
    const P = new Pix(8, 8, 9707);
    P.rect(0, 0, 8, 8, [120, 30, 60]);
    P.rect(1, 1, 6, 6, [236, 214, 130]); P.rect(0, 2, 8, 4, [236, 214, 130]);
    P.rect(2, 2, 4, 4, [170, 60, 230]); P.rect(3, 2, 2, 4, [110, 20, 170]);
    P.rect(3, 2, 1, 4, [10, 6, 12]); P.rect(4, 3, 1, 2, [10, 6, 12]);
    P.p(2, 2, [255, 255, 255]);
    P.p(1, 1, [190, 60, 60]); P.p(6, 6, [190, 60, 60]);
    TX.eye = P.tex();
  }
  // creep no chão: mancha de biomassa com borda em degraus, veias radiais e pústulas
  {
    const N = 64, P = new Pix(N, N, 9808, true);
    const noise = new Float32Array((N / 2) * (N / 2)).map(() => P.r());
    for (let by = 0; by < N / 2; by++) for (let bx = 0; bx < N / 2; bx++) {
      const dx = bx - N / 4 + 0.5, dz = by - N / 4 + 0.5, d = Math.hypot(dx, dz) / (N / 4) + (noise[by * (N / 2) + bx] - 0.5) * 0.28;
      if (d > 0.96) continue;
      const k = 0.75 + d * 0.4 + (P.r() - 0.5) * 0.15;
      for (let j = 0; j < 2; j++) for (let i = 0; i < 2; i++) P.p(bx * 2 + i, by * 2 + j, sh([62, 18, 60], k));
    }
    const C = N / 2;
    for (let i = 0; i < 11; i++) {
      const a = (i / 11) * Math.PI * 2 + P.r() * 0.4;
      P.walk(C, C, 12 + ((P.r() * 14) | 0), [150, 54, 200], [150, 50, 210], [Math.cos(a), Math.sin(a)]);
    }
    for (let i = 0; i < 16; i++) {
      const a = P.r() * Math.PI * 2, rr = 5 + P.r() * 18, x = (C + Math.cos(a) * rr) | 0, y = (C + Math.sin(a) * rr) | 0;
      P.p(x, y, [190, 210, 90], [80, 100, 20]);
    }
    TX.creep = P.tex(); TX.creepGlow = P.tex('glow');
  }
  return TX;
}

// ---------- materiais compartilhados (a carne é por ninho: o jogo a altera ao destruir) ----------
let MT = null;
function materials() {
  if (MT) return MT;
  const T = textures();
  const std = (o) => new THREE.MeshStandardMaterial({ roughness: 0.8, metalness: 0.05, ...o });
  MT = {
    cage: std({ map: T.cage, alphaTest: 0.5, side: THREE.DoubleSide, metalness: 0.6, roughness: 0.45 }),
    iron: std({ color: 0x2e2c34, metalness: 0.6, roughness: 0.45 }),
    stone: std({ map: T.stone, emissive: 0xffffff, emissiveMap: T.stoneGlow, emissiveIntensity: 0.55 }),
    bone: std({ map: T.bone, roughness: 0.7 }),
    skull: std({ map: T.skull, emissive: 0xffffff, emissiveMap: T.skullGlow, emissiveIntensity: 1 }),
    egg: std({ map: T.egg, emissive: 0xffffff, emissiveMap: T.eggGlow, emissiveIntensity: 1.1, roughness: 0.4 }),
    slime: std({ color: 0x4a1450, roughness: 0.2, emissive: 0x3a0a50, emissiveIntensity: 0.5 }),
    creep: std({ map: T.creep, alphaTest: 0.5, emissive: 0xffffff, emissiveMap: T.creepGlow, emissiveIntensity: 0.7, roughness: 0.35, polygonOffset: true, polygonOffsetFactor: -1 }),
    eye: new THREE.MeshBasicMaterial({ map: T.eye }),
    vein: new THREE.MeshBasicMaterial({ color: 0xd060ff }),
    spore: new THREE.MeshBasicMaterial({ color: 0xe6a8ff, transparent: true, opacity: 0.85, depthWrite: false }),
    shield: new THREE.MeshStandardMaterial({ color: 0xa040ff, emissive: 0x7020c0, emissiveIntensity: 0.6, flatShading: true, transparent: true, opacity: 0.18, depthWrite: false, side: THREE.DoubleSide }),
  };
  return MT;
}
export function fleshMaterial() {
  const T = textures();
  return new THREE.MeshStandardMaterial({ map: T.flesh, roughness: 0.55, metalness: 0.05, emissive: 0xffffff, emissiveMap: T.fleshGlow, emissiveIntensity: 0.4 });
}
// escudo facetado da colmeia mãe (substitui a esfera lisa)
export function shieldMesh(radius) {
  return new THREE.Mesh(new THREE.IcosahedronGeometry(radius, 1), materials().shield.clone());
}

// ---------- montagem por material (funde peças estáticas = poucas draw calls) ----------
const _q = new THREE.Quaternion(), _m4 = new THREE.Matrix4(), _d = new THREE.Vector3(), ZAX = new THREE.Vector3(0, 0, 1);
class Kit {
  constructor() { this.parts = new Map(); }
  add(mat, g) { let a = this.parts.get(mat); if (!a) this.parts.set(mat, (a = [])); a.push(g); }
  box(mat, w, h, d, x, y, z, rx = 0, ry = 0, rz = 0) {
    const g = new THREE.BoxGeometry(w, h, d);
    if (rx) g.rotateX(rx); if (rz) g.rotateZ(rz); if (ry) g.rotateY(ry);
    g.translate(x, y, z); this.add(mat, g);
  }
  // cubo orientado de a até b (segmentos de tentáculo, ossos, espinhos)
  link(mat, ax, ay, az, bx, by, bz, t) {
    _d.set(bx - ax, by - ay, bz - az);
    const g = new THREE.BoxGeometry(t, t, _d.length());
    _q.setFromUnitVectors(ZAX, _d.normalize());
    g.applyMatrix4(_m4.makeRotationFromQuaternion(_q));
    g.translate((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2); this.add(mat, g);
  }
  build(parent, shadows = true) {
    for (const [mat, geos] of this.parts) {
      const g = mergeGeometries(geos); geos.forEach((x) => x.dispose());
      const m = new THREE.Mesh(g, mat);
      m.castShadow = shadows && mat.alphaTest === 0; m.receiveShadow = true;
      parent.add(m);
    }
    this.parts.clear();
  }
}

// espinho de osso em degraus (3 cubos afinando) saindo de (x,y,z) na direção (dx,dy,dz)
function spike(K, M, x, y, z, dx, dy, dz, len, t) {
  let px = x, py = y, pz = z;
  for (let i = 0; i < 3; i++) {
    const s = len / 3, k = 1 - i * 0.28;
    const nx = px + dx * s, ny = py + dy * s, nz = pz + dz * s;
    K.link(M.bone, px, py, pz, nx, ny, nz, t * k);
    px = nx; py = ny; pz = nz;
  }
}
function skull(K, M, x, y, z, ry, s = 0.3) {
  K.box(M.bone, s, s * 0.9, s, x, y, z, 0, ry, 0);
  const fx = x + Math.sin(ry) * (s / 2 + 0.005), fz = z + Math.cos(ry) * (s / 2 + 0.005);
  K.box(M.skull, s * 0.96, s * 0.86, 0.01, fx, y, fz, 0, ry, 0);
}

// ============================================================
export function nestMesh(mother = false) {
  const M = materials();
  const rnd = mulberry32((Math.random() * 1e9) | 0);
  const g = new THREE.Group();
  const flesh = fleshMaterial();
  const K = new Kit(), KF = new Kit();

  // chão de creep (pixel, borda em degraus)
  const creep = new THREE.Mesh(new THREE.PlaneGeometry(8, 8), M.creep);
  creep.rotation.x = -Math.PI / 2; creep.rotation.z = rnd() * Math.PI; creep.position.y = 0.035; creep.receiveShadow = true;
  g.add(creep);

  // pedestal em 2 degraus + blocos de canto
  K.box(M.stone, 3.1, 0.3, 3.1, 0, 0.15, 0);
  K.box(M.stone, 2.7, 0.25, 2.7, 0, 0.425, 0);
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) K.box(M.stone, 0.55, 0.42, 0.55, sx * 1.45, 0.21, sz * 1.45);

  // gaiola vazada + colunas e moldura de ferro + espinhos de osso nos cantos do topo
  const CH = 2.3, CB = 0.55, cy = CB + CH / 2;
  K.box(M.cage, 2.3, CH, 2.3, 0, cy, 0);
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    K.box(M.iron, 0.18, CH + 0.12, 0.18, sx * 1.15, cy, sz * 1.15);
    spike(K, M, sx * 1.15, CB + CH + 0.05, sz * 1.15, sx * 0.45, 0.85, sz * 0.45, 0.9, 0.2);
  }
  for (const y of [CB + 0.04, CB + CH - 0.04]) {
    K.box(M.iron, 2.42, 0.12, 0.14, 0, y, 1.15); K.box(M.iron, 2.42, 0.12, 0.14, 0, y, -1.15);
    K.box(M.iron, 0.14, 0.12, 2.42, 1.15, y, 0); K.box(M.iron, 0.14, 0.12, 2.42, -1.15, y, 0);
  }
  // caveira no topo da gaiola
  skull(K, M, 0, CB + CH + 0.2, 0.25, 0, 0.42);

  // coração de carne (pulsa): base em y=0 da geometria, o mundo escala y por 1,25
  const coreGeo = new THREE.BoxGeometry(1.4, 1.2, 1.4); coreGeo.translate(0, 0.6, 0);
  const bulges = [];
  for (let i = 0; i < 6; i++) { // calombos de carne grudados no coração
    const b = new THREE.BoxGeometry(0.5, 0.5, 0.5);
    const a = rnd() * Math.PI * 2, y = 0.25 + rnd() * 0.8;
    b.translate(Math.cos(a) * 0.62, y, Math.sin(a) * 0.62); bulges.push(b);
  }
  const top = new THREE.BoxGeometry(0.9, 0.3, 0.9); top.translate(0, 1.32, 0);
  const core = new THREE.Mesh(mergeGeometries([coreGeo, top, ...bulges]), flesh);
  [coreGeo, top, ...bulges].forEach((x) => x.dispose());
  core.position.y = CB + 0.02; core.scale.set(1, 1.25, 1); core.castShadow = true;
  g.add(core);

  // detalhes vivos (somem quando o ninho é destruído): olhos, veias e esporos
  const veins = new THREE.Group();
  veins.position.copy(core.position); veins.scale.copy(core.scale);
  const KV = new Kit();
  for (let f = 0; f < 4; f++) {
    const a = (f * Math.PI) / 2, s = Math.sin(a), c = Math.cos(a);
    const ey = 0.62 + (f % 2) * 0.12, off = (f % 2 ? -0.22 : 0.2);
    KV.box(M.eye, 0.42, 0.34, 0.04, s * 0.72 + c * off, ey, c * 0.72 - s * off, 0, a, 0);
    // veias verticais brilhantes em cada face
    for (const o of [-0.45, 0.48]) KV.box(M.vein, 0.06, 0.9 + rnd() * 0.25, 0.03, s * 0.715 + c * o, 0.5, c * 0.715 - s * o, 0, a, 0);
  }
  KV.build(veins, false);
  // esporos girando em volta da gaiola
  const sp = [];
  for (let i = 0; i < 12; i++) {
    const b = new THREE.BoxGeometry(0.07, 0.07, 0.07), a = (i / 12) * Math.PI * 2;
    b.translate(Math.cos(a) * (1.5 + rnd() * 0.5), 0.2 + rnd() * 1.6, Math.sin(a) * (1.5 + rnd() * 0.5)); sp.push(b);
  }
  const spores = new THREE.Mesh(mergeGeometries(sp), M.spore); sp.forEach((x) => x.dispose());
  const ph = rnd() * 10;
  spores.onBeforeRender = () => { const t = performance.now() / 1000 + ph; spores.rotation.y = t * 0.5; spores.position.y = Math.sin(t * 1.3) * 0.12; };
  veins.add(spores);
  g.add(veins);

  // tentáculos segmentados saindo do pedestal até o chão, com garra de osso
  const nT = 6;
  for (let i = 0; i < nT; i++) {
    const a = (i / nT) * Math.PI * 2 + rnd() * 0.4, ca = Math.cos(a), sa = Math.sin(a);
    let px = ca * 1.2, py = 0.75, pz = sa * 1.2;
    const segs = 5;
    for (let k = 1; k <= segs; k++) {
      const t = k / segs, r = 1.2 + t * 2.0, y = 0.75 + Math.sin(t * Math.PI) * 0.55 - t * 0.6;
      const tw = Math.sin(t * 3 + i) * 0.35; // curva lateral
      const nx = Math.cos(a + tw * 0.3) * r, nz = Math.sin(a + tw * 0.3) * r, ny = Math.max(0.12, y);
      KF.link(flesh, px, py, pz, nx, ny, nz, 0.46 - k * 0.06);
      px = nx; py = ny; pz = nz;
    }
    spike(K, M, px, py, pz, ca * 0.7, -0.15, sa * 0.7, 0.4, 0.12); // garra
  }

  // ovos em volta (alguns chocados, com casca aberta e gosma)
  const nE = mother ? 9 : 7;
  for (let i = 0; i < nE; i++) {
    const a = rnd() * Math.PI * 2, r = 2.0 + rnd() * 1.4, x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (i % 3 === 2) {
      K.box(M.slime, 0.8, 0.04, 0.7, x, 0.045, z, 0, a, 0);
      K.box(M.egg, 0.46, 0.2, 0.46, x, 0.12, z, 0, a, 0);
      K.box(M.egg, 0.28, 0.06, 0.2, x + 0.4, 0.05, z + 0.1, 0.2, a, 0.4);
    } else {
      const s = 0.8 + rnd() * 0.45;
      K.box(M.egg, 0.42 * s, 0.56 * s, 0.42 * s, x, 0.28 * s, z, 0, rnd() * 1.5, (rnd() - 0.5) * 0.2);
      if (rnd() < 0.5) K.box(M.egg, 0.3 * s, 0.4 * s, 0.3 * s, x + 0.35, 0.2 * s, z - 0.2, 0, rnd(), 0);
    }
  }
  // ossos e caveiras espalhados
  for (let i = 0; i < 4; i++) {
    const a = rnd() * Math.PI * 2, r = 2.4 + rnd() * 1.2, x = Math.cos(a) * r, z = Math.sin(a) * r, ry = rnd() * Math.PI;
    K.box(M.bone, 0.08, 0.08, 0.62, x, 0.06, z, 0, ry, 0);
    K.box(M.bone, 0.16, 0.12, 0.12, x + Math.sin(ry) * 0.3, 0.08, z + Math.cos(ry) * 0.3, 0, ry, 0);
    K.box(M.bone, 0.16, 0.12, 0.12, x - Math.sin(ry) * 0.3, 0.08, z - Math.cos(ry) * 0.3, 0, ry, 0);
  }
  for (let i = 0; i < 3; i++) {
    const a = rnd() * Math.PI * 2, r = 2.2 + rnd() * 1.3;
    skull(K, M, Math.cos(a) * r, 0.13, Math.sin(a) * r, rnd() * Math.PI * 2, 0.28);
  }

  // colmeia mãe: coroa de espinhos maiores em volta do pedestal e mais ossos
  if (mother) {
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + 0.2;
      spike(K, M, Math.cos(a) * 1.7, 0.4, Math.sin(a) * 1.7, Math.cos(a) * 0.35, 0.95, Math.sin(a) * 0.35, 1.6, 0.28);
    }
  }

  K.build(g); KF.build(g);
  if (mother) g.scale.setScalar(2.1);
  return { g, core, veins, flesh };
}

// ============================================================
//  Pilar da colmeia mãe: pedra corrompida + carne empilhada afinando,
//  veias brilhantes, olho e espinho de osso no topo, ovos na base.
// ============================================================
let spireFlesh = null;
export function motherSpire(h, rnd = Math.random) {
  const M = materials();
  spireFlesh = spireFlesh || fleshMaterial();
  const g = new THREE.Group(), K = new Kit();
  K.box(M.stone, 1.5, 0.5, 1.5, 0, 0.25, 0);
  const n = Math.max(3, Math.round(h / 0.75));
  let y = 0.5;
  for (let i = 0; i < n; i++) {
    const k = 1 - i / (n + 1), w = 1.15 * k + 0.2, sh2 = (h - 0.5) / n;
    const ox = (rnd() - 0.5) * 0.12, oz = (rnd() - 0.5) * 0.12;
    K.box(spireFlesh, w, sh2 + 0.02, w, ox, y + sh2 / 2, oz, 0, (rnd() - 0.5) * 0.3, 0);
    if (i % 2 === 0) K.box(M.vein, 0.06, sh2 * 0.9, 0.04, ox + w / 2 + 0.01, y + sh2 / 2, oz, 0, 0, 0);
    y += sh2;
  }
  K.box(M.eye, 0.36, 0.3, 0.04, 0, h * 0.62, 0.48 * (1 - 0.62) + 0.22);
  spike(K, M, 0, y, 0, (rnd() - 0.5) * 0.4, 1, (rnd() - 0.5) * 0.4, 1.0, 0.24);
  for (let i = 0; i < 3; i++) { const a = rnd() * Math.PI * 2; K.box(M.egg, 0.4, 0.52, 0.4, Math.cos(a) * 0.95, 0.26, Math.sin(a) * 0.95, 0, rnd(), 0); }
  K.build(g);
  return g;
}
