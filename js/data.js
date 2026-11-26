// ============================================================
//  DADOS DO JOGO — classes, armas, itens, zumbis, mapas
//  Tudo que é "balanceamento" fica aqui para facilitar ajustes.
// ============================================================

export const GAME_TITLE = 'ZONA MORTA';

// ---------- Classes ----------
export const CLASSES = {
  atirador: {
    id: 'atirador', name: 'Atirador', icon: 'atirador',
    desc: 'Especialista em armas de fogo. Mata à distância e controla hordas com granadas e rajadas.',
    hp: 100, speed: 6.0, armor: 0, dashCd: 1.3, lifesteal: 0, startWeapon: 'pistola', startSecondary: 'faca',
    skills: {
      q: { name: 'Granada', icon: 'granada', cd: 8, desc: 'Arremessa uma granada no cursor. Dano em área.' },
      f: { name: 'Rajada Tática', icon: 'rajada', cd: 18, desc: 'Por 4s: cadência dobrada e munição infinita.' },
    },
  },
  samurai: {
    id: 'samurai', name: 'Samurai', icon: 'samurai',
    desc: 'Mestre das lâminas. Mais resistente, rouba vida a cada golpe e corta hordas de perto.',
    hp: 140, speed: 6.4, armor: 0.15, dashCd: 0.9, lifesteal: 0.04, startWeapon: 'katana', startSecondary: 'pistola',
    skills: {
      q: { name: 'Investida', icon: 'investida', cd: 6, desc: 'Avança cortando todos no caminho.' },
      f: { name: 'Tempestade de Lâminas', icon: 'tempestade', cd: 16, desc: 'Gira por 2,5s cortando tudo ao redor.' },
    },
  },
};

// ---------- Atributos RPG ----------
export const ATTRS = {
  for: { name: 'Força', icon: 'forca', desc: '+4% dano corpo a corpo · +1 espaço na mochila a cada 2 pontos' },
  agi: { name: 'Agilidade', icon: 'agilidade', desc: '+1,2% velocidade · +2% velocidade de ataque' },
  vit: { name: 'Vitalidade', icon: 'vitalidade', desc: '+12 vida máxima · +0,15 regeneração/s' },
  pre: { name: 'Precisão', icon: 'precisao', desc: '+3,5% dano de armas de fogo · +0,8% crítico · menos dispersão' },
  sor: { name: 'Sorte', icon: 'sorte', desc: '+2% chance de loot raro · +3% dinheiro · +0,4% crítico' },
};
export const POINTS_PER_LEVEL = 3;

// ---------- Raridades ----------
export const RARITIES = [
  { id: 'comum', name: 'Comum', color: '#b9b9b9', hex: 0xb9b9b9, mult: 1.0, value: 1 },
  { id: 'incomum', name: 'Incomum', color: '#5fd35f', hex: 0x5fd35f, mult: 1.15, value: 2 },
  { id: 'raro', name: 'Raro', color: '#3d9bff', hex: 0x3d9bff, mult: 1.35, value: 4 },
  { id: 'epico', name: 'Épico', color: '#b45cff', hex: 0xb45cff, mult: 1.6, value: 9 },
  { id: 'lendario', name: 'Lendário', color: '#ff9a1f', hex: 0xff9a1f, mult: 2.0, value: 20 },
];

// ---------- Armas ----------
// gun: dmg por projétil, rate = tiros/s, mag = pente, reload = s, spread = rad, pellets, range, pierce
// melee: dmg, rate = golpes/s, arc = rad, reach = alcance
export const WEAPONS = {
  // Atirador
  pistola:   { name: 'Pistola 9mm',        cls: 'atirador', type: 'gun', icon: 'pistola', dmg: 14, rate: 3.5, mag: 12, reload: 1.1, spread: 0.035, pellets: 1, range: 24, pierce: 0, len: 0.3, value: 40 },
  smg:       { name: 'Submetralhadora',    cls: 'atirador', type: 'gun', icon: 'smg', dmg: 8,  rate: 11,  mag: 32, reload: 1.7, spread: 0.10,  pellets: 1, range: 20, pierce: 0, len: 0.5, value: 90 },
  escopeta:  { name: 'Escopeta',           cls: 'atirador', type: 'gun', icon: 'escopeta', dmg: 10, rate: 1.2, mag: 6,  reload: 2.2, spread: 0.30,  pellets: 7, range: 12, pierce: 0, len: 0.75, value: 110 },
  fuzil:     { name: 'Fuzil de Assalto',   cls: 'atirador', type: 'gun', icon: 'fuzil', dmg: 17, rate: 6.5, mag: 28, reload: 2.0, spread: 0.05,  pellets: 1, range: 28, pierce: 0, len: 0.8, value: 160 },
  precisao:  { name: 'Rifle de Precisão',  cls: 'atirador', type: 'gun', icon: 'rifle_precisao', dmg: 75, rate: 0.85, mag: 5, reload: 2.6, spread: 0.006, pellets: 1, range: 42, pierce: 4, len: 1.05, value: 200 },
  // Samurai
  katana:    { name: 'Katana',             cls: 'samurai', type: 'melee', icon: 'katana', dmg: 24, rate: 2.6, arc: 2.3, reach: 2.7, len: 1.0, value: 40 },
  wakizashi: { name: 'Wakizashi Dupla',    cls: 'samurai', type: 'melee', icon: 'wakizashi', dmg: 13, rate: 5.2, arc: 1.9, reach: 2.2, len: 0.65, dual: true, value: 100 },
  faca:      { name: 'Facão de Guerra',    cls: 'samurai', type: 'melee', icon: 'faca', dmg: 30, rate: 2.2, arc: 2.0, reach: 2.4, len: 0.8, wide: true, value: 110 },
  nodachi:   { name: 'Nodachi',            cls: 'samurai', type: 'melee', icon: 'nodachi', dmg: 52, rate: 1.15, arc: 3.1, reach: 3.5, len: 1.6, value: 180 },
  naginata:  { name: 'Naginata',           cls: 'samurai', type: 'melee', icon: 'naginata', dmg: 34, rate: 1.7, arc: 1.5, reach: 4.2, len: 2.0, pole: true, value: 190 },
};

// ---------- Itens de valor (loot vendável) ----------
// tier: 0..4 (quanto maior, mais raro e valioso)
export const VALUABLES = {
  sucata:     { name: 'Sucata Metálica',      icon: 'sucata', value: 6,   tier: 0, weight: 30 },
  enlatado:   { name: 'Comida Enlatada',      icon: 'enlatado', value: 9,   tier: 0, weight: 26 },
  bateria:    { name: 'Bateria',              icon: 'bateria', value: 16,  tier: 0, weight: 18 },
  fita:       { name: 'Fita e Ferramentas',   icon: 'fita', value: 22,  tier: 1, weight: 14 },
  combustivel:{ name: 'Galão de Combustível', icon: 'combustivel', value: 35,  tier: 1, weight: 12 },
  dinheiro:   { name: 'Maço de Dinheiro',     icon: 'dinheiro', value: 55,  tier: 1, weight: 10 },
  eletronico: { name: 'Placa Eletrônica',     icon: 'eletronico', value: 70,  tier: 2, weight: 8 },
  remedios:   { name: 'Antibióticos',         icon: 'remedios', value: 90,  tier: 2, weight: 7 },
  relogio:    { name: 'Relógio de Ouro',      icon: 'relogio', value: 160, tier: 3, weight: 4 },
  joia:       { name: 'Colar de Diamantes',   icon: 'joia', value: 320, tier: 3, weight: 3 },
  documentos: { name: 'Documentos Secretos',  icon: 'documentos', value: 550, tier: 4, weight: 1.6 },
  barra:      { name: 'Barra de Ouro',        icon: 'barra', value: 900, tier: 4, weight: 1 },
  amostra:    { name: 'Amostra do Vírus',     icon: 'amostra', value: 1400, tier: 4, weight: 0.5 },
};

// ---------- Consumíveis ----------
export const CONSUMABLES = {
  bandagem: { name: 'Bandagem',     icon: 'bandagem', heal: 30, healPct: 0,   value: 15, price: 40,  key: '1' },
  medkit:   { name: 'Kit Médico',   icon: 'medkit', heal: 0,  healPct: 0.6, value: 45, price: 120, key: '2' },
};

// ---------- Contêineres saqueáveis ----------
export const CONTAINERS = {
  lixeira:  { name: 'Caçamba de Lixo',     time: 1.2, rolls: [1, 2], tier: 0, weaponChance: 0.04 },
  caixa:    { name: 'Caixa de Madeira',    time: 1.4, rolls: [1, 3], tier: 0, weaponChance: 0.10 },
  armario:  { name: 'Armário',             time: 2.0, rolls: [1, 3], tier: 1, weaponChance: 0.14 },
  carro:    { name: 'Carro Abandonado',    time: 2.4, rolls: [1, 3], tier: 1, weaponChance: 0.10 },
  militar:  { name: 'Caixa Militar',       time: 2.8, rolls: [2, 4], tier: 2, weaponChance: 0.45 },
  cofre:    { name: 'Cofre',               time: 4.5, rolls: [2, 4], tier: 3, weaponChance: 0.20 },
  tesouro:  { name: 'Tesouro da Colmeia',  time: 2.0, rolls: [5, 7], tier: 4, weaponChance: 1.0, minRarity: 3 },
};

// ---------- Zumbis ----------
export const ZOMBIE_TYPES = {
  andarilho:   { name: 'Andarilho',   hp: 46,  speed: 2.5, dmg: 11,  atkRate: 1.0, range: 1.35, xp: 10, build: 'normal', height: 1.0 },
  corredor:    { name: 'Corredor',    hp: 30,  speed: 5.4, dmg: 8,  atkRate: 1.4, range: 1.25, xp: 14, build: 'magro',  height: 0.95 },
  brutamontes: { name: 'Brutamontes', hp: 210, speed: 1.9, dmg: 26, atkRate: 0.7, range: 1.9,  xp: 40, build: 'gordo',  height: 1.3, knockback: 6 },
  cuspidor:    { name: 'Cuspidor',    hp: 40,  speed: 2.3, dmg: 13, atkRate: 0.5, range: 10,   xp: 20, build: 'magro',  height: 1.0, ranged: true },
  explosivo:   { name: 'Inchado',     hp: 60,  speed: 2.1, dmg: 42, atkRate: 1.0, range: 1.8,  xp: 22, build: 'gordo',  height: 1.05, explode: true },
  blindado:    { name: 'Soldado Blindado', hp: 145, speed: 2.7, dmg: 17, atkRate: 1.1, range: 1.4, xp: 35, build: 'forte', height: 1.05, armor: 0.4 },
};

export const RANKS = {
  normal:   { name: '',         hp: 1,   dmg: 1,   scale: 1,    xp: 1,  aggro: 19, color: null },
  elite:    { name: 'Elite',    hp: 2.6, dmg: 1.5, scale: 1.15, xp: 3,  aggro: 21, color: 0xffd23f },
  miniboss: { name: 'Mini-Boss',hp: 5,   dmg: 1.35, scale: 1.7,  xp: 18, aggro: 14, color: 0xff7a1f },
  boss:     { name: 'BOSS',     hp: 22,  dmg: 1.8, scale: 2.5,  xp: 80, aggro: 22, color: 0xff2a2a },
};

// ---------- Mapas ----------
export const MAPS = [
  {
    id: 'centro', name: 'Centro Devastado', theme: 'city', level: 1, blocks: 5, nests: 3,
    desc: 'O antigo coração financeiro. Arranha-céus em ruínas e avenidas tomadas pela horda.',
    pool: { andarilho: 7, corredor: 2, brutamontes: 0.5 },
    density: 1.0,
    boss: { type: 'brutamontes', name: 'O Açougueiro', abilities: ['slam', 'charge', 'summon'] },
    minibossTypes: ['brutamontes', 'corredor'],
    colors: { fog: 0x2a2420, sky: 0x1c1816, sun: 0xffb27a, ambient: 0x76708a, ground: '#45433f', road: '#2a2a2c', building: [0x8a8580, 0x6f6a66, 0x9c9184, 0x5e5a58, 0x7d746a] },
  },
  {
    id: 'suburbio', name: 'Subúrbio em Chamas', theme: 'suburb', level: 3, blocks: 5, nests: 4,
    desc: 'Casas queimadas, quintais silenciosos e um cheiro constante de fumaça.',
    pool: { andarilho: 6, corredor: 3, explosivo: 1, brutamontes: 0.6 },
    density: 1.05,
    boss: { type: 'explosivo', name: 'Mãe Inchada', abilities: ['slam', 'summon', 'volley'] },
    minibossTypes: ['explosivo', 'brutamontes'],
    colors: { fog: 0x3a2419, sky: 0x2a160e, sun: 0xff8a4a, ambient: 0x7a6060, ground: '#4a4a36', road: '#2c2b2a', building: [0xc9b79a, 0xa58c6f, 0x8f9aa1, 0xb3a08a, 0x6e5f52] },
  },
  {
    id: 'porto', name: 'Porto Abandonado', theme: 'port', level: 6, blocks: 5, nests: 4,
    desc: 'Contêineres empilhados viraram labirinto. Os cuspidores dominam as docas.',
    pool: { andarilho: 5, corredor: 3, cuspidor: 2.2, explosivo: 1, brutamontes: 1 },
    density: 1.1,
    boss: { type: 'cuspidor', name: 'Rainha Ácida', abilities: ['volley', 'summon', 'charge'] },
    minibossTypes: ['cuspidor', 'brutamontes'],
    colors: { fog: 0x26323a, sky: 0x18222a, sun: 0xc8dcff, ambient: 0x8090a0, ground: '#3d4144', road: '#2a2d30', building: [0x7a8288, 0x5f676d, 0x8c8478, 0x6a6058] },
  },
  {
    id: 'militar', name: 'Base Militar Caída', theme: 'military', level: 10, blocks: 6, nests: 5,
    desc: 'O último bastião caiu. Soldados infectados ainda patrulham entre os bunkers.',
    pool: { andarilho: 3, corredor: 3, cuspidor: 2, explosivo: 1.5, brutamontes: 1.5, blindado: 3 },
    density: 1.2,
    boss: { type: 'blindado', name: 'General Podre', abilities: ['slam', 'charge', 'summon', 'volley'] },
    minibossTypes: ['blindado', 'brutamontes', 'cuspidor'],
    colors: { fog: 0x2a2c20, sky: 0x1b1d14, sun: 0xe8d29a, ambient: 0x6e7060, ground: '#4a4a3a', road: '#33332c', building: [0x6b6e5a, 0x7a7a6a, 0x5a5e4a, 0x8a8670] },
  },
];

// ---------- Aparência (editor de personagem) ----------
export const SKIN_COLORS = [0xffdbac, 0xf1c27d, 0xe0ac69, 0xc68642, 0x8d5524, 0x5c3a1e];
export const HAIR_COLORS = [0x151515, 0x4a2c17, 0x8b5a2b, 0xd4a76a, 0xb03a2e, 0xe8e8e8, 0x3b7dd8, 0x6aa84f, 0xd94fa0];
export const CLOTH_COLORS = [0x262626, 0x5a5a5a, 0x8b2e2e, 0x2e4a8b, 0x3e6b3a, 0x6b5a3a, 0xc9b48a, 0x4a2e6b, 0xd96b1c, 0xe0e0e0, 0x1f5f5f, 0x7a1f3d];
export const EYE_COLORS = [0x2b1a0e, 0x3b6ea5, 0x4e8a3a, 0x6b6b6b, 0x8a5a2b];
export const HAIR_STYLES = { careca: 'Careca', curto: 'Curto', moicano: 'Moicano', longo: 'Longo', coque: 'Coque Samurai', afro: 'Black Power' };
export const BEARDS = { nenhuma: 'Nenhuma', barba: 'Barba cheia', cavanhaque: 'Cavanhaque', bigode: 'Bigode' };
export const ACCESSORIES = { nenhum: 'Nenhum', bandana: 'Bandana', mascara: 'Máscara de Gás', chapeu: 'Chapéu', oculos: 'Óculos Táticos', capacete: 'Capacete', kasa: 'Kasa (palha)' };
export const BUILDS = { magro: 'Magro', normal: 'Normal', forte: 'Forte' };

export function defaultAppearance() {
  return {
    skin: SKIN_COLORS[1], hair: HAIR_COLORS[0], hairStyle: 'curto', beard: 'nenhuma',
    eyes: EYE_COLORS[0], top: CLOTH_COLORS[2], pants: CLOTH_COLORS[0], shoes: CLOTH_COLORS[5],
    pack: CLOTH_COLORS[4], accessory: 'nenhum', build: 'normal', height: 1.0,
  };
}

// ---------- Mercado do acampamento ----------
export const SHOP = [
  { id: 'bandagem', name: 'Bandagem', icon: 'bandagem', price: 40, desc: 'Cura 30 de vida (tecla 1).', give: { kind: 'consumable', id: 'bandagem', qty: 1 } },
  { id: 'medkit', name: 'Kit Médico', icon: 'medkit', price: 120, desc: 'Cura 60% da vida (tecla 2).', give: { kind: 'consumable', id: 'medkit', qty: 1 } },
  { id: 'caixa_armas', name: 'Caixa de Armas', icon: 'caixa_armas', price: 600, desc: 'Arma aleatória da sua classe (raridade melhorada).', crate: { tier: 2, minRarity: 1 } },
  { id: 'caixa_elite', name: 'Caixa de Elite', icon: 'caixa_elite', price: 4000, desc: 'Arma da sua classe, no mínimo Épica.', crate: { tier: 4, minRarity: 3 } },
];

// ---------- Habilidades (aprendidas com pontos de habilidade) ----------
// cls: classe que pode aprender ('all' = qualquer). lvl: nível mínimo. Rank 1..3.
export const SKILL_KEYS = ['KeyQ', 'KeyF', 'KeyG', 'KeyV'];
export const SKILL_KEY_LABELS = ['Q', 'F', 'G', 'V'];
export const MAX_SKILL_RANK = 3;
export const SKILLS = {
  // Samurai
  investida:  { cls: 'samurai', name: 'Investida', icon: 'investida', cd: 6, lvl: 1, desc: 'Avança cortando todos no caminho.' },
  tempestade: { cls: 'samurai', name: 'Tempestade de Lâminas', icon: 'tempestade', cd: 16, lvl: 1, desc: 'Gira cortando tudo ao redor.' },
  onda:       { cls: 'samurai', name: 'Onda Cortante', icon: 'onda', cd: 5, lvl: 3, desc: 'Dispara um corte de energia que atravessa inimigos.' },
  sismico:    { cls: 'samurai', name: 'Golpe Sísmico', icon: 'sismico', cd: 10, lvl: 5, desc: 'Salta até o cursor e golpeia o chão: dano em área e atordoa.' },
  milcortes:  { cls: 'samurai', name: 'Mil Cortes', icon: 'milcortes', cd: 12, lvl: 8, desc: 'Sequência relâmpago de cortes à frente.' },
  furia:      { cls: 'samurai', name: 'Fúria do Ronin', icon: 'furia', cd: 30, lvl: 12, desc: '+50% velocidade de ataque e +6% roubo de vida por 8s.' },
  // Atirador
  granada:    { cls: 'atirador', name: 'Granada', icon: 'granada', cd: 8, lvl: 1, desc: 'Arremessa uma granada no cursor. Dano em área.' },
  rajada:     { cls: 'atirador', name: 'Rajada Tática', icon: 'rajada', cd: 18, lvl: 1, desc: 'Cadência dobrada e munição infinita por 4s.' },
  chumbo:     { cls: 'atirador', name: 'Explosão de Chumbo', icon: 'chumbo', cd: 6, lvl: 3, desc: 'Rajada em cone que empurra e atordoa.' },
  mina:       { cls: 'atirador', name: 'Mina Terrestre', icon: 'mina', cd: 9, lvl: 5, desc: 'Planta uma mina no cursor que explode ao contato.' },
  perfurante: { cls: 'atirador', name: 'Tiro Perfurante', icon: 'perfurante', cd: 9, lvl: 8, desc: 'Disparo pesado que atravessa todos em linha.' },
  torreta:    { cls: 'atirador', name: 'Torreta Automática', icon: 'torreta', cd: 25, lvl: 12, desc: 'Instala uma torreta que atira sozinha por 12s.' },
  // Universais
  chute:      { cls: 'all', name: 'Chute', icon: 'chute', cd: 4, lvl: 2, desc: 'Chute frontal que arremessa e atordoa.' },
  grito:      { cls: 'all', name: 'Grito de Guerra', icon: 'grito', cd: 14, lvl: 6, desc: 'Atordoa e afasta todos ao redor.' },
  adrenalina: { cls: 'all', name: 'Adrenalina', icon: 'adrenalina', cd: 24, lvl: 10, desc: 'Cura 35% da vida em 4s e +30% velocidade.' },
};
export const START_SKILLS = { samurai: ['investida', 'tempestade'], atirador: ['granada', 'rajada'] };
