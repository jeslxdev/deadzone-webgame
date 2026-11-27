// ============================================================
//  AUTORIDADE — com o servidor ativo, XP, loot, dinheiro e progresso
//  vêm do servidor. O navegador só pede ("reivindica") e mostra o
//  resultado; editar variáveis no console não muda o personagem salvo.
//  Sem servidor (hospedagem estática) o jogo segue local, como antes.
// ============================================================
import { storeMode, adoptProfile, savesSettled } from './rpg.js';
import { POINTS_PER_LEVEL, START_SKILLS } from './data.js';

async function post(url, body, keepalive = false) {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify(body), keepalive });
  let data = null;
  try { data = await r.json(); } catch {}
  if (!r.ok) { const e = new Error((data && data.error) || 'falha no servidor'); e.status = r.status; throw e; }
  return data;
}

// pontos livres = derivados do nível e do que já foi gasto (igual ao servidor)
export function fixPoints(p) {
  const spentA = Object.values(p.attrs).reduce((a, b) => a + b, 0);
  p.points = Math.max(0, (p.level - 1) * POINTS_PER_LEVEL - spentA);
  let spentS = 0;
  for (const [id, r] of Object.entries(p.skills.learned)) spentS += r - (START_SKILLS[p.cls].includes(id) ? 1 : 0);
  p.sp = Math.max(0, p.level - spentS);
}

export const auth = {
  get on() { return storeMode() === 'server'; },
  runId: null,
  chain: Promise.resolve(),

  // abre a partida no servidor (antes de gerar o mapa)
  async startRun(profile, mapId, guest = false) {
    this.runId = null;
    const r = await post('/api/runs', { profileId: profile.id, map: mapId, guest });
    this.runId = r.runId;
    this.applyState(profile, r.state);
    return r;
  },

  // reivindicações são enviadas em ordem (ex.: ninhos antes de "zona limpa")
  claim(profile, body) {
    const job = this.chain.then(async () => {
      if (!this.runId) throw new Error('sem partida');
      const r = await post('/api/runs/claim', { ...body, runId: this.runId });
      this.applyState(profile, r.state);
      return r;
    });
    this.chain = job.catch(() => {});
    return job;
  },

  // fim da partida: o servidor confere a mochila e devolve o perfil oficial
  end(profile, kind) {
    const runId = this.runId;
    this.runId = null;
    const job = this.chain.then(async () => {
      if (!runId) return null;
      const r = await post('/api/runs/end', { runId, kind, profile }, true);
      if (r && r.profile) adoptProfile(profile, r.profile);
      return r;
    });
    this.chain = job.catch(() => {});
    return job;
  },

  async buy(profile, id) {
    await savesSettled();
    const r = await post('/api/shop/buy', { profileId: profile.id, id });
    adoptProfile(profile, r.profile);
    return r;
  },
  async sell(profile, uids, all = false) {
    await savesSettled();
    const r = await post('/api/shop/sell', { profileId: profile.id, uids, all });
    adoptProfile(profile, r.profile);
    return r;
  },
  async exportCode(profile) {
    const r = await fetch('/api/profiles/' + profile.id + '/export', { cache: 'no-store', credentials: 'same-origin' });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || 'falhou');
    return data.code;
  },
  async importCode(code) {
    return post('/api/profiles/import', { code: String(code || '').trim() });
  },

  applyState(p, s) {
    if (!s) return;
    p.level = s.level; p.xp = s.xp; p.money = s.money;
    p.stats = s.stats; p.cleared = s.cleared;
    fixPoints(p);
  },
};
