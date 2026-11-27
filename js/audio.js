// ============================================================
//  ÁUDIO — síntese procedural mais natural (WebAudio, sem arquivos)
//  · tiros em camadas: estalo + corpo + grave + eco/reverb externo
//  · lâminas com "whoosh" e brilho metálico, impactos carnudos
//  · grunhidos de zumbi com formantes e vibrato
//  · ambientação por mapa: vento, drone, eventos distantes, fogueira
// ============================================================
let ctx = null, master = null, sfxBus = null, ambBus = null, musicBus = null, reverbIn = null, echoIn = null;
let white = null, brown = null, pink = null;
let muted = localStorage.getItem('zonamorta.muted') === '1';
const VOL = 0.6;
// Volumes por canal (salvos no navegador)
const vol = Object.assign({ master: 0.85, music: 0.45, sfx: 0.9, amb: 0.7 }, JSON.parse(localStorage.getItem('zonamorta.vol') || '{}'));
export function getVolumes() { return { ...vol }; }
export function setVolume(kind, v) {
  vol[kind] = Math.max(0, Math.min(1, v));
  localStorage.setItem('zonamorta.vol', JSON.stringify(vol));
  if (!ctx) return;
  const t = ctx.currentTime;
  if (kind === 'master') master.gain.setTargetAtTime(muted ? 0 : VOL * vol.master, t, 0.03);
  if (kind === 'sfx') sfxBus.gain.setTargetAtTime(vol.sfx, t, 0.03);
  if (kind === 'amb') ambBus.gain.setTargetAtTime(vol.amb, t, 0.03);
  if (kind === 'music') musicBus.gain.setTargetAtTime(vol.music * 0.5, t, 0.03);
}

// ---------- sons personalizados (opcional) ----------
// sounds/manifest.json: { "zombie_say": ["z1.ogg","z2.ogg"], "player_hurt": ["oof.ogg"], ... }
const samples = {};
async function loadSamples() {
  try {
    const r = await fetch('sounds/manifest.json', { cache: 'no-store' });
    if (!r.ok) return;
    const man = await r.json();
    for (const [ev, files] of Object.entries(man)) {
      if (ev.startsWith('_')) continue;
      samples[ev] = [];
      for (const f of [].concat(files)) {
        try { const buf = await (await fetch('sounds/' + f)).arrayBuffer(); samples[ev].push(await ctx.decodeAudioData(buf)); }
        catch (e) { console.warn('[sons] falha', f, e); }
      }
    }
  } catch {}
}
function playSample(ev, { gain = 1, pan = 0, rate = 1, rev = 0 } = {}) {
  const list = samples[ev];
  if (!list || !list.length) return false;
  const src = ctx.createBufferSource();
  src.buffer = list[(Math.random() * list.length) | 0];
  src.playbackRate.value = rate * (0.95 + Math.random() * 0.1);
  src.connect(out({ gain, pan, rev }));
  src.start();
  return true;
}
const last = {};
let pendingAmb = null;
let amb = null;

export function initAudio() {
  if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
  try {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
  } catch { ctx = null; return; }
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -14; comp.knee.value = 12; comp.ratio.value = 4; comp.attack.value = 0.003; comp.release.value = 0.25;
  master = ctx.createGain();
  master.gain.value = muted ? 0 : VOL * vol.master;
  master.connect(comp); comp.connect(ctx.destination);
  sfxBus = ctx.createGain(); sfxBus.gain.value = vol.sfx; sfxBus.connect(master);
  ambBus = ctx.createGain(); ambBus.gain.value = vol.amb; ambBus.connect(master);
  musicBus = ctx.createGain(); musicBus.gain.value = vol.music * 0.5; musicBus.connect(master);

  // ruídos base
  const len = ctx.sampleRate * 3;
  white = ctx.createBuffer(2, len, ctx.sampleRate);
  brown = ctx.createBuffer(2, len, ctx.sampleRate);
  pink = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const w = white.getChannelData(ch), b = brown.getChannelData(ch), p = pink.getChannelData(ch);
    let lb = 0, b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < len; i++) {
      const x = Math.random() * 2 - 1;
      w[i] = x;
      lb = (lb + 0.02 * x) / 1.02; b[i] = lb * 3.5;
      b0 = 0.99765 * b0 + x * 0.099; b1 = 0.963 * b1 + x * 0.2965; b2 = 0.57 * b2 + x * 1.0526;
      p[i] = (b0 + b1 + b2 + x * 0.1848) * 0.18;
    }
  }

  // reverb externo (resposta ao impulso sintética)
  const irLen = Math.floor(ctx.sampleRate * 2.6);
  const ir = ctx.createBuffer(2, irLen, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = ir.getChannelData(ch);
    for (let i = 0; i < irLen; i++) {
      const t = i / irLen;
      d[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, 3.2) * (i < 400 ? i / 400 : 1);
    }
  }
  const conv = ctx.createConvolver();
  conv.buffer = ir;
  const revLP = ctx.createBiquadFilter(); revLP.type = 'lowpass'; revLP.frequency.value = 3200;
  const revOut = ctx.createGain(); revOut.gain.value = 0.55;
  reverbIn = ctx.createGain();
  reverbIn.connect(conv); conv.connect(revLP); revLP.connect(revOut); revOut.connect(sfxBus);

  // eco de prédios (slapback)
  echoIn = ctx.createGain();
  const dl = ctx.createDelay(1.0); dl.delayTime.value = 0.21;
  const fb = ctx.createGain(); fb.gain.value = 0.28;
  const eLP = ctx.createBiquadFilter(); eLP.type = 'lowpass'; eLP.frequency.value = 1400;
  const eOut = ctx.createGain(); eOut.gain.value = 0.35;
  echoIn.connect(dl); dl.connect(eLP); eLP.connect(fb); fb.connect(dl); eLP.connect(eOut); eOut.connect(sfxBus);

  loadSamples();
  if (pendingAmb) { const a = pendingAmb; pendingAmb = null; startAmbience(a); }
  if (pendingMusic) { const m = pendingMusic; pendingMusic = null; startMusic(m); }
}

export function toggleMute() {
  muted = !muted;
  localStorage.setItem('zonamorta.muted', muted ? '1' : '0');
  if (master) master.gain.setTargetAtTime(muted ? 0 : VOL * vol.master, ctx.currentTime, 0.05);
  return muted;
}
export const isMuted = () => muted;

function throttle(name, ms) {
  const now = performance.now();
  if (last[name] && now - last[name] < ms) return true;
  last[name] = now;
  return false;
}
const rnd = (a, b) => a + Math.random() * (b - a);

// ---------- blocos de construção ----------
// Saída com pan/volume opcionais e envios para reverb/eco
function out({ gain = 1, pan = 0, rev = 0, echo = 0, bus = sfxBus } = {}) {
  const g = ctx.createGain();
  g.gain.value = gain;
  let node = g;
  if (pan && ctx.createStereoPanner) {
    const p = ctx.createStereoPanner(); p.pan.value = Math.max(-1, Math.min(1, pan));
    g.connect(p); node = p;
  }
  node.connect(bus);
  if (rev) { const s = ctx.createGain(); s.gain.value = rev; node.connect(s); s.connect(reverbIn); }
  if (echo) { const s = ctx.createGain(); s.gain.value = echo; node.connect(s); s.connect(echoIn); }
  return g;
}
function env(g, t, a, peak, d, curve = 'exp') {
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(peak, t + a);
  if (curve === 'exp') g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
  else g.gain.linearRampToValueAtTime(0, t + a + d);
}
function noise(dest, { buf = white, t = ctx.currentTime, dur = 0.2, a = 0.001, peak = 1, type = 'lowpass', f = 1000, f2 = null, q = 0.7, rate = 1 } = {}) {
  const s = ctx.createBufferSource();
  s.buffer = buf; s.playbackRate.value = rate;
  const fl = ctx.createBiquadFilter();
  fl.type = type; fl.Q.value = q;
  fl.frequency.setValueAtTime(f, t);
  if (f2) fl.frequency.exponentialRampToValueAtTime(f2, t + a + dur);
  const g = ctx.createGain();
  env(g, t, a, peak, dur);
  s.connect(fl); fl.connect(g); g.connect(dest);
  s.start(t, Math.random() * 2); s.stop(t + a + dur + 0.05);
  return fl;
}
function osc(dest, { type = 'sine', t = ctx.currentTime, f = 220, f2 = null, dur = 0.3, a = 0.005, peak = 0.3, slide = null } = {}) {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(f, t);
  if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + (slide || dur));
  const g = ctx.createGain();
  env(g, t, a, peak, dur);
  o.connect(g); g.connect(dest);
  o.start(t); o.stop(t + a + dur + 0.05);
  return o;
}
let distCurve = null;
function distortion() {
  if (!distCurve) {
    distCurve = new Float32Array(1024);
    for (let i = 0; i < 1024; i++) { const x = (i / 1023) * 2 - 1; distCurve[i] = Math.tanh(x * 3); }
  }
  const ws = ctx.createWaveShaper(); ws.curve = distCurve; ws.oversample = '2x';
  return ws;
}

// ---------- tiros ----------
const GUNS = {
  pistola:  { crack: 0.7, body: 1800, bodyDur: 0.11, thump: 140, thumpPeak: 0.5, rev: 0.35, echo: 0.3, gain: 0.8 },
  smg:      { crack: 0.5, body: 2300, bodyDur: 0.07, thump: 170, thumpPeak: 0.3, rev: 0.22, echo: 0.18, gain: 0.55 },
  escopeta: { crack: 0.9, body: 1100, bodyDur: 0.28, thump: 90,  thumpPeak: 0.9, rev: 0.6, echo: 0.5, gain: 1.0, pump: true },
  fuzil:    { crack: 0.9, body: 2000, bodyDur: 0.12, thump: 120, thumpPeak: 0.55, rev: 0.4, echo: 0.35, gain: 0.75 },
  precisao: { crack: 1.2, body: 1500, bodyDur: 0.3, thump: 70,  thumpPeak: 1.0, rev: 0.8, echo: 0.6, gain: 1.0, bolt: true },
};
function gunshot(kind, pan = 0) {
  const G = GUNS[kind] || GUNS.pistola;
  const t = ctx.currentTime, v = rnd(0.94, 1.06);
  const o = out({ gain: G.gain, pan, rev: G.rev, echo: G.echo });
  // estalo supersônico (transiente)
  noise(o, { t, dur: 0.018, peak: G.crack, type: 'highpass', f: 3000 * v, q: 0.5 });
  // Primeiro impulso seco e breve ruído mecânico dão ataque ao disparo.
  noise(o, { t, dur: 0.006, peak: 0.45, type: 'bandpass', f: 4200 * v, q: 0.8 });
  // corpo da explosão do cartucho
  noise(o, { t, dur: G.bodyDur, peak: 1.1, type: 'lowpass', f: G.body * v, f2: G.body * 0.25, q: 1.2 });
  noise(o, { t, dur: G.bodyDur * 0.6, peak: 0.5, type: 'bandpass', f: 700 * v, q: 1.5 });
  // pressão grave
  osc(o, { t, type: 'sine', f: G.thump * v, f2: 38, dur: 0.18, peak: G.thumpPeak, slide: 0.14 });
  // cauda (ruído rosa abafado)
  noise(o, { buf: pink, t: t + 0.01, dur: G.bodyDur * 2.5, a: 0.01, peak: 0.25, type: 'lowpass', f: 900, f2: 200 });
  if (G.pump) { mech(t + 0.42, pan, 0.5); mech(t + 0.56, pan, 0.6, 1800); }
  if (G.bolt) { mech(t + 0.5, pan, 0.4, 2600); mech(t + 0.7, pan, 0.5, 1600); }
  // cápsula caindo no chão
  if (Math.random() < 0.7) shell(t + rnd(0.25, 0.4), pan);
}
function mech(t, pan, peak = 0.4, f = 2200) {
  const o = out({ gain: 0.5, pan, rev: 0.05 });
  noise(o, { t, dur: 0.03, peak, type: 'bandpass', f, q: 6 });
  noise(o, { t: t + 0.012, dur: 0.02, peak: peak * 0.6, type: 'bandpass', f: f * 1.7, q: 8 });
}
function shell(t, pan) {
  const o = out({ gain: 0.12, pan });
  const f = rnd(5000, 7000);
  for (let i = 0; i < 3; i++) osc(o, { t: t + i * rnd(0.05, 0.08), type: 'triangle', f: f * rnd(0.9, 1.1), dur: 0.04, peak: 0.4 / (i + 1) });
}

// ---------- corpo a corpo ----------
function whoosh(pan = 0, metal = true, big = false) {
  const t = ctx.currentTime;
  const o = out({ gain: big ? 0.8 : 0.55, pan, rev: 0.08 });
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(1, t + 0.07);
  g.gain.exponentialRampToValueAtTime(0.0001, t + (big ? 0.32 : 0.22));
  g.connect(o);
  const s = ctx.createBufferSource(); s.buffer = pink;
  const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 1.6;
  bp.frequency.setValueAtTime(big ? 300 : 500, t);
  bp.frequency.exponentialRampToValueAtTime(big ? 1600 : 2600, t + 0.09);
  bp.frequency.exponentialRampToValueAtTime(big ? 500 : 900, t + 0.25);
  s.connect(bp); bp.connect(g); s.start(t, Math.random() * 2); s.stop(t + 0.4);
  if (metal) {
    // brilho metálico da lâmina
    const m = out({ gain: 0.06, pan, rev: 0.2 });
    for (const fr of [3200, 4870, 6310]) osc(m, { t: t + 0.02, type: 'sine', f: fr * rnd(0.98, 1.02), dur: 0.35, peak: 0.5, a: 0.01 });
  }
}
function fleshHit(pan = 0, heavy = false) {
  const t = ctx.currentTime;
  const o = out({ gain: heavy ? 0.9 : 0.6, pan, rev: 0.05 });
  noise(o, { t, dur: 0.07, peak: 1, type: 'lowpass', f: 1200, f2: 300 });
  noise(o, { buf: pink, t, dur: 0.12, peak: 0.6, type: 'bandpass', f: rnd(350, 550), q: 4 });
  osc(o, { t, type: 'sine', f: heavy ? 110 : 150, f2: 50, dur: 0.1, peak: 0.6 });
  noise(o, { buf: brown, t: t + 0.008, dur: heavy ? 0.12 : 0.07, peak: 0.4, type: 'lowpass', f: 420, f2: 120 });
}

// ---------- zumbis ----------
function voice(o, t, { f0, f1, dur, formants, vib = 6, vibDepth = 8, breath = 0.3, saw = 0.5, dist = false }) {
  const src = ctx.createOscillator();
  src.type = 'sawtooth';
  src.frequency.setValueAtTime(f0, t);
  src.frequency.linearRampToValueAtTime(f1, t + dur);
  const lfo = ctx.createOscillator(); lfo.frequency.value = vib * rnd(0.8, 1.2);
  const lfoG = ctx.createGain(); lfoG.gain.value = vibDepth;
  lfo.connect(lfoG); lfoG.connect(src.frequency);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(saw, t + dur * 0.2);
  g.gain.linearRampToValueAtTime(saw * 0.7, t + dur * 0.7);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  let node = src;
  if (dist) { const d = distortion(); src.connect(d); node = d; }
  const mix = ctx.createGain(); mix.gain.value = 1;
  for (const [ff, q, gg] of formants) {
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = ff * rnd(0.92, 1.08); bp.Q.value = q;
    const fg = ctx.createGain(); fg.gain.value = gg;
    node.connect(bp); bp.connect(fg); fg.connect(mix);
  }
  mix.connect(g); g.connect(o);
  src.start(t); lfo.start(t); src.stop(t + dur + 0.05); lfo.stop(t + dur + 0.05);
  if (breath) noise(o, { buf: pink, t, dur, a: dur * 0.3, peak: breath, type: 'bandpass', f: 900, q: 1.2 });
}
// Voz de zumbi: dente-de-serra grave + "vocal fry" (modulação de amplitude
// áspera ~30 Hz) + formantes de vogal fechada ("uhh"/"ohh") + leve distorção.
// Abafada em passa-baixa para soar grave e gutural.
function zvoice(o, t, { f = 70, dur = 1.1, contour = [0.9, 1.15, 0.8], fry = 32, fryDepth = 0.65, vowel = 'u', syll = 2, noiseAmt = 0.25, bright = 1700 }) {
  const V = { u2: [[300, 6, 1], [690, 7, 0.65], [1250, 9, 0.25], [2200, 10, 0.08]], u: [[380, 7, 1], [860, 9, 0.5], [2300, 10, 0.12]], o: [[450, 6, 1], [800, 8, 0.6], [2500, 10, 0.1]], a: [[700, 5, 1], [1150, 7, 0.6], [2600, 9, 0.15]], e: [[520, 6, 1], [1650, 8, 0.45], [2500, 10, 0.15]] }[vowel];
  const src = ctx.createOscillator(); src.type = 'sawtooth';
  src.frequency.setValueAtTime(f * contour[0], t);
  src.frequency.linearRampToValueAtTime(f * contour[1], t + dur * 0.28);
  src.frequency.linearRampToValueAtTime(f * contour[2], t + dur);
  // instabilidade da voz (tremor irregular)
  const jit = ctx.createOscillator(); jit.type = 'sine'; jit.frequency.value = rnd(5, 9);
  const jitG = ctx.createGain(); jitG.gain.value = f * 0.035; jit.connect(jitG); jitG.connect(src.frequency);
  jit.start(t); jit.stop(t + dur + 0.05);
  const sub = ctx.createOscillator(); sub.type = 'sine'; sub.frequency.setValueAtTime(f * 0.5 * contour[0], t);
  sub.frequency.linearRampToValueAtTime(f * 0.5 * contour[2], t + dur);
  const subG = ctx.createGain(); subG.gain.value = 0.35;
  // vocal fry
  const fryG = ctx.createGain(); fryG.gain.value = 1 - fryDepth * 0.5;
  const lfo = ctx.createOscillator(); lfo.type = 'square'; lfo.frequency.setValueAtTime(fry * rnd(0.9, 1.1), t);
  lfo.frequency.linearRampToValueAtTime(fry * 0.7, t + dur);
  const lfoG = ctx.createGain(); lfoG.gain.value = fryDepth * 0.5;
  lfo.connect(lfoG); lfoG.connect(fryG.gain);
  const d = distortion();
  src.connect(d); sub.connect(subG); subG.connect(d); d.connect(fryG);
  const mixG = ctx.createGain();
  for (const [ff, q, gg] of V) {
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = ff * rnd(0.93, 1.07); bp.Q.value = q;
    const fg = ctx.createGain(); fg.gain.value = gg * 2.2;
    fryG.connect(bp); bp.connect(fg); fg.connect(mixG);
  }
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = bright;
  const env = ctx.createGain();
  env.gain.setValueAtTime(0.0001, t);
  if (syll >= 2) {
    env.gain.linearRampToValueAtTime(1, t + dur * 0.08);
    env.gain.linearRampToValueAtTime(0.75, t + dur * 0.38);
    env.gain.linearRampToValueAtTime(0.25, t + dur * 0.47);
    env.gain.linearRampToValueAtTime(0.9, t + dur * 0.58);
    env.gain.linearRampToValueAtTime(0.6, t + dur * 0.85);
  } else {
    env.gain.linearRampToValueAtTime(1, t + dur * 0.12);
    env.gain.linearRampToValueAtTime(0.7, t + dur * 0.7);
  }
  env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  mixG.connect(lp); lp.connect(env); env.connect(o);
  if (noiseAmt) noise(o, { buf: pink, t, dur, a: dur * 0.15, peak: noiseAmt, type: 'bandpass', f: V[0][0] * 1.4, q: 2 });
  for (const n of [src, sub, lfo]) { n.start(t); n.stop(t + dur + 0.05); }
}
function groan(dist = 10, pan = 0) {
  const vol = Math.max(0.06, 1 - dist / 30);
  if (playSample('zombie_say', { gain: 0.8 * vol, pan, rev: 0.2 })) return;
  // Gemido original de zumbi: ar rouco, duas notas graves ligadas e sem a
  // modulação quadrada que fazia o som parecer eletrônico.
  const t = ctx.currentTime, dur = rnd(1.3, 1.9);
  const o = out({ gain: 0.46 * vol, pan, rev: 0.2 + (dist / 30) * 0.5 });
  const fundamental = rnd(72, 88);
  const throat = ctx.createBiquadFilter(); throat.type = 'lowpass'; throat.Q.value = 1.2;
  throat.frequency.setValueAtTime(760, t);
  throat.frequency.linearRampToValueAtTime(420, t + dur * 0.55);
  throat.frequency.linearRampToValueAtTime(310, t + dur);
  const breath = ctx.createGain();
  env(breath, t, 0.12, 0.22, dur, 'lin');
  const rasp = noise(o, { buf: brown, t, dur, a: 0.13, peak: 0.22, type: 'bandpass', f: 520, f2: 240, q: 0.8 });
  rasp.connect(throat); throat.connect(breath); breath.connect(o);
  osc(o, { t, type: 'triangle', f: fundamental, f2: fundamental * rnd(0.66, 0.78), dur, a: 0.16, peak: 0.31 });
  osc(o, { t: t + dur * 0.14, type: 'sine', f: fundamental * 0.5, f2: fundamental * 0.34, dur: dur * 0.82, a: 0.12, peak: 0.2 });
  const wobble = ctx.createOscillator(); wobble.type = 'sine'; wobble.frequency.value = rnd(4.1, 5.7);
  const wobbleGain = ctx.createGain(); wobbleGain.gain.value = 2.5;
  const carrier = ctx.createOscillator(); carrier.type = 'sine'; carrier.frequency.value = fundamental;
  wobble.connect(wobbleGain); wobbleGain.connect(carrier.frequency);
  const vibratoEnv = ctx.createGain(); env(vibratoEnv, t, 0.3, 0.02, dur * 0.7);
  carrier.connect(vibratoEnv); vibratoEnv.connect(o);
  carrier.start(t); carrier.stop(t + dur + 0.05); wobble.start(t); wobble.stop(t + dur + 0.05);
}
function screech(pan = 0) {
  const o = out({ gain: 0.25, pan, rev: 0.3 });
  const f = rnd(220, 300);
  voice(o, ctx.currentTime, { f0: f, f1: f * 1.4, dur: 0.6, formants: [[900, 6, 1], [2200, 8, 0.7]], vib: 11, vibDepth: 20, breath: 0.5, dist: true });
}
function roar(pan = 0) {
  const o = out({ gain: 0.9, pan, rev: 0.7 });
  const t = ctx.currentTime;
  voice(o, t, { f0: 70, f1: 48, dur: 1.8, formants: [[350, 4, 1], [800, 5, 0.8], [1900, 6, 0.3]], vib: 4, vibDepth: 5, breath: 0.6, saw: 0.8, dist: true });
  noise(o, { buf: brown, t, dur: 1.6, a: 0.2, peak: 0.6, type: 'lowpass', f: 300 });
}

// ---------- explosões ----------
function boom(big = 1, pan = 0) {
  const t = ctx.currentTime;
  const o = out({ gain: 1.0, pan, rev: 0.8, echo: 0.4 });
  noise(o, { t, dur: 0.025, peak: 0.9, type: 'highpass', f: 2500 });
  noise(o, { buf: brown, t, dur: 1.2 * big, a: 0.005, peak: 1.6, type: 'lowpass', f: 1400, f2: 120, q: 0.8 });
  osc(o, { t, type: 'sine', f: 75, f2: 28, dur: 0.6 * big, peak: 1.0, slide: 0.5 });
  // detritos crepitando
  const c = out({ gain: 0.25, pan, rev: 0.3 });
  for (let i = 0; i < 10; i++) noise(c, { t: t + rnd(0.1, 0.9), dur: 0.02, peak: rnd(0.3, 1), type: 'bandpass', f: rnd(1500, 5000), q: 3 });
}

// ---------- corte de lâmina em carne ----------
function slice(heavy = false, pan = 0) {
  const t = ctx.currentTime;
  const o = out({ gain: heavy ? 1.0 : 0.8, pan, rev: 0.07 });
  // lâmina entrando (rasgo agudo descendo)
  noise(o, { t, dur: 0.07, peak: 0.9, type: 'bandpass', f: 5200, f2: 1300, q: 1.3 });
  // tecido molhado rasgando: ruído com modulação áspera
  const s0 = ctx.createBufferSource(); s0.buffer = pink;
  const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 3.5;
  bp.frequency.setValueAtTime(1300, t); bp.frequency.exponentialRampToValueAtTime(450, t + 0.2);
  const am = ctx.createGain(); am.gain.value = 0.5;
  const lfo = ctx.createOscillator(); lfo.type = 'square'; lfo.frequency.value = rnd(45, 70);
  const lg = ctx.createGain(); lg.gain.value = 0.5; lfo.connect(lg); lg.connect(am.gain);
  const e = ctx.createGain(); env(e, t + 0.01, 0.01, 1.4, heavy ? 0.24 : 0.17);
  s0.connect(bp); bp.connect(am); am.connect(e); e.connect(o);
  s0.start(t, Math.random() * 2); s0.stop(t + 0.35); lfo.start(t); lfo.stop(t + 0.35);
  // "squelch" ressonante (sangue espirrando)
  noise(o, { buf: pink, t: t + 0.02, dur: 0.16, peak: 0.9, type: 'lowpass', f: 1000, f2: 220, q: 9 });
  // impacto no corpo
  osc(o, { t, type: 'sine', f: heavy ? 105 : 135, f2: 48, dur: 0.11, peak: heavy ? 0.85 : 0.55 });
  if (heavy) for (let i = 0; i < 3; i++) noise(o, { t: t + 0.015 + i * rnd(0.012, 0.025), dur: 0.018, peak: 0.6, type: 'bandpass', f: rnd(1400, 2600), q: 9 }); // osso
}
function spurt(pan = 0) {
  const t = ctx.currentTime, o = out({ gain: 0.35, pan, rev: 0.1 });
  for (let i = 0; i < 5; i++) noise(o, { buf: pink, t: t + i * 0.13, dur: 0.1, a: 0.01, peak: 0.8 - i * 0.12, type: 'bandpass', f: rnd(2000, 3500), f2: 900, q: 2 });
}
// ---------- passos ----------
function footstep(run, theme) {
  const t = ctx.currentTime;
  const o = out({ gain: run ? 0.34 : 0.24, pan: rnd(-0.08, 0.08), rev: 0.03 });
  const r = rnd(0.85, 1.15);
  noise(o, { buf: brown, t, dur: 0.055, peak: 1.2, type: 'lowpass', f: 300 * r, q: 1 }); // calcanhar
  osc(o, { t, type: 'sine', f: 95 * r, f2: 50, dur: 0.05, peak: 0.25 });
  if (theme === 'suburb') noise(o, { t: t + 0.005, dur: 0.09, peak: 0.45, type: 'bandpass', f: 950 * r, q: 0.8 }); // terra/grama
  else noise(o, { t: t + 0.004, dur: 0.035, peak: 0.42, type: 'bandpass', f: rnd(2600, 4200), q: 1.4 }); // cascalho no asfalto
  noise(o, { t: t + 0.06, dur: 0.03, peak: 0.16, type: 'bandpass', f: 1800 * r, q: 2 }); // ponta do pé
}

// ---------- API pública ----------
export const sfx = {
  shot(kind, pan = 0) { if (!ctx || throttle('shot', 30)) return; if (playSample('shot_' + kind, { gain: 0.8, pan, rev: 0.3 })) return; gunshot(kind, pan); },
  slash(big = false) { if (!ctx || throttle('slash', 50)) return; whoosh(0, true, big); },
  swing() { if (!ctx || throttle('slash', 50)) return; whoosh(0, false); },
  hit(heavy = false) { if (!ctx || throttle('hit', 35)) return; fleshHit(0, heavy); },
  crit() { if (!ctx) return; const o = out({ gain: 0.15 }); osc(o, { type: 'triangle', f: 1400, f2: 2200, dur: 0.08, peak: 0.6 }); },
  zombie(dist = 10, pan = 0) { if (!ctx || throttle('groan', 450)) return; groan(dist, pan); },
  zombieHurt(pan = 0) {
    if (!ctx || throttle('zhurt', 140)) return;
    if (playSample('zombie_hurt', { gain: 0.7, pan })) return;
    zvoice(out({ gain: 0.45, pan, rev: 0.08 }), ctx.currentTime, { f: rnd(90, 115), dur: rnd(0.22, 0.32), contour: [1.1, 1.0, 0.75], fry: 42, vowel: 'e', syll: 1, noiseAmt: 0.4, bright: 2200 });
  },
  zombieAttack(rank = 'normal') {
    if (!ctx || throttle('zatk', 180)) return;
    const big = rank === 'boss' || rank === 'miniboss';
    zvoice(out({ gain: big ? 0.8 : 0.5, rev: 0.12 }), ctx.currentTime, { f: big ? 55 : rnd(80, 100), dur: big ? 0.6 : 0.34, contour: [0.9, 1.2, 0.85], fry: 38, vowel: 'a', syll: 1, noiseAmt: 0.45, bright: big ? 1400 : 2000 });
  },
  zombieDeath(rank = 'normal', pan = 0) {
    if (!ctx || throttle('zdeath', 90)) return;
    const big = rank === 'boss' || rank === 'miniboss';
    if (playSample('zombie_death', { gain: big ? 1 : 0.7, pan, rate: big ? 0.7 : 1, rev: 0.2 })) return;
    const o = out({ gain: big ? 0.9 : 0.5, pan, rev: 0.3 });
    zvoice(o, ctx.currentTime, { f: big ? 50 : rnd(72, 88), dur: big ? 1.6 : rnd(0.7, 1.0), contour: [1.05, 0.9, 0.5], fry: 22, fryDepth: 0.9, vowel: 'o', syll: 1, noiseAmt: 0.35, bright: 1500 });
    noise(o, { buf: pink, t: ctx.currentTime + 0.3, dur: 0.4, peak: 0.4, type: 'lowpass', f: 700, f2: 200, q: 8 }); // gorgolejo
  },
  slice(heavy = false) { if (!ctx || throttle('slice', 45)) return; if (playSample('sword_hit', { gain: 0.8 })) return; slice(heavy); },
  decap() { if (!ctx) return; slice(true); spurt(); },
  bulletHit() {
    if (!ctx || throttle('bhit', 45)) return;
    const o = out({ gain: 0.35 });
    noise(o, { dur: 0.05, peak: 0.8, type: 'lowpass', f: 900, f2: 300 });
    noise(o, { buf: pink, dur: 0.08, peak: 0.5, type: 'lowpass', f: 700, f2: 250, q: 7 });
    noise(o, { dur: 0.012, peak: 0.35, type: 'bandpass', f: rnd(1400, 2100), q: 1.2 });
    osc(o, { type: 'sine', f: rnd(125, 160), f2: 55, dur: 0.055, peak: 0.3 });
  },
  step(run = 0, theme = 'city') { if (!ctx) return; if (playSample('step', { gain: run ? 0.5 : 0.35 })) return; footstep(run, theme); },
  heavyStep(dist = 10, boss = false) {
    if (!ctx || throttle('hstep', 120)) return;
    const vol = Math.max(0.1, 1 - dist / 30);
    const t = ctx.currentTime, o = out({ gain: (boss ? 1.0 : 0.6) * vol, rev: 0.2 });
    noise(o, { buf: brown, t, dur: 0.3, peak: 1.4, type: 'lowpass', f: boss ? 140 : 200, q: 1 });
    osc(o, { t, type: 'sine', f: boss ? 50 : 65, f2: 28, dur: 0.28, peak: 0.9 });
    noise(o, { t: t + 0.01, dur: 0.06, peak: 0.3, type: 'bandpass', f: 1200, q: 1 });
  },
  shuffle(dist = 5) {
    if (!ctx || throttle('shuffle', 160)) return;
    const o = out({ gain: 0.2 * Math.max(0.1, 1 - dist / 10) });
    noise(o, { buf: pink, dur: 0.22, a: 0.05, peak: 0.6, type: 'bandpass', f: 750, f2: 480, q: 1.5 });
  },
  scream(pan = 0) { if (!ctx || throttle('scream', 700)) return; screech(pan); },
  explode(pan = 0) { if (!ctx || throttle('boom', 60)) return; boom(1, pan); },
  pickup() {
    if (!ctx || throttle('pick', 80)) return;
    const o = out({ gain: 0.18, rev: 0.15 });
    osc(o, { type: 'triangle', f: 880, dur: 0.12, peak: 0.6 });
    osc(o, { type: 'sine', f: 1320, dur: 0.18, peak: 0.4, t: ctx.currentTime + 0.05 });
  },
  rare() {
    if (!ctx) return;
    const o = out({ gain: 0.22, rev: 0.5 });
    [523, 659, 784, 1046].forEach((f, i) => osc(o, { type: 'sine', f, dur: 0.6, peak: 0.45, t: ctx.currentTime + i * 0.08 }));
  },
  levelup() {
    if (!ctx) return;
    const o = out({ gain: 0.2, rev: 0.6 });
    [392, 494, 587, 784].forEach((f, i) => { osc(o, { type: 'triangle', f, dur: 0.9, peak: 0.4, t: ctx.currentTime + i * 0.1 }); osc(o, { type: 'sine', f: f * 2, dur: 0.6, peak: 0.15, t: ctx.currentTime + i * 0.1 }); });
  },
  hurt(fraction = 0.1) {
    if (!ctx || throttle('hurt', 260)) return;
    if (playSample('player_hurt', { gain: 0.9 })) return;
    const t = ctx.currentTime, o = out({ gain: 0.75, rev: 0.04 });
    const impact = Math.max(0, Math.min(1, fraction * 4));
    // "uh!" curto: voz grave com ataque rápido e queda de tom
    const f = rnd(118, 135);
    const src = ctx.createOscillator(); src.type = 'sawtooth';
    src.frequency.setValueAtTime(f * 1.12, t); src.frequency.exponentialRampToValueAtTime(f * 0.8, t + 0.16);
    const mix = ctx.createGain();
    for (const [ff, q, gg] of [[420, 5, 1.6], [900, 7, 0.8], [2400, 9, 0.18]]) {
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = ff; bp.Q.value = q;
      const g = ctx.createGain(); g.gain.value = gg; src.connect(bp); bp.connect(g); g.connect(mix);
    }
    const e = ctx.createGain(); e.gain.setValueAtTime(0.0001, t); e.gain.linearRampToValueAtTime(1, t + 0.012);
    e.gain.setValueAtTime(1, t + 0.06); e.gain.exponentialRampToValueAtTime(0.0001, t + 0.19);
    mix.connect(e); e.connect(o); src.start(t); src.stop(t + 0.22);
    noise(o, { buf: pink, t, dur: 0.12, peak: 0.35, type: 'bandpass', f: 700, q: 1.5 }); // ar expulso
    // impacto (soco no corpo)
    osc(o, { t, type: 'sine', f: 170 - impact * 35, f2: 55, dur: 0.09 + impact * 0.04, peak: 0.55 + impact * 0.35 });
    noise(o, { t, dur: 0.05, peak: 0.45 + impact * 0.2, type: 'lowpass', f: 1100, f2: 300 });
    noise(o, { buf: brown, t: t + 0.006, dur: 0.06 + impact * 0.05, peak: 0.25 + impact * 0.3, type: 'lowpass', f: 360, f2: 110 });
  },
  reload() { if (!ctx) return; const t = ctx.currentTime; mech(t, 0, 0.5, 1900); mech(t + 0.18, 0, 0.4, 2600); mech(t + 0.36, 0, 0.6, 1500); },
  empty() { if (!ctx || throttle('empty', 200)) return; mech(ctx.currentTime, 0, 0.5, 3200); },
  jump() {
    if (!ctx || throttle('jump', 80)) return;
    const o = out({ gain: 0.32, rev: 0.03 });
    noise(o, { buf: pink, dur: 0.16, a: 0.012, peak: 0.45, type: 'bandpass', f: 850, f2: 2200, q: 1.2 });
    osc(o, { type: 'sine', f: 105, f2: 55, dur: 0.1, peak: 0.28 });
  },
  land() {
    if (!ctx || throttle('land', 80)) return;
    const o = out({ gain: 0.36 });
    noise(o, { buf: brown, dur: 0.06, peak: 0.7, type: 'lowpass', f: 280, f2: 100, q: 0.8 });
    osc(o, { type: 'sine', f: 72, f2: 38, dur: 0.07, peak: 0.35 });
  },
  dash() { if (!ctx) return; whoosh(0, false, true); noise(out({ gain: 0.2 }), { buf: pink, dur: 0.12, peak: 0.6, type: 'lowpass', f: 500 }); },
  nest() {
    if (!ctx) return;
    const t = ctx.currentTime, o = out({ gain: 0.9, rev: 0.8 });
    noise(o, { buf: brown, t, dur: 1.4, peak: 1.2, type: 'lowpass', f: 600, f2: 90 });
    for (let i = 0; i < 6; i++) noise(o, { buf: pink, t: t + rnd(0, 0.6), dur: 0.15, peak: 0.6, type: 'bandpass', f: rnd(300, 900), f2: rnd(100, 300), q: 5 });
    voice(o, t, { f0: 90, f1: 40, dur: 1.4, formants: [[300, 4, 1], [700, 5, 0.6]], vib: 7, vibDepth: 10, breath: 0.3, dist: true });
  },
  boss() { if (!ctx) return; roar(0); },
  spit() {
    if (!ctx || throttle('spit', 120)) return;
    const o = out({ gain: 0.35, rev: 0.1 });
    noise(o, { buf: pink, dur: 0.18, peak: 1, type: 'bandpass', f: 1800, f2: 500, q: 4 });
  },
  loot() { if (!ctx || throttle('loot', 150)) return; const t = ctx.currentTime; const o = out({ gain: 0.25 }); for (let i = 0; i < 3; i++) noise(o, { buf: pink, t: t + i * 0.06, dur: 0.05, peak: 0.6, type: 'bandpass', f: rnd(800, 2000), q: 2 }); },
  click() { if (!ctx) return; const o = out({ gain: 0.12 }); noise(o, { dur: 0.015, peak: 0.8, type: 'bandpass', f: 2500, q: 3 }); },
};

// ============================================================
//  AMBIENTAÇÃO
// ============================================================
export function startAmbience(kind) {
  if (!ctx) { pendingAmb = kind; return; }
  if (amb && amb.kind === kind) return;
  stopAmbience();
  const t = ctx.currentTime;
  const bus = ctx.createGain();
  bus.gain.setValueAtTime(0.0001, t);
  bus.gain.linearRampToValueAtTime(1, t + 2.5);
  bus.connect(ambBus);
  const nodes = [];
  const loop = (buf, filterType, f, q, gain) => {
    const s = ctx.createBufferSource(); s.buffer = buf; s.loop = true;
    const fl = ctx.createBiquadFilter(); fl.type = filterType; fl.frequency.value = f; fl.Q.value = q;
    const g = ctx.createGain(); g.gain.value = gain;
    s.connect(fl); fl.connect(g); g.connect(bus);
    s.start(t, Math.random() * 2);
    nodes.push(s);
    return { s, fl, g };
  };
  const lfo = (target, freq, depth, offset) => {
    const o = ctx.createOscillator(); o.frequency.value = freq;
    const g = ctx.createGain(); g.gain.value = depth;
    o.connect(g); g.connect(target);
    if (offset !== undefined) target.value = offset;
    o.start(t); nodes.push(o);
  };
  // vento (sempre)
  const wind = loop(brown, 'bandpass', 500, 0.8, kind === 'camp' ? 0.25 : 0.45);
  lfo(wind.fl.frequency, 0.06, 260, 520);
  lfo(wind.g.gain, 0.11, 0.18, kind === 'camp' ? 0.25 : 0.42);
  const hiss = loop(pink, 'highpass', 4000, 0.5, 0.025);
  lfo(hiss.g.gain, 0.09, 0.02, 0.03);

  // drone de tensão
  if (kind !== 'camp') {
    const dg = ctx.createGain(); dg.gain.value = 0.045;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 260;
    lp.connect(dg); dg.connect(bus);
    const base = { city: 55, suburb: 49, port: 46.25, military: 41.2, menu: 55 }[kind] || 55;
    for (const [mul, type] of [[1, 'sawtooth'], [1.5, 'sine'], [2.003, 'sawtooth']]) {
      const o = ctx.createOscillator(); o.type = type; o.frequency.value = base * mul;
      o.detune.value = rnd(-8, 8);
      o.connect(lp); o.start(t); nodes.push(o);
    }
    lfo(dg.gain, 0.05, 0.03, 0.045);
  }
  // fogueira
  if (kind === 'camp') {
    loop(brown, 'lowpass', 380, 0.7, 0.35);
  }

  // eventos aleatórios distantes
  const timers = [];
  const schedule = (fn, min, max) => {
    const tick = () => { if (!amb || amb.bus !== bus) return; fn(); timers.push(setTimeout(tick, rnd(min, max) * 1000)); };
    timers.push(setTimeout(tick, rnd(min, max) * 1000));
  };
  const far = (gain, rev = 0.9) => {
    const g = ctx.createGain(); g.gain.value = gain;
    const p = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    if (p) { p.pan.value = rnd(-0.9, 0.9); g.connect(p); p.connect(bus); } else g.connect(bus);
    const s = ctx.createGain(); s.gain.value = rev; g.connect(s); s.connect(reverbIn);
    return g;
  };
  if (kind === 'camp') {
    schedule(() => { const o = far(0.25, 0.05); for (let i = 0; i < 1 + Math.random() * 4; i++) noise(o, { t: ctx.currentTime + rnd(0, 0.3), dur: rnd(0.01, 0.03), peak: rnd(0.3, 1), type: 'bandpass', f: rnd(1500, 4500), q: 2 }); }, 0.15, 0.6);
    schedule(() => groanFar(far(0.08)), 12, 25);
    schedule(() => owl(far(0.12)), 15, 30);
  } else {
    schedule(() => groanFar(far(0.2)), 4, 10);
    schedule(() => crow(far(0.14)), 9, 20);
    schedule(() => creak(far(0.12)), 10, 22);
    schedule(() => distantShot(far(0.18)), 18, 40);
    if (kind === 'port') schedule(() => horn(far(0.18)), 25, 50);
    if (kind === 'military') schedule(() => siren(far(0.06)), 30, 60);
    if (kind === 'suburb') schedule(() => dog(far(0.12)), 14, 28);
  }
  amb = { kind, bus, nodes, timers };
}

export function stopAmbience() {
  if (!amb || !ctx) { pendingAmb = null; return; }
  const { bus, nodes, timers } = amb;
  amb = null;
  timers.forEach(clearTimeout);
  const t = ctx.currentTime;
  bus.gain.cancelScheduledValues(t);
  bus.gain.setValueAtTime(bus.gain.value, t);
  bus.gain.linearRampToValueAtTime(0.0001, t + 1.2);
  setTimeout(() => { nodes.forEach((n) => { try { n.stop(); } catch {} }); bus.disconnect(); }, 1400);
}

// eventos sonoros distantes
function groanFar(o) {
  const f = rnd(70, 110);
  voice(o, ctx.currentTime, { f0: f, f1: f * 0.75, dur: rnd(1.2, 2.2), formants: [[450, 5, 1], [1000, 6, 0.5]], vib: 4, vibDepth: 6, breath: 0.2 });
}
function crow(o) {
  const n = 1 + Math.floor(Math.random() * 3);
  for (let i = 0; i < n; i++) {
    const t = ctx.currentTime + i * rnd(0.35, 0.5);
    voice(o, t, { f0: rnd(500, 600), f1: rnd(380, 450), dur: 0.28, formants: [[1300, 4, 1], [2600, 5, 0.6]], vib: 30, vibDepth: 25, breath: 0.4, saw: 0.6, dist: true });
  }
}
function creak(o) {
  const t = ctx.currentTime, d = rnd(0.8, 1.6);
  const src = ctx.createOscillator(); src.type = 'sawtooth';
  src.frequency.setValueAtTime(rnd(30, 50), t);
  src.frequency.linearRampToValueAtTime(rnd(15, 25), t + d);
  const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = rnd(600, 1400); bp.Q.value = 12;
  const g = ctx.createGain(); env(g, t, 0.2, 0.5, d, 'lin');
  src.connect(bp); bp.connect(g); g.connect(o);
  src.start(t); src.stop(t + d + 0.3);
}
function distantShot(o) {
  const n = Math.random() < 0.5 ? 1 : 2 + Math.floor(Math.random() * 3);
  for (let i = 0; i < n; i++) {
    const t = ctx.currentTime + i * rnd(0.12, 0.25);
    noise(o, { buf: pink, t, dur: 0.5, peak: 0.8, type: 'lowpass', f: 700, f2: 120 });
  }
}
function horn(o) {
  const t = ctx.currentTime;
  for (const f of [110, 138.6]) osc(o, { t, type: 'sawtooth', f, dur: 2.5, a: 0.4, peak: 0.12 });
}
function siren(o) {
  const t = ctx.currentTime, s = ctx.createOscillator();
  s.type = 'sine';
  s.frequency.setValueAtTime(500, t);
  for (let i = 1; i <= 4; i++) s.frequency.linearRampToValueAtTime(i % 2 ? 900 : 500, t + i * 1.2);
  const g = ctx.createGain(); env(g, t, 0.5, 0.4, 4.5, 'lin');
  s.connect(g); g.connect(o); s.start(t); s.stop(t + 5.2);
}
function dog(o) {
  const t = ctx.currentTime;
  voice(o, t, { f0: 550, f1: 750, dur: 1.4, formants: [[800, 5, 1], [1600, 6, 0.4]], vib: 5, vibDepth: 12, breath: 0.1, saw: 0.4 });
}
function owl(o) {
  const t = ctx.currentTime;
  osc(o, { t, type: 'sine', f: 420, f2: 380, dur: 0.35, a: 0.05, peak: 0.4 });
  osc(o, { t: t + 0.5, type: 'sine', f: 420, f2: 360, dur: 0.6, a: 0.05, peak: 0.4 });
}

// ============================================================
//  MÚSICA — trilha procedural sombria (pads em menor, arpejo
//  esparso, pulso de percussão que cresce com o combate)
// ============================================================
let pendingMusic = null, music = null;
const CHORDS = [[57, 60, 64], [53, 57, 60], [50, 53, 57], [52, 56, 59]]; // Am F Dm E
const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
export function startMusic(mood = 'camp') {
  if (!ctx) { pendingMusic = mood; return; }
  if (music) { music.mood = mood; return; }
  const bus = ctx.createGain(); bus.gain.value = 0; bus.connect(musicBus);
  bus.gain.linearRampToValueAtTime(1, ctx.currentTime + 3);
  music = { mood, bus, beat: 0, next: ctx.currentTime + 0.2, intensity: 0, timer: null };
  const bpm = 76, spb = 60 / bpm;
  const tick = () => {
    if (!music) return;
    while (music.next < ctx.currentTime + 0.25) { scheduleBeat(music.beat, music.next, spb); music.beat++; music.next += spb; }
  };
  music.timer = setInterval(tick, 90);
}
export function setMusicIntensity(v) { if (music) music.intensity += (Math.max(0, Math.min(1, v)) - music.intensity) * 0.05; }
export function stopMusic() {
  if (!music || !ctx) { pendingMusic = null; return; }
  const m = music; music = null;
  clearInterval(m.timer);
  m.bus.gain.setTargetAtTime(0, ctx.currentTime, 0.5);
  setTimeout(() => m.bus.disconnect(), 3000);
}
function scheduleBeat(b, t, spb) {
  const m = music, inten = m.mood === 'game' ? m.intensity : 0;
  const chord = CHORDS[Math.floor(b / 8) % CHORDS.length];
  if (b % 8 === 0) { // pad novo a cada 2 compassos
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 600 + inten * 900; lp.Q.value = 0.7;
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.12, t + spb * 2); g.gain.linearRampToValueAtTime(0.0001, t + spb * 8.5);
    lp.connect(g); g.connect(m.bus);
    for (const n of chord) for (const det of [-7, 7]) {
      const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = mtof(n - 12); o.detune.value = det;
      o.connect(lp); o.start(t); o.stop(t + spb * 9);
    }
    const bass = ctx.createOscillator(); bass.type = 'sine'; bass.frequency.value = mtof(chord[0] - 24);
    const bg = ctx.createGain(); bg.gain.setValueAtTime(0.0001, t); bg.gain.linearRampToValueAtTime(0.18, t + 0.5); bg.gain.linearRampToValueAtTime(0.0001, t + spb * 8.4);
    bass.connect(bg); bg.connect(m.bus); bass.start(t); bass.stop(t + spb * 9);
  }
  // arpejo esparso (sino abafado)
  if (Math.random() < 0.28 + inten * 0.35) {
    const n = chord[(Math.random() * 3) | 0] + (Math.random() < 0.5 ? 12 : 0);
    const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = mtof(n);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.07, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + spb * 2.5);
    const s2 = ctx.createGain(); s2.gain.value = 0.4; g.connect(s2); s2.connect(reverbIn);
    o.connect(g); g.connect(m.bus); o.start(t); o.stop(t + spb * 3);
  }
  // percussão: pulso de coração em exploração, tambores no combate
  if (m.mood === 'game') {
    if (b % 2 === 0 && inten > 0.05) {
      const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(90, t); o.frequency.exponentialRampToValueAtTime(40, t + 0.15);
      const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.25 * (0.4 + inten), t + 0.005); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);
      o.connect(g); g.connect(m.bus); o.start(t); o.stop(t + 0.3);
    }
    if (inten > 0.45 && b % 4 === 2) {
      const src = ctx.createBufferSource(); src.buffer = white;
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1800; bp.Q.value = 0.8;
      const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.12 * inten, t + 0.003); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
      src.connect(bp); bp.connect(g); g.connect(m.bus); src.start(t, Math.random()); src.stop(t + 0.2);
    }
    if (inten > 0.7 && (b % 4 === 1 || b % 4 === 3)) {
      const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(140, t + spb / 2); o.frequency.exponentialRampToValueAtTime(70, t + spb / 2 + 0.12);
      const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t + spb / 2); g.gain.linearRampToValueAtTime(0.15, t + spb / 2 + 0.005); g.gain.exponentialRampToValueAtTime(0.0001, t + spb / 2 + 0.2);
      o.connect(g); g.connect(m.bus); o.start(t + spb / 2); o.stop(t + spb / 2 + 0.25);
    }
  }
}
