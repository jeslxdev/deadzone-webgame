// ============================================================
//  CONFIGURAÇÕES — volumes por canal e opções de câmera
// ============================================================
import { getVolumes, setVolume, sfx, initAudio } from './audio.js';
import { icon } from './icons.js';
import { el } from './util.js';
import { lowPower } from './device.js';

const KEY = 'zonamorta.settings';
const defaults = { camBob: true, camLead: true, shake: true, showHelp: true, seeThrough: true, cinema: !lowPower };
const state = Object.assign({}, defaults, JSON.parse(localStorage.getItem(KEY) || '{}'));
export function setting(k) { return state[k]; }
function save() { localStorage.setItem(KEY, JSON.stringify(state)); }

export function openSettings(onClose) {
  initAudio();
  if (document.getElementById('settings-modal')) return;
  const v = getVolumes();
  const slider = (k, label, ic) => `<div class="set-row"><label>${icon(ic)} ${label}</label>
    <input type="range" min="0" max="100" value="${Math.round(v[k] * 100)}" data-vol="${k}"><span class="set-val" id="sv-${k}">${Math.round(v[k] * 100)}%</span></div>`;
  const check = (k, label) => `<label class="set-check"><input type="checkbox" data-set="${k}" ${state[k] ? 'checked' : ''}> ${label}</label>`;
  const m = el(`<div class="modal settings" id="settings-modal">
    <div class="modal-box small set-box">
      <h2>${icon('som')} Configurações</h2>
      <div class="label">Áudio</div>
      ${slider('master', 'Volume geral', 'som')}
      ${slider('music', 'Música', 'xp')}
      ${slider('sfx', 'Efeitos (tiros, golpes, zumbis)', 'samurai')}
      ${slider('amb', 'Ambiente (vento, sons distantes)', 'fogueira')}
      <div class="label">Câmera</div>
      ${check('camBob', 'Balanço da câmera ao andar')}
      ${check('camLead', 'Câmera antecipa o movimento e a mira')}
      ${check('shake', 'Tremor de tela (impactos/explosões)')}
      ${check('seeThrough', 'Cenário transparente na frente do personagem')}
      <div class="label">Imagem</div>
      ${check('cinema', 'Visual cinematográfico (brilho, cor de filme, vinheta) — desligue se o jogo ficar lento')}
      <div class="dim sm">Sons próprios: coloque arquivos em <b>sounds/</b> e registre em sounds/manifest.json.</div>
      <button class="btn" id="set-close">Fechar</button>
    </div>
  </div>`);
  document.body.appendChild(m);
  m.querySelectorAll('[data-vol]').forEach((r) => r.addEventListener('input', () => {
    const k = r.dataset.vol, val = Number(r.value) / 100;
    setVolume(k, val);
    m.querySelector('#sv-' + k).textContent = r.value + '%';
  }));
  m.querySelectorAll('[data-vol]').forEach((r) => r.addEventListener('change', () => { if (r.dataset.vol === 'sfx' || r.dataset.vol === 'master') sfx.pickup(); }));
  m.querySelectorAll('[data-set]').forEach((c) => c.addEventListener('change', () => { state[c.dataset.set] = c.checked; save(); }));
  const close = () => { m.remove(); onClose && onClose(); };
  m.querySelector('#set-close').onclick = close;
  m.addEventListener('mousedown', (e) => { if (e.target === m) close(); });
}
