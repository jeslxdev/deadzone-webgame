// ============================================================
//  AUTORIDADE DO SERVIDOR — o navegador não decide o progresso
//
//  · XP, nível, dinheiro, mapas limpos e estatísticas só mudam
//    aqui, a partir de "reivindicações" de partida (abate, saque,
//    ninho, zona limpa) que passam por limites de taxa e do mapa.
//  · Todo item novo é sorteado no servidor e registrado na partida;
//    ao salvar, o perfil só aceita itens que já eram do jogador ou
//    que o servidor emitiu (com os atributos do servidor, não do
//    cliente).
//  · Atributos e habilidades são validados contra o nível.
//  · Compra e venda acontecem no servidor.
//  Usa as mesmas regras do jogo (js/data.js e js/rpg.js).
// ============================================================
const crypto = require('crypto');

let D = null, R = null;
let peerSids = () => new Set(); // sessões na mesma sala co-op (injetado pelo servidor)
async function init(opts = {}) {
  D = await import('./js/data.js');
  R = await import('./js/rpg.js');
  if (opts.peerSids) peerSids = opts.peerSids;
}

const uid = () => crypto.randomBytes(9).toString('base64url');
const clampInt = (v, a, b) => Math.max(a, Math.min(b, Math.floor(Number(v) || 0)));
const deep = (o) => JSON.parse(JSON.stringify(o));
const isObj = (o) => !!o && typeof o === 'object' && !Array.isArray(o);

// ---------- saneamento de campos livres ----------
function sanitizeName(n) {
  const s = String(n ?? '').replace(/[\u0000-\u001f\u007f<>"'`\\]/g, '').replace(/\s+/g, ' ').trim().slice(0, 18);
  return s.length >= 2 ? s : null;
}
const HEX = (v, d) => (Number.isInteger(v) && v >= 0 && v <= 0xffffff ? v : d);
const KEYOF = (v, obj, d) => (typeof v === 'string' && Object.prototype.hasOwnProperty.call(obj, v) ? v : d);
function sanitizeAppearance(a, prev) {
  const d = prev || D.defaultAppearance();
  a = isObj(a) ? a : {};
  const out = {
    skin: HEX(a.skin, d.skin), hair: HEX(a.hair, d.hair), eyes: HEX(a.eyes, d.eyes),
    top: HEX(a.top, d.top), pants: HEX(a.pants, d.pants), shoes: HEX(a.shoes, d.shoes), pack: HEX(a.pack, d.pack ?? 0x3e6b3a),
    hairStyle: KEYOF(a.hairStyle, D.HAIR_STYLES, d.hairStyle), beard: KEYOF(a.beard, D.BEARDS, d.beard),
    accessory: KEYOF(a.accessory, D.ACCESSORIES, d.accessory), build: KEYOF(a.build, D.BUILDS, d.build),
    body: KEYOF(a.body, D.BODY_TYPES, d.body || 'm'),
    height: Math.min(1.12, Math.max(0.88, Number(a.height) || 1)),
  };
  if (a.sleeves === 'short' || a.sleeves === 'long') out.sleeves = a.sleeves;
  if (typeof a.modeledHair === 'boolean') out.modeledHair = a.modeledHair;
  // skin PNG: só data URL de PNG, tamanho limitado
  if (typeof a.skinPng === 'string' && a.skinPng.length <= 300000 && /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(a.skinPng) && (a.skinH === 64 || a.skinH === 32)) {
    out.skinPng = a.skinPng; out.skinH = a.skinH;
  }
  return out;
}

// ---------- itens ----------
const stackKey = (it) => it.kind + ':' + it.id;
function validItem(it) {
  if (!isObj(it)) return false;
  if (it.kind === 'weapon') return !!D.WEAPONS[it.base] && Number.isInteger(it.rarity) && it.rarity >= 0 && it.rarity <= 4 && Number.isInteger(it.ilvl) && it.ilvl >= 1 && it.ilvl <= 20;
  if (it.kind === 'valuable') return !!D.VALUABLES[it.id];
  if (it.kind === 'consumable') return !!D.CONSUMABLES[it.id];
  return false;
}
function serverItem(it) { // cópia "limpa" (só campos conhecidos)
  if (it.kind === 'weapon') return { uid: it.uid || uid(), kind: 'weapon', base: it.base, rarity: it.rarity, ilvl: it.ilvl };
  return { uid: it.uid || uid(), kind: it.kind, id: it.id, qty: clampInt(it.qty || 1, 1, 99999) };
}
function issue(items) { return items.filter(validItem).map((it) => serverItem({ ...it, uid: uid() })); }

// ---------- perfil ----------
function newProfile(client) {
  const cls = KEYOF(client.cls, D.CLASSES, null);
  const name = sanitizeName(client.name);
  if (!cls || !name) return null;
  const p = R.createProfile({ name, cls, appearance: sanitizeAppearance(client.appearance) });
  p.id = client.id;
  p.equipped = serverItem({ ...p.equipped, uid: uid() });
  if (p.secondary) p.secondary = serverItem({ ...p.secondary, uid: uid() });
  p.stash = p.stash.map((it) => serverItem({ ...it, uid: uid() }));
  p.created = Date.now();
  return R.migrateProfile(p);
}

function skillsSpent(learned, cls) {
  let spent = 0;
  for (const [id, r] of Object.entries(learned)) spent += r - (D.START_SKILLS[cls].includes(id) ? 1 : 0);
  return spent;
}
function attrSum(a) { return Object.keys(D.ATTRS).reduce((s, k) => s + (a[k] || 0), 0); }
// pontos livres sempre derivados do nível (nunca confiados ao cliente)
function fixPoints(p) {
  p.points = Math.max(0, (p.level - 1) * D.POINTS_PER_LEVEL - attrSum(p.attrs));
  p.sp = Math.max(0, p.level - skillsSpent(p.skills.learned, p.cls));
  return p;
}

// Reconstrói o perfil a partir do salvo + mudanças PERMITIDAS do cliente
function reconcile(old, client, run) {
  const out = deep(R.migrateProfile(deep(old)));
  out.name = sanitizeName(client.name) || out.name;
  out.appearance = sanitizeAppearance(client.appearance, out.appearance);

  // atributos: só aumentam, até o orçamento do nível
  const budget = (out.level - 1) * D.POINTS_PER_LEVEL;
  const attrs = {};
  for (const k of Object.keys(D.ATTRS)) attrs[k] = clampInt(client.attrs?.[k], out.attrs[k] || 0, 999);
  if (attrSum(attrs) <= budget) out.attrs = attrs;

  // habilidades: só da classe/universais, nível mínimo, rank ≤ 3, gasto ≤ pontos ganhos
  const learned = { ...out.skills.learned };
  if (isObj(client.skills?.learned)) {
    for (const [id, rank] of Object.entries(client.skills.learned)) {
      const S = D.SKILLS[id];
      if (!S || (S.cls !== 'all' && S.cls !== out.cls) || out.level < S.lvl) continue;
      const r = clampInt(rank, learned[id] || 0, D.MAX_SKILL_RANK);
      if (r > 0) learned[id] = r;
    }
  }
  if (skillsSpent(learned, out.cls) <= out.level) out.skills.learned = learned;
  const slots = Array.isArray(client.skills?.slots) ? client.skills.slots.slice(0, 4) : out.skills.slots;
  const seen = new Set();
  out.skills.slots = [0, 1, 2, 3].map((i) => {
    const id = slots[i];
    if (typeof id !== 'string' || !out.skills.learned[id] || seen.has(id)) return null;
    seen.add(id); return id;
  });
  fixPoints(out);

  // itens: o cliente só pode REORGANIZAR o que já é dele (ou o que o servidor emitiu na partida)
  const poolW = new Map(), poolS = new Map();
  const addPool = (it) => {
    if (!validItem(it)) return;
    if (it.kind === 'weapon') poolW.set(it.uid, it);
    else poolS.set(stackKey(it), (poolS.get(stackKey(it)) || 0) + clampInt(it.qty || 1, 1, 99999));
  };
  (old.stash || []).forEach(addPool);
  if (old.equipped) addPool(old.equipped);
  if (old.secondary) addPool(old.secondary);
  const oldQty = new Map(poolS);
  if (run) for (const it of run.issued.values()) addPool(it);

  // qualquer classe empunha qualquer arma (fogo ou lâmina); só vale o que é do jogador
  let eq = client.equipped && poolW.get(client.equipped.uid);
  if (!eq) eq = poolW.get(old.equipped?.uid) || old.equipped;
  poolW.delete(eq.uid);
  out.equipped = serverItem(eq);
  const used = new Set([eq.uid]);
  // arma reserva: null = guardada no estoque; ausente (cliente antigo) = mantém a anterior
  let sec = null;
  if (client.secondary === undefined) sec = old.secondary && poolW.get(old.secondary.uid);
  // inválida (não é do jogador / já está na mão): mantém a reserva anterior, sem perdê-la
  else if (isObj(client.secondary)) sec = poolW.get(client.secondary.uid) || (old.secondary && poolW.get(old.secondary.uid)) || null;
  if (sec) { poolW.delete(sec.uid); used.add(sec.uid); }
  out.secondary = sec ? serverItem(sec) : null;
  const stash = [];
  for (const it of Array.isArray(client.stash) ? client.stash.slice(0, 600) : []) {
    if (!isObj(it)) continue;
    if (it.kind === 'weapon') {
      const w = poolW.get(it.uid);
      if (w) { stash.push(serverItem(w)); poolW.delete(it.uid); used.add(it.uid); }
    } else if (validItem(it)) {
      const k = stackKey(it), have = poolS.get(k) || 0;
      const q = Math.min(clampInt(it.qty || 1, 1, 99999), have);
      if (q > 0) {
        const same = stash.find((x) => x.kind === it.kind && x.id === it.id);
        if (same) same.qty += q;
        else stash.push(serverItem({ kind: it.kind, id: it.id, qty: q, uid: typeof it.uid === 'string' && /^[\w-]{4,40}$/.test(it.uid) ? it.uid : uid() }));
        poolS.set(k, have - q);
      }
    }
  }
  out.stash = stash.slice(0, 400);
  if (run) {
    // armas emitidas que entraram no estoque saem da lista pendente
    for (const k of [...run.issued.keys()]) if (used.has(k)) run.issued.delete(k);
    // empilháveis: o que passou da quantidade antiga foi consumido da lista pendente
    for (const it of stash) {
      if (it.kind === 'weapon') continue;
      const k = stackKey(it);
      let extra = it.qty - (oldQty.get(k) || 0);
      for (const [ik, is] of [...run.issued]) {
        if (extra <= 0) break;
        if (is.kind === 'weapon' || stackKey(is) !== k) continue;
        const take = Math.min(extra, is.qty);
        is.qty -= take; extra -= take;
        if (is.qty <= 0) run.issued.delete(ik);
      }
    }
    // arma antiga que foi para a mochila da partida fica pendente (volta na extração)
    for (const w of poolW.values()) if (!run.issued.has(w.uid)) run.issued.set(w.uid, w);
  }
  out.updated = Date.now();
  return out;
}

// ---------- partidas (memória do servidor) ----------
const runs = new Map();          // runId -> run
const runByProfile = new Map();  // sid:profileId -> runId
function mapUnlocked(p, i) {
  return i === 0 || p.cleared.includes(D.MAPS[i - 1].id) || p.level >= D.MAPS[i].level;
}
function startRun(sid, profile, mapId, guest) {
  const i = D.MAPS.findIndex((m) => m.id === mapId);
  if (i < 0) throw new Error('mapa inválido');
  // convidado de uma sala co-op pode entrar no mapa do anfitrião mesmo sem tê-lo liberado
  if (!mapUnlocked(profile, i) && !(guest && peerSids(sid).size > 1)) throw new Error('mapa bloqueado');
  const map = D.MAPS[i];
  const key = sid + ':' + profile.id;
  const prev = runByProfile.get(key);
  if (prev) runs.delete(prev);
  profile.stats.runs++;
  const run = {
    id: uid(), sid, profileId: profile.id, map, lvl: map.level, start: Date.now(), ended: false,
    types: new Set([...Object.keys(map.pool), ...map.minibossTypes, map.boss.type]),
    issued: new Map(), loot: new Set(), lastLoot: 0, kills: 0, rank: { elite: 0, miniboss: 0, boss: 0 }, nests: 0, mother: false,
    bossDown: false, cleared: false, treasure: false, assists: { boss: 0, miniboss: 0 }, claims: [],
  };
  runs.set(run.id, run); runByProfile.set(key, run.id);
  // limpeza de partidas antigas (12 h)
  for (const [id, r] of runs) if (Date.now() - r.start > 12 * 3600e3) runs.delete(id);
  return run;
}
const currentRun = (sid, profileId) => runs.get(runByProfile.get(sid + ':' + profileId));
const getRun = (sid, runId) => { const r = runs.get(String(runId || '')); return r && r.sid === sid && !r.ended ? r : null; };
// partidas de outros jogadores da mesma sala co-op (mesmo mapa)
function roomRuns(run) {
  const sids = peerSids(run.sid);
  const out = [];
  for (const r of runs.values()) if (r !== run && !r.ended && r.sid !== run.sid && sids.has(r.sid) && r.map.id === run.map.id && Date.now() - r.start < 6 * 3600e3) out.push(r);
  return out;
}
function endRun(run, p, kind) {
  run.ended = true;
  runs.delete(run.id);
  const key = run.sid + ':' + run.profileId;
  if (runByProfile.get(key) === run.id) runByProfile.delete(key);
  if (kind === 'death') p.stats.deaths++;
  if (kind === 'extract') p.stats.extracted++;
}

const xpOfKill = (type, rank, lvl) => Math.round(D.ZOMBIE_TYPES[type].xp * D.RANKS[rank].xp * (1 + 0.2 * (lvl - 1)));
function summary(p) { return { level: p.level, xp: p.xp, money: p.money, stats: p.stats, cleared: p.cleared }; }

// Reivindicação de evento de partida. Lança erro se não for plausível.
function claim(run, p, body) {
  const now = Date.now(), el = (now - run.start) / 1000, lvl = run.lvl;
  run.claims = run.claims.filter((t) => now - t < 1000);
  if (run.claims.length >= 25) throw new Error('muitas ações por segundo');
  run.claims.push(now);
  const st = R.deriveStats(p);
  let items = [], xp = 0, money = 0;
  switch (body.kind) {
    case 'kill': {
      const type = KEYOF(body.type, D.ZOMBIE_TYPES, null), rank = KEYOF(body.rank, D.RANKS, null);
      if (!type || !rank || !run.types.has(type)) throw new Error('zumbi inválido');
      if (rank === 'boss' && type !== run.map.boss.type) throw new Error('zumbi inválido');
      if (rank === 'miniboss' && !run.map.minibossTypes.includes(type)) throw new Error('zumbi inválido');
      if (run.kills >= 30 + el * 6) throw new Error('abates acima do possível');
      if (rank === 'boss' && run.rank.boss >= 1) throw new Error('boss já derrotado');
      if (rank === 'miniboss' && run.rank.miniboss >= run.map.nests + 2) throw new Error('mini-bosses acima do possível');
      if (rank === 'elite' && run.rank.elite >= 8 + el * 0.6) throw new Error('elites acima do possível');
      run.kills++;
      if (rank !== 'normal') run.rank[rank]++;
      if (rank === 'boss') run.bossDown = true;
      if (body.xp !== false) {
        xp = xpOfKill(type, rank, lvl);
        p.stats.kills++;
        if (rank === 'boss') p.stats.bosses++;
        if (rank === 'miniboss') p.stats.minibosses++;
      }
      if (body.drops !== false) {
        items = R.zombieDrop(rank, lvl, p);
        if (rank === 'boss') for (let i = 0; i < 3; i++) items.push(R.randomWeapon(p.cls, lvl + 1, st.luck, 3, 2));
      }
      break;
    }
    case 'assist': { // bônus de grupo por mini-boss/boss abatido por outro jogador da sala
      if (!roomRuns(run).length) throw new Error('fora de sala');
      const rank = body.rank === 'boss' ? 'boss' : 'miniboss';
      const type = rank === 'boss' ? run.map.boss.type : (run.map.minibossTypes.includes(body.type) ? body.type : run.map.minibossTypes[0]);
      if (rank === 'boss' && run.assists.boss >= 1) throw new Error('assistência repetida');
      if (rank === 'miniboss' && run.assists.miniboss >= run.map.nests + 2) throw new Error('assistências acima do possível');
      run.assists[rank]++;
      if (rank === 'boss') run.bossDown = true;
      xp = Math.round(xpOfKill(type, rank, lvl) * 0.5);
      break;
    }
    case 'loot': {
      const ctype = KEYOF(body.ctype, D.CONTAINERS, null), idx = clampInt(body.idx, -1, 5000);
      if (!ctype || idx < 0) throw new Error('contêiner inválido');
      if (run.loot.has(idx)) throw new Error('contêiner já saqueado');
      if (run.loot.size >= 260) throw new Error('saques acima do possível');
      if (now - run.lastLoot < 600) throw new Error('saque rápido demais');
      if (ctype === 'tesouro' && (!run.cleared || run.treasure)) throw new Error('tesouro indisponível');
      run.loot.add(idx); run.lastLoot = now;
      if (ctype === 'tesouro') run.treasure = true;
      items = R.rollLoot(ctype, lvl, p);
      if (ctype === 'tesouro') items.push(R.randomWeapon(p.cls, lvl + 1, st.luck, 4, 3));
      xp = 4;
      break;
    }
    case 'nest': {
      const mother = !!body.mother, group = roomRuns(run);
      if (mother) {
        if (run.mother) throw new Error('colmeia já destruída');
        // convidado que entrou no meio da partida: vale o progresso do grupo
        const ok = run.nests >= run.map.nests || group.some((r) => r.nests >= r.map.nests);
        if (!ok || el < 20) throw new Error('colmeia protegida');
        run.mother = true;
      } else {
        if (run.nests >= run.map.nests) throw new Error('ninhos acima do possível');
        if (el < 4 || (!group.length && el < 12 * (run.nests + 1))) throw new Error('ninho rápido demais');
        run.nests++;
      }
      xp = Math.round((mother ? 700 : 160) * (1 + 0.25 * (lvl - 1)));
      p.stats.nests++;
      if (body.drops !== false) {
        items = R.rollLoot(mother ? 'cofre' : 'militar', lvl, p);
        if (Math.random() < 0.5) items.push(R.randomWeapon(p.cls, lvl, st.luck, 2, 1));
      }
      break;
    }
    case 'clear': {
      if (run.cleared) throw new Error('zona já limpa');
      const group = roomRuns(run).some((r) => r.cleared);
      if (!((run.mother && run.bossDown) || group) || el < 25) throw new Error('zona ainda não foi limpa');
      run.cleared = true;
      money = Math.round(400 * lvl * st.moneyMult);
      p.money += money;
      if (!p.cleared.includes(run.map.id)) p.cleared.push(run.map.id);
      xp = 450 * lvl;
      break;
    }
    case 'pickup': { // co-op: pega um item que caiu na partida de outro jogador da mesma sala
      const want = String(body.uid || '');
      for (const other of roomRuns(run)) {
        if (!other.issued.has(want)) continue;
        const it = other.issued.get(want);
        other.issued.delete(want);
        run.issued.set(it.uid, it);
        return { items: [it], xp: 0, levels: 0, money: 0, state: summary(p) };
      }
      throw new Error('item indisponível');
    }
    default: throw new Error('ação desconhecida');
  }
  const levels = xp ? R.grantXp(p, Math.max(0, Math.round(xp))) : 0;
  fixPoints(p);
  const out = issue(items);
  for (const it of out) run.issued.set(it.uid, it);
  return { items: out, xp, levels, money, state: summary(p) };
}

// ---------- economia do acampamento ----------
function shopBuy(p, id) {
  const s = D.SHOP.find((x) => x.id === id);
  if (!s) throw new Error('item de loja inválido');
  if (p.money < s.price) throw new Error('dinheiro insuficiente');
  p.money -= s.price;
  let got;
  if (s.give) {
    const same = p.stash.find((x) => x.kind === s.give.kind && x.id === s.give.id);
    if (same) same.qty += s.give.qty; else p.stash.push(serverItem({ ...s.give, uid: uid() }));
    got = { kind: s.give.kind, id: s.give.id, qty: s.give.qty };
  } else {
    const st = R.deriveStats(p);
    got = serverItem({ ...R.randomWeapon(p.cls, Math.max(1, p.level - 1), st.luck, s.crate.tier, s.crate.minRarity), uid: uid() });
    p.stash.push(got);
  }
  return got;
}
function sell(p, uids, allValuables) {
  const mult = R.deriveStats(p).moneyMult;
  let total = 0;
  const keep = [];
  for (const it of p.stash) {
    const sellIt = allValuables ? it.kind === 'valuable' : uids.includes(it.uid);
    if (sellIt && validItem(it)) total += Math.round(R.itemValue(it) * mult);
    else keep.push(it);
  }
  p.stash = keep;
  p.money += total;
  return total;
}

// ---------- código de exportação assinado ----------
function exportCode(p, secret) {
  const body = Buffer.from(JSON.stringify(p)).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  return 'ZM2:' + body + '.' + sig;
}
function readCode(code, secret) {
  const m = /^ZM2:([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/.exec(String(code || '').trim());
  if (!m) throw new Error('Código inválido (use um código ZM2 gerado pelo jogo)');
  const want = crypto.createHmac('sha256', secret).update(m[1]).digest();
  const got = Buffer.from(m[2], 'base64url');
  if (got.length !== want.length || !crypto.timingSafeEqual(got, want)) throw new Error('Código adulterado ou de outro servidor');
  const p = JSON.parse(Buffer.from(m[1], 'base64url').toString('utf8'));
  if (!isObj(p) || !D.CLASSES[p.cls] || typeof p.id !== 'string') throw new Error('Personagem corrompido');
  return R.migrateProfile(p);
}

// ---------- dados públicos de jogador no co-op (vistos pelos outros) ----------
function sanitizeInfo(info) {
  if (!isObj(info)) return null;
  const cls = KEYOF(info.cls, D.CLASSES, null);
  if (!cls) return null;
  const eq = isObj(info.equipped) && D.WEAPONS[info.equipped.base] ? info.equipped : { base: D.CLASSES[cls].startWeapon };
  return {
    name: sanitizeName(info.name) || 'Sobrevivente', cls, level: clampInt(info.level, 1, 99),
    appearance: sanitizeAppearance(info.appearance),
    equipped: { base: eq.base, rarity: clampInt(eq.rarity, 0, 4), ilvl: 1 },
  };
}

// partidas sobrevivem a um reinício do servidor (deploy)
function dumpRuns() {
  return [...runs.values()].map((r) => ({ ...r, map: r.map.id, types: [...r.types], issued: [...r.issued], loot: [...r.loot] }));
}
function loadRuns(list) {
  for (const r of Array.isArray(list) ? list : []) {
    const map = D.MAPS.find((m) => m.id === r.map);
    if (!map || Date.now() - r.start > 12 * 3600e3) continue;
    const run = { ...r, map, types: new Set(r.types), issued: new Map(r.issued), loot: new Set(r.loot), claims: [] };
    runs.set(run.id, run); runByProfile.set(run.sid + ':' + run.profileId, run.id);
  }
}

// perfil salvo antes da autoridade do servidor: completa campos e recalcula pontos
function normalize(p) {
  R.migrateProfile(p);
  p.attrs = Object.assign({ for: 0, agi: 0, vit: 0, pre: 0, sor: 0 }, isObj(p.attrs) ? p.attrs : {});
  p.stats = Object.assign({ kills: 0, bosses: 0, minibosses: 0, nests: 0, runs: 0, deaths: 0, extracted: 0 }, isObj(p.stats) ? p.stats : {});
  if (!Array.isArray(p.stash)) p.stash = [];
  if (!Array.isArray(p.cleared)) p.cleared = [];
  p.level = clampInt(p.level, 1, 999); p.xp = Math.max(0, Number(p.xp) || 0); p.money = Math.max(0, Math.floor(Number(p.money) || 0));
  if (!validItem(p.equipped)) p.equipped = serverItem({ kind: 'weapon', base: D.CLASSES[p.cls].startWeapon, rarity: 0, ilvl: 1 });
  if (p.secondary && !validItem(p.secondary)) p.secondary = null;
  return fixPoints(p);
}

module.exports = { init, normalize, sanitizeInfo, dumpRuns, loadRuns, newProfile, reconcile, fixPoints, startRun, currentRun, getRun, endRun, claim, shopBuy, sell, sanitizeName, summary, exportCode, readCode };
