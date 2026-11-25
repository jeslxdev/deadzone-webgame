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

const root = __dirname;
const port = Number(process.env.PORT) || 5173;
const dataDir = path.join(root, 'data', 'sessions');
fs.mkdirSync(dataDir, { recursive: true });
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
}
if (dbPool) {
  const purge = () => purgeOldIps().catch((e) => console.error('Deadzone IP retention error:', e.message));
  setTimeout(purge, 30 * 1000).unref();
  setInterval(purge, 6 * 60 * 60 * 1000).unref();
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
  if (!dbPool) return loadSession(sid).profiles;
  const [rows] = await dbPool.execute('SELECT profile_json FROM dz_profiles WHERE session_id = ? ORDER BY updated_at DESC', [sid]);
  return rows.map((row) => typeof row.profile_json === 'string' ? JSON.parse(row.profile_json) : row.profile_json);
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
  if (!dbPool) {
    const data = loadSession(sid); data.profiles = data.profiles.filter((x) => x.id !== id); saveSession(sid, data); return;
  }
  await dbPool.execute('DELETE FROM dz_profiles WHERE session_id = ? AND profile_id = ?', [sid, id]);
}
function readBody(req, limit = 2 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > limit) { reject(new Error('muito grande')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}
function json(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}

async function api(req, res, url) {
  const sid = sessionOf(req, res);
  const parts = url.pathname.split('/').filter(Boolean); // api, ...
  try {
    await touchSession(sid);
    await recordAccess(sid, req).catch((e) => console.error('Deadzone access log error:', e.message));
    if (parts[1] === 'session' && !parts[2] && req.method === 'GET') return json(res, 200, { sid, rooms: rooms.size });
    if (parts[1] === 'session' && parts[2] === 'client' && req.method === 'POST') {
      const body = JSON.parse(await readBody(req, 2048) || '{}');
      await saveClientInfo(sid, body && typeof body === 'object' ? body : {});
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
      const id = parts[2];
      if (!id || !/^[a-z0-9]{4,40}$/i.test(id)) return json(res, 400, { error: 'id inválido' });
      if (req.method === 'PUT') {
        const p = JSON.parse(await readBody(req));
        if (!p || p.id !== id || typeof p.name !== 'string') return json(res, 400, { error: 'perfil inválido' });
        if (!await saveProfile(sid, p)) return json(res, 400, { error: 'limite de personagens' });
        return json(res, 200, { ok: true });
      }
      if (req.method === 'DELETE') {
        await deleteProfile(sid, id);
        return json(res, 200, { ok: true });
      }
    }
    json(res, 404, { error: 'não encontrado' });
  } catch (e) { json(res, 400, { error: String(e.message || e) }); }
}

// ---------- HTTP ----------
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname.startsWith('/api/')) return api(req, res, url);
  let p = decodeURIComponent(url.pathname);
  if (p === '/') p = '/index.html';
  if (p.startsWith('/data/')) { res.writeHead(403); return res.end(); }
  const file = path.join(root, path.normalize(p));
  if (!file.startsWith(root)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('404'); }
    if (p === '/index.html') sessionOf(req, res); // garante cookie de sessão
    res.writeHead(200, { 'Content-Type': types[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(data);
  });
});

// ---------- WebSocket (RFC 6455, mínimo) ----------
const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
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
  if (new URL(req.url, 'http://x').pathname !== '/ws') return sock.destroy();
  const key = req.headers['sec-websocket-key'];
  if (!key) return sock.destroy();
  const accept = crypto.createHash('sha1').update(key + GUID).digest('base64');
  sock.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + accept + '\r\n\r\n');
  sock.setNoDelay(true);
  const c = { id: nextId++, sock, sid: sessionOf(req, null), room: null, info: null, buf: Buffer.alloc(0), frag: [], closed: false, alive: true };
  touchSession(c.sid).catch((e) => console.error('Deadzone session DB error:', e.message));
  sock.on('data', (d) => { c.buf = Buffer.concat([c.buf, d]); parseFrames(c); });
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
    if (len > 4 * 1024 * 1024) return wsClose(c);
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
      c.frag.push(data);
      if (fin) { const msg = Buffer.concat(c.frag).toString('utf8'); c.frag = []; onMessage(c, msg); }
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

function onMessage(c, raw) {
  let m;
  try { m = JSON.parse(raw); } catch { return; }
  switch (m.t) {
    case 'host': {
      leaveRoom(c);
      const code = roomCode();
      const r = { code, host: c, members: new Map([[c.id, c]]), map: m.map, seed: m.seed, phase: 'game' };
      c.ready = false;
      rooms.set(code, r);
      c.room = r; c.info = m.info;
      wsSend(c, { t: 'hosted', code, id: c.id });
      break;
    }
    case 'join': {
      const r = rooms.get(String(m.code || '').toUpperCase());
      if (!r) return wsSend(c, { t: 'join_error', error: 'Sala não encontrada (o anfitrião pode ter saído).' });
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
      if (!state.allReady || typeof m.map !== 'string' || !/^[a-z0-9_-]{1,32}$/i.test(m.map)) { wsSend(c, { t: 'start_error', error: 'Todos precisam estar prontos.' }); break; }
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
    case 'info':
      c.info = m.info;
      if (c.room) for (const x of c.room.members.values()) if (x !== c) wsSend(x, { t: 'peer_info', id: c.id, info: c.info });
      if (c.room) sendRoomState(c.room);
      break;
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

async function start() {
  if (dbPool) await dbPool.query('SELECT 1');
  server.listen(port, '127.0.0.1', () => {
    console.log(`Zona Morta rodando em http://localhost:${port}${dbPool ? ' · MySQL conectado' : ' · armazenamento local'}`);
    const nets = require('os').networkInterfaces();
    for (const list of Object.values(nets)) for (const n of list || []) if (n.family === 'IPv4' && !n.internal) console.log(`  Na rede local: http://${n.address}:${port}`);
  });
}
start().catch((e) => { console.error('Não foi possível inicializar o banco do jogo:', e.message); process.exitCode = 1; });
