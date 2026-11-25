// ============================================================
//  ZONA MORTA — inicialização e gerenciador de telas
// ============================================================
import * as THREE from 'three';
import { Menu } from './menu.js';
import { Creator } from './creator.js';
import { Hub } from './hub.js';
import { Game } from './game.js';
import { getProfile, saveProfile, initStore, flushSaves, storeMode } from './rpg.js';
import { net, playerInfo } from './net.js';
import { MAPS } from './data.js';
import { icon } from './icons.js';
import { toast } from './ui.js';
import { loadModels } from './models.js';
import { isTouch, lowPower } from './device.js';
import { initAudio, startAmbience, startMusic } from './audio.js';

const canvas = document.getElementById('gl');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, lowPower ? 1 : 1.5));
if (isTouch) document.body.dataset.touch = '1';
// Celular: impede o zoom da página por duplo toque e por pinça (mesmo com
// "forçar zoom" do Chrome), sem bloquear rolagem de menus nem campos de texto.
if (isTouch) {
  const editable = (t) => t && t.closest && t.closest('input, textarea, select, [contenteditable]');
  let lastEnd = 0;
  document.addEventListener('touchend', (e) => {
    const now = performance.now();
    if (now - lastEnd < 350 && !editable(e.target)) e.preventDefault(); // 2º toque rápido = zoom
    lastEnd = now;
  }, { passive: false });
  document.addEventListener('touchmove', (e) => { if (e.touches.length > 1 || (e.scale && e.scale !== 1)) e.preventDefault(); }, { passive: false });
  document.addEventListener('dblclick', (e) => e.preventDefault(), { passive: false });
  for (const ev of ['gesturestart', 'gesturechange', 'gestureend']) document.addEventListener(ev, (e) => e.preventDefault(), { passive: false }); // iOS
}
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;

const overlay = document.getElementById('overlay');
const octx = overlay.getContext('2d');

const app = {
  renderer, overlay, octx,
  screen: null,
  screenName: '',
  profile: null,
  go(name, args = {}) {
    if (this.screen) { this.screen.dispose(); this.screen = null; }
    octx.clearRect(0, 0, overlay.width, overlay.height);
    document.body.dataset.screen = name;
    this.screenName = name;
    if (this.profile && name !== 'menu') this.profile = getProfile(this.profile.id) || this.profile;
    if (name === 'menu') this.screen = new Menu(this, args);
    if (name === 'creator') this.screen = new Creator(this, args);
    if (name === 'hub') {
      if (!this.profile) return this.go('menu');
      localStorage.setItem('zonamorta.last', this.profile.id);
      this.screen = new Hub(this, args);
    }
    if (name === 'game') this.screen = new Game(this, this.profile, args.map, { seed: args.seed, coop: args.coop });
    startAmbience(name === 'game' ? args.map.theme : name === 'creator' ? 'menu' : 'camp');
    startMusic(name === 'game' ? 'game' : 'camp');
  },
  // Inicia uma partida. Com o servidor ativo, cria uma sala co-op (você é o anfitrião).
  async startGame(map, opts = {}) {
    const ld = document.getElementById('loading');
    document.getElementById('loading-text').textContent = `Gerando ${map.name}...`;
    ld.classList.remove('hidden');
    let seed = opts.seed ?? ((Math.random() * 1e9) | 0), coop = opts.coop || null;
    if (!coop && storeMode() === 'server') {
      try { const h = await net.host(map.id, seed, playerInfo(this.profile)); coop = { role: 'host', code: h.code }; }
      catch (e) { console.warn('co-op indisponível', e); }
    }
    // deixa a tela de carregamento aparecer antes de gerar o mapa
    setTimeout(() => {
      try { this.go('game', { map, seed, coop }); }
      catch (e) { console.error(e); toast('Erro ao gerar mapa: ' + e.message, 'warn', 6000); if (net.room) net.leave(); this.go('hub'); }
      ld.classList.add('hidden');
    }, 60);
  },
  // Entra na sala de outro jogador
  async joinRoom(code) {
    try {
      const m = await net.join(code.trim().toUpperCase(), playerInfo(this.profile));
      if (m.phase === 'lobby') {
        this.invite = null; history.replaceState(null, '', location.pathname);
        toast(`${icon('pessoa')} Você entrou na sala ${m.code}. Marque Pronto para a próxima partida.`);
        this.go('hub', { tab: 'maps' });
        return;
      }
      const map = MAPS.find((x) => x.id === m.map);
      if (!map) throw new Error('Mapa desconhecido');
      this.invite = null;
      history.replaceState(null, '', location.pathname);
      toast(`${icon('pessoa')} Entrando na sala ${m.code}...`);
      this.startGame(map, { seed: m.seed, coop: { role: 'client', code: m.code, join: m } });
    } catch (e) { toast('Não foi possível entrar: ' + e.message, 'warn', 5000); }
  },
};
function mountFeedback() {
  const button = document.createElement('button');
  button.type = 'button'; button.className = 'feedback-launch'; button.textContent = 'Enviar feedback';
  button.setAttribute('aria-label', 'Enviar feedback sobre o jogo');
  const modal = document.createElement('div'); modal.className = 'feedback-modal hidden';
  modal.innerHTML = `<form class="feedback-card"><button type="button" class="feedback-close" aria-label="Fechar">×</button><h2>Feedback do jogo</h2><p>Conte o que aconteceu ou o que podemos melhorar.</p><label>Categoria<select name="category"><option value="geral">Geral</option><option value="bug">Problema / bug</option><option value="audio">Som</option><option value="visual">Visual</option><option value="ideia">Sugestão</option></select></label><label>Mensagem<textarea name="message" minlength="8" maxlength="2000" required placeholder="Descreva seu feedback (mínimo 8 caracteres)"></textarea></label><div class="feedback-status" aria-live="polite"></div><button class="btn big" type="submit">Enviar</button></form>`;
  document.body.append(button, modal);
  button.onclick = () => modal.classList.remove('hidden');
  modal.querySelector('.feedback-close').onclick = () => modal.classList.add('hidden');
  modal.addEventListener('click', (event) => { if (event.target === modal) modal.classList.add('hidden'); });
  modal.querySelector('form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget, submit = form.querySelector('[type="submit"]'), status = form.querySelector('.feedback-status');
    submit.disabled = true; status.textContent = 'Enviando…';
    try {
      const response = await fetch('/api/feedback', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ category: form.category.value, message: form.message.value }), credentials: 'same-origin' });
      const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Não foi possível enviar.');
      form.reset(); status.textContent = 'Obrigado! Feedback recebido.';
    } catch (error) { status.textContent = error.message; }
    finally { submit.disabled = false; }
  });
}
mountFeedback();
window.__zm = app; // útil para depuração no console

function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h);
  const dpr = Math.min(devicePixelRatio, 2);
  overlay.width = w * dpr; overlay.height = h * dpr;
  overlay.style.width = w + 'px'; overlay.style.height = h + 'px';
  octx.setTransform(dpr, 0, 0, dpr, 0, 0);
  app.screen && app.screen.resize && app.screen.resize(w, h);
}
addEventListener('resize', resize);
// Celular: ao girar, o Chrome do Android às vezes só atualiza as medidas
// alguns instantes depois — reajusta de novo com atraso.
const afterRotate = () => { resize(); setTimeout(resize, 150); setTimeout(resize, 450); setTimeout(resize, 900); };
addEventListener('orientationchange', afterRotate);
if (screen.orientation && screen.orientation.addEventListener) screen.orientation.addEventListener('change', afterRotate);
if (window.visualViewport) visualViewport.addEventListener('resize', () => setTimeout(resize, 60));
resize();

let last = performance.now();
let fpsAcc = 0, fpsN = 0;
function frame(t) {
  const dt = Math.min(0.05, (t - last) / 1000);
  last = t;
  fpsAcc += dt; fpsN++;
  if (fpsAcc > 1) { app.fps = Math.round(fpsN / fpsAcc); fpsAcc = 0; fpsN = 0; }
  if (app.screen) {
    try { app.screen.update(dt); app.screen.render(); }
    catch (e) { console.error(e); if (!app._errShown) { app._errShown = true; toast('Erro: ' + e.message, 'warn', 8000); } }
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// Salva o perfil ao fechar a aba durante uma partida
addEventListener('beforeunload', () => { if (app.profile) saveProfile(app.profile); flushSaves(); });
// convite por link: ?sala=CODIGO
app.invite = new URLSearchParams(location.search).get('sala');

// O navegador só libera áudio após um gesto do usuário
const unlock = () => initAudio();
addEventListener('pointerdown', unlock);
addEventListener('keydown', unlock);

// Carrega modelos .glb opcionais (Meshy) antes de abrir o menu
const ld = document.getElementById('loading');
document.getElementById('loading-text').textContent = 'Carregando modelos...';
ld.classList.remove('hidden');
Promise.all([loadModels().catch(() => 0), initStore()]).finally(() => {
  ld.classList.add('hidden');
  app.go('menu');
  if (app.invite) toast(`${icon('pessoa')} Convite para a sala <b>${app.invite.toUpperCase()}</b> — escolha ou crie um personagem para entrar.`, 'loot', 8000);
});
