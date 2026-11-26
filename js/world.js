// ============================================================
//  MUNDO — geração procedural de mapas apocalípticos
//  Quarteirões, ruas, ruínas saqueáveis, ninhos de zumbi,
//  zona segura, colisão e grade de navegação (flow field).
// ============================================================
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CONTAINERS } from './data.js';
import { mulberry32, rand, randi, pick, weighted, clamp } from './util.js';
import { mat, box } from './character.js';
import { addOcclusion } from './occlusion.js';
import { lowPower } from './device.js';
import { makeFlames, makeFirePit, asphaltBump } from './camp.js';

const P = 34, ROAD = 8, BLOCK = P - ROAD;
const CELL = 1;
const TILE_W = 16, TILE_H = 14;

// ---------- Texturas compartilhadas ----------
let facadeTex = null, facadeEmi = null;
function makeFacadeTextures() {
  if (facadeTex) return;
  const S = 512, c = document.createElement('canvas'), e = document.createElement('canvas');
  c.width = c.height = e.width = e.height = S;
  const g = c.getContext('2d'), ge = e.getContext('2d');
  g.fillStyle = '#d4d0ca'; g.fillRect(0, 0, S, S);
  for (let i = 0; i < 4000; i++) {
    const v = 180 + Math.random() * 60 | 0;
    g.fillStyle = `rgba(${v},${v},${v - 8},0.25)`;
    g.fillRect(Math.random() * S, Math.random() * S, 2, 2);
  }
  ge.fillStyle = '#000'; ge.fillRect(0, 0, S, S);
  const cell = S / 4;
  for (let fy = 0; fy < 4; fy++) {
    g.fillStyle = 'rgba(90,85,80,0.5)';
    g.fillRect(0, fy * cell + cell - 6, S, 6);
    for (let fx = 0; fx < 4; fx++) {
      const x = fx * cell + 26, y = fy * cell + 24, w = cell - 52, h = cell - 50;
      g.fillStyle = '#4a4844'; g.fillRect(x - 4, y - 4, w + 8, h + 8);
      const broken = Math.random() < 0.35;
      g.fillStyle = broken ? '#0b0c0e' : '#1d2128'; g.fillRect(x, y, w, h);
      if (!broken) {
        g.fillStyle = 'rgba(120,140,160,0.18)'; g.fillRect(x + 4, y + 4, w * 0.4, h - 8);
      } else {
        g.fillStyle = '#2b3036';
        g.beginPath(); g.moveTo(x, y); g.lineTo(x + w * 0.4, y); g.lineTo(x + w * 0.1, y + h * 0.5); g.fill();
      }
      g.fillStyle = '#4a4844'; g.fillRect(x + w / 2 - 2, y, 4, h);
      if (Math.random() < 0.14) {
        ge.fillStyle = Math.random() < 0.5 ? '#ff9a3a' : '#c8a060';
        ge.globalAlpha = 0.5 + Math.random() * 0.5;
        ge.fillRect(x, y, w, h);
        ge.globalAlpha = 1;
      }
    }
  }
  // sujeira escorrida
  for (let i = 0; i < 40; i++) {
    g.fillStyle = `rgba(40,35,30,${0.05 + Math.random() * 0.12})`;
    g.fillRect(Math.random() * S, Math.random() * S, 3 + Math.random() * 10, 30 + Math.random() * 120);
  }
  facadeTex = new THREE.CanvasTexture(c);
  facadeTex.wrapS = facadeTex.wrapT = THREE.RepeatWrapping;
  facadeTex.colorSpace = THREE.SRGBColorSpace;
  facadeTex.anisotropy = 4;
  facadeEmi = new THREE.CanvasTexture(e);
  facadeEmi.wrapS = facadeEmi.wrapT = THREE.RepeatWrapping;
  facadeEmi.colorSpace = THREE.SRGBColorSpace;
}

const _c = new THREE.Color();
const darkerHex = (h) => new THREE.Color(h).multiplyScalar(0.7).getHex();
function colorize(g, hex, jitter = 0, r = Math.random) {
  _c.set(hex);
  if (jitter) { const j = 1 + (r() - 0.5) * jitter; _c.r *= j; _c.g *= j; _c.b *= j; }
  const n = g.attributes.position.count, arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { arr[i * 3] = _c.r; arr[i * 3 + 1] = _c.g; arr[i * 3 + 2] = _c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return g;
}
function facadeUV(g, w, h, d, off) {
  const uv = g.attributes.uv;
  for (let f = 0; f < 6; f++) {
    for (let k = 0; k < 4; k++) {
      const i = f * 4 + k;
      let u = uv.getX(i), v = uv.getY(i);
      if (f === 2 || f === 3) { u = 0.01; v = 0.01; }
      else { const fw = f < 2 ? d : w; u = (u * fw) / TILE_W + off; v = (v * h) / TILE_H; }
      uv.setXY(i, u, v);
    }
  }
}

// ---------- Contêineres saqueáveis (malhas) ----------
const darkCache = new Map();
function darkVersion(m) {
  let d = darkCache.get(m);
  if (!d) { d = m.clone(); d.color = m.color.clone().multiplyScalar(0.35); d.emissiveIntensity = 0; addOcclusion(d); darkCache.set(m, d); }
  return d;
}
const CM = {};
function cmats() {
  if (CM.wood) return CM;
  CM.wood = mat(0x8a6a3a); CM.woodDark = mat(0x5a4426);
  CM.green = mat(0x2f5a3a); CM.greenDark = mat(0x22402a);
  CM.metal = mat(0x6a7076, { metalness: 0.5, roughness: 0.5 });
  CM.steel = mat(0x3a3d42, { metalness: 0.7, roughness: 0.4 });
  CM.gold = mat(0xc9a440, { metalness: 0.8, roughness: 0.3, emissive: 0x3a2a00 });
  CM.olive = mat(0x4b5a2a); CM.white = mat(0xd8d8d0);
  CM.glass = mat(0x1d252c, { roughness: 0.2, metalness: 0.3 });
  CM.tire = mat(0x151515);
  CM.light = mat(0xd8d0b0, { emissive: 0x3a3420, roughness: 0.2 });
  CM.purple = mat(0x5a1a7a, { emissive: 0x8a2aff, emissiveIntensity: 0.6 });
  return CM;
}
function m3(geo, material, x, y, z) {
  const m = new THREE.Mesh(geo, material);
  m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true;
  return m;
}
const CAR_COLORS = [0x7a2a22, 0x2a3a5a, 0x8a8a80, 0x3a4a3a, 0x6a5a3a, 0x9a7a2a, 0x4a2a3a, 0x2a2a2a];
const wheelGeo = new THREE.CylinderGeometry(0.38, 0.38, 0.3, 14);
const carBodyGeo = (() => { const g = new THREE.CapsuleGeometry(0.42, 3.4, 5, 14); g.rotateX(Math.PI / 2); g.scale(2.4, 1, 1); return g; })();
const carCabinGeo = (() => { const g = new THREE.CapsuleGeometry(0.36, 1.5, 5, 12); g.rotateX(Math.PI / 2); g.scale(2.4, 1, 1); return g; })();
const lightGeo = new THREE.SphereGeometry(0.13, 10, 8);
function containerMesh(type, r) {
  const M = cmats();
  const g = new THREE.Group();
  let w = 1, d = 1, h = 1;
  switch (type) {
    case 'lixeira':
      w = 2.0; d = 1.1; h = 1.2;
      g.add(m3(box(2, 1.1, 1.1), M.green, 0, 0.55, 0));
      g.add(m3(box(2.05, 0.1, 1.15), M.greenDark, 0, 1.15, 0));
      break;
    case 'caixa':
      g.add(m3(box(1, 1, 1), M.wood, 0, 0.5, 0));
      g.add(m3(box(1.04, 0.12, 1.04), M.woodDark, 0, 0.85, 0));
      g.add(m3(box(1.04, 0.12, 1.04), M.woodDark, 0, 0.15, 0));
      break;
    case 'armario':
      w = 1; d = 0.6; h = 2;
      g.add(m3(box(1, 2, 0.6), M.metal, 0, 1, 0));
      g.add(m3(box(0.03, 1.8, 0.62), M.steel, 0, 1, 0));
      break;
    case 'carro': {
      w = 2; d = 4.2; h = 1.6;
      const col = mat(pick(CAR_COLORS, r), { metalness: 0.45, roughness: 0.5 });
      const body = m3(carBodyGeo, col, 0, 0.62, 0); g.add(body);
      g.add(m3(carCabinGeo, M.glass, 0, 1.12, -0.25));
      g.add(m3(lightGeo, M.light, -0.65, 0.68, 2.08));
      g.add(m3(lightGeo, M.light, 0.65, 0.68, 2.08));
      for (const [x, z] of [[-0.95, 1.3], [0.95, 1.3], [-0.95, -1.3], [0.95, -1.3]]) {
        const wh = m3(wheelGeo, M.tire, x, 0.38, z); wh.rotation.z = Math.PI / 2; g.add(wh);
      }
      break;
    }
    case 'militar':
      w = 1.6; d = 1; h = 0.8;
      g.add(m3(box(1.6, 0.8, 1), M.olive, 0, 0.4, 0));
      g.add(m3(box(1.62, 0.12, 0.3), M.white, 0, 0.55, 0));
      break;
    case 'cofre':
      w = 1; d = 1; h = 1.2;
      g.add(m3(box(1, 1.2, 1), M.steel, 0, 0.6, 0));
      { const dial = m3(new THREE.CylinderGeometry(0.15, 0.15, 0.06, 12), M.gold, 0, 0.7, 0.52); dial.rotation.x = Math.PI / 2; g.add(dial); }
      break;
    case 'tesouro':
      w = 1.6; d = 1.1; h = 1;
      g.add(m3(box(1.6, 0.8, 1.1), M.purple, 0, 0.4, 0));
      g.add(m3(box(1.66, 0.2, 1.16), M.gold, 0, 0.85, 0));
      break;
  }
  return { g, w, d, h };
}

// ---------- Ninho de zumbis ----------
function nestMesh(mother) {
  const g = new THREE.Group();
  const flesh = mat(0x5a1a2e, { roughness: 0.6, emissive: 0x8a1aff, emissiveIntensity: 0.4 });
  const vein = new THREE.MeshBasicMaterial({ color: 0xc040ff });
  const goo = new THREE.Mesh(new THREE.CircleGeometry(mother ? 7 : 3.6, 24), new THREE.MeshStandardMaterial({ color: 0x3a0f3a, roughness: 0.3, transparent: true, opacity: 0.85 }));
  goo.rotation.x = -Math.PI / 2; goo.position.y = 0.03; goo.receiveShadow = true;
  g.add(goo);
  const core = new THREE.Mesh(new THREE.IcosahedronGeometry(1.35, 1), flesh);
  core.position.y = 1.1; core.scale.set(1, 1.25, 1); core.castShadow = true;
  g.add(core);
  const veins = new THREE.Mesh(new THREE.IcosahedronGeometry(1.4, 1), vein);
  veins.material = new THREE.MeshBasicMaterial({ color: 0xc040ff, wireframe: true, transparent: true, opacity: 0.6 });
  veins.position.copy(core.position); veins.scale.copy(core.scale);
  g.add(veins);
  const tGeo = new THREE.CylinderGeometry(0.08, 0.28, 2.4, 6);
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2;
    const t = new THREE.Mesh(tGeo, flesh);
    t.position.set(Math.cos(a) * 1.5, 0.9, Math.sin(a) * 1.5);
    t.rotation.z = Math.cos(a) * 0.7; t.rotation.x = -Math.sin(a) * 0.7;
    t.castShadow = true;
    g.add(t);
  }
  const eggGeo = new THREE.SphereGeometry(0.3, 8, 6);
  for (let i = 0; i < 6; i++) {
    const a = Math.random() * Math.PI * 2, rr = 2 + Math.random() * 1.2;
    const e = new THREE.Mesh(eggGeo, flesh);
    e.position.set(Math.cos(a) * rr, 0.25, Math.sin(a) * rr);
    e.scale.y = 1.3;
    g.add(e);
  }
  if (mother) g.scale.setScalar(2.1);
  return { g, core, veins, flesh };
}

// ============================================================
export function createWorld(scene, mapDef, seed = (Math.random() * 1e9) | 0) {
  makeFacadeTextures();
  const r = mulberry32(seed);
  const N = mapDef.blocks;
  const S = N * P + ROAD;
  const half = S / 2;
  const theme = mapDef.theme;
  const col = mapDef.colors;

  const facadeGeos = [], plainGeos = [], glowGeos = [], occluderGeos = [];
  const fadeBuildings = [];
  const colliders = [];
  const containerSpecs = [];
  const fireSpots = [];
  const lampSpots = [];
  const group = new THREE.Group();
  scene.add(group);

  // ----- helpers -----
  const addCollider = (minX, minZ, maxX, maxZ, h = 3) => colliders.push({ minX, minZ, maxX, maxZ, h });
  function addPlain(w, h, d, x, y, z, color, opts = {}) {
    const g = opts.geo || new THREE.BoxGeometry(w, h, d);
    colorize(g, color, opts.jitter ?? 0.15, r);
    if (opts.rotY) g.rotateY(opts.rotY);
    if (opts.rotX) g.rotateX(opts.rotX);
    if (opts.rotZ) g.rotateZ(opts.rotZ);
    g.translate(x, y, z);
    (opts.occluder ? occluderGeos : opts.glow ? glowGeos : plainGeos).push(g);
    if (opts.occluder) fadeBuildings.push({ geometry: g, x, z, w, d, h });
    if (opts.collide) addCollider(x - w / 2, z - d / 2, x + w / 2, z + d / 2, h);
  }
  function addBuilding(cx, cz, w, d, h, color, collide = true) {
    const g = new THREE.BoxGeometry(w, h, d);
    facadeUV(g, w, h, d, randi(0, 3, r) * 0.25);
    colorize(g, color, 0.2, r);
    g.translate(cx, h / 2, cz);
    occluderGeos.push(g);
    fadeBuildings.push({ geometry: g, x: cx, z: cz, w, d, h });
    // parapeito e detalhes do telhado
    addPlain(w + 0.3, 0.5, d + 0.3, cx, h + 0.25, cz, 0x3a3836);
    // Acabamentos de fachada e cobertura: marquises, sacadas e equipamentos
    // dão escala urbana sem alterar colisão, saque ou navegação.
    const concrete = darkerHex(color);
    if (w > 5 && h > 3) {
      addPlain(w * 0.36, 0.16, 0.72, cx, 2.55, cz + d / 2 + 0.28, pick([0x55453a, 0x414345, 0x69533a], r), { jitter: 0.08 });
      addPlain(w * 0.38, 0.08, 0.08, cx, 2.42, cz + d / 2 + 0.61, 0x353331, { jitter: 0.04 });
    }
    if (w > 7 && h > 7 && r() < 0.58) {
      const floors = Math.max(1, Math.floor(h / 4.2));
      const floor = randi(1, floors, r);
      const bx = cx + rand(-w * 0.22, w * 0.22, r);
      const by = floor * 3.6;
      const bz = cz + d / 2 + 0.19;
      addPlain(w * 0.22, 0.12, 0.48, bx, by, bz, concrete, { jitter: 0.05 });
      addPlain(w * 0.22, 0.07, 0.08, bx, by + 0.48, bz + 0.23, 0x3a3936, { jitter: 0.04 });
      for (const dx of [-w * 0.105, w * 0.105]) addPlain(0.07, 0.48, 0.07, bx + dx, by + 0.24, bz + 0.23, 0x494743, { jitter: 0.05 });
    }
    if (w > 6 && h > 4) {
      const units = Math.min(3, Math.floor(w / 5));
      for (let i = 0; i < units; i++) {
        if (r() < 0.48) continue;
        const ux = cx + (i - (units - 1) / 2) * Math.min(2.8, w * 0.25);
        const uy = rand(2.2, Math.min(h - 1, 6.5), r);
        const face = new THREE.BoxGeometry(0.82, 0.46, 0.28);
        addPlain(0, 0, 0, ux, uy, cz + d / 2 + 0.17, 0x77736a, { geo: face, jitter: 0.06 });
        addPlain(0.58, 0.05, 0.035, ux, uy - 0.13, cz + d / 2 + 0.325, 0x3c4142, { jitter: 0.03 });
        for (let fin = -2; fin <= 2; fin++) addPlain(0.025, 0.24, 0.025, ux + fin * 0.105, uy, cz + d / 2 + 0.325, 0x393b3a, { jitter: 0.03 });
      }
    }
    if (w > 7 && d > 6 && r() < 0.62) {
      const tx = cx + rand(-w * 0.3, w * 0.3, r), tz = cz + rand(-d * 0.28, d * 0.28, r);
      const tank = new THREE.CylinderGeometry(0.48, 0.52, 1.4, 12, 1);
      addPlain(0, 0, 0, tx, h + 1.0, tz, 0x565a58, { geo: tank, jitter: 0.08 });
      addPlain(1.08, 0.09, 1.08, tx, h + 1.72, tz, 0x353a39, { jitter: 0.04 });
      addPlain(0, 0, 0, tx + 0.64, h + 0.55, tz, 0x454745, { geo: new THREE.CylinderGeometry(0.045, 0.045, 0.9, 7), jitter: 0.04 });
    }
    if (w > 6 && r() < 0.7) addPlain(2, 1.2, 1.6, cx + rand(-w / 4, w / 4, r), h + 0.6, cz + rand(-d / 4, d / 4, r), 0x707070);
    if (h > 8 && r() < 0.48) {
      const tx = cx + rand(-w * 0.28, w * 0.28, r), tz = cz + rand(-d * 0.28, d * 0.28, r);
      addPlain(0, 0, 0, tx, h + 1.15, tz, 0x696a65, { geo: new THREE.CylinderGeometry(0.62, 0.68, 1.1, 14) });
      for (const [ox, oz] of [[-0.42, -0.42], [0.42, -0.42], [-0.42, 0.42], [0.42, 0.42]]) addPlain(0, 0, 0, tx + ox, h + 0.55, tz + oz, 0x4c4c48, { geo: new THREE.CylinderGeometry(0.035, 0.035, 0.65, 6) });
      addPlain(0, 0, 0, tx, h + 1.72, tz, 0x85847b, { geo: new THREE.CylinderGeometry(0.68, 0.68, 0.08, 14) });
    }
    if (h > 10 && r() < 0.3) {
      const px = cx + w / 2 + 0.04, pz = cz + rand(-d * 0.3, d * 0.3, r);
      addPlain(0, 0, 0, px, h * 0.45, pz, 0x454641, { geo: new THREE.CylinderGeometry(0.045, 0.045, h * 0.82, 7) });
    }
    if (collide) addCollider(cx - w / 2, cz - d / 2, cx + w / 2, cz + d / 2, h);
  }
  function addContainer(type, x, z, rot = 0) { containerSpecs.push({ type, x, z, rot }); }
  function wallRun(x1, z1, x2, z2, h, thick, color, gaps = [], jag = true) {
    // parede reta (horizontal ou vertical) com aberturas [t0,t1] ao longo do comprimento
    const horiz = Math.abs(z2 - z1) < 0.01;
    const len = horiz ? x2 - x1 : z2 - z1;
    const segs = [];
    let t = 0;
    const sorted = [...gaps].sort((a, b) => a[0] - b[0]);
    for (const [g0, g1] of sorted) { if (g0 > t) segs.push([t, g0]); t = Math.max(t, g1); }
    if (t < len) segs.push([t, len]);
    for (const [s0, s1] of segs) {
      const L = s1 - s0;
      if (L < 0.2) continue;
      // visual em pedaços com alturas irregulares
      const pieces = jag ? Math.max(1, Math.round(L / 2)) : 1;
      for (let i = 0; i < pieces; i++) {
        const a = s0 + (L * i) / pieces, b = s0 + (L * (i + 1)) / pieces;
        const ph = jag ? h * rand(0.55, 1, r) : h;
        const m = (a + b) / 2;
        if (horiz) addPlain(b - a, ph, thick, x1 + m, ph / 2, z1, color, { jitter: 0.1 });
        else addPlain(thick, ph, b - a, x1, ph / 2, z1 + m, color, { jitter: 0.1 });
      }
      if (horiz) addCollider(x1 + s0, z1 - thick / 2, x1 + s1, z1 + thick / 2, h);
      else addCollider(x1 - thick / 2, z1 + s0, x1 + thick / 2, z1 + s1, h);
    }
  }
  function rubble(cx, cz, n, spread, color = 0x5a5650) {
    for (let i = 0; i < n; i++) {
      const s = rand(0.3, 1.1, r);
      // pedras irregulares (esfera de baixa resolução deformada) misturadas com blocos de concreto
      if (r() < 0.6) {
        const g = new THREE.SphereGeometry(0.5, 7, 5);
        const pa = g.attributes.position;
        for (let k = 0; k < pa.count; k++) { const f = 0.75 + r() * 0.5; pa.setXYZ(k, pa.getX(k) * f, pa.getY(k) * f, pa.getZ(k) * f); }
        g.computeVertexNormals();
        g.scale(s, s * rand(0.4, 0.8, r), s * rand(0.8, 1.3, r));
        addPlain(0, 0, 0, cx + rand(-spread, spread, r), s * 0.15, cz + rand(-spread, spread, r), color, { geo: g, rotY: rand(0, 3, r), jitter: 0.3 });
      } else {
        addPlain(s, s * rand(0.3, 0.6, r), s * 0.6, cx + rand(-spread, spread, r), s * 0.15, cz + rand(-spread, spread, r), color, { rotY: rand(0, 3, r), rotZ: rand(-0.3, 0.3, r), jitter: 0.3 });
      }
    }
  }
  function car(x, z, rotY, lootable) {
    if (lootable) { addContainer('carro', x, z, rotY); return; }
    // carcaça queimada (só cenário + colisão)
    const burnt = 0x2a2522;
    const g1 = new THREE.CapsuleGeometry(0.4, 3.3, 4, 10); g1.rotateX(Math.PI / 2); g1.scale(2.4, 1, 1); colorize(g1, burnt, 0.3, r); g1.rotateY(rotY); g1.translate(x, 0.55, z); plainGeos.push(g1);
    const g2 = new THREE.CapsuleGeometry(0.33, 1.4, 4, 10); g2.rotateX(Math.PI / 2); g2.scale(2.5, 1, 1); colorize(g2, 0x1a1816, 0.2, r); g2.rotateY(rotY); g2.translate(x, 1.0, z - 0.1); plainGeos.push(g2);
    const along = Math.abs(Math.sin(rotY)) > 0.7;
    const hw = along ? 2.1 : 1, hd = along ? 1 : 2.1;
    addCollider(x - hw, z - hd, x + hw, z + hd, 1.4);
  }
  function tree(x, z) {
    const h = rand(2.5, 4.2, r);
    addPlain(0, 0, 0, x, h / 2, z, 0x3a2e22, { geo: new THREE.CylinderGeometry(0.12, 0.25, h, 6) });
    for (let i = 0; i < 3; i++) {
      const bl = rand(1, 1.8, r);
      addPlain(0, 0, 0, x, h * rand(0.6, 0.95, r), z, 0x3a2e22, { geo: new THREE.CylinderGeometry(0.04, 0.09, bl, 5), rotZ: rand(-1, 1, r), rotY: rand(0, 6, r) });
    }
    addCollider(x - 0.35, z - 0.35, x + 0.35, z + 0.35, h);
  }
  function fireBarrel(x, z) {
    addPlain(0, 0, 0, x, 0.5, z, 0x5a3a22, { geo: new THREE.CylinderGeometry(0.4, 0.4, 1, 10) });
    addCollider(x - 0.45, z - 0.45, x + 0.45, z + 0.45, 1);
    fireSpots.push({ x, z, y: 1.1 });
  }
  function sandbags(x1, z1, x2, z2) {
    const horiz = Math.abs(z2 - z1) < 0.01;
    const len = horiz ? x2 - x1 : z2 - z1;
    if (horiz) addPlain(len, 1, 0.8, x1 + len / 2, 0.5, z1, 0x8a7a5a, { collide: true, jitter: 0.1 });
    else addPlain(0.8, 1, len, x1, 0.5, z1 + len / 2, 0x8a7a5a, { collide: true, jitter: 0.1 });
  }
  function tent(x, z, w, d, color) {
    const g = new THREE.ConeGeometry(0.7071, 1, 4);
    g.rotateY(Math.PI / 4);
    g.scale(w, 2.4, d);
    colorize(g, color, 0.1, r);
    g.translate(x, 1.2, z);
    plainGeos.push(g);
    addCollider(x - w / 2, z - d / 2, x + w / 2, z + d / 2, 2.4);
  }

  // ----- tipos de quarteirão -----
  const B = BLOCK;
  const builders = {
    buildings(x0, z0) {
      const split = r() < 0.5 ? [2, 2] : r() < 0.5 ? [1, 2] : [2, 1];
      const lw = B / split[0], ld = B / split[1];
      for (let i = 0; i < split[0]; i++) for (let j = 0; j < split[1]; j++) {
        const cx = x0 + lw * (i + 0.5), cz = z0 + ld * (j + 0.5);
        const m = 1.6, w = lw - m * 2, d = ld - m * 2;
        if (r() < 0.14) {
          // prédio desabado — escombros e saque
          addPlain(w * 0.9, rand(1.5, 3, r), d * 0.9, cx, 0.8, cz, pick(col.building, r), { collide: true });
          rubble(cx, cz, 10, Math.min(w, d) / 2 + 1);
          addContainer(pick(['caixa', 'armario', 'caixa'], r), cx + w / 2 + 0.2, cz - d / 2 + 1);
          continue;
        }
        const h = theme === 'city' ? rand(7, 24, r) : rand(5, 10, r);
        addBuilding(cx, cz, w, d, h, pick(col.building, r));
        // fachada de loja no térreo voltada para a rua
        if (r() < 0.75) {
          const sgn = cz < z0 + B / 2 ? -1 : 1, fz = cz + sgn * (d / 2 + 0.04);
          const sw = w * 0.82, awc = pick([0x8a1e1e, 0x1e4a8a, 0x2a6a3a, 0xa86a1a, 0x5a2a6a], r);
          addPlain(sw, 2.3, 0.08, cx, 1.15, fz, 0x0e1216, { jitter: 0 }); // vitrine escura
          for (let q = -2; q <= 2; q++) addPlain(0.1, 2.3, 0.12, cx + (q * sw) / 4.6, 1.15, fz + sgn * 0.02, 0x3a3a3a, { jitter: 0 }); // caixilhos
          addPlain(sw, 0.08, 1.1, cx, 2.75, fz + sgn * 0.5, awc, { rotX: sgn * 0.28, jitter: 0.1 }); // toldo
          addPlain(sw * 0.6, 0.55, 0.06, cx, 3.35, fz + sgn * 0.03, pick([0xd8c8a0, 0x2a2a2a, 0xa82a2a], r), { glow: r() < 0.15, jitter: 0.05 }); // letreiro
        }
        if (r() < 0.55) addContainer('lixeira', cx + rand(-w / 3, w / 3, r), cz + d / 2 + 0.75);
        if (r() < 0.35) addContainer('caixa', cx - w / 2 - 0.65, cz + rand(-d / 3, d / 3, r));
      }
    },
    ruin(x0, z0) {
      const cx = x0 + B / 2, cz = z0 + B / 2, s = 19, hs = s / 2;
      const h = rand(2.2, 3.1, r), t = 0.5;
      const wallCol = pick(col.building, r);
      addPlain(s, 0.06, s, cx, 0.03, cz, 0x4a4640, { jitter: 0.1 });
      const gp = () => { const a = rand(2, s - 6, r); return [a, a + 3.6]; };
      const doors = [r() < 0.8 ? [gp()] : [], r() < 0.8 ? [gp()] : [], [gp()], [gp()]];
      wallRun(cx - hs, cz - hs, cx + hs, cz - hs, h, t, wallCol, doors[0]);
      wallRun(cx - hs, cz + hs, cx + hs, cz + hs, h, t, wallCol, doors[1]);
      wallRun(cx - hs, cz - hs, cx - hs, cz + hs, h, t, wallCol, doors[2]);
      wallRun(cx + hs, cz - hs, cx + hs, cz + hs, h, t, wallCol, doors[3]);
      // parede interna
      if (r() < 0.8) {
        const L = rand(6, 10, r);
        if (r() < 0.5) { const iz = cz + rand(-3, 3, r); wallRun(cx - hs + 0.25, iz, cx - hs + 0.25 + L, iz, h * 0.9, t, wallCol, [], true); }
        else { const ix = cx + rand(-3, 3, r); wallRun(ix, cz - hs + 0.25, ix, cz - hs + 0.25 + L, h * 0.9, t, wallCol, [], true); }
      }
      rubble(cx, cz, 8, hs - 2);
      const n = randi(3, 5, r);
      const types = theme === 'military' ? { caixa: 2, armario: 2, militar: 2, cofre: 0.6 } : { caixa: 3, armario: 2, cofre: 0.7, militar: 0.4 };
      for (let i = 0; i < n; i++) {
        const ang = (i / n) * Math.PI * 2 + rand(0, 0.5, r);
        addContainer(weighted(types, r), cx + Math.cos(ang) * (hs - 1.6), cz + Math.sin(ang) * (hs - 1.6));
      }
      if (r() < 0.5) fireBarrel(cx + rand(-3, 3, r), cz + rand(-3, 3, r));
    },
    lot(x0, z0) {
      for (let row = 0; row < 2; row++) {
        const z = z0 + 6 + row * 13;
        for (let k = 0; k < 6; k++) {
          if (r() < 0.35) continue;
          const x = x0 + 2.5 + k * 3.6;
          car(x, z, rand(-0.12, 0.12, r), r() < 0.6);
        }
      }
      for (let k = 0; k < 2; k++) lampSpots.push({ x: x0 + 4 + k * 18, z: z0 + B / 2 });
      if (r() < 0.6) addContainer('lixeira', x0 + B - 2, z0 + B / 2);
    },
    park(x0, z0) {
      const cx = x0 + B / 2, cz = z0 + B / 2;
      addPlain(0, 0, 0, cx, 0.4, cz, 0x7a7670, { geo: new THREE.CylinderGeometry(2.2, 2.4, 0.8, 16) });
      addCollider(cx - 2.2, cz - 2.2, cx + 2.2, cz + 2.2, 0.8);
      const n = randi(5, 9, r);
      for (let i = 0; i < n; i++) {
        const x = x0 + rand(2, B - 2, r), z = z0 + rand(2, B - 2, r);
        if (Math.hypot(x - cx, z - cz) < 4.5) continue;
        tree(x, z);
      }
      for (let i = 0; i < 3; i++) addPlain(2, 0.5, 0.6, x0 + rand(3, B - 3, r), 0.25, z0 + rand(3, B - 3, r), 0x5a4030, { collide: true });
      addContainer('caixa', x0 + rand(3, B - 3, r), z0 + rand(3, B - 3, r));
    },
    gas(x0, z0) {
      const cx = x0 + B / 2, cz = z0 + B / 2 - 3;
      addPlain(13, 0.4, 8, cx, 4.6, cz, 0xb8b0a0);
      addPlain(13.2, 0.5, 8.2, cx, 4.2, cz, 0xa02020, { jitter: 0.05 });
      for (const [dx, dz] of [[-5.5, -3], [5.5, -3], [-5.5, 3], [5.5, 3]]) addPlain(0.5, 4.2, 0.5, cx + dx, 2.1, cz + dz, 0xaaaaaa, { collide: true });
      for (let i = -1; i <= 1; i++) addPlain(0.8, 1.5, 0.5, cx + i * 3.5, 0.75, cz, 0x8a2020, { collide: true });
      addBuilding(cx, z0 + B - 4, 10, 5, 3.6, pick(col.building, r));
      addContainer('armario', cx - 3, z0 + B - 7.2);
      addContainer('caixa', cx + 3.5, z0 + B - 7.2);
      if (r() < 0.5) car(cx + 4, cz + 0.5, Math.PI / 2, true);
    },
    houses(x0, z0) {
      for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) {
        const lx = x0 + i * 13, lz = z0 + j * 13;
        const cx = lx + 6.5, cz = lz + 5.8;
        const w = rand(6.2, 7.5, r), d = rand(5.5, 6.5, r), h = 3.2;
        const burnt = r() < 0.3;
        const wall = burnt ? 0x2e2a26 : pick(col.building, r);
        addPlain(w, h, d, cx, h / 2, cz, wall, { collide: true });
        // janelas e porta
        const front = j === 0 ? -1 : 1;
        addPlain(1.1, 2, 0.08, cx, 1, cz + front * (d / 2 + 0.02), 0x3a2414, { jitter: 0 });
        addPlain(1.2, 0.9, 0.08, cx - w / 4 - 0.4, 1.8, cz + front * (d / 2 + 0.02), 0x101418, { jitter: 0 });
        addPlain(1.2, 0.9, 0.08, cx + w / 4 + 0.4, 1.8, cz + front * (d / 2 + 0.02), 0x101418, { jitter: 0 });
        if (!burnt) {
          const m = Math.max(w, d);
          const g = new THREE.ConeGeometry(0.7071 * m * 1.08, 2, 4);
          g.rotateY(Math.PI / 4); g.scale(w / m, 1, d / m);
          colorize(g, pick([0x7a2e22, 0x5a3a2a, 0x3a3a3e, 0x6a4a2a], r), 0.1, r);
          g.translate(cx, h + 1, cz);
          plainGeos.push(g);
        } else rubble(cx, cz + front * (d / 2 + 1), 5, 2, 0x222020);
        // cerca baixa
        const fz = front < 0 ? lz + 0.4 : lz + 12.6;
        wallRun(lx + 0.4, fz, lx + 12.6, fz, 0.9, 0.12, 0xd8d0c0, [[5, 8]], false);
        addContainer(r() < 0.5 ? 'carro' : 'lixeira', lx + (r() < 0.5 ? 2 : 11), cz + front * (d / 2 + 2.6), r() < 0.5 ? 0 : Math.PI / 2);
        if (r() < 0.6) addContainer(burnt ? 'cofre' : 'caixa', cx + rand(-w / 2, w / 2, r), cz - front * (d / 2 + 1.2));
        if (burnt && r() < 0.5) fireSpots.push({ x: cx, z: cz, y: h + 0.5 });
      }
    },
    containers(x0, z0) {
      const colors = [0xa83222, 0x2a5aa8, 0xd8822a, 0x3a7a3a, 0xc8c8c0, 0x6a2a6a];
      for (let row = 0; row < 2; row++) for (let k = 0; k < 3; k++) {
        if (r() < 0.15) continue;
        const cx = x0 + 4.5 + k * 8.5, cz = z0 + 5.5 + row * 14;
        const stack = randi(1, 3, r);
        for (let s = 0; s < stack; s++) addPlain(6, 2.6, 2.5, cx, 1.3 + s * 2.6, cz + (s % 2) * 0.1, pick(colors, r), { jitter: 0.12 });
        addCollider(cx - 3, cz - 1.3, cx + 3, cz + 1.3, stack * 2.6);
        if (r() < 0.4) addPlain(6, 2.6, 2.5, cx, 1.3, cz + 3.2, pick(colors, r), { collide: true });
      }
      const n = randi(2, 4, r);
      for (let i = 0; i < n; i++) addContainer(weighted({ caixa: 3, militar: 1.2, armario: 1 }, r), x0 + rand(2, B - 2, r), z0 + B / 2 + rand(-1.5, 1.5, r));
    },
    warehouse(x0, z0) {
      const cx = x0 + B / 2, cz = z0 + B / 2 - 2;
      addBuilding(cx, cz, 22, 13, rand(6, 9, r), pick(col.building, r));
      addPlain(6, 4.5, 0.1, cx, 2.25, cz + 6.56, 0x1a1a1a, { jitter: 0 });
      for (let i = 0; i < 4; i++) addContainer(r() < 0.7 ? 'caixa' : 'militar', x0 + 3 + i * 6.5, z0 + B - 2.2);
    },
    bunker(x0, z0) {
      const cx = x0 + B / 2, cz = z0 + B / 2;
      addPlain(10, 3, 8, cx, 1.5, cz, 0x7a7a70, { collide: true });
      addPlain(8, 0.3, 0.1, cx, 2.2, cz + 4.02, 0x101010, { jitter: 0 });
      sandbags(x0 + 2, z0 + 3, x0 + 10, z0 + 3);
      sandbags(x0 + B - 2, z0 + 14, x0 + B - 2, z0 + B - 2);
      sandbags(x0 + 3, z0 + B - 3, x0 + 11, z0 + B - 3);
      for (let i = 0; i < 3; i++) addContainer(r() < 0.75 ? 'militar' : 'armario', cx - 4 + i * 4, cz + 5.6);
      // torre de vigia
      const tx = x0 + 3.5, tz = z0 + B - 6;
      for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) addPlain(0.25, 5, 0.25, tx + dx, 2.5, tz + dz, 0x4a3a2a, { collide: true });
      addPlain(3, 0.25, 3, tx, 5, tz, 0x5a4a3a);
      addPlain(3.2, 0.2, 3.2, tx, 6.8, tz, 0x3a4a2a);
    },
    tents(x0, z0) {
      const n = randi(3, 4, r);
      for (let i = 0; i < n; i++) {
        const x = x0 + 5 + (i % 2) * 14 + rand(-1, 1, r), z = z0 + 6 + Math.floor(i / 2) * 13 + rand(-1, 1, r);
        tent(x, z, 4.5, 3.5, pick([0x4b5a2a, 0x5a5a3a, 0x3a4a2a], r));
        addContainer(r() < 0.6 ? 'militar' : 'caixa', x + 3, z);
      }
      if (r() < 0.6) car(x0 + B / 2, z0 + B / 2, Math.PI / 2, true);
      fireBarrel(x0 + B / 2 + 3, z0 + B / 2 - 3);
    },
  };

  const weightsByTheme = {
    city: { buildings: 5, ruin: 3, lot: 1.4, park: 1, gas: 0.6 },
    suburb: { houses: 6, ruin: 1.6, park: 2, lot: 0.8, gas: 0.8 },
    port: { containers: 5, warehouse: 3, ruin: 1.5, lot: 1.2 },
    military: { bunker: 3, tents: 3, containers: 2, ruin: 1.6, lot: 0.8 },
  };
  const openTypes = { city: ['ruin', 'lot', 'park'], suburb: ['park', 'ruin', 'lot'], port: ['lot', 'ruin'], military: ['tents', 'ruin', 'lot'] }[theme];

  // ----- distribuição dos quarteirões -----
  const blockOrigin = (i, j) => ({ x0: -half + ROAD + i * P, z0: -half + ROAD + j * P });
  const types = [];
  for (let i = 0; i < N; i++) { types[i] = []; for (let j = 0; j < N; j++) types[i][j] = null; }
  types[0][0] = 'safehouse';
  types[N - 1][N - 1] = 'mother';
  // ninhos espalhados (farthest point sampling)
  const nestBlocks = [];
  const taken = [[0, 0], [N - 1, N - 1]];
  for (let k = 0; k < mapDef.nests; k++) {
    let best = null, bestD = -1;
    for (let tries = 0; tries < 60; tries++) {
      const i = randi(0, N - 1, r), j = randi(0, N - 1, r);
      if (types[i][j] || (i <= 1 && j <= 1)) continue;
      let dmin = Infinity;
      for (const [a, b] of taken) dmin = Math.min(dmin, Math.hypot(a - i, b - j));
      dmin += r() * 0.5;
      if (dmin > bestD) { bestD = dmin; best = [i, j]; }
    }
    if (!best) continue;
    types[best[0]][best[1]] = 'nest';
    taken.push(best);
    nestBlocks.push(best);
  }
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) if (!types[i][j]) types[i][j] = weighted(weightsByTheme[theme], r);

  // ----- zona segura (acampamento) -----
  const sb = blockOrigin(0, 0);
  const safe = { x: sb.x0 + B / 2, z: sb.z0 + B / 2, r: 11 };
  {
    const { x: cx, z: cz } = safe, hs = 10.5;
    const wc = 0x6a6660;
    wallRun(cx - hs, cz - hs, cx + hs, cz - hs, 1.8, 0.6, wc, [], false);
    wallRun(cx - hs, cz - hs, cx - hs, cz + hs, 1.8, 0.6, wc, [], false);
    wallRun(cx - hs, cz + hs, cx + hs, cz + hs, 1.8, 0.6, wc, [[8, 13]], false);
    wallRun(cx + hs, cz - hs, cx + hs, cz + hs, 1.8, 0.6, wc, [[8, 13]], false);
    // fogueira
    // fogueira: montada junto com as chamas (sem colisão, como antes — o jogador nasce aqui)
    tent(cx - 5.5, cz - 5, 4, 3.4, 0x5a6a3a);
    tent(cx + 5.5, cz - 5, 4, 3.4, 0x6a5a3a);
    sandbags(cx - 7, cz + 6.5, cx - 2.5, cz + 6.5);
    // caminhão de extração
    addPlain(3, 2.2, 6.5, cx - 6.5, 1.4, cz + 3, 0x3e4a2e, { collide: true });
    addPlain(2.8, 1.4, 2, cx - 6.5, 1.2, cz + 7.2, 0x2e3a22, { collide: true });
  }
  const extraction = { x: safe.x - 4.3, z: safe.z + 3, label: 'Extrair (voltar ao acampamento)', time: 2 };
  fireSpots.push({ x: safe.x, z: safe.z, y: 0.6, camp: true });

  // ----- colmeia mãe -----
  const mb = blockOrigin(N - 1, N - 1);
  const motherPos = { x: mb.x0 + B / 2, z: mb.z0 + B / 2 };
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2 + 0.3, rr = 10.5;
    const x = motherPos.x + Math.cos(a) * rr, z = motherPos.z + Math.sin(a) * rr;
    const h = rand(2.5, 4.5, r);
    addPlain(0, 0, 0, x, h / 2, z, 0x4a1a2a, { geo: new THREE.CylinderGeometry(0.3, 0.8, h, 6) });
    addCollider(x - 0.6, z - 0.6, x + 0.6, z + 0.6, h);
  }

  // ----- constrói quarteirões -----
  const nests = [];
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
    const t = types[i][j];
    const { x0, z0 } = blockOrigin(i, j);
    if (t === 'safehouse' || t === 'mother') continue;
    if (t === 'nest') {
      const ot = pick(openTypes, r);
      // constrói variação aberta mas deixa o centro livre
      if (ot === 'park') builders.park(x0, z0);
      else if (ot === 'lot') builders.lot(x0, z0);
      else if (ot === 'tents') builders.tents(x0, z0);
      else rubble(x0 + B / 2, z0 + B / 2, 14, 10);
      nests.push({ x: x0 + B / 2, z: z0 + B / 2 });
      continue;
    }
    builders[t](x0, z0);
  }

  // ----- ruas: carros, barricadas, postes -----
  for (let k = 0; k <= N; k++) {
    const rx = -half + k * P;
    for (let j = 0; j < N; j++) {
      const z0 = -half + ROAD + j * P;
      // rua vertical (ao longo de z)
      if (r() < 0.55) car(rx + (r() < 0.5 ? 2 : 6), z0 + rand(4, B - 4, r), rand(-0.25, 0.25, r), r() < 0.45);
      if (r() < 0.18) { const z = z0 + rand(6, B - 6, r); addPlain(3.5, 1, 0.6, rx + 2.5, 0.5, z, 0x9a968e, { collide: true }); }
      lampSpots.push({ x: rx + 0.6, z: z0 + B / 2 });
      // rua horizontal (ao longo de x)
      const x0 = -half + ROAD + j * P;
      if (r() < 0.55) car(x0 + rand(4, B - 4, r), rx + (r() < 0.5 ? 2 : 6), Math.PI / 2 + rand(-0.25, 0.25, r), r() < 0.45);
      if (r() < 0.18) { const x = x0 + rand(6, B - 6, r); addPlain(0.6, 1, 3.5, x, 0.5, rx + 5.5, 0x9a968e, { collide: true }); }
      if (r() < 0.3) rubble(x0 + rand(3, B - 3, r), rx + rand(1, 7, r), 4, 1.2);
    }
  }
  for (const l of lampSpots) {
    if (Math.hypot(l.x - safe.x, l.z - safe.z) < 12) continue;
    addPlain(0, 0, 0, l.x, 2.5, l.z, 0x3a3a3a, { geo: new THREE.CylinderGeometry(0.08, 0.12, 5, 6) });
    addPlain(1.2, 0.12, 0.2, l.x + 0.5, 4.95, l.z, 0x3a3a3a);
    const lit = r() < 0.35;
    addPlain(0.5, 0.12, 0.3, l.x + 1.0, 4.85, l.z, lit ? 0xffd890 : 0x2a2a2a, { glow: lit });
  }

  // ----- detalhes de rua: meio-fio, hidrantes, semáforos, postes de luz, fios, lixo, poças -----
  const free = (x, z, rr) => {
    if (Math.hypot(x - safe.x, z - safe.z) < safe.r + 2) return false;
    for (const c of colliders) if (x + rr > c.minX && x - rr < c.maxX && z + rr > c.minZ && z - rr < c.maxZ) return false;
    return true;
  };
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
    const { x0, z0 } = blockOrigin(i, j);
    // meio-fio elevado
    const cc = 0x8e8a82, ch = 0.14, ct = 0.22;
    addPlain(B, ch, ct, x0 + B / 2, ch / 2, z0 + ct / 2, cc, { jitter: 0.05 });
    addPlain(B, ch, ct, x0 + B / 2, ch / 2, z0 + B - ct / 2, cc, { jitter: 0.05 });
    addPlain(ct, ch, B, x0 + ct / 2, ch / 2, z0 + B / 2, cc, { jitter: 0.05 });
    addPlain(ct, ch, B, x0 + B - ct / 2, ch / 2, z0 + B / 2, cc, { jitter: 0.05 });
    const t = types[i][j];
    if (t === 'safehouse' || t === 'mother') continue;
    // pontos ao longo da calçada (0.8 do meio-fio)
    const spots = [];
    for (let u = 3; u < B - 3; u += rand(3.5, 6, r)) {
      spots.push({ x: x0 + u, z: z0 + 0.8, ry: 0 }, { x: x0 + u, z: z0 + B - 0.8, ry: Math.PI });
      spots.push({ x: x0 + 0.8, z: z0 + u, ry: Math.PI / 2 }, { x: x0 + B - 0.8, z: z0 + u, ry: -Math.PI / 2 });
    }
    for (const sp of spots) {
      const roll = r();
      if (!free(sp.x, sp.z, 0.5)) continue;
      if (roll < 0.06) { // hidrante
        const hc = r() < 0.7 ? 0xa82020 : 0xc8a020;
        addPlain(0, 0, 0, sp.x, 0.3, sp.z, hc, { geo: new THREE.CylinderGeometry(0.13, 0.16, 0.6, 10) });
        addPlain(0, 0, 0, sp.x, 0.62, sp.z, hc, { geo: new THREE.SphereGeometry(0.14, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2) });
        addPlain(0, 0, 0, sp.x, 0.38, sp.z, darkerHex(hc), { geo: new THREE.CylinderGeometry(0.05, 0.05, 0.42, 8), rotZ: Math.PI / 2 });
        addCollider(sp.x - 0.2, sp.z - 0.2, sp.x + 0.2, sp.z + 0.2, 0.7);
      } else if (roll < 0.14) { // sacos de lixo
        for (let k = 0; k < randi(2, 4, r); k++) {
          const bg = new THREE.SphereGeometry(0.3, 9, 7), pa = bg.attributes.position;
          for (let q = 0; q < pa.count; q++) { const f = 0.85 + r() * 0.3; pa.setXYZ(q, pa.getX(q) * f, pa.getY(q) * f * 0.8, pa.getZ(q) * f); }
          bg.computeVertexNormals();
          addPlain(0, 0, 0, sp.x + rand(-0.5, 0.5, r), 0.22, sp.z + rand(-0.3, 0.3, r), r() < 0.6 ? 0x161616 : 0x1e2a1a, { geo: bg, jitter: 0.2 });
        }
      } else if (roll < 0.19 && theme !== 'military') { // banco
        const g1 = new THREE.BoxGeometry(1.6, 0.08, 0.45);
        addPlain(0, 0, 0, sp.x, 0.45, sp.z, 0x5a4030, { geo: g1, rotY: sp.ry });
        addPlain(0, 0, 0, sp.x - Math.sin(sp.ry) * 0.2, 0.75, sp.z - Math.cos(sp.ry) * 0.2, 0x5a4030, { geo: new THREE.BoxGeometry(1.6, 0.4, 0.06), rotY: sp.ry });
        addPlain(0, 0, 0, sp.x, 0.22, sp.z, 0x2a2a2a, { geo: new THREE.BoxGeometry(1.4, 0.44, 0.35), rotY: sp.ry });
        addCollider(sp.x - 0.8, sp.z - 0.8, sp.x + 0.8, sp.z + 0.8, 0.9);
      } else if (roll < 0.23) { // caixa de jornal / correio
        addPlain(0, 0, 0, sp.x, 0.55, sp.z, pick([0x2a4a8a, 0x8a2a2a, 0x3a6a3a], r), { geo: new THREE.BoxGeometry(0.5, 1.1, 0.45), rotY: sp.ry });
        addCollider(sp.x - 0.3, sp.z - 0.3, sp.x + 0.3, sp.z + 0.3, 1.1);
      } else if (roll < 0.27) { // placa de rua
        addPlain(0, 0, 0, sp.x, 1.3, sp.z, 0x6a6a6a, { geo: new THREE.CylinderGeometry(0.04, 0.04, 2.6, 6) });
        addPlain(0, 0, 0, sp.x, 2.45, sp.z, 0x1f5f3a, { geo: new THREE.BoxGeometry(0.9, 0.25, 0.03), rotY: sp.ry + Math.PI / 2 });
      }
    }
    // semáforo na esquina (às vezes) com braço sobre a rua
    for (const [cx, cz, ax, az] of [[x0 + 0.6, z0 + 0.6, -1, 0], [x0 + B - 0.6, z0 + B - 0.6, 1, 0]]) {
      if (r() > 0.35 || !free(cx, cz, 0.4)) continue;
      addPlain(0, 0, 0, cx, 2.2, cz, 0x2a2c2e, { geo: new THREE.CylinderGeometry(0.08, 0.1, 4.4, 8) });
      addPlain(0, 0, 0, cx + ax * 1.6, 4.3, cz, 0x2a2c2e, { geo: new THREE.CylinderGeometry(0.05, 0.05, 3.2, 6), rotZ: Math.PI / 2 });
      const hx = cx + ax * 2.9;
      addPlain(0.32, 0.95, 0.3, hx, 3.85, cz, 0x1a1a1a);
      const lit = (r() * 3) | 0;
      [0xff2a1a, 0xffb020, 0x30e060].forEach((lc, q) => addPlain(0.16, 0.16, 0.06, hx, 4.15 - q * 0.29, cz + 0.17, q === lit ? lc : 0x202020, { glow: q === lit, jitter: 0 }));
      addCollider(cx - 0.15, cz - 0.15, cx + 0.15, cz + 0.15, 4.4);
    }
  }
  // postes de energia com fios (subúrbio, cidade e porto)
  if (theme !== 'military') {
    for (let k = 1; k < N; k++) {
      const rz = -half + k * P - 0.5; // lado norte da rua horizontal
      let prev = null;
      for (let x = -half + 6; x < half - 4; x += 17) {
        if (!free(x, rz, 0.3) || (k === 1 && x < -half + P)) { prev = null; continue; }
        const h = 6.5;
        addPlain(0, 0, 0, x, h / 2, rz, 0x4a3828, { geo: new THREE.CylinderGeometry(0.11, 0.15, h, 7) });
        addPlain(1.6, 0.1, 0.1, x, h - 0.4, rz, 0x4a3828);
        addPlain(0, 0, 0, x + 0.4, h - 0.9, rz, 0x6a6a5a, { geo: new THREE.CylinderGeometry(0.14, 0.14, 0.5, 8) }); // transformador
        addCollider(x - 0.18, rz - 0.18, x + 0.18, rz + 0.18, h);
        if (prev) {
          for (const off of [-0.7, 0.7]) {
            const pts = [];
            for (let q = 0; q <= 8; q++) { const t2 = q / 8; pts.push(new THREE.Vector3(prev + (x - prev) * t2 + off, h - 0.35 - Math.sin(t2 * Math.PI) * 0.9, rz)); }
            const wg = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 10, 0.02, 4);
            addPlain(0, 0, 0, 0, 0, 0, 0x111111, { geo: wg, jitter: 0 });
          }
        }
        prev = x;
      }
    }
  }
  // cones de trânsito e pneus velhos nas ruas
  for (let i = 0; i < N * 6; i++) {
    const k = randi(0, N, r), vert = r() < 0.5;
    const a = -half + k * P + rand(1, ROAD - 1, r), t2 = rand(-half + 4, half - 4, r);
    const x = vert ? a : t2, z = vert ? t2 : a;
    if (!free(x, z, 0.4)) continue;
    if (r() < 0.6) {
      addPlain(0, 0, 0, x, 0.32, z, 0xe8601a, { geo: new THREE.ConeGeometry(0.2, 0.64, 10), rotZ: r() < 0.25 ? Math.PI / 2 : 0 });
      addPlain(0.5, 0.05, 0.5, x, 0.025, z, 0x1a1a1a);
    } else {
      for (let q = 0; q < randi(1, 3, r); q++) addPlain(0, 0, 0, x, 0.12 + q * 0.2, z, 0x151515, { geo: new THREE.TorusGeometry(0.33, 0.12, 8, 14), rotX: Math.PI / 2 });
    }
  }

  // ----- borda do mapa e skyline externa -----
  const wallH = 3.2;
  addPlain(S + 2, wallH, 1, 0, wallH / 2, -half - 0.5, 0x6a6660, { collide: true });
  addPlain(S + 2, wallH, 1, 0, wallH / 2, half + 0.5, 0x6a6660, { collide: true });
  addPlain(1, wallH, S + 2, -half - 0.5, wallH / 2, 0, 0x6a6660, { collide: true });
  addPlain(1, wallH, S + 2, half + 0.5, wallH / 2, 0, 0x6a6660, { collide: true });
  for (let side = 0; side < 4; side++) {
    for (let t = -half - 20; t < half + 20; t += rand(10, 16, r)) {
      const off = half + rand(6, 14, r);
      const w = rand(8, 14, r), d = rand(8, 14, r), h = theme === 'suburb' ? rand(4, 9, r) : rand(10, 34, r);
      const x = side < 2 ? t : (side === 2 ? -off : off);
      const z = side < 2 ? (side === 0 ? -off : off) : t;
      addBuilding(x, z, w, d, h, pick(col.building, r), false);
    }
  }

  // ----- textura do chão -----
  const potholes = [];
  for (let i = 0; i < N * 7; i++) {
    const k = randi(0, N, r), vert = r() < 0.5;
    const a = -half + k * P + rand(1.2, ROAD - 1.2, r), t2 = rand(-half + 3, half - 3, r);
    potholes.push({ x: vert ? a : t2, z: vert ? t2 : a, r: rand(0.35, 0.9, r), a: rand(0, 3, r), water: r() < 0.6 });
  }
  const groundTex = drawGround();
  function drawGround() {
    const SZ = lowPower ? 2048 : 4096, ppu = SZ / S;
    const c = document.createElement('canvas'); c.width = c.height = SZ;
    const g = c.getContext('2d');
    const X = (x) => (x + half) * ppu;
    g.fillStyle = col.ground; g.fillRect(0, 0, SZ, SZ);
    // ruído do chão
    for (let i = 0; i < 70000; i++) {
      const v = Math.random() < 0.5 ? 0 : 255;
      g.fillStyle = `rgba(${v},${v},${v},${Math.random() * 0.06})`;
      g.fillRect(Math.random() * SZ, Math.random() * SZ, 4, 4);
    }
    // quarteirões especiais
    for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
      const t = types[i][j], { x0, z0 } = blockOrigin(i, j);
      if (t === 'park' || t === 'houses') {
        g.fillStyle = theme === 'suburb' ? '#3e4a2a' : '#3a3f2a';
        g.fillRect(X(x0) + 4, X(z0) + 4, B * ppu - 8, B * ppu - 8);
      } else if (t === 'lot' || t === 'gas') {
        g.fillStyle = col.road; g.fillRect(X(x0), X(z0), B * ppu, B * ppu);
        g.strokeStyle = 'rgba(220,220,200,0.35)'; g.lineWidth = 2;
        for (let k = 0; k < 8; k++) { g.beginPath(); g.moveTo(X(x0 + 0.7 + k * 3.6), X(z0 + 3)); g.lineTo(X(x0 + 0.7 + k * 3.6), X(z0 + 9)); g.stroke(); }
      } else if (t === 'safehouse') {
        g.fillStyle = '#5a4a38'; g.fillRect(X(x0) + 6, X(z0) + 6, B * ppu - 12, B * ppu - 12);
      } else if (t === 'mother' || t === 'nest') {
        const cx = X(x0 + B / 2), cz = X(z0 + B / 2), rad = (t === 'mother' ? 14 : 8) * ppu;
        const grd = g.createRadialGradient(cx, cz, 0, cx, cz, rad);
        grd.addColorStop(0, 'rgba(70,10,70,0.95)'); grd.addColorStop(0.6, 'rgba(50,10,50,0.6)'); grd.addColorStop(1, 'rgba(40,10,40,0)');
        g.fillStyle = grd; g.beginPath(); g.arc(cx, cz, rad, 0, Math.PI * 2); g.fill();
      }
    }
    const rnd = (a, b) => a + Math.random() * (b - a);
    const L = (u) => u * ppu; // unidades -> pixels
    // ----- calçadas: faixa de concreto com placas, meio-fio e sarjeta -----
    const SW = 1.8;
    for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
      const { x0, z0 } = blockOrigin(i, j);
      const t = types[i][j];
      g.fillStyle = theme === 'suburb' ? '#77736a' : '#6c6862';
      g.fillRect(X(x0), X(z0), L(B), L(SW)); g.fillRect(X(x0), X(z0 + B - SW), L(B), L(SW));
      g.fillRect(X(x0), X(z0), L(SW), L(B)); g.fillRect(X(x0 + B - SW), X(z0), L(SW), L(B));
      // placas de concreto
      g.strokeStyle = 'rgba(30,28,26,0.35)'; g.lineWidth = 1.2;
      for (let u = 0; u <= B; u += 1.2) {
        g.beginPath(); g.moveTo(X(x0 + u), X(z0)); g.lineTo(X(x0 + u), X(z0 + SW)); g.moveTo(X(x0 + u), X(z0 + B - SW)); g.lineTo(X(x0 + u), X(z0 + B)); g.stroke();
        g.beginPath(); g.moveTo(X(x0), X(z0 + u)); g.lineTo(X(x0 + SW), X(z0 + u)); g.moveTo(X(x0 + B - SW), X(z0 + u)); g.lineTo(X(x0 + B), X(z0 + u)); g.stroke();
      }
      // placas quebradas / manchadas
      for (let k = 0; k < 10; k++) {
        const side = (Math.random() * 4) | 0, u = rnd(0, B - 1.2);
        const px = side === 0 ? x0 + u : side === 1 ? x0 + u : side === 2 ? x0 : x0 + B - SW;
        const pz = side === 0 ? z0 : side === 1 ? z0 + B - SW : z0 + u;
        g.fillStyle = Math.random() < 0.5 ? 'rgba(20,18,16,0.25)' : 'rgba(120,115,105,0.25)';
        g.fillRect(X(px), X(pz), L(side < 2 ? 1.2 : SW), L(side < 2 ? SW : 1.2));
      }
      if (t === 'park' || t === 'houses') { // grama invadindo as frestas
        g.fillStyle = 'rgba(60,80,40,0.35)';
        for (let k = 0; k < 40; k++) g.fillRect(X(x0 + rnd(0, B)), X(z0 + rnd(0, SW)), L(rnd(0.1, 0.4)), L(0.08));
      }
    }
    // ----- asfalto -----
    g.fillStyle = col.road;
    for (let k = 0; k <= N; k++) {
      const a = -half + k * P;
      g.fillRect(X(a), 0, L(ROAD), SZ);
      g.fillRect(0, X(a), SZ, L(ROAD));
    }
    // agregado do asfalto (pedrinhas claras/escuras)
    for (let k = 0; k <= N; k++) {
      const a = X(-half + k * P), w = L(ROAD);
      for (let i = 0; i < 9000; i++) {
        const v = Math.random() < 0.5 ? 20 : 120;
        g.fillStyle = `rgba(${v},${v},${v},${0.08 + Math.random() * 0.12})`;
        const t2 = Math.random() * SZ, o2 = a + Math.random() * w, sz = 1 + Math.random() * 1.6;
        g.fillRect(o2, t2, sz, sz); g.fillRect(t2, o2, sz, sz);
      }
    }
    // remendos de asfalto
    for (let i = 0; i < 70; i++) {
      const k = (Math.random() * (N + 1)) | 0, vert = Math.random() < 0.5;
      const a = -half + k * P + rnd(0.5, ROAD - 3), t2 = rnd(-half, half);
      g.fillStyle = Math.random() < 0.5 ? 'rgba(15,15,17,0.35)' : 'rgba(80,80,82,0.25)';
      const w = rnd(1.2, 3), h = rnd(1.5, 5);
      if (vert) g.fillRect(X(a), X(t2), L(w), L(h)); else g.fillRect(X(t2), X(a), L(h), L(w));
    }
    // sinalização horizontal por trecho entre cruzamentos
    const paint = (alpha) => `rgba(235,235,225,${alpha})`;
    for (let k = 0; k <= N; k++) {
      const ra = -half + k * P; // borda da rua
      for (let j = 0; j < N; j++) {
        const s0 = -half + ROAD + j * P, s1 = s0 + B; // trecho
        const fade = 0.45 + Math.random() * 0.35;
        for (const vert of [true, false]) {
          const R0 = (u, v, w, h) => vert ? g.fillRect(X(ra + u), X(v), L(w), L(h)) : g.fillRect(X(v), X(ra + u), L(h), L(w));
          // faixa dupla amarela central
          g.fillStyle = `rgba(215,175,50,${fade})`;
          R0(ROAD / 2 - 0.22, s0 + 3.2, 0.12, B - 6.4); R0(ROAD / 2 + 0.1, s0 + 3.2, 0.12, B - 6.4);
          // bordas brancas
          g.fillStyle = paint(fade * 0.8);
          R0(0.45, s0 + 3.2, 0.1, B - 6.4); R0(ROAD - 0.55, s0 + 3.2, 0.1, B - 6.4);
          // faixas de pedestre (zebra) nas duas pontas + linha de retenção
          g.fillStyle = paint(fade);
          for (let z = 0; z < 7; z++) { R0(0.6 + z * 1.05, s0 + 0.35, 0.55, 2.2); R0(0.6 + z * 1.05, s1 - 2.55, 0.55, 2.2); }
          R0(ROAD / 2, s0 + 2.75, ROAD / 2 - 0.5, 0.25); R0(0.5, s1 - 3.0, ROAD / 2 - 0.5, 0.25);
          // setas de direção
          if (Math.random() < 0.5) {
            g.fillStyle = paint(fade * 0.7);
            const ax = vert ? X(ra + ROAD * 0.75) : X(s0 + B / 2), az = vert ? X(s0 + B / 2) : X(ra + ROAD * 0.25);
            g.save(); g.translate(ax, az); g.rotate(vert ? Math.PI : -Math.PI / 2);
            g.fillRect(-L(0.12), -L(1.2), L(0.24), L(1.6));
            g.beginPath(); g.moveTo(-L(0.45), L(0.35)); g.lineTo(L(0.45), L(0.35)); g.lineTo(0, L(0.95)); g.fill();
            g.restore();
          }
          // bueiros de sarjeta junto ao meio-fio
          g.fillStyle = 'rgba(10,10,10,0.8)';
          for (let d = s0 + 5; d < s1 - 4; d += rnd(8, 12)) {
            R0(0.05, d, 0.35, 1.0); R0(ROAD - 0.4, d + 3, 0.35, 1.0);
          }
        }
      }
    }
    // desgaste da pintura (salpica asfalto por cima)
    g.fillStyle = col.road;
    for (let i = 0; i < 9000; i++) g.fillRect(Math.random() * SZ, Math.random() * SZ, 2 + Math.random() * 3, 2 + Math.random() * 3);
    // tampas de bueiro
    for (let i = 0; i < 40; i++) {
      const k = (Math.random() * (N + 1)) | 0, vert = Math.random() < 0.5;
      const a = -half + k * P + rnd(1.5, ROAD - 1.5), t2 = rnd(-half + 2, half - 2);
      const cx = vert ? X(a) : X(t2), cz = vert ? X(t2) : X(a), rr = L(0.45);
      g.fillStyle = '#1e1e20'; g.beginPath(); g.arc(cx, cz, rr, 0, Math.PI * 2); g.fill();
      g.strokeStyle = '#4a4a4c'; g.lineWidth = 2; g.beginPath(); g.arc(cx, cz, rr * 0.85, 0, Math.PI * 2); g.stroke();
      g.strokeStyle = 'rgba(90,90,92,0.8)'; g.lineWidth = 1.2;
      for (let q = -2; q <= 2; q++) { g.beginPath(); g.moveTo(cx + q * rr * 0.3, cz - rr * 0.7); g.lineTo(cx + q * rr * 0.3, cz + rr * 0.7); g.stroke(); }
    }
    // buracos (alguns com poça d'água em 3D)
    for (const ph of potholes) {
      const cx = X(ph.x), cz = X(ph.z), rr = L(ph.r);
      g.fillStyle = 'rgba(70,68,64,0.9)'; g.beginPath(); g.ellipse(cx, cz, rr * 1.25, rr * 1.0, ph.a, 0, Math.PI * 2); g.fill();
      g.fillStyle = 'rgba(12,12,12,0.95)'; g.beginPath(); g.ellipse(cx, cz, rr, rr * 0.75, ph.a, 0, Math.PI * 2); g.fill();
    }
    // manchas de óleo e marcas de pneu
    for (let i = 0; i < 120; i++) {
      const k = (Math.random() * (N + 1)) | 0, vert = Math.random() < 0.5;
      const a = -half + k * P + rnd(1, ROAD - 1), t2 = rnd(-half, half);
      const cx = vert ? X(a) : X(t2), cz = vert ? X(t2) : X(a);
      const grd = g.createRadialGradient(cx, cz, 0, cx, cz, L(rnd(0.5, 1.4)));
      grd.addColorStop(0, 'rgba(5,5,8,0.55)'); grd.addColorStop(1, 'rgba(5,5,8,0)');
      g.fillStyle = grd; g.beginPath(); g.arc(cx, cz, L(1.4), 0, Math.PI * 2); g.fill();
    }
    g.strokeStyle = 'rgba(8,8,8,0.4)'; g.lineWidth = L(0.18);
    for (let i = 0; i < 25; i++) {
      const k = (Math.random() * (N + 1)) | 0, vert = Math.random() < 0.5;
      const a = -half + k * P + rnd(1.5, ROAD - 2.5), t2 = rnd(-half, half - 10), len = rnd(5, 12), bend = rnd(-1.5, 1.5);
      for (const off of [0, 1.6]) {
        g.beginPath();
        if (vert) { g.moveTo(X(a + off), X(t2)); g.quadraticCurveTo(X(a + off + bend), X(t2 + len / 2), X(a + off + bend * 1.6), X(t2 + len)); }
        else { g.moveTo(X(t2), X(a + off)); g.quadraticCurveTo(X(t2 + len / 2), X(a + off + bend), X(t2 + len), X(a + off + bend * 1.6)); }
        g.stroke();
      }
    }
    // folhas, papéis e lixo espalhado
    for (let i = 0; i < 1600; i++) {
      g.fillStyle = Math.random() < 0.5 ? `rgba(${90 + Math.random() * 60 | 0},${70 + Math.random() * 40 | 0},30,0.55)` : 'rgba(200,195,180,0.45)';
      g.save(); g.translate(Math.random() * SZ, Math.random() * SZ); g.rotate(Math.random() * 3);
      g.fillRect(0, 0, 2 + Math.random() * 5, 2 + Math.random() * 3); g.restore();
    }
    // rachaduras
    g.strokeStyle = 'rgba(10,10,10,0.5)'; g.lineWidth = 1.5;
    for (let i = 0; i < 600; i++) {
      let x = Math.random() * SZ, y = Math.random() * SZ;
      g.beginPath(); g.moveTo(x, y);
      for (let k = 0; k < 5; k++) { x += (Math.random() - 0.5) * 40; y += (Math.random() - 0.5) * 40; g.lineTo(x, y); }
      g.stroke();
    }
    // manchas de sangue e queimado
    for (let i = 0; i < 90; i++) {
      const x = Math.random() * SZ, y = Math.random() * SZ, rr = 6 + Math.random() * 22;
      g.fillStyle = Math.random() < 0.6 ? 'rgba(90,10,10,0.45)' : 'rgba(10,8,6,0.5)';
      g.beginPath(); g.ellipse(x, y, rr, rr * (0.4 + Math.random() * 0.6), Math.random() * 3, 0, Math.PI * 2); g.fill();
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    return tex;
  }
  // relevo fino em mosaico sobre o chão pintado: o asfalto "pega" a luz (grão e microfissuras)
  const groundBump = asphaltBump(Math.round(S / 3));
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(S, S), new THREE.MeshStandardMaterial({ map: groundTex, roughness: 0.92, bumpMap: groundBump, bumpScale: lowPower ? 0.6 : 1.1 }));
  ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true;
  group.add(ground);
  const outer = new THREE.Mesh(new THREE.PlaneGeometry(S * 4, S * 4), new THREE.MeshStandardMaterial({ color: 0x1e1c1a, roughness: 1 }));
  outer.rotation.x = -Math.PI / 2; outer.position.y = -0.02;
  group.add(outer);

  // poças d'água refletindo o céu e as luzes
  {
    const pg = [];
    for (const ph of potholes) if (ph.water) {
      const c = new THREE.CircleGeometry(1, 18); c.rotateX(-Math.PI / 2); c.scale(ph.r * 1.15, 1, ph.r * 0.85); c.rotateY(-ph.a); c.translate(ph.x, 0.012, ph.z);
      pg.push(c);
    }
    for (let i = 0; i < N * 4; i++) { // poças rasas maiores perto do meio-fio
      const k = randi(0, N, r), vert = r() < 0.5, a = -half + k * P + (r() < 0.5 ? 0.9 : ROAD - 0.9), t2 = rand(-half + 3, half - 3, r);
      const c = new THREE.CircleGeometry(1, 20); c.rotateX(-Math.PI / 2); c.scale(vert ? 0.7 : rand(1.2, 2.5, r), 1, vert ? rand(1.2, 2.5, r) : 0.7);
      c.translate(vert ? a : t2, 0.012, vert ? t2 : a); pg.push(c);
    }
    if (pg.length) {
      const m = new THREE.Mesh(mergeGeometries(pg, false), new THREE.MeshStandardMaterial({ color: 0x2a323a, roughness: 0.05, metalness: 0.45, transparent: true, opacity: 0.7, polygonOffset: true, polygonOffsetFactor: -1 }));
      m.receiveShadow = true; group.add(m);
      pg.forEach((x) => x.dispose());
    }
  }

  // ----- malhas estáticas agrupadas -----
  const facadeMat = new THREE.MeshStandardMaterial({ map: facadeTex, emissiveMap: facadeEmi, emissive: 0xffffff, emissiveIntensity: 0.6, vertexColors: true, roughness: 0.9 });
  const plainMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92 });
  const glowMat = new THREE.MeshBasicMaterial({ vertexColors: true });
  const addMerged = (geos, material, shadow = true) => {
    if (!geos.length) return;
    // em lotes para evitar buffers gigantes
    for (let i = 0; i < geos.length; i += 400) {
      const merged = mergeGeometries(geos.slice(i, i + 400), false);
      const m = new THREE.Mesh(merged, material);
      m.castShadow = shadow; m.receiveShadow = true;
      group.add(m);
    }
    geos.forEach((g) => g.dispose());
  };
  addMerged(facadeGeos, facadeMat);
  addMerged(plainGeos, plainMat);
  addMerged(glowGeos, glowMat, false);
  for (const b of fadeBuildings) {
    const material = facadeMat.clone();
    material.transparent = true;
    material.opacity = 1;
    const mesh = new THREE.Mesh(b.geometry, material);
    mesh.castShadow = true; mesh.receiveShadow = true;
    group.add(mesh);
    b.mesh = mesh; b.targetOpacity = 1;
  }
  occluderGeos.length = 0;

  // ----- contêineres -----
  const containers = [];
  const sparkleGeo = new THREE.OctahedronGeometry(0.14);
  const sparkleMat = new THREE.MeshBasicMaterial({ color: 0xffd23f });
  for (const s of containerSpecs) {
    const { g, w, d, h } = containerMesh(s.type, r);
    g.position.set(s.x, 0, s.z);
    g.rotation.y = s.rot;
    group.add(g);
    const along = Math.abs(Math.sin(s.rot)) > 0.7;
    const hw = (along ? d : w) / 2, hd = (along ? w : d) / 2;
    addCollider(s.x - hw, s.z - hd, s.x + hw, s.z + hd, h);
    const sp = new THREE.Mesh(sparkleGeo, sparkleMat);
    sp.position.set(s.x, h + 0.6, s.z);
    group.add(sp);
    containers.push({ ...s, mesh: g, sparkle: sp, looted: false, h, radius: Math.max(hw, hd) + 1.3, def: CONTAINERS[s.type] });
  }

  function addTreasure(x, z) {
    const { g, w, d, h } = containerMesh('tesouro', r);
    g.traverse((o) => { if (o.isMesh) addOcclusion(o.material); });
    g.position.set(x, 0, z);
    group.add(g);
    const sp = new THREE.Mesh(sparkleGeo, sparkleMat);
    sp.position.set(x, h + 0.6, z); sp.scale.setScalar(2);
    group.add(sp);
    const c = { type: 'tesouro', x, z, rot: 0, mesh: g, sparkle: sp, looted: false, h, radius: 2.3, def: CONTAINERS.tesouro };
    containers.push(c);
    return c;
  }

  function markLooted(c) {
    c.looted = true;
    c.mesh.traverse((o) => { if (o.isMesh) o.material = darkVersion(o.material); });
    group.remove(c.sparkle);
  }

  // ----- ninhos -----
  const nestObjs = [];
  const makeNest = (x, z, mother) => {
    const nm = nestMesh(mother);
    nm.g.position.set(x, 0, z);
    group.add(nm.g);
    const rad = mother ? 3.2 : 1.6;
    addCollider(x - rad, z - rad, x + rad, z + rad, 2);
    const n = {
      x, z, mother, mesh: nm.g, core: nm.core, veins: nm.veins, flesh: nm.flesh, radius: rad + 0.4,
      maxHp: 0, hp: 0, alive: true, spawnT: rand(2, 5), children: 0, shield: null, phase: Math.random() * 6,
    };
    if (mother) {
      const sh = new THREE.Mesh(new THREE.SphereGeometry(5.5, 24, 16), new THREE.MeshBasicMaterial({ color: 0xa040ff, transparent: true, opacity: 0.18, depthWrite: false }));
      sh.position.set(x, 2.5, z);
      group.add(sh);
      n.shield = sh;
    }
    nestObjs.push(n);
    return n;
  };
  for (const n of nests) makeNest(n.x, n.z, false);
  const mother = makeNest(motherPos.x, motherPos.z, true);

  // ----- luzes de fogo -----
  const fires = [];
  // chamas com textura (cartões cruzados) — a do acampamento é uma fogueira completa
  const lit = fireSpots.filter((f) => f.camp).concat(fireSpots.filter((f) => !f.camp).sort(() => r() - 0.5).slice(0, 5));
  for (const f of fireSpots) {
    const fx = f.camp ? makeFirePit(1.1) : makeFlames(3, 0.62);
    fx.group.position.set(f.x, f.camp ? 0 : f.y - 0.12, f.z);
    group.add(fx.group);
    const item = { ...f, flame: fx, light: null, ph: Math.random() * 10 };
    if (lit.includes(f)) {
      const L = new THREE.PointLight(0xff8a3a, f.camp ? 26 : 16, f.camp ? 16 : 12, 1.6);
      L.position.set(f.x, f.y + 1.2, f.z);
      group.add(L);
      item.light = L;
    }
    fires.push(item);
  }
  const motherLight = new THREE.PointLight(0xb040ff, 30, 22, 1.5);
  motherLight.position.set(motherPos.x, 4, motherPos.z);
  group.add(motherLight);

  // ----- grade de navegação -----
  const GW = Math.ceil(S / CELL);
  const blocked = new Uint8Array(GW * GW);
  const inflate = 0.5;
  for (const c of colliders) {
    const i0 = clamp(Math.floor((c.minX - inflate + half) / CELL), 0, GW - 1);
    const i1 = clamp(Math.floor((c.maxX + inflate + half) / CELL), 0, GW - 1);
    const j0 = clamp(Math.floor((c.minZ - inflate + half) / CELL), 0, GW - 1);
    const j1 = clamp(Math.floor((c.maxZ + inflate + half) / CELL), 0, GW - 1);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
      const wx = -half + (i + 0.5) * CELL, wz = -half + (j + 0.5) * CELL;
      if (wx > c.minX - inflate && wx < c.maxX + inflate && wz > c.minZ - inflate && wz < c.maxZ + inflate) blocked[j * GW + i] = 1;
    }
  }
  const cellOf = (x, z) => {
    const i = Math.floor((x + half) / CELL), j = Math.floor((z + half) / CELL);
    if (i < 0 || j < 0 || i >= GW || j >= GW) return -1;
    return j * GW + i;
  };
  const isBlocked = (x, z) => { const c = cellOf(x, z); return c < 0 || blocked[c] === 1; };
  const queue = new Int32Array(GW * GW);
  const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
  function computeField(tx, tz, out) {
    out.fill(65535);
    let start = cellOf(tx, tz);
    if (start < 0) return out;
    if (blocked[start]) {
      // procura célula livre próxima
      const si = start % GW, sj = (start / GW) | 0;
      let found = -1;
      for (let rr = 1; rr < 4 && found < 0; rr++) for (let di = -rr; di <= rr && found < 0; di++) for (let dj = -rr; dj <= rr; dj++) {
        const i = si + di, j = sj + dj;
        if (i >= 0 && j >= 0 && i < GW && j < GW && !blocked[j * GW + i]) { found = j * GW + i; break; }
      }
      if (found < 0) return out;
      start = found;
    }
    let qh = 0, qt = 0;
    out[start] = 0; queue[qt++] = start;
    while (qh < qt) {
      const c = queue[qh++], ci = c % GW, cj = (c / GW) | 0, nd = out[c] + 1;
      if (nd > 400) continue;
      for (let k = 0; k < 8; k++) {
        const i = ci + DIRS[k][0], j = cj + DIRS[k][1];
        if (i < 0 || j < 0 || i >= GW || j >= GW) continue;
        const n = j * GW + i;
        if (blocked[n] || out[n] <= nd) continue;
        if (k >= 4 && (blocked[cj * GW + i] || blocked[j * GW + ci])) continue;
        out[n] = nd; queue[qt++] = n;
      }
    }
    return out;
  }
  function flowDir(field, x, z) {
    const c = cellOf(x, z);
    if (c < 0) return null;
    const ci = c % GW, cj = (c / GW) | 0;
    let best = field[c], bi = -1, bj = -1;
    for (let k = 0; k < 8; k++) {
      const i = ci + DIRS[k][0], j = cj + DIRS[k][1];
      if (i < 0 || j < 0 || i >= GW || j >= GW) continue;
      const v = field[j * GW + i];
      if (v < best) { best = v; bi = i; bj = j; }
    }
    if (bi < 0) return null;
    const wx = -half + (bi + 0.5) * CELL - x, wz = -half + (bj + 0.5) * CELL - z;
    const l = Math.hypot(wx, wz) || 1;
    return [wx / l, wz / l];
  }
  function hasLOS(x1, z1, x2, z2) {
    const d = Math.hypot(x2 - x1, z2 - z1), steps = Math.ceil(d / 0.6);
    for (let s = 1; s < steps; s++) {
      const t = s / steps;
      if (isBlocked(x1 + (x2 - x1) * t, z1 + (z2 - z1) * t)) return false;
    }
    return true;
  }
  function randomWalkable(avoid = [], minDist = 0, tries = 200) {
    for (let k = 0; k < tries; k++) {
      const x = rand(-half + 2, half - 2), z = rand(-half + 2, half - 2);
      if (isBlocked(x, z)) continue;
      let ok = true;
      for (const a of avoid) if (Math.hypot(a.x - x, a.z - z) < (a.r ?? minDist)) { ok = false; break; }
      if (ok) return { x, z };
    }
    return null;
  }
  function walkableNear(x, z, rad) {
    for (let k = 0; k < 30; k++) {
      const a = Math.random() * Math.PI * 2, d = rad * (0.4 + Math.random() * 0.6);
      const px = x + Math.cos(a) * d, pz = z + Math.sin(a) * d;
      if (!isBlocked(px, pz)) return { x: px, z: pz };
    }
    return null;
  }

  // Colisão física (círculo vs colisores). feetY = altura dos pés: objetos mais
  // baixos que os pés não bloqueiam (o jogador passa por cima ou está sobre eles).
  function collide(pos, rad, feetY = 0) {
    for (let iter = 0; iter < 2; iter++) {
      for (let k = 0; k < colliders.length; k++) {
        const b = colliders[k];
        if (b.h <= feetY + 0.02) continue;
        if (pos.x + rad < b.minX || pos.x - rad > b.maxX || pos.z + rad < b.minZ || pos.z - rad > b.maxZ) continue;
        const cx = clamp(pos.x, b.minX, b.maxX), cz = clamp(pos.z, b.minZ, b.maxZ);
        let dx = pos.x - cx, dz = pos.z - cz;
        const d2 = dx * dx + dz * dz;
        if (d2 >= rad * rad) continue;
        if (d2 > 1e-8) { const d = Math.sqrt(d2); pos.x += (dx / d) * (rad - d); pos.z += (dz / d) * (rad - d); }
        else {
          const l = pos.x - b.minX, rr = b.maxX - pos.x, t = pos.z - b.minZ, bt = b.maxZ - pos.z, m = Math.min(l, rr, t, bt);
          if (m === l) pos.x = b.minX - rad; else if (m === rr) pos.x = b.maxX + rad; else if (m === t) pos.z = b.minZ - rad; else pos.z = b.maxZ + rad;
        }
      }
    }
    pos.x = clamp(pos.x, -half + rad, half - rad);
    pos.z = clamp(pos.z, -half + rad, half - rad);
  }
  // Altura do apoio sob os pés: topo do objeto mais alto (que já esteja abaixo dos pés)
  // sob o centro do personagem. 0 = chão. Permite pousar em carros, caixas, muretas...
  function supportHeight(x, z, rad, feetY) {
    const r = rad * 0.55;
    let top = 0;
    for (let k = 0; k < colliders.length; k++) {
      const b = colliders[k];
      if (b.h > feetY + 0.06 || b.h <= top) continue;
      if (x + r < b.minX || x - r > b.maxX || z + r < b.minZ || z - r > b.maxZ) continue;
      top = b.h;
    }
    return top;
  }
  function pointBlocked(x, z, y = 1) {
    for (let k = 0; k < colliders.length; k++) {
      const b = colliders[k];
      if (x > b.minX && x < b.maxX && z > b.minZ && z < b.maxZ && y < b.h) return true;
    }
    return false;
  }

  let time = 0;
  // janela transparente (shader) em todo o cenário: prédios, muros, objetos, carros, árvores
  group.traverse((o) => { if (o.isMesh && o !== ground && o !== outer) [].concat(o.material).forEach(addOcclusion); });

  function updateOcclusion(camera, playerPos, dt = 0.016) {
    const from = camera.position, toX = playerPos.x, toY = playerPos.y + 1.35, toZ = playerPos.z;
    const dx = toX - from.x, dy = toY - from.y, dz = toZ - from.z;
    for (const b of fadeBuildings) {
      let blocked = false;
      for (let i = 1; i <= 12; i++) {
        const t = i / 13, x = from.x + dx * t, y = from.y + dy * t, z = from.z + dz * t;
        if (y < b.h + 0.35 && x > b.x - b.w / 2 && x < b.x + b.w / 2 && z > b.z - b.d / 2 && z < b.z + b.d / 2) { blocked = true; break; }
      }
      b.targetOpacity = blocked ? 0.28 : 1;
      const m = b.mesh.material;
      m.opacity += (b.targetOpacity - m.opacity) * Math.min(1, dt * 8);
      m.depthWrite = m.opacity > 0.94;
    }
  }
  function update(dt) {
    time += dt;
    for (const f of fires) {
      const fl = 0.8 + Math.sin(time * 13 + f.ph) * 0.12 + Math.sin(time * 27 + f.ph * 2) * 0.08;
      f.flame.update(time + f.ph, dt);
      if (f.light) f.light.intensity = (f.camp ? 26 : 16) * fl;
    }
    for (const n of nestObjs) {
      if (!n.alive) continue;
      const p = 1 + Math.sin(time * 2.4 + n.phase) * 0.05;
      n.core.scale.set(p, 1.25 * p, p);
      n.veins.scale.copy(n.core.scale);
      n.flesh.emissiveIntensity = 0.35 + Math.sin(time * 2.4 + n.phase) * 0.2;
      if (n.shield) { n.shield.visible = n.shieldOn; n.shield.rotation.y += dt * 0.3; n.shield.material.opacity = 0.14 + Math.sin(time * 3) * 0.05; }
    }
    motherLight.intensity = mother.alive ? 26 + Math.sin(time * 2) * 8 : 0;
    for (const c of containers) if (!c.looted) { c.sparkle.rotation.y += dt * 2; c.sparkle.position.y = c.h + 0.6 + Math.sin(time * 3 + c.x) * 0.12; }
  }

  function dispose() {
    scene.remove(group);
    group.traverse((o) => {
      if (o.isMesh) {
        if (o.geometry && !geoShared(o.geometry)) o.geometry.dispose();
      }
    });
    for (const f of fires) f.flame.dispose(); // chamas/fogueira (materiais próprios)
    groundTex.dispose(); groundBump.dispose();
    facadeMat.dispose(); plainMat.dispose(); glowMat.dispose();
    for (const b of fadeBuildings) if (b.mesh) b.mesh.material.dispose();
  }
  const geoShared = (g) => g === sparkleGeo || g === wheelGeo || g === carBodyGeo || g === carCabinGeo || g === lightGeo || boxShared(g);
  const boxShared = (g) => g.type === 'BoxGeometry' && g.parameters && !g.attributes.color;

  return {
    seed, size: S, half, group, colliders, containers, nests: nestObjs, mother, safe, extraction,
    types, N, P, ROAD, blockOrigin, GW, CELL, blocked,
    computeField, flowDir, hasLOS, isBlocked, randomWalkable, walkableNear, collide, supportHeight, pointBlocked,
    newField: () => new Uint16Array(GW * GW), cellOf,
    markLooted, addTreasure, update, updateOcclusion, dispose,
  };
}
