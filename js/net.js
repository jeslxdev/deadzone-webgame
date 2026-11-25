// ============================================================
//  REDE — conexão WebSocket com o servidor para salas co-op
// ============================================================
class Net {
  constructor() {
    this.ws = null; this.id = null; this.handlers = new Map(); this.waiters = [];
    this.connected = false; this.room = null;
  }
  connect() {
    if (this.connected) return Promise.resolve(this);
    return new Promise((resolve, reject) => {
      const url = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws';
      let ws;
      try { ws = new WebSocket(url); } catch (e) { reject(e); return; }
      this.ws = ws;
      const to = setTimeout(() => { reject(new Error('Servidor de salas indisponível')); try { ws.close(); } catch {} }, 5000);
      ws.onmessage = (ev) => {
        let m; try { m = JSON.parse(ev.data); } catch { return; }
        if (m.t === 'hello') { this.id = m.id; this.connected = true; clearTimeout(to); resolve(this); return; }
        if (m.t === 'room_state' && this.room) Object.assign(this.room, m);
        if (m.t === 'start_game' && this.room) Object.assign(this.room, { phase: 'game', map: m.map, seed: m.seed });
        for (let i = this.waiters.length - 1; i >= 0; i--) if (this.waiters[i].types.includes(m.t)) { const w = this.waiters.splice(i, 1)[0]; w.resolve(m); }
        const list = this.handlers.get(m.t);
        if (list) list.forEach((fn) => fn(m));
        const any = this.handlers.get('*');
        if (any) any.forEach((fn) => fn(m));
      };
      ws.onclose = () => { this.connected = false; this.room = null; const l = this.handlers.get('close'); if (l) l.forEach((fn) => fn()); };
      ws.onerror = () => { clearTimeout(to); reject(new Error('Falha na conexão')); };
    });
  }
  on(t, fn) { if (!this.handlers.has(t)) this.handlers.set(t, []); this.handlers.get(t).push(fn); return () => this.off(t, fn); }
  off(t, fn) { const l = this.handlers.get(t); if (l) { const i = l.indexOf(fn); if (i >= 0) l.splice(i, 1); } }
  clearHandlers() { this.handlers.clear(); }
  wait(types, ms = 6000) {
    return new Promise((resolve, reject) => {
      const w = { types: [].concat(types), resolve };
      this.waiters.push(w);
      setTimeout(() => { const i = this.waiters.indexOf(w); if (i >= 0) { this.waiters.splice(i, 1); reject(new Error('Tempo esgotado')); } }, ms);
    });
  }
  send(obj) { if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(obj)); }
  async host(map, seed, info) {
    await this.connect();
    const response = this.wait('hosted');
    this.send({ t: 'host', map, seed, info });
    const m = await response;
    this.room = { code: m.code, host: true, hostId: this.id, phase: 'game', map, seed, players: [{ id: this.id, info, ready: false, host: true }], allReady: false };
    return m;
  }
  async join(code, info) {
    await this.connect();
    const response = this.wait(['joined', 'join_error']);
    this.send({ t: 'join', code, info });
    const m = await response;
    if (m.t === 'join_error') throw new Error(m.error);
    this.room = { code: m.code, host: false, hostId: m.hostId, phase: m.phase || 'game', map: m.map, seed: m.seed, players: m.players || [], allReady: false };
    return m;
  }
  leave() { this.send({ t: 'leave' }); this.room = null; }
  setReady(ready) { this.send({ t: 'ready', ready: !!ready }); }
  updateInfo(info) {
    if (this.room) {
      const own = this.room.players?.find((p) => p.id === this.id);
      if (own) own.info = info;
    }
    this.send({ t: 'info', info });
  }
  returnToLobby() { this.send({ t: 'lobby' }); }
  async startRoom(map, seed) {
    if (!this.room?.host) throw new Error('Somente o anfitrião pode iniciar a próxima partida.');
    const result = this.wait(['started', 'start_error']);
    this.send({ t: 'start_room', map, seed });
    const message = await result;
    if (message.t === 'start_error') throw new Error(message.error);
    Object.assign(this.room, { phase: 'game', map, seed, allReady: false });
    return message;
  }
  broadcast(d) { this.send({ t: 'b', d }); }
  sendTo(to, d) { this.send({ t: 'to', to, d }); }
}
export const net = new Net();

// Dados públicos do jogador enviados aos outros membros da sala
export function playerInfo(profile) {
  return {
    name: profile.name, cls: profile.cls, level: profile.level,
    appearance: profile.appearance, equipped: { base: profile.equipped.base, rarity: profile.equipped.rarity, ilvl: 1 },
  };
}
