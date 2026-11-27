// ============================================================
//  RESOLUÇÃO AUTOMÁTICA — mantém o jogo fluido em qualquer aparelho
//  Mede o FPS em janelas de ~1,5 s e ajusta a escala de renderização:
//  · cai rápido quando trava (1 janela ruim)
//  · sobe devagar quando sobra desempenho (3 janelas boas seguidas)
//  Em telas boas e GPUs folgadas a imagem fica mais nítida que antes;
//  em aparelhos fracos a resolução baixa antes de o jogo engasgar.
// ============================================================
import { lowPower } from './device.js';

export function createAutoQuality(renderer, onResize) {
  const dpr = Math.max(1, devicePixelRatio || 1);
  const max = Math.min(dpr, lowPower ? 1.5 : 2);
  const min = lowPower ? 0.6 : 0.75;
  let ratio = Math.min(dpr, lowPower ? 1 : 1.5); // ponto de partida (o mesmo de antes)
  const low = lowPower ? 40 : 48, high = 57;     // limites de FPS para baixar / subir
  let acc = 0, n = 0, good = 0, hold = 3;        // hold: segundos ignorados (carregamento, troca de tela)

  function apply(r) {
    r = Math.round(Math.max(min, Math.min(max, r)) * 100) / 100;
    if (Math.abs(r - ratio) < 0.01) return;
    ratio = r;
    renderer.setPixelRatio(ratio);
    onResize();
  }
  renderer.setPixelRatio(ratio);

  return {
    get ratio() { return ratio; },
    get range() { return [min, max]; },
    // chamada a cada quadro com o dt real (sem limite)
    tick(dt) {
      if (dt > 0.25) { acc = 0; n = 0; return; } // aba em segundo plano / travada pontual: não conta
      if (hold > 0) { hold -= dt; return; }
      acc += dt; n++;
      if (acc < 1.5) return;
      const fps = n / acc; acc = 0; n = 0;
      if (fps < low) { good = 0; apply(ratio * (fps < low * 0.7 ? 0.8 : 0.88)); hold = 1.5; }
      else if (fps >= high && ratio < max) { if (++good >= 3) { good = 0; apply(ratio * 1.1); hold = 1.5; } }
      else good = 0;
    },
    // troca de tela/partida: espera estabilizar antes de medir
    settle(sec = 3) { hold = sec; acc = 0; n = 0; good = 0; },
  };
}
