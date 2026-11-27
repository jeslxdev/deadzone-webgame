// ============================================================
//  MODELOS — humanoides anatômicos (jogador e zumbis) e armas
//  · Silhuetas por perfis de revolução (torso, braços, pernas)
//    com volumes musculares (peitoral, deltoide, trapézio,
//    bíceps, tríceps, antebraço, quadríceps, panturrilha).
//  · Crânio deformado (mandíbula, queixo, maçãs, órbitas, arco
//    superciliar), olhos com íris/pupila/pálpebras, nariz, lábios.
//  · Cabelo como casca que segue o crânio (linha do cabelo,
//    costeletas) + mechas.
//  · Oclusão ambiente "assada" nas cores e materiais separados
//    (pele acetinada × tecido fosco com trama).
//  Personagem olha para +Z. Lado direito do personagem = -X.
// ============================================================
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { WEAPONS, RARITIES } from './data.js';
import { mulberry32, pick } from './util.js';
import { buildBlockyGeometries, paintPlayerSkin, paintZombieSkin, canvasTexture, atlasBox, XR } from './blocky.js';

// ---------- utilidades compartilhadas (também usadas por world.js) ----------
const geoCache = new Map();
export function box(w, h, d) {
  const k = `${w.toFixed(3)}_${h.toFixed(3)}_${d.toFixed(3)}`;
  let g = geoCache.get(k);
  if (!g) { g = new THREE.BoxGeometry(w, h, d); geoCache.set(k, g); }
  return g;
}
export function mat(color, opts = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0.05, ...opts });
}

// ---------- primitivas ----------
const P = {
  sphere: new THREE.SphereGeometry(1, 18, 14),
  sphereLo: new THREE.SphereGeometry(1, 10, 8),
  capTop: new THREE.SphereGeometry(1, 18, 10, 0, Math.PI * 2, 0, Math.PI * 0.55),
  cyl: new THREE.CylinderGeometry(1, 1, 1, 16),
  cylOpen: new THREE.CylinderGeometry(1, 1, 1, 20, 1, true),
  cone: new THREE.ConeGeometry(1, 1, 14),
};
const capsCache = new Map();
function capsule(r, len) {
  const k = r.toFixed(4) + '_' + len.toFixed(4);
  let g = capsCache.get(k);
  if (!g) { g = new THREE.CapsuleGeometry(r, len, 5, 12); capsCache.set(k, g); }
  return g;
}
// Tubo ao longo de pontos (sobrancelhas, lábios)
function tube(pts, r, seg = 12) {
  const c = new THREE.CatmullRomCurve3(pts.map(([x, y, z]) => new THREE.Vector3(x, y, z)));
  return new THREE.TubeGeometry(c, seg, r, 7, false);
}
// Mecha curvada, com raiz cheia e ponta fina. Evita os espinhos e cilindros rígidos.
function hairLock(pts, radius) {
  const curve = new THREE.CatmullRomCurve3(pts.map(([x, y, z]) => new THREE.Vector3(x, y, z)));
  const rings = 12, sides = 8, vertices = [], uvs = [], indices = [];
  for (let i = 0; i <= rings; i++) {
    const t = i / rings, p = curve.getPoint(t), tangent = curve.getTangent(t);
    const axis = Math.abs(tangent.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
    const u = new THREE.Vector3().crossVectors(tangent, axis).normalize();
    const v = new THREE.Vector3().crossVectors(tangent, u).normalize();
    const taper = Math.max(0.025, Math.sin(Math.PI * (0.08 + 0.92 * t)));
    const width = radius * taper;
    const thickness = radius * 0.22 * taper;
    for (let j = 0; j < sides; j++) {
      const a = j * Math.PI * 2 / sides;
      const q = p.clone().addScaledVector(u, Math.cos(a) * width).addScaledVector(v, Math.sin(a) * thickness);
      vertices.push(q.x, q.y, q.z);
      uvs.push(j / sides, t);
      if (i < rings) {
        const n = i * sides + j, next = i * sides + (j + 1) % sides;
        indices.push(n, next, n + sides, next, next + sides, n + sides);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(indices); g.computeVertexNormals();
  return g;
}
const lidGeo = new THREE.SphereGeometry(1, 18, 8, 0, Math.PI * 2, 0, Math.PI * 0.36);
// Perfil de revolução: lista [y, raio] com y crescente
function lathe(profile, rMul = 1, seg = 22) {
  return new THREE.LatheGeometry(profile.map(([y, r]) => new THREE.Vector2(r * rMul, y)), seg);
}

// ---------- texturas de micro-relevo (evita aspecto "emborrachado") ----------
let fabricTex = null, skinTex = null, grimeTex = null;
function reliefTextures() {
  if (fabricTex) return;
  const make = (size, draw) => {
    const c = document.createElement('canvas'); c.width = c.height = size;
    const g = c.getContext('2d'); draw(g, size);
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    return t;
  };
  fabricTex = make(128, (g, s) => {
    g.fillStyle = '#808080'; g.fillRect(0, 0, s, s);
    for (let y = 0; y < s; y += 2) { g.fillStyle = `rgba(0,0,0,${0.12 + Math.random() * 0.1})`; g.fillRect(0, y, s, 1); }
    for (let x = 0; x < s; x += 2) { g.fillStyle = `rgba(255,255,255,${0.08 + Math.random() * 0.08})`; g.fillRect(x, 0, 1, s); }
    for (let i = 0; i < 400; i++) { g.fillStyle = `rgba(${Math.random() < 0.5 ? 0 : 255},0,0,0.15)`; g.fillRect(Math.random() * s, Math.random() * s, 2, 2); }
  });
  fabricTex.repeat.set(6, 6);
  skinTex = make(128, (g, s) => {
    g.fillStyle = '#808080'; g.fillRect(0, 0, s, s);
    for (let i = 0; i < 2500; i++) { const v = 100 + Math.random() * 60; g.fillStyle = `rgba(${v},${v},${v},0.5)`; g.fillRect(Math.random() * s, Math.random() * s, 1.5, 1.5); }
  });
  skinTex.repeat.set(3, 3);
  // zumbis: sujeira, sangue seco e manchas de decomposição (multiplica a cor do corpo)
  grimeTex = make(256, (g, s) => {
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, s, s);
    const blot = (n, col, r0, r1) => { for (let i = 0; i < n; i++) { const x = Math.random() * s, y = Math.random() * s, r = r0 + Math.random() * (r1 - r0); for (const [dx, dy] of [[0, 0], [s, 0], [-s, 0], [0, s], [0, -s]]) { const gr = g.createRadialGradient(x + dx, y + dy, 0, x + dx, y + dy, r); gr.addColorStop(0, col); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(x + dx - r, y + dy - r, r * 2, r * 2); } } };
    blot(16, 'rgba(130,120,100,0.28)', 18, 60);  // sujeira (manchas amplas e suaves)
    blot(9, 'rgba(110,40,30,0.32)', 8, 26);      // sangue seco
    blot(8, 'rgba(95,105,75,0.25)', 14, 40);     // manchas de decomposição
    for (let i = 0; i < 10; i++) { g.strokeStyle = 'rgba(90,30,25,' + (0.18 + Math.random() * 0.2) + ')'; g.lineWidth = 1 + Math.random() * 2; const x = Math.random() * s, y = Math.random() * s; g.beginPath(); g.moveTo(x, y); g.lineTo(x + (Math.random() - 0.5) * 6, y + 10 + Math.random() * 30); g.stroke(); } // escorridos
    for (let i = 0; i < 3000; i++) { const v = 150 + Math.random() * 90; g.fillStyle = 'rgba(' + v + ',' + v + ',' + (v - 10) + ',0.18)'; g.fillRect(Math.random() * s, Math.random() * s, 1.5, 1.5); }
  });
  grimeTex.colorSpace = THREE.SRGBColorSpace;
  grimeTex.repeat.set(1.2, 1.2);
}

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _c = new THREE.Color(), _up = new THREE.Vector3(0, 1, 0);

// Coletor de partes com cor por vértice + oclusão ambiente simples
class Parts {
  constructor(seed = 1) { this.list = []; this.r = mulberry32(seed); }
  _push(g, color, ao) {
    _c.set(color);
    const n = g.attributes.position.count, arr = new Float32Array(n * 3), nor = g.attributes.normal;
    for (let i = 0; i < n; i++) {
      // faces voltadas para baixo ficam mais escuras (vincos, axilas, sob o queixo)
      const shade = ao ? 0.72 + 0.28 * (nor.getY(i) * 0.5 + 0.5) : 1;
      const j = 1 + (this.r() - 0.5) * 0.05;
      arr[i * 3] = _c.r * shade * j; arr[i * 3 + 1] = _c.g * shade * j; arr[i * 3 + 2] = _c.b * shade * j;
    }
    g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
    g.userData = { reg: this.reg || null }; // novo objeto: clone() compartilha userData
    this.list.push(g);
  }
  add(geo, color, x = 0, y = 0, z = 0, sx = 1, sy = 1, sz = 1, rx = 0, ry = 0, rz = 0, ao = true) {
    const g = geo.clone();
    _e.set(rx, ry, rz);
    _m.compose(_p.set(x, y, z), _q.setFromEuler(_e), _s.set(sx, sy, sz));
    g.applyMatrix4(_m);
    this._push(g, color, ao);
  }
  // orientação por direção (eixo Y da peça aponta para dir)
  addDir(geo, color, pos, dir, sx = 1, sy = 1, sz = 1) {
    const g = geo.clone();
    _q.setFromUnitVectors(_up, dir.clone().normalize());
    _m.compose(pos, _q, _s.set(sx, sy, sz));
    g.applyMatrix4(_m);
    this._push(g, color, true);
  }
  merge() {
    if (!this.list.length) return null;
    const m = mergeGeometries(this.list, false);
    this.list.forEach((g) => g.dispose());
    this.list = [];
    return m;
  }
}

// ---------- crânio ----------
// Deforma um ponto da esfera unitária no formato de cabeça humana
function headShape(v, sockets) {
  let { x, y, z } = v;
  if (y < 0) {
    const t = -y;
    x *= 1 - 0.4 * t * t;                 // mandíbula estreita até o queixo
    if (z < 0) z *= 1 - 0.35 * t;          // nuca recua no pescoço
    if (z > 0) z *= 1 + 0.06 * t * (1 - t); // queixo/boca levemente à frente
  }
  x *= 0.9;                                 // têmporas achatadas
  if (z < 0 && y > -0.2) z *= 1.07;         // occipital
  if (z > 0.5 && y > 0.35) z *= 0.97;       // testa
  const bump = (cx, cy, cz, sx2, sy2, sz2, amt) => {
    const d = (x - cx) ** 2 / sx2 + (y - cy) ** 2 / sy2 + (z - cz) ** 2 / sz2;
    return amt * Math.exp(-d);
  };
  let k = 1;
  k += bump(0.52, -0.05, 0.78, 0.04, 0.03, 0.05, 0.05) + bump(-0.52, -0.05, 0.78, 0.04, 0.03, 0.05, 0.05); // maçãs
  k += bump(0.32, 0.27, 0.92, 0.06, 0.004, 0.05, 0.035) + bump(-0.32, 0.27, 0.92, 0.06, 0.004, 0.05, 0.035); // arco superciliar
  k += bump(0, -0.42, 0.9, 0.08, 0.03, 0.05, 0.03); // focinho / boca
  k += bump(0, -0.78, 0.6, 0.03, 0.02, 0.04, 0.05); // queixo
  if (sockets) {
    k -= bump(0.34, 0.1, 0.93, 0.018, 0.012, 0.03, 0.09) + bump(-0.34, 0.1, 0.93, 0.018, 0.012, 0.03, 0.09); // órbitas
  }
  v.set(x * k, y * k, z * k);
}
let headUnit = null;
function headGeoUnit() {
  if (headUnit) return headUnit;
  const g = new THREE.SphereGeometry(1, 40, 32);
  const p = g.attributes.position, v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i); headShape(v, true); p.setXYZ(i, v.x, v.y, v.z); }
  g.computeVertexNormals();
  headUnit = g;
  return g;
}
// Casca de cabelo/barba que acompanha o crânio, recortada por um predicado
function shellGeo(scale, keep, rough = 0.03, seed = 7) {
  const g = new THREE.SphereGeometry(1, 48, 36);
  const p = g.attributes.position, v = new THREE.Vector3(), r = mulberry32(seed);
  const ok = new Uint8Array(p.count);
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    ok[i] = keep(v.x, v.y, v.z) ? 1 : 0;
    headShape(v, false);
    const n = 1 + (Math.sin(v.x * 11 + seed) * Math.sin(v.y * 9) * Math.sin(v.z * 10 + seed)) * rough * 0.45;
    const sc = ok[i] ? scale * n : 0.86;
    p.setXYZ(i, v.x * sc, v.y * sc, v.z * sc);
  }
  const idx = g.index.array, out = [];
  for (let i = 0; i < idx.length; i += 3) if (ok[idx[i]] || ok[idx[i + 1]] || ok[idx[i + 2]]) out.push(idx[i], idx[i + 1], idx[i + 2]);
  g.setIndex(out);
  g.computeVertexNormals();
  return g;
}
const shellCache = new Map();
function shell(key, scale, keep, rough, seed) {
  if (!shellCache.has(key)) shellCache.set(key, shellGeo(scale, keep, rough, seed));
  return shellCache.get(key);
}
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
// linha do cabelo: frente alta, laterais descem até as costeletas, nuca baixa
const lerp = (a, b, t) => a + (b - a) * t;
const hairline = (front, side, back) => (x, y, z) => {
  let t;
  if (z > 0.5) t = lerp(side + 0.12, front, smooth(0.5, 0.88, z)) + Math.abs(x) * 0.18; // entradas nas têmporas
  else if (z > -0.3) t = side;
  else t = lerp(side, back, smooth(-0.3, -0.85, z));
  const sideburn = Math.abs(x) > 0.88 && z > 0.02 && z < 0.32 && y > 0.1;
  return y > t || sideburn;
};

const scalpCache = new Map();
function scalpBoundary(theta, style) {
  const front = Math.max(0, Math.cos(theta));
  const back = Math.max(0, -Math.cos(theta));
  const long = style === 'longo';
  const side = long ? -0.24 : style === 'coque' ? 0.08 : 0.025;
  return side + (0.32 - side) * smooth(0, 0.96, front)
    + ((long ? -0.72 : -0.48) - side) * smooth(0, 0.96, back)
    + 0.024 * Math.cos(theta * 5) + 0.012 * Math.sin(theta * 7);
}
function scalpPoint(theta, t, style, lift = 1.05) {
  const y = 0.999 - (0.999 - scalpBoundary(theta, style)) * t;
  const radius = Math.sqrt(Math.max(0, 1 - y * y));
  const v = new THREE.Vector3(Math.sin(theta) * radius, y, Math.cos(theta) * radius);
  headShape(v, false);
  return [v.x * HEAD_S.x * lift, HEAD_Y + v.y * HEAD_S.y * lift, v.z * HEAD_S.z * lift];
}
function scalpGeo(style) {
  if (scalpCache.has(style)) return scalpCache.get(style);
  const slices = 96, rings = 22, vertices = [], uvs = [], indices = [];
  for (let i = 0; i <= rings; i++) for (let j = 0; j <= slices; j++) {
    const t = i / rings, theta = j * Math.PI * 2 / slices;
    const lift = 1.042 + 0.012 * Math.sin(Math.PI * t) - 0.032 * smooth(0.91, 1, t);
    vertices.push(...scalpPoint(theta, t, style, lift));
    uvs.push(j / slices, t);
    if (i < rings && j < slices) {
      const n = i * (slices + 1) + j;
      indices.push(n, n + slices + 1, n + 1, n + 1, n + slices + 1, n + slices + 2);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(indices); g.computeVertexNormals();
  scalpCache.set(style, g);
  return g;
}
function addHairStyle(parts, hair, style, zombie = false) {
  if (!style || style === 'careca') return;
  if (style === 'afro') {
    parts.add(P.sphere, hair, 0, 0.29, -0.04, 0.24, 0.22, 0.23);
    const r = mulberry32(80);
    for (let i = 0; i < (zombie ? 18 : 90); i++) {
      const theta = r() * Math.PI * 2, el = r() * 1.75;
      parts.add(P.sphere, i % 5 ? hair : darker(hair, 0.84), Math.sin(el) * Math.sin(theta) * 0.23,
        0.29 + Math.cos(el) * 0.2, -0.04 + Math.sin(el) * Math.cos(theta) * 0.22,
        0.016, 0.018, 0.016);
    }
    return;
  }
  parts.add(scalpGeo(style), hair);
  const rng = mulberry32(style === 'longo' ? 517 : style === 'coque' ? 231 : 118);
  // Fios em camadas sobrepostas cobrem a casca sem formar placas ou falhas
  // quando a câmera gira. Zumbis usam uma malha menor para preservar FPS.
  const rows = zombie ? 3 : style === 'ralo' ? 6 : style === 'longo' ? 9 : 8;
  const columns = zombie ? 10 : style === 'ralo' ? 18 : style === 'longo' ? 30 : 26;
  for (let row = 0; row < rows; row++) for (let col = 0; col < columns; col++) {
    const theta = (col + (row % 2) * 0.5 + (rng() - 0.5) * 0.3) * Math.PI * 2 / columns;
    const t = 0.07 + (row + (rng() - 0.5) * 0.3) / rows * 0.88;
    const flow = (rng() - 0.5) * 0.09;
    const p0 = scalpPoint(theta, t, style, 1.048);
    const p1 = scalpPoint(theta + flow * 0.2, Math.min(0.98, t + 0.07), style, 1.067);
    const p2 = scalpPoint(theta + flow * 0.55, Math.min(1, t + 0.15), style, 1.061);
    const p3 = scalpPoint(theta + flow, Math.min(1.04, t + 0.23), style, 1.048);
    parts.add(hairLock([p0, p1, p2, p3], zombie ? 0.005 : 0.009),
      col % 7 === 0 ? darker(hair, 0.82) : col % 9 === 0 ? mix(hair, 0xffffff, 0.12) : hair);
  }
  if (style === 'longo') {
    for (let i = 0; i < (zombie ? 12 : 64); i++) {
      const theta = Math.PI * (0.48 + i * 1.04 / (zombie ? 12 : 64));
      const root = scalpPoint(theta, 0.94, style, 1.045);
      const length = 0.17 + (i % 5) * 0.025;
      const sway = Math.sin(i * 2.7) * 0.022;
      parts.add(hairLock([root,
        [root[0] * 1.04, root[1] - length * 0.35, root[2] - 0.018],
        [root[0] + sway * 0.4, root[1] - length * 0.7, root[2] - 0.03],
        [root[0] + sway, root[1] - length, root[2] - 0.035]], 0.009),
      i % 6 === 0 ? darker(hair, 0.85) : hair);
    }
  }
  if (!zombie && style !== 'moicano' && style !== 'afro') {
    // Mechas curtas sobre as têmporas fecham a linha lateral do couro cabeludo.
    for (const side of [-1, 1]) for (let i = 0; i < 5; i++) {
      const theta = side * (0.9 + i * 0.12);
      const root = scalpPoint(theta, 0.25 + i * 0.105, style, 1.055);
      const mid = scalpPoint(theta + side * 0.07, 0.39 + i * 0.105, style, 1.07);
      const tip = scalpPoint(theta + side * 0.12, 0.53 + i * 0.105, style, 1.035);
      parts.add(hairLock([root, mid, tip], 0.0062), i % 3 === 0 ? darker(hair, 0.84) : hair);
    }
  }
  if (style === 'coque') parts.add(P.sphere, hair, 0, 0.43, -0.11, 0.065, 0.06, 0.068);
  if (style === 'moicano') for (let i = 0; i < 13; i++) {
    const theta = -1.1 + i * 0.18, root = scalpPoint(theta, 0.34, style, 1.045);
    parts.add(hairLock([root, [root[0], root[1] + 0.04, root[2] - 0.012],
      [root[0], root[1] + 0.07, root[2] - 0.04]], 0.013), hair);
  }
}
function addModeledHair(head, ap, mats, shadows) {
  if (ap.modeledHair === false || ap.hairStyle === 'careca') return null;
  const p = new Parts(41);
  addHairStyle(p, ap.hair || 0x241b19, ap.hairStyle || 'curto');
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.96, metalness: 0 });
  const mesh = new THREE.Mesh(p.merge(), material);
  mesh.castShadow = shadows;
  head.add(mesh); mats.push(material);
  return mesh.geometry;
}

const HEAD_S = new THREE.Vector3(0.185, 0.225, 0.2); // escala do crânio
const HEAD_Y = 0.2;
const HEAD_SCALE = 0.8; // aplicado ao grupo da cabeça (modelo procedural)

const BUILD_W = { magro: 0.86, normal: 1, forte: 1.2, gordo: 1.45 };
function mix(a, b, t) { const A = new THREE.Color(a), B = new THREE.Color(b); return A.lerp(B, t).getHex(); }
function darker(a, k) { return new THREE.Color(a).multiplyScalar(k).getHex(); }

// ---------- geometrias por parte do corpo ----------
function buildGeometries(ap, zombie) {
  const bw = BUILD_W[ap.build] || 1;
  const musc = ap.build === 'forte' ? 1.15 : ap.build === 'magro' ? 0.85 : 1;
  const aw = Math.min(1.35, 0.86 + (bw - 0.86) * 0.9);
  const lw = Math.min(1.3, 0.92 + (bw - 0.86) * 0.65);
  const skin = ap.skin, top = ap.top, pants = ap.pants, hair = ap.hair;
  const dark = 0x1c1a18;
  const lip = mix(skin, zombie ? 0x3a2020 : 0xa8504a, zombie ? 0.5 : 0.35);
  const seed = (skin ^ top ^ pants) & 0xffff;
  const parts = () => ({ skin: new Parts(seed + 1), cloth: new Parts(seed + 2), eyes: new Parts(seed + 3) });
  const out = {};

  // ===== PERNA (coxa / canela articuladas no joelho) =====
  {
    const U = parts(), D = parts();
    const K = 0.42; // altura do joelho abaixo do quadril
    const legProf = [[-0.8, 0.046], [-0.74, 0.05], [-0.66, 0.058], [-0.58, 0.07], [-0.52, 0.072], [-0.46, 0.064], [-0.42, 0.066], [-0.36, 0.076], [-0.26, 0.09], [-0.14, 0.102], [-0.04, 0.108], [0.03, 0.098]];
    const upP = legProf.filter(([y]) => y >= -0.46), loP = legProf.filter(([y]) => y <= -0.4);
    const torn = zombie && ap.tornPants;
    U.skin.add(lathe(upP, lw), skin);
    D.skin.add(lathe(loP, lw), skin, 0, K);
    D.skin.add(P.sphere, skin, 0, -0.55 + K, -0.028, 0.056 * lw, 0.095, 0.052 * lw); // panturrilha
    // calça (um pouco mais folgada); rasgada nos zumbis
    const pant = (p) => p.map(([y, rr]) => [y, rr + 0.012]);
    U.cloth.add(lathe(pant(upP), lw), pants);
    if (!torn) D.cloth.add(lathe(pant(loP), lw), pants, 0, K);
    U.cloth.add(P.sphere, pants, 0, -0.23, 0.028, 0.084 * lw, 0.14, 0.07 * lw); // quadríceps
    D.cloth.add(P.sphere, torn ? skin : pants, 0, -0.43 + K, 0.035, 0.05 * lw, 0.05, 0.035); // joelho
    D.cloth.add(P.sphere, pants, 0, -0.42 + K, -0.005, 0.07 * lw, 0.06, 0.07 * lw); // articulação (esconde a junta)
    if (!torn) D.cloth.add(P.sphere, pants, 0, -0.55 + K, -0.03, 0.06 * lw, 0.1, 0.058 * lw);
    // calçado: cabedal + sola + gola
    D.cloth.add(P.sphere, ap.shoes, 0, -0.775 + K, 0.035, 0.062, 0.058, 0.125);
    D.cloth.add(P.sphere, darker(ap.shoes, 0.5), 0, -0.82 + K, 0.04, 0.066, 0.022, 0.135);
    D.cloth.add(P.cylOpen, darker(ap.shoes, 0.8), 0, -0.735 + K, -0.005, 0.058, 0.04, 0.062);
    out.legU = U; out.legD = D;
  }

  // ===== TRONCO =====
  {
    const T = parts();
    const xS = 1.1 * bw, zS = 0.7 * Math.max(1, bw * 0.9);
    const torsoProf = [[0.0, 0.15], [0.05, 0.183], [0.12, 0.186], [0.2, 0.168], [0.28, 0.163], [0.36, 0.177], [0.45, 0.198], [0.53, 0.21], [0.6, 0.203], [0.66, 0.178], [0.71, 0.13], [0.745, 0.075], [0.77, 0.04]];
    const tor = (prof, add) => { const g = lathe(prof.map(([y, rr]) => [y, rr + add]), 1, 26); g.scale(xS, 1, zS); return g; };
    // pele por baixo (aparece em rasgos) + camisa + quadril da calça
    T.skin.add(tor(torsoProf, -0.004), skin);
    T.cloth.add(tor(torsoProf.filter(([y]) => y >= 0.12), 0.006), top);
    T.cloth.add(tor(torsoProf.filter(([y]) => y <= 0.2), 0.01), pants);
    if (ap.build === 'gordo') T.cloth.add(P.sphere, top, 0, 0.27, 0.07, 0.25 * bw * 0.85, 0.22, 0.2 * zS * 1.3);
    // musculatura sob a roupa justa
    const front = (y) => 0.2 * zS * (y > 0.45 ? 1.02 : 0.95);
    T.cloth.add(P.sphere, top, 0, 0.535, front(0.535) - 0.03, 0.17 * bw * musc, 0.065 * musc, 0.04 * musc); // peitoral largo
    T.cloth.add(P.sphere, top, 0, 0.36, front(0.36) - 0.012, 0.09 * bw, 0.09, 0.014); // abdômen
    T.cloth.add(P.sphere, top, -0.075 * bw, 0.5, -front(0.5) + 0.03, 0.08 * bw, 0.09, 0.04); // escápulas
    T.cloth.add(P.sphere, top, 0.075 * bw, 0.5, -front(0.5) + 0.03, 0.08 * bw, 0.09, 0.04);
    T.cloth.add(P.sphere, top, -0.085 * bw, 0.665, -0.015, 0.1 * bw * musc, 0.05, 0.075); // trapézio
    T.cloth.add(P.sphere, top, 0.085 * bw, 0.665, -0.015, 0.1 * bw * musc, 0.05, 0.075);
    const shX = 0.231 * bw + 0.035;
    T.cloth.add(P.sphere, top, -shX, 0.6, 0, 0.07 * aw * musc, 0.072 * aw, 0.076 * aw * musc); // deltoides
    T.cloth.add(P.sphere, top, shX, 0.6, 0, 0.07 * aw * musc, 0.072 * aw, 0.076 * aw * musc);
    // gola, cinto, fivela
    T.cloth.add(P.cylOpen, darker(top, 0.8), 0, 0.725, 0, 0.092, 0.035, 0.084); // gola (envolve o pescoço)
    T.cloth.add(P.cylOpen, dark, 0, 0.16, 0, 0.19 * xS + 0.008, 0.05, 0.19 * zS + 0.008);
    T.cloth.add(P.sphere, 0x9a8a5a, 0, 0.16, 0.19 * zS + 0.012, 0.03, 0.024, 0.008);
    // Superfície real do tronco (perfil de revolução escalado): tudo o que é
    // vestido por cima (colete, alças, bolsos) é posicionado sobre ela, sem flutuar.
    const rAt = (y) => {
      const p = torsoProf;
      if (y <= p[0][0]) return p[0][1];
      for (let i = 1; i < p.length; i++) if (y <= p[i][0]) { const [y0, r0] = p[i - 1], [y1, r1] = p[i]; return r0 + ((r1 - r0) * (y - y0)) / (y1 - y0); }
      return p[p.length - 1][1];
    };
    const surfZ = (y, x, add) => zS * Math.sqrt(Math.max(0, (rAt(y) + add) ** 2 - (x / xS) ** 2));
    const VEST = 0.012 + 0.013; // camisa + espessura do colete
    // Colete de campo: painéis da frente e das costas que seguem o tronco
    // (abertos nas laterais para os braços não atravessarem o tecido).
    if (!zombie) {
      const vestCol = mix(darker(top, 0.55), 0x3a3d2c, 0.55);
      const vestProf = torsoProf.filter(([y]) => y >= 0.26 && y <= 0.62).map(([y, rr]) => new THREE.Vector2(rr + VEST, y));
      for (const phi0 of [-0.95, Math.PI - 0.95]) {
        const g = new THREE.LatheGeometry(vestProf, 14, phi0, 1.9);
        g.scale(xS, 1, zS);
        T.cloth.add(g, vestCol);
      }
      for (const sx of [-1, 1]) {
        // bolsos com aba, encostados no colete e girados conforme a curva do peito
        const px = sx * 0.088 * bw, py = 0.36;
        const pz = surfZ(py, px, VEST) + 0.016;
        T.cloth.add(box(0.07, 0.085, 0.034), darker(vestCol, 0.9), px, py, pz, 1, 1, 1, 0, sx * 0.32, 0);
        T.cloth.add(box(0.074, 0.026, 0.038), darker(vestCol, 0.75), px, py + 0.04, pz + 0.002, 1, 1, 1, -0.12, sx * 0.32, 0);
      }
    }
    // pescoço (esternocleidomastoide)
    T.skin.add(lathe([[0.7, 0.082], [0.78, 0.074], [0.86, 0.068], [0.92, 0.064]], 1, 16), skin);
    // esternocleidomastoide: volumes rasos, embutidos no pescoço (não atravessam a pele)
    T.skin.add(capsule(0.015, 0.08), skin, -0.03, 0.79, 0.04, 1, 1, 1, 0.2, 0, 0.25);
    T.skin.add(capsule(0.015, 0.08), skin, 0.03, 0.79, 0.04, 1, 1, 1, 0.2, 0, -0.25);
    if (!zombie) {
      // mochila com alças
      T.cloth.add(capsule(0.12, 0.2), ap.pack, 0, 0.42, -0.2 * zS - 0.11, 1.5 * Math.min(bw, 1.2), 1, 0.62);
      T.cloth.add(P.sphere, darker(ap.pack, 0.85), 0, 0.57, -0.2 * zS - 0.12, 0.17, 0.065, 0.1);
      T.cloth.add(capsule(0.05, 0.12), darker(ap.pack, 0.9), 0, 0.3, -0.2 * zS - 0.2, 1.6, 1, 0.6, 0, 0, Math.PI / 2);
      // alças: faixas recortadas da própria superfície do tronco (mesmo perfil da
      // camisa, alguns mm para fora), então ficam coladas ao corpo em todo o trajeto:
      // sobem do colete pelo peito, somem sob o trapézio e descem pelas costas até a mochila.
      const strapProf = [];
      for (let y = 0.46; y <= 0.735; y += 0.0125) strapProf.push(new THREE.Vector2(rAt(y) + (y <= 0.62 ? VEST + 0.004 : 0.013), y));
      const strapW = 0.15; // largura angular (~3,5 cm)
      const phiC = Math.asin(Math.min(0.9, (0.095 * bw) / (xS * (rAt(0.6) + 0.013))));
      for (const sx of [-1, 1]) for (const base of [phiC, Math.PI - phiC]) {
        const g = new THREE.LatheGeometry(strapProf, 3, sx * base - strapW / 2, strapW);
        g.scale(xS, 1, zS);
        T.cloth.add(g, 0x2a241e);
      }
    } else {
      // rasgos ensanguentados na camisa, colados à superfície do tronco
      T.cloth.add(P.sphere, 0x4a0c0c, 0.08, 0.33, surfZ(0.33, 0.08, 0.004), 0.075, 0.09, 0.02);
      T.cloth.add(P.sphere, 0x3a0a0a, -0.05, 0.22, surfZ(0.22, -0.05, 0.004), 0.05, 0.06, 0.02);
      // costelas expostas DENTRO de um rasgo escuro (antes flutuavam sobre a camisa)
      T.cloth.add(P.sphere, 0x2a0808, -0.1, 0.4, surfZ(0.4, -0.1, 0.002), 0.052, 0.065, 0.016);
      for (let i = 0; i < 3; i++) T.skin.add(capsule(0.0065, 0.04), mix(skin, 0xd8d0b8, 0.55), -0.1, 0.36 + i * 0.035, surfZ(0.36 + i * 0.035, -0.1, 0.008), 1, 1, 1, 0, 0, Math.PI / 2 - 0.2);
    }
    out.torso = T;
  }

  // ===== CABEÇA =====
  {
    const H = parts();
    H.skin.add(headGeoUnit(), skin, 0, HEAD_Y, 0, HEAD_S.x, HEAD_S.y, HEAD_S.z);
    // Volumes suaves das maçãs e do queixo dão transição ao rosto sem criar
    // placas duras sobre a cabeça esculpida.
    // orelhas
    for (const s of [-1, 1]) {
      H.skin.add(P.sphere, skin, s * 0.168, 0.2, -0.012, 0.016, 0.032, 0.024, 0.1, s * 0.35, 0);
      H.skin.add(P.sphere, darker(skin, 0.82), s * 0.177, 0.2, -0.008, 0.0065, 0.02, 0.012, 0.1, s * 0.35, 0, false);
    }
    // nariz: ponte, ponta, asas
    H.skin.add(capsule(0.012, 0.045), skin, 0, 0.183, 0.193, 1.1, 1, 1, -0.4, 0, 0);
    // ponta discreta e asas pequenas embutidas no rosto (sem "nariz de palhaço")
    H.skin.add(P.sphere, skin, 0, 0.152, 0.205, 0.013, 0.013, 0.015);
    H.skin.add(P.sphere, skin, -0.012, 0.146, 0.196, 0.009, 0.008, 0.009);
    H.skin.add(P.sphere, skin, 0.012, 0.146, 0.196, 0.009, 0.008, 0.009);
    H.skin.add(P.sphere, darker(skin, 0.5), -0.0075, 0.14, 0.2, 0.0045, 0.003, 0.004, 0, 0, 0, false); // narinas
    H.skin.add(P.sphere, darker(skin, 0.5), 0.0075, 0.14, 0.2, 0.0045, 0.003, 0.004, 0, 0, 0, false);
    // lábios e boca
    const mz = 0.187;
    if (!zombie) {
      H.skin.add(tube([[-0.023, 0.103, mz], [-0.012, 0.107, mz + 0.002], [0, 0.106, mz + 0.003], [0.012, 0.107, mz + 0.002], [0.023, 0.103, mz]], 0.0038), lip);
      H.skin.add(tube([[-0.019, 0.099, mz + 0.001], [0, 0.0965, mz + 0.003], [0.019, 0.099, mz + 0.001]], 0.0025), darker(lip, 0.72));
    } else {
      H.skin.add(P.sphere, 0x1a0606, 0, 0.098, mz, 0.034, 0.02, 0.012, 0, 0, 0, false);
      for (let i = 0; i < 5; i++) H.skin.add(P.sphere, 0xc8c0a0, -0.02 + i * 0.01, 0.111, mz + 0.004, 0.005, 0.006, 0.004, 0, 0, 0, false);
    }
    // olhos: globo, íris, pupila + pálpebras de pele
    for (const s of [-1, 1]) {
      const ex = s * 0.058, ey = 0.222, ez = 0.165;
      if (!zombie) {
        H.eyes.add(P.sphere, 0xf2eee8, ex, ey, ez + 0.008, 0.019, 0.015, 0.016, 0, 0, 0, false);
        H.eyes.add(P.sphere, ap.eyes ?? 0x3a2a1a, ex, ey, ez + 0.022, 0.008, 0.009, 0.0035, 0, 0, 0, false);
        H.eyes.add(P.sphere, 0x050505, ex, ey, ez + 0.025, 0.0035, 0.004, 0.0018, 0, 0, 0, false);
      } else {
        H.skin.add(P.sphere, 0x3a2a22, ex, ey, ez, 0.026, 0.026, 0.026, 0, 0, 0, false);
      }
      // pálpebra superior cobre o topo do globo, inferior suaviza
      H.skin.add(lidGeo, skin, ex, ey + 0.004, ez + 0.007, 0.022, 0.022, 0.022, zombie ? 0.32 : 0.2, 0, 0); // pálpebra cobre o topo da íris (zumbi: caídos)
      H.skin.add(tube([[ex - 0.022, ey - 0.008, ez + 0.012], [ex, ey - 0.019, ez + 0.02], [ex + 0.022, ey - 0.008, ez + 0.012]], 0.0035, 8), darker(skin, 0.92));
      // sobrancelha em arco
      if (!zombie || ap.hairStyle !== 'careca') {
        const bg = tube([[ex - s * 0.022, 0.252, 0.197], [ex - s * 0.004, 0.261, 0.2], [ex + s * 0.016, 0.26, 0.195], [ex + s * 0.03, 0.251, 0.186]], 0.0042, 10);
        bg.scale(1, 0.75, 1);
        H.cloth.add(bg, hair, 0, 0.05, 0);
      }
    }
    // cabelo
    addHairStyle(H.cloth, hair, ap.hairStyle, zombie);
    // barba
    const beardKeep = (mode) => (x, y, z) => {
      if (z < -0.25) return false;
      const mouth = Math.abs(x) < 0.3 && y > -0.62 && y < -0.32 && z > 0.55;
      if (mode === 'barba') return !mouth && (y < -0.18 || (Math.abs(x) > 0.78 && y < 0.25 && z < 0.6));
      return y < -0.55 && Math.abs(x) < 0.38 && z > 0.45 && !mouth;
    };
    if (ap.beard === 'barba') H.cloth.add(shell('barba', 1.06, beardKeep('barba'), 0.06, 12), hair, 0, HEAD_Y, 0, HEAD_S.x, HEAD_S.y, HEAD_S.z);
    if (ap.beard === 'cavanhaque') H.cloth.add(shell('cavanhaque', 1.07, beardKeep('cav'), 0.05, 13), hair, 0, HEAD_Y, 0, HEAD_S.x, HEAD_S.y, HEAD_S.z);
    if (ap.beard === 'barba' || ap.beard === 'cavanhaque' || ap.beard === 'bigode') {
      for (const s of [-1, 1]) H.cloth.add(capsule(0.009, 0.026), hair, s * 0.016, 0.117, 0.193, 1, 1, 0.8, 0, 0, s * (Math.PI / 2 - 0.35));
    }
    // acessórios
    switch (ap.accessory) {
      case 'bandana':
        H.cloth.add(P.cylOpen, 0xa81e1e, 0, 0.3, -0.005, 0.2, 0.06, 0.215, -0.18);
        H.cloth.add(capsule(0.022, 0.12), 0x8a1818, 0.04, 0.24, -0.215, 1, 1, 1, 0.4, 0, 0.3);
        H.cloth.add(capsule(0.02, 0.1), 0x8a1818, -0.02, 0.24, -0.22, 1, 1, 1, 0.5, 0, -0.2);
        break;
      case 'mascara':
        H.cloth.add(P.sphere, 0x2e3236, 0, 0.12, 0.17, 0.11, 0.09, 0.07);
        H.cloth.add(P.cyl, 0x3a3e42, -0.105, 0.09, 0.2, 0.048, 0.07, 0.048, Math.PI / 2 + 0.3, 0, 0.45);
        H.cloth.add(P.cyl, 0x3a3e42, 0.105, 0.09, 0.2, 0.048, 0.07, 0.048, Math.PI / 2 + 0.3, 0, -0.45);
        H.eyes.add(P.cyl, 0x2a4050, -0.058, 0.225, 0.2, 0.038, 0.02, 0.038, Math.PI / 2, 0, 0, false);
        H.eyes.add(P.cyl, 0x2a4050, 0.058, 0.225, 0.2, 0.038, 0.02, 0.038, Math.PI / 2, 0, 0, false);
        H.cloth.add(P.cylOpen, 0x1a1a1a, 0, 0.21, -0.01, 0.2, 0.03, 0.215);
        break;
      case 'chapeu':
        H.cloth.add(P.cyl, 0x5a3a22, 0, 0.375, -0.01, 0.33, 0.02, 0.33, -0.12);
        H.cloth.add(P.sphere, 0x5a3a22, 0, 0.44, -0.02, 0.19, 0.11, 0.2);
        H.cloth.add(P.cylOpen, 0x2a1a10, 0, 0.405, -0.012, 0.19, 0.035, 0.205, -0.12);
        break;
      case 'oculos':
        for (const s of [-1, 1]) H.eyes.add(P.cyl, 0x0a0a0a, s * 0.058, 0.225, 0.202, 0.04, 0.016, 0.034, Math.PI / 2, 0, 0, false);
        H.cloth.add(P.cylOpen, 0x0c0c0c, 0, 0.225, 0, 0.195, 0.014, 0.205);
        break;
      case 'capacete':
        H.cloth.add(P.capTop, 0x4b5320, 0, 0.23, -0.005, 0.228, 0.245, 0.248);
        H.cloth.add(P.cylOpen, 0x3e4518, 0, 0.245, -0.005, 0.236, 0.035, 0.256);
        break;
      case 'kasa':
        H.cloth.add(P.cone, 0xc8a86a, 0, 0.5, 0, 0.5, 0.2, 0.5);
        H.cloth.add(P.cylOpen, 0x8a6a3a, 0, 0.42, 0, 0.47, 0.012, 0.47);
        break;
    }
    out.head = H;
  }

  // ===== BRAÇO (superior / antebraço articulados no cotovelo) =====
  const arm = (sleeve) => {
    const U = parts(), D = parts();
    const E = 0.3; // cotovelo abaixo do ombro
    const upper = [[-0.31, 0.05], [-0.27, 0.056], [-0.21, 0.066], [-0.15, 0.07], [-0.09, 0.066], [-0.03, 0.07], [0.02, 0.06]];
    const fore = [[-0.57, 0.036], [-0.52, 0.04], [-0.45, 0.05], [-0.38, 0.058], [-0.33, 0.055], [-0.28, 0.05]];
    U.skin.add(lathe(upper, aw * musc), skin);
    U.skin.add(P.sphere, skin, 0, -0.165, 0.022, 0.05 * aw * musc, 0.075, 0.045 * aw * musc); // bíceps
    U.skin.add(P.sphere, skin, 0, -0.13, -0.022, 0.05 * aw * musc, 0.085, 0.045 * aw * musc); // tríceps
    D.skin.add(P.sphere, skin, 0, 0, -0.008, 0.052 * aw, 0.052 * aw, 0.052 * aw); // cotovelo
    D.skin.add(lathe(fore, aw), skin, 0, E);
    D.skin.add(P.sphere, skin, 0.01, -0.37 + E, 0.01, 0.045 * aw, 0.07, 0.048 * aw); // antebraço
    // Palma e dedos fechados ao redor do eixo do punho da arma.
    D.skin.add(P.sphere, skin, 0, -0.615 + E, 0.006, 0.031, 0.051, 0.043);
    if (!zombie) {
      for (let f = 0; f < 4; f++) {
        const x = -0.027 + f * 0.018, y = -0.662 + E + Math.abs(f - 1.5) * 0.003;
        D.skin.addDir(capsule(0.010, 0.019), skin, new THREE.Vector3(x, y, 0.048), new THREE.Vector3(0.13, -0.24, 1));
        D.skin.addDir(capsule(0.009, 0.015), skin, new THREE.Vector3(x + 0.002, y - 0.008, 0.067), new THREE.Vector3(0.1, -0.45, -1));
      }
      D.skin.addDir(capsule(0.013, 0.033), skin, new THREE.Vector3(0.03, -0.618 + E, 0.052), new THREE.Vector3(-0.9, -0.5, 0.2));
    } else {
      for (let f = 0; f < 4; f++) D.skin.add(capsule(0.0105, 0.034), skin, -0.004, -0.675 + E, -0.026 + f * 0.0175, 1, 1, 1, 0.12, 0, 0);
      D.skin.add(capsule(0.012, 0.032), skin, 0.014, -0.61 + E, 0.045, 1, 1, 1, 0.6, 0, -0.35);
    }
    if (sleeve !== 'none') {
      const sl = sleeve === 'long' ? upper : upper.filter(([y]) => y >= -0.2);
      U.cloth.add(lathe(sl.map(([y, rr]) => [y, rr + 0.012]), aw * musc), top);
      // tampa arredondada do ombro: fecha a boca da manga (sem fresta de pele) e gira junto com o braço
      U.cloth.add(P.sphere, top, 0, 0.012, 0, 0.074 * aw * musc, 0.05, 0.074 * aw * musc);
      if (sleeve === 'long') {
        D.cloth.add(lathe(fore.filter(([y]) => y >= -0.56).map(([y, rr]) => [y, rr + 0.012]), aw), top, 0, E);
        D.cloth.add(P.sphere, top, 0, 0, -0.008, 0.064 * aw, 0.064 * aw, 0.064 * aw);
        D.cloth.add(P.cylOpen, darker(top, 0.8), 0, -0.555 + E, 0, 0.05 * aw + 0.012, 0.03, 0.05 * aw + 0.012);
      } else {
        U.cloth.add(P.cylOpen, darker(top, 0.8), 0, -0.195, 0, 0.066 * aw * musc + 0.014, 0.03, 0.066 * aw * musc + 0.014);
      }
    }
    return { U, D };
  };
  const aR = arm(ap.sleeves === 'short' ? 'short' : 'long');
  const aL = zombie && ap.tornArm ? arm('none') : aR;
  out.armRU = aR.U; out.armRD = aR.D; out.armLU = aL.U; out.armLD = aL.D;
  return out;
}

// ============================================================
//  SKIN PNG (layout de skin 64×64 / 64×32 do Minecraft)
//  Cada parte do corpo recebe UVs por projeção em caixa: a face
//  (frente/trás/lados/topo/base) é escolhida pela normal de cada
//  triângulo e mapeada para o retângulo correspondente da skin.
//  A segunda camada (chapéu/jaqueta/mangas/calça) vira uma casca
//  levemente maior com transparência.
// ============================================================
const MC = {
  head: { o: [0, 0], s: [8, 8, 8], ov: [32, 0] },
  body: { o: [16, 16], s: [8, 12, 4], ov: [16, 32] },
  armR: { o: [40, 16], s: [4, 12, 4], ov: [40, 32] },
  armL: { o: [32, 48], s: [4, 12, 4], ov: [48, 48] },
  legR: { o: [0, 16], s: [4, 12, 4], ov: [0, 32] },
  legL: { o: [16, 48], s: [4, 12, 4], ov: [0, 48] },
};
function faceRect([ox, oy], [w, h, d], face) {
  switch (face) {
    case 'top': return [ox + d, oy, w, d];
    case 'bottom': return [ox + d + w, oy, w, d];
    case 'right': return [ox, oy + d, d, h];
    case 'front': return [ox + d, oy + d, w, h];
    case 'left': return [ox + d + w, oy + d, d, h];
    default: return [ox + 2 * d + w, oy + d, w, h]; // back
  }
}
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _n = new THREE.Vector3();
function skinUV(src, reg, texH, overlay) {
  let R = MC[reg.r], legacyMirror = false;
  if (texH === 32) {
    if (overlay && reg.r !== 'head') return null;
    if (reg.r === 'armL') { R = MC.armR; legacyMirror = true; }
    if (reg.r === 'legL') { R = MC.legR; legacyMirror = true; }
  }
  const o = overlay ? R.ov : R.o;
  const g = src.index ? src.toNonIndexed() : src.clone();
  const pos = g.attributes.position, nor = g.attributes.normal;
  const uv = new Float32Array(pos.count * 2);
  const m = reg.mirror ? -1 : 1, yo = reg.yOff || 0;
  const mn = reg.min, mx = reg.max;
  const minX = m > 0 ? mn[0] : -mx[0];
  const W = mx[0] - mn[0], H = mx[1] - mn[1], D = mx[2] - mn[2];
  for (let i = 0; i + 2 < pos.count; i += 3) {
    _a.fromBufferAttribute(pos, i + 1).sub(_b.fromBufferAttribute(pos, i));
    _n.fromBufferAttribute(pos, i + 2).sub(_b);
    _n.crossVectors(_a, _n);
    const nx = _n.x * m, ny = _n.y, nz = _n.z;
    const ax = Math.abs(nx), ay = Math.abs(ny), az = Math.abs(nz);
    let face = ax >= ay && ax >= az ? (nx > 0 ? 'left' : 'right') : ay >= az ? (ny > 0 ? 'top' : 'bottom') : (nz > 0 ? 'front' : 'back');
    if (legacyMirror && (face === 'left' || face === 'right')) face = face === 'left' ? 'right' : 'left';
    const [fx, fy, fw, fh] = faceRect(o, R.s, face);
    for (let k = 0; k < 3; k++) {
      const j = i + k;
      const x = pos.getX(j) * m, y = pos.getY(j) + yo, z = pos.getZ(j);
      const cx = (x - minX) / W, cy = (mx[1] - y) / H, cz = (z - mn[2]) / D;
      let u, v;
      switch (face) {
        case 'front': u = cx; v = cy; break;
        case 'back': u = 1 - cx; v = cy; break;
        case 'right': u = cz; v = cy; break;
        case 'left': u = 1 - cz; v = cy; break;
        case 'top': u = cx; v = cz; break;
        default: u = cx; v = 1 - cz;
      }
      u = Math.min(0.999, Math.max(0.001, u)); v = Math.min(0.999, Math.max(0.001, v));
      if (legacyMirror) u = 1 - u;
      uv[j * 2] = (fx + u * fw) / 64;
      uv[j * 2 + 1] = 1 - (fy + v * fh) / texH;
    }
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  if (overlay) { // casca externa
    const off = reg.r === 'head' ? 0.022 : 0.016;
    for (let i = 0; i < pos.count; i++) pos.setXYZ(i, pos.getX(i) + nor.getX(i) * off, pos.getY(i) + nor.getY(i) * off, pos.getZ(i) + nor.getZ(i) * off);
  }
  return g;
}

// Corpo simplificado (sem cabelo/olhos/roupas modeladas): a skin desenha tudo.
function buildSkinGeometries(ap) {
  const bw = BUILD_W[ap.build] || 1;
  const musc = ap.build === 'forte' ? 1.15 : ap.build === 'magro' ? 0.85 : 1;
  const aw = Math.min(1.35, 0.86 + (bw - 0.86) * 0.9);
  const lw = Math.min(1.3, 0.92 + (bw - 0.86) * 0.65);
  const W = 0xffffff;
  const mk = (reg) => { const p = new Parts(7); p.reg = reg; return p; };
  const xS = 1.1 * bw, zS = 0.7 * Math.max(1, bw * 0.9);
  const out = {};
  // cabeça
  const head = mk({ r: 'head', min: [-0.175, -0.03, -0.21], max: [0.175, 0.43, 0.215] });
  head.add(headGeoUnit(), W, 0, HEAD_Y, 0, HEAD_S.x, HEAD_S.y, HEAD_S.z);
  for (const sd of [-1, 1]) head.add(P.sphere, W, sd * 0.168, 0.2, -0.012, 0.016, 0.032, 0.024, 0.1, sd * 0.35, 0);
  head.add(capsule(0.012, 0.045), W, 0, 0.183, 0.193, 1.1, 1, 1, -0.4, 0, 0);
  head.add(P.sphere, W, 0, 0.153, 0.21, 0.017, 0.016, 0.019);
  out.head = [head];
  // tronco
  const prof = [[0.0, 0.16], [0.05, 0.19], [0.12, 0.19], [0.2, 0.172], [0.28, 0.168], [0.36, 0.18], [0.45, 0.2], [0.53, 0.212], [0.6, 0.205], [0.66, 0.18], [0.71, 0.13], [0.745, 0.075], [0.77, 0.04]];
  const tg = lathe(prof, 1, 26); tg.scale(xS, 1, zS);
  const tr = mk({ r: 'body', min: [-0.235 * xS, 0, -0.22 * zS], max: [0.235 * xS, 0.75, 0.22 * zS] });
  tr.add(tg, W);
  const front = 0.205 * zS;
  tr.add(P.sphere, W, 0, 0.535, front - 0.03, 0.17 * bw * musc, 0.065 * musc, 0.04 * musc);
  tr.add(P.sphere, W, -0.085 * bw, 0.665, -0.015, 0.1 * bw * musc, 0.05, 0.075);
  tr.add(P.sphere, W, 0.085 * bw, 0.665, -0.015, 0.1 * bw * musc, 0.05, 0.075);
  const neck = mk({ r: 'head', min: [-0.175, 0.77, -0.21], max: [0.175, 1.23, 0.215] });
  neck.add(lathe([[0.7, 0.068], [0.78, 0.062], [0.86, 0.058], [0.9, 0.055]], 1, 16), W);
  const shX = 0.231 * bw + 0.035;
  const dR = mk({ r: 'armR', min: [-shX - 0.08, -0.09 + 0.6 - 0.62, -0.08], max: [-shX + 0.08, 0.68, 0.08] });
  dR.add(P.sphere, W, -shX, 0.6, 0, 0.07 * aw * musc, 0.072 * aw, 0.076 * aw * musc);
  const dL = mk({ r: 'armL', min: [shX - 0.08, -0.09 + 0.6 - 0.62, -0.08], max: [shX + 0.08, 0.68, 0.08] });
  dL.add(P.sphere, W, shX, 0.6, 0, 0.07 * aw * musc, 0.072 * aw, 0.076 * aw * musc);
  out.torso = [tr, neck, dR, dL];
  // pernas (lado a lado, sem espelhamento)
  const legProf = [[-0.8, 0.058], [-0.74, 0.062], [-0.66, 0.07], [-0.58, 0.082], [-0.52, 0.084], [-0.46, 0.076], [-0.42, 0.078], [-0.36, 0.088], [-0.26, 0.102], [-0.14, 0.114], [-0.04, 0.12], [0.03, 0.11]];
  const legBox = (r, yOff) => ({ r, min: [-0.12 * lw, -0.84, -0.12 * lw], max: [0.12 * lw, 0.04, 0.12 * lw], yOff });
  for (const sd of ['R', 'L']) {
    const U = mk(legBox('leg' + sd, 0)), Dn = mk(legBox('leg' + sd, -0.42)), K = 0.42;
    U.add(lathe(legProf.filter(([y]) => y >= -0.46), lw), W);
    U.add(P.sphere, W, 0, -0.23, 0.03, 0.09 * lw, 0.14, 0.075 * lw);
    Dn.add(lathe(legProf.filter(([y]) => y <= -0.4), lw), W, 0, K);
    Dn.add(P.sphere, W, 0, -0.42 + K, -0.005, 0.082 * lw, 0.065, 0.082 * lw);
    Dn.add(P.sphere, W, 0, -0.55 + K, -0.03, 0.066 * lw, 0.1, 0.064 * lw);
    Dn.add(P.sphere, W, 0, -0.785 + K, 0.03, 0.07, 0.06, 0.12);
    out['leg' + sd + 'U'] = [U]; out['leg' + sd + 'D'] = [Dn];
  }
  // braços (esquerdo construído como direito e espelhado no rig)
  const upper = [[-0.31, 0.05], [-0.27, 0.056], [-0.21, 0.066], [-0.15, 0.07], [-0.09, 0.066], [-0.03, 0.07], [0.02, 0.06]].map(([y, r]) => [y, r + 0.01]);
  const fore = [[-0.57, 0.036], [-0.52, 0.04], [-0.45, 0.05], [-0.38, 0.058], [-0.33, 0.055], [-0.28, 0.05]].map(([y, r]) => [y, r + 0.008]);
  const armBox = (r, yOff, mirror) => ({ r, min: [-0.085 * aw, -0.69, -0.085 * aw], max: [0.085 * aw, 0.07, 0.085 * aw], yOff, mirror });
  for (const sd of ['R', 'L']) {
    const U = mk(armBox('arm' + sd, 0, sd === 'L')), Dn = mk(armBox('arm' + sd, -0.3, sd === 'L')), E = 0.3;
    U.add(lathe(upper, aw * musc), W);
    U.add(P.sphere, W, 0, -0.165, 0.022, 0.055 * aw * musc, 0.075, 0.05 * aw * musc);
    Dn.add(P.sphere, W, 0, 0, -0.008, 0.06 * aw, 0.06 * aw, 0.06 * aw);
    Dn.add(lathe(fore, aw), W, 0, E);
    Dn.add(P.sphere, W, 0, -0.615 + E, 0.004, 0.026, 0.055, 0.046);
    for (let f = 0; f < 4; f++) Dn.add(capsule(0.0105, 0.034), W, -0.004, -0.675 + E, -0.026 + f * 0.0175, 1, 1, 1, 0.12, 0, 0);
    Dn.add(capsule(0.012, 0.032), W, 0.014, -0.61 + E, 0.045, 1, 1, 1, 0.6, 0, -0.35);
    out['arm' + sd + 'U'] = [U]; out['arm' + sd + 'D'] = [Dn];
  }
  // aplica UVs e gera camada externa
  const texH = ap.skinH || 64;
  const res = {};
  for (const [k, list] of Object.entries(out)) {
    const base = [], over = [];
    for (const parts of list) for (const g of parts.list) {
      base.push(skinUV(g, g.userData.reg, texH, false));
      const ov = skinUV(g, g.userData.reg, texH, true);
      if (ov) over.push(ov);
      g.dispose();
    }
    res[k] = { base: mergeGeometries(base, false), over: over.length ? mergeGeometries(over, false) : null };
    base.concat(over).forEach((g) => g.dispose());
  }
  return res;
}
const skinTexCache = new Map();
function skinTexture(url) {
  let t = skinTexCache.get(url);
  if (!t) {
    t = new THREE.TextureLoader().load(url);
    t.colorSpace = THREE.SRGBColorSpace;
    t.magFilter = THREE.NearestFilter;
    t.minFilter = THREE.NearestMipmapLinearFilter;
    skinTexCache.set(url, t);
  }
  return t;
}

// Converte as partes em geometrias finais (pele/tecido/olhos; zumbis mesclam tudo)
function finalize(groups, zombie) {
  const res = {};
  const done = new Map();
  for (const [k, g] of Object.entries(groups)) {
    if (done.has(g)) { res[k] = done.get(g); continue; }
    let r;
    if (zombie) {
      const all = [...g.skin.list, ...g.cloth.list, ...g.eyes.list];
      r = { body: all.length ? mergeGeometries(all, false) : null };
      all.forEach((x) => x.dispose());
    } else {
      r = { skin: g.skin.merge(), cloth: g.cloth.merge(), eyes: g.eyes.merge() };
    }
    done.set(g, r);
    res[k] = r;
  }
  return res;
}

const zombieGeoCache = new Map();
const eyeMatCache = new Map();
function glowMat(color) {
  let m = eyeMatCache.get(color);
  if (!m) { m = new THREE.MeshBasicMaterial({ color }); eyeMatCache.set(color, m); }
  return m;
}

// ============================================================
//  MODELO EM BLOCOS (padrão): mesma articulação do rig, skin em pixel art
// ============================================================
const blockyGeoCache = new Map();
function buildBlockyHumanoid(ap, opts = {}) {
  const zombie = !!opts.zombie, shadows = opts.shadows !== false;
  let tex, extras = [], texH = 64;
  if (!zombie && ap.skinPng) { tex = skinTexture(ap.skinPng); texH = ap.skinH === 32 ? 32 : 64; }
  else {
    const sk = zombie ? paintZombieSkin(ap._type || 'andarilho', ap, ap._variant || 0) : paintPlayerSkin(ap);
    tex = canvasTexture(sk.canvas); extras = sk.extras;
  }
  const gkey = JSON.stringify([ap.build, ap.body || 'm', texH, extras]);
  let built = blockyGeoCache.get(gkey);
  if (!built) { built = buildBlockyGeometries(ap, extras, texH); blockyGeoCache.set(gkey, built); }
  const { geos, dims: D } = built;
  const mat = new THREE.MeshStandardMaterial({ map: tex, alphaTest: 0.5, roughness: 0.86, metalness: 0 });
  const mats = [mat];
  const add = (parent, geo) => { if (!geo) return; const m = new THREE.Mesh(geo, mat); m.castShadow = shadows; m.receiveShadow = !zombie; parent.add(m); };
  const root = new THREE.Group(), body = new THREE.Group();
  root.add(body);
  const hipY = 0.88;
  const makeLeg = (side) => {
    const g = new THREE.Group(); g.position.set(side * D.legW / 2, hipY, 0);
    add(g, geos[side < 0 ? 'legRU' : 'legLU']);
    const knee = new THREE.Group(); knee.position.y = -0.42;
    add(knee, geos[side < 0 ? 'legRD' : 'legLD']);
    g.add(knee); body.add(g);
    return { g, knee };
  };
  const LR = makeLeg(-1), LL = makeLeg(1);
  const torso = new THREE.Group(); torso.position.y = hipY; body.add(torso);
  add(torso, geos.torso);
  const head = new THREE.Group(); head.position.y = D.bodyH; torso.add(head);
  add(head, geos.head);
  let em = null;
  if (zombie) { // olhos brilhantes nas órbitas pintadas
    em = glowMat(ap.eyes);
    const u = D.head / 8, eyeGeo = blockyEyeGeo || (blockyEyeGeo = new THREE.BoxGeometry(1, 1, 1));
    for (const col of [2, 6]) {
      const e = new THREE.Mesh(eyeGeo, em);
      e.scale.set(u * 0.9, u * 0.55, 0.012);
      e.position.set((col - 4) * u + (col === 2 ? -u * 0.1 : u * 0.1), D.head - 4.25 * u, D.head / 2 + 0.008);
      head.add(e);
    }
  }
  const makeArm = (side, gu, gd) => {
    const grp = new THREE.Group(); grp.position.set(side * (D.bodyW / 2 + D.armW / 2), D.bodyH - 0.04, 0);
    grp.rotation.order = 'YXZ';
    add(grp, gu);
    const elbow = new THREE.Group(); elbow.position.y = -0.3; add(elbow, gd); grp.add(elbow);
    const hand = new THREE.Group(); hand.position.y = -0.33; elbow.add(hand);
    torso.add(grp);
    return { g: grp, elbow, hand };
  };
  const R = makeArm(-1, geos.armRU, geos.armRD), L = makeArm(1, geos.armLU, geos.armLD);
  const s = ap.height || 1;
  body.scale.setScalar(s);
  return {
    root, body, torso, head, legL: LL.g, legR: LR.g, kneeL: LL.knee, kneeR: LR.knee,
    armR: R.g, armL: L.g, elbowR: R.elbow, elbowL: L.elbow, handR: R.hand, handL: L.hand,
    mats, eyeMat: em, bw: D.bw, height: 1.9 * s, blocky: true, dims: D,
    backZ: -(D.bodyD / 2) - (zombie || ap.skinPng ? 0.04 : 0.18),
    weapon: null, weaponL: null, muzzle: null,
    setFlash(v) { for (const m of mats) m.emissive.setRGB(v, v * 0.15, v * 0.1); },
    setEyeColor(color) {
      if (!zombie) return;
      const m = glowMat(color);
      head.children.forEach((c) => { if (c.material === this.eyeMat) c.material = m; });
      this.eyeMat = m;
    },
    setWeapon: HUMANOID_API.setWeapon,
    holster: null,
    setHolster: HUMANOID_API.setHolster,
    dispose() { mats.forEach((m) => m.dispose()); }, // geometrias e texturas ficam em cache (compartilhadas)
  };
}
let blockyEyeGeo = null;

export function buildHumanoid(ap, opts = {}) {
  if (!opts.round) return buildBlockyHumanoid(ap, opts);
  reliefTextures();
  const zombie = !!opts.zombie;
  const bw = BUILD_W[ap.build] || 1;
  let geos;
  const key = zombie && ap._key;
  const skinMode = !zombie && !!ap.skinPng;
  if (skinMode) geos = buildSkinGeometries(ap);
  else if (key && zombieGeoCache.has(key)) geos = zombieGeoCache.get(key);
  else {
    geos = finalize(buildGeometries(ap, zombie), zombie);
    geos.legRU = geos.legLU = geos.legU; geos.legRD = geos.legLD = geos.legD;
    if (key) zombieGeoCache.set(key, geos);
  }
  const shadows = opts.shadows !== false;
  const mats = [];
  let skinMat, clothMat, eyeMat, bodyMat;
  let baseMat, overMat;
  if (skinMode) {
    const tex = skinTexture(ap.skinPng);
    baseMat = new THREE.MeshStandardMaterial({ map: tex, vertexColors: true, roughness: 0.78, metalness: 0 });
    overMat = new THREE.MeshStandardMaterial({ map: tex, vertexColors: true, roughness: 0.85, metalness: 0, alphaTest: 0.5, side: THREE.DoubleSide });
    mats.push(baseMat, overMat);
  } else if (zombie) {
    bodyMat = new THREE.MeshStandardMaterial({ map: grimeTex, vertexColors: true, roughness: 0.88, metalness: 0, bumpMap: fabricTex, bumpScale: 1.2 });
    mats.push(bodyMat);
  } else {
    skinMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.58, metalness: 0, bumpMap: skinTex, bumpScale: 0.4 });
    clothMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0, bumpMap: fabricTex, bumpScale: 1.6 });
    eyeMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.12, metalness: 0 });
    mats.push(skinMat, clothMat, eyeMat);
  }
  const add = (parent, g) => {
    const list = skinMode ? [[g.base, baseMat], [g.over, overMat]] : zombie ? [[g.body, bodyMat]] : [[g.skin, skinMat], [g.cloth, clothMat], [g.eyes, eyeMat]];
    for (const [geo, m] of list) {
      if (!geo) continue;
      const mesh = new THREE.Mesh(geo, m);
      mesh.castShadow = shadows;
      mesh.receiveShadow = !zombie;
      parent.add(mesh);
    }
  };

  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const hipY = 0.88;
  const makeLeg = (side) => {
    const g = new THREE.Group();
    g.position.set(side * 0.1 * Math.min(bw, 1.35), hipY, 0);
    add(g, geos[side < 0 ? 'legRU' : 'legLU']);
    const knee = new THREE.Group();
    knee.position.y = -0.42;
    add(knee, geos[side < 0 ? 'legRD' : 'legLD']);
    g.add(knee);
    body.add(g);
    return { g, knee };
  };
  const LR = makeLeg(-1), LL = makeLeg(1);
  const legR = LR.g, legL = LL.g;

  const torso = new THREE.Group();
  torso.position.y = hipY;
  body.add(torso);
  add(torso, geos.torso);

  const head = new THREE.Group();
  head.position.y = 0.8;
  // proporção realista: cabeça ~1/6 da altura (antes ~1/4.7, aspecto de boneco).
  // Escala a partir da base: o pescoço continua entrando na mandíbula.
  if (!skinMode) head.scale.setScalar(HEAD_SCALE);
  torso.add(head);
  add(head, geos.head);
  const modeledHairGeo = skinMode ? addModeledHair(head, ap, mats, shadows) : null;
  // zumbis: íris brilhantes (material separado para cor por rank)
  let em = null;
  if (zombie) {
    em = glowMat(ap.eyes);
    for (const sx of [-0.058, 0.058]) {
      const e = new THREE.Mesh(P.sphereLo, em);
      e.position.set(sx, 0.222, 0.189);
      e.scale.set(0.014, 0.012, 0.006);
      head.add(e);
    }
  }

  const sx = 0.231 * bw + 0.055;
  const makeArm = (side, gu, gd) => {
    const grp = new THREE.Group();
    grp.position.set(side * sx, 0.6, 0);
    grp.rotation.order = 'YXZ';
    const mirror = (parent, geo) => { const inner = new THREE.Group(); if (side > 0) inner.scale.x = -1; add(inner, geo); parent.add(inner); };
    mirror(grp, gu);
    const elbow = new THREE.Group();
    elbow.position.y = -0.3;
    mirror(elbow, gd);
    grp.add(elbow);
    const hand = new THREE.Group();
    hand.position.y = -0.33;
    elbow.add(hand);
    torso.add(grp);
    return { g: grp, elbow, hand };
  };
  const R = makeArm(-1, geos.armRU, geos.armRD), L = makeArm(1, geos.armLU, geos.armLD);

  const s = ap.height || 1;
  body.scale.setScalar(s);

  return {
    root, body, torso, head, legL, legR, kneeL: LL.knee, kneeR: LR.knee,
    armR: R.g, armL: L.g, elbowR: R.elbow, elbowL: L.elbow, handR: R.hand, handL: L.hand,
    mats, eyeMat: em, bw, height: 1.85 * s,
    weapon: null, weaponL: null, muzzle: null,
    setFlash(v) { for (const m of mats) m.emissive.setRGB(v, v * 0.15, v * 0.1); },
    setEyeColor(color) {
      if (!zombie) return;
      const m = glowMat(color);
      head.children.forEach((c) => { if (c.material === this.eyeMat) c.material = m; });
      this.eyeMat = m;
    },
    setWeapon: HUMANOID_API.setWeapon,
    _unusedSetWeapon(w) {
      if (this.weapon) { this.handR.remove(this.weapon); this.weapon = null; }
      if (this.weaponL) { this.handL.remove(this.weaponL); this.weaponL = null; }
      if (!w) return;
      const built = buildWeapon(w.base, w.rarity);
      this.weapon = built.group; this.muzzle = built.muzzle;
      // Origem da arma no centro da palma; a empunhadura fica entre polegar e dedos.
      built.group.position.set(0, -0.04, WEAPONS[w.base].type === 'gun' ? 0.11 : 0.055);
      if (WEAPONS[w.base].type !== 'gun') {
        // A lâmina sobe para a frente (+Z), sem atravessar rosto ou ombro.
        built.group.rotation.x = Math.PI + 1.4;
        built.group.rotation.y = 0.55;
      }
      this.handR.add(built.group);
      if (WEAPONS[w.base].dual) {
        const b2 = buildWeapon(w.base, w.rarity);
        b2.group.position.copy(built.group.position);
        b2.group.rotation.x = built.group.rotation.x;
        b2.group.rotation.y = -built.group.rotation.y;
        this.weaponL = b2.group; this.handL.add(b2.group);
      }
    },
    // Arma reserva guardada no corpo: lâmina ou arma longa atravessada nas costas
    // (cabo/cano sobre o ombro direito), pistola no coldre do quadril direito.
    // Armas: eixo principal em -Y (ponta/cano), cabo/coronha na origem, topo em +Z.
    holster: null,
    setHolster: HUMANOID_API.setHolster,
    _unusedSetHolster(w) {
      if (this.holster) { this.holster.parent && this.holster.parent.remove(this.holster); this.holster = null; }
      if (!w || !WEAPONS[w.base]) return;
      const built = buildWeapon(w.base, w.rarity);
      const g = new THREE.Group();
      g.add(built.group);
      const W = WEAPONS[w.base], backZ = -(0.2 * 0.7 * Math.max(1, bw * 0.9)) - (zombie ? 0.04 : 0.2);
      if (W.type === 'gun' && w.base === 'pistola') {
        g.position.set(-(0.2 * bw + 0.05), 0.16, 0.02); // coldre: cano para baixo, no quadril direito
        g.rotation.set(0.12, Math.PI / 2, 0.05);
      } else if (W.type === 'gun') {
        built.group.rotation.x = Math.PI; // cano para cima (bandoleira)
        g.position.set(0.12, 0.2, backZ); // coronha no quadril esquerdo, cano sobe até o ombro direito
        g.rotation.set(0, Math.PI, -0.55);
      } else {
        g.position.set(-0.14, 0.72, backZ); // cabo sobre o ombro direito, lâmina desce até o quadril esquerdo
        g.rotation.set(0, Math.PI, -0.5);
      }
      this.torso.add(g);
      this.holster = g;
    },
    dispose() {
      mats.forEach((m) => m.dispose());
      modeledHairGeo?.dispose();
      if (!key || skinMode) {
        const seen = new Set();
        for (const g of Object.values(geos)) for (const geo of Object.values(g)) if (geo && !seen.has(geo)) { seen.add(geo); geo.dispose(); }
      }
    },
  };
}

// Métodos compartilhados pelos dois modelos (usam this.*)
const HUMANOID_API = {
  setWeapon(w) {
    if (this.weapon) { this.handR.remove(this.weapon); this.weapon = null; }
    if (this.weaponL) { this.handL.remove(this.weaponL); this.weaponL = null; }
    if (!w) return;
    const built = buildWeapon(w.base, w.rarity);
    this.weapon = built.group; this.muzzle = built.muzzle;
    // Origem da arma no centro da palma; a empunhadura fica entre polegar e dedos.
    built.group.position.set(0, -0.04, WEAPONS[w.base].type === 'gun' ? 0.11 : 0.055);
    if (WEAPONS[w.base].type !== 'gun') {
      built.group.rotation.x = Math.PI + 1.4;
      built.group.rotation.y = 0.55;
    }
    this.handR.add(built.group);
    if (WEAPONS[w.base].dual) {
      const b2 = buildWeapon(w.base, w.rarity);
      b2.group.position.copy(built.group.position);
      b2.group.rotation.x = built.group.rotation.x;
      b2.group.rotation.y = -built.group.rotation.y;
      this.weaponL = b2.group; this.handL.add(b2.group);
    }
  },
  // Arma reserva no corpo: lâmina/arma longa nas costas, pistola no coldre do quadril direito.
  // Armas: eixo principal em -Y (ponta/cano), cabo/coronha na origem, topo em +Z.
  setHolster(w) {
    if (this.holster) { this.holster.parent && this.holster.parent.remove(this.holster); this.holster = null; }
    if (!w || !WEAPONS[w.base]) return;
    const built = buildWeapon(w.base, w.rarity);
    const g = new THREE.Group();
    g.add(built.group);
    const W = WEAPONS[w.base], backZ = this.backZ ?? -0.34, halfW = this.dims ? this.dims.bodyW / 2 : 0.2 * this.bw;
    if (W.type === 'gun' && w.base === 'pistola') {
      g.position.set(-(halfW + 0.05), 0.16, 0.02);
      g.rotation.set(0.12, Math.PI / 2, 0.05);
    } else if (W.type === 'gun') {
      built.group.rotation.x = Math.PI;
      g.position.set(0.12, 0.2, backZ);
      g.rotation.set(0, Math.PI, -0.55);
    } else {
      g.position.set(-0.14, 0.72, backZ);
      g.rotation.set(0, Math.PI, -0.5);
    }
    this.torso.add(g);
    this.holster = g;
  },
};

// ---------- Armas ----------
// Espaço da mão: o braço aponta para -Y; "cima" da arma = +Z.
const wmatCache = new Map();
function wmat(key, make) { let m = wmatCache.get(key); if (!m) { m = make(); wmatCache.set(key, m); } return m; }
function wm(geo, material, x, y, z, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
  const m = new THREE.Mesh(geo, material);
  m.position.set(x, y, z); m.rotation.set(rx, ry, rz); m.scale.set(sx, sy, sz);
  m.castShadow = true;
  return m;
}
const bladeGeoCache = new Map();
function bladeGeo(len, width, curve) {
  const k = len + '_' + width + '_' + curve;
  if (bladeGeoCache.has(k)) return bladeGeoCache.get(k);
  const vertices = [], indices = [], sections = 16;
  for (let i = 0; i <= sections; i++) {
    const t = i / sections, cx = curve * t * t;
    const half = Math.max(0.0008, width * 0.5 * Math.pow(1 - t, 0.65));
    const thick = Math.max(0.001, 0.012 * (1 - t));
    const y = -len * t;
    vertices.push(cx - half, y, 0, cx, y, thick, cx + half, y, 0, cx, y, -thick);
    if (i < sections) for (let j = 0; j < 4; j++) {
      const n = i * 4 + j, next = i * 4 + (j + 1) % 4;
      indices.push(n, n + 4, next, next, n + 4, next + 4);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  g.setIndex(indices);
  g.computeVertexNormals();
  bladeGeoCache.set(k, g);
  return g;
}

export function buildWeapon(baseId, rarity = 0) {
  const b = WEAPONS[baseId];
  const g = new THREE.Group();
  const metal = wmat('metal', () => mat(0x2b2d30, { metalness: 0.7, roughness: 0.35 }));
  const metal2 = wmat('metal2', () => mat(0x4a4d52, { metalness: 0.7, roughness: 0.4 }));
  const wood = wmat('wood', () => mat(0x6b4423, { roughness: 0.7 }));
  const rcol = RARITIES[rarity].hex;
  const glow = [0, 0, 0.3, 0.6, 1.1][rarity];
  const muzzle = new THREE.Object3D();
  const C = P.cyl, S = P.sphere;
  if (b.type === 'gun') {
    const L = b.len;
    const pistol = baseId === 'pistola', shotgun = baseId === 'escopeta';
    const sniper = baseId === 'precisao';
    const accent = wmat('acc' + rarity, () => mat(rarity >= 2 ? rcol : 0x3a3a3a, { emissive: rarity >= 2 ? rcol : 0x000000, emissiveIntensity: glow * 0.7, metalness: 0.5, roughness: 0.35 }));
    const grip = wmat('gunGrip', () => mat(0x17191c, { roughness: 0.9 }));
    const receiverY = -L * (pistol ? 0.38 : 0.29);
    const bodyLen = Math.max(0.16, L * (pistol ? 0.65 : 0.43));
    g.add(wm(capsule(0.052, bodyLen * 0.78), metal2, 0, receiverY, 0.055, 0, 0, 0, 1.04, 1, 1.12));
    g.add(wm(box(0.085, bodyLen * 0.68, 0.075), metal, 0, receiverY, 0.066));
    for (const side of [-1, 1]) {
      g.add(wm(box(0.008, bodyLen * 0.78, 0.082), metal, side * 0.065, receiverY, 0.057));
      g.add(wm(box(0.008, bodyLen * 0.46, 0.009), accent, side * 0.071, receiverY - bodyLen * 0.09, 0.102));
      for (let j = 0; j < 3; j++) g.add(wm(box(0.009, 0.012, 0.018), grip, side * 0.073, receiverY + bodyLen * (0.24 - j * 0.13), 0.07));
    }
    // Empunhadura fica no centro dos dedos, sem cruzar o antebraço.
    g.add(wm(capsule(0.037, 0.09), grip, 0, 0.013, -0.06, -0.28, 0, 0, 1, 1, 1.1));
    g.add(wm(box(0.08, 0.015, 0.08), metal, 0, 0.104, -0.047));
    g.add(wm(C, metal, 0, -L * 0.75, 0.07, 0, 0, 0, shotgun ? 0.033 : 0.024, L * 0.48, shotgun ? 0.033 : 0.024));
    g.add(wm(C, grip, 0, -L + 0.015, 0.07, 0, 0, 0, shotgun ? 0.039 : 0.03, 0.035, shotgun ? 0.039 : 0.03));
    g.add(wm(C, metal2, 0, -L - 0.003, 0.07, 0, 0, 0, 0.016, 0.006, 0.016));
    if (!pistol) {
      g.add(wm(box(0.105, Math.max(0.13, L * 0.24), 0.095), shotgun ? wood : metal, 0, -L * 0.58, 0.045));
      for (let j = 0; j < 4; j++) g.add(wm(box(0.09, 0.008, 0.008), grip, 0, -L * 0.5 - j * 0.024, 0.096));
      g.add(wm(box(0.08, 0.22, 0.075), shotgun ? wood : grip, 0, 0.19, 0.035, 0.22));
      g.add(wm(box(0.115, 0.025, 0.10), grip, 0, 0.3, 0.028, 0.22));
      g.add(wm(box(0.062, 0.11, 0.075), metal, 0, -L * 0.17, -0.048, -0.16));
      g.add(wm(box(0.046, 0.08, 0.009), accent, 0, -L * 0.17, -0.09, -0.16));
      g.add(wm(box(0.055, L * 0.37, 0.014), grip, 0, -L * 0.36, 0.128));
      for (let j = 0; j < 4; j++) g.add(wm(box(0.08, 0.01, 0.008), metal2, 0, -L * 0.24 - j * 0.03, 0.139));
      if (shotgun) g.add(wm(C, metal2, 0, -L * 0.73, 0.018, 0, 0, 0, 0.018, L * 0.35, 0.018));
    } else {
      g.add(wm(box(0.105, 0.055, 0.11), grip, 0, -L * 0.65, 0.06));
      for (let j = 0; j < 3; j++) g.add(wm(box(0.11, 0.007, 0.009), grip, 0, -L * 0.55 - j * 0.022, 0.124));
    }
    // Alça, massa e óptica acompanham o cano.
    const triggerGuard = wm(new THREE.TorusGeometry(0.035, 0.005, 6, 16), metal, 0, -L * 0.12, -0.023);
    triggerGuard.rotation.y = Math.PI / 2;
    triggerGuard.scale.y = 0.72;
    g.add(triggerGuard);
    g.add(wm(box(0.045, 0.02, 0.035), metal, 0, receiverY + bodyLen * 0.25, 0.14));
    g.add(wm(box(0.018, 0.012, 0.026), metal, 0, -L * 0.91, 0.115));
    if (sniper) {
      const lens = wmat('lens', () => mat(0x345a78, { emissive: 0x112e45, metalness: 0.5, roughness: 0.1 }));
      g.add(wm(C, metal, 0, -L * 0.37, 0.185, 0, 0, 0, 0.04, 0.3, 0.04));
      g.add(wm(C, lens, 0, -L * 0.37 - 0.15, 0.185, 0, 0, 0, 0.032, 0.008, 0.032));
      g.add(wm(box(0.038, 0.04, 0.045), metal2, 0, -L * 0.37, 0.14));
    }
    muzzle.position.set(0, -L - 0.01, 0.07);
  } else {
    const L = b.len;
    const bladeMat = wmat('blade' + rarity, () => mat(0xdfe5ea, { metalness: 0.9, roughness: 0.2, emissive: rcol, emissiveIntensity: glow }));
    const handle = wmat('handle', () => mat(0x1c1c22, { roughness: 0.6 }));
    const gold = wmat('gold', () => mat(0xb08d3a, { metalness: 0.8, roughness: 0.3 }));
    if (b.pole) {
      g.add(wm(C, wmat('pole', () => mat(0x4a3520)), 0, -L / 2 + 0.45, 0, 0, 0, 0, 0.026, L, 0.026));
      g.add(wm(C, gold, 0, -L + 0.48, 0, 0, 0, 0, 0.034, 0.05, 0.034));
      g.add(wm(bladeGeo(0.52, 0.07, 0.06), bladeMat, 0, -L + 0.46, 0));
    } else {
      g.add(wm(C, handle, 0, -0.02, 0, 0, 0, 0, 0.026, 0.26, 0.026));
      g.add(wm(S, gold, 0, 0.12, 0, 0, 0, 0, 0.032, 0.022, 0.032));
      g.add(wm(C, gold, 0, -0.155, 0, 0, 0, 0, 0.053, 0.014, 0.048));
      const curve = b.wide ? 0.02 : baseId === 'faca' ? 0.01 : 0.05 * L;
      g.add(wm(bladeGeo(L, b.wide ? 0.13 : 0.05, curve), bladeMat, 0, -0.165, 0));
      // Espinha e canal de alívio distinguem a lâmina do cabo e da guarda.
      const steelEdge = wmat('steelEdge', () => mat(0xf6f7f4, { metalness: 0.95, roughness: 0.13 }));
      g.add(wm(box(0.003, L * 0.5, 0.002), steelEdge, b.wide ? -0.035 : -0.013, -0.22 - L * 0.25, 0.004, 0, 0, -curve * 0.1));
      for (let i = 0; i < 5; i++) {
        const wrap = wmat('gripWrap', () => mat(0x4e4240, { roughness: 0.9 }));
        g.add(wm(box(0.058, 0.008, 0.053), wrap, 0, 0.052 - i * 0.041, 0, 0, 0, i % 2 ? 0.2 : -0.2));
      }
      if (baseId === 'katana') {
        const wrap = wmat('wrap', () => mat(0x9a3430, { roughness: 0.82 }));
        const guard = new THREE.Mesh(new THREE.TorusGeometry(0.068, 0.012, 6, 18), gold);
        guard.rotation.x = Math.PI / 2; guard.position.y = -0.145; g.add(guard);
        for (let i = 0; i < 5; i++) {
          const band = wm(C, wrap, 0, 0.045 - i * 0.037, 0, 0, 0, 0, 0.031, 0.009, 0.031);
          band.rotation.z = i % 2 ? 0.3 : -0.3; g.add(band);
        }
        g.add(wm(C, metal2, 0, -0.34, 0, 0, 0, 0, 0.035, 0.018, 0.035));
      } else if (baseId !== 'faca') {
        const spine = wm(C, metal2, 0, -Math.max(0.35, L * 0.56), 0.021, 0, 0, 0, 0.009, L * 0.62, 0.008);
        g.add(spine);
      }
    }
    muzzle.position.set(0, -L, 0);
  }
  g.add(muzzle);
  return { group: g, muzzle };
}

// ---------- Aparência de zumbis (variações em cache) ----------
// pele em decomposição: cinza-oliva pálido, sem o verde "de brinquedo"
const Z_SKIN = [0x8d9478, 0x9a9a84, 0x7f8a6c, 0xa39c86, 0x868c74, 0x9c9a7e, 0x78806a];
const Z_CLOTH = [0x4a4038, 0x3a3e44, 0x5a3030, 0x2f3a2f, 0x5c5446, 0x3d3550, 0x6a5a40, 0x2a2a2a, 0x4a3a5a];
export const ZOMBIE_VARIANTS = 6;
export function zombieAppearance(type, variant = Math.floor(Math.random() * ZOMBIE_VARIANTS)) {
  let hsh = 0;
  for (const ch of type) hsh = (hsh * 31 + ch.charCodeAt(0)) | 0;
  const r = mulberry32(hsh + variant * 977);
  const ap = {
    _key: type + ':' + variant, _type: type, _variant: variant,
    skin: pick(Z_SKIN, r), hair: pick([0x1a1a1a, 0x3a2a1a, 0x555555, 0x6a5a3a], r),
    hairStyle: pick(['careca', 'ralo', 'curto', 'longo', 'ralo'], r), beard: r() < 0.25 ? 'barba' : 'nenhuma',
    eyes: pick([0xff3a1a, 0xd8ff3a, 0xffb000], r), top: pick(Z_CLOTH, r), pants: pick(Z_CLOTH, r), shoes: 0x2a2420,
    accessory: 'nenhum', build: 'normal', height: 0.94 + r() * 0.12,
    sleeves: r() < 0.5 ? 'short' : 'long', tornArm: r() < 0.4, tornPants: r() < 0.3,
  };
  // ~1/3 das variações são mulheres (cabelo comprido, sem barba)
  ap.body = r() < 0.35 && type !== 'brutamontes' ? 'f' : 'm';
  if (ap.body === 'f') { ap.beard = 'nenhuma'; if (ap.hairStyle !== 'careca') ap.hairStyle = 'longo'; }
  if (type === 'blindado') { ap.top = 0x4b5320; ap.pants = 0x3d4220; ap.accessory = 'capacete'; ap.build = 'forte'; ap.hairStyle = 'careca'; ap.sleeves = 'long'; ap.tornArm = false; }
  if (type === 'brutamontes') { ap.build = 'gordo'; ap.hairStyle = 'careca'; ap.top = pick([0x6a5a4a, 0x4a3a2a], r); ap.sleeves = 'short'; }
  if (type === 'corredor') { ap.build = 'magro'; }
  if (type === 'cuspidor') { ap.build = 'magro'; ap.skin = 0x8f9a62; ap.eyes = 0xc8ff00; }
  if (type === 'explosivo') { ap.build = 'gordo'; ap.skin = 0x9c8a66; ap.eyes = 0xff6a00; ap.sleeves = 'short'; }
  return ap;
}

// Detalhes específicos por tipo (malhas separadas porque algumas animam)
const decoMats = {};
function dmat(k, make) { return decoMats[k] || (decoMats[k] = make()); }
export function decorateZombie(rig, type) {
  const extras = {};
  if (rig.blocky) {
    const D = rig.dims, mat = rig.mats[0];
    if (type === 'cuspidor') {
      const sac = new THREE.Group(); sac.position.set(0, 0.02, D.head / 2 + 0.03); // papo inchado sob o queixo
      const m = new THREE.Mesh(atlasBox(0.22, 0.13, 0.1, XR.acc), mat); m.castShadow = true; sac.add(m);
      rig.head.add(sac); extras.sac = sac;
    }
    if (type === 'explosivo') {
      const belly = new THREE.Group(); belly.position.set(0, 0.28, D.bodyD / 2 + 0.07);
      const m = new THREE.Mesh(atlasBox(D.bodyW * 0.82, 0.36, 0.16, XR.pack), mat); m.castShadow = true; belly.add(m);
      rig.torso.add(belly); extras.belly = belly;
    }
    if (type === 'brutamontes') {
      for (let i = 0; i < 4; i++) {
        const sp = new THREE.Mesh(atlasBox(0.06, 0.22, 0.06, XR.hair), mat);
        sp.position.set((i - 1.5) * 0.13, D.bodyH - 0.06 - Math.abs(i - 1.5) * 0.05, -D.bodyD / 2 - 0.05);
        sp.rotation.x = -0.75; rig.torso.add(sp);
      }
    }
    return extras;
  }
  // Partes que pulsam (bolsa de ácido, barriga) ficam num pivô de escala 1:
  // zombies.js anima a escala do pivô (1 → 1.4), o tamanho real fica na malha interna.
  if (type === 'cuspidor') {
    const sac = new THREE.Group();
    sac.position.set(0, 0.055, 0.105); // papo inchado sob a mandíbula
    const m = new THREE.Mesh(P.sphere, dmat('sac', () => mat(0x9fb84a, { emissive: 0x6a9a10, emissiveIntensity: 0.22, roughness: 0.28 })));
    m.scale.set(0.075, 0.062, 0.07);
    sac.add(m);
    const vein = dmat('sacVein', () => mat(0x4a5a1a, { roughness: 0.6 }));
    for (let i = 0; i < 3; i++) { const v = new THREE.Mesh(P.sphereLo, vein); v.position.set((i - 1) * 0.03, 0.01 - Math.abs(i - 1) * 0.012, 0.062); v.scale.set(0.006, 0.03, 0.006); v.rotation.z = (i - 1) * 0.5; sac.add(v); }
    rig.head.add(sac);
    extras.sac = sac;
  }
  if (type === 'explosivo') {
    const belly = new THREE.Group();
    belly.position.set(0, 0.29, 0.1);
    reliefTextures();
    const m = new THREE.Mesh(P.sphere, dmat('belly', () => new THREE.MeshStandardMaterial({ color: 0xb09a72, map: grimeTex, emissive: 0xff4a00, emissiveIntensity: 0.08, roughness: 0.38, bumpMap: skinTex, bumpScale: 0.6 })));
    m.scale.set(0.3, 0.32, 0.29); // saliente para a frente, integrada ao tronco
    m.position.y = -0.02;
    belly.add(m);
    // veias escuras e poucas pústulas, coladas à superfície da barriga
    const vm = dmat('vein', () => mat(0x4a3a4a, { roughness: 0.6 }));
    const pm = dmat('pus', () => mat(0xc8b25a, { emissive: 0x8a5a00, emissiveIntensity: 0.25, roughness: 0.3 }));
    const n = new THREE.Vector3();
    for (let i = 0; i < 9; i++) {
      const a = -0.8 + i * 0.2, b = Math.sin(i * 2.3) * 0.45, pus = i % 4 === 1;
      n.set(Math.sin(a) * Math.cos(b), Math.sin(b), Math.cos(a) * Math.cos(b));
      const p = new THREE.Mesh(P.sphereLo, pus ? pm : vm);
      p.position.set(n.x * 0.3, n.y * 0.32 - 0.02, n.z * 0.29);
      if (pus) p.scale.setScalar(0.022);
      else { p.scale.set(0.006, 0.05, 0.004); p.lookAt(p.position.clone().multiplyScalar(2)); p.rotateZ(i); } // eixo longo (Y) tangente à pele
      belly.add(p);
    }
    rig.torso.add(belly);
    extras.belly = belly;
  }
  if (type === 'blindado') {
    const vest = new THREE.Mesh(capsule(0.2, 0.22), dmat('vest', () => mat(0x2e3320, { roughness: 0.6, metalness: 0.25 })));
    vest.position.set(0, 0.4, 0); vest.scale.set(1.28 * rig.bw, 1, 0.78);
    rig.torso.add(vest);
  }
  if (type === 'brutamontes') {
    const bone = dmat('bone', () => mat(0xd8d0b8, { roughness: 0.5 }));
    for (let i = 0; i < 4; i++) {
      const s = new THREE.Mesh(P.cone, bone);
      s.scale.set(0.05, 0.24, 0.05);
      s.position.set((i - 1.5) * 0.14, 0.62 - Math.abs(i - 1.5) * 0.05, -0.22);
      s.rotation.x = -0.9;
      rig.torso.add(s);
    }
  }
  return extras;
}
