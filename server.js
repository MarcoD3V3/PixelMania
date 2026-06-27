require('dotenv').config();

const express = require('express');
const http = require('http');
const session = require('express-session');
const { Server } = require('socket.io');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const GAME = require('./game-config');
const zoomLens = require('./zoom-lens');
const shopLevels = require('./shop-levels');
const profileCosmetics = require('./profile-cosmetics');
const quotaRecharge = require('./quota-recharge');
const colorSystem = require('./color-system');
const paintTools = require('./paint-tools');
const blueprintCfg = require('./blueprint-config');
const NumberFormat = require('./public/js/number-format');
const tycoonFx = require('./tycoon-effects');
const minigamesCfg = require('./minigames-config');
const {
  IS_PROD, PORT, PUBLIC_URL, resolvePublicUrl, validateProductionConfig, DEV_SESSION_SECRET, TRUST_PROXY,
} = require('./config');

const COORD_LIMIT = 1_000_000;
const COOLDOWN_MS = 10 * 60 * 1000;
const PIXELS_PER_INTERVAL = 1000;
const SAVE_INTERVAL_MS = 10_000;
const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'pixels.json');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const TERRITORIES_FILE = path.join(DATA_DIR, 'territories.json');
const SESSIONS_DIR = path.join(DATA_DIR, 'sessions');

const DISCORD_CLIENT_ID = (process.env.DISCORD_CLIENT_ID || '').trim();
const DISCORD_CLIENT_SECRET = (process.env.DISCORD_CLIENT_SECRET || '').trim();
const DISCORD_CALLBACK_URL =
  process.env.DISCORD_CALLBACK_URL || `${resolvePublicUrl()}/auth/discord/callback`;
const SESSION_SECRET = process.env.SESSION_SECRET || DEV_SESSION_SECRET;

function ensureDataDirs() {
  for (const dir of [DATA_DIR, SESSIONS_DIR]) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }
}

const { errors: prodErrors, warnings: prodWarnings } = validateProductionConfig();
if (prodErrors.length) {
  prodErrors.forEach((e) => console.error(`[PROD] ${e}`));
  process.exit(1);
}
prodWarnings.forEach((w) => console.warn(`[PROD] ${w}`));

ensureDataDirs();

const { JsonFileSessionStore } = require('./session-store');

const SESSION_MAX_AGE = 90 * 24 * 60 * 60 * 1000; // 90 días

/** Solo memoria si SESSION_STORE=memory explícito. */
const USE_MEMORY_SESSIONS = process.env.SESSION_STORE === 'memory';

function cleanupSessionFiles() {
  if (!fs.existsSync(SESSIONS_DIR)) return;
  let removed = 0;
  for (const name of fs.readdirSync(SESSIONS_DIR)) {
    if (name === '.gitkeep') continue;
    const full = path.join(SESSIONS_DIR, name);
    try {
      const isTemp = /\.json\.\d+$/.test(name);
      const isLegacyFile = USE_MEMORY_SESSIONS && name.endsWith('.json');
      if (!isTemp && !isLegacyFile) continue;
      const stat = fs.statSync(full);
      if (isLegacyFile && stat.size < 8192) continue;
      fs.unlinkSync(full);
      removed += 1;
    } catch (_) { /* ignore locked files */ }
  }
  if (removed > 0) {
    console.log(`Sesiones: limpiados ${removed} archivo(s) antiguos/temporales`);
  }
}

cleanupSessionFiles();

const sessionStore = USE_MEMORY_SESSIONS
  ? new session.MemoryStore()
  : new JsonFileSessionStore({
    dir: SESSIONS_DIR,
    ttl: SESSION_MAX_AGE / 1000,
  });

if (USE_MEMORY_SESSIONS) {
  console.log('Sesiones: memoria (SESSION_STORE=memory)');
} else {
  console.log(`Sesiones: JSON en ${SESSIONS_DIR}`);
}

const app = express();
if (TRUST_PROXY) app.set('trust proxy', 1);

const server = http.createServer(app);
const sessionMiddleware = session({
  store: sessionStore,
  name: 'pixelmania.sid',
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  rolling: true,
  cookie: {
    maxAge: SESSION_MAX_AGE,
    httpOnly: true,
    sameSite: 'lax',
    secure: IS_PROD,
  },
});

app.use(sessionMiddleware);

app.use(express.json({ limit: '32mb' }));
app.use(express.static(path.join(__dirname, 'public'), {
  maxAge: IS_PROD ? '1d' : 0,
  etag: true,
}));

const socketCorsOrigin = (() => {
  const url = resolvePublicUrl();
  return IS_PROD && !url.includes('localhost') ? url : true;
})();
const io = new Server(server, {
  cors: { origin: socketCorsOrigin, credentials: true },
});
io.use((socket, next) => sessionMiddleware(socket.request, {}, next));

let pixels = new Map();
let users = new Map();
/** @type {object[]} */
let territories = [];
/** @type {Map<string, object>} zoneId -> siege */
const activeSieges = new Map();
const quotas = new Map();
const onlineUsers = new Set();
const paintLastAt = new Map();
const paintLastKey = new Map();
/** @type {Map<string, { taps: number, lastAt: number, color: string }>} */
const chiselProgress = new Map();
const minigameSessions = new Map();
const liveArcadePlayers = new Map();
const socketsByUser = new Map();

function minigameCooldownKey(gameId) {
  return gameId || 'reflex';
}

function startMinigameSession(user, gameId) {
  const g = minigamesCfg.getGame(gameId);
  if (!g) return { error: 'Juego desconocido', status: 404 };
  const t = normalizeTycoon(user);
  const now = Date.now();
  const cd = Math.floor(g.cooldownMs * tycoonFx.minigameCooldownMult(user));
  const key = minigameCooldownKey(gameId);
  const last = t.minigameCooldowns?.[key] || 0;
  if (now - last < cd) {
    return {
      error: `Espera ${Math.ceil((cd - (now - last)) / 1000)}s para jugar de nuevo`,
      status: 429,
    };
  }
  const sessionId = `${gameId.slice(0, 2)}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  minigameSessions.set(user.id, { sessionId, startAt: now, type: gameId });
  return {
    ok: true,
    sessionId,
    durationMs: g.durationMs,
    game: g,
  };
}

function completeMinigameSession(user, gameId, sessionId, scoreRaw) {
  const g = minigamesCfg.getGame(gameId);
  if (!g) return { error: 'Juego desconocido', status: 400 };
  const session = minigameSessions.get(user.id);
  const score = Math.min(g.maxScore, Math.max(0, Math.trunc(Number(scoreRaw))));
  if (!session || session.sessionId !== sessionId || session.type !== gameId) {
    return { error: 'Sesión inválida. Inicia el juego de nuevo.', status: 400 };
  }
  const elapsed = Date.now() - session.startAt;
  if (elapsed < g.minElapsedMs || elapsed > g.maxElapsedMs) {
    minigameSessions.delete(user.id);
    liveArcadePlayers.delete(user.id);
    return { error: 'Tiempo de juego inválido', status: 400 };
  }
  minigameSessions.delete(user.id);
  liveArcadePlayers.delete(user.id);
  const t = normalizeTycoon(user);
  t.minigameCooldowns[minigameCooldownKey(gameId)] = Date.now();
  let coins = Math.floor(score * g.baseCoinPerHit * tycoonFx.minigameRewardMult(user));
  coins = Math.max(1, coins);
  user.coins = (user.coins || 0) + coins;
  return { ok: true, coins, score, totalCoins: user.coins, user: publicUser(user) };
}

function broadcastLiveArcade() {
  const players = [...liveArcadePlayers.values()];
  io.emit('arcade_live', { players, at: Date.now() });
}

function setLiveArcade(user, patch) {
  const prev = liveArcadePlayers.get(user.id);
  liveArcadePlayers.set(user.id, {
    userId: user.id,
    username: user.username,
    ...(prev || {}),
    ...patch,
    at: Date.now(),
  });
  broadcastLiveArcade();
}

function chiselKey(userId, x, y) {
  return `${userId}:${x},${y}`;
}

function defaultTycoon() {
  return {
    upgrades: {},
    totalPixels: 0,
    totalTaps: 0,
    xp: 0,
    lastPassiveAt: Date.now(),
    lastComboKey: '',
    lastComboAt: 0,
    pixelsThisCycle: 0,
    minigameCooldowns: {},
  };
}

function normalizeTycoon(user) {
  if (!user.tycoon || typeof user.tycoon !== 'object') user.tycoon = defaultTycoon();
  if (!user.tycoon.upgrades) user.tycoon.upgrades = {};
  user.tycoon.totalPixels = user.tycoon.totalPixels || 0;
  user.tycoon.totalTaps = user.tycoon.totalTaps || 0;
  user.tycoon.xp = user.tycoon.xp || 0;
  user.tycoon.lastPassiveAt = user.tycoon.lastPassiveAt || Date.now();
  user.tycoon.pixelsThisCycle = user.tycoon.pixelsThisCycle || 0;
  if (!user.tycoon.minigameCooldowns) user.tycoon.minigameCooldowns = {};
  return user.tycoon;
}

function tycoonUpgradeLevel(user, key) {
  return normalizeTycoon(user).upgrades[key] || 0;
}

function tycoonUpgradeDef(key) {
  return GAME.TYCOON_UPGRADES.find((u) => u.key === key);
}

function tycoonUpgradePrice(key, currentLevel, user) {
  const def = tycoonUpgradeDef(key);
  if (!def) return Infinity;
  const raw = Math.floor(def.basePrice * def.priceGrowth ** currentLevel);
  return user ? tycoonFx.tycoonUpgradePrice(user, key, raw) : raw;
}

function clicksRequired(user) {
  return tycoonFx.clicksRequired(user);
}

function quotaBonus(user) {
  return tycoonFx.quotaBonus(user);
}

function comboBonusTaps(user) {
  return tycoonFx.comboBonusTaps(user);
}

function xpMultiplier(user) {
  return tycoonFx.xpMultiplier(user);
}

function coinMultiplier(user) {
  return tycoonFx.coinMultiplier(user);
}

function passiveRatePerMin(user) {
  let rate = tycoonFx.passiveRatePerMin(user);
  rate += tycoonFx.upgradeLevel(user, 'vault') * 2;
  return rate;
}

function xpPerLevelTransition(level) {
  const table = GAME.TYCOON_LEVEL_XP;
  const lv = Math.max(0, Math.trunc(level));
  if (lv + 1 < table.length) return table[lv + 1] - table[lv];
  const postStart = table.length - 1;
  const base = GAME.TYCOON_POST_TABLE_XP_PER_LEVEL || 800;
  const step = GAME.TYCOON_POST_TABLE_XP_STEP || 14;
  return Math.floor(base + step * Math.max(0, lv - postStart));
}

function postTableXpSpan(levelsBeyondTable) {
  const n = Math.max(0, Math.trunc(levelsBeyondTable));
  if (n <= 0) return 0;
  const base = GAME.TYCOON_POST_TABLE_XP_PER_LEVEL || 800;
  const step = GAME.TYCOON_POST_TABLE_XP_STEP || 14;
  return n * base + (step * (n - 1) * n) / 2;
}

function cumulativeXpForLevel(level) {
  const table = GAME.TYCOON_LEVEL_XP;
  const lv = Math.max(0, Math.trunc(level));
  if (lv < table.length) return table[lv];
  const postStart = table.length - 1;
  return table[postStart] + postTableXpSpan(lv - postStart);
}

function tycoonLevelFromXp(xp) {
  const table = GAME.TYCOON_LEVEL_XP;
  const x = Math.max(0, Math.trunc(xp));
  const cap = table[table.length - 1];
  if (x < cap) {
    let level = 0;
    for (let i = 1; i < table.length; i++) {
      if (x >= table[i]) level = i;
      else break;
    }
    return level;
  }
  const postStart = table.length - 1;
  let lo = postStart;
  let hi = postStart + 500000;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi + 1) / 2);
    if (cumulativeXpForLevel(mid) <= x) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

function xpForNextLevel(level) {
  return cumulativeXpForLevel(level + 1);
}

function xpForCurrentLevel(level) {
  return cumulativeXpForLevel(level);
}

function grantTycoonXp(user, amount) {
  const t = normalizeTycoon(user);
  const before = tycoonLevelFromXp(t.xp);
  t.xp += Math.max(1, Math.floor(amount * xpMultiplier(user)));
  const after = tycoonLevelFromXp(t.xp);
  let levelUpCoins = 0;
  for (let lv = before + 1; lv <= after; lv++) {
    levelUpCoins += GAME.TYCOON_LEVEL_COIN_BONUS * lv;
  }
  if (levelUpCoins > 0) user.coins = (user.coins || 0) + levelUpCoins;
  return { levelUp: after > before, newLevel: after, levelUpCoins };
}

function applyPassiveIncome(user) {
  const rate = passiveRatePerMin(user);
  if (rate <= 0) return 0;
  const t = normalizeTycoon(user);
  const now = Date.now();
  const elapsed = now - (t.lastPassiveAt || now);
  let minutes = Math.floor(elapsed / 60000);
  if (minutes < 1) return 0;
  minutes = Math.min(minutes, tycoonFx.maxIdleMinutes(user));

  let earned = minutes * rate;
  const scoutXp = tycoonFx.scoutXpPerMinute(user) * minutes;
  if (scoutXp > 0) grantTycoonXp(user, scoutXp);

  user.coins = (user.coins || 0) + earned;
  t.lastPassiveAt += minutes * 60000;
  return earned;
}

function tycoonForClient(user) {
  if (!user) return null;
  const t = normalizeTycoon(user);
  const level = tycoonLevelFromXp(t.xp);
  const upgrades = {};
  for (const def of GAME.TYCOON_UPGRADES) {
    upgrades[def.key] = t.upgrades[def.key] || 0;
  }
  const floor = cumulativeXpForLevel(level);
  const ceil = cumulativeXpForLevel(level + 1);
  return {
    level,
    levelDisplay: level + 1,
    xp: t.xp,
    xpCurrent: t.xp - floor,
    xpNext: ceil - floor,
    xpPerLevel: xpPerLevelTransition(level),
    totalPixels: t.totalPixels,
    totalTaps: t.totalTaps,
    clicksRequired: clicksRequired(user),
    passivePerMin: passiveRatePerMin(user),
    passiveIdleSec: Math.max(0, Math.floor((Date.now() - (t.lastPassiveAt || Date.now())) / 1000)),
    coinMult: coinMultiplier(user),
    upgrades,
  };
}

function tycoonUpgradeListFor(user) {
  return GAME.TYCOON_UPGRADES.map((def) => {
    const level = user ? tycoonUpgradeLevel(user, def.key) : 0;
    const maxed = level >= def.maxLevel;
    return {
      ...def,
      level,
      maxed,
      price: maxed ? null : tycoonUpgradePrice(def.key, level, user),
      effectLabel: tycoonFx.describeUpgradeEffect(def, level, maxed),
      nextEffect: def.key === 'chisel'
        ? Math.max(GAME.TYCOON_MIN_CLICKS, GAME.TYCOON_START_CLICKS - level - 1)
        : (def.effect || 1) * (level + 1),
    };
  });
}

function applyTycoonUpgrade(user, key) {
  const def = tycoonUpgradeDef(key);
  if (!def) return { error: 'Mejora desconocida' };
  const level = tycoonUpgradeLevel(user, key);
  if (level >= def.maxLevel) return { error: 'Nivel máximo alcanzado' };
  const price = tycoonUpgradePrice(key, level, user);
  if ((user.coins || 0) < price) {
    return { error: `Monedas insuficientes (tienes ${user.coins}, necesitas ${price})` };
  }
  user.coins -= price;
  normalizeTycoon(user).upgrades[key] = level + 1;
  return { ok: true, price, level: level + 1 };
}

function trackTycoonMissions(user, socket) {
  const t = normalizeTycoon(user);
  const mp = user.missionProgress;
  if (t.totalTaps >= 200) {
    const m = GAME.MISSIONS.find((x) => x.id === 'cincelador');
    if (m && !user.completedMissions.includes('cincelador')) {
      const done = t.totalTaps >= m.target;
      if (done) awardMission(user, 'cincelador', socket);
    }
  }
  const totalUpgrades = Object.values(t.upgrades).reduce((a, b) => a + b, 0);
  if (totalUpgrades >= 1) {
    const m = GAME.MISSIONS.find((x) => x.id === 'inversor');
    if (m && !user.completedMissions.includes('inversor')) awardMission(user, 'inversor', socket);
  }
}

function pruneChiselProgress(userId) {
  let n = 0;
  for (const key of chiselProgress.keys()) {
    if (key.startsWith(`${userId}:`)) {
      chiselProgress.delete(key);
      n++;
      if (n > 40) break;
    }
  }
}

function pruneStaleChiselProgress() {
  const now = Date.now();
  const staleMs = GAME.CHISEL_STALE_MS || 10_000;
  for (const [key, prog] of chiselProgress) {
    if (now - (prog.lastAt || 0) < staleMs) continue;
    chiselProgress.delete(key);
    const colon = key.indexOf(':');
    if (colon < 0) continue;
    const userId = key.slice(0, colon);
    const [x, y] = key.slice(colon + 1).split(',').map(Number);
    const sock = socketsByUser.get(userId);
    if (sock && Number.isFinite(x) && Number.isFinite(y)) {
      sock.emit('chisel_clear', { x, y });
    }
  }
}

setInterval(pruneStaleChiselProgress, 3000);

function pixelKey(x, y) {
  return `${x},${y}`;
}

function validCoord(x, y) {
  return Number.isFinite(x) && Number.isFinite(y)
    && Math.abs(x) <= COORD_LIMIT && Math.abs(y) <= COORD_LIMIT;
}

function getOctantId(x, y) {
  const dist = Math.hypot(x, y);
  if (dist < 500) return null;
  const angle = Math.atan2(y, x);
  const sector = Math.floor((angle + Math.PI) / (Math.PI / 4)) % 8;
  return String(sector);
}

function uid() {
  return crypto.randomBytes(8).toString('hex');
}

function loadJson(file, fallback) {
  try {
    if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    console.error(`Error al cargar ${file}:`, err.message);
  }
  return fallback;
}

function saveJson(file, data) {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
  } catch (err) {
    console.error(`Error al guardar ${file}:`, err.message);
  }
}

function loadPixels() {
  pixels = new Map();
  for (const p of loadJson(DATA_FILE, [])) {
    pixels.set(pixelKey(p.x, p.y), p);
  }
  console.log(`Cargados ${pixels.size} píxeles`);
}

function loadTerritories() {
  territories = loadJson(TERRITORIES_FILE, []).map(normalizeTerritory);
}

function saveAll() {
  saveJson(DATA_FILE, [...pixels.values()]);
  saveJson(USERS_FILE, [...users.values()].map(userForDisk));
  saveJson(TERRITORIES_FILE, territories);
}

function userForDisk(user) {
  if (!user) return user;
  const copy = { ...user };
  if (copy.activeBlueprint) {
    copy.activeBlueprint = blueprintCfg.blueprintForStorage(copy.activeBlueprint) || copy.activeBlueprint;
  }
  return copy;
}

function sessionUserRef(user) {
  if (!user) return null;
  return { id: user.id, username: user.username, avatar: user.avatar };
}

function loadUsers() {
  let migrated = false;
  const raw = loadJson(USERS_FILE, []);
  users = new Map(raw.map((u) => {
    const normalized = normalizeUser(u);
    const compact = blueprintCfg.blueprintForStorage(normalized.activeBlueprint);
    if (normalized.activeBlueprint?.cells?.length && compact) {
      normalized.activeBlueprint = compact;
      migrated = true;
    } else if (normalized.activeBlueprint && compact) {
      normalized.activeBlueprint = compact;
      if (u.activeBlueprint?.cells?.length) migrated = true;
    }
    return [normalized.id, normalized];
  }));
  if (migrated) {
    console.log('Plano(s) compactados — users.json sin arrays cells (más rápido)');
    saveJson(USERS_FILE, [...users.values()].map(userForDisk));
  }
}

loadPixels();
loadUsers();
loadTerritories();
setInterval(saveAll, SAVE_INTERVAL_MS);

setInterval(() => {
  let any = false;
  for (const user of users.values()) {
    const earned = applyPassiveIncome(user);
    if (earned > 0) {
      any = true;
      notifyPassiveEarned(user, earned);
    }
  }
  if (any) saveAll();
}, 60_000);

function defaultClaimColor(userId) {
  const hues = ['#7c3aed', '#ef476f', '#06ffa5', '#ffbe0b', '#118ab2', '#ff006e'];
  const idx = Number(BigInt(userId || '0') % BigInt(hues.length));
  return hues[idx];
}

function normalizeStoredBlueprint(bp) {
  return blueprintCfg.blueprintForStorage(bp);
}

function normalizeUser(u) {
  const hadClan = Boolean(u.clan?.name || u.clan?.territoryPixels != null);
  const territoryPixels = u.territoryPixels ?? u.clan?.territoryPixels ?? (hadClan ? 0 : GAME.STARTER_TERRITORY_PIXELS);
  const { clan, ...rest } = u;
  return {
    ...rest,
    coins: u.coins ?? GAME.STARTER_COINS,
    territoryPixels,
    claimColor: /^#[0-9A-Fa-f]{6}$/.test(u.claimColor) ? u.claimColor : (u.clan?.color && /^#[0-9A-Fa-f]{6}$/.test(u.clan.color) ? u.clan.color : defaultClaimColor(u.id)),
    gadgets: u.gadgets || [],
    inventory: u.inventory || {},
    missionProgress: u.missionProgress || {},
    completedMissions: u.completedMissions || [],
    loginStreak: u.loginStreak || { count: 0, lastDate: '' },
    paintBoost: u.paintBoost || 0,
    tycoon: u.tycoon || defaultTycoon(),
    unlockedColors: Array.isArray(u.unlockedColors) ? u.unlockedColors.map((c) => String(c).toUpperCase()) : [],
    activeSkin: u.activeSkin || null,
    activeBrush: u.activeBrush || null,
    activeBlockSize: u.activeBlockSize || 1,
    mirrorEnabled: Boolean(u.mirrorEnabled),
    mirrorAxis: u.mirrorAxis === 'h' ? 'h' : 'v',
    shopLevels: u.shopLevels && typeof u.shopLevels === 'object' ? u.shopLevels : {},
    profileStyle: u.profileStyle && typeof u.profileStyle === 'object' ? u.profileStyle : {},
    activeBlueprint: normalizeStoredBlueprint(u.activeBlueprint),
  };
}

function normalizeTerritory(t) {
  return {
    id: t.id,
    x: t.x,
    y: t.y,
    w: t.w,
    h: t.h,
    ownerId: t.ownerId || t.leaderId,
    ownerName: t.ownerName || t.clanName || 'Usuario',
    color: t.color || t.clanColor || '#7c3aed',
    claimedAt: t.claimedAt || Date.now(),
  };
}

function getUserFromSession(req) {
  return req.session?.user || null;
}

/** Siempre usa la copia más reciente del usuario (sesión suele quedar desactualizada) */
function getFreshUser(req) {
  const sessionUser = getUserFromSession(req);
  if (!sessionUser) return null;
  const stored = users.get(sessionUser.id);
  let user;
  if (stored) {
    user = stored;
    if (req?.session) req.session.user = sessionUserRef(user);
  } else {
    user = normalizeUser(sessionUser);
    users.set(user.id, user);
  }
  applyPassiveForUser(user);
  profileCosmetics.syncLegacyProfile(user);
  return user;
}

function notifyPassiveEarned(user, earned) {
  if (earned <= 0) return;
  const socket = socketsByUser.get(user.id);
  if (!socket) return;
  socket.emit('wallet', { coins: user.coins });
  socket.emit('tycoon', tycoonForClient(user));
  socket.emit('passive_income', { earned, rate: passiveRatePerMin(user) });
}

function applyPassiveForUser(user) {
  const earned = applyPassiveIncome(user);
  if (earned > 0) notifyPassiveEarned(user, earned);
  return earned;
}

function persistUser(user, req) {
  users.set(user.id, user);
  if (req?.session) req.session.user = sessionUserRef(user);
}

function avatarUrl(user) {
  if (!user.avatar) {
    const idx = Number(BigInt(user.id) % 6n);
    return `https://cdn.discordapp.com/embed/avatars/${idx}.png`;
  }
  return `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=64`;
}

function publicUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    username: user.username,
    avatar: avatarUrl(user),
    coins: user.coins,
    territoryPixels: user.territoryPixels ?? 0,
    claimColor: user.claimColor || defaultClaimColor(user.id),
    gadgets: user.gadgets,
    inventory: user.inventory,
    tycoon: tycoonForClient(user),
    unlockedColors: user.unlockedColors || [],
    activeSkin: user.activeSkin || null,
    activeBrush: user.activeBrush || null,
    activeBlockSize: user.activeBlockSize || 1,
    shopLevels: user.shopLevels || {},
    profileStyle: user.profileStyle || {},
    profile: profileCosmetics.resolveCosmetics(user),
    activeBlueprint: blueprintCfg.blueprintSummary(user.activeBlueprint),
    availableColors: colorSystem.colorsForUser(user),
    freeColors: colorSystem.FREE_COLORS,
    nextColorUnlockPrice: colorSystem.colorUnlockPrice(user),
    premiumColorCount: colorSystem.premiumUnlockCount(user),
    zoomLimits: zoomLens.zoomLimitsForLevel(zoomLens.zoomLensLevel(user)),
    brushState: {
      activeBrush: user.activeBrush || null,
      activeBlockSize: paintTools.resolveEquippedBlockSize(user),
      mirrorEnabled: Boolean(user.mirrorEnabled),
      mirrorAxis: user.mirrorAxis === 'h' ? 'h' : 'v',
      unlockedBrushes: paintTools.unlockedPaintTools(user),
      blockSizes: paintTools.unlockedBlockSizes(user),
    },
  };
}

function userOwnsShopItem(user, item) {
  if (item.type === 'gadget') return user.gadgets.includes(item.gadget);
  if (item.type === 'unlock') return user.gadgets.includes(item.unlockKey);
  if (item.type === 'color') {
    return colorSystem.userOwnsColor(user, item.hex);
  }
  if (item.type === 'palette') {
    const owned = user.unlockedColors || [];
    return (item.colors || []).every((c) => owned.includes(String(c).toUpperCase()));
  }
  if (item.type === 'leveled') {
    const key = item.upgradeKey || item.id;
    const lvl = user.shopLevels?.[key] || 0;
    return lvl >= shopLevels.leveledMaxLevel(item);
  }
  return false;
}

function applyShopPurchase(user, item) {
  if (item.type === 'territory') {
    user.territoryPixels = (user.territoryPixels || 0) + item.amount;
  } else if (item.type === 'gadget') {
    user.gadgets.push(item.gadget);
  } else if (item.type === 'unlock') {
    user.gadgets.push(item.unlockKey);
    if (String(item.unlockKey).startsWith('skin_')) {
      user.activeSkin = item.unlockKey;
    } else if (paintTools.isPaintToolId(item.unlockKey)) {
      user.activeBrush = item.unlockKey;
    }
  } else if (item.type === 'color') {
    if (!user.unlockedColors) user.unlockedColors = [];
    const hex = String(item.hex).toUpperCase();
    if (!user.unlockedColors.includes(hex)) user.unlockedColors.push(hex);
  } else if (item.type === 'palette') {
    if (!user.unlockedColors) user.unlockedColors = [];
    for (const c of item.colors || []) {
      const hex = String(c).toUpperCase();
      if (!user.unlockedColors.includes(hex)) user.unlockedColors.push(hex);
    }
  } else if (item.type === 'item') {
    if (item.item === 'paint_boost' || item.item === 'paint_boost_mini' || item.item === 'paint_boost_mega') {
      user.paintBoost = (user.paintBoost || 0) + (item.amount || 0);
    } else {
      user.inventory[item.item] = (user.inventory[item.item] || 0) + (item.amount || 1);
    }
  } else if (item.type === 'leveled') {
    const key = item.upgradeKey || item.id;
    const oldLvl = user.shopLevels?.[key] || 0;
    if (!user.shopLevels) user.shopLevels = {};
    const newLvl = oldLvl + 1;
    user.shopLevels[key] = newLvl;
    shopLevels.applyLeveledReward(user, item, newLvl);
    if (item.procedural === 'recharge') {
      quotaRecharge.onLevelUp(user.id, oldLvl, newLvl, user, quotas);
    }
  }
}

function getQuota(userId) {
  const user = users.get(userId);
  const now = Date.now();
  let q = quotas.get(userId);
  const cooldownMs = user ? quotaRecharge.cooldownMsForUser(user) : COOLDOWN_MS;
  if (!q || now >= q.resetAt) {
    const bonus = user?.paintBoost || 0;
    if (user?.paintBoost) {
      user.paintBoost = 0;
      users.set(userId, user);
    }
    if (user?.tycoon) user.tycoon.pixelsThisCycle = 0;
    q = {
      remaining: PIXELS_PER_INTERVAL + bonus + quotaBonus(user),
      max: PIXELS_PER_INTERVAL + bonus + quotaBonus(user),
      resetAt: now + cooldownMs,
    };
    quotas.set(userId, q);
  }
  return q;
}

function quotaForClient(userId) {
  const user = users.get(userId);
  const q = getQuota(userId);
  const max = q.max ?? (PIXELS_PER_INTERVAL + quotaBonus(user));
  const cdMs = user ? quotaRecharge.cooldownMsForUser(user) : COOLDOWN_MS;
  return {
    remaining: Math.max(0, q.remaining),
    max,
    resetIn: Math.max(0, q.resetAt - Date.now()),
    cooldownMs: cdMs,
    cooldownSec: Math.ceil(cdMs / 1000),
    rechargeLevel: quotaRecharge.levelFromUser(user),
    rechargeMaxLevel: quotaRecharge.MAX_USEFUL_LEVEL,
  };
}

function buildPixelUpdate(pixel) {
  const out = {
    x: pixel.x,
    y: pixel.y,
    c: pixel.c,
    u: pixel.u,
    n: pixel.n,
    a: pixel.a,
  };
  if (pixel.pr) out.pr = pixel.pr;
  return out;
}

function publicTerritory(t) {
  const siege = activeSieges.get(t.id);
  return {
    id: t.id,
    x: t.x,
    y: t.y,
    w: t.w,
    h: t.h,
    ownerId: t.ownerId,
    ownerName: t.ownerName,
    color: t.color,
    underSiege: Boolean(siege),
    siegeEndsAt: siege?.endsAt || null,
  };
}

function pointInRect(px, py, r) {
  return px >= r.x && px < r.x + r.w && py >= r.y && py < r.y + r.h;
}

function rectsOverlap(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

function overlapsOwnTerritory(rect, userId) {
  if (!userId) return false;
  return territories.some((t) => t.ownerId === userId && rectsOverlap(rect, t));
}

function getTerritoryAt(x, y) {
  for (const t of territories) {
    if (pointInRect(x, y, t)) return t;
  }
  return null;
}

function isSiegeActive(zoneId) {
  const s = activeSieges.get(zoneId);
  return s && Date.now() < s.endsAt;
}

function canPaintInTerritory(user, territory) {
  if (!territory) return true;
  if (isSiegeActive(territory.id)) return true;
  if (!user) return false;
  return territory.ownerId === user.id;
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function trackLoginStreak(user) {
  const today = todayStr();
  if (user.loginStreak.lastDate === today) return;
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  if (user.loginStreak.lastDate === yesterday) user.loginStreak.count += 1;
  else user.loginStreak.count = 1;
  user.loginStreak.lastDate = today;
  const streakBonus = 5 + user.loginStreak.count * 2;
  const extra = tycoonFx.upgradeLevel(user, 'streak_boost') * 2;
  user.coins = (user.coins || 0) + streakBonus + extra;
}

function missionListFor(user) {
  return GAME.MISSIONS.map((m) => {
    const done = user.completedMissions.includes(m.id);
    let progress = 0;
    let target = 1;
    const mp = user.missionProgress[m.id] || {};

    switch (m.type) {
      case 'corners':
        target = 4;
        progress = (mp.corners || []).filter(Boolean).length;
        break;
      case 'total_placed':
        target = m.target;
        progress = mp.total || 0;
        break;
      case 'octants':
        target = m.target;
        progress = (mp.octants || []).length;
        break;
      case 'login_streak':
        target = m.target;
        progress = user.loginStreak.count;
        break;
      case 'solid_block':
        target = 1;
        progress = mp.completed ? 1 : 0;
        break;
      case 'siege_won':
        target = m.target;
        progress = mp.wins || 0;
        break;
      case 'total_taps':
        target = m.target;
        progress = normalizeTycoon(user).totalTaps;
        break;
      case 'tycoon_upgrade':
        target = m.target;
        progress = Object.values(normalizeTycoon(user).upgrades).reduce((a, b) => a + b, 0);
        break;
      default:
        break;
    }

    return { ...m, done, progress, target };
  });
}

function awardMission(user, missionId, socket) {
  if (user.completedMissions.includes(missionId)) return;
  const mission = GAME.MISSIONS.find((m) => m.id === missionId);
  if (!mission) return;
  user.completedMissions.push(missionId);
  const reward = Math.floor(mission.reward * coinMultiplier(user) * tycoonFx.missionRewardMult(user));
  user.coins += reward;
  users.set(user.id, user);
  if (socket) {
    socket.emit('mission_complete', { id: missionId, reward, coins: user.coins });
    socket.emit('wallet', { coins: user.coins });
    if (socket.request?.session) socket.request.session.user = sessionUserRef(user);
  }
}

function checkSolidBlock(x, y, color) {
  const size = 10;
  for (let dy = 0; dy < size; dy++) {
    for (let dx = 0; dx < size; dx++) {
      const px = x - dx;
      const py = y - dy;
      if (px < -COORD_LIMIT || py < -COORD_LIMIT) continue;
      let ok = true;
      for (let iy = 0; iy < size && ok; iy++) {
        for (let ix = 0; ix < size && ok; ix++) {
          const key = pixelKey(px + ix, py + iy);
          const p = pixels.get(key);
          if (!p || p.c.toUpperCase() !== color.toUpperCase()) ok = false;
        }
      }
      if (ok) return true;
    }
  }
  return false;
}

function trackMissions(user, x, y, color, socket) {
  if (!user.missionProgress) user.missionProgress = {};

  if (!user.missionProgress.maraton) user.missionProgress.maraton = { total: 0 };
  user.missionProgress.maraton.total += 1;
  if (user.missionProgress.maraton.total >= 300) awardMission(user, 'maraton', socket);

  if (!user.missionProgress.explorador) user.missionProgress.explorador = { corners: [false, false, false, false] };
  const corners = GAME.MISSIONS.find((m) => m.id === 'explorador').corners;
  corners.forEach((c, i) => {
    if (Math.hypot(x - c.x, y - c.y) <= 30) user.missionProgress.explorador.corners[i] = true;
  });
  if (user.missionProgress.explorador.corners.every(Boolean)) awardMission(user, 'explorador', socket);

  if (!user.missionProgress.octantes) user.missionProgress.octantes = { octants: [] };
  const octantId = getOctantId(x, y);
  if (octantId && !user.missionProgress.octantes.octants.includes(octantId)) {
    user.missionProgress.octantes.octants.push(octantId);
  }
  if (user.missionProgress.octantes.octants.length >= 8) awardMission(user, 'octantes', socket);

  if (checkSolidBlock(x, y, color)) {
    user.missionProgress.artesano = { completed: true };
    awardMission(user, 'artesano', socket);
  }

  if (user.loginStreak.count >= 5) awardMission(user, 'constancia', socket);

  users.set(user.id, user);
}

function trackSiegePixel(user, territory) {
  const siege = activeSieges.get(territory.id);
  if (!siege) return;
  siege.pixelsByUser[user.id] = (siege.pixelsByUser[user.id] || 0) + 1;
}

function resolveSieges() {
  const now = Date.now();
  for (const [zoneId, siege] of [...activeSieges.entries()]) {
    if (now < siege.endsAt) continue;
    const zone = territories.find((t) => t.id === zoneId);
    if (!zone) {
      activeSieges.delete(zoneId);
      continue;
    }
    const total = Object.values(siege.pixelsByUser).reduce((a, b) => a + b, 0);
    const attackerPixels = siege.pixelsByUser[siege.attackerId] || 0;
    const pct = total > 0 ? (attackerPixels / (zone.w * zone.h)) * 100 : 0;

    if (pct >= GAME.SIEGE_CAPTURE_PERCENT && siege.attackerId !== zone.ownerId) {
      const attacker = users.get(siege.attackerId);
      if (attacker) {
        zone.ownerId = attacker.id;
        zone.ownerName = attacker.username;
        zone.color = attacker.claimColor || defaultClaimColor(attacker.id);
        if (!attacker.missionProgress.conquistador) attacker.missionProgress.conquistador = { wins: 0 };
        attacker.missionProgress.conquistador.wins += 1;
        if (attacker.missionProgress.conquistador.wins >= 1) {
          awardMission(attacker, 'conquistador', null);
        }
        users.set(attacker.id, attacker);
        io.emit('territory_update', publicTerritory(zone));
        io.emit('siege_end', { zoneId, captured: true, winner: attacker.username });
      }
    } else {
      io.emit('siege_end', { zoneId, captured: false });
    }
    activeSieges.delete(zoneId);
    io.emit('territories', territories.map(publicTerritory));
  }
}

setInterval(resolveSieges, 5000);

async function exchangeDiscordCode(code) {
  const body = new URLSearchParams({
    client_id: DISCORD_CLIENT_ID,
    client_secret: DISCORD_CLIENT_SECRET,
    grant_type: 'authorization_code',
    code,
    redirect_uri: DISCORD_CALLBACK_URL,
  });
  const tokenRes = await fetch('https://discord.com/api/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!tokenRes.ok) {
    let detail = '';
    try {
      const err = await tokenRes.json();
      detail = err.error_description || err.error || JSON.stringify(err);
    } catch (_) {
      detail = await tokenRes.text().catch(() => '');
    }
    const msg = detail ? `Token exchange failed: ${detail}` : 'Token exchange failed';
    throw new Error(msg);
  }
  const tokenData = await tokenRes.json();
  const userRes = await fetch('https://discord.com/api/users/@me', {
    headers: { Authorization: `Bearer ${tokenData.access_token}` },
  });
  if (!userRes.ok) throw new Error('User fetch failed');
  return userRes.json();
}

app.get('/health', (_req, res) => {
  res.status(200).json({
    ok: true,
    env: IS_PROD ? 'production' : 'development',
    uptime: Math.floor(process.uptime()),
    pixels: pixels.size,
    users: users.size,
    online: onlineUsers.size,
  });
});

app.get('/api/leaderboard/wealth', (_req, res) => {
  let any = false;
  for (const user of users.values()) {
    if (applyPassiveIncome(user) > 0) any = true;
  }
  if (any) saveAll();
  const rows = [...users.values()]
    .filter((u) => u.username && (u.coins || 0) > 0)
    .sort((a, b) => (b.coins || 0) - (a.coins || 0))
    .slice(0, 10)
    .map((u, i) => ({
      rank: i + 1,
      id: u.id,
      username: u.username,
      avatar: avatarUrl(u),
      coins: u.coins || 0,
      level: tycoonLevelFromXp(normalizeTycoon(u).xp) + 1,
    }));
  res.json({ rows, updatedAt: Date.now(), totalPlayers: users.size });
});

app.get('/api/minigames', (_req, res) => {
  res.json({
    zones: minigamesCfg.PAINT_ZONES,
    games: minigamesCfg.listGames(),
    reflex: minigamesCfg.REFLEX_GAME,
  });
});

function handleMinigameStart(req, res, gameId) {
  const user = getFreshUser(req);
  if (!user) return res.status(401).json({ error: 'Inicia sesión' });
  const result = startMinigameSession(user, gameId);
  if (result.error) return res.status(result.status || 400).json({ error: result.error });
  res.json({
    ok: true,
    sessionId: result.sessionId,
    durationMs: result.durationMs,
    gameId,
  });
}

function handleMinigameComplete(req, res, gameId) {
  const user = getFreshUser(req);
  if (!user) return res.status(401).json({ error: 'Inicia sesión' });
  const sessionId = String(req.body.sessionId || '');
  const score = req.body.hits ?? req.body.score ?? 0;
  const result = completeMinigameSession(user, gameId, sessionId, score);
  if (result.error) return res.status(result.status || 400).json({ error: result.error });
  persistUser(user, req);
  saveAll();
  broadcastLiveArcade();
  res.json({
    ok: true,
    coins: result.coins,
    hits: result.score,
    score: result.score,
    totalCoins: result.totalCoins,
    user: result.user,
  });
}

function handleMinigameCancel(req, res, gameId) {
  const user = getFreshUser(req);
  if (!user) return res.status(401).json({ error: 'Inicia sesión' });
  const session = minigameSessions.get(user.id);
  const sessionId = String(req.body.sessionId || '');
  if (session?.type === gameId && (!sessionId || session.sessionId === sessionId)) {
    minigameSessions.delete(user.id);
    liveArcadePlayers.delete(user.id);
    broadcastLiveArcade();
  }
  res.json({ ok: true });
}

app.post('/api/minigame/:gameId/start', (req, res) => {
  handleMinigameStart(req, res, String(req.params.gameId || '').toLowerCase());
});

app.post('/api/minigame/:gameId/complete', (req, res) => {
  handleMinigameComplete(req, res, String(req.params.gameId || '').toLowerCase());
});

app.post('/api/minigame/:gameId/cancel', (req, res) => {
  handleMinigameCancel(req, res, String(req.params.gameId || '').toLowerCase());
});

app.post('/api/minigame/live/ping', (req, res) => {
  const user = getFreshUser(req);
  if (!user) return res.status(401).json({ error: 'Inicia sesión' });
  const session = minigameSessions.get(user.id);
  if (!session) return res.status(400).json({ error: 'Sin partida activa' });
  setLiveArcade(user, {
    gameId: session.type,
    zoneId: String(req.body.zoneId || ''),
    score: Math.trunc(Number(req.body.score) || 0),
    x: Math.trunc(Number(req.body.x) || 0),
    y: Math.trunc(Number(req.body.y) || 0),
  });
  res.json({ ok: true });
});

app.post('/api/minigame/reflex/start', (req, res) => handleMinigameStart(req, res, 'reflex'));

app.post('/api/minigame/reflex/complete', (req, res) => {
  handleMinigameComplete(req, res, 'reflex');
});

app.post('/api/minigame/reflex/cancel', (req, res) => {
  handleMinigameCancel(req, res, 'reflex');
});

app.get('/api/me', (req, res) => {
  const user = getFreshUser(req);
  const catalog = {
    shop: GAME.SHOP,
    shopCategories: GAME.SHOP_CATEGORIES,
    shopCount: GAME.SHOP.length,
  };
  if (!user) {
    return res.json({
      loggedIn: false,
      freeColors: colorSystem.FREE_COLORS,
      availableColors: colorSystem.FREE_COLORS,
      ...catalog,
    });
  }
  trackLoginStreak(user);
  persistUser(user, req);
  res.json({
    loggedIn: true,
    user: publicUser(user),
    tycoon: tycoonForClient(user),
    quota: quotaForClient(user.id),
    missions: missionListFor(user),
    tycoonUpgrades: tycoonUpgradeListFor(user),
    ...catalog,
  });
});

app.get('/api/shop', (_req, res) => {
  res.json({
    shop: GAME.SHOP,
    shopCategories: GAME.SHOP_CATEGORIES,
    shopCount: GAME.SHOP.length,
    tycoonUpgrades: GAME.TYCOON_UPGRADES,
    zoomLens: { maxLevel: zoomLens.ZOOM_LENS_MAX_LEVEL },
  });
});

app.get('/api/game', (_req, res) => {
  res.json({
    shop: GAME.SHOP,
    shopCategories: GAME.SHOP_CATEGORIES,
    shopCount: GAME.SHOP.length,
    missions: GAME.MISSIONS,
    tycoonUpgrades: GAME.TYCOON_UPGRADES,
    tycoonConfig: {
      startClicks: GAME.TYCOON_START_CLICKS,
      minClicks: GAME.TYCOON_MIN_CLICKS,
    },
    zoomLens: {
      maxLevel: zoomLens.ZOOM_LENS_MAX_LEVEL,
      item: zoomLens.ZOOM_LENS_SHOP_ITEM,
    },
    siegeCost: GAME.SIEGE_COST,
    siegeDurationMs: GAME.SIEGE_DURATION_MS,
    blueprint: {
      presetSizes: blueprintCfg.PRESET_SIZES,
      maxSide: blueprintCfg.MAX_SIDE,
      maxCells: blueprintCfg.MAX_CELLS,
      baseCost: blueprintCfg.BASE_COST,
      costPerCell: blueprintCfg.COST_PER_CELL,
      costPerColor: blueprintCfg.COST_PER_COLOR,
      costPerSide: blueprintCfg.COST_PER_SIDE,
      areaEstimateRate: blueprintCfg.AREA_ESTIMATE_RATE,
      colorsIncluded: blueprintCfg.COLORS_INCLUDED,
      minCost: blueprintCfg.MIN_COST,
      itemKey: blueprintCfg.ITEM_KEY,
    },
  });
});

app.post('/api/claim-color', (req, res) => {
  const user = getFreshUser(req);
  if (!user) return res.status(401).json({ error: 'Inicia sesión primero' });
  const color = String(req.body.color || '');
  if (!/^#[0-9A-Fa-f]{6}$/.test(color)) return res.status(400).json({ error: 'Color inválido' });
  user.claimColor = color;
  persistUser(user, req);
  saveAll();
  res.json({ ok: true, claimColor: user.claimColor, user: publicUser(user) });
});

/** Desbloquea cualquier color; precio sube por cantidad de colores ya comprados. */
app.post('/api/colors/unlock', (req, res) => {
  const user = getFreshUser(req);
  if (!user) return res.status(401).json({ error: 'Inicia sesión' });
  const hex = colorSystem.normalizeHex(req.body.hex);
  if (!hex) return res.status(400).json({ error: 'Color inválido (#RRGGBB)' });
  const result = colorSystem.unlockColorForUser(user, hex);
  if (!result.ok) {
    return res.status(result.error?.includes('insuficientes') ? 402 : 400).json({
      error: result.error,
      price: result.price ?? colorSystem.colorUnlockPrice(user),
    });
  }
  persistUser(user, req);
  saveAll();
  res.json({
    ok: true,
    price: result.price,
    hex: result.hex,
    user: publicUser(user),
  });
});

app.get('/api/colors/unlock-price', (req, res) => {
  const user = getFreshUser(req);
  const price = user ? colorSystem.colorUnlockPrice(user) : colorSystem.colorUnlockPrice(null);
  res.json({
    price,
    premiumCount: user ? colorSystem.premiumUnlockCount(user) : 0,
    growth: null,
    start: colorSystem.COLOR_UNLOCK_START,
  });
});

app.post('/api/shop/buy', (req, res) => {
  const user = getFreshUser(req);
  if (!user) return res.status(401).json({ error: 'Inicia sesión' });

  const item = GAME.SHOP.find((s) => s.id === req.body.id);
  if (!item) return res.status(404).json({ error: 'Artículo no encontrado' });

  if (item.type === 'leveled') {
    const key = item.upgradeKey || item.id;
    const lvl = user.shopLevels?.[key] || 0;
    if (lvl >= shopLevels.leveledMaxLevel(item)) {
      return res.status(400).json({ error: 'Nivel máximo alcanzado' });
    }
  } else if (userOwnsShopItem(user, item)) {
    return res.status(400).json({ error: 'Ya tienes este artículo' });
  }
  if (item.type === 'gadget' && user.gadgets.includes(item.gadget)) {
    return res.status(400).json({ error: 'Ya tienes este gadget' });
  }

  const price = item.type === 'leveled'
    ? shopLevels.leveledShopPrice(item, user.shopLevels?.[item.upgradeKey || item.id] || 0)
    : item.type === 'color'
      ? colorSystem.colorUnlockPrice(user)
      : item.price;

  if (user.coins < price) {
    return res.status(400).json({
      error: `Monedas insuficientes (tienes ${user.coins}, necesitas ${price})`,
    });
  }

  user.coins -= price;
  applyShopPurchase(user, item);

  persistUser(user, req);
  saveAll();
  res.json({ ok: true, coins: user.coins, user: publicUser(user) });
});

app.post('/api/equip-skin', (req, res) => {
  const user = getFreshUser(req);
  if (!user) return res.status(401).json({ error: 'Inicia sesión' });

  const skinId = req.body.id ? String(req.body.id) : null;
  if (skinId && !user.gadgets?.includes(skinId)) {
    return res.status(400).json({ error: 'No tienes esta skin' });
  }
  user.activeSkin = skinId;
  persistUser(user, req);
  saveAll();
  res.json({ ok: true, user: publicUser(user) });
});

app.post('/api/equip-brush', (req, res) => {
  const user = getFreshUser(req);
  if (!user) return res.status(401).json({ error: 'Inicia sesión' });

  const brush = req.body.brush != null && req.body.brush !== '' ? String(req.body.brush) : null;
  const blockSizeRaw = req.body.blockSize;

  if (brush && !user.gadgets?.includes(brush)) {
    return res.status(400).json({ error: 'No tienes este pincel' });
  }
  if (blockSizeRaw !== undefined) {
    const blockSize = Math.trunc(Number(blockSizeRaw) || 1);
    const allowedSizes = paintTools.unlockedBlockSizes(user);
    if (!allowedSizes.includes(blockSize)) {
      return res.status(400).json({ error: 'Tamaño de bloque no desbloqueado' });
    }
    user.activeBlockSize = blockSize;
  }
  if (req.body.brush !== undefined) user.activeBrush = brush;
  if (req.body.mirrorEnabled != null) user.mirrorEnabled = Boolean(req.body.mirrorEnabled);
  if (req.body.mirrorAxis === 'h' || req.body.mirrorAxis === 'v') user.mirrorAxis = req.body.mirrorAxis;
  persistUser(user, req);
  saveAll();
  res.json({ ok: true, user: publicUser(user) });
});

app.post('/api/profile/style', (req, res) => {
  const user = getFreshUser(req);
  if (!user) return res.status(401).json({ error: 'Inicia sesión' });
  profileCosmetics.sanitizeStyleUpdate(user, req.body || {});
  persistUser(user, req);
  saveAll();
  res.json({
    ok: true,
    profileStyle: user.profileStyle,
    profile: profileCosmetics.resolveCosmetics(user),
    user: publicUser(user),
  });
});

app.post('/api/blueprint/activate', (req, res) => {
  const user = getFreshUser(req);
  if (!user) return res.status(401).json({ error: 'Inicia sesión' });

  const tokens = user.inventory?.[blueprintCfg.ITEM_KEY] || 0;
  if (tokens < 1) {
    return res.status(400).json({ error: 'Necesitas un Plano píxel en inventario (Tienda → Pintura)' });
  }

  if (user.activeBlueprint) {
    return res.status(400).json({ error: 'Ya tienes un plano activo. Descártalo o complétalo primero.' });
  }

  const dim = blueprintCfg.validateDimensions(req.body.width, req.body.height);
  if (!dim.ok) return res.status(400).json({ error: dim.error });

  const { width, height } = dim;
  const originX = Math.trunc(Number(req.body.originX));
  const originY = Math.trunc(Number(req.body.originY));
  if (!Number.isInteger(originX) || !Number.isInteger(originY)) {
    return res.status(400).json({ error: 'Origen inválido' });
  }
  if (!validCoord(originX, originY) || !validCoord(originX + width - 1, originY + height - 1)) {
    return res.status(400).json({ error: 'El plano queda fuera del mapa' });
  }

  const rawCells = blueprintCfg.normalizeCellsInput(req.body, width, height);
  if (!rawCells.length) {
    return res.status(400).json({ error: 'El plano no tiene píxeles (¿imagen vacía o todo transparente?)' });
  }
  if (rawCells.length > blueprintCfg.MAX_CELLS) {
    return res.status(400).json({
      error: `Demasiados píxeles en la guía (${rawCells.length.toLocaleString()}). Máx. ${blueprintCfg.MAX_CELLS.toLocaleString()}. Usa PNG con transparencia o reduce el tamaño.`,
    });
  }

  const cellCount = rawCells.length;
  const colorCount = blueprintCfg.countUniqueColors(rawCells);
  const cost = blueprintCfg.blueprintCost(width, height, cellCount, colorCount);
  if (user.coins < cost) {
    return res.status(400).json({
      error: `Monedas insuficientes (tienes ${user.coins}, necesitas ${cost})`,
    });
  }

  const blueprint = blueprintCfg.sanitizeBlueprint({
    id: `bp_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`,
    width,
    height,
    originX,
    originY,
    cells: rawCells,
    colorMode: req.body.colorMode,
    tolerance: req.body.tolerance,
    visible: true,
    showGrid: req.body.showGrid !== false,
    hideCompleted: req.body.hideCompleted !== false,
    opacity: req.body.opacity,
    fitMode: req.body.fitMode,
    name: req.body.name,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });
  if (!blueprint) return res.status(400).json({ error: 'No se pudo generar el plano' });

  user.inventory[blueprintCfg.ITEM_KEY] = tokens - 1;
  if (user.inventory[blueprintCfg.ITEM_KEY] <= 0) delete user.inventory[blueprintCfg.ITEM_KEY];
  user.coins -= cost;
  user.activeBlueprint = blueprintCfg.blueprintForStorage(blueprint) || blueprint;
  persistUser(user, req);
  saveAll();
  res.json({
    ok: true,
    coins: user.coins,
    cost,
    cellCount,
    colorCount,
    breakdown: blueprintCfg.costBreakdown(width, height, cellCount, colorCount),
    blueprint: blueprintCfg.publicBlueprint(user.activeBlueprint, { includeCells: true }),
    user: publicUser(user),
  });
});

app.get('/api/blueprint', (req, res) => {
  const user = getFreshUser(req);
  if (!user) return res.status(401).json({ error: 'Inicia sesión' });
  if (!user.activeBlueprint) return res.json({ ok: true, blueprint: null });
  res.json({
    ok: true,
    blueprint: blueprintCfg.publicBlueprint(user.activeBlueprint, { includeCells: true }),
  });
});

app.get('/api/blueprint/quote', (req, res) => {
  const w = req.query.w ?? req.query.width;
  const h = req.query.h ?? req.query.height;
  const cells = req.query.cells ?? req.query.cellCount ?? 0;
  const colors = req.query.colors ?? req.query.colorCount ?? 0;
  const quote = blueprintCfg.quoteForClient(w, h, cells, colors);
  if (!quote.ok) return res.status(400).json({ error: quote.error });
  res.json(quote);
});

app.post('/api/blueprint/settings', (req, res) => {
  const user = getFreshUser(req);
  if (!user) return res.status(401).json({ error: 'Inicia sesión' });
  if (!user.activeBlueprint) return res.status(400).json({ error: 'No hay plano activo' });
  const bp = user.activeBlueprint;
  if (req.body.tolerance != null) {
    bp.tolerance = Math.min(80, Math.max(0, Math.trunc(Number(req.body.tolerance))));
  }
  if (req.body.opacity != null) {
    bp.opacity = Math.min(0.92, Math.max(0.15, Number(req.body.opacity)));
  }
  if (req.body.showGrid != null) bp.showGrid = Boolean(req.body.showGrid);
  if (req.body.hideCompleted != null) bp.hideCompleted = Boolean(req.body.hideCompleted);
  if (req.body.showErrors != null) bp.showErrors = Boolean(req.body.showErrors);
  if (req.body.markStray != null) bp.markStray = Boolean(req.body.markStray);
  if (req.body.name != null) bp.name = String(req.body.name).slice(0, 48) || null;
  bp.updatedAt = Date.now();
  persistUser(user, req);
  saveAll();
  res.json({
    ok: true,
    blueprint: blueprintCfg.publicBlueprint(bp, { includeCells: true }),
  });
});

app.post('/api/blueprint/toggle', (req, res) => {
  const user = getFreshUser(req);
  if (!user) return res.status(401).json({ error: 'Inicia sesión' });
  if (!user.activeBlueprint) return res.status(400).json({ error: 'No hay plano activo' });
  user.activeBlueprint.visible = user.activeBlueprint.visible === false;
  user.activeBlueprint.updatedAt = Date.now();
  persistUser(user, req);
  saveAll();
  res.json({ ok: true, blueprint: blueprintCfg.publicBlueprint(user.activeBlueprint, { includeCells: true }) });
});

app.post('/api/blueprint/relocate', (req, res) => {
  const user = getFreshUser(req);
  if (!user) return res.status(401).json({ error: 'Inicia sesión' });
  if (!user.activeBlueprint) return res.status(400).json({ error: 'No hay plano activo' });
  const originX = Math.trunc(Number(req.body.originX));
  const originY = Math.trunc(Number(req.body.originY));
  const bp = user.activeBlueprint;
  if (!validCoord(originX, originY) || !validCoord(originX + bp.width - 1, originY + bp.height - 1)) {
    return res.status(400).json({ error: 'El plano queda fuera del mapa' });
  }
  bp.originX = originX;
  bp.originY = originY;
  bp.updatedAt = Date.now();
  persistUser(user, req);
  saveAll();
  res.json({ ok: true, blueprint: blueprintCfg.publicBlueprint(bp, { includeCells: true }) });
});

app.post('/api/blueprint/cancel', (req, res) => {
  const user = getFreshUser(req);
  if (!user) return res.status(401).json({ error: 'Inicia sesión' });
  user.activeBlueprint = null;
  persistUser(user, req);
  saveAll();
  res.json({ ok: true, user: publicUser(user) });
});

app.post('/api/tycoon/upgrade', (req, res) => {
  const user = getFreshUser(req);
  if (!user) return res.status(401).json({ error: 'Inicia sesión' });

  const key = String(req.body.key || '');
  const result = applyTycoonUpgrade(user, key);
  if (result.error) return res.status(400).json({ error: result.error });

  trackTycoonMissions(user, null);
  persistUser(user, req);
  saveAll();
  res.json({
    ok: true,
    key,
    level: result.level,
    coins: user.coins,
    user: publicUser(user),
    tycoonUpgrades: tycoonUpgradeListFor(user),
    missions: missionListFor(user),
  });
});

app.post('/api/siege/start', (req, res) => {
  const user = getFreshUser(req);
  if (!user) return res.status(401).json({ error: 'Inicia sesión' });

  const zone = territories.find((t) => t.id === req.body.zoneId);
  if (!zone) return res.status(404).json({ error: 'Zona no encontrada' });
  if (zone.ownerId === user.id) {
    return res.status(400).json({ error: 'No puedes asediar tu propio territorio' });
  }
  if (isSiegeActive(zone.id)) return res.status(400).json({ error: 'Ya hay un asedio activo' });

  let cost = GAME.SIEGE_COST;
  if (user.inventory.siege_token > 0) {
    user.inventory.siege_token -= 1;
  } else if (user.coins >= cost) {
    user.coins -= cost;
  } else {
    return res.status(400).json({ error: 'Necesitas 75 monedas o un token de asedio' });
  }

  const now = Date.now();
  const siege = {
    zoneId: zone.id,
    attackerId: user.id,
    attackerName: user.username,
    startedAt: now,
    endsAt: now + GAME.SIEGE_DURATION_MS,
    pixelsByUser: {},
  };
  activeSieges.set(zone.id, siege);
  persistUser(user, req);

  io.emit('siege_start', {
    zoneId: zone.id,
    attacker: user.username,
    endsAt: siege.endsAt,
  });
  io.emit('territories', territories.map(publicTerritory));

  res.json({ ok: true, coins: user.coins, endsAt: siege.endsAt });
});

app.get('/auth/discord', (req, res) => {
  if (!DISCORD_CLIENT_ID) return res.status(503).send('Discord OAuth no configurado. Revisa .env');
  const params = new URLSearchParams({
    client_id: DISCORD_CLIENT_ID,
    redirect_uri: DISCORD_CALLBACK_URL,
    response_type: 'code',
    scope: 'identify',
  });
  res.redirect(`https://discord.com/api/oauth2/authorize?${params}`);
});

app.get('/auth/discord/callback', async (req, res) => {
  try {
    const { code } = req.query;
    if (!code) return res.redirect('/?error=no_code');
    const discordUser = await exchangeDiscordCode(code);
    let user = users.get(discordUser.id);
    if (!user) {
      user = normalizeUser({
        id: discordUser.id,
        username: discordUser.global_name || discordUser.username,
        avatar: discordUser.avatar,
        territoryPixels: GAME.STARTER_TERRITORY_PIXELS,
      });
    } else {
      user = normalizeUser({
        ...user,
        username: discordUser.global_name || discordUser.username,
        avatar: discordUser.avatar,
      });
    }
    trackLoginStreak(user);
    users.set(user.id, user);
    req.session.user = sessionUserRef(user);
    saveAll();
    req.session.save((saveErr) => {
      if (saveErr) {
        console.error('Session save error:', saveErr.message);
        return res.redirect('/?error=auth_failed');
      }
      res.redirect('/');
    });
  } catch (err) {
    console.error('Discord auth error:', err.message);
    const msg = String(err.message || '').toLowerCase();
    let code = 'auth_failed';
    if (msg.includes('invalid_client') || msg.includes('client secret')) code = 'invalid_secret';
    else if (msg.includes('redirect_uri') || msg.includes('redirect uri')) code = 'redirect_uri';
    else if (msg.includes('invalid_grant')) code = 'invalid_grant';
    res.redirect(`/?error=${code}`);
  }
});

app.get('/auth/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('pixelmania.sid');
    res.redirect('/');
  });
});

function neighborPaintBonus(user, x, y) {
  const lvl = tycoonFx.upgradeLevel(user, 'neighbor_bonus');
  if (lvl <= 0) return 0;
  for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
    const p = pixels.get(pixelKey(nx, ny));
    if (p && String(p.u) !== String(user.id)) return lvl;
  }
  return 0;
}

function computePaintCoinGain(user, xi, yi, existing, ty) {
  let coinGain = Math.floor(GAME.TYCOON_COINS_PER_PIXEL * coinMultiplier(user));
  coinGain = Math.floor(coinGain * minigamesCfg.paintZoneMult(xi, yi));
  if (tycoonFx.rollDoublePaint(user)) coinGain *= 2;
  coinGain += tycoonFx.rollLuckyBonus(user);
  coinGain += tycoonFx.rushPixelBonus(user, ty.pixelsThisCycle);
  coinGain += tycoonFx.salvageBonus(user, existing, user.id);
  coinGain += tycoonFx.territoryPaintBonus(user, xi, yi, getTerritoryAt, user.id);
  coinGain += neighborPaintBonus(user, xi, yi);
  ty.pixelsThisCycle += 1;
  return coinGain;
}

function attemptPaintCell(user, xi, yi, colorNorm, socket, { rateLimit, batch }) {
  if (!validCoord(xi, yi)) return 'noop';

  const existing = pixels.get(pixelKey(xi, yi));
  if (existing && existing.u === user.id && existing.c.toUpperCase() === colorNorm) return 'noop';

  const territory = getTerritoryAt(xi, yi);
  if (territory && !canPaintInTerritory(user, territory)) {
    socket.emit('error_msg', {
      message: `Territorio protegido de ${territory.ownerName}. Inicia un asedio para conquistarlo.`,
      zoneId: territory.id,
    });
    return 'blocked';
  }

  const quota = getQuota(user.id);
  if (quota.remaining <= 0) {
    socket.emit('quota', quotaForClient(user.id));
    const waitSec = Math.max(1, Math.ceil((quota.resetAt - Date.now()) / 1000));
    socket.emit('error_msg', {
      message: waitSec < 120
        ? `Sin píxeles. Recarga en ${waitSec}s`
        : `Sin píxeles. Recarga en ${Math.ceil(waitSec / 60)} min`,
    });
    return 'blocked';
  }

  const hasBrush = user.gadgets?.includes(GAME.GADGET_BRUSH_CORRIDO);
  const now = Date.now();
  const cellKey = pixelKey(xi, yi);
  if (rateLimit && !hasBrush) {
    const lastKey = paintLastKey.get(user.id) || '';
    const last = paintLastAt.get(user.id) || 0;
    const minMs = tycoonFx.paintCooldownMs(user, lastKey === cellKey);
    if (now - last < minMs) return 'noop';
    paintLastAt.set(user.id, now);
    paintLastKey.set(user.id, cellKey);
  }

  let required = clicksRequired(user);
  if (existing && existing.u === user.id) required = 1;

  if (batch) {
    chiselProgress.delete(chiselKey(user.id, xi, yi));
    required = 1;
  }

  if (required > 1) {
    const ck = chiselKey(user.id, xi, yi);
    let prog = chiselProgress.get(ck);
    if (!prog || prog.color !== colorNorm) prog = { taps: 0, lastAt: now, color: colorNorm };

    const t = normalizeTycoon(user);
    const comboKey = `${xi},${yi}`;
    let tapGain = 1;
    if (t.lastComboKey === comboKey && now - t.lastComboAt <= GAME.TYCOON_COMBO_WINDOW_MS) {
      tapGain = comboBonusTaps(user);
    }
    t.lastComboKey = comboKey;
    t.lastComboAt = now;
    t.totalTaps += tapGain;
    prog.taps += tapGain;
    prog.lastAt = now;
    chiselProgress.set(ck, prog);

    const xpGain = grantTycoonXp(user, GAME.TYCOON_XP_PER_TAP * tapGain);
    const comboCoins = tycoonFx.comboCoinBonus(user, tapGain);
    if (comboCoins > 0) user.coins = (user.coins || 0) + comboCoins;
    trackTycoonMissions(user, socket);
    users.set(user.id, user);

    if (prog.taps < required) {
      socket.emit('chisel_progress', {
        x: xi,
        y: yi,
        current: prog.taps,
        required,
        color: colorNorm,
        combo: tapGain > 1,
      });
      socket.emit('tycoon', tycoonForClient(user));
      if (xpGain.levelUp) {
        socket.emit('tycoon_level', {
          level: xpGain.newLevel,
          bonusCoins: xpGain.levelUpCoins,
          tycoon: tycoonForClient(user),
        });
      }
      if (xpGain.levelUpCoins > 0) socket.emit('wallet', { coins: user.coins });
      return 'chisel';
    }
    chiselProgress.delete(ck);
  }

  const quotaNow = getQuota(user.id);
  if (quotaNow.remaining <= 0) {
    socket.emit('quota', quotaForClient(user.id));
    const waitSec = Math.max(1, Math.ceil((quotaNow.resetAt - Date.now()) / 1000));
    socket.emit('error_msg', {
      message: waitSec < 120
        ? `Sin píxeles. Recarga en ${waitSec}s`
        : `Sin píxeles. Recarga en ${Math.ceil(waitSec / 60)} min`,
    });
    return 'blocked';
  }

  if (!tycoonFx.rollFreeQuota(user)) {
    quotaNow.remaining -= 1;
  }
  user = users.get(user.id) || user;
  const pub = publicUser(user);
  const pr = profileCosmetics.compactSnapshot(user);
  const pixel = { x: xi, y: yi, c: colorNorm, u: pub.id, n: pub.username, a: pub.avatar };
  if (pr) pixel.pr = pr;
  pixels.set(pixelKey(xi, yi), pixel);

  const ty = normalizeTycoon(user);
  ty.totalPixels += 1;
  ty.lastPassiveAt = now;
  const coinGain = computePaintCoinGain(user, xi, yi, existing, ty);
  user.coins = (user.coins || 0) + coinGain;
  const xpGain = grantTycoonXp(user, GAME.TYCOON_XP_PER_PIXEL + tycoonFx.xpPerPixelBonus(user));
  trackTycoonMissions(user, socket);

  if (territory && isSiegeActive(territory.id)) trackSiegePixel(user, territory);
  trackMissions(user, xi, yi, colorNorm, socket);
  users.set(user.id, user);

  io.emit('pixel', buildPixelUpdate(pixel));
  socket.emit('quota', quotaForClient(user.id));
  socket.emit('wallet', { coins: user.coins });
  socket.emit('tycoon', tycoonForClient(user));
  socket.emit('missions', missionListFor(user));
  if (xpGain.levelUp) {
    socket.emit('tycoon_level', {
      level: xpGain.newLevel,
      bonusCoins: xpGain.levelUpCoins,
      tycoon: tycoonForClient(user),
    });
  }
  return 'placed';
}

function countBatchPaintCells(cells, user, colorNorm) {
  let n = 0;
  for (const [cx, cy] of cells) {
    if (!validCoord(cx, cy)) continue;
    const existing = pixels.get(pixelKey(cx, cy));
    if (existing && existing.u === user.id && existing.c.toUpperCase() === colorNorm) continue;
    n++;
  }
  return n;
}

function validateBatchTerritory(user, cells) {
  for (const [cx, cy] of cells) {
    if (!validCoord(cx, cy)) continue;
    const territory = getTerritoryAt(cx, cy);
    if (territory && !canPaintInTerritory(user, territory)) {
      return {
        ok: false,
        message: `Territorio protegido de ${territory.ownerName}. Inicia un asedio para conquistarlo.`,
        zoneId: territory.id,
      };
    }
  }
  return { ok: true };
}

function paintCellBatch(user, cells, colorNorm, socket, paintOpts = {}) {
  if (!cells.length) return;
  const tool = paintOpts.tool ?? paintTools.resolveEquippedTool(user, paintOpts.brush);
  const blockSize = paintTools.resolveEquippedBlockSize(user, paintOpts.blockSize);
  const batch = paintTools.isBatchPaint(user, cells, tool, blockSize, paintOpts.blockSize);
  if (batch) {
    const check = validateBatchTerritory(user, cells);
    if (!check.ok) {
      socket.emit('error_msg', { message: check.message, zoneId: check.zoneId });
      return;
    }
    const needed = countBatchPaintCells(cells, user, colorNorm);
    const quota = getQuota(user.id);
    if (needed > 0 && quota.remaining < needed) {
      socket.emit('quota', quotaForClient(user.id));
      socket.emit('error_msg', {
        message: `Necesitas ${needed} píxeles para esta forma (tienes ${quota.remaining})`,
      });
      return;
    }
    for (const [cx, cy] of cells) {
      const ck = chiselKey(user.id, cx, cy);
      if (chiselProgress.has(ck)) {
        chiselProgress.delete(ck);
        socket.emit('chisel_clear', { x: cx, y: cy });
      }
    }
  }

  let rateLimit = true;
  for (const [cx, cy] of cells) {
    const result = attemptPaintCell(user, cx, cy, colorNorm, socket, { rateLimit, batch });
    user = users.get(user.id) || user;
    rateLimit = false;
    if (result === 'blocked') break;
    if (!batch && result === 'chisel') break;
  }
}

function handleFloodFill(user, xi, yi, colorNorm, socket) {
  const fillColorAt = (x, y) => {
    const p = pixels.get(pixelKey(x, y));
    return p ? p.c.toUpperCase() : '__EMPTY__';
  };
  const cells = paintTools.floodFillCells(xi, yi, fillColorAt, colorNorm, 180);
  paintCellBatch(user, cells, colorNorm, socket);
}

io.on('connection', (socket) => {
  onlineUsers.add(socket.id);
  let user = getFreshUser(socket.request);
  if (user) {
    user = users.get(user.id) || user;
    trackLoginStreak(user);
    users.set(user.id, user);
    socket.pmUserId = user.id;
    socketsByUser.set(user.id, socket);
  }

  socket.emit('init', {
    infinite: true,
    spawn: { x: 0, y: 0 },
    pixels: serializePixels().map(buildPixelUpdate),
    cooldownMs: COOLDOWN_MS,
    pixelsPerInterval: PIXELS_PER_INTERVAL,
    quota: user ? quotaForClient(user.id) : null,
    user: publicUser(user),
    missions: user ? missionListFor(user) : [],
    shopCount: GAME.SHOP.length,
    tycoonUpgrades: tycoonUpgradeListFor(user),
    tycoonConfig: {
      startClicks: GAME.TYCOON_START_CLICKS,
      minClicks: GAME.TYCOON_MIN_CLICKS,
    },
    zoomLens: {
      maxLevel: zoomLens.ZOOM_LENS_MAX_LEVEL,
    },
    paintZones: minigamesCfg.PAINT_ZONES,
    arcadeGames: minigamesCfg.listGames(),
    arcadeLive: [...liveArcadePlayers.values()],
    territories: territories.map(publicTerritory),
    online: onlineUsers.size,
    discordConfigured: Boolean(DISCORD_CLIENT_ID),
  });

  io.emit('online', onlineUsers.size);

  socket.on('claim_territory', ({ x, y, w, h }) => {
    user = getFreshUser(socket.request);
    if (!user) return socket.emit('error_msg', { message: 'Inicia sesión' });
    user = users.get(user.id) || user;

    const xi = Math.floor(x);
    const yi = Math.floor(y);
    let wi = Math.floor(w);
    let hi = Math.floor(h);
    if (wi < 1 || hi < 1) return socket.emit('error_msg', { message: 'Área inválida' });
    if (!validCoord(xi, yi) || !validCoord(xi + wi - 1, yi + hi - 1)) {
      return socket.emit('error_msg', { message: 'El área está demasiado lejos del origen' });
    }

    const area = wi * hi;
    const available = user.territoryPixels || 0;
    if (available <= 0) {
      return socket.emit('claim_limit', { message: 'Sin píxeles de territorio. Cómpralos en la tienda.', available: 0 });
    }

    let capped = false;
    if (area > available) {
      capped = true;
      const ratio = Math.sqrt(available / area);
      wi = Math.max(1, Math.floor(wi * ratio));
      hi = Math.max(1, Math.floor(hi * ratio));
      while (wi * hi > available) {
        if (wi > hi) wi--;
        else hi--;
      }
    }

    const newRect = { x: xi, y: yi, w: wi, h: hi };
    if (overlapsOwnTerritory(newRect, user.id)) {
      return socket.emit('error_msg', { message: 'El área solapa con territorio que ya reclamaste' });
    }
    for (const t of territories) {
      if (t.ownerId !== user.id && rectsOverlap(newRect, t)) {
        return socket.emit('error_msg', { message: 'Solapa con territorio de otro jugador' });
      }
    }

    const finalArea = wi * hi;
    user.territoryPixels = available - finalArea;
    const territory = normalizeTerritory({
      id: uid(),
      x: xi,
      y: yi,
      w: wi,
      h: hi,
      ownerId: user.id,
      ownerName: user.username,
      color: user.claimColor || defaultClaimColor(user.id),
      claimedAt: Date.now(),
    });
    territories.push(territory);
    persistUser(user, socket.request);
    saveAll();

    io.emit('territory_new', publicTerritory(territory));
    socket.emit('wallet', {
      coins: user.coins,
      territoryPixels: user.territoryPixels,
      claimColor: user.claimColor,
    });
    socket.emit('claim_result', {
      ok: true,
      capped,
      message: capped
        ? `Área limitada: solo tenías ${available} píxeles de territorio disponibles`
        : `Territorio reclamado (${finalArea} px)`,
      territory: publicTerritory(territory),
    });
  });

  socket.on('place_pixel', ({ x, y, color, brush, blockSize }) => {
    user = getFreshUser(socket.request);
    if (!user) return socket.emit('error_msg', { message: 'Inicia sesión con Discord' });

    const xi = Math.trunc(Number(x));
    const yi = Math.trunc(Number(y));
    const colorNorm = String(color || '').trim().toUpperCase();
    if (!Number.isInteger(xi) || !Number.isInteger(yi) || !validCoord(xi, yi)) {
      return socket.emit('error_msg', { message: 'Coordenadas inválidas' });
    }
    if (!/^#[0-9A-F]{6}$/.test(colorNorm)) return socket.emit('error_msg', { message: 'Color inválido' });
    if (!colorSystem.canUseColor(user, colorNorm)) {
      return socket.emit('error_msg', { message: 'Compra este color en la Tienda (categoría Colores) para usarlo.' });
    }

    user = users.get(user.id) || user;

    const brushNorm = brush === undefined ? undefined : (brush === null || brush === '' ? null : String(brush));
    const blockNorm = blockSize === undefined ? undefined : Math.trunc(Number(blockSize));

    const tool = paintTools.resolveEquippedTool(user, brushNorm);
    if (tool === 'paint_bucket') {
      return handleFloodFill(user, xi, yi, colorNorm, socket);
    }

    const cells = paintTools.paintCellsForUser(user, xi, yi, {
      brush: brushNorm,
      blockSize: blockNorm,
    });
    paintCellBatch(user, cells, colorNorm, socket, {
      brush: brushNorm,
      blockSize: blockNorm,
      tool,
    });
  });

  socket.on('disconnect', () => {
    if (socket.pmUserId) {
      socketsByUser.delete(socket.pmUserId);
      if (liveArcadePlayers.delete(socket.pmUserId)) broadcastLiveArcade();
      minigameSessions.delete(socket.pmUserId);
    }
    onlineUsers.delete(socket.id);
    io.emit('online', onlineUsers.size);
  });
});

function serializePixels() {
  return [...pixels.values()];
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

function gracefulShutdown(signal) {
  console.log(`${signal} — guardando datos…`);
  saveAll();
  server.close(() => {
    console.log('Servidor cerrado.');
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 12_000).unref();
}

server.listen(PORT, () => {
  const url = resolvePublicUrl();
  console.log(`PixelMania → ${url}${IS_PROD ? '' : ` (puerto ${PORT})`}`);
  console.log(`Modo: ${IS_PROD ? 'producción' : 'desarrollo'} | Health: ${url}/health`);
  console.log(`Sesiones: ${USE_MEMORY_SESSIONS ? 'memoria' : 'JSON persistente'}`);
  console.log(`Territorios: ${territories.length} | Misiones: ${GAME.MISSIONS.length} | Tienda: ${GAME.SHOP.length} items`);
  if (DISCORD_CLIENT_ID) {
    console.log(`Discord OAuth → redirect: ${DISCORD_CALLBACK_URL}`);
    console.log('  Copia esa URL en Discord Developer Portal → OAuth2 → Redirects');
  }
  if (IS_PROD && !DISCORD_CLIENT_ID) console.warn('Discord OAuth desactivado — configura DISCORD_* en .env');
});
