// ============================================================
//  IDENTIFICAÇÃO — e-mail ou telefone obrigatório para jogar
//  + dados técnicos do aparelho (com aviso de privacidade na tela).
//  O servidor confere: sem identificação ele não abre partidas.
// ============================================================

async function api(url, body) {
  const r = await fetch(url, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify(body) } : { cache: 'no-store', credentials: 'same-origin' });
  let data = null;
  try { data = await r.json(); } catch {}
  if (!r.ok) throw new Error((data && data.error) || 'Falha ao falar com o servidor');
  return data;
}

// ---------- dados do aparelho ----------
function gpuInfo() {
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl') || c.getContext('experimental-webgl');
    if (!gl) return null;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const out = ext ? `${gl.getParameter(ext.UNMASKED_VENDOR_WEBGL)} | ${gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)}` : `${gl.getParameter(gl.VENDOR)} | ${gl.getParameter(gl.RENDERER)}`;
    const lose = gl.getExtension('WEBGL_lose_context'); if (lose) lose.loseContext();
    return out;
  } catch { return null; }
}
const mq = (q) => { try { return matchMedia(q).matches; } catch { return null; } };

export async function collectDevice() {
  const n = navigator, s = window.screen || {};
  const d = {
    ua: n.userAgent, platform: n.platform || null, vendor: n.vendor || null,
    lang: n.language || null, langs: (n.languages || []).slice(0, 6),
    tz: (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return null; } })(),
    tzOffset: new Date().getTimezoneOffset(),
    cores: n.hardwareConcurrency || null, memory: n.deviceMemory || null, touchPoints: n.maxTouchPoints || 0,
    screen: { w: s.width, h: s.height, aw: s.availWidth, ah: s.availHeight, depth: s.colorDepth, dpr: Math.round((devicePixelRatio || 1) * 100) / 100, orientation: s.orientation ? s.orientation.type : null },
    viewport: { w: innerWidth, h: innerHeight },
    gpu: gpuInfo(),
    cookies: n.cookieEnabled, dnt: n.doNotTrack || null, pdf: n.pdfViewerEnabled ?? null, webdriver: n.webdriver || false,
    prefs: { dark: mq('(prefers-color-scheme: dark)'), reducedMotion: mq('(prefers-reduced-motion: reduce)'), standalone: mq('(display-mode: standalone)'), coarsePointer: mq('(pointer: coarse)') },
    referrer: document.referrer || null,
    page: location.pathname + location.search,
  };
  const c = n.connection || n.mozConnection || n.webkitConnection;
  if (c) d.net = { type: c.effectiveType || c.type || null, downlink: c.downlink ?? null, rtt: c.rtt ?? null, saveData: !!c.saveData };
  try {
    if (n.userAgentData) {
      const hi = await n.userAgentData.getHighEntropyValues(['platform', 'platformVersion', 'architecture', 'bitness', 'model', 'fullVersionList', 'formFactors']);
      d.uaData = { mobile: n.userAgentData.mobile, platform: hi.platform, platformVersion: hi.platformVersion, architecture: hi.architecture, bitness: hi.bitness, model: hi.model,
        brands: (hi.fullVersionList || []).map((b) => `${b.brand} ${b.version}`), formFactors: hi.formFactors || null };
    }
  } catch {}
  try { if (n.storage && n.storage.estimate) { const e = await n.storage.estimate(); d.storageQuotaMb = Math.round((e.quota || 0) / 1048576); } } catch {}
  try { if (n.getBattery) { const b = await n.getBattery(); d.battery = { level: Math.round(b.level * 100), charging: b.charging }; } } catch {}
  return d;
}
export async function reportDevice() {
  try { await api('/api/session/device', await collectDevice()); } catch {}
}

// ---------- tela obrigatória ----------
export async function getIdentity() { return api('/api/identity'); }

export function requireIdentity() {
  return new Promise((resolve) => {
    const wrap = document.createElement('div');
    wrap.className = 'id-gate';
    wrap.innerHTML = `<form class="id-card" novalidate>
      <h1 class="logo">ZONA MORTA</h1>
      <h2>Identifique-se para jogar</h2>
      <p>Informe seu <b>e-mail</b> ou <b>telefone (com DDD)</b>. Ele fica ligado aos seus personagens neste navegador.</p>
      <label>E-mail ou telefone
        <input name="contact" autocomplete="email" inputmode="email" maxlength="120" required placeholder="voce@email.com ou (11) 91234-5678">
      </label>
      <label class="id-consent"><input type="checkbox" name="consent">
        <span>Li e aceito o aviso de privacidade abaixo.</span></label>
      <details class="id-privacy"><summary>Aviso de privacidade (LGPD)</summary>
        <p>Para segurança, prevenção de fraudes e trapaças, suporte e estatísticas do jogo, registramos:
        seu e-mail ou telefone; o endereço IP e a região aproximada (país/estado/cidade); e dados técnicos do aparelho e do navegador
        (sistema e versão, navegador, modelo, tela, placa de vídeo, núcleos e memória, idioma, fuso horário, tipo de conexão, bateria e preferências de exibição).
        Não vendemos esses dados. IPs e identificadores do navegador são apagados após 180 dias.
        Para pedir acesso ou exclusão dos seus dados, use o botão "Enviar feedback" informando o mesmo contato.</p>
      </details>
      <div class="id-error" aria-live="polite"></div>
      <button class="btn big" type="submit">Entrar no jogo</button>
    </form>`;
    document.body.appendChild(wrap);
    const form = wrap.querySelector('form'), err = wrap.querySelector('.id-error'), input = form.contact;
    setTimeout(() => input.focus(), 50);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      err.textContent = '';
      const value = input.value.trim();
      if (!value) { err.textContent = 'Informe um e-mail ou telefone.'; return; }
      if (!form.consent.checked) { err.textContent = 'Marque o aceite do aviso de privacidade para continuar.'; return; }
      const btn = form.querySelector('[type="submit"]');
      btn.disabled = true; btn.textContent = 'Verificando…';
      try {
        const r = await api('/api/identity', { contact: value, consent: true });
        reportDevice();
        wrap.remove();
        resolve(r);
      } catch (ex) {
        err.textContent = ex.message;
        btn.disabled = false; btn.textContent = 'Entrar no jogo';
      }
    });
  });
}
