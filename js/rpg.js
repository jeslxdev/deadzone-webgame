// ============================================================
//  RPG — perfis, atributos, progressão, itens e loot
// ============================================================
import { CLASSES, WEAPONS, RARITIES, VALUABLES, CONSUMABLES, CONTAINERS, POINTS_PER_LEVEL, SKILLS, START_SKILLS, MAX_SKILL_RANK } from './data.js';
import { uid, randi, pick } from './util.js';

const KEY = 'zonamorta.profiles.v1';

// ---------- Perfis ----------
// Com o servidor (node server.js) os personagens ficam salvos POR SESSÃO no servidor:
// cada navegador/jogador recebe um cookie de sessão próprio e nada se mistura.
// Sem servidor (ex.: hospedagem estática), cai para o armazenamento do navegador.
const store = { mode: 'local', cache: [], pending: new Map(), timer: null };
export const storeMode = () => store.mode;
export async function initStore() {
  try {
    const r = await fetch('/api/profiles', { cache: 'no-store', credentials: 'same-origin' });
    if (!r.ok) throw new Error('sem api');
    let list = await r.json();
    store.mode = 'server';
    reportClient();
    // migra personagens antigos deste navegador para a sessão (uma vez).
    // O servidor recria cada um no nível 1 (progresso local não é confiável).
    if (!list.length && !localStorage.getItem('zonamorta.migrated')) {
      const old = JSON.parse(localStorage.getItem(KEY) || '[]');
      for (const p of old) await fetch('/api/profiles/' + p.id, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(p) });
      if (old.length) list = await (await fetch('/api/profiles', { cache: 'no-store', credentials: 'same-origin' })).json();
      localStorage.setItem('zonamorta.migrated', '1');
    }
    store.cache = list.map(migrateProfile);
  } catch { store.mode = 'local'; }
  return store.mode;
}
// Idioma, fuso e tela do navegador (ajudam a entender quem joga; sem dados de identificação).
function reportClient() {
  let tz = '';
  try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch {}
  const body = { lang: navigator.language || '', tz, screen: `${window.screen.width}x${window.screen.height}` };
  fetch('/api/session/client', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).catch(() => {});
}
export async function getSession() { try { return await (await fetch('/api/session', { cache: 'no-store' })).json(); } catch { return null; } }
export async function restoreSession(sid) {
  const r = await fetch('/api/session/restore', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sid: sid.trim() }) });
  if (!r.ok) throw new Error((await r.json()).error || 'falhou');
  return initStore();
}
// O servidor devolve a versão oficial do perfil (ele recusa XP, dinheiro e
// itens que não emitiu). Ela é aplicada no MESMO objeto em uso pelo jogo.
const OFFICIAL = ['level', 'xp', 'money', 'stats', 'cleared', 'points', 'sp'];
export function adoptProfile(p, server, full = true) {
  if (!server || server.id !== p.id) return p;
  for (const k of OFFICIAL) p[k] = server[k];
  if (full) for (const k of Object.keys(server)) if (!OFFICIAL.includes(k)) p[k] = server[k];
  const i = store.cache.findIndex((x) => x.id === p.id);
  if (i >= 0 && store.cache[i] !== p) store.cache[i] = p;
  return p;
}
const inflight = new Set();
function pushSave(p, keepalive = false) {
  const body = JSON.stringify(p);
  const job = fetch('/api/profiles/' + p.id, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body, keepalive: keepalive && body.length < 60000 })
    .then((r) => (r.ok ? r.json() : null))
    .then((r) => {
      // só substitui tudo se nada mudou localmente depois do envio
      if (r && r.profile) adoptProfile(p, r.profile, !store.pending.has(p.id) && JSON.stringify(p) === body);
    })
    .catch(() => {})
    .finally(() => inflight.delete(job));
  inflight.add(job);
  return job;
}
export function flushSaves(keepalive = true) {
  if (store.mode !== 'server') return;
  clearTimeout(store.timer);
  for (const p of store.pending.values()) pushSave(p, keepalive);
  store.pending.clear();
}
// espera os salvamentos pendentes chegarem ao servidor (ex.: antes de abrir uma partida)
export async function savesSettled() {
  flushSaves(false);
  await Promise.all([...inflight]);
}
export function listProfiles() {
  if (store.mode === 'server') return store.cache;
  try { return (JSON.parse(localStorage.getItem(KEY)) || []).map(migrateProfile); } catch { return []; }
}
function writeAll(list) { localStorage.setItem(KEY, JSON.stringify(list)); }
export function getProfile(id) { return listProfiles().find((p) => p.id === id) || null; }
export function saveProfile(p) {
  p.updated = Date.now();
  if (store.mode === 'server') {
    const i = store.cache.findIndex((x) => x.id === p.id);
    if (i >= 0) store.cache[i] = p; else store.cache.push(p);
    if (i < 0) { pushSave(p); return; } // personagem novo: o servidor cria na hora
    store.pending.set(p.id, p);
    clearTimeout(store.timer);
    store.timer = setTimeout(() => { for (const q of store.pending.values()) pushSave(q); store.pending.clear(); }, 400);
    return;
  }
  const list = listProfiles();
  const i = list.findIndex((x) => x.id === p.id);
  if (i >= 0) list[i] = p; else list.push(p);
  writeAll(list);
}
export function deleteProfile(id) {
  if (store.mode === 'server') {
    store.cache = store.cache.filter((p) => p.id !== id);
    store.pending.delete(id);
    fetch('/api/profiles/' + id, { method: 'DELETE' }).catch(() => {});
    return;
  }
  writeAll(listProfiles().filter((p) => p.id !== id));
}

export function createProfile({ name, cls, appearance }) {
  return {
    id: uid(), version: 1, name, cls, appearance,
    level: 1, xp: 0, points: 0,
    attrs: { for: 0, agi: 0, vit: 0, pre: 0, sor: 0 },
    money: 150,
    equipped: makeWeapon(CLASSES[cls].startWeapon, 0, 1),
    stash: [{ uid: uid(), kind: 'consumable', id: 'bandagem', qty: 3 }],
    cleared: [],
    stats: { kills: 0, bosses: 0, minibosses: 0, nests: 0, runs: 0, deaths: 0, extracted: 0 },
    created: Date.now(),
    sp: 1,
    skills: { learned: Object.fromEntries(START_SKILLS[cls].map((k) => [k, 1])), slots: [...START_SKILLS[cls], null, null] },
  };
}

// Garante campos novos em perfis antigos
export function migrateProfile(p) {
  if (!p.skills) p.skills = { learned: Object.fromEntries(START_SKILLS[p.cls].map((k) => [k, 1])), slots: [...START_SKILLS[p.cls], null, null] };
  if (p.sp === undefined) p.sp = p.level;
  return p;
}
export function canLearn(p, id) {
  const S = SKILLS[id], r = p.skills.learned[id] || 0;
  if (!S || (S.cls !== 'all' && S.cls !== p.cls)) return false;
  return p.level >= S.lvl && p.sp > 0 && r < MAX_SKILL_RANK;
}
export function learnSkill(p, id) {
  if (!canLearn(p, id)) return false;
  p.sp--;
  p.skills.learned[id] = (p.skills.learned[id] || 0) + 1;
  if (!p.skills.slots.includes(id)) { const i = p.skills.slots.indexOf(null); if (i >= 0) p.skills.slots[i] = id; }
  return true;
}

// Código de exportação: permite levar o personagem para outro navegador/mundo.
export function exportProfile(p) {
  const json = JSON.stringify(p);
  return 'ZM1:' + btoa(unescape(encodeURIComponent(json)));
}
export function importProfile(code) {
  code = code.trim();
  if (!code.startsWith('ZM1:')) throw new Error('Código inválido');
  const p = JSON.parse(decodeURIComponent(escape(atob(code.slice(4)))));
  if (!p || !p.id || !CLASSES[p.cls] || !p.appearance) throw new Error('Personagem corrompido');
  p.attrs = Object.assign({ for: 0, agi: 0, vit: 0, pre: 0, sor: 0 }, p.attrs);
  p.stats = Object.assign({ kills: 0, bosses: 0, minibosses: 0, nests: 0, runs: 0, deaths: 0, extracted: 0 }, p.stats);
  p.stash = p.stash || []; p.cleared = p.cleared || [];
  return migrateProfile(p);
}

// ---------- Progressão ----------
export function xpToNext(level) { return Math.floor(80 * Math.pow(level, 1.45)); }

export function grantXp(p, amount) {
  p.xp += amount;
  let gained = 0;
  while (p.xp >= xpToNext(p.level)) {
    p.xp -= xpToNext(p.level);
    p.level++;
    p.points += POINTS_PER_LEVEL;
    p.sp = (p.sp || 0) + 1;
    gained++;
  }
  return gained;
}

export function deriveStats(p) {
  const c = CLASSES[p.cls], a = p.attrs;
  return {
    maxHp: Math.round(c.hp + a.vit * 12 + (p.level - 1) * 6),
    regen: 0.4 + a.vit * 0.15,
    speed: c.speed * (1 + a.agi * 0.012),
    atkSpeed: 1 + a.agi * 0.02,
    melee: 1 + a.for * 0.04,
    gun: 1 + a.pre * 0.035,
    crit: Math.min(0.6, 0.05 + a.pre * 0.008 + a.sor * 0.004),
    critMult: 1.8,
    luck: a.sor * 0.02,
    moneyMult: 1 + a.sor * 0.03,
    bagSlots: 16 + Math.floor(a.for / 2),
    armor: c.armor,
    lifesteal: c.lifesteal,
    dashCd: c.dashCd,
    spreadMult: Math.max(0.4, 1 - a.pre * 0.02),
    skillPower: 1 + (p.level - 1) * 0.06,
  };
}

// ---------- Itens ----------
export function makeWeapon(base, rarity = 0, ilvl = 1) {
  return { uid: uid(), kind: 'weapon', base, rarity, ilvl };
}

export function weaponStats(w) {
  const b = WEAPONS[w.base];
  const r = RARITIES[w.rarity];
  const scale = r.mult * (1 + 0.08 * (w.ilvl - 1));
  const s = { ...b, dmg: b.dmg * scale };
  // raridades altas também melhoram atributos secundários
  if (b.type === 'gun') {
    s.mag = Math.round(b.mag * (1 + w.rarity * 0.1));
    s.reload = b.reload * (1 - w.rarity * 0.05);
  } else {
    s.rate = b.rate * (1 + w.rarity * 0.04);
  }
  return s;
}

export function itemValue(item) {
  if (item.kind === 'weapon') {
    const b = WEAPONS[item.base];
    return Math.round(b.value * RARITIES[item.rarity].value * (1 + 0.15 * (item.ilvl - 1)));
  }
  if (item.kind === 'valuable') return VALUABLES[item.id].value * (item.qty || 1);
  if (item.kind === 'consumable') return CONSUMABLES[item.id].value * (item.qty || 1);
  return 0;
}

export function itemInfo(item) {
  if (item.kind === 'weapon') {
    const b = WEAPONS[item.base], r = RARITIES[item.rarity], s = weaponStats(item);
    const line = b.type === 'gun'
      ? `Dano ${s.dmg.toFixed(0)}${b.pellets > 1 ? '×' + b.pellets : ''} · ${b.rate}/s · Pente ${s.mag}`
      : `Dano ${s.dmg.toFixed(0)} · ${s.rate.toFixed(1)}/s · Alcance ${b.reach}`;
    return {
      name: b.name, icon: b.icon, color: r.color, rarity: r.name,
      desc: `${line} · Nv ${item.ilvl}`, cls: b.cls, value: itemValue(item),
    };
  }
  if (item.kind === 'valuable') {
    const v = VALUABLES[item.id];
    const r = RARITIES[Math.min(4, v.tier)];
    return { name: v.name, icon: v.icon, color: r.color, rarity: r.name, desc: `Valor unitário ${v.value}`, value: itemValue(item) };
  }
  const c = CONSUMABLES[item.id];
  return {
    name: c.name, icon: c.icon, color: '#e6e6e6', rarity: 'Consumível',
    desc: c.heal ? `Cura ${c.heal} de vida (tecla ${c.key})` : `Cura ${Math.round(c.healPct * 100)}% da vida (tecla ${c.key})`,
    value: itemValue(item),
  };
}

export function rollRarity(luck = 0, tier = 0, minRarity = 0) {
  const base = [60, 25, 10, 4, 1];
  const f = 1 + 0.55 * tier + luck * 3;
  const w = base.map((b, i) => b * Math.pow(f, i));
  for (let i = 0; i < minRarity; i++) w[i] = 0;
  const total = w.reduce((a, b) => a + b, 0);
  let x = Math.random() * total;
  for (let i = 0; i < w.length; i++) { x -= w[i]; if (x <= 0) return i; }
  return 4;
}

export function randomWeapon(cls, mapLevel, luck, tier, minRarity = 0) {
  const pool = Object.keys(WEAPONS).filter((k) => WEAPONS[k].cls === cls);
  return makeWeapon(pick(pool), rollRarity(luck, tier, minRarity), Math.max(1, mapLevel + randi(0, 2)));
}

function rollValuable(tier, luck) {
  const opts = {};
  for (const k in VALUABLES) {
    const v = VALUABLES[k];
    if (v.tier > tier + 1) continue;
    let w = v.weight;
    if (v.tier > tier) w *= 0.2 + luck;
    if (v.tier < tier - 1) w *= Math.pow(0.3, tier - 1 - v.tier);
    opts[k] = w;
  }
  let total = 0;
  for (const k in opts) total += opts[k];
  let x = Math.random() * total;
  for (const k in opts) { x -= opts[k]; if (x <= 0) return k; }
  return 'sucata';
}

export function rollLoot(containerType, mapLevel, profile) {
  const C = CONTAINERS[containerType];
  const st = deriveStats(profile);
  const items = [];
  const tier = Math.min(4, C.tier + Math.floor((mapLevel - 1) / 4));
  if (Math.random() < C.weaponChance) {
    const cls = Math.random() < 0.7 ? profile.cls : (profile.cls === 'atirador' ? 'samurai' : 'atirador');
    items.push(randomWeapon(cls, mapLevel, st.luck, tier, C.minRarity || 0));
  }
  const n = randi(C.rolls[0], C.rolls[1]);
  for (let i = 0; i < n; i++) {
    if (Math.random() < 0.16) {
      items.push({ uid: uid(), kind: 'consumable', id: Math.random() < 0.7 ? 'bandagem' : 'medkit', qty: 1 });
    } else {
      items.push({ uid: uid(), kind: 'valuable', id: rollValuable(tier, st.luck), qty: 1 });
    }
  }
  return items;
}

export function zombieDrop(rank, mapLevel, profile) {
  const st = deriveStats(profile);
  const out = [];
  const chance = { normal: 0.07, elite: 0.5, miniboss: 1, boss: 1 }[rank];
  if (Math.random() < chance + st.luck * 0.5) {
    out.push({ uid: uid(), kind: 'valuable', id: rollValuable(rank === 'normal' ? 0 : 2, st.luck), qty: 1 });
  }
  if (rank === 'miniboss') {
    out.push(randomWeapon(profile.cls, mapLevel, st.luck, 2, 2));
    out.push({ uid: uid(), kind: 'valuable', id: rollValuable(3, st.luck), qty: 1 });
  }
  if (rank === 'elite' && Math.random() < 0.12) out.push(randomWeapon(profile.cls, mapLevel, st.luck, 1, 1));
  return out;
}

// ---------- Mochila ----------
export function slotsUsed(bag) { return bag.length; }

export function addToBag(bag, item, maxSlots) {
  if (item.kind !== 'weapon') {
    const same = bag.find((x) => x.kind === item.kind && x.id === item.id);
    if (same) { same.qty = (same.qty || 1) + (item.qty || 1); return true; }
  }
  if (bag.length >= maxSlots) return false;
  bag.push(item);
  return true;
}

export function mergeInto(list, items) {
  for (const it of items) addToBag(list, it, Infinity);
}

export function countConsumable(bag, id) {
  const it = bag.find((x) => x.kind === 'consumable' && x.id === id);
  return it ? it.qty : 0;
}

export function takeConsumable(bag, id) {
  const i = bag.findIndex((x) => x.kind === 'consumable' && x.id === id);
  if (i < 0) return false;
  bag[i].qty--;
  if (bag[i].qty <= 0) bag.splice(i, 1);
  return true;
}
