// ============================================================
//  TEXTURAS DE ADEREÇOS (pixel art) e UV em escala de mundo
//  Grão neutro para tudo que antes era só cor (muros, parapeitos,
//  destroços), lona de barraca e sacos de areia. ~16 px por metro,
//  a mesma densidade das skins dos personagens.
// ============================================================
import * as THREE from 'three';
import { mulberry32 } from './util.js';

const cache = new Map();
const clamp255 = (v) => Math.max(0, Math.min(255, v | 0));

function paint(key, w, h, draw) {
  if (cache.has(key)) return cache.get(key);
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d'), img = g.createImageData(w, h), d = img.data, r = mulberry32(w * 977 + h * 131 + key.length * 7);
  const px = (x, y, v, a = 1) => { // v = [r,g,b]; repete nas bordas para emendar sem costura
    x = ((x % w) + w) % w; y = ((y % h) + h) % h;
    const i = (y * w + x) * 4;
    for (let k = 0; k < 3; k++) d[i + k] = clamp255(d[i + k] * (1 - a) + v[k] * a);
    d[i + 3] = 255;
  };
  draw({ px, r, w, h });
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestMipmapLinearFilter;
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4;
  cache.set(key, t);
  return t;
}
const gray = (v) => [v, v, v];

export const PROP = {
  // grão neutro (multiplica a cor do vértice): concreto/metal gasto com lascas, riscos e sujeira
  grit: () => paint('grit', 32, 32, ({ px, r, w, h }) => {
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) px(x, y, gray(232 + (r() - 0.5) * 22));
    for (let i = 0; i < 70; i++) px((r() * w) | 0, (r() * h) | 0, gray(196 + r() * 18)); // poros
    for (let i = 0; i < 26; i++) px((r() * w) | 0, (r() * h) | 0, gray(250)); // grãos claros
    for (let i = 0; i < 5; i++) { // riscos horizontais curtos
      const y = (r() * h) | 0, x0 = (r() * w) | 0, L = 3 + ((r() * 6) | 0);
      for (let k = 0; k < L; k++) px(x0 + k, y, gray(205));
    }
    for (let i = 0; i < 4; i++) { // manchas de sujeira em blocos 2x2/3x2
      const x0 = (r() * w) | 0, y0 = (r() * h) | 0, bw = 2 + ((r() * 2) | 0);
      for (let j = 0; j < 2; j++) for (let k = 0; k < bw; k++) px(x0 + k, y0 + j, [196, 188, 176], 0.8);
    }
    for (let i = 0; i < 3; i++) { // trincas em degrau
      let x = (r() * w) | 0, y = (r() * h) | 0;
      for (let k = 0; k < 7; k++) { px(x, y, gray(170)); if (r() < 0.5) x += r() < 0.5 ? 1 : -1; else y += 1; }
    }
  }),

  // lona de barraca: trama, costuras verticais, remendo costurado e barra suja (neutra: tinge pela cor da barraca)
  canvas: () => paint('canvas', 32, 32, ({ px, r, w, h }) => {
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const weave = ((x + y) & 1) ? 6 : -6; // trama de tecido em xadrez fino
      px(x, y, gray(226 + weave + (r() - 0.5) * 14));
    }
    for (const sx of [0, 15]) for (let y = 0; y < h; y++) { px(sx, y, gray(168)); if (y % 3 === 0) px(sx + 1, y, gray(246)); } // costura + pespontos
    // remendo quadrado com pontos em X nas bordas
    const x0 = 19, y0 = 8, pw = 8, ph = 7;
    for (let y = 0; y < ph; y++) for (let x = 0; x < pw; x++) px(x0 + x, y0 + y, [206, 198, 176]);
    for (let x = 0; x < pw; x++) { px(x0 + x, y0, gray(160)); px(x0 + x, y0 + ph - 1, gray(160)); }
    for (let y = 0; y < ph; y++) { px(x0, y0 + y, gray(160)); px(x0 + pw - 1, y0 + y, gray(160)); }
    for (let k = 1; k < pw - 1; k += 2) { px(x0 + k, y0 + 1, gray(245)); px(x0 + k, y0 + ph - 2, gray(245)); }
    // manchas de lama e desbotado
    for (let i = 0; i < 6; i++) {
      const cx = (r() * w) | 0, cy = (r() * h) | 0;
      for (let k = 0; k < 5; k++) px(cx + ((r() * 3) | 0), cy + ((r() * 2) | 0), [150, 128, 96], 0.55);
    }
    for (let i = 0; i < 14; i++) px((r() * w) | 0, (r() * h) | 0, gray(250));
  }),

  // sacos de areia em fiada desencontrada (2 fiadas por textura = 1 m de altura)
  sandbag: () => paint('sandbag', 16, 16, ({ px, r }) => {
    const S = [150, 134, 100];
    for (let row = 0; row < 2; row++) {
      const y0 = row * 8, off = row ? 8 : 0;
      for (let y = 0; y < 8; y++) for (let x = 0; x < 16; x++) {
        const lx = (x + off) % 16 % 8; // posição dentro do saco (cada saco = 8 px)
        let k = 1 + (r() - 0.5) * 0.12;
        if (y === 0) k *= 1.18; // topo estufado pega luz
        if (y >= 6) k *= 0.82; // base em sombra
        if (lx === 0 || lx === 7) k *= 0.72; // dobra nas pontas
        px(x, y0 + y, S.map((v) => v * k));
      }
      for (let x = 0; x < 16; x++) px(x, y0 + 7, [70, 60, 44]); // vão entre fiadas
      for (let b = 0; b < 2; b++) { // amarração e costura no meio de cada saco
        const mx = (b * 8 + 4 - off + 16) % 16;
        px(mx, y0 + 2, [96, 82, 58]); px(mx, y0 + 4, [96, 82, 58]);
      }
    }
    for (let i = 0; i < 10; i++) px((r() * 16) | 0, (r() * 16) | 0, [184, 168, 130]);
  }),
};

// UV planar em escala de mundo pela normal dominante de cada vértice:
// qualquer peça (caixa, cilindro, painel inclinado) recebe pixels do mesmo tamanho.
const _n = new THREE.Vector3();
export function worldUV(g, metersPerTile = 2) {
  const pos = g.attributes.position, nrm = g.attributes.normal;
  if (!pos || !nrm) return g;
  let uv = g.attributes.uv;
  if (!uv || uv.count !== pos.count) { uv = new THREE.BufferAttribute(new Float32Array(pos.count * 2), 2); g.setAttribute('uv', uv); }
  const s = 1 / metersPerTile;
  for (let i = 0; i < pos.count; i++) {
    _n.fromBufferAttribute(nrm, i);
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i), ax = Math.abs(_n.x), ay = Math.abs(_n.y), az = Math.abs(_n.z);
    if (ay >= ax && ay >= az) uv.setXY(i, x * s, z * s);
    else if (ax >= az) uv.setXY(i, z * s, y * s);
    else uv.setXY(i, x * s, y * s);
  }
  uv.needsUpdate = true;
  return g;
}
