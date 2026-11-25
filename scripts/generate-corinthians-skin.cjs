// Gera uma skin no layout clássico 64x64 em resolução 4x (256x256).
// npm run skin:corinthians
const { PNG } = require('pngjs');
const fs = require('node:fs');
const path = require('node:path');

const S = 4, png = new PNG({ width: 64 * S, height: 64 * S });
const C = {
  white: '#eeeae2', ivory: '#fffaf0', black: '#121417', charcoal: '#25282c',
  grey: '#9a9da0', red: '#aa1f2b', blue: '#254876', skin: '#aa7957',
  skinShade: '#8b6046', hair: '#1c1716', hairLit: '#342b29', sock: '#dedcda',
};
function rgba(hex, alpha = 255) {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16), alpha];
}
function dot(x, y, color, a = 255) {
  x = Math.round(x); y = Math.round(y);
  if (x < 0 || y < 0 || x >= png.width || y >= png.height) return;
  const i = (y * png.width + x) * 4, c = rgba(color, a);
  for (let k = 0; k < 4; k++) png.data[i + k] = c[k];
}
function rect(x, y, w, h, c, a = 255) {
  for (let yy = Math.floor(y); yy < Math.ceil(y + h); yy++)
    for (let xx = Math.floor(x); xx < Math.ceil(x + w); xx++) dot(xx, yy, c, a);
}
function line(x0, y0, x1, y1, width, c) {
  const n = Math.ceil(Math.hypot(x1 - x0, y1 - y0) * 2);
  for (let i = 0; i <= n; i++) {
    const t = i / Math.max(1, n), x = x0 + (x1 - x0) * t, y = y0 + (y1 - y0) * t;
    for (let yy = -width; yy <= width; yy++) for (let xx = -width; xx <= width; xx++)
      if (xx * xx + yy * yy <= width * width) dot(x + xx, y + yy, c);
  }
}
function ellipse(cx, cy, rx, ry, c) {
  for (let y = Math.floor(cy - ry); y <= cy + ry; y++)
    for (let x = Math.floor(cx - rx); x <= cx + rx; x++)
      if (((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1) dot(x, y, c);
}
function panel(ox, oy, w, h, d, face) {
  const p = {
    top: [ox + d, oy, w, d], bottom: [ox + d + w, oy, w, d],
    right: [ox, oy + d, d, h], front: [ox + d, oy + d, w, h],
    left: [ox + d + w, oy + d, d, h], back: [ox + 2 * d + w, oy + d, w, h],
  }[face];
  return p.map(v => v * S);
}
function fillPart(ox, oy, w, h, d, color) {
  for (const f of ['top', 'bottom', 'right', 'front', 'left', 'back']) rect(...panel(ox, oy, w, h, d, f), color);
}
function px(ox, oy, w, h, d, face, u, v) {
  const [x, y, fw, fh] = panel(ox, oy, w, h, d, face);
  return [x + u * fw, y + v * fh];
}
function swoosh(x, y, scale = 1) {
  line(x, y, x + 3 * scale, y + 2 * scale, .65 * scale, C.black);
  line(x + 3 * scale, y + 2 * scale, x + 10 * scale, y - 2 * scale, 1.0 * scale, C.black);
  line(x + 3 * scale, y + 2 * scale, x + 8 * scale, y + .2 * scale, .55 * scale, C.black);
}
function crest(cx, cy, r) {
  // Âncora, remos e círculo do SCCP, reduzidos para caber na textura.
  line(cx - r * .8, cy - r * .8, cx + r * .8, cy + r * .8, .55, C.red);
  line(cx + r * .8, cy - r * .8, cx - r * .8, cy + r * .8, .55, C.red);
  line(cx, cy - r * .65, cx, cy + r * 1.1, .7, C.red);
  line(cx - r * .45, cy + r * .7, cx, cy + r * 1.1, .5, C.red);
  line(cx + r * .45, cy + r * .7, cx, cy + r * 1.1, .5, C.red);
  ellipse(cx, cy, r * .68, r * .68, C.white);
  ellipse(cx, cy, r * .54, r * .54, C.black);
  ellipse(cx, cy, r * .38, r * .38, C.white);
  line(cx - r * .32, cy - r * .1, cx + r * .3, cy + r * .12, .7, C.black);
  rect(cx - r * .34, cy - r * .31, r * .22, r * .2, C.red);
}

// Cabeça e cabelo pintado sob a camada 3D do jogo.
fillPart(0, 0, 8, 8, 8, C.skin);
for (const f of ['top', 'back']) rect(...panel(0, 0, 8, 8, 8, f), C.hair);
for (const f of ['front', 'left', 'right']) {
  const [x, y, w, h] = panel(0, 0, 8, 8, 8, f);
  rect(x, y, w, f === 'front' ? h * .19 : h * .37, C.hair);
  for (let i = 0; i < 8; i++) line(x + i * w / 8, y + 2, x + i * w / 8 + (i % 2 ? 1 : -1), y + h * .23, .4, C.hairLit);
}
{
  const [x, y, w, h] = panel(0, 0, 8, 8, 8, 'front');
  for (const dx of [.31, .69]) {
    ellipse(x + w * dx, y + h * .49, 2.2, 1.9, C.white);
    ellipse(x + w * dx, y + h * .49, 1.15, 1.5, C.black);
    line(x + w * dx - 3, y + h * .42, x + w * dx + 2, y + h * .41, .6, C.hair);
  }
  line(x + w * .43, y + h * .76, x + w * .57, y + h * .76, .65, C.skinShade);
}

// Camisa branca Nike Corinthians: gola, ombros e escudo no peito.
fillPart(16, 16, 8, 12, 4, C.white);
for (const f of ['front', 'back', 'left', 'right']) {
  const [x, y, w, h] = panel(16, 16, 8, 12, 4, f);
  rect(x, y, w, 3, C.ivory);
  rect(x, y + h - 3, w, 2, C.black);
  if (f === 'front' || f === 'back') {
    rect(x + w * .36, y, w * .28, 3, C.black);
    line(x + w * .5, y + 3, x + w * .5, y + 16, .45, C.grey);
  }
}
{
  const [x, y, w] = panel(16, 16, 8, 12, 4, 'front');
  swoosh(x + 4, y + 11, .8);
  crest(x + w - 9, y + 14, 6);
  line(x + 2, y + 27, x + w - 2, y + 27, .45, C.grey);
}
{
  const [x, y, w] = panel(16, 16, 8, 12, 4, 'back');
  rect(x + 4, y + 8, w - 8, 4, C.charcoal);
  rect(x + 7, y + 9, w - 14, 2, C.white);
  crest(x + w / 2, y + 22, 5);
}

// Mangas brancas, braços e luvas finas pretas.
for (const [ox, oy] of [[40, 16], [32, 48]]) {
  fillPart(ox, oy, 4, 12, 4, C.skin);
  for (const f of ['front', 'back', 'left', 'right']) {
    const [x, y, w, h] = panel(ox, oy, 4, 12, 4, f);
    rect(x, y, w, h * .37, C.white);
    rect(x, y + h * .35, w, 2, C.black);
    rect(x, y + h * .88, w, 2, C.charcoal);
  }
}

// Short Adidas preto: três faixas laterais, meias claras, tênis alvinegros.
for (const [ox, oy] of [[0, 16], [16, 48]]) {
  fillPart(ox, oy, 4, 12, 4, C.black);
  for (const f of ['front', 'back', 'left', 'right']) {
    const [x, y, w, h] = panel(ox, oy, 4, 12, 4, f);
    rect(x, y + h * .52, w, h * .33, C.sock);
    rect(x, y + h * .82, w, h * .18, C.black);
    rect(x, y + h * .9, w, 2, C.white);
    if (f === 'front' || f === 'back') {
      rect(x + 1, y + 1, w - 2, 2, C.charcoal);
      for (let i = 0; i < 3; i++) line(x + 1 + i * 2.2, y + 5, x + 1 + i * 2.2, y + h * .49, .45, C.white);
      line(x + 2, y + h * .86, x + w - 2, y + h * .93, .7, C.red);
      swoosh(x + 3, y + h * .88, .42);
    } else {
      for (let i = 0; i < 3; i++) line(x + w * (.25 + i * .23), y + 4, x + w * (.25 + i * .23), y + h * .49, .6, C.white);
    }
  }
}

const output = path.join(__dirname, '..', 'assets', 'skins', 'corinthians-256.png');
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, PNG.sync.write(png, { colorType: 6 }));
console.log(output);
