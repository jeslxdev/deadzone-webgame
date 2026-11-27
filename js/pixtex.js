// ============================================================
//  TEXTURAS EM PIXEL ART (cenário em blocos, estilo Minecraft)
//  Pintadas em baixa resolução (16–64 px) com paleta + ruído e
//  filtragem "nearest": pixels nítidos, coerentes com as skins.
// ============================================================
import * as THREE from 'three';
import { mulberry32 } from './util.js';

const cache = new Map();
const rgb = (h) => [(h >> 16) & 255, (h >> 8) & 255, h & 255];
const sh = (c, k) => c.map((v) => Math.max(0, Math.min(255, (v * k) | 0)));

class Pix {
  constructor(w, h, seed) {
    this.w = w; this.h = h;
    this.c = document.createElement('canvas'); this.c.width = w; this.c.height = h;
    this.g = this.c.getContext('2d'); this.img = this.g.createImageData(w, h); this.d = this.img.data;
    this.r = mulberry32(seed);
  }
  p(x, y, c, a = 255) {
    x = ((x % this.w) + this.w) % this.w; y = ((y % this.h) + this.h) % this.h; // repete nas bordas
    const i = (y * this.w + x) * 4;
    if (a < 255) { const t = a / 255; for (let k = 0; k < 3; k++) this.d[i + k] = this.d[i + k] * (1 - t) + c[k] * t; this.d[i + 3] = 255; return; }
    this.d[i] = c[0]; this.d[i + 1] = c[1]; this.d[i + 2] = c[2]; this.d[i + 3] = 255;
  }
  rect(x, y, w, h, c, noise = 0, a = 255) { for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) this.p(i, j, noise ? sh(c, 1 + (this.r() - 0.5) * 2 * noise) : c, a); }
  speck(c, n, x = 0, y = 0, w = this.w, h = this.h, a = 255) { for (let i = 0; i < n; i++) this.p(x + ((this.r() * w) | 0), y + ((this.r() * h) | 0), c, a); }
  tex(repeat = [1, 1]) {
    this.g.putImageData(this.img, 0, 0);
    const t = new THREE.CanvasTexture(this.c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestMipmapLinearFilter;
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat[0], repeat[1]);
    t.anisotropy = 4;
    return t;
  }
}
function make(key, w, h, draw, repeat) {
  if (cache.has(key)) return cache.get(key);
  const P = new Pix(w, h, [...key].reduce((a, ch) => (a * 31 + ch.charCodeAt(0)) | 0, 7));
  draw(P);
  const t = P.tex(repeat);
  cache.set(key, t);
  return t;
}

// ---------- materiais de cenário ----------
export const PIX = {
  // tábuas de caixote: 4 tábuas, veios, pregos, moldura e travessa diagonal
  crate: () => make('crate', 32, 32, (P) => {
    const W = rgb(0x8a6a3a);
    for (let b = 0; b < 4; b++) { const k = 0.85 + P.r() * 0.3; P.rect(0, b * 8, 32, 8, sh(W, k), 0.08); P.rect(0, b * 8, 32, 1, sh(W, 0.55)); for (let i = 0; i < 6; i++) { const y = b * 8 + 2 + ((P.r() * 5) | 0), x = (P.r() * 26) | 0; P.rect(x, y, 4 + ((P.r() * 6) | 0), 1, sh(W, 0.72)); } }
    P.rect(0, 0, 32, 3, sh(W, 0.6), 0.06); P.rect(0, 29, 32, 3, sh(W, 0.6), 0.06); P.rect(0, 0, 3, 32, sh(W, 0.6), 0.06); P.rect(29, 0, 3, 32, sh(W, 0.6), 0.06);
    for (let i = 0; i < 26; i++) { P.p(3 + i, 3 + i, sh(W, 0.62)); P.p(4 + i, 3 + i, sh(W, 0.62)); P.p(3 + i, 4 + i, sh(W, 0.45)); }
    for (const [x, y] of [[1, 1], [30, 1], [1, 30], [30, 30], [15, 1], [15, 30]]) P.p(x, y, [60, 60, 64]);
  }),
  // caçamba de lixo: chapa verde com nervuras e ferrugem escorrida
  dumpster: () => make('dumpster', 32, 32, (P) => {
    const G = rgb(0x2f5a3a);
    P.rect(0, 0, 32, 32, G, 0.07);
    for (let x = 2; x < 32; x += 6) { P.rect(x, 2, 1, 28, sh(G, 1.25)); P.rect(x + 1, 2, 1, 28, sh(G, 0.7)); }
    for (let i = 0; i < 7; i++) { const x = (P.r() * 30) | 0, y = (P.r() * 10) | 0; for (let k = 0; k < 6 + P.r() * 12; k++) P.p(x + (k % 2 ? 0 : (P.r() * 2) | 0), y + k, [110, 60, 30], 200); }
    P.rect(0, 0, 32, 2, sh(G, 0.6)); P.rect(0, 30, 32, 2, sh(G, 0.5));
    P.speck([180, 170, 150], 12, 0, 0, 32, 32, 120);
  }),
  // armário/arquivo metálico: frestas de ventilação e puxador
  locker: () => make('locker', 16, 32, (P) => {
    const M = rgb(0x6a7076);
    P.rect(0, 0, 16, 32, M, 0.06);
    for (let y = 3; y < 9; y += 2) P.rect(3, y, 10, 1, sh(M, 0.45));
    P.rect(12, 14, 2, 4, [40, 40, 44]); P.rect(0, 0, 16, 1, sh(M, 1.3)); P.rect(0, 31, 16, 1, sh(M, 0.5)); P.rect(7, 0, 1, 32, sh(M, 0.6));
    P.speck([120, 70, 40], 10, 0, 18, 16, 14, 180);
  }),
  // cofre: aço com rebites e chapa de porta
  safe: () => make('safe', 32, 32, (P) => {
    const S = rgb(0x3a3d42);
    P.rect(0, 0, 32, 32, S, 0.05); P.rect(3, 3, 26, 26, sh(S, 1.2), 0.04); P.rect(4, 4, 24, 24, S, 0.05);
    for (const x of [2, 29]) for (let y = 2; y < 30; y += 6) { P.p(x, y, sh(S, 1.8)); P.p(x, y + 1, sh(S, 0.5)); }
    P.rect(24, 13, 2, 6, [180, 160, 80]); P.speck([90, 94, 100], 20);
  }),
  // caixa militar: verde-oliva, faixa branca e marcações em estêncil
  military: () => make('military', 32, 16, (P) => {
    const O = rgb(0x4b5a2a);
    P.rect(0, 0, 32, 16, O, 0.07); P.rect(0, 0, 32, 1, sh(O, 1.3)); P.rect(0, 15, 32, 1, sh(O, 0.55));
    P.rect(0, 5, 32, 3, [216, 216, 200], 0.05);
    for (let i = 0; i < 5; i++) P.rect(4 + i * 5, 10, 3, 2, [200, 200, 180]); // "texto" de estêncil
    for (const x of [1, 30]) P.rect(x, 1, 1, 14, sh(O, 0.6));
  }),
  // baú do tesouro: roxo com faixas douradas e fecho
  treasure: () => make('treasure', 32, 32, (P) => {
    const Pu = rgb(0x5a1a7a), Go = [214, 172, 64];
    P.rect(0, 0, 32, 32, Pu, 0.08);
    for (const x of [3, 27]) P.rect(x, 0, 2, 32, Go, 0.08);
    P.rect(0, 12, 32, 2, Go, 0.08); P.rect(14, 12, 4, 6, [250, 220, 120]); P.p(15, 15, [60, 40, 10]); P.p(16, 15, [60, 40, 10]);
    P.speck([180, 80, 255], 10, 0, 0, 32, 32, 160);
  }),
  // pintura de carro por cor: portas, maçaneta, sujeira e ferrugem
  carPaint: (hex) => make('car' + hex, 32, 16, (P) => {
    const C = rgb(hex);
    P.rect(0, 0, 32, 16, C, 0.05); P.rect(0, 0, 32, 1, sh(C, 1.35)); P.rect(0, 13, 32, 3, sh(C, 0.55), 0.08);
    for (const x of [10, 21]) P.rect(x, 1, 1, 11, sh(C, 0.55)); // vãos das portas
    P.rect(13, 5, 3, 1, [190, 190, 196]); P.rect(24, 5, 3, 1, [190, 190, 196]); // maçanetas
    for (let i = 0; i < 18; i++) P.p((P.r() * 32) | 0, 8 + ((P.r() * 6) | 0), [120, 70, 40], 170);
    P.speck([60, 50, 40], 20, 0, 9, 32, 7, 140);
  }),
  // capô/teto: pintura lisa com sujeira e reflexo
  carTop: (hex) => make('carTop' + hex, 16, 32, (P) => {
    const C = rgb(hex);
    P.rect(0, 0, 16, 32, C, 0.04); P.rect(0, 0, 16, 1, sh(C, 0.6)); P.rect(0, 31, 16, 1, sh(C, 0.6));
    for (let i = 0; i < 6; i++) P.p(3 + i, 4 + i, sh(C, 1.3)); // reflexo
    P.speck([70, 60, 50], 14, 0, 0, 16, 32, 120); P.speck([120, 70, 40], 6, 0, 0, 16, 32, 160);
  }),
  // frente: grade, faróis (o brilho vem das peças de farol) e para-choque
  carFront: (hex) => make('carFront' + hex, 16, 8, (P) => {
    const C = rgb(hex);
    P.rect(0, 0, 16, 8, C, 0.05);
    P.rect(4, 2, 8, 3, [26, 26, 28]); for (let x = 5; x < 12; x += 2) P.rect(x, 2, 1, 3, [70, 70, 74]); // grade
    P.rect(0, 6, 16, 2, sh(C, 0.5));
  }),
  // traseira: lanternas vermelhas e placa
  carBack: (hex) => make('carBack' + hex, 16, 8, (P) => {
    const C = rgb(hex);
    P.rect(0, 0, 16, 8, C, 0.05);
    P.rect(1, 2, 3, 2, [170, 30, 26]); P.rect(12, 2, 3, 2, [170, 30, 26]); P.p(1, 2, [240, 90, 80]); P.p(12, 2, [240, 90, 80]);
    P.rect(6, 4, 4, 2, [220, 220, 210]); P.rect(7, 5, 2, 1, [60, 60, 70]);
    P.rect(0, 6, 16, 2, sh(C, 0.5));
  }),
  glass: () => make('glass', 16, 8, (P) => {
    P.rect(0, 0, 16, 8, [28, 36, 44], 0.05);
    for (let i = 0; i < 5; i++) { P.p(3 + i, 1 + i, [110, 130, 150]); P.p(4 + i, 1 + i, [80, 100, 120]); }
    P.p(12, 2, [150, 170, 190]); P.speck([60, 60, 60], 6);
  }),
  tire: () => make('tire', 8, 8, (P) => { P.rect(0, 0, 8, 8, [22, 22, 22], 0.1); for (let y = 0; y < 8; y += 2) P.rect(0, y, 8, 1, [44, 44, 44]); P.rect(3, 3, 2, 2, [120, 120, 120]); }),
  bark: () => make('bark', 16, 16, (P) => { const B = rgb(0x3a2e22); P.rect(0, 0, 16, 16, B, 0.12); for (let i = 0; i < 9; i++) { const x = (P.r() * 16) | 0; P.rect(x, 0, 1, 16, sh(B, 0.65)); } P.speck(sh(B, 1.4), 14); }),
  rustBarrel: () => make('rustBarrel', 16, 16, (P) => { const R = rgb(0x5a3a22); P.rect(0, 0, 16, 16, R, 0.12); for (const y of [3, 12]) P.rect(0, y, 16, 1, sh(R, 0.55)); P.speck([140, 80, 40], 18); P.speck([30, 24, 20], 10); }),
  burnt: () => make('burnt', 16, 16, (P) => { P.rect(0, 0, 16, 16, [40, 36, 32], 0.18); P.speck([90, 50, 30], 16); P.speck([14, 12, 10], 20); P.speck([120, 110, 100], 6); }),
  // carne viva do ninho: veias roxas pulsantes (o brilho vem do material)
  flesh: () => make('flesh', 32, 32, (P) => {
    P.rect(0, 0, 32, 32, [90, 26, 46], 0.12);
    for (let i = 0; i < 10; i++) { let x = (P.r() * 32) | 0, y = (P.r() * 32) | 0; for (let k = 0; k < 14; k++) { P.p(x, y, [190, 70, 255]); x += P.r() < 0.5 ? 1 : 0; y += P.r() < 0.6 ? 1 : -1; } }
    P.speck([200, 120, 140], 16); P.speck([40, 8, 20], 20);
  }),
  sandbag: () => make('sandbag', 16, 8, (P) => { const S = rgb(0x8a7a5a); P.rect(0, 0, 16, 8, S, 0.1); P.rect(0, 0, 16, 1, sh(S, 0.6)); P.rect(7, 0, 1, 8, sh(S, 0.65)); P.rect(15, 0, 1, 8, sh(S, 0.65)); P.speck(sh(S, 1.25), 10); }),
};

// Fachada de prédio em pixel art (4×4 janelas por bloco), com mapa de brilho das janelas acesas.
export function facadePix() {
  if (cache.has('facade')) return cache.get('facade');
  const S = 64, P = new Pix(S, S, 991), E = new Pix(S, S, 992);
  const wall = [212, 208, 202];
  P.rect(0, 0, S, S, wall, 0.06);
  for (let y = 0; y < S; y += 4) for (let x = (y / 4) % 2 ? 0 : 3; x < S; x += 6) P.p(x, y, sh(wall, 0.86)); // juntas de alvenaria
  E.rect(0, 0, S, S, [0, 0, 0]);
  const cell = S / 4;
  for (let fy = 0; fy < 4; fy++) {
    P.rect(0, fy * cell + cell - 2, S, 2, sh(wall, 0.55)); // laje / beiral
    for (let fx = 0; fx < 4; fx++) {
      const x = fx * cell + 4, y = fy * cell + 3, w = cell - 8, h = cell - 7;
      P.rect(x - 1, y - 1, w + 2, h + 2, [74, 72, 68]); // moldura
      const broken = P.r() < 0.35, lit = !broken && P.r() < 0.14;
      P.rect(x, y, w, h, broken ? [11, 12, 14] : [29, 33, 40]);
      if (!broken) { P.rect(x + 1, y + 1, 2, h - 2, [70, 86, 100]); P.p(x + 1, y + 1, [130, 150, 170]); }
      else { P.p(x, y, [43, 48, 54]); P.p(x + 1, y, [43, 48, 54]); P.p(x, y + 1, [43, 48, 54]); }
      P.rect(x + (w >> 1), y, 1, h, [74, 72, 68]); // caixilho
      P.rect(x - 1, y + h + 1, w + 2, 1, sh(wall, 0.7)); // peitoril
      if (lit) { E.rect(x, y, w, h, P.r() < 0.5 ? [255, 154, 58] : [200, 160, 96]); P.rect(x, y, w, h, [120, 90, 50]); }
    }
  }
  for (let i = 0; i < 14; i++) { const x = (P.r() * S) | 0, y = (P.r() * S) | 0, l = 4 + ((P.r() * 14) | 0); for (let k = 0; k < l; k++) P.p(x, y + k, [60, 54, 48], 70); } // sujeira escorrida
  const res = { map: P.tex(), emi: E.tex() };
  cache.set('facade', res);
  return res;
}
