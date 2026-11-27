// ============================================================
//  ZONA MORTA — servidor (sem dependências)
//  · Arquivos estáticos do jogo
//  · Sessões por cookie: cada jogador/navegador tem seus próprios
//    personagens salvos no servidor (data/sessions/<sessão>.json)
//  · API REST de perfis
//  · WebSocket próprio para salas co-op (anfitrião + convidados)
//  Uso: node server.js   (PORT=5173 por padrão)
// ============================================================
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const net = require('net');
const mysql = require('mysql2/promise');
const A = require('./authority.js');

const root = __dirname;
const port = Number(process.env.PORT) || 5173;
const dataDir = path.join(root, 'data', 'sessions');
fs.mkdirSync(dataDir, { recursive: true });
// segredo para assinar códigos de exportação (fica fora do repositório)
const SECRET = (() => {
  if (process.env.DEADZONE_SECRET && process.env.DEADZONE_SECRET.length >= 32) return process.env.DEADZONE_SECRET;
  const f = path.join(root, 'data', 'secret.key');
  try { return fs.readFileSync(f, 'utf8').trim(); } catch {}
  const s = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(f, s, { mode: 0o600 });
  return s;
})();
const RUNS_FILE = path.join(root, 'data', 'runs.json');
const dbPool = process.env.DB_NAME ? mysql.createPool({
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 8,
  charset: 'utf8mb4',
  timezone: 'Z',
}) : null;

const types = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.glb': 'model/gltf-binary',
};

// ---------- sessões ----------
const SID_RE = /^[a-f0-9]{32}$/;
function parseCookies(req) {
  const out = {};
  (req.headers.cookie || '').split(';').forEach((c) => { const i = c.indexOf('='); if (i > 0) out[c.slice(0, i).trim()] = decodeURIComponent(c.slice(i + 1).trim()); });
  return out;
}
function sessionOf(req, res) {
  let sid = parseCookies(req).zm_sid;
  if (!sid || !SID_RE.test(sid)) {
    sid = crypto.randomBytes(16).toString('hex');
    if (res) setSidCookie(res, sid, req);
  }
  return sid;
}
function setSidCookie(res, sid, req) {
  const secure = req?.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `zm_sid=${sid}; Path=/; Max-Age=31536000; HttpOnly; SameSite=Lax${secure}`);
}
const sessFile = (sid) => path.join(dataDir, sid + '.json');
function loadSession(sid) {
  try { return JSON.parse(fs.readFileSync(sessFile(sid), 'utf8')); } catch { return { profiles: [], created: Date.now() }; }
}
function saveSession(sid, data) {
  data.updated = Date.now();
  const tmp = sessFile(sid) + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data));
  fs.renameSync(tmp, sessFile(sid));
}
async function touchSession(sid) {
  if (!dbPool) return;
  await dbPool.execute(`INSERT INTO dz_sessions (session_id, created_at, last_seen_at)
    VALUES (?, UTC_TIMESTAMP(), UTC_TIMESTAMP())
    ON DUPLICATE KEY UPDATE last_seen_at = IF(last_seen_at < UTC_TIMESTAMP() - INTERVAL 1 MINUTE, UTC_TIMESTAMP(), last_seen_at)`, [sid]);
}
// ---------- origem do acesso (IP, navegador, região) ----------
// A região sai de uma base offline (geoip-lite): nenhum IP é enviado a terceiros.
// IP é dado pessoal (LGPD): é apagado depois de DEADZONE_IP_RETENTION_DAYS dias.
let geoip = null;
try { geoip = require('geoip-lite'); } catch { console.warn('geoip-lite ausente: região só pelo cabeçalho CF-IPCountry'); }
const IP_RETENTION_DAYS = Math.max(7, Number(process.env.DEADZONE_IP_RETENTION_DAYS) || 180);
const LOOPBACK = new Set(['127.0.0.1', '::1']);
const clip = (value, max) => { const s = String(value ?? '').trim(); return s ? s.slice(0, max) : null; };
function clientIp(req) {
  const peer = String(req.socket?.remoteAddress || '').replace(/^::ffff:/, '');
  let ip = peer;
  // Só confia no IP repassado quando a conexão vem do nginx local.
  if (LOOPBACK.has(peer)) {
    const forwarded = String(req.headers['x-real-ip'] || req.headers['x-forwarded-for'] || '').split(',')[0].trim().replace(/^::ffff:/, '');
    if (forwarded) ip = forwarded;
  }
  return net.isIP(ip) ? ip : null;
}
function requestInfo(req) {
  const ip = clientIp(req);
  let geo = null;
  try { geo = ip && geoip ? geoip.lookup(ip) : null; } catch { geo = null; }
  const cf = String(req.headers['cf-ipcountry'] || '').toUpperCase();
  return {
    ip,
    country: geo?.country || (/^[A-Z]{2}$/.test(cf) && !['XX', 'T1'].includes(cf) ? cf : null),
    region: clip(geo?.region, 80),
    city: clip(geo?.city, 80),
    ua: clip(req.headers['user-agent'], 400),
    lang: clip(req.headers['accept-language'], 120),
  };
}
async function addEvent(sid, type, info, dedupeMinutes) {
  if (!dbPool) return;
  await dbPool.execute(`INSERT INTO dz_session_events (session_id, event_type, ip, geo_country, geo_region, geo_city, user_agent, created_at)
    SELECT ?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP() FROM DUAL
    WHERE EXISTS (SELECT 1 FROM dz_sessions WHERE session_id = ?)
      AND NOT EXISTS (SELECT 1 FROM dz_session_events WHERE session_id = ? AND event_type = ? AND created_at >= UTC_TIMESTAMP() - INTERVAL ? MINUTE)`,
  [sid, type, info.ip, info.country, info.region, info.city, info.ua, sid, sid, type, dedupeMinutes]);
}
const accessSeen = new Map(); // sid -> último registro (ms), evita gravar a cada requisição
async function recordAccess(sid, req) {
  if (!dbPool) return;
  const now = Date.now();
  if (now - (accessSeen.get(sid) || 0) < 5 * 60 * 1000) return;
  if (accessSeen.size > 50000) accessSeen.clear();
  accessSeen.set(sid, now);
  const info = requestInfo(req);
  await dbPool.execute(`UPDATE dz_sessions SET first_ip = COALESCE(first_ip, ?), last_ip = ?, user_agent = ?, accept_language = ?,
    geo_country = ?, geo_region = ?, geo_city = ?, client_updated_at = UTC_TIMESTAMP() WHERE session_id = ?`,
  [info.ip, info.ip, info.ua, info.lang, info.country, info.region, info.city, sid]);
  await addEvent(sid, 'visit', info, 30);
}
async function saveClientInfo(sid, body) {
  if (!dbPool) return;
  const lang = /^[A-Za-z]{2,3}(-[A-Za-z0-9]{1,8}){0,3}$/.test(body.lang || '') ? body.lang : null;
  const tz = /^[A-Za-z0-9_+\-/]{1,64}$/.test(body.tz || '') ? body.tz : null;
  const screen = /^\d{2,5}x\d{2,5}$/.test(body.screen || '') ? body.screen : null;
  await dbPool.execute('UPDATE dz_sessions SET client_lang = ?, client_tz = ?, client_screen = ? WHERE session_id = ?', [lang, tz, screen, sid]);
}
async function purgeOldIps() {
  if (!dbPool) return;
  await dbPool.execute('UPDATE dz_session_events SET ip = NULL, user_agent = NULL WHERE ip IS NOT NULL AND created_at < UTC_TIMESTAMP() - INTERVAL ? DAY', [IP_RETENTION_DAYS]);
  await dbPool.execute('UPDATE dz_sessions SET first_ip = NULL, last_ip = NULL WHERE (first_ip IS NOT NULL OR last_ip IS NOT NULL) AND last_seen_at < UTC_TIMESTAMP() - INTERVAL ? DAY', [IP_RETENTION_DAYS]);
  await dbPool.execute('UPDATE dz_session_devices SET last_ip = NULL, user_agent = NULL WHERE last_ip IS NOT NULL AND last_seen_at < UTC_TIMESTAMP() - INTERVAL ? DAY', [IP_RETENTION_DAYS]).catch(() => {});
}
if (dbPool) {
  const purge = () => purgeOldIps().catch((e) => console.error('Deadzone IP retention error:', e.message));
  setTimeout(purge, 30 * 1000).unref();
  setInterval(purge, 6 * 60 * 60 * 1000).unref();
}

// ---------- identificação obrigatória (e-mail ou telefone) ----------
const CONSENT_VERSION = '2026-11';
const identities = new Map(); // sid -> { type, value } (cache)
function normContact(raw) {
  const s = String(raw ?? '').trim();
  if (s.includes('@')) {
    const e = s.toLowerCase();
    return e.length <= 190 && /^[a-z0-9._%+-]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,24}$/.test(e) ? { type: 'email', value: e } : null;
  }
  if (!/^[\d\s()+.-]{8,24}$/.test(s)) return null;
  const digits = s.replace(/\D/g, '');
  if (digits.length < 10 || digits.length > 15) return null;
  // sem DDI e com 10–11 dígitos: número brasileiro (+55)
  const full = s.startsWith('+') ? digits : digits.length <= 11 ? '55' + digits : digits;
  if (full.startsWith('55') && !/^55[1-9]{2}9?\d{8}$/.test(full)) return null;
  return { type: 'phone', value: '+' + full };
}
function maskContact(c) {
  if (!c) return null;
  if (c.type === 'email') { const [u, d] = c.value.split('@'); return u.slice(0, 2) + '***@' + d; }
  return c.value.slice(0, 3) + ' ••••• ' + c.value.slice(-4);
}
async function getIdentity(sid) {
  if (identities.has(sid)) return identities.get(sid);
  let id = null;
  if (!dbPool) id = loadSession(sid).contact || null;
  else {
    const [rows] = await dbPool.execute('SELECT contact_type, contact_value FROM dz_sessions WHERE session_id = ? AND consent_at IS NOT NULL', [sid]);
    if (rows[0] && rows[0].contact_value) id = { type: rows[0].contact_type, value: rows[0].contact_value };
  }
  if (id) { if (identities.size > 50000) identities.clear(); identities.set(sid, id); }
  return id;
}
async function setIdentity(sid, c, req) {
  if (!dbPool) { const d = loadSession(sid); d.contact = { ...c, at: Date.now(), consent: CONSENT_VERSION }; saveSession(sid, d); }
  else {
    await dbPool.execute(`UPDATE dz_sessions SET contact_type = ?, contact_value = ?, contact_at = UTC_TIMESTAMP(), consent_at = UTC_TIMESTAMP(), consent_version = ?
      WHERE session_id = ?`, [c.type, c.value, CONSENT_VERSION, sid]);
    await addEvent(sid, 'identify', requestInfo(req), 0);
  }
  identities.set(sid, c);
}
async function requireIdentity(sid) {
  if (!await getIdentity(sid)) throw new HttpError(403, 'Informe seu e-mail ou telefone para jogar.');
}

// ---------- aparelho usado (navegador, sistema, tela, GPU, rede...) ----------
// Os dados vêm do navegador (com aviso na tela de identificação) + cabeçalhos HTTP.
function cleanValue(v, depth = 0) {
  if (v === null || typeof v === 'boolean') return v;
  if (typeof v === 'number') return Number.isFinite(v) ? Math.round(v * 1000) / 1000 : null;
  if (typeof v === 'string') return v.replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 300);
  if (depth >= 3) return null;
  if (Array.isArray(v)) return v.slice(0, 30).map((x) => cleanValue(x, depth + 1));
  if (isObj(v)) {
    const o = {};
    for (const k of Object.keys(v).slice(0, 60)) if (/^[\w.-]{1,40}$/.test(k)) o[k] = cleanValue(v[k], depth + 1);
    return o;
  }
  return null;
}
function parseUa(ua, d) {
  const hint = isObj(d.uaData) ? d.uaData : {};
  let os = null, osv = null, br = null, brv = null;
  if (/Android/i.test(ua)) { os = 'Android'; osv = (ua.match(/Android ([\d.]+)/) || [])[1]; }
  else if (/iPhone|iPad|iPod/.test(ua)) { os = 'iOS'; osv = ((ua.match(/OS ([\d_]+)/) || [])[1] || '').replace(/_/g, '.'); }
  else if (/Windows NT/.test(ua)) { os = 'Windows'; osv = (ua.match(/Windows NT ([\d.]+)/) || [])[1]; }
  else if (/Mac OS X/.test(ua)) { os = 'macOS'; osv = ((ua.match(/Mac OS X ([\d_.]+)/) || [])[1] || '').replace(/_/g, '.'); }
  else if (/CrOS/.test(ua)) os = 'ChromeOS';
  else if (/Linux/.test(ua)) os = 'Linux';
  if (typeof hint.platform === 'string' && hint.platform) os = hint.platform;
  if (typeof hint.platformVersion === 'string' && hint.platformVersion) osv = hint.platformVersion;
  const m = ua.match(/(Edg|OPR|SamsungBrowser|Firefox|FxiOS|CriOS|Chrome|Version)\/([\d.]+)/);
  if (m) { br = { Edg: 'Edge', OPR: 'Opera', SamsungBrowser: 'Samsung Internet', FxiOS: 'Firefox', CriOS: 'Chrome', Version: /Safari/.test(ua) ? 'Safari' : 'Navegador' }[m[1]] || m[1]; brv = m[2]; }
  const mobile = hint.mobile === true || /Mobi|Android|iPhone/i.test(ua);
  const tablet = /iPad|Tablet/i.test(ua) || (/Android/i.test(ua) && !/Mobile/i.test(ua));
  return { os, osv, br, brv, kind: tablet ? 'tablet' : mobile ? 'mobile' : 'desktop', model: typeof hint.model === 'string' && hint.model ? hint.model : null };
}
async function saveDevice(sid, raw, req) {
  const d = cleanValue(raw) || {};
  const info = requestInfo(req);
  const ua = String(req.headers['user-agent'] || '').slice(0, 400);
  const hdr = {};
  for (const h of ['sec-ch-ua', 'sec-ch-ua-mobile', 'sec-ch-ua-platform', 'accept-language', 'cf-ipcountry', 'dnt', 'sec-gpc', 'referer']) if (req.headers[h]) hdr[h] = String(req.headers[h]).slice(0, 200);
  d.server = { ip: info.ip, country: info.country, region: info.region, city: info.city, headers: hdr, at: new Date().toISOString() };
  const u = parseUa(ua, d);
  const scr = isObj(d.screen) ? `${d.screen.w}x${d.screen.h}@${d.screen.dpr}` : null;
  const gpu = typeof d.gpu === 'string' ? d.gpu.slice(0, 200) : null;
  const fp = crypto.createHash('sha256').update(JSON.stringify([ua, u.model, gpu, scr, d.cores, d.memory, d.tz, d.platform])).digest('hex');
  if (!dbPool) {
    const data = loadSession(sid);
    data.devices = (data.devices || []).filter((x) => x.fp !== fp).slice(-9);
    data.devices.push({ fp, ...u, gpu, screen: scr, at: Date.now(), data: d });
    saveSession(sid, data);
    return;
  }
  const conn = isObj(d.net) ? [d.net.type, d.net.downlink && d.net.downlink + 'Mb/s'].filter(Boolean).join(' ') : null;
  await dbPool.execute(`INSERT INTO dz_session_devices (session_id, fingerprint, device_kind, os_name, os_version, browser_name, browser_version, device_model, gpu, screen,
      cpu_cores, memory_gb, timezone, language, connection, last_ip, geo_country, geo_region, geo_city, user_agent, device_json, first_seen_at, last_seen_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(), UTC_TIMESTAMP())
    ON DUPLICATE KEY UPDATE device_kind=VALUES(device_kind), os_version=VALUES(os_version), browser_version=VALUES(browser_version), connection=VALUES(connection),
      last_ip=VALUES(last_ip), geo_country=VALUES(geo_country), geo_region=VALUES(geo_region), geo_city=VALUES(geo_city), user_agent=VALUES(user_agent),
      device_json=VALUES(device_json), seen_count=seen_count+1, last_seen_at=UTC_TIMESTAMP()`,
  [sid, fp, u.kind, clip(u.os, 40), clip(u.osv, 40), clip(u.br, 40), clip(u.brv, 40), clip(u.model, 80), gpu, clip(scr, 40),
    Number.isInteger(d.cores) ? Math.min(d.cores, 1024) : null, typeof d.memory === 'number' ? Math.min(d.memory, 999) : null,
    clip(d.tz, 64), clip(d.lang, 35), clip(conn, 40), info.ip, info.country, info.region, info.city, ua || null, JSON.stringify(d)]);
  await dbPool.execute('UPDATE dz_sessions SET device_count = (SELECT COUNT(*) FROM dz_session_devices WHERE session_id = ?) WHERE session_id = ?', [sid, sid]);
}

async function updateGamePresence(sid, active, req) {
  if (!dbPool) return;
  const [prev] = await dbPool.execute('SELECT game_active, game_last_seen_at >= UTC_TIMESTAMP() - INTERVAL 90 SECOND AS fresh FROM dz_sessions WHERE session_id = ?', [sid]);
  const wasActive = Boolean(prev[0] && Number(prev[0].game_active));
  const wasPlaying = wasActive && Boolean(Number(prev[0].fresh));
  await dbPool.execute(`INSERT INTO dz_sessions (session_id, created_at, last_seen_at, game_started_at, game_last_seen_at, game_active)
    VALUES (?, UTC_TIMESTAMP(), UTC_TIMESTAMP(), IF(?, UTC_TIMESTAMP(), NULL), IF(?, UTC_TIMESTAMP(), NULL), ?)
    ON DUPLICATE KEY UPDATE last_seen_at=UTC_TIMESTAMP(), game_started_at=IF(?, COALESCE(game_started_at, UTC_TIMESTAMP()), game_started_at),
    game_last_seen_at=IF(?, UTC_TIMESTAMP(), game_last_seen_at), game_active=?`, [sid, active ? 1 : 0, active ? 1 : 0, active ? 1 : 0, active ? 1 : 0, active ? 1 : 0, active ? 1 : 0]);
  if (active && !wasPlaying) await addEvent(sid, 'game_start', requestInfo(req), 1);
  if (!active && wasActive) await addEvent(sid, 'game_end', requestInfo(req), 1);
}
async function listProfiles(sid) {
  let list;
  if (!dbPool) list = loadSession(sid).profiles;
  else {
    const [rows] = await dbPool.execute('SELECT profile_json FROM dz_profiles WHERE session_id = ? ORDER BY updated_at DESC', [sid]);
    list = rows.map((row) => typeof row.profile_json === 'string' ? JSON.parse(row.profile_json) : row.profile_json);
  }
  // a versão em memória (partida em andamento) é a mais nova
  return list.map((p) => { const c = pcache.get(sid + ':' + p.id); return c ? c.p : A.normalize(p); });
}
async function saveProfile(sid, p) {
  if (!dbPool) {
    const data = loadSession(sid), i = data.profiles.findIndex((x) => x.id === p.id);
    if (i >= 0) data.profiles[i] = p;
    else { if (data.profiles.length >= 12) return false; data.profiles.push(p); }
    saveSession(sid, data); return true;
  }
  const conn = await dbPool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.execute('SELECT session_id FROM dz_sessions WHERE session_id = ? FOR UPDATE', [sid]);
    const [existing] = await conn.execute('SELECT profile_id FROM dz_profiles WHERE session_id = ? AND profile_id = ? FOR UPDATE', [sid, p.id]);
    if (!existing.length) {
      const [count] = await conn.execute('SELECT COUNT(*) AS n FROM dz_profiles WHERE session_id = ?', [sid]);
      if (Number(count[0].n) >= 12) { await conn.rollback(); return false; }
    }
    await conn.execute(`INSERT INTO dz_profiles
      (session_id, profile_id, name, character_class, level, xp, money, attributes_json, stats_json, items_json, profile_json, created_ms, updated_ms)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE name=VALUES(name), character_class=VALUES(character_class), level=VALUES(level), xp=VALUES(xp), money=VALUES(money),
      attributes_json=VALUES(attributes_json), stats_json=VALUES(stats_json), items_json=VALUES(items_json), profile_json=VALUES(profile_json), updated_ms=VALUES(updated_ms), updated_at=UTC_TIMESTAMP()`,
    [sid, p.id, String(p.name || '').slice(0, 80), String(p.cls || '').slice(0, 24), Math.max(1, Number(p.level) || 1), Math.max(0, Number(p.xp) || 0), Math.max(0, Number(p.money) || 0), JSON.stringify(p.attrs || {}), JSON.stringify(p.stats || {}), JSON.stringify({ stash: p.stash || [], equipped: p.equipped || null, skills: p.skills || {} }), JSON.stringify(p), Number(p.created) || Date.now(), Number(p.updated) || Date.now()]);
    await conn.commit();
    return true;
  } catch (e) { await conn.rollback(); throw e; }
  finally { conn.release(); }
}
async function deleteProfile(sid, id) {
  dropCached(sid, id);
  if (!dbPool) {
    const data = loadSession(sid); data.profiles = data.profiles.filter((x) => x.id !== id); saveSession(sid, data); return;
  }
  await dbPool.execute('DELETE FROM dz_profiles WHERE session_id = ? AND profile_id = ?', [sid, id]);
}

// ---------- cache de perfis em jogo + trava por perfil ----------
// Cada mudança de um perfil passa por withLock (uma de cada vez). Durante a
// partida as gravações no banco são agrupadas (a cada ~2 s).
const pcache = new Map(); // sid:id -> { p, t, timer }
const locks = new Map();
function withLock(key, fn) {
  const prev = locks.get(key) || Promise.resolve();
  const run = prev.then(fn, fn);
  const tail = run.catch(() => {});
  locks.set(key, tail);
  tail.then(() => { if (locks.get(key) === tail) locks.delete(key); });
  return run;
}
async function fetchProfile(sid, id) {
  if (!dbPool) return loadSession(sid).profiles.find((x) => x.id === id) || null;
  const [rows] = await dbPool.execute('SELECT profile_json FROM dz_profiles WHERE session_id = ? AND profile_id = ? LIMIT 1', [sid, id]);
  if (!rows.length) return null;
  return typeof rows[0].profile_json === 'string' ? JSON.parse(rows[0].profile_json) : rows[0].profile_json;
}
async function loadProfile(sid, id) {
  const c = pcache.get(sid + ':' + id);
  if (c) { c.t = Date.now(); return c.p; }
  const p = await fetchProfile(sid, id);
  if (p) { A.normalize(p); pcache.set(sid + ':' + id, { p, t: Date.now(), timer: null }); }
  return p;
}
async function storeProfile(sid, p, now = true) {
  const key = sid + ':' + p.id;
  let c = pcache.get(key);
  if (!c) { c = { p, t: Date.now(), timer: null }; pcache.set(key, c); }
  c.p = p; c.t = Date.now();
  if (now) {
    clearTimeout(c.timer); c.timer = null;
    return saveProfile(sid, p);
  }
  if (!c.timer) c.timer = setTimeout(() => { c.timer = null; withLock(key, () => saveProfile(sid, c.p)).catch((e) => console.error('Deadzone save error:', e.message)); }, 2000);
  return true;
}
function dropCached(sid, id) {
  const c = pcache.get(sid + ':' + id);
  if (c) clearTimeout(c.timer);
  pcache.delete(sid + ':' + id);
}
async function flushAll() {
  const jobs = [];
  for (const [key, c] of pcache) if (c.timer) {
    clearTimeout(c.timer); c.timer = null;
    jobs.push(saveProfile(key.split(':')[0], c.p).catch((e) => console.error('Deadzone flush error:', e.message)));
  }
  await Promise.all(jobs);
}
setInterval(() => { // libera perfis parados da memória
  const now = Date.now();
  for (const [key, c] of pcache) if (!c.timer && now - c.t > 20 * 60 * 1000) pcache.delete(key);
}, 60 * 1000).unref();

// sessões que estão em alguma sala co-op junto com `sid`
function peerSids(sid) {
  const out = new Set([sid]);
  for (const r of rooms.values()) {
    const ms = [...r.members.values()];
    if (ms.some((c) => c.sid === sid)) for (const c of ms) out.add(c.sid);
  }
  return out;
}

// ---------- proteção da API ----------
const buckets = new Map();
function rateOk(key, perSec, burst) {
  const now = Date.now();
  let b = buckets.get(key);
  if (!b) { b = { t: burst, last: now }; buckets.set(key, b); }
  b.t = Math.min(burst, b.t + ((now - b.last) / 1000) * perSec);
  b.last = now;
  if (b.t < 1) return false;
  b.t -= 1;
  return true;
}
setInterval(() => { const now = Date.now(); for (const [k, b] of buckets) if (now - b.last > 10 * 60 * 1000) buckets.delete(k); }, 60 * 1000).unref();
const EXTRA_ORIGINS = new Set(String(process.env.DEADZONE_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean));
// bloqueia requisições de outros sites (CSRF) e WebSocket de páginas de terceiros
function sameOrigin(req) {
  const o = req.headers.origin;
  if (!o) return true;
  try { const u = new URL(o); return u.host === req.headers.host || EXTRA_ORIGINS.has(u.origin); } catch { return false; }
}
const SEC_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'same-origin',
  'X-Frame-Options': 'DENY',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
};
function csp(req) {
  const host = String(req.headers.host || '').replace(/[^\w.:-]/g, '');
  // static.cloudflareinsights.com / cloudflareinsights.com: estatísticas do Cloudflare (injetadas pelo proxy)
  return ["default-src 'self'", "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://static.cloudflareinsights.com", "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com data:", "img-src 'self' data: blob:", "media-src 'self' data: blob:",
    `connect-src 'self' wss://${host} ws://${host} https://cdn.jsdelivr.net https://cloudflareinsights.com`, "worker-src 'self' blob:", "frame-src 'self'",
    "frame-ancestors 'none'", "object-src 'none'", "base-uri 'self'", "form-action 'self'"].join('; ');
}
const isObj = (o) => !!o && typeof o === 'object' && !Array.isArray(o);
const PID_RE = /^[a-z0-9]{4,40}$/i;
function parseJson(s) { const v = JSON.parse(s || '{}'); if (!isObj(v)) throw new Error('corpo inválido'); return v; }
function readBody(req, limit = 2 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > limit) { reject(new HttpError(413, 'conteúdo grande demais')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}
function json(res, code, obj) {
  res.writeHead(code, { ...SEC_HEADERS, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}
class HttpError extends Error { constructor(code, msg) { super(msg); this.code = code; } }

async function api(req, res, url) {
  const ip = clientIp(req) || 'x';
  if (!rateOk('api:' + ip, 40, 160)) return json(res, 429, { error: 'Muitas requisições. Aguarde um instante.' });
  if (req.method !== 'GET' && !sameOrigin(req)) return json(res, 403, { error: 'origem não permitida' });
  const sid = sessionOf(req, res);
  const parts = url.pathname.split('/').filter(Boolean); // api, ...
  try {
    // ----- partida: o servidor decide XP, loot, dinheiro e progresso -----
    if (parts[1] === 'runs' && req.method === 'POST') {
      const body = parseJson(await readBody(req, parts[2] === 'end' ? 1024 * 1024 : 4096));
      if (!parts[2]) { // começa uma partida
        if (!PID_RE.test(body.profileId || '')) return json(res, 400, { error: 'perfil inválido' });
        await requireIdentity(sid); // sem e-mail/telefone não joga
        return json(res, 200, await withLock(sid + ':' + body.profileId, async () => {
          const p = await loadProfile(sid, body.profileId);
          if (!p) throw new HttpError(404, 'personagem não encontrado');
          let run;
          try { run = A.startRun(sid, p, String(body.map || ''), body.guest === true); } catch (e) { throw new HttpError(422, e.message); }
          await storeProfile(sid, p, false);
          return { runId: run.id, state: A.summary(p) };
        }));
      }
      if (!rateOk('claim:' + sid, 30, 90)) return json(res, 429, { error: 'muitas ações' });
      const run = A.getRun(sid, body.runId);
      if (!run) return json(res, 409, { error: 'partida não encontrada' });
      const key = sid + ':' + run.profileId;
      if (parts[2] === 'claim') {
        return json(res, 200, await withLock(key, async () => {
          const p = await loadProfile(sid, run.profileId);
          if (!p) throw new HttpError(404, 'personagem não encontrado');
          let out;
          try { out = A.claim(run, p, body); } catch (e) { throw new HttpError(422, e.message); }
          await storeProfile(sid, p, false);
          return out;
        }));
      }
      if (parts[2] === 'end') { // extração / morte / saída
        const kind = ['extract', 'death', 'quit'].includes(body.kind) ? body.kind : 'quit';
        return json(res, 200, await withLock(key, async () => {
          const old = await loadProfile(sid, run.profileId);
          if (!old) throw new HttpError(404, 'personagem não encontrado');
          const p = isObj(body.profile) && body.profile.id === old.id ? A.reconcile(old, body.profile, kind === 'death' ? null : run) : old;
          A.endRun(run, p, kind);
          await storeProfile(sid, p, true);
          return { profile: p };
        }));
      }
      return json(res, 404, { error: 'não encontrado' });
    }
    // ----- mercado do acampamento -----
    if (parts[1] === 'shop' && req.method === 'POST' && (parts[2] === 'buy' || parts[2] === 'sell')) {
      const body = parseJson(await readBody(req, 64 * 1024));
      if (!PID_RE.test(body.profileId || '')) return json(res, 400, { error: 'perfil inválido' });
      if (!rateOk('shop:' + sid, 6, 20)) return json(res, 429, { error: 'muitas compras seguidas' });
      return json(res, 200, await withLock(sid + ':' + body.profileId, async () => {
        const p = await loadProfile(sid, body.profileId);
        if (!p) throw new HttpError(404, 'personagem não encontrado');
        let out;
        try {
          if (parts[2] === 'buy') out = { got: A.shopBuy(p, String(body.id || '')) };
          else out = { total: A.sell(p, Array.isArray(body.uids) ? body.uids.map(String).slice(0, 500) : [], body.all === true) };
        } catch (e) { throw new HttpError(422, e.message); }
        await storeProfile(sid, p, true);
        return { ...out, profile: p };
      }));
    }
    await touchSession(sid);
    await recordAccess(sid, req).catch((e) => console.error('Deadzone access log error:', e.message));
    if (parts[1] === 'session' && !parts[2] && req.method === 'GET') return json(res, 200, { sid, rooms: rooms.size });
    if (parts[1] === 'session' && parts[2] === 'client' && req.method === 'POST') {
      const body = JSON.parse(await readBody(req, 2048) || '{}');
      await saveClientInfo(sid, body && typeof body === 'object' ? body : {});
      return json(res, 200, { ok: true });
    }
    if (parts[1] === 'identity' && !parts[2]) {
      if (req.method === 'GET') {
        const id = await getIdentity(sid);
        return json(res, 200, { identified: !!id, type: id?.type || null, masked: maskContact(id), consentVersion: CONSENT_VERSION });
      }
      if (req.method === 'POST') {
        if (!rateOk('ident:' + sid, 10 / 3600, 10)) return json(res, 429, { error: 'Muitas tentativas. Tente mais tarde.' });
        const body = parseJson(await readBody(req, 4096));
        if (body.consent !== true) return json(res, 400, { error: 'É preciso aceitar o aviso de privacidade.' });
        const c = normContact(body.contact);
        if (!c) return json(res, 400, { error: 'Informe um e-mail válido ou um telefone com DDD.' });
        await setIdentity(sid, c, req);
        return json(res, 200, { identified: true, type: c.type, masked: maskContact(c) });
      }
    }
    if (parts[1] === 'session' && parts[2] === 'device' && req.method === 'POST') {
      const body = parseJson(await readBody(req, 32 * 1024));
      if (rateOk('dev:' + sid, 1 / 120, 4)) await saveDevice(sid, body, req);
      return json(res, 200, { ok: true });
    }
    if (parts[1] === 'game' && parts[2] === 'presence' && req.method === 'POST') {
      const body = JSON.parse(await readBody(req, 2048) || '{}');
      await updateGamePresence(sid, body.active === true, req);
      return json(res, 200, { ok: true });
    }
    if (parts[1] === 'feedback' && req.method === 'POST') {
      const body = JSON.parse(await readBody(req, 8192) || '{}');
      const category = String(body.category || 'geral').slice(0, 24);
      const message = String(body.message || '').trim().slice(0, 2000);
      if (!['bug', 'audio', 'visual', 'ideia', 'geral'].includes(category) || message.length < 8) return json(res, 400, { error: 'Escolha uma categoria e escreva pelo menos 8 caracteres.' });
      if (dbPool) {
        const [recent] = await dbPool.execute('SELECT COUNT(*) AS n FROM dz_feedback WHERE session_id = ? AND created_at >= UTC_TIMESTAMP() - INTERVAL 1 HOUR', [sid]);
        if (Number(recent[0].n) >= 8) return json(res, 429, { error: 'Você já enviou vários feedbacks. Tente novamente mais tarde.' });
        await dbPool.execute('INSERT INTO dz_feedback (session_id, category, message) VALUES (?, ?, ?)', [sid, category, message]);
      }
      else return json(res, 503, { error: 'Feedback indisponível sem o banco configurado.' });
      return json(res, 201, { ok: true });
    }
    if (parts[1] === 'session' && parts[2] === 'restore' && req.method === 'POST') {
      const { sid: want } = JSON.parse(await readBody(req) || '{}');
      if (!SID_RE.test(want || '')) return json(res, 404, { error: 'Código de sessão não encontrado' });
      if (dbPool) {
        const [rows] = await dbPool.execute('SELECT session_id FROM dz_sessions WHERE session_id = ? LIMIT 1', [want]);
        if (!rows.length) return json(res, 404, { error: 'Código de sessão não encontrado' });
      } else if (!fs.existsSync(sessFile(want))) return json(res, 404, { error: 'Código de sessão não encontrado' });
      setSidCookie(res, want, req);
      return json(res, 200, { ok: true });
    }
    if (parts[1] === 'profiles') {
      if (req.method === 'GET' && !parts[2]) return json(res, 200, await listProfiles(sid));
      if (parts[2] === 'import' && req.method === 'POST') {
        const body = parseJson(await readBody(req, 1024 * 1024));
        let code;
        try { code = A.readCode(body.code, SECRET); } catch (e) { return json(res, 400, { error: e.message }); }
        if (!PID_RE.test(code.id)) return json(res, 400, { error: 'Personagem corrompido' });
        return json(res, 200, await withLock(sid + ':' + code.id, async () => {
          // o personagem é MOVIDO: existe uma única cópia dele no servidor
          const here = await loadProfile(sid, code.id);
          if (here) return { profile: here, moved: false };
          let p = A.normalize(code);
          if (dbPool) {
            const [rows] = await dbPool.execute('SELECT session_id FROM dz_profiles WHERE profile_id = ? LIMIT 1', [code.id]);
            if (rows.length) {
              const other = rows[0].session_id;
              await withLock(other + ':' + code.id, async () => {
                const cur = await loadProfile(other, code.id);
                if (cur) p = cur;
                if (!await saveProfile(sid, p)) throw new HttpError(400, 'limite de personagens');
                A.currentRun(other, code.id) && A.endRun(A.currentRun(other, code.id), p, 'quit');
                await deleteProfile(other, code.id);
              });
              pcache.set(sid + ':' + p.id, { p, t: Date.now(), timer: null });
              return { profile: p, moved: true };
            }
          }
          if (!await storeProfile(sid, p, true)) throw new HttpError(400, 'limite de personagens');
          return { profile: p, moved: false };
        }));
      }
      const id = parts[2];
      if (!id || !PID_RE.test(id)) return json(res, 400, { error: 'id inválido' });
      if (parts[3] === 'export' && req.method === 'GET') {
        const p = await withLock(sid + ':' + id, () => loadProfile(sid, id));
        if (!p) return json(res, 404, { error: 'personagem não encontrado' });
        return json(res, 200, { code: A.exportCode(p, SECRET) });
      }
      if (req.method === 'PUT' && !parts[3]) {
        const client = parseJson(await readBody(req, 1024 * 1024));
        if (client.id !== id) return json(res, 400, { error: 'perfil inválido' });
        return json(res, 200, await withLock(sid + ':' + id, async () => {
          const old = await loadProfile(sid, id);
          if (!old) await requireIdentity(sid);
          // personagem novo nasce no servidor (nível 1, itens iniciais); um existente só aceita mudanças permitidas
          const p = old ? A.reconcile(old, client, A.currentRun(sid, id)) : A.newProfile(client);
          if (!p) throw new HttpError(400, 'perfil inválido');
          if (!await storeProfile(sid, p, true)) { dropCached(sid, id); throw new HttpError(400, 'limite de personagens'); }
          return { ok: true, profile: p };
        }));
      }
      if (req.method === 'DELETE' && !parts[3]) {
        await withLock(sid + ':' + id, () => deleteProfile(sid, id));
        return json(res, 200, { ok: true });
      }
    }
    json(res, 404, { error: 'não encontrado' });
  } catch (e) {
    if (e instanceof HttpError) return json(res, e.code, { error: e.message });
    if (e instanceof SyntaxError) return json(res, 400, { error: 'JSON inválido' });
    console.error('Deadzone API error:', e);
    json(res, 500, { error: 'erro interno' });
  }
}

// ---------- HTTP ----------
// Só o que o navegador precisa é público: o código do servidor, dados,
// dependências e configurações nunca são servidos.
const PUBLIC_RE = /^\/(?:index\.html|favicon\.ico|(?:js|css|assets|models|sounds)\/[\w\-. /]+)$/;
const server = http.createServer((req, res) => {
  let url, p;
  try { url = new URL(req.url, 'http://x'); p = decodeURIComponent(url.pathname); }
  catch { res.writeHead(400, SEC_HEADERS); return res.end(); }
  if (url.pathname.startsWith('/api/')) return api(req, res, url);
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405, SEC_HEADERS); return res.end(); }
  if (p === '/') p = '/index.html';
  if (!PUBLIC_RE.test(p) || p.includes('..') || p.includes('/.')) { res.writeHead(404, { ...SEC_HEADERS, 'Cache-Control': 'no-store' }); return res.end('404'); }
  const file = path.join(root, path.normalize(p));
  if (!file.startsWith(root + path.sep)) { res.writeHead(403, SEC_HEADERS); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404, { ...SEC_HEADERS, 'Cache-Control': 'no-store' }); return res.end('404'); }
    const ext = path.extname(file).toLowerCase();
    const headers = { ...SEC_HEADERS, 'Content-Type': types[ext] || 'application/octet-stream', 'Cache-Control': 'no-store' };
    if (ext === '.html') { sessionOf(req, res); headers['Content-Security-Policy'] = csp(req); } // garante cookie de sessão
    res.writeHead(200, headers);
    res.end(req.method === 'HEAD' ? undefined : data);
  });
});

// ---------- WebSocket (RFC 6455, mínimo) ----------
const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const WS_MAX = 1024 * 1024; // maior mensagem aceita (o snapshot do co-op fica bem abaixo)
let nextId = 1;
const rooms = new Map(); // código -> { code, host, members: Map<id, client>, map, seed }

function wsSend(c, obj) {
  if (c.closed) return;
  const payload = Buffer.from(JSON.stringify(obj));
  const len = payload.length;
  let head;
  if (len < 126) head = Buffer.from([0x81, len]);
  else if (len < 65536) { head = Buffer.alloc(4); head[0] = 0x81; head[1] = 126; head.writeUInt16BE(len, 2); }
  else { head = Buffer.alloc(10); head[0] = 0x81; head[1] = 127; head.writeBigUInt64BE(BigInt(len), 2); }
  c.sock.write(Buffer.concat([head, payload]));
}
function wsClose(c) {
  if (c.closed) return;
  c.closed = true;
  try { c.sock.end(Buffer.from([0x88, 0])); } catch {}
  leaveRoom(c);
}

server.on('upgrade', (req, sock) => {
  let pathname = '';
  try { pathname = new URL(req.url, 'http://x').pathname; } catch {}
  if (pathname !== '/ws' || !sameOrigin(req)) return sock.destroy();
  if (!rateOk('ws:' + (clientIp(req) || 'x'), 1, 12)) return sock.destroy();
  const key = req.headers['sec-websocket-key'];
  if (!key || !/^[A-Za-z0-9+/=]{16,40}$/.test(key)) return sock.destroy();
  const accept = crypto.createHash('sha1').update(key + GUID).digest('base64');
  sock.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + accept + '\r\n\r\n');
  sock.setNoDelay(true);
  const c = { id: nextId++, sock, sid: sessionOf(req, null), room: null, info: null, buf: Buffer.alloc(0), frag: [], fragLen: 0, closed: false, alive: true, joinFails: [], dropped: 0 };
  touchSession(c.sid).catch((e) => console.error('Deadzone session DB error:', e.message));
  sock.on('data', (d) => {
    c.buf = Buffer.concat([c.buf, d]);
    if (c.buf.length > WS_MAX + 16) return wsClose(c);
    parseFrames(c);
  });
  sock.on('close', () => wsClose(c));
  sock.on('error', () => wsClose(c));
  wsSend(c, { t: 'hello', id: c.id });
});

function parseFrames(c) {
  while (c.buf.length >= 2) {
    const b0 = c.buf[0], b1 = c.buf[1];
    const fin = (b0 & 0x80) !== 0, op = b0 & 0x0f, masked = (b1 & 0x80) !== 0;
    let len = b1 & 0x7f, off = 2;
    if (len === 126) { if (c.buf.length < 4) return; len = c.buf.readUInt16BE(2); off = 4; }
    else if (len === 127) { if (c.buf.length < 10) return; len = Number(c.buf.readBigUInt64BE(2)); off = 10; }
    if (len > WS_MAX || !masked) return wsClose(c); // cliente sempre mascara (RFC 6455)
    const need = off + (masked ? 4 : 0) + len;
    if (c.buf.length < need) return;
    let data = c.buf.subarray(off + (masked ? 4 : 0), need);
    if (masked) {
      const mask = c.buf.subarray(off, off + 4);
      data = Buffer.from(data);
      for (let i = 0; i < data.length; i++) data[i] ^= mask[i & 3];
    }
    c.buf = c.buf.subarray(need);
    if (op === 0x8) return wsClose(c);
    if (op === 0x9) { c.sock.write(Buffer.concat([Buffer.from([0x8a, data.length]), data])); continue; }
    if (op === 0xa) { c.alive = true; continue; }
    if (op === 0x1 || op === 0x0) {
      c.frag.push(data); c.fragLen += data.length;
      if (c.fragLen > WS_MAX) return wsClose(c);
      if (fin) {
        const msg = Buffer.concat(c.frag).toString('utf8'); c.frag = []; c.fragLen = 0;
        // limite de mensagens por conexão (snapshots ~14/s + ações); excesso é descartado
        if (!rateOk('wsm:' + c.id, 160, 480)) { if (++c.dropped > 4000) return wsClose(c); continue; }
        try { onMessage(c, msg); } catch (e) { console.error('Deadzone ws error:', e.message); }
      }
    }
  }
}

function roomCode() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  let code;
  do { code = Array.from({ length: 4 }, () => A[(Math.random() * A.length) | 0]).join(''); } while (rooms.has(code));
  return code;
}
function roomState(r) {
  const players = [...r.members.values()].map((c) => ({ id: c.id, info: c.info, ready: !!c.ready, host: c === r.host }));
  return { t: 'room_state', code: r.code, phase: r.phase, map: r.map, seed: r.seed, hostId: r.host.id, players, allReady: r.phase === 'lobby' && players.length > 0 && players.every((p) => p.ready) };
}
function sendRoomState(r) { const state = roomState(r); for (const c of r.members.values()) wsSend(c, state); }
function leaveRoom(c) {
  const r = c.room;
  if (!r) return;
  c.room = null;
  r.members.delete(c.id);
  if (r.host === c) {
    for (const m of r.members.values()) { wsSend(m, { t: 'room_closed' }); m.room = null; }
    rooms.delete(r.code);
  } else {
    for (const m of r.members.values()) wsSend(m, { t: 'peer_leave', id: c.id });
    sendRoomState(r);
  }
}

const MAP_RE = /^[a-z0-9_-]{1,32}$/i;
function onMessage(c, raw) {
  let m;
  try { m = JSON.parse(raw); } catch { return; }
  if (!isObj(m)) return;
  switch (m.t) {
    case 'host': {
      const info = A.sanitizeInfo(m.info);
      if (!info || !MAP_RE.test(String(m.map || ''))) return wsSend(c, { t: 'join_error', error: 'Dados de sala inválidos.' });
      if (rooms.size > 5000) return wsSend(c, { t: 'join_error', error: 'Servidor cheio, tente novamente.' });
      leaveRoom(c);
      const code = roomCode();
      const r = { code, host: c, members: new Map([[c.id, c]]), map: m.map, seed: Number(m.seed) | 0, phase: 'game' };
      c.ready = false;
      rooms.set(code, r);
      c.room = r; c.info = info;
      wsSend(c, { t: 'hosted', code, id: c.id });
      break;
    }
    case 'join': {
      // evita adivinhar códigos de sala por força bruta
      const now = Date.now();
      c.joinFails = c.joinFails.filter((t) => now - t < 60000);
      if (c.joinFails.length >= 8) return wsSend(c, { t: 'join_error', error: 'Muitas tentativas. Aguarde um minuto.' });
      const info = A.sanitizeInfo(m.info);
      if (!info) return wsSend(c, { t: 'join_error', error: 'Dados de jogador inválidos.' });
      m.info = info;
      const r = rooms.get(String(m.code || '').toUpperCase());
      if (!r) { c.joinFails.push(now); return wsSend(c, { t: 'join_error', error: 'Sala não encontrada (o anfitrião pode ter saído).' }); }
      if (r.phase === 'game' && r.members.size >= 4) return wsSend(c, { t: 'join_error', error: 'Sala cheia (máx. 4 jogadores).' });
      if (r.members.size >= 4) return wsSend(c, { t: 'join_error', error: 'Sala cheia (máx. 4 jogadores).' });
      leaveRoom(c);
      c.room = r; c.info = m.info; c.ready = false;
      const peers = [...r.members.values()].map((x) => ({ id: x.id, info: x.info }));
      r.members.set(c.id, c);
      wsSend(c, { t: 'joined', code: r.code, id: c.id, map: r.map, seed: r.seed, hostId: r.host.id, peers, phase: r.phase, players: roomState(r).players });
      for (const x of r.members.values()) if (x !== c) wsSend(x, { t: 'peer_join', id: c.id, info: c.info });
      if (r.phase === 'lobby') sendRoomState(r);
      break;
    }
    case 'leave': leaveRoom(c); break;
    case 'ready':
      if (c.room && c.room.phase === 'lobby') { c.ready = !!m.ready; sendRoomState(c.room); }
      break;
    case 'lobby':
      if (c.room && c === c.room.host) { c.room.phase = 'lobby'; for (const p of c.room.members.values()) p.ready = false; sendRoomState(c.room); }
      break;
    case 'start_room': {
      const r = c.room;
      if (!r || c !== r.host || r.phase !== 'lobby') break;
      const state = roomState(r);
      if (!state.allReady || typeof m.map !== 'string' || !MAP_RE.test(m.map)) { wsSend(c, { t: 'start_error', error: 'Todos precisam estar prontos.' }); break; }
      r.phase = 'game'; r.map = m.map; r.seed = Number(m.seed) | 0;
      for (const p of r.members.values()) p.ready = false;
      for (const x of r.members.values()) if (x !== c) wsSend(x, { t: 'start_game', code: r.code, map: r.map, seed: r.seed, hostId: r.host.id, peers: [...r.members.values()].filter((p) => p !== x).map((p) => ({ id: p.id, info: p.info })) });
      sendRoomState(r); wsSend(c, { t: 'started', code: r.code, map: r.map, seed: r.seed });
      break;
    }
    case 'b': // repassa a todos os outros da sala
      if (c.room) for (const x of c.room.members.values()) if (x !== c) wsSend(x, { t: 'b', from: c.id, d: m.d });
      break;
    case 'to': // mensagem direta
      if (c.room) { const x = c.room.members.get(m.to); if (x) wsSend(x, { t: 'm', from: c.id, d: m.d }); }
      break;
    case 'info': {
      const info = A.sanitizeInfo(m.info);
      if (!info) break;
      c.info = info;
      if (c.room) for (const x of c.room.members.values()) if (x !== c) wsSend(x, { t: 'peer_info', id: c.id, info: c.info });
      if (c.room) sendRoomState(c.room);
      break;
    }
  }
}

// ping periódico para detectar conexões mortas
setInterval(() => {
  for (const r of rooms.values()) for (const c of r.members.values()) {
    if (!c.alive) { wsClose(c); continue; }
    c.alive = false;
    try { c.sock.write(Buffer.from([0x89, 0])); } catch {}
  }
}, 25000);

// Ao parar (deploy/reinício): grava perfis pendentes e as partidas em andamento
let stopping = false;
async function shutdown() {
  if (stopping) return;
  stopping = true;
  try { fs.writeFileSync(RUNS_FILE, JSON.stringify({ at: Date.now(), runs: A.dumpRuns() })); } catch (e) { console.error('Deadzone runs dump error:', e.message); }
  await flushAll();
  process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

async function start() {
  await A.init({ peerSids });
  try {
    const saved = JSON.parse(fs.readFileSync(RUNS_FILE, 'utf8'));
    if (Date.now() - saved.at < 30 * 60 * 1000) A.loadRuns(saved.runs);
    fs.unlinkSync(RUNS_FILE);
  } catch {}
  if (dbPool) await dbPool.query('SELECT 1');
  server.listen(port, '127.0.0.1', () => {
    console.log(`Zona Morta rodando em http://localhost:${port}${dbPool ? ' · MySQL conectado' : ' · armazenamento local'}`);
    const nets = require('os').networkInterfaces();
    for (const list of Object.values(nets)) for (const n of list || []) if (n.family === 'IPv4' && !n.internal) console.log(`  Na rede local: http://${n.address}:${port}`);
  });
}
start().catch((e) => { console.error('Não foi possível inicializar o banco do jogo:', e.message); process.exitCode = 1; });
