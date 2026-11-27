// ============================================================
//  MODELO EM BLOCOS (estilo Minecraft) + PINTOR DE SKINS
//  · Corpo de caixas no layout de skin 64×64 do Minecraft: uma skin
//    .png do Minecraft encaixa direto. Braços e pernas têm 2 blocos
//    (cotovelo e joelho dobram), com a 2ª camada (chapéu, jaqueta,
//    mangas, calça) como caixa um pouco maior com transparência.
//  · Pintor procedural em pixel art (4 px por "pixel Minecraft"):
//    sombreamento, dobras, costuras, botões, bolsos, cabelo em fios,
//    rosto; nos zumbis: podridão, hematomas, rasgos, costelas, sangue.
//  · Áreas livres do layout guardam texturas de peças extras
//    (mochila, coque, chapéu de palha, papo de ácido, barriga...).
// ============================================================
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mulberry32 } from './util.js';

export const K = 4; // pixels de textura por pixel Minecraft (skin 256×256)
const TEX = 64 * K;

// ---------- regiões do layout (unidades Minecraft) ----------
export const MC = {
  head: { o: [0, 0], s: [8, 8, 8] }, hat: { o: [32, 0], s: [8, 8, 8] },
  body: { o: [16, 16], s: [8, 12, 4] }, jacket: { o: [16, 32], s: [8, 12, 4] },
  armR: { o: [40, 16], s: [4, 12, 4] }, sleeveR: { o: [40, 32], s: [4, 12, 4] },
  armL: { o: [32, 48], s: [4, 12, 4] }, sleeveL: { o: [48, 48], s: [4, 12, 4] },
  legR: { o: [0, 16], s: [4, 12, 4] }, pantR: { o: [0, 32], s: [4, 12, 4] },
  legL: { o: [16, 48], s: [4, 12, 4] }, pantL: { o: [0, 48], s: [4, 12, 4] },
};
// áreas sem uso no layout oficial → texturas das peças extras
export const XR = { acc: [0, 0, 8, 8], hair: [24, 0, 8, 8], acc2: [32, 0, 8, 8], acc3: [56, 0, 8, 8], pack: [56, 16, 8, 16] };

export function faceRect([ox, oy], [w, h, d], face) {
  switch (face) {
    case 'top': return [ox + d, oy, w, d];
    case 'bottom': return [ox + d + w, oy, w, d];
    case 'right': return [ox, oy + d, d, h];
    case 'front': return [ox + d, oy + d, w, h];
    case 'left': return [ox + d + w, oy + d, d, h];
    default: return [ox + 2 * d + w, oy + d, w, h]; // back
  }
}

// ============================================================
//  GEOMETRIA
// ============================================================
const INSET = 0.02; // afasta o UV da borda (evita "vazar" o pixel vizinho)
// Caixa com UV do layout. rows = [r0, r1] fatia vertical das faces laterais (membros em 2 blocos).
// texH 32 = skin antiga: membros esquerdos espelham os direitos.
function boxUV(w, h, d, cx, cy, cz, reg, rows, texH, opts = {}) {
  const g = new THREE.BoxGeometry(w, h, d).toNonIndexed();
  g.translate(cx, cy, cz);
  const pos = g.attributes.position, nor = g.attributes.normal;
  const uv = new Float32Array(pos.count * 2);
  const minX = cx - w / 2, maxX = cx + w / 2, minY = cy - h / 2, maxY = cy + h / 2, minZ = cz - d / 2, maxZ = cz + d / 2;
  const [r0, r1] = rows || [0, reg ? reg.s[1] : 1];
  const mirror = !!opts.mirror;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const nx = nor.getX(i), ny = nor.getY(i), nz = nor.getZ(i);
    let face = Math.abs(nx) > 0.5 ? (nx > 0 ? 'left' : 'right') : Math.abs(ny) > 0.5 ? (ny > 0 ? 'top' : 'bottom') : (nz > 0 ? 'front' : 'back');
    if (mirror && (face === 'left' || face === 'right')) face = face === 'left' ? 'right' : 'left';
    let cxn = (x - minX) / w; if (mirror) cxn = 1 - cxn;
    const cyn = (maxY - y) / h, czn = (z - minZ) / d;
    let u, v, fx, fy, fw, fh;
    if (opts.rect) { [fx, fy, fw, fh] = opts.rect; } // peça extra: todas as faces usam a mesma área
    else {
      let f = face;
      // faces internas da junta (base do bloco de cima / topo do de baixo) usam a fileira do corte
      if ((face === 'bottom' && rows && r1 < reg.s[1]) || (face === 'top' && rows && r0 > 0)) {
        const fr = faceRect(reg.o, reg.s, 'front'), row = face === 'bottom' ? r1 - 0.5 : r0;
        fx = fr[0]; fy = fr[1] + row; fw = fr[2]; fh = 0.5;
        f = 'joint';
      } else {
        [fx, fy, fw, fh] = faceRect(reg.o, reg.s, face);
        if (face !== 'top' && face !== 'bottom') { fy += r0; fh = r1 - r0; }
      }
    }
    switch (face) {
      case 'front': u = cxn; v = cyn; break;
      case 'back': u = 1 - cxn; v = cyn; break;
      case 'right': u = mirror ? 1 - czn : czn; v = cyn; break;
      case 'left': u = mirror ? czn : 1 - czn; v = cyn; break;
      case 'top': u = cxn; v = czn; break;
      default: u = cxn; v = 1 - czn;
    }
    if (opts.rect && (face === 'top' || face === 'bottom')) { u = cxn; v = czn; }
    const inX = INSET / Math.max(fw, 0.5), inY = INSET / Math.max(fh, 0.5);
    u = Math.min(1 - inX, Math.max(inX, u)); v = Math.min(1 - inY, Math.max(inY, v));
    uv[i * 2] = (fx + u * fw) / 64;
    uv[i * 2 + 1] = 1 - (fy + v * fh) / texH;
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return g;
}

// Medidas do corpo (metros). Mesma articulação do rig: quadril 0.88,
// joelho -0.42, ombro 0.58, cotovelo -0.30, mão -0.33, pescoço 0.62.
export function blockyDims(ap) {
  const bw = { magro: 0.86, normal: 1, forte: 1.2, gordo: 1.45 }[ap.build] || 1;
  const dS = Math.max(1, bw * 0.9);
  const legW = 0.2 * Math.min(bw, 1.35), armW = 0.17 * Math.min(1.3, 0.88 + (bw - 0.86) * 0.75);
  const f = ap.body === 'f'; // feminino: ombros mais estreitos, braços e pernas mais finos
  const bodyW = (f ? 0.35 : 0.4) * bw, bodyD = (f ? 0.19 : 0.21) * dS;
  const lW = f ? legW * 0.9 : legW, aW = f ? armW * 0.82 : armW;
  return { bw, legW: lW, armW: aW, bodyW, bodyD, legD: (f ? 0.18 : 0.2) * Math.min(1.15, dS), armD: aW, head: 0.4, bodyH: 0.62, legU: 0.42, legL: 0.46, armTop: 0.04, armU: 0.3, armL: 0.34 };
}

// Geometrias por parte do rig (base + 2ª camada mescladas, um material só).
// extras = [{ part, w, h, d, x, y, z, rect }] peças que usam áreas livres do layout.
export function buildBlockyGeometries(ap, extras = [], texH = 64) {
  const D = blockyDims(ap), legacy = texH === 32;
  const out = {};
  const piece = (list) => { const g = mergeGeometries(list.filter(Boolean), false); list.forEach((x) => x && x.dispose()); return g; };
  const OV = 0.035, OVH = 0.05; // quanto a 2ª camada é maior (membros/tronco e cabeça)
  // cabeça (grupo na altura do pescoço; a caixa cresce para cima)
  const H = D.head;
  out.head = [boxUV(H, H, H, 0, H / 2, 0, MC.head, null, texH), boxUV(H + OVH, H + OVH, H + OVH, 0, H / 2, 0, MC.hat, null, texH)];
  // tronco (grupo no quadril)
  out.torso = [boxUV(D.bodyW, D.bodyH, D.bodyD, 0, D.bodyH / 2, 0, MC.body, null, texH)];
  if (!legacy) out.torso.push(boxUV(D.bodyW + OV, D.bodyH + OV * 0.6, D.bodyD + OV, 0, D.bodyH / 2, 0, MC.jacket, null, texH));
  // braços: bloco de cima (linhas 0–6) e de baixo (6–12)
  const armRows = [[0, 6], [6, 12]];
  for (const sd of ['R', 'L']) {
    const reg = sd === 'R' || legacy ? MC.armR : MC.armL, ov = sd === 'R' ? MC.sleeveR : MC.sleeveL, mir = legacy && sd === 'L';
    const uh = D.armTop + D.armU, lh = D.armL;
    out['arm' + sd + 'U'] = [boxUV(D.armW, uh + 0.02, D.armD, 0, D.armTop - (uh + 0.02) / 2, 0, reg, armRows[0], texH, { mirror: mir })];
    out['arm' + sd + 'D'] = [boxUV(D.armW, lh, D.armD, 0, -lh / 2, 0, reg, armRows[1], texH, { mirror: mir })];
    if (!legacy) {
      out['arm' + sd + 'U'].push(boxUV(D.armW + OV, uh + 0.02 + OV * 0.4, D.armD + OV, 0, D.armTop - (uh + 0.02) / 2, 0, ov, armRows[0], texH));
      out['arm' + sd + 'D'].push(boxUV(D.armW + OV, lh, D.armD + OV, 0, -lh / 2, 0, ov, armRows[1], texH));
    }
  }
  // pernas: coxa (0–6) e canela/sapato (6–12)
  for (const sd of ['R', 'L']) {
    const reg = sd === 'R' || legacy ? MC.legR : MC.legL, ov = sd === 'R' ? MC.pantR : MC.pantL, mir = legacy && sd === 'L';
    out['leg' + sd + 'U'] = [boxUV(D.legW, D.legU + 0.02, D.legD, 0, -(D.legU + 0.02) / 2 + 0.01, 0, reg, [0, 6], texH, { mirror: mir })];
    out['leg' + sd + 'D'] = [boxUV(D.legW, D.legL, D.legD, 0, -D.legL / 2, 0, reg, [6, 12], texH, { mirror: mir })];
    if (!legacy) {
      out['leg' + sd + 'U'].push(boxUV(D.legW + OV, D.legU + 0.02, D.legD + OV, 0, -(D.legU + 0.02) / 2 + 0.01, 0, ov, [0, 6], texH));
      out['leg' + sd + 'D'].push(boxUV(D.legW + OV, D.legL, D.legD + OV, 0, -D.legL / 2, 0, ov, [6, 12], texH));
    }
  }
  for (const e of extras) (out[e.part] || (out[e.part] = [])).push(boxUV(e.w, e.h, e.d, e.x, e.y, e.z, null, null, texH, { rect: e.rect }));
  const res = {};
  for (const [k, list] of Object.entries(out)) res[k] = piece(list);
  return { geos: res, dims: D };
}
// caixa avulsa com textura de uma área livre (decorações de zumbis)
export function atlasBox(w, h, d, rect) { return boxUV(w, h, d, 0, 0, 0, null, null, 64, { rect }); }

// ============================================================
//  PINTOR DE SKINS (pixel art procedural)
// ============================================================
const hexRGB = (h) => [(h >> 16) & 255, (h >> 8) & 255, h & 255];
const clamp255 = (v) => Math.max(0, Math.min(255, v | 0));
function shade(rgb, k) { return [clamp255(rgb[0] * k), clamp255(rgb[1] * k), clamp255(rgb[2] * k)]; }
function mixRGB(a, b, t) { return [clamp255(a[0] + (b[0] - a[0]) * t), clamp255(a[1] + (b[1] - a[1]) * t), clamp255(a[2] + (b[2] - a[2]) * t)]; }

class Painter {
  constructor(seed) {
    this.c = document.createElement('canvas'); this.c.width = this.c.height = TEX;
    this.g = this.c.getContext('2d');
    this.img = this.g.createImageData(TEX, TEX);
    this.d = this.img.data;
    this.r = mulberry32(seed);
  }
  // pixel de textura (coordenadas em pixels da textura)
  set(px, py, rgb, a = 255) {
    if (px < 0 || py < 0 || px >= TEX || py >= TEX) return;
    const i = (py * TEX + px) * 4;
    if (a < 255) { const t = a / 255, d = this.d; d[i] = d[i] * (1 - t) + rgb[0] * t; d[i + 1] = d[i + 1] * (1 - t) + rgb[1] * t; d[i + 2] = d[i + 2] * (1 - t) + rgb[2] * t; d[i + 3] = Math.max(d[i + 3], 255); return; }
    this.d[i] = rgb[0]; this.d[i + 1] = rgb[1]; this.d[i + 2] = rgb[2]; this.d[i + 3] = 255;
  }
  get(px, py) { const i = (py * TEX + px) * 4; return [this.d[i], this.d[i + 1], this.d[i + 2], this.d[i + 3]]; }
  clear(px, py) { const i = (py * TEX + px) * 4; this.d[i + 3] = 0; }
  // retângulo em unidades Minecraft, com ruído (textura) e gradiente vertical (sombra embaixo)
  fill(x, y, w, h, hex, { noise = 0.07, grad = 0, grain = 1, alpha = 255 } = {}) {
    const base = Array.isArray(hex) ? hex : hexRGB(hex);
    const X0 = Math.round(x * K), Y0 = Math.round(y * K), X1 = Math.round((x + w) * K), Y1 = Math.round((y + h) * K);
    for (let py = Y0; py < Y1; py++) for (let px = X0; px < X1; px++) {
      const cell = grain > 1 ? (((px / grain) | 0) * 7919 + ((py / grain) | 0) * 104729) % 997 / 997 : this.r();
      const k = 1 + (cell - 0.5) * 2 * noise - grad * ((py - Y0) / Math.max(1, Y1 - Y0));
      this.set(px, py, shade(base, k), alpha);
    }
  }
  // pontos individuais em unidades Minecraft (½ = 2 px de textura)
  dot(x, y, w, h, hex, alpha = 255) { this.fill(x, y, w, h, hex, { noise: 0.03, alpha }); }
  // salpicos aleatórios dentro de um retângulo
  speck(x, y, w, h, hex, n, size = 0.25, alpha = 255) {
    for (let i = 0; i < n; i++) this.dot(x + this.r() * (w - size), y + this.r() * (h - size), size, size, hex, alpha);
  }
  // linha "de pixel" vertical/horizontal
  vline(x, y0, y1, hex, w = 0.25) { this.dot(x, y0, w, y1 - y0, hex); }
  hline(x0, x1, y, hex, h = 0.25) { this.dot(x0, y, x1 - x0, h, hex); }
  // apaga (transparente) — rasgos na 2ª camada
  hole(x, y, w, h) { for (let py = Math.round(y * K); py < Math.round((y + h) * K); py++) for (let px = Math.round(x * K); px < Math.round((x + w) * K); px++) this.clear(px, py); }
  faces(reg, list, fn) { for (const f of list) { const [x, y, w, h] = faceRect(reg.o, reg.s, f); fn(x, y, w, h, f); } }
  all(reg, fn) { this.faces(reg, ['top', 'bottom', 'right', 'front', 'left', 'back'], fn); }
  side(reg, fn) { this.faces(reg, ['right', 'front', 'left', 'back'], fn); }
  finish() { this.g.putImageData(this.img, 0, 0); return this.c; }
}

// ---------- peças de pintura reutilizáveis ----------
function paintSkinBase(P, skin, opts = {}) {
  const S = hexRGB(skin);
  for (const reg of [MC.head, MC.body, MC.armR, MC.armL, MC.legR, MC.legL]) P.all(reg, (x, y, w, h) => P.fill(x, y, w, h, S, { noise: opts.noise ?? 0.05 }));
  // juntas e sombras suaves nas mãos
  for (const reg of [MC.armR, MC.armL]) P.side(reg, (x, y, w) => { P.fill(x, y + 11, w, 1, shade(S, 0.9), { noise: 0.04 }); P.hline(x, x + w, y + 10.75, shade(S, 0.82)); });
}

// Rosto (frente da cabeça). zombie: órbitas fundas, boca aberta, sangue.
function paintFace(P, ap, zombie) {
  const [fx, fy] = faceRect(MC.head.o, MC.head.s, 'front');
  const S = hexRGB(ap.skin), dark = shade(S, 0.72), hair = hexRGB(ap.hair ?? 0x2a1d14);
  P.fill(fx, fy + 7, 8, 1, shade(S, 0.9), { noise: 0.04 }); // mandíbula
  P.fill(fx + 0.5, fy + 5.5, 7, 0.5, shade(S, 0.95), { noise: 0.03 });
  const fem = ap.body === 'f';
  if (!zombie) {
    // sobrancelhas (mais finas e arqueadas no feminino)
    if (fem) { P.dot(fx + 1.25, fy + 3.25, 1.75, 0.25, shade(hair, 0.85)); P.dot(fx + 5, fy + 3.25, 1.75, 0.25, shade(hair, 0.85)); P.dot(fx + 1, fy + 3.5, 0.25, 0.25, shade(hair, 0.85)); P.dot(fx + 6.75, fy + 3.5, 0.25, 0.25, shade(hair, 0.85)); }
    else { P.dot(fx + 1, fy + 3, 2, 0.5, shade(hair, 0.9)); P.dot(fx + 5, fy + 3, 2, 0.5, shade(hair, 0.9)); }
    // olhos: branco + íris + brilho
    const iris = hexRGB(ap.eyes ?? 0x3a2a1a);
    for (const [ex, inner] of [[1, 1], [5, 0]]) {
      P.dot(fx + ex, fy + 4, 2, 1, [236, 232, 224]);
      P.dot(fx + ex + inner, fy + 4, 1, 1, iris);
      P.dot(fx + ex + inner + 0.5, fy + 4, 0.5, 0.5, shade(iris, 0.45));
      P.dot(fx + ex + inner, fy + 4, 0.25, 0.25, [255, 255, 255]);
      P.dot(fx + ex, fy + 5, 2, 0.25, shade(S, 0.85)); // olheira
    }
    // nariz e boca
    P.dot(fx + 3.5, fy + 5, 1, 0.75, shade(S, 0.86)); P.dot(fx + 3.25, fy + 5.75, 1.5, 0.25, dark);
    const lip = mixRGB(S, fem ? [186, 64, 78] : [168, 80, 74], fem ? 0.6 : 0.45);
    P.dot(fx + 3, fy + 6.5, 2, 0.5, lip); P.dot(fx + 3, fy + 6.5, 2, 0.25, shade(lip, 0.8));
    if (fem) {
      P.dot(fx + 3.25, fy + 6.25, 1.5, 0.25, shade(lip, 1.1)); // lábio superior
      P.dot(fx + 0.75, fy + 4, 0.25, 0.5, [30, 22, 20]); P.dot(fx + 7, fy + 4, 0.25, 0.5, [30, 22, 20]); // cílios
      P.dot(fx + 1, fy + 3.75, 2, 0.25, [40, 30, 28]); P.dot(fx + 5, fy + 3.75, 2, 0.25, [40, 30, 28]);
      P.dot(fx + 0.75, fy + 5.25, 1, 0.5, mixRGB(S, [220, 120, 120], 0.25)); P.dot(fx + 6.25, fy + 5.25, 1, 0.5, mixRGB(S, [220, 120, 120], 0.25)); // blush
    }
  } else {
    // órbitas escuras (os olhos brilhantes são peças separadas por cima)
    P.dot(fx + 1, fy + 3.5, 2.25, 1.5, shade(S, 0.35)); P.dot(fx + 4.75, fy + 3.5, 2.25, 1.5, shade(S, 0.35));
    P.dot(fx + 3.5, fy + 5, 1, 0.75, shade(S, 0.55));
    // boca aberta com dentes tortos e sangue escorrendo
    P.dot(fx + 2, fy + 6, 4, 1.25, [38, 8, 8]);
    for (let i = 0; i < 6; i++) if (P.r() < 0.75) P.dot(fx + 2.25 + i * 0.6, fy + 6, 0.4, 0.4 + P.r() * 0.3, [214, 204, 170]);
    P.dot(fx + 2 + P.r() * 3, fy + 7.25, 0.5, 0.75, [110, 14, 14]);
    // pele rasgada na bochecha
    if (P.r() < 0.6) { const cx = P.r() < 0.5 ? fx + 0.5 : fx + 6; P.dot(cx, fy + 5, 1.25, 1, [120, 22, 22]); P.dot(cx + 0.25, fy + 5.25, 0.5, 0.5, [200, 190, 160]); }
  }
}

// Cabelo por estilo (cabeça + camada do chapéu). Devolve peças 3D extras.
function paintHair(P, ap, zombie) {
  const style = ap.hairStyle || 'curto';
  if (style === 'careca') return [];
  const hair = hexRGB(ap.hair ?? 0x2a1d14);
  const strand = (x, y, w, h, base = hair) => { // fios: listras verticais claras/escuras
    P.fill(x, y, w, h, base, { noise: 0.06 });
    for (let px = 0; px < w; px += 0.5) if (P.r() < 0.45) P.dot(x + px, y + P.r() * h * 0.5, 0.25, h * (0.3 + P.r() * 0.5), shade(base, P.r() < 0.5 ? 0.8 : 1.18));
  };
  const patchy = zombie || style === 'ralo';
  const head = MC.head;
  const [tx, ty] = faceRect(head.o, head.s, 'top');
  const [fx, fy] = faceRect(head.o, head.s, 'front');
  const [bx, by] = faceRect(head.o, head.s, 'back');
  const [rx, ry] = faceRect(head.o, head.s, 'right');
  const [lx, ly] = faceRect(head.o, head.s, 'left');
  strand(tx, ty, 8, 8);
  const extras = [];
  if (style === 'moicano') {
    // laterais raspadas, faixa central alta (peça 3D)
    P.fill(tx, ty, 2.5, 8, mixRGB(hexRGB(ap.skin), hair, 0.35), { noise: 0.08 }); P.fill(tx + 5.5, ty, 2.5, 8, mixRGB(hexRGB(ap.skin), hair, 0.35), { noise: 0.08 });
    strand(fx + 3, fy, 2, 1.5);
    extras.push({ part: 'head', w: 0.1, h: 0.12, d: 0.42, x: 0, y: 0.44, z: -0.02, rect: XR.hair });
  } else {
    // franja irregular, laterais até as costeletas, nuca
    const fringe = style === 'longo' || style === 'chanel' ? 2 : style === 'afro' ? 2.5 : 1.5;
    strand(fx, fy, 8, 1);
    for (let i = 0; i < 8; i++) if (P.r() < 0.7) P.dot(fx + i, fy + 1, 1, (fringe - 1) * P.r() + 0.25, shade(hair, 0.92));
    const sideH = style === 'longo' ? 8 : style === 'chanel' ? 6.5 : style === 'afro' ? 5 : 3;
    strand(rx, ry, 8, sideH); strand(lx, ly, 8, sideH);
    P.dot(rx + 6.5, ry + sideH, 1.5, 1.5, hair); P.dot(lx, ly + sideH, 1.5, 1.5, hair); // costeletas
    strand(bx, by, 8, style === 'longo' ? 8 : style === 'chanel' ? 6.5 : style === 'afro' ? 6 : 5);
    if (style === 'longo' || style === 'chanel') { // mechas emoldurando o rosto, com volume (camada do chapéu)
      const len = style === 'longo' ? 8 : 6.5, hat = MC.hat;
      const [hfx, hfy] = faceRect(hat.o, hat.s, 'front');
      strand(hfx, hfy, 8, 1); strand(hfx, hfy + 1, 1.25, len - 1); strand(hfx + 6.75, hfy + 1, 1.25, len - 1);
      for (const fc of ['right', 'left']) { const [x, y] = faceRect(hat.o, hat.s, fc); strand(x, y, 8, len); }
      const [hbx, hby] = faceRect(hat.o, hat.s, 'back'); strand(hbx, hby, 8, len);
      const [htx, hty] = faceRect(hat.o, hat.s, 'top'); strand(htx, hty, 8, 8);
      strand(fx, fy + 1, 1, len - 1); strand(fx + 7, fy + 1, 1, len - 1); // por baixo também (sem frestas)
    }
    if (style === 'rabo') { // rabo de cavalo: prendedor + mecha caindo nas costas
      extras.push({ part: 'head', w: 0.12, h: 0.12, d: 0.08, x: 0, y: 0.26, z: -0.23, rect: XR.hair }, { part: 'head', w: 0.1, h: 0.34, d: 0.08, x: 0, y: 0.06, z: -0.27, rect: XR.hair });
    }
    if (style === 'longo') extras.push({ part: 'head', w: 0.36, h: 0.26, d: 0.06, x: 0, y: -0.06, z: -0.2, rect: XR.hair });
    if (style === 'coque') extras.push({ part: 'head', w: 0.16, h: 0.12, d: 0.16, x: 0, y: 0.46, z: -0.06, rect: XR.hair });
    if (style === 'afro') extras.push({ part: 'head', w: 0.52, h: 0.22, d: 0.5, x: 0, y: 0.42, z: -0.02, rect: XR.hair });
  }
  // textura da peça extra de cabelo
  strand(XR.hair[0], XR.hair[1], 8, 8);
  if (patchy) { // falhas mostrando o couro cabeludo
    const sc = shade(hexRGB(ap.skin), 0.85);
    for (let i = 0; i < 7; i++) P.dot(tx + P.r() * 7, ty + P.r() * 7, 1 + P.r(), 1 + P.r(), sc);
    for (let i = 0; i < 4; i++) P.dot(bx + P.r() * 7, by + P.r() * 4, 1, 1, sc);
  }
  return extras;
}

function paintBeard(P, ap) {
  if (!ap.beard || ap.beard === 'nenhuma') return;
  const hair = hexRGB(ap.hair ?? 0x2a1d14), [fx, fy] = faceRect(MC.head.o, MC.head.s, 'front');
  const fuzz = (x, y, w, h) => { P.fill(x, y, w, h, hair, { noise: 0.12 }); P.speck(x, y, w, h, shade(hair, 1.25), 6); };
  if (ap.beard === 'barba') { fuzz(fx, fy + 5.75, 3, 2.25); fuzz(fx + 5, fy + 5.75, 3, 2.25); fuzz(fx + 2.5, fy + 7.25, 3, 0.75); fuzz(fx + 2.5, fy + 5.75, 3, 0.6); P.dot(fx + 3, fy + 6.5, 2, 0.5, mixRGB(hexRGB(ap.skin), [168, 80, 74], 0.45)); }
  if (ap.beard === 'cavanhaque') { fuzz(fx + 3, fy + 7, 2, 1); fuzz(fx + 2.75, fy + 6, 2.5, 0.5); }
  if (ap.beard === 'bigode') fuzz(fx + 2.5, fy + 6, 3, 0.5);
  // laterais da barba cheia
  if (ap.beard === 'barba') for (const f of ['right', 'left']) { const [x, y] = faceRect(MC.head.o, MC.head.s, f); fuzz(x + (f === 'right' ? 5 : 0), y + 5, 3, 3); }
}

// Camisa/agasalho no tronco e mangas (camada de base)
function paintShirt(P, ap, { sleeves = 'long', collar = true, buttons = true, hood = false } = {}) {
  const T = hexRGB(ap.top), S = hexRGB(ap.skin);
  P.all(MC.body, (x, y, w, h, f) => {
    P.fill(x, y, w, h, T, { noise: 0.06, grad: f === 'top' || f === 'bottom' ? 0 : 0.14 });
    if (f === 'front' || f === 'back') {
      // dobras do tecido (diagonais escuras) e costuras laterais
      for (let i = 0; i < 4; i++) { const sx = x + 1 + P.r() * (w - 3), sy = y + 3 + P.r() * 6; for (let k = 0; k < 4; k++) P.dot(sx + k * 0.25, sy + k * 0.5, 0.25, 0.5, shade(T, 0.82)); }
      P.vline(x, y, y + h, shade(T, 0.85)); P.vline(x + w - 0.25, y, y + h, shade(T, 0.85));
    }
  });
  const [fx, fy] = faceRect(MC.body.o, MC.body.s, 'front');
  if (collar) { P.dot(fx + 3, fy, 2, 1, S); P.dot(fx + 3.5, fy + 1, 1, 0.75, S); P.dot(fx + 2.5, fy, 0.5, 1.25, shade(T, 0.7)); P.dot(fx + 5, fy, 0.5, 1.25, shade(T, 0.7)); }
  if (buttons) for (let i = 0; i < 4; i++) P.dot(fx + 3.85, fy + 2.5 + i * 2, 0.4, 0.4, shade(T, 0.6));
  if (ap.body === 'f') {
    P.dot(fx + 1, fy + 2.5, 2.5, 1.25, shade(T, 1.12)); P.dot(fx + 4.5, fy + 2.5, 2.5, 1.25, shade(T, 1.12)); // volume do busto
    P.dot(fx + 1, fy + 3.75, 2.5, 0.5, shade(T, 0.78)); P.dot(fx + 4.5, fy + 3.75, 2.5, 0.5, shade(T, 0.78));
    for (let r = 5.5; r < 9.5; r += 0.5) { P.dot(fx, fy + r, 0.75, 0.5, shade(T, 0.78)); P.dot(fx + 7.25, fy + r, 0.75, 0.5, shade(T, 0.78)); } // cintura
    if (collar) { P.dot(fx + 2.75, fy, 2.5, 0.75, S); P.dot(fx + 3.25, fy + 0.75, 1.5, 0.5, S); }
  }
  if (hood) { const [bx, by] = faceRect(MC.body.o, MC.body.s, 'back'); P.fill(bx + 1, by, 6, 2.5, shade(T, 0.85)); P.hline(bx + 1, bx + 7, by + 2.5, shade(T, 0.65)); P.dot(fx + 2.75, fy + 1, 0.25, 3, [220, 220, 220]); P.dot(fx + 5, fy + 1, 0.25, 3, [220, 220, 220]); }
  const rows = sleeves === 'long' ? 11 : sleeves === 'short' ? 4 : 0;
  for (const reg of [MC.armR, MC.armL]) {
    if (!rows) continue;
    P.faces(reg, ['top', 'right', 'front', 'left', 'back'], (x, y, w, h, f) => {
      if (f === 'top') { P.fill(x, y, w, h, T); return; }
      P.fill(x, y, w, rows, T, { noise: 0.06, grad: 0.12 });
      P.hline(x, x + w, y + rows - 0.25, shade(T, 0.65)); // punho/barra
      if (rows > 6) { P.hline(x, x + w, y + 6, shade(T, 0.8)); } // dobra do cotovelo
    });
  }
}

function paintPants(P, ap, { pockets = true, belt = true, stripe = null } = {}) {
  const Pn = hexRGB(ap.pants);
  for (const reg of [MC.legR, MC.legL]) {
    P.faces(reg, ['top', 'right', 'front', 'left', 'back'], (x, y, w, h, f) => {
      if (f === 'top') { P.fill(x, y, w, h, Pn); return; }
      P.fill(x, y, w, 10, Pn, { noise: 0.07, grad: 0.1 });
      P.hline(x, x + w, y + 5.5, shade(Pn, 0.82)); // joelho
      if (f === 'front') { P.speck(x, y + 5, w, 1.5, shade(Pn, 0.75), 3); if (pockets) { P.vline(x + 0.5, y + 0.5, y + 3, shade(Pn, 0.7)); } }
      if (stripe && (f === 'right' || f === 'left')) P.vline(x + 1.75, y, y + 10, hexRGB(stripe), 0.5);
      P.hline(x, x + w, y + 9.75, shade(Pn, 0.7)); // barra
    });
  }
  if (belt) {
    P.side(MC.body, (x, y, w) => { P.fill(x, y + 10.5, w, 0.75, [52, 38, 28], { noise: 0.06 }); P.fill(x, y + 11.25, w, 0.75, Pn, { noise: 0.06 }); });
    const [fx, fy] = faceRect(MC.body.o, MC.body.s, 'front');
    P.dot(fx + 3.5, fy + 10.5, 1, 0.75, [190, 170, 110]); P.dot(fx + 3.75, fy + 10.75, 0.5, 0.25, [80, 70, 40]);
  }
}

function paintShoes(P, ap) {
  const Sh = hexRGB(ap.shoes ?? 0x3a2a1e);
  for (const reg of [MC.legR, MC.legL]) {
    P.side(reg, (x, y, w, h, f) => {
      P.fill(x, y + 10, w, 2, Sh, { noise: 0.06 });
      P.hline(x, x + w, y + 11.5, shade(Sh, 0.45), 0.5); // sola
      if (f === 'front') { P.dot(x + 1, y + 10.25, 2, 0.25, shade(Sh, 1.4)); P.dot(x + 1, y + 10.75, 2, 0.25, shade(Sh, 1.3)); } // cadarço
    });
    const [bx, by, bw2, bh] = faceRect(reg.o, reg.s, 'bottom'); P.fill(bx, by, bw2, bh, shade(Sh, 0.4));
  }
}

// Colete tático (2ª camada da jaqueta) com bolsos e fitas
function paintVest(P, ap) {
  const V = mixRGB(shade(hexRGB(ap.top), 0.55), [58, 61, 44], 0.55);
  P.faces(MC.jacket, ['front', 'back', 'right', 'left'], (x, y, w, h, f) => {
    // frente aberta: dois painéis, a camisa aparece no meio
    const fem = ap.body === 'f';
    const panels = f === 'front' ? (fem ? [[0, 2], [6, 2]] : [[0, 2.75], [5.25, 2.75]]) : [[0, w]];
    for (const [px, pw] of panels) {
      P.fill(x + px, y + 1.5, pw, 8, V, { noise: 0.08 });
      for (let r = 2.5; r < 9; r += 1.5) P.hline(x + px, x + px + pw, y + r, shade(V, 0.75)); // fitas MOLLE
    }
    if (f === 'front') {
      for (const px of (ap.body === 'f' ? [0, 6.25] : [0.25, 5.5])) { P.fill(x + px, y + 6, ap.body === 'f' ? 1.75 : 2.25, 2.25, shade(V, 0.9)); const pw = ap.body === 'f' ? 1.75 : 2.25; P.hline(x + px, x + px + pw, y + 6, shade(V, 1.25), 0.5); P.dot(x + px + pw / 2 - 0.25, y + 6.5, 0.5, 0.25, [40, 40, 40]); }
      const e1 = ap.body === 'f' ? 1.75 : 2.5, e2 = ap.body === 'f' ? 6 : 5.25;
      P.vline(x + e1, y + 1.5, y + 9.5, shade(V, 0.6)); P.vline(x + e2, y + 1.5, y + 9.5, shade(V, 0.6)); // bordas do painel
    }
  });
  // alças nos ombros (topo)
  const [tx, ty] = faceRect(MC.jacket.o, MC.jacket.s, 'top'); P.fill(tx + 1, ty, 1.5, 4, shade(V, 0.8)); P.fill(tx + 5.5, ty, 1.5, 4, shade(V, 0.8));
}

function paintPack(P, ap) {
  const C = hexRGB(ap.pack ?? 0x3e6b3a), [x, y, w, h] = XR.pack;
  P.fill(x, y, w, h, C, { noise: 0.08 });
  P.fill(x + 1, y + 8, 6, 5, shade(C, 0.85)); P.hline(x + 1, x + 7, y + 8, shade(C, 1.25), 0.5); // bolso
  P.hline(x, x + w, y + 3, shade(C, 0.7)); P.dot(x + 3.5, y + 2.75, 1, 0.5, [170, 160, 120]); // zíper
  for (const sx of [0.5, 6.5]) P.vline(x + sx, y, y + h, shade(C, 0.6), 0.5); // costuras
}

// Acessórios: camada do chapéu e peças extras
function paintAccessory(P, ap) {
  const acc = ap.accessory || 'nenhum', extras = [];
  const hat = MC.hat;
  if (acc === 'bandana') { P.side(hat, (x, y, w) => { P.fill(x, y + 1, w, 1.5, [168, 30, 30], { noise: 0.1 }); P.speck(x, y + 1, w, 1.5, [230, 210, 200], 5); }); const [bx, by] = faceRect(hat.o, hat.s, 'back'); P.fill(bx + 3, by + 2.5, 2, 1.5, [140, 24, 24]); }
  if (acc === 'oculos') { const [fx, fy] = faceRect(hat.o, hat.s, 'front'); P.fill(fx, fy + 3.75, 8, 1.5, [18, 18, 20]); P.dot(fx + 1, fy + 4, 2, 1, [40, 70, 90]); P.dot(fx + 5, fy + 4, 2, 1, [40, 70, 90]); P.dot(fx + 1.25, fy + 4.1, 0.5, 0.25, [170, 220, 240]); P.side(hat, (x, y, w, h, f) => { if (f !== 'front') P.fill(x, y + 4, w, 0.75, [22, 22, 24]); }); }
  if (acc === 'mascara') { const [fx, fy] = faceRect(hat.o, hat.s, 'front'); P.fill(fx + 1, fy + 3.5, 6, 4.5, [52, 56, 60], { noise: 0.06 }); P.dot(fx + 1.25, fy + 3.75, 2, 1.25, [40, 70, 80]); P.dot(fx + 4.75, fy + 3.75, 2, 1.25, [40, 70, 80]); P.fill(fx + 3, fy + 6, 2, 2, [34, 36, 38]); for (let i = 0; i < 3; i++) P.hline(fx + 3, fx + 5, fy + 6.4 + i * 0.5, [80, 84, 88]); }
  if (acc === 'capacete') { P.faces(hat, ['top', 'right', 'front', 'left', 'back'], (x, y, w, h, f) => { const hh = f === 'top' ? h : 3; P.fill(x, y, w, hh, [75, 83, 32], { noise: 0.1 }); P.speck(x, y, w, hh, [55, 62, 24], 10); if (f !== 'top') P.hline(x, x + w, y + 3, [50, 55, 20], 0.5); }); }
  if (acc === 'chapeu') { P.faces(hat, ['top', 'right', 'front', 'left', 'back'], (x, y, w, h, f) => { const hh = f === 'top' ? h : 2.5; P.fill(x, y, w, hh, [92, 58, 34], { noise: 0.08 }); if (f !== 'top') P.hline(x, x + w, y + 2, [50, 30, 18], 0.5); }); P.fill(XR.acc[0], XR.acc[1], 8, 8, [92, 58, 34], { noise: 0.08 }); extras.push({ part: 'head', w: 0.66, h: 0.04, d: 0.66, x: 0, y: 0.32, z: 0, rect: XR.acc }); }
  if (acc === 'kasa') { // chapéu de palha cônico em degraus
    P.fill(XR.acc[0], XR.acc[1], 8, 8, [200, 168, 106], { noise: 0.1 }); for (let i = 0; i < 8; i += 1) P.hline(XR.acc[0], XR.acc[0] + 8, XR.acc[1] + i + 0.5, [160, 130, 80]);
    extras.push({ part: 'head', w: 0.86, h: 0.05, d: 0.86, x: 0, y: 0.42, z: 0, rect: XR.acc }, { part: 'head', w: 0.58, h: 0.07, d: 0.58, x: 0, y: 0.47, z: 0, rect: XR.acc }, { part: 'head', w: 0.3, h: 0.08, d: 0.3, x: 0, y: 0.53, z: 0, rect: XR.acc });
  }
  return extras;
}

// ---------- skin de jogador ----------
const skinCache = new Map();
export function paintPlayerSkin(ap) {
  const key = 'p:' + JSON.stringify([ap.body, ap.skin, ap.hair, ap.hairStyle, ap.beard, ap.eyes, ap.top, ap.pants, ap.shoes, ap.pack, ap.accessory, ap.sleeves]);
  if (skinCache.has(key)) return skinCache.get(key);
  const P = new Painter(((ap.skin ^ ap.top ^ ap.pants) & 0xffff) + 11);
  paintSkinBase(P, ap.skin);
  paintFace(P, ap, false);
  const extras = [...paintHair(P, ap, false)];
  paintBeard(P, ap);
  paintShirt(P, ap, { sleeves: ap.sleeves || 'long' });
  paintPants(P, ap);
  paintShoes(P, ap);
  paintVest(P, ap);
  paintPack(P, ap);
  extras.push(...paintAccessory(P, ap));
  extras.push({ part: 'torso', w: 0.34, h: 0.4, d: 0.14, x: 0, y: 0.36, z: -0.19, rect: XR.pack }); // mochila
  const res = { canvas: P.finish(), extras };
  skinCache.set(key, res);
  return res;
}

// ---------- skins de zumbi (por tipo e variação) ----------
function tear(P, reg, faces, n, S) { // rasgos na roupa mostrando pele machucada
  P.faces(reg, faces, (x, y, w, h) => {
    for (let i = 0; i < n; i++) {
      const tw = 1 + P.r() * 2, th = 1 + P.r() * 2.5, tx = x + P.r() * (w - tw), ty = y + 1 + P.r() * (h - th - 2);
      P.fill(tx, ty, tw, th, shade(S, 0.9), { noise: 0.1 });
      P.hline(tx, tx + tw, ty, [92, 20, 18], 0.25); P.hline(tx, tx + tw, ty + th - 0.25, [70, 16, 14], 0.25);
      if (P.r() < 0.5) P.dot(tx + tw / 2, ty + th / 2, 0.5, 0.5, [130, 26, 22]);
    }
  });
}
function blood(P, reg, faces, n) {
  P.faces(reg, faces, (x, y, w, h) => {
    for (let i = 0; i < n; i++) {
      const bx = x + P.r() * (w - 1), by = y + P.r() * (h - 2);
      P.dot(bx, by, 0.5 + P.r(), 0.5 + P.r() * 0.75, [96, 12, 12], 220);
      if (P.r() < 0.6) P.dot(bx + 0.25, by + 0.5, 0.25, 1 + P.r() * 2, [80, 10, 10], 220); // escorrido
    }
  });
}
function rot(P, S) { // hematomas, veias e podridão na pele
  for (const reg of [MC.head, MC.body, MC.armR, MC.armL, MC.legR, MC.legL]) P.side(reg, (x, y, w, h) => {
    P.speck(x, y, w, h, mixRGB(S, [70, 60, 90], 0.45), 6, 0.75, 170);
    P.speck(x, y, w, h, mixRGB(S, [80, 110, 40], 0.4), 5, 0.5, 170);
    if (P.r() < 0.5) { const vx = x + P.r() * (w - 1), vy = y + P.r() * (h - 3); for (let k = 0; k < 4; k++) P.dot(vx + (k % 2) * 0.25, vy + k * 0.5, 0.25, 0.5, shade(S, 0.62)); }
  });
}

export function paintZombieSkin(type, ap, variant) {
  const key = 'z:' + type + ':' + variant;
  if (skinCache.has(key)) return skinCache.get(key);
  const P = new Painter(variant * 977 + type.length * 131 + 7);
  const S = hexRGB(ap.skin);
  paintSkinBase(P, ap.skin, { noise: 0.09 });
  rot(P, S);
  paintFace(P, ap, true);
  const extras = [...paintHair(P, { ...ap, hairStyle: ap.hairStyle === 'careca' ? 'careca' : ap.body === 'f' ? 'longo' : 'ralo' }, true)];
  const shirt = { sleeves: ap.sleeves || 'long', collar: true, buttons: true };
  if (type === 'corredor') Object.assign(shirt, { buttons: false, hood: true });
  if (type === 'brutamontes') Object.assign(shirt, { buttons: false, collar: false });
  if (type === 'blindado') Object.assign(shirt, { sleeves: 'long', buttons: false });
  paintShirt(P, ap, shirt);
  paintPants(P, ap, { stripe: type === 'corredor' ? 0xd8d8d8 : null, belt: type !== 'brutamontes' });
  paintShoes(P, ap);
  // roupa rasgada, sangue
  tear(P, MC.body, ['front', 'back'], 3, S);
  if (ap.tornArm) tear(P, MC.armR, ['front', 'right', 'back'], 2, S);
  if (ap.tornPants) tear(P, MC.legL, ['front', 'left'], 2, S);
  blood(P, MC.body, ['front'], 5); blood(P, MC.armR, ['front', 'right'], 2); blood(P, MC.legR, ['front'], 2);
  const [fx, fy] = faceRect(MC.body.o, MC.body.s, 'front');
  // costelas expostas num rasgo grande
  if (type !== 'blindado' && P.r() < 0.7) {
    const rx = fx + (P.r() < 0.5 ? 0.75 : 4.25), ry = fy + 3.5;
    P.fill(rx, ry, 3, 3.5, [58, 10, 10]);
    for (let i = 0; i < 3; i++) P.fill(rx + 0.25, ry + 0.5 + i * 1.1, 2.5, 0.5, [214, 204, 172], { noise: 0.05 });
  }
  if (type === 'brutamontes') { // macacão jeans com alças e peitilho
    const O = [58, 76, 108];
    P.fill(fx + 1.5, fy + 4, 5, 6.5, O, { noise: 0.08 }); P.dot(fx + 3, fy + 5, 2, 1.5, shade(O, 0.8));
    P.fill(fx + 1.5, fy, 1, 4, O); P.fill(fx + 5.5, fy, 1, 4, O); P.dot(fx + 1.75, fy + 3.5, 0.5, 0.5, [200, 180, 110]); P.dot(fx + 5.75, fy + 3.5, 0.5, 0.5, [200, 180, 110]);
    for (const reg of [MC.legR, MC.legL]) P.faces(reg, ['right', 'front', 'left', 'back'], (x, y, w) => P.fill(x, y, w, 10, O, { noise: 0.08, grad: 0.1 }));
    // pontos de sutura na cabeça careca
    const [tx, ty] = faceRect(MC.head.o, MC.head.s, 'top'); for (let i = 0; i < 6; i++) P.dot(tx + 1 + i, ty + 3 + (i % 2) * 0.5, 0.5, 0.25, [40, 20, 20]);
  }
  if (type === 'blindado') { // camuflado + colete balístico + capacete
    const camo = [[75, 83, 32], [58, 66, 28], [96, 92, 58], [42, 46, 24]];
    for (const reg of [MC.body, MC.armR, MC.armL, MC.legR, MC.legL]) P.side(reg, (x, y, w, h) => { for (let i = 0; i < 14; i++) P.dot(x + P.r() * (w - 1), y + P.r() * (h - 2.5), 1 + P.r(), 0.75 + P.r(), camo[(P.r() * 4) | 0]); });
    paintVest(P, { top: 0x2e3320 });
    paintAccessory(P, { accessory: 'capacete' });
  }
  if (type === 'cuspidor') { // ácido escorrendo da boca, papo inchado (peça 3D)
    const [hx, hy] = faceRect(MC.head.o, MC.head.s, 'front');
    for (let i = 0; i < 3; i++) P.dot(hx + 2.5 + i, hy + 7, 0.5, 1, [150, 220, 40]);
    P.speck(fx, fy, 8, 4, [150, 210, 40], 6, 0.5);
    const [x, y] = XR.acc; P.fill(x, y, 8, 8, [150, 176, 70], { noise: 0.1 }); for (let i = 0; i < 5; i++) P.vline(x + 1 + P.r() * 6, y + P.r() * 3, y + 4 + P.r() * 4, [70, 90, 30], 0.5); P.speck(x, y, 8, 8, [200, 255, 80], 4, 0.5);
  }
  if (type === 'explosivo') { // pele estufada com pústulas (barriga 3D)
    const [x, y, w, h] = XR.pack;
    P.fill(x, y, w, h, mixRGB(S, [200, 150, 110], 0.3), { noise: 0.08 });
    for (let i = 0; i < 9; i++) { const px = x + P.r() * (w - 1), py = y + P.r() * (h - 1); P.dot(px, py, 1, 1, [220, 196, 80]); P.dot(px + 0.25, py + 0.25, 0.5, 0.5, [250, 240, 150]); }
    for (let i = 0; i < 5; i++) { const vx = x + P.r() * w, vy = y + P.r() * (h - 4); for (let k = 0; k < 6; k++) P.dot(vx + Math.sin(k) * 0.5, vy + k * 0.5, 0.25, 0.5, [100, 50, 70]); }
    P.speck(fx, fy, 8, 10, [220, 196, 80], 6, 0.5);
  }
  if (type === 'brutamontes' || type === 'blindado') { const [x, y] = XR.hair; P.fill(x, y, 8, 8, [216, 208, 184], { noise: 0.08 }); P.speck(x, y, 8, 8, [150, 140, 120], 8); } // osso
  const res = { canvas: P.finish(), extras };
  skinCache.set(key, res);
  return res;
}

const texCache = new Map();
export function canvasTexture(canvas) {
  let t = texCache.get(canvas);
  if (!t) {
    t = new THREE.CanvasTexture(canvas);
    t.colorSpace = THREE.SRGBColorSpace;
    t.magFilter = THREE.NearestFilter;
    t.minFilter = THREE.NearestMipmapLinearFilter;
    t.anisotropy = 4;
    texCache.set(canvas, t);
  }
  return t;
}
