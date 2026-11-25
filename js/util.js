// Utilidades gerais
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const rand = (a, b, r = Math.random) => a + r() * (b - a);
export const randi = (a, b, r = Math.random) => Math.floor(a + r() * (b - a + 1));
export const pick = (arr, r = Math.random) => arr[Math.floor(r() * arr.length)];
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

export function weighted(obj, r = Math.random) {
  // obj: { key: weight }
  let total = 0;
  for (const k in obj) total += obj[k];
  let x = r() * total;
  for (const k in obj) { x -= obj[k]; if (x <= 0) return k; }
  return Object.keys(obj)[0];
}

export function angleLerp(a, b, t) {
  let d = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

export function angleDiff(a, b) {
  let d = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

// Resolve círculo (x,z,r) contra AABB. Retorna [dx,dz] de empurrão ou null.
export function circleVsBox(x, z, r, b) {
  const cx = clamp(x, b.minX, b.maxX);
  const cz = clamp(z, b.minZ, b.maxZ);
  let dx = x - cx, dz = z - cz;
  const d2 = dx * dx + dz * dz;
  if (d2 >= r * r) return null;
  if (d2 > 1e-8) {
    const d = Math.sqrt(d2);
    return [(dx / d) * (r - d), (dz / d) * (r - d)];
  }
  // centro dentro da caixa: empurra pelo menor eixo
  const left = x - b.minX, right = b.maxX - x, top = z - b.minZ, bottom = b.maxZ - z;
  const m = Math.min(left, right, top, bottom);
  if (m === left) return [-(left + r), 0];
  if (m === right) return [right + r, 0];
  if (m === top) return [0, -(top + r)];
  return [0, bottom + r];
}

export function fmtMoney(v) {
  return '$' + Math.round(v).toLocaleString('pt-BR');
}

export function hexToCss(h) {
  return '#' + h.toString(16).padStart(6, '0');
}

export function el(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
