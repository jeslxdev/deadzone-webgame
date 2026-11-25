const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

const root = path.resolve(__dirname, '..');
const dir = path.join(root, 'data', 'sessions');
const pool = mysql.createPool({
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  charset: 'utf8mb4',
  timezone: 'Z',
  connectionLimit: 2,
});

async function main() {
  let sessions = 0, profiles = 0;
  const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => /^[a-f0-9]{32}\.json$/.test(f)) : [];
  for (const file of files) {
    const sid = path.basename(file, '.json');
    const data = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
    const created = Number(data.created) || Date.now();
    const updated = Number(data.updated) || created;
    await pool.execute(`INSERT INTO dz_sessions (session_id, created_at, last_seen_at)
      VALUES (?, FROM_UNIXTIME(? / 1000), FROM_UNIXTIME(? / 1000))
      ON DUPLICATE KEY UPDATE last_seen_at=GREATEST(last_seen_at, VALUES(last_seen_at))`, [sid, created, updated]);
    sessions++;
    for (const p of Array.isArray(data.profiles) ? data.profiles : []) {
      if (!p?.id || typeof p.name !== 'string') continue;
      await pool.execute(`INSERT INTO dz_profiles
        (session_id, profile_id, name, character_class, level, xp, money, attributes_json, stats_json, items_json, profile_json, created_ms, updated_ms)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE name=VALUES(name), character_class=VALUES(character_class), level=VALUES(level), xp=VALUES(xp), money=VALUES(money),
        attributes_json=VALUES(attributes_json), stats_json=VALUES(stats_json), items_json=VALUES(items_json), profile_json=VALUES(profile_json), updated_ms=VALUES(updated_ms), updated_at=UTC_TIMESTAMP()`,
      [sid, String(p.id), String(p.name).slice(0, 80), String(p.cls || '').slice(0, 24), Math.max(1, Number(p.level) || 1), Math.max(0, Number(p.xp) || 0), Math.max(0, Number(p.money) || 0), JSON.stringify(p.attrs || {}), JSON.stringify(p.stats || {}), JSON.stringify({ stash: p.stash || [], equipped: p.equipped || null, skills: p.skills || {} }), JSON.stringify(p), Number(p.created) || created, Number(p.updated) || updated]);
      profiles++;
    }
  }
  console.log(`Importação concluída: ${sessions} sessões, ${profiles} personagens.`);
}

main().catch((error) => { console.error('Falha na importação:', error.message); process.exitCode = 1; }).finally(() => pool.end());
