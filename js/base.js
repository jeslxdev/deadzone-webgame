// ============================================================
//  BASE DOS SOBREVIVENTES (zona segura dentro do mapa)
//  Tudo em blocos com pixel art, no mesmo estilo das skins:
//  muro de barreiras de concreto + sacos de areia + arame farpado,
//  torres de vigia, portões (cancela e placa), barracas de lona com
//  telhado em degraus, caminhão militar, suprimentos, gerador, rádio,
//  mastro com bandeira e varal de lâmpadas sobre a fogueira.
//  As peças são agrupadas por material e fundidas (poucas draw calls).
// ============================================================
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { PIX } from './pixtex.js';

// ---------- texturas próprias (placa e zebrado vermelho/branco) ----------
function canvasTex(w, h, draw) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestMipmapLinearFilter;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}
const hazardTex = () => canvasTex(16, 2, (g) => { for (let x = 0; x < 16; x += 4) { g.fillStyle = (x / 4) % 2 ? '#e8e4dc' : '#b82a20'; g.fillRect(x, 0, 4, 2); } });
// placa "ZONA SEGURA": texto desenhado e binarizado para virar pixel art
const signTex = () => canvasTex(64, 16, (g, w, h) => {
  g.fillStyle = '#2e3a24'; g.fillRect(0, 0, w, h);
  g.fillStyle = '#e8dcb0'; g.font = 'bold 9px monospace'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText('ZONA SEGURA', w / 2, h / 2 + 1);
  const img = g.getImageData(0, 0, w, h), d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const on = d[i] > 130;
    d[i] = on ? 232 : 46; d[i + 1] = on ? 220 : 58; d[i + 2] = on ? 176 : 36; d[i + 3] = 255;
  }
  for (let x = 0; x < w; x++) for (const y of [0, h - 1]) { const k = (y * w + x) * 4; d[k] = 120; d[k + 1] = 96; d[k + 2] = 60; } // moldura
  for (let y = 0; y < h; y++) for (const x of [0, w - 1]) { const k = (y * w + x) * 4; d[k] = 120; d[k + 1] = 96; d[k + 2] = 60; }
  for (const [x, y] of [[2, 2], [w - 3, 2], [2, h - 3], [w - 3, h - 3]]) { const k = (y * w + x) * 4; d[k] = d[k + 1] = d[k + 2] = 150; } // parafusos
  g.putImageData(img, 0, 0);
});

// ---------- materiais (compartilhados entre partidas) ----------
// uv: 'box' = textura inteira em cada face; [tu, tv] = UV em escala de mundo (metros por repetição)
let MATS = null;
function mats() {
  if (MATS) return MATS;
  const std = (opts) => new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0.05, ...opts });
  const tx = (map, uv, opts = {}) => ({ m: std({ map, ...opts }), uv: uv.uv || uv, topV: uv.topV });
  MATS = {
    barrier: tx(PIX.barrier(), { uv: [2, 1], topV: 0.95 }),
    sandbag: tx(PIX.sandbag(), [1, 0.5]),
    planks: tx(PIX.planks(), [1, 1]),
    post: tx(PIX.planks(), [0.5, 1], { color: 0x9a8676 }),
    bark: tx(PIX.bark(), [1, 1]),
    tarpOlive: tx(PIX.tarp(0x5a6a3a), [3, 3]),
    tarpTan: tx(PIX.tarp(0x7a6a48), [3, 3]),
    tarpTruck: tx(PIX.tarp(0x56603a), [3, 3]),
    tarpBlue: tx(PIX.tarp(0x34506a), [1, 1]),
    truck: tx(PIX.truck(), 'box', { metalness: 0.3, roughness: 0.6 }),
    truckFront: tx(PIX.truckFront(), 'box', { metalness: 0.3, roughness: 0.6 }),
    glass: tx(PIX.glass(), 'box', { metalness: 0.3, roughness: 0.2 }),
    tire: tx(PIX.tire(), 'box'),
    roof: tx(PIX.metalRoof(), [1, 1], { metalness: 0.45, roughness: 0.5 }),
    crate: tx(PIX.crate(), 'box'),
    ammo: tx(PIX.military(), 'box'),
    barrel: tx(PIX.rustBarrel(), [1, 1], { metalness: 0.3 }),
    generator: tx(PIX.generator(), 'box', { metalness: 0.3, roughness: 0.6 }),
    radio: tx(PIX.radio(), 'box'),
    flag: tx(PIX.flag(), 'box', { side: THREE.DoubleSide }),
    tote: tx(PIX.tote(), 'box', { roughness: 0.4 }),
    hazard: tx(hazardTex(), 'box'),
    sign: tx(signTex(), 'box'),
    dark: { m: std({ color: 0x2a2a2a, roughness: 0.6, metalness: 0.4 }), uv: 'box' },
    steel: { m: std({ color: 0x5a5c5e, roughness: 0.5, metalness: 0.6 }), uv: 'box' },
    wire: { m: std({ color: 0x1c1c1c, roughness: 0.5, metalness: 0.5 }), uv: 'box' },
    rope: { m: std({ color: 0x8a7a58 }), uv: 'box' },
    concrete: tx(PIX.barrier(), { uv: [2, 1], topV: 0.95 }, { color: 0xb8b4ac }),
    red: { m: std({ color: 0x9a2a20 }), uv: 'box' },
    bulb: { m: std({ color: 0xfff2c0, emissive: 0xffd27a, emissiveIntensity: 2.4 }), uv: 'box' },
    bulbOrange: { m: std({ color: 0xffc08a, emissive: 0xff8a3a, emissiveIntensity: 2.2 }), uv: 'box' },
    lamp: { m: std({ color: 0xfff6d8, emissive: 0xffe6a0, emissiveIntensity: 3 }), uv: 'box' },
    tail: { m: std({ color: 0xff4030, emissive: 0xb01810, emissiveIntensity: 1.2 }), uv: 'box' },
  };
  return MATS;
}

// UV planar em escala de mundo pela normal dominante (pixels do mesmo tamanho em qualquer peça)
const _n = new THREE.Vector3();
function worldUV(g, tu, tv, topV) {
  const pos = g.attributes.position, nrm = g.attributes.normal, uv = g.attributes.uv;
  for (let i = 0; i < pos.count; i++) {
    _n.fromBufferAttribute(nrm, i);
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i), ax = Math.abs(_n.x), ay = Math.abs(_n.y), az = Math.abs(_n.z);
    if (ay >= ax && ay >= az) uv.setXY(i, x / tu, topV !== undefined ? topV : z / tu);
    else if (ax >= az) uv.setXY(i, z / tu, y / tv);
    else uv.setXY(i, x / tu, y / tv);
  }
  uv.needsUpdate = true;
}

// ---------- kit de montagem ----------
const _q = new THREE.Quaternion(), _m4 = new THREE.Matrix4(), _d = new THREE.Vector3(), ZAX = new THREE.Vector3(0, 0, 1);
class Kit {
  constructor(ox, oz) { this.ox = ox; this.oz = oz; this.parts = new Map(); }
  push(key, g) { let a = this.parts.get(key); if (!a) this.parts.set(key, (a = [])); a.push(g); }
  // caixa em coordenadas locais da base (x,z relativos ao centro; y = centro da caixa)
  box(key, w, h, d, x, y, z, rx = 0, ry = 0, rz = 0) {
    const g = new THREE.BoxGeometry(w, h, d);
    if (rx) g.rotateX(rx); if (rz) g.rotateZ(rz); if (ry) g.rotateY(ry);
    g.translate(this.ox + x, y, this.oz + z);
    this.push(key, g);
  }
  // viga entre dois pontos (cordas, fios, travessas)
  beam(key, ax, ay, az, bx, by, bz, t = 0.05) {
    _d.set(bx - ax, by - ay, bz - az);
    const g = new THREE.BoxGeometry(t, t, _d.length());
    _q.setFromUnitVectors(ZAX, _d.normalize());
    g.applyMatrix4(_m4.makeRotationFromQuaternion(_q));
    g.translate(this.ox + (ax + bx) / 2, (ay + by) / 2, this.oz + (az + bz) / 2);
    this.push(key, g);
  }
  build(group) {
    const M = mats();
    for (const [key, geos] of this.parts) {
      const spec = M[key];
      const g = mergeGeometries(geos);
      geos.forEach((x) => x.dispose());
      if (spec.uv !== 'box') worldUV(g, spec.uv[0], spec.uv[1], spec.topV);
      const mesh = new THREE.Mesh(g, spec.m);
      mesh.castShadow = !/^(bulb|bulbOrange|lamp|wire|rope)$/.test(key);
      mesh.receiveShadow = true;
      mesh.name = 'base-' + key;
      group.add(mesh);
    }
  }
}

// ============================================================
//  Montagem. (cx,cz) = centro da base; hs = meia largura do muro.
//  Portões: sul (z = +hs) e leste (x = +hs), vão de x/z ∈ [-2.5, 2.5].
//  Fogueira no centro (montada pelo mundo); extração ao lado do caminhão.
// ============================================================
export function buildSafeBase({ group, addCollider, cx, cz, hs = 10.5, rand = Math.random }) {
  const K = new Kit(cx, cz);
  const col = (x0, z0, x1, z1, h) => addCollider(cx + Math.min(x0, x1), cz + Math.min(z0, z1), cx + Math.max(x0, x1), cz + Math.max(z0, z1), h);
  const GATE = 2.5;

  // ---------- muro: barreira de concreto (perfil em degrau) + 2 fiadas de sacos + arame farpado ----------
  function wallSeg(horiz, fixed, a, b) {
    const L = b - a;
    if (L < 0.3) return;
    const mods = Math.max(1, Math.round(L / 2));
    for (let i = 0; i < mods; i++) {
      const s0 = a + (L * i) / mods, s1 = a + (L * (i + 1)) / mods, m = (s0 + s1) / 2, len = s1 - s0 - 0.04;
      const put = (key, w, h, t, y, off = 0) => horiz ? K.box(key, len * w, h, t, m, y, fixed + off) : K.box(key, t, h, len * w, fixed + off, y, m);
      put('barrier', 1, 0.36, 0.78, 0.18);
      put('barrier', 1, 0.66, 0.5, 0.69);
    }
    // sacos de areia em fiadas desencontradas
    for (let row = 0; row < 2; row++) {
      const n = Math.max(1, Math.round(L / 1.0)), shift = row ? 0.5 : 0;
      for (let i = row ? -1 : 0; i < n; i++) {
        const s0 = Math.max(a, a + (L * (i + shift)) / n), s1 = Math.min(b, a + (L * (i + 1 + shift)) / n);
        if (s1 - s0 < 0.2) continue;
        const m = (s0 + s1) / 2, len = s1 - s0 - 0.03, y = 1.02 + row * 0.39 + 0.19;
        const wob = (rand() - 0.5) * 0.06;
        if (horiz) K.box('sandbag', len, 0.38, 0.6 - row * 0.06, m, y, fixed + wob);
        else K.box('sandbag', 0.6 - row * 0.06, 0.38, len, fixed + wob, y, m);
      }
    }
    // postes de madeira na face externa com dois fios de arame farpado
    const out = Math.sign(fixed) * 0.42;
    const posts = Math.max(2, Math.round(L / 3.4) + 1);
    let prev = null;
    for (let i = 0; i < posts; i++) {
      const s = a + 0.15 + ((L - 0.3) * i) / (posts - 1);
      const px = horiz ? s : fixed + out, pz = horiz ? fixed + out : s;
      K.box('post', 0.14, 2.75, 0.14, px, 1.375, pz);
      if (prev) for (const y of [2.15, 2.55]) {
        K.beam('wire', prev[0], y, prev[1], px, y - 0.04, pz, 0.025);
        const steps = Math.floor(Math.hypot(px - prev[0], pz - prev[1]) / 0.45);
        for (let k = 1; k < steps; k++) { // farpas
          const t = k / steps, bx = prev[0] + (px - prev[0]) * t, bz = prev[1] + (pz - prev[1]) * t;
          K.box('wire', 0.09, 0.02, 0.02, bx, y - 0.02, bz, 0, 0.8, 0.6);
          K.box('wire', 0.02, 0.09, 0.02, bx, y - 0.02, bz, 0.6, 0, 0);
        }
      }
      prev = [px, pz];
    }
    if (horiz) col(a, fixed - 0.4, b, fixed + 0.4, 1.8); else col(fixed - 0.4, a, fixed + 0.4, b, 1.8);
  }
  wallSeg(true, -hs, -hs, hs);                   // norte
  wallSeg(false, -hs, -hs, hs);                  // oeste
  wallSeg(true, hs, -hs, -GATE); wallSeg(true, hs, GATE, hs);   // sul (portão)
  wallSeg(false, hs, -hs, -GATE); wallSeg(false, hs, GATE, hs); // leste (portão)
  for (const [x, z] of [[-hs, -hs], [hs, -hs], [-hs, hs], [hs, hs]]) { // pilares de canto
    K.box('concrete', 0.95, 2.0, 0.95, x, 1.0, z);
    K.box('sandbag', 1.0, 0.3, 1.0, x, 2.15, z);
  }

  // ---------- torres de vigia (cantos norte) ----------
  function tower(x, z) {
    const H = 2.7, s = 1.05;
    for (const [dx, dz] of [[-s, -s], [s, -s], [-s, s], [s, s]]) {
      K.box('post', 0.2, H + 1.75, 0.2, x + dx, (H + 1.75) / 2, z + dz);
      col(x + dx - 0.12, z + dz - 0.12, x + dx + 0.12, z + dz + 0.12, H);
    }
    for (const sgn of [-1, 1]) { // travessas em X nas laterais
      K.beam('post', x - s, 0.3, z + sgn * s, x + s, H - 0.2, z + sgn * s, 0.09);
      K.beam('post', x + s, 0.3, z + sgn * s, x - s, H - 0.2, z + sgn * s, 0.09);
      K.beam('post', x + sgn * s, 0.3, z - s, x + sgn * s, H - 0.2, z + s, 0.09);
    }
    K.box('planks', 2.6, 0.16, 2.6, x, H, z); // piso
    // parapeito de sacos (3 lados) + guarda-corpo do lado da escada
    K.box('sandbag', 2.6, 0.5, 0.32, x, H + 0.33, z - 1.14);
    K.box('sandbag', 0.32, 0.5, 2.0, x - 1.14, H + 0.33, z + 0.15);
    K.box('sandbag', 0.32, 0.5, 2.0, x + 1.14, H + 0.33, z + 0.15);
    K.box('post', 2.3, 0.08, 0.08, x, H + 0.9, z + 1.14);
    // telhado de zinco levemente inclinado
    K.box('roof', 3.0, 0.08, 3.0, x, H + 1.82, z, 0.08, 0, 0);
    K.box('dark', 3.04, 0.12, 0.1, x, H + 1.72, z + 1.5);
    // holofote no parapeito apontado para o pátio
    K.box('dark', 0.36, 0.3, 0.42, x, H + 0.78, z + 0.85, -0.3, 0, 0);
    K.box('lamp', 0.26, 0.2, 0.04, x, H + 0.72, z + 1.07, -0.3, 0, 0);
    // escada voltada para o centro
    const lz = z + s + 0.32;
    K.box('post', 0.08, H + 0.4, 0.08, x - 0.32, (H + 0.4) / 2, lz);
    K.box('post', 0.08, H + 0.4, 0.08, x + 0.32, (H + 0.4) / 2, lz);
    for (let y = 0.35; y < H; y += 0.4) K.box('post', 0.64, 0.06, 0.08, x, y, lz);
  }
  tower(-hs + 1.6, -hs + 1.6);
  tower(hs - 1.6, -hs + 1.6);

  // ---------- portão sul: pilares, placa "ZONA SEGURA", lampiões ----------
  for (const sx of [-GATE - 0.2, GATE + 0.2]) {
    K.box('concrete', 0.6, 3.2, 0.6, sx, 1.6, hs);
    K.box('hazard', 0.62, 0.3, 0.62, sx, 0.5, hs);
    K.box('dark', 0.2, 0.2, 0.3, sx, 2.95, hs + 0.42);
    K.box('lamp', 0.14, 0.12, 0.04, sx, 2.86, hs + 0.58);
    col(sx - 0.3, hs - 0.3, sx + 0.3, hs + 0.3, 3.2);
  }
  K.box('post', GATE * 2 + 1.0, 0.18, 0.2, 0, 3.0, hs);
  K.box('sign', 3.2, 0.8, 0.06, 0, 2.45, hs + 0.13);
  for (const sx of [-1.2, 1.2]) K.beam('wire', sx, 2.9, hs + 0.12, sx, 2.85, hs + 0.12, 0.03);

  // ---------- portão leste: cancela listrada erguida ----------
  {
    const gx = hs, gz = -GATE - 0.3;
    K.box('concrete', 0.6, 1.1, 0.6, gx, 0.55, gz);
    K.box('hazard', 0.62, 0.25, 0.62, gx, 0.9, gz);
    K.box('dark', 0.3, 0.3, 0.3, gx, 1.25, gz);
    const ang = 1.15, L = 5.0; // erguida ~66°
    K.box('hazard', 0.16, 0.16, L, gx, 1.25 + Math.sin(ang) * L / 2, gz + Math.cos(ang) * L / 2, -ang, 0, 0);
    K.box('dark', 0.24, 0.24, 0.5, gx, 1.25 - Math.sin(ang) * 0.3, gz - Math.cos(ang) * 0.3, -ang, 0, 0); // contrapeso
    K.box('concrete', 0.5, 0.9, 0.5, gx, 0.45, GATE + 0.3);
    K.box('hazard', 0.52, 0.2, 0.52, gx, 0.8, GATE + 0.3);
    col(gx - 0.3, gz - 0.3, gx + 0.3, gz + 0.3, 1.4);
    col(gx - 0.25, GATE + 0.05, gx + 0.25, GATE + 0.55, 0.9);
  }

  // ---------- barracas: base de lona + telhado em degraus, mastros, porta, estais ----------
  function tent(x, z, w, d, key, doorDir) {
    K.box('tarpBlue', w + 0.5, 0.04, d + 0.6, x, 0.02, z); // lona de chão
    K.box(key, w, 0.55, d, x, 0.275, z);
    const tiers = 5, th = 0.32;
    for (let i = 0; i < tiers; i++) {
      const dd = d * (1 - (i + 1) / (tiers + 0.6));
      K.box(key, w - 0.02 * i, th, Math.max(0.28, dd), x, 0.55 + th * (i + 0.5), z);
    }
    const top = 0.55 + th * tiers;
    K.box('post', w + 0.5, 0.09, 0.09, x, top + 0.05, z); // cumeeira
    for (const sx of [-1, 1]) {
      const ex = x + sx * (w / 2 + 0.2);
      K.box('post', 0.09, top + 0.15, 0.09, ex, (top + 0.15) / 2, z);
      for (const sz of [-1, 1]) { // estais com estacas
        const sxp = ex + sx * 0.9, szp = z + sz * (d / 2 + 0.5);
        K.beam('rope', ex, top, z, sxp, 0.05, szp, 0.025);
        K.box('post', 0.06, 0.2, 0.06, sxp, 0.1, szp);
      }
    }
    // porta na empena voltada para a fogueira: vão escuro + aba enrolada
    const fx = x + doorDir * (w / 2 + 0.02);
    K.box('dark', 0.04, 1.35, 0.95, fx, 0.68, z);
    K.box(key, 0.16, 0.16, 1.05, fx + doorDir * 0.06, 1.4, z);
    K.box('lamp', 0.1, 0.14, 0.1, fx + doorDir * 0.1, 1.75, z + 0.62); // lampião na entrada
    col(x - w / 2, z - d / 2, x + w / 2, z + d / 2, top);
  }
  tent(-5.6, -5.2, 4.0, 3.4, 'tarpOlive', 1);
  tent(5.6, -5.2, 4.0, 3.4, 'tarpTan', -1);
  // sacos de dormir na frente das barracas
  for (const [x, z, r] of [[-2.9, -6.1, 0.1], [-2.9, -4.3, -0.15], [2.9, -6.1, -0.1]]) {
    K.box('tarpBlue', 0.75, 0.14, 1.9, x, 0.07, z, 0, r, 0);
    K.box('tarpOlive', 0.6, 0.16, 0.35, x, 0.16, z - 0.7, 0, r, 0); // travesseiro/mochila
  }

  // ---------- caminhão militar de extração (frente para o portão sul) ----------
  {
    const X = -6.5, Z = 3.0;
    for (const wz of [-2.4, -1.15, 3.95]) for (const sx of [-1, 1]) K.box('tire', 0.42, 1.0, 1.0, X + sx * 1.22, 0.5, Z + wz);
    K.box('dark', 2.0, 0.34, 8.4, X, 0.8, Z + 0.9);                 // chassi
    // cabine
    K.box('truck', 2.6, 1.5, 1.95, X, 1.75, Z + 4.25);
    K.box('truck', 2.5, 0.1, 1.8, X, 2.55, Z + 4.2); // teto da cabine
    K.box('glass', 2.2, 0.62, 0.05, X, 2.12, Z + 5.24);
    for (const sx of [-1, 1]) {
      K.box('glass', 0.05, 0.55, 0.85, X + sx * 1.31, 2.12, Z + 4.45);
      K.box('dark', 0.08, 0.34, 0.2, X + sx * 1.52, 2.15, Z + 4.95);       // retrovisor
      K.beam('dark', X + sx * 1.3, 2.25, Z + 4.95, X + sx * 1.5, 2.25, Z + 4.95, 0.04);
      K.box('truck', 0.52, 0.12, 1.3, X + sx * 1.22, 1.08, Z + 3.95);    // para-lama
      K.box('dark', 0.1, 0.5, 0.06, X + sx * 0.9, 0.85, Z + 5.25);       // degrau
    }
    K.box('truckFront', 2.6, 1.0, 0.06, X, 1.48, Z + 5.24);
    K.box('dark', 2.8, 0.26, 0.26, X, 0.85, Z + 5.38);                    // para-choque
    K.box('tire', 1.0, 1.0, 0.32, X, 1.6, Z + 3.1);                        // estepe atrás da cabine
    // carroceria com lona
    K.box('planks', 2.8, 0.16, 5.6, X, 1.05, Z - 0.1);
    K.box('tarpTruck', 2.8, 0.95, 5.6, X, 1.6, Z - 0.1);
    K.box('tarpTruck', 2.6, 0.3, 5.6, X, 2.22, Z - 0.1);
    K.box('tarpTruck', 2.1, 0.26, 5.6, X, 2.5, Z - 0.1);
    K.box('tarpTruck', 1.3, 0.18, 5.6, X, 2.72, Z - 0.1);
    for (let k = 0; k < 4; k++) K.box('post', 2.86, 0.06, 0.08, X, 2.07, Z - 2.6 + k * 1.65); // amarras
    K.box('dark', 2.2, 1.05, 0.04, X, 1.65, Z - 2.92);                    // traseira aberta
    K.box('planks', 2.6, 0.08, 0.6, X, 0.85, Z - 3.15, -0.6, 0, 0);       // tampa baixada
    for (const sx of [-1, 1]) K.box('tail', 0.22, 0.12, 0.05, X + sx * 1.15, 1.0, Z - 2.93);
    K.box('dark', 0.45, 0.5, 1.2, X + 1.25, 0.95, Z + 1.4);               // tanque de combustível
    K.box('red', 0.32, 0.45, 0.18, X + 1.62, 0.23, Z + 2.35);              // galões
    K.box('ammo', 0.32, 0.45, 0.18, X + 1.62, 0.23, Z + 2.6);
    col(X - 1.45, Z - 2.95, X + 1.45, Z + 5.5, 2.8);
  }

  // ---------- trincheiras de sacos de areia flanqueando o portão sul ----------
  for (const sx of [-1, 1]) {
    const x0 = sx * (GATE + 1.0);
    for (let row = 0; row < 2; row++) {
      K.box('sandbag', 0.7, 0.42, 2.6, x0, 0.21 + row * 0.42, hs - 2.6, 0, (rand() - 0.5) * 0.04, 0);
      K.box('sandbag', 1.6, 0.42, 0.7, x0 + sx * 0.45, 0.21 + row * 0.42, hs - 4.1, 0, (rand() - 0.5) * 0.04, 0);
    }
    col(x0 - 0.35, hs - 3.9, x0 + 0.35, hs - 1.3, 0.84);
    col(Math.min(x0 - 0.35, x0 + sx * 1.25), hs - 4.45, Math.max(x0 + 0.35, x0 + sx * 1.25), hs - 3.75, 0.84);
  }
  // passarela de tábuas do portão sul até a fogueira
  for (let z = hs - 0.6; z > 2.6; z -= 1.1) K.box('planks', 1.2, 0.06, 1.0, 0, 0.03, z, 0, (rand() - 0.5) * 0.06, 0);

  // ---------- pilha de suprimentos (canto sudeste) ----------
  {
    const crates = [[8.3, 4.2, 0], [9.35, 4.2, 0], [8.3, 5.25, 0], [8.3, 4.2, 1], [9.35, 5.25, 0]];
    for (const [x, z, lvl] of crates) K.box('crate', 1, 1, 1, x, 0.5 + lvl, z, 0, (rand() - 0.5) * 0.12, 0);
    col(7.8, 3.7, 9.85, 5.75, 1); col(7.8, 3.7, 8.8, 4.7, 2); // caixa de cima tem colisão própria
    K.box('ammo', 1.6, 0.6, 0.9, 8.9, 0.3, 6.6); K.box('ammo', 1.2, 0.5, 0.8, 8.95, 0.85, 6.55, 0, 0.1, 0);
    col(8.1, 6.15, 9.7, 7.05, 1.1);
    for (const [x, z] of [[7.4, 8.4], [8.15, 8.6], [7.75, 9.2]]) { K.box('barrel', 0.68, 1.0, 0.68, x, 0.5, z); K.box('dark', 0.72, 0.06, 0.72, x, 1.0, z); }
    col(7.05, 8.05, 8.5, 9.55, 1);
    K.box('tarpOlive', 2.2, 0.06, 2.0, 8.85, 1.03, 4.7, 0.05, 0.1, 0.04); // lona jogada sobre as caixas
  }

  // ---------- paletes com sacos (canto nordeste, ao lado da torre) ----------
  for (const [x, z] of [[9.0, -5.6], [9.0, -4.2]]) {
    K.box('planks', 1.2, 0.14, 1.1, x, 0.07, z);
    for (const [dx, dy] of [[-0.28, 0], [0.28, 0], [0, 1]]) K.box('sandbag', 0.5, 0.3, 0.95, x + dx, 0.3 + dy * 0.3, z, 0, (rand() - 0.5) * 0.2, 0);
    col(x - 0.6, z - 0.55, x + 0.6, z + 0.55, 0.75);
  }

  // ---------- caixa d'água e galões (lado oeste) ----------
  K.box('tote', 1.1, 1.1, 1.1, -9.25, 0.62, -1.6); K.box('planks', 1.2, 0.12, 1.2, -9.25, 0.06, -1.6);
  K.box('steel', 0.12, 0.12, 0.3, -8.62, 0.3, -1.6);
  col(-9.85, -2.2, -8.65, -1.0, 1.2);
  for (const [x, z] of [[-9.5, -0.5], [-9.15, -0.5]]) K.box('red', 0.3, 0.45, 0.18, x, 0.23, z);

  // ---------- gerador + cabo, mesa com rádio, mastro com bandeira (fundo) ----------
  K.box('generator', 1.1, 0.75, 0.72, -2.3, 0.46, -8.4); K.box('dark', 1.2, 0.1, 0.8, -2.3, 0.05, -8.4);
  K.box('dark', 0.08, 0.5, 0.08, -2.75, 1.0, -8.55); K.box('dark', 0.14, 0.06, 0.14, -2.75, 1.27, -8.55); // escapamento
  col(-2.9, -8.8, -1.7, -8.0, 0.85);
  // mesa
  K.box('planks', 1.7, 0.08, 0.85, 2.5, 0.82, -8.4);
  for (const [dx, dz] of [[-0.75, -0.35], [0.75, -0.35], [-0.75, 0.35], [0.75, 0.35]]) K.box('post', 0.08, 0.8, 0.08, 2.5 + dx, 0.4, -8.4 + dz);
  K.box('radio', 0.62, 0.32, 0.34, 2.2, 1.02, -8.45);
  K.box('steel', 0.03, 1.4, 0.03, 1.95, 1.85, -8.55);
  K.box('crate', 0.55, 0.55, 0.55, 2.4, 0.28, -7.55); // banquinho
  K.box('ammo', 0.5, 0.3, 0.3, 2.95, 1.01, -8.3);
  col(1.6, -8.85, 3.4, -7.95, 0.86);
  // mastro e bandeira (tremulando em duas partes)
  K.box('concrete', 0.5, 0.3, 0.5, 0, 0.15, -9.3);
  K.box('steel', 0.1, 5.2, 0.1, 0, 2.6, -9.3);
  K.box('steel', 0.18, 0.1, 0.18, 0, 5.22, -9.3);
  K.box('flag', 0.75, 0.9, 0.03, 0.42, 4.65, -9.3, 0, 0.12, 0);
  K.box('flag', 0.7, 0.86, 0.03, 1.12, 4.63, -9.22, 0, -0.18, 0);
  col(-0.2, -9.5, 0.2, -9.1, 5);

  // ---------- bancos de tronco em volta da fogueira ----------
  for (const a of [-0.35, 1.9, 3.6]) {
    const R = 2.35, x = Math.cos(a) * R, z = Math.sin(a) * R;
    K.box('bark', 1.5, 0.34, 0.36, x, 0.17, z, 0, -a + Math.PI / 2, 0);
  }

  // ---------- varal de lâmpadas entre postes sobre a fogueira ----------
  const poles = [[-3.4, -2.9], [3.4, -2.9], [3.4, 3.9], [-3.1, 4.3]];
  const PH = 3.3;
  for (const [x, z] of poles) {
    K.box('concrete', 0.4, 0.3, 0.4, x, 0.15, z);
    K.box('post', 0.12, PH, 0.12, x, PH / 2, z);
    K.box('post', 0.5, 0.06, 0.06, x, PH - 0.15, z);
    col(x - 0.2, z - 0.2, x + 0.2, z + 0.2, PH);
  }
  // cabo do gerador até o primeiro poste
  K.beam('wire', -2.3, 0.8, -8.0, -3.4, PH - 0.2, -2.9, 0.03);
  const runs = [[0, 1], [1, 2], [2, 3], [3, 0], [0, 2]];
  for (const [i, j] of runs) {
    const [ax, az] = poles[i], [bx, bz] = poles[j];
    const N = Math.max(6, Math.round(Math.hypot(bx - ax, bz - az) / 0.9)), sag = 0.45;
    let p0 = [ax, PH - 0.12, az];
    for (let k = 1; k <= N; k++) {
      const t = k / N, y = PH - 0.12 - Math.sin(Math.PI * t) * sag;
      const p1 = [ax + (bx - ax) * t, y, az + (bz - az) * t];
      K.beam('wire', p0[0], p0[1], p0[2], p1[0], p1[1], p1[2], 0.022);
      if (k < N) K.box(k % 3 === 1 ? 'bulbOrange' : 'bulb', 0.1, 0.13, 0.1, p1[0], p1[1] - 0.1, p1[2]);
      p0 = p1;
    }
  }

  K.build(group);
}
