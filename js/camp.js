// ============================================================
//  ACAMPAMENTO — cena realista usada no menu principal e no hub
//  Tudo procedural (sem modelos externos):
//  · chão de terra com relevo, grama, área queimada perto do fogo
//  · fogueira: pedras, lenha em pirâmide, brasas, chamas animadas,
//    faíscas e fumaça
//  · barracas de cumeeira em lona, estacas e cordas
//  · muro de sacos de areia, caixotes de madeira, tambores
//  · cerca de alambrado com arame farpado, varal de lâmpadas
//  · ruínas com janelas ao fundo, na neblina, e céu estrelado
// ============================================================
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { lowPower } from './device.js';
import { PIX } from './pixtex.js';

// ---------- texturas procedurais ----------
const texCache = new Map();
function canvasTex(key, size, draw, { repeat = 1, srgb = true } = {}) {
  if (texCache.has(key)) return texCache.get(key);
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  draw(g, size);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.anisotropy = 4;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  texCache.set(key, t);
  return t;
}
// manchas suaves (ruído barato por círculos com gradiente)
function blotches(g, s, n, colors, rMin, rMax) {
  for (let i = 0; i < n; i++) {
    const x = Math.random() * s, y = Math.random() * s, r = rMin + Math.random() * (rMax - rMin);
    const c = colors[(Math.random() * colors.length) | 0];
    for (const [dx, dy] of [[0, 0], [s, 0], [-s, 0], [0, s], [0, -s]]) { // repete nas bordas (textura contínua)
      const gr = g.createRadialGradient(x + dx, y + dy, 0, x + dx, y + dy, r);
      gr.addColorStop(0, c); gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gr; g.fillRect(x + dx - r, y + dy - r, r * 2, r * 2);
    }
  }
}
function speckle(g, s, n, alpha, light = true) {
  for (let i = 0; i < n; i++) {
    const v = light ? 120 + Math.random() * 135 : Math.random() * 60;
    g.fillStyle = `rgba(${v},${v},${v},${alpha * Math.random()})`;
    g.fillRect(Math.random() * s, Math.random() * s, 1 + Math.random() * 2, 1 + Math.random() * 2);
  }
}
const dirtTex = () => canvasTex('dirt', 512, (g, s) => {
  g.fillStyle = '#4a3c2e'; g.fillRect(0, 0, s, s);
  blotches(g, s, 70, ['rgba(92,74,52,0.55)', 'rgba(40,32,24,0.5)', 'rgba(70,66,44,0.45)', 'rgba(58,50,40,0.5)'], 20, 90);
  speckle(g, s, 6000, 0.12); speckle(g, s, 6000, 0.45, false);
  // pedriscos
  for (let i = 0; i < 180; i++) { const v = 62 + Math.random() * 40; g.fillStyle = `rgba(${v},${v - 6},${v - 12},0.85)`; g.beginPath(); g.ellipse(Math.random() * s, Math.random() * s, 1 + Math.random() * 2.5, 1 + Math.random() * 2, Math.random() * 3, 0, 7); g.fill(); }
}, { repeat: 10 });
const dirtBump = () => canvasTex('dirtBump', 256, (g, s) => {
  g.fillStyle = '#808080'; g.fillRect(0, 0, s, s);
  blotches(g, s, 50, ['rgba(160,160,160,0.4)', 'rgba(40,40,40,0.4)'], 8, 40);
  speckle(g, s, 6000, 0.6); speckle(g, s, 4000, 0.6, false);
}, { repeat: 24, srgb: false });
const canvasClothTex = (key, base) => canvasTex(key, 256, (g, s) => {
  g.fillStyle = base; g.fillRect(0, 0, s, s);
  for (let y = 0; y < s; y += 2) { g.fillStyle = `rgba(0,0,0,${0.05 + Math.random() * 0.06})`; g.fillRect(0, y, s, 1); }
  for (let x = 0; x < s; x += 2) { g.fillStyle = `rgba(255,255,255,${0.03 + Math.random() * 0.04})`; g.fillRect(x, 0, 1, s); }
  blotches(g, s, 18, ['rgba(30,24,16,0.35)', 'rgba(90,80,60,0.25)'], 10, 50); // sujeira e desbotado
  g.strokeStyle = 'rgba(0,0,0,0.25)'; g.lineWidth = 2; // costuras
  g.beginPath(); g.moveTo(0, s * 0.5); g.lineTo(s, s * 0.5); g.stroke();
}, { repeat: 1 });
const woodTex = () => canvasTex('wood', 256, (g, s) => {
  g.fillStyle = '#7a5a36'; g.fillRect(0, 0, s, s);
  const plank = s / 4;
  for (let p = 0; p < 4; p++) {
    const tone = 0.8 + Math.random() * 0.35;
    g.fillStyle = `rgba(${(122 * tone) | 0},${(90 * tone) | 0},${(54 * tone) | 0},1)`; g.fillRect(0, p * plank, s, plank);
    for (let i = 0; i < 40; i++) { g.strokeStyle = `rgba(40,25,10,${0.08 + Math.random() * 0.15})`; g.lineWidth = 1; g.beginPath(); const y = p * plank + Math.random() * plank; g.moveTo(0, y); g.bezierCurveTo(s * 0.3, y + (Math.random() - 0.5) * 6, s * 0.7, y + (Math.random() - 0.5) * 6, s, y); g.stroke(); }
    g.fillStyle = 'rgba(20,12,5,0.7)'; g.fillRect(0, p * plank, s, 2); // fresta
    g.fillStyle = 'rgba(30,30,30,0.9)'; for (const x of [10, s - 14]) { g.beginPath(); g.arc(x, p * plank + plank / 2, 2.2, 0, 7); g.fill(); } // pregos
  }
  blotches(g, s, 10, ['rgba(20,14,8,0.35)'], 10, 40);
});
const rustTex = (key, base) => canvasTex(key, 256, (g, s) => {
  g.fillStyle = base; g.fillRect(0, 0, s, s);
  blotches(g, s, 45, ['rgba(120,60,25,0.55)', 'rgba(70,35,15,0.5)', 'rgba(160,90,40,0.35)'], 6, 40);
  speckle(g, s, 3000, 0.3, false);
  for (let i = 0; i < 30; i++) { g.strokeStyle = 'rgba(90,45,15,0.35)'; g.lineWidth = 1 + Math.random() * 2; const x = Math.random() * s; g.beginPath(); g.moveTo(x, Math.random() * s * 0.4); g.lineTo(x + (Math.random() - 0.5) * 6, s * (0.5 + Math.random() * 0.5)); g.stroke(); } // escorridos
});
const burlapTex = () => canvasTex('burlap', 128, (g, s) => {
  g.fillStyle = '#8f7d58'; g.fillRect(0, 0, s, s);
  for (let y = 0; y < s; y += 3) { g.fillStyle = `rgba(60,45,25,${0.2 + Math.random() * 0.15})`; g.fillRect(0, y, s, 1); }
  for (let x = 0; x < s; x += 3) { g.fillStyle = `rgba(60,45,25,${0.15 + Math.random() * 0.15})`; g.fillRect(x, 0, 1, s); }
  blotches(g, s, 8, ['rgba(40,30,18,0.4)'], 8, 30);
}, { repeat: 2 });
const barkTex = () => canvasTex('bark', 128, (g, s) => {
  g.fillStyle = '#3e2b1a'; g.fillRect(0, 0, s, s);
  for (let i = 0; i < 70; i++) { g.strokeStyle = `rgba(${Math.random() < 0.5 ? '15,10,5' : '95,75,50'},${0.3 + Math.random() * 0.4})`; g.lineWidth = 1 + Math.random() * 2; const x = Math.random() * s; g.beginPath(); g.moveTo(x, 0); g.lineTo(x + (Math.random() - 0.5) * 10, s); g.stroke(); }
}, { repeat: 1 });
const fenceTex = () => canvasTex('fence', 128, (g, s) => {
  g.clearRect(0, 0, s, s);
  g.strokeStyle = '#9a9a96'; g.lineWidth = 3;
  const n = 4, step = s / n;
  for (let i = -n; i <= n * 2; i++) {
    g.beginPath(); g.moveTo(i * step, 0); g.lineTo(i * step + s, s); g.stroke();
    g.beginPath(); g.moveTo(i * step + s, 0); g.lineTo(i * step, s); g.stroke();
  }
}, { repeat: 1 });
const flameTex = () => canvasTex('flame', 128, (g, s) => {
  const gr = g.createRadialGradient(s / 2, s * 0.62, 2, s / 2, s * 0.55, s * 0.48);
  gr.addColorStop(0, 'rgba(255,250,220,1)'); gr.addColorStop(0.25, 'rgba(255,190,80,0.95)');
  gr.addColorStop(0.55, 'rgba(255,90,20,0.6)'); gr.addColorStop(1, 'rgba(120,20,0,0)');
  g.fillStyle = gr;
  g.beginPath(); g.moveTo(s / 2, 2); g.bezierCurveTo(s * 0.95, s * 0.45, s * 0.9, s, s / 2, s); g.bezierCurveTo(s * 0.1, s, s * 0.05, s * 0.45, s / 2, 2); g.fill();
});
const smokeTex = () => canvasTex('smoke', 128, (g, s) => {
  blotches(g, s, 26, ['rgba(120,118,115,0.22)', 'rgba(80,78,76,0.25)'], 12, 34);
  const mask = g.createRadialGradient(s / 2, s / 2, s * 0.1, s / 2, s / 2, s / 2);
  mask.addColorStop(0, 'rgba(0,0,0,1)'); mask.addColorStop(1, 'rgba(0,0,0,0)');
  g.globalCompositeOperation = 'destination-in'; g.fillStyle = mask; g.fillRect(0, 0, s, s);
});
const scorchTex = () => canvasTex('scorch', 256, (g, s) => {
  const gr = g.createRadialGradient(s / 2, s / 2, 4, s / 2, s / 2, s / 2);
  gr.addColorStop(0, 'rgba(10,8,6,0.95)'); gr.addColorStop(0.45, 'rgba(25,20,15,0.7)'); gr.addColorStop(1, 'rgba(25,20,15,0)');
  g.fillStyle = gr; g.fillRect(0, 0, s, s);
  for (let i = 0; i < 400; i++) { const a = Math.random() * 7, r = Math.random() * s * 0.3; g.fillStyle = `rgba(${Math.random() < 0.3 ? '90,40,20' : '160,150,140'},${Math.random() * 0.5})`; g.fillRect(s / 2 + Math.cos(a) * r, s / 2 + Math.sin(a) * r, 2, 2); } // cinzas
});
// fachada em ruínas + mapa de brilho só das janelas acesas (mesmo sorteio)
function windowsTex() {
  if (texCache.has('ruinWin')) return texCache.get('ruinWin');
  const lit = [];
  const map = canvasTex('ruinWinMap', 256, (g, s) => {
    g.fillStyle = '#3a3734'; g.fillRect(0, 0, s, s);
    blotches(g, s, 20, ['rgba(20,18,16,0.5)', 'rgba(80,76,70,0.3)'], 10, 50);
    for (let y = 0; y < 8; y++) for (let x = 0; x < 6; x++) {
      const on = Math.random() < 0.025, broken = Math.random() < 0.35;
      if (on) lit.push([14 + x * 40, 12 + y * 31]);
      g.fillStyle = on ? '#d89a48' : broken ? '#0b0a09' : '#1c1f24';
      g.fillRect(16 + x * 40, 14 + y * 31, 16, 13);
    }
  });
  const emi = canvasTex('ruinWinEmi', 256, (g, s) => {
    g.fillStyle = '#000'; g.fillRect(0, 0, s, s);
    g.fillStyle = '#c88440'; for (const [x, y] of lit) g.fillRect(x + 2, y + 2, 12, 9);
  });
  const r = { map, emi };
  texCache.set('ruinWin', r);
  return r;
}

// ---------- geometrias ----------
// Barraca de cumeeira (A): dois panos inclinados + empenas, frente com abertura
function ridgeTentGeo(w, d, h) {
  const hw = w / 2, hd = d / 2;
  const pos = [], uv = [];
  const quad = (a, b, c, e, u = [0, 0, 1, 0, 1, 1, 0, 1]) => { pos.push(...a, ...b, ...c, ...a, ...c, ...e); uv.push(u[0], u[1], u[2], u[3], u[4], u[5], u[0], u[1], u[4], u[5], u[6], u[7]); };
  const sag = 0.06; // pano levemente cedido no meio
  const N = 6;
  for (const side of [-1, 1]) for (let i = 0; i < N; i++) {
    const z0 = -hd + (d * i) / N, z1 = -hd + (d * (i + 1)) / N;
    const s0 = Math.sin((Math.PI * i) / N) * sag, s1 = Math.sin((Math.PI * (i + 1)) / N) * sag;
    const a = [side * hw, 0, z0], b = [side * hw, 0, z1], c = [side * s1, h - s1, z1], e = [side * s0, h - s0, z0];
    if (side < 0) quad(a, b, c, e, [i / N, 0, (i + 1) / N, 0, (i + 1) / N, 1, i / N, 1]); else quad(b, a, e, c, [(i + 1) / N, 0, i / N, 0, i / N, 1, (i + 1) / N, 1]);
  }
  // empena de trás (fechada) e da frente (duas abas com abertura no meio)
  pos.push(-hw, 0, -hd, 0, h, -hd, hw, 0, -hd); uv.push(0, 0, 0.5, 1, 1, 0);
  pos.push(-hw, 0, hd, -hw * 0.18, 0, hd + 0.05, 0, h, hd); uv.push(0, 0, 0.4, 0, 0.5, 1);
  pos.push(hw * 0.18, 0, hd + 0.05, hw, 0, hd, 0, h, hd); uv.push(0.6, 0, 1, 0, 0.5, 1);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  return g;
}
// pedra irregular (icosaedro deformado de forma estável)
// pedra em bloco (tamanho e giro variados — estilo blocos)
function rockGeo(seed, r = 0.2) {
  const k = (n) => 0.75 + ((Math.sin(seed * n) + 1) / 2) * 0.5;
  const g = new THREE.BoxGeometry(r * 1.7 * k(3.1), r * 1.1 * k(5.3), r * 1.5 * k(7.7));
  g.rotateY(seed);
  return g;
}
function sandbagGeo() { const g = new THREE.BoxGeometry(0.6, 0.2, 0.36); g.translate(0, 0.1, 0); return g; }
function drumGeo() { const g = new THREE.BoxGeometry(0.58, 0.88, 0.58); g.translate(0, 0.44, 0); return g; }

// ---------- cena ----------
export function buildCampScene() {
  const scene = new THREE.Scene();
  const fogCol = 0x1b2130;
  // Céu como cúpula (passa pela mesma curva de tom que a neblina): o horizonte
  // tem exatamente a cor da neblina e as silhuetas se fundem nele, sem "blocos escuros".
  scene.background = new THREE.Color(0x05060a);
  {
    const skyTex = canvasTex('nightSkyDome', 256, (g, s) => {
      const gr = g.createLinearGradient(0, 0, 0, s);
      gr.addColorStop(0, '#05060a'); gr.addColorStop(0.3, '#0a0d14'); gr.addColorStop(0.47, '#1b2130'); gr.addColorStop(1, '#1b2130');
      g.fillStyle = gr; g.fillRect(0, 0, s, s);
    });
    const dome = new THREE.Mesh(new THREE.SphereGeometry(110, 32, 16), new THREE.MeshBasicMaterial({ map: skyTex, side: THREE.BackSide, fog: false, depthWrite: false }));
    dome.renderOrder = -10;
    scene.add(dome);
  }
  scene.fog = new THREE.FogExp2(fogCol, 0.036);
  scene.userData.envIntensity = 0.12;
  const disposables = [];
  const track = (x) => { disposables.push(x); return x; };
  const add = (geo, material, x, y, z, ry = 0, cast = true) => {
    const m = new THREE.Mesh(geo, material);
    m.position.set(x, y, z); m.rotation.y = ry;
    m.castShadow = cast; m.receiveShadow = true;
    scene.add(m);
    return m;
  };

  // ----- luz: lua fria + fogueira quente (com sombras) -----
  scene.add(new THREE.HemisphereLight(0x3a4560, 0x15110d, 0.55));
  const moon = new THREE.DirectionalLight(0x8ea4d8, 0.65);
  moon.position.set(-10, 16, -8);
  moon.castShadow = !lowPower;
  moon.shadow.mapSize.set(1024, 1024);
  Object.assign(moon.shadow.camera, { left: -14, right: 14, top: 14, bottom: -14, near: 1, far: 50 });
  moon.shadow.bias = -0.0008;
  scene.add(moon);
  const fire = new THREE.PointLight(0xff7a2a, 30, 20, 1.7);
  fire.position.set(0, 0.9, 0);
  fire.castShadow = true;
  fire.shadow.mapSize.set(lowPower ? 512 : 1024, lowPower ? 512 : 1024);
  fire.shadow.bias = -0.002;
  scene.add(fire);

  const tentSpecs = [[-4.8, -4.2, 0.35, '#4f5a33', 3.0, 3.6, 1.9], [4.9, -4.6, -0.42, '#6a5a3a', 2.6, 3.2, 1.7], [-8.2, 1.4, 1.2, '#3e4a40', 2.8, 3.4, 1.8]];
  // ----- chão -----
  const groundMat = track(new THREE.MeshStandardMaterial({ map: dirtTex(), bumpMap: dirtBump(), bumpScale: 1.4, roughness: 0.96, color: 0xb8b0a4 }));
  const ground = add(new THREE.PlaneGeometry(120, 120), groundMat, 0, 0, 0, 0, false);
  ground.rotation.x = -Math.PI / 2;
  const scorch = add(new THREE.PlaneGeometry(4.2, 4.2), track(new THREE.MeshStandardMaterial({ map: scorchTex(), transparent: true, depthWrite: false, roughness: 1, polygonOffset: true, polygonOffsetFactor: -2 })), 0, 0.01, 0, 0, false);
  scorch.rotation.x = -Math.PI / 2;
  // tufos de grama (instâncias), longe da fogueira e das barracas
  {
    const blade = new THREE.ConeGeometry(0.035, 0.42, 3); blade.translate(0, 0.21, 0);
    const parts = [];
    for (let i = 0; i < 7; i++) { const b = blade.clone(); b.rotateZ((Math.random() - 0.5) * 0.7); b.rotateY((i / 7) * Math.PI * 2); b.translate((Math.random() - 0.5) * 0.12, 0, (Math.random() - 0.5) * 0.12); parts.push(b); }
    const tuft = mergeGeometries(parts); parts.forEach((p) => p.dispose()); blade.dispose();
    const gm = track(new THREE.MeshStandardMaterial({ color: 0x4f5634, roughness: 0.9 }));
    const count = lowPower ? 160 : 360;
    const inst = new THREE.InstancedMesh(tuft, gm, count);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), c = new THREE.Color();
    let n = 0;
    while (n < count) {
      const a = Math.random() * Math.PI * 2, d = 3.2 + Math.pow(Math.random(), 0.7) * 16;
      p.set(Math.cos(a) * d, 0, Math.sin(a) * d);
      if (Math.abs(p.x) < 8 && p.z < -2.5 && p.z > -9) continue; // área das barracas
      if (tentSpecs.some(([tx, tz]) => Math.hypot(p.x - tx, p.z - tz) < 2.6)) continue;
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.random() * 6.28);
      s.setScalar(0.6 + Math.random() * 0.9); s.y *= 0.7 + Math.random() * 0.8;
      inst.setMatrixAt(n, m4.compose(p, q, s));
      inst.setColorAt(n, c.setHSL(0.17 + Math.random() * 0.06, 0.25 + Math.random() * 0.2, 0.18 + Math.random() * 0.12));
      n++;
    }
    inst.receiveShadow = true;
    scene.add(inst);
  }

  // ----- fogueira -----
  const stoneMat = track(new THREE.MeshStandardMaterial({ color: 0x3f3b37, roughness: 0.95, bumpMap: dirtBump(), bumpScale: 0.8 }));
  for (let i = 0; i < 11; i++) {
    const a = (i / 11) * Math.PI * 2 + Math.random() * 0.1;
    const st = add(track(rockGeo(i * 3.7, 0.12 + Math.random() * 0.05)), stoneMat, Math.cos(a) * 0.74, 0.05, Math.sin(a) * 0.74, Math.random() * 6);
    st.material = stoneMat;
  }
  const logMat = track(new THREE.MeshStandardMaterial({ map: PIX.bark(), roughness: 0.95, color: 0x9a8a78 }));
  const charMat = track(new THREE.MeshStandardMaterial({ color: 0x1a120c, roughness: 1, emissive: 0xff4a10, emissiveIntensity: 0.0 }));
  const logGeo = track(new THREE.BoxGeometry(0.120, 0.95, 0.120));
  for (let i = 0; i < 5; i++) { // lenha em pirâmide aberta, encostada no centro
    const a = (i / 5) * Math.PI * 2 + 0.3;
    const log = add(logGeo, logMat, Math.cos(a) * 0.36, 0.26, Math.sin(a) * 0.36);
    log.lookAt(0, 0.7, 0); log.rotateX(Math.PI / 2);
  }
  for (const a of [0.4, 2.1]) { // toras deitadas na base, meio queimadas
    const log = add(track(new THREE.BoxGeometry(0.160, 0.9, 0.160)), logMat, 0, 0.07, 0, a);
    log.rotation.z = Math.PI / 2;
  }
  const embers = add(track(new THREE.BoxGeometry(0.8, 0.5, 0.8)), charMat, 0, -0.02, 0, 0, false);
  embers.scale.y = 0.28;
  const emberGlow = track(new THREE.MeshBasicMaterial({ color: 0xff5a14, transparent: true, opacity: 0.85 }));
  for (let i = 0; i < 14; i++) { const a = Math.random() * 6.28, r = Math.random() * 0.3; const e = add(P_EMBER(), emberGlow, Math.cos(a) * r, 0.06 + Math.random() * 0.05, Math.sin(a) * r, Math.random() * 6, false); e.scale.setScalar(0.5 + Math.random()); }
  // chamas: cartões cruzados com textura (animados)
  const flameMat = track(new THREE.MeshBasicMaterial({ map: flameTex(), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false }));
  const flames = [];
  const flameGeo = track(new THREE.PlaneGeometry(0.95, 1.55)); flameGeo.translate(0, 0.72, 0);
  for (let i = 0; i < 5; i++) {
    const f = add(flameGeo, flameMat, (Math.random() - 0.5) * 0.18, 0.05, (Math.random() - 0.5) * 0.18, (i / 5) * Math.PI, false);
    f.renderOrder = 3;
    flames.push({ m: f, ph: Math.random() * 10, s: 0.7 + Math.random() * 0.45 });
  }
  // faíscas
  const SPARKS = lowPower ? 28 : 60;
  const sparkGeo = new THREE.BufferGeometry();
  const sp = new Float32Array(SPARKS * 3), sv = [];
  for (let i = 0; i < SPARKS; i++) { sv.push({ life: Math.random() * 2, vx: 0, vy: 0, vz: 0 }); sp[i * 3 + 1] = -10; }
  sparkGeo.setAttribute('position', new THREE.BufferAttribute(sp, 3));
  const sparks = new THREE.Points(track(sparkGeo), track(new THREE.PointsMaterial({ color: 0xffb04a, size: 0.05, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })));
  scene.add(sparks);
  // fumaça
  const smokeMat = track(new THREE.SpriteMaterial({ map: smokeTex(), transparent: true, depthWrite: false, color: 0x8a8580, opacity: 0.35 }));
  const smoke = [];
  for (let i = 0; i < (lowPower ? 4 : 8); i++) { const s = new THREE.Sprite(smokeMat.clone()); track(s.material); s.userData.t = i / 8; scene.add(s); smoke.push(s); }

  // ----- barracas -----
  const ropeMat = track(new THREE.LineBasicMaterial({ color: 0x8a7a5a }));
  const poleMat = track(new THREE.MeshStandardMaterial({ color: 0x3a3a38, roughness: 0.5, metalness: 0.6 }));
  for (const [x, z, ry, col, w, d, h] of tentSpecs) {
    const tm = track(new THREE.MeshStandardMaterial({ map: canvasClothTex('tent' + col, col), roughness: 0.93, side: THREE.DoubleSide }));
    const tent = add(track(ridgeTentGeo(w, d, h)), tm, x, 0, z, ry);
    // escuro dentro da abertura da frente
    const holeGeo = track(new THREE.BufferGeometry());
    holeGeo.setAttribute('position', new THREE.Float32BufferAttribute([-w * 0.09, 0.01, 0, w * 0.09, 0.01, 0, 0, h * 0.97, 0], 3));
    const inside = new THREE.Mesh(holeGeo, track(new THREE.MeshBasicMaterial({ color: 0x050403, side: THREE.DoubleSide })));
    inside.position.z = d / 2 - 0.04; tent.add(inside);
    // mastros e cordas com estacas
    for (const sz of [-1, 1]) {
      const pole = new THREE.Mesh(track(new THREE.BoxGeometry(0.050, h + 0.12, 0.050)), poleMat);
      pole.position.set(0, (h + 0.12) / 2, (sz * d) / 2 + sz * 0.03); pole.castShadow = true; tent.add(pole);
      const pts = [new THREE.Vector3(0, h + 0.08, (sz * d) / 2 + sz * 0.03), new THREE.Vector3(0, 0.02, (sz * d) / 2 + sz * 1.1)];
      tent.add(new THREE.Line(track(new THREE.BufferGeometry().setFromPoints(pts)), ropeMat));
      const stake = new THREE.Mesh(track(new THREE.BoxGeometry(0.040, 0.25, 0.040)), poleMat);
      stake.position.copy(pts[1]); stake.position.y = 0.08; stake.rotation.x = sz * 0.3; tent.add(stake);
    }
  }

  // ----- muro de sacos de areia (2 fiadas, desencontradas) -----
  {
    const bagMat = track(new THREE.MeshStandardMaterial({ map: PIX.sandbag(), roughness: 0.97, color: 0xc8bca0 }));
    const bag = track(sandbagGeo());
    const parts = [];
    for (let row = 0; row < 3; row++) for (let i = 0; i < 9 - row; i++) {
      const g = bag.clone();
      g.rotateY((Math.random() - 0.5) * 0.12);
      g.translate(-4.2 + i * 0.62 + row * 0.31 + (Math.random() - 0.5) * 0.04, row * 0.19, -8.6 + (Math.random() - 0.5) * 0.06);
      parts.push(g);
    }
    for (let row = 0; row < 2; row++) for (let i = 0; i < 5 - row; i++) { // trecho curvo lateral
      const g = bag.clone(); const a = 0.9 + i * 0.16;
      g.rotateY(-a);
      g.translate(6.6 + Math.cos(a) * 2.2 * (i / 4), row * 0.19, -7.2 + i * 0.55);
      parts.push(g);
    }
    const wall = add(track(mergeGeometries(parts)), bagMat, 0, 0, 0);
    parts.forEach((p) => p.dispose());
    wall.castShadow = true;
  }

  // ----- caixotes e tambores -----
  const crateMat = track(new THREE.MeshStandardMaterial({ map: PIX.crate(), roughness: 0.85 }));
  const olive = track(new THREE.MeshStandardMaterial({ map: PIX.military(), roughness: 0.7, metalness: 0.35 }));
  add(track(new THREE.BoxGeometry(0.9, 0.9, 0.9)), crateMat, 3.3, 0.45, 1.6, 0.35);
  add(track(new THREE.BoxGeometry(0.7, 0.7, 0.7)), crateMat, 3.3, 1.25, 1.55, 0.1);
  add(track(new THREE.BoxGeometry(1.3, 0.55, 0.62)), olive, 3.9, 0.275, 3.0, -0.25); // caixa de munição
  const drumMat = [track(new THREE.MeshStandardMaterial({ map: PIX.rustBarrel(), color: 0xd08070, roughness: 0.65, metalness: 0.45 })), track(new THREE.MeshStandardMaterial({ map: PIX.rustBarrel(), color: 0x7090b0, roughness: 0.65, metalness: 0.45 }))];
  const drum = track(drumGeo());
  add(drum, drumMat[0], -3.4, 0, 2.6, 0.4);
  add(drum, drumMat[1], -2.85, 0, 3.1, 1.1);
  const tipped = add(drum, drumMat[0], 5.6, 0.29, 0.4, 0); tipped.rotation.z = Math.PI / 2; tipped.position.x += 0.44;
  // tronco para sentar
  const seat = add(track(new THREE.BoxGeometry(0.500, 2.1, 0.500)), logMat, -1.9, 0.22, 1.7, 0.55);
  seat.rotation.z = Math.PI / 2;
  // lampião aceso sobre o caixote (brilha com o bloom)
  const lantern = new THREE.Group();
  lantern.add(new THREE.Mesh(track(new THREE.BoxGeometry(0.160, 0.04, 0.160)), poleMat));
  const glass = new THREE.Mesh(track(new THREE.BoxGeometry(0.110, 0.14, 0.110)), track(new THREE.MeshBasicMaterial({ color: 0xffc46a })));
  glass.position.y = 0.09; lantern.add(glass);
  const cap = new THREE.Mesh(track(new THREE.ConeGeometry(0.075, 0.07, 10)), poleMat); cap.position.y = 0.19; lantern.add(cap);
  lantern.position.set(3.25, 1.6, 1.5); scene.add(lantern);
  const lanternLight = new THREE.PointLight(0xffb45a, 4, 6, 2); lanternLight.position.set(3.25, 1.75, 1.5); scene.add(lanternLight);

  // ----- cerca de alambrado com arame farpado ao fundo -----
  {
    const fm = track(new THREE.MeshStandardMaterial({ map: fenceTex(), transparent: true, alphaTest: 0.4, side: THREE.DoubleSide, metalness: 0.6, roughness: 0.5, color: 0x9a9a9a }));
    fm.map.repeat.set(34, 2.8); fm.map.colorSpace = THREE.NoColorSpace;
    const fence = add(track(new THREE.PlaneGeometry(26, 2.1)), fm, 0, 1.05, -11.5, 0, false);
    fence.castShadow = false;
    for (let i = 0; i <= 8; i++) add(track(new THREE.BoxGeometry(0.080, 2.5, 0.080)), poleMat, -13 + i * 3.25, 1.25, -11.5);
    const wire = [];
    for (let i = 0; i <= 160; i++) { const x = -13 + i * 0.1625; wire.push(new THREE.Vector3(x, 2.35 + Math.sin(i * 1.7) * 0.03, -11.5 + Math.cos(i * 1.7) * 0.05)); }
    scene.add(new THREE.Line(track(new THREE.BufferGeometry().setFromPoints(wire)), track(new THREE.LineBasicMaterial({ color: 0x77736c }))));
  }

  // ----- varal de lâmpadas entre mastros -----
  {
    const a = new THREE.Vector3(-6.5, 2.7, -2.2), b = new THREE.Vector3(5.5, 2.7, -2.6);
    for (const p of [a, b]) add(track(new THREE.BoxGeometry(0.120, p.y, 0.120)), logMat, p.x, p.y / 2, p.z);
    const pts = [];
    for (let i = 0; i <= 30; i++) { const t = i / 30; const p = a.clone().lerp(b, t); p.y -= Math.sin(t * Math.PI) * 0.55; pts.push(p); }
    scene.add(new THREE.Line(track(new THREE.BufferGeometry().setFromPoints(pts)), track(new THREE.LineBasicMaterial({ color: 0x1a1a1a }))));
    const bulbMat = track(new THREE.MeshBasicMaterial({ color: 0xffd08a }));
    const bulbGeo = track(new THREE.BoxGeometry(0.08, 0.08, 0.08));
    for (let i = 2; i < 30; i += 3) { const p = pts[i]; const bm = new THREE.Mesh(bulbGeo, bulbMat); bm.position.set(p.x, p.y - 0.06, p.z); scene.add(bm); }
  }

  // ----- ruínas ao fundo (silhuetas com janelas, na neblina) -----
  {
    const wt = windowsTex();
    const wm = track(new THREE.MeshStandardMaterial({ map: wt.map, roughness: 0.95, emissiveMap: wt.emi, emissive: 0xffffff, emissiveIntensity: 0.7 }));
    // horizonte baixo e contínuo: os prédios ficam na faixa enevoada do céu (sem "blocos flutuando")
    for (let i = 0; i < 13; i++) {
      const h = 5 + Math.random() * 7, w = 6 + Math.random() * 5, dpt = 4 + Math.random() * 3;
      const geo = track(new THREE.BoxGeometry(w, h, dpt));
      const uvs = geo.attributes.uv; for (let k = 0; k < uvs.count; k++) uvs.setXY(k, uvs.getX(k) * w / 6, uvs.getY(k) * h / 8);
      const b = add(geo, wm, -44 + i * 7.4 + Math.random() * 1.5, h / 2, -34 - Math.random() * 8, (Math.random() - 0.5) * 0.3, false);
      if (Math.random() < 0.5) { // topo desmoronado
        const chunk = add(track(new THREE.BoxGeometry(w * 0.5, 1.4, dpt * 0.8)), wm, b.position.x + w * 0.2, h + 0.4, b.position.z, 0.3, false);
        chunk.rotation.z = 0.35;
      }
    }
  }

  // ----- céu estrelado -----
  {
    const N = 700, pos = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) { const a = Math.random() * 6.28, e = 0.15 + Math.random() * 1.2, r = 90; pos[i * 3] = Math.cos(a) * Math.cos(e) * r; pos[i * 3 + 1] = Math.sin(e) * r; pos[i * 3 + 2] = Math.sin(a) * Math.cos(e) * r; }
    const sg = track(new THREE.BufferGeometry()); sg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    scene.add(new THREE.Points(sg, track(new THREE.PointsMaterial({ color: 0xc8d0e0, size: 0.35, sizeAttenuation: true, fog: false, transparent: true, opacity: 0.8 }))));
  }

  let t = 0;
  const sparkPos = sparkGeo.attributes.position;
  return {
    scene, fire,
    update(dt) {
      t += dt;
      const f = 0.82 + Math.sin(t * 11) * 0.07 + Math.sin(t * 27 + 1.3) * 0.05 + Math.sin(t * 4.1) * 0.06;
      fire.intensity = 30 * f;
      fire.position.x = Math.sin(t * 7) * 0.05; fire.position.z = Math.cos(t * 5) * 0.05;
      charMat.emissiveIntensity = 0.9 + Math.sin(t * 3) * 0.25;
      lanternLight.intensity = 4 + Math.sin(t * 17) * 0.25;
      for (const fl of flames) {
        const k = fl.s * (0.85 + Math.sin(t * 9 + fl.ph) * 0.12 + Math.sin(t * 23 + fl.ph * 2) * 0.06);
        fl.m.scale.set(k * (0.9 + Math.sin(t * 13 + fl.ph) * 0.1), k * (1 + Math.sin(t * 7 + fl.ph) * 0.18), 1);
        fl.m.rotation.y += dt * 0.4;
      }
      // faíscas sobem com o calor e apagam
      for (let i = 0; i < SPARKS; i++) {
        const s = sv[i];
        s.life -= dt;
        if (s.life <= 0) {
          s.life = 0.8 + Math.random() * 1.6;
          sparkPos.setXYZ(i, (Math.random() - 0.5) * 0.3, 0.4, (Math.random() - 0.5) * 0.3);
          s.vx = (Math.random() - 0.5) * 0.5; s.vy = 1.2 + Math.random() * 1.6; s.vz = (Math.random() - 0.5) * 0.5;
        }
        s.vx += Math.sin(t * 3 + i) * dt * 0.6;
        sparkPos.setXYZ(i, sparkPos.getX(i) + s.vx * dt, sparkPos.getY(i) + s.vy * dt, sparkPos.getZ(i) + s.vz * dt);
      }
      sparkPos.needsUpdate = true;
      // fumaça: sobe, cresce e some
      for (const s of smoke) {
        s.userData.t = (s.userData.t + dt * 0.12) % 1;
        const k = s.userData.t;
        s.position.set(Math.sin(k * 5 + s.id) * 0.3 + k * 0.8, 1.2 + k * 5, -k * 0.5);
        s.scale.setScalar(0.8 + k * 3.2);
        s.material.opacity = Math.sin(k * Math.PI) * 0.32;
        s.material.rotation += dt * 0.1;
      }
    },
    dispose() {
      for (const d of disposables) d.dispose?.();
      scene.traverse((o) => { if (o.geometry && !disposables.includes(o.geometry)) o.geometry.dispose(); });
    },
  };
}
// brasa pequena (geometria compartilhada)
let emberGeo = null;
function P_EMBER() { return emberGeo || (emberGeo = new THREE.BoxGeometry(0.05, 0.05, 0.05)); }

// ============================================================
//  Peças reutilizáveis no mapa (world.js): chamas e fogueira
// ============================================================
// Chamas: cartões cruzados com textura de fogo (aditivos), animados.
export function makeFlames(n = 4, size = 1) {
  const group = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({ map: flameTex(), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false });
  const geo = new THREE.PlaneGeometry(0.95 * size, 1.55 * size);
  geo.translate(0, 0.72 * size, 0);
  const cards = [];
  for (let i = 0; i < n; i++) {
    const m = new THREE.Mesh(geo, mat);
    m.rotation.y = (i / n) * Math.PI;
    m.position.set((Math.random() - 0.5) * 0.18 * size, 0, (Math.random() - 0.5) * 0.18 * size);
    m.renderOrder = 3;
    group.add(m);
    cards.push({ m, ph: Math.random() * 10, s: 0.7 + Math.random() * 0.45 });
  }
  return {
    group,
    update(t, dt) {
      for (const c of cards) {
        const k = c.s * (0.85 + Math.sin(t * 9 + c.ph) * 0.12 + Math.sin(t * 23 + c.ph * 2) * 0.06);
        c.m.scale.set(k * (0.9 + Math.sin(t * 13 + c.ph) * 0.1), k * (1 + Math.sin(t * 7 + c.ph) * 0.18), 1);
        c.m.rotation.y += dt * 0.4;
      }
    },
    dispose() { geo.dispose(); mat.dispose(); },
  };
}
// Fogueira completa: anel de pedras, lenha em pirâmide, brasas e chamas.
export function makeFirePit(scale = 1) {
  const group = new THREE.Group();
  const own = [];
  const keep = (x) => { own.push(x); return x; };
  const stoneMat = keep(new THREE.MeshStandardMaterial({ color: 0x3f3b37, roughness: 0.95, bumpMap: dirtBump(), bumpScale: 0.8 }));
  for (let i = 0; i < 11; i++) {
    const a = (i / 11) * Math.PI * 2 + Math.random() * 0.1;
    const st = new THREE.Mesh(keep(rockGeo(i * 3.7, 0.12 + Math.random() * 0.05)), stoneMat);
    st.position.set(Math.cos(a) * 0.74, 0.05, Math.sin(a) * 0.74); st.rotation.y = Math.random() * 6;
    st.castShadow = st.receiveShadow = true; group.add(st);
  }
  const logMat = keep(new THREE.MeshStandardMaterial({ map: PIX.bark(), roughness: 0.95, color: 0x9a8a78 }));
  const logGeo = keep(new THREE.BoxGeometry(0.120, 0.95, 0.120));
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + 0.3;
    const log = new THREE.Mesh(logGeo, logMat);
    log.position.set(Math.cos(a) * 0.36, 0.26, Math.sin(a) * 0.36);
    log.lookAt(0, 0.7, 0); log.rotateX(Math.PI / 2);
    log.castShadow = true; group.add(log);
  }
  const charMat = keep(new THREE.MeshStandardMaterial({ color: 0x1a120c, roughness: 1, emissive: 0xff4a10, emissiveIntensity: 1 }));
  const embers = new THREE.Mesh(keep(new THREE.BoxGeometry(0.8, 0.5, 0.8)), charMat);
  embers.scale.y = 0.28; embers.position.y = -0.02; group.add(embers);
  const flames = makeFlames(5, 1);
  flames.group.position.y = 0.05;
  group.add(flames.group);
  group.scale.setScalar(scale);
  return {
    group,
    update(t, dt) { flames.update(t, dt); charMat.emissiveIntensity = 0.9 + Math.sin(t * 3) * 0.25; },
    dispose() { flames.dispose(); own.forEach((x) => x.dispose()); },
  };
}

// Relevo fino de asfalto/concreto (grão, pedriscos e microfissuras), em mosaico.
export function asphaltBump(repeat = 60) {
  const t = canvasTex('asphaltBump', 256, (g, s) => {
    g.fillStyle = '#808080'; g.fillRect(0, 0, s, s);
    speckle(g, s, 14000, 0.55); speckle(g, s, 9000, 0.55, false);
    blotches(g, s, 26, ['rgba(150,150,150,0.25)', 'rgba(60,60,60,0.25)'], 10, 36);
    g.strokeStyle = 'rgba(30,30,30,0.6)'; g.lineWidth = 1.2;
    for (let i = 0; i < 7; i++) { // microfissuras
      let x = Math.random() * s, y = Math.random() * s;
      g.beginPath(); g.moveTo(x, y);
      for (let k = 0; k < 6; k++) { x += (Math.random() - 0.5) * 30; y += (Math.random() - 0.5) * 30; g.lineTo(x, y); }
      g.stroke();
    }
  }, { srgb: false }).clone();
  t.repeat.set(repeat, repeat);
  t.needsUpdate = true;
  return t;
}
