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
const colorSystem = require('./color-system');
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

const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID || '';
const DISCORD_CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET || '';
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

const SESSION_MAX_AGE = 90 * 24 * 60 * 60 * 1000; // 90 días
const FileStore = require('session-file-store')(session);

const app = express();
if (TRUST_PROXY) app.set('trust proxy', 1);

const server = http.createServer(app);
const sessionMiddleware = session({
  store: new FileStore({
    path: SESSIONS_DIR,
    ttl: SESSION_MAX_AGE / 1000,
    retries: 0,
  }),
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

app.use((req, _res, next) => {
  if (req.session?.user) req.session.touch();
  next();
});

app.use(express.json({ limit: '256kb' }));
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
  };
}

function normalizeTycoon(user) {
  if (!user.tycoon || typeof user.tycoon !== 'object') user.tycoon = defaultTycoon();
  if (!user.tycoon.upgrades) user.tycoon.upgrades = {};
  user.tycoon.totalPixels = user.tycoon.totalPixels || 0;
  user.tycoon.totalTaps = user.tycoon.totalTaps || 0;
  user.tycoon.xp = user.tycoon.xp || 0;
  user.tycoon.lastPassiveAt = user.tycoon.lastPassiveAt || Date.now();
  return user.tycoon;
}

function tycoonUpgradeLevel(user, key) {
  return normalizeTycoon(user).upgrades[key] || 0;
}

function tycoonUpgradeDef(key) {
  return GAME.TYCOON_UPGRADES.find((u) => u.key === key);
}

function tycoonUpgradePrice(key, currentLevel) {
  const def = tycoonUpgradeDef(key);
  if (!def) return Infinity;
  return Math.floor(def.basePrice * def.priceGrowth ** currentLevel);
}

function clicksRequired(user) {
  const chisel = tycoonUpgradeLevel(user, 'chisel');
  return Math.max(GAME.TYCOON_MIN_CLICKS, GAME.TYCOON_START_CLICKS - chisel);
}

function quotaBonus(user) {
  const lvl = tycoonUpgradeLevel(user, 'quota');
  const def = tycoonUpgradeDef('quota');
  return lvl * (def?.effect || 120);
}

function comboBonusTaps(user) {
  return 1 + tycoonUpgradeLevel(user, 'combo') * (tycoonUpgradeDef('combo')?.effect || 1);
}

function xpMultiplier(user) {
  const lvl = tycoonUpgradeLevel(user, 'xp_boost');
  const def = tycoonUpgradeDef('xp_boost');
  return 1 + lvl * (def?.effect || 0.2);
}

function coinMultiplier(user) {
  const lvl = tycoonUpgradeLevel(user, 'coin_mult');
  const def = tycoonUpgradeDef('coin_mult');
  return 1 + lvl * (def?.effect || 0.12);
}

function passiveRatePerMin(user) {
  const lvl = tycoonUpgradeLevel(user, 'passive');
  const def = tycoonUpgradeDef('passive');
  return lvl * (def?.effect || 3);
}

function tycoonLevelFromXp(xp) {
  const table = GAME.TYCOON_LEVEL_XP;
  let level = 0;
  for (let i = 1; i < table.length; i++) {
    if (xp >= table[i]) level = i;
    else break;
  }
  return level;
}

function xpForNextLevel(level) {
  const table = GAME.TYCOON_LEVEL_XP;
  if (level + 1 >= table.length) return table[table.length - 1] + (level - table.length + 2) * 800;
  return table[level + 1];
}

function xpForCurrentLevel(level) {
  const table = GAME.TYCOON_LEVEL_XP;
  return table[level] || 0;
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

function tickPassiveIncome(user) {
  const rate = passiveRatePerMin(user);
  if (rate <= 0) return 0;
  const t = normalizeTycoon(user);
  const now = Date.now();
  const minutes = Math.floor((now - (t.lastPassiveAt || now)) / 60000);
  if (minutes < 1) return 0;
  const earned = minutes * rate;
  user.coins = (user.coins || 0) + earned;
  t.lastPassiveAt += minutes * 60000;
  return earned;
}

function tycoonForClient(user) {
  if (!user) return null;
  const t = normalizeTycoon(user);
  tickPassiveIncome(user);
  const level = tycoonLevelFromXp(t.xp);
  const upgrades = {};
  for (const def of GAME.TYCOON_UPGRADES) {
    upgrades[def.key] = t.upgrades[def.key] || 0;
  }
  return {
    level,
    xp: t.xp,
    xpCurrent: t.xp - xpForCurrentLevel(level),
    xpNext: xpForNextLevel(level) - xpForCurrentLevel(level),
    totalPixels: t.totalPixels,
    totalTaps: t.totalTaps,
    clicksRequired: clicksRequired(user),
    passivePerMin: passiveRatePerMin(user),
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
      price: maxed ? null : tycoonUpgradePrice(def.key, level),
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
  const price = tycoonUpgradePrice(key, level);
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

function loadUsers() {
  users = new Map(loadJson(USERS_FILE, []).map((u) => [u.id, normalizeUser(u)]));
}

function loadTerritories() {
  territories = loadJson(TERRITORIES_FILE, []).map(normalizeTerritory);
}

function saveAll() {
  saveJson(DATA_FILE, [...pixels.values()]);
  saveJson(USERS_FILE, [...users.values()]);
  saveJson(TERRITORIES_FILE, territories);
}

loadPixels();
loadUsers();
loadTerritories();
setInterval(saveAll, SAVE_INTERVAL_MS);

function defaultClaimColor(userId) {
  const hues = ['#7c3aed', '#ef476f', '#06ffa5', '#ffbe0b', '#118ab2', '#ff006e'];
  const idx = Number(BigInt(userId || '0') % BigInt(hues.length));
  return hues[idx];
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
    shopLevels: u.shopLevels && typeof u.shopLevels === 'object' ? u.shopLevels : {},
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
    if (req?.session) req.session.user = user;
  } else {
    user = normalizeUser(sessionUser);
    users.set(user.id, user);
  }
  tickPassiveIncome(user);
  return user;
}

function persistUser(user, req) {
  users.set(user.id, user);
  if (req?.session) req.session.user = user;
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
    shopLevels: user.shopLevels || {},
    availableColors: colorSystem.colorsForUser(user),
    freeColors: colorSystem.FREE_COLORS,
    zoomLimits: zoomLens.zoomLimitsForLevel(zoomLens.zoomLensLevel(user)),
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
    if (item.item === 'paint_boost') {
      user.paintBoost = (user.paintBoost || 0) + item.amount;
    } else {
      user.inventory[item.item] = (user.inventory[item.item] || 0) + (item.amount || 1);
    }
  } else if (item.type === 'leveled') {
    const key = item.upgradeKey || item.id;
    if (!user.shopLevels) user.shopLevels = {};
    const newLvl = (user.shopLevels[key] || 0) + 1;
    user.shopLevels[key] = newLvl;
    shopLevels.applyLeveledReward(user, item, newLvl);
  }
}

function getQuota(userId) {
  const user = users.get(userId);
  const now = Date.now();
  let q = quotas.get(userId);
  if (!q || now >= q.resetAt) {
    const bonus = user?.paintBoost || 0;
    if (user?.paintBoost) {
      user.paintBoost = 0;
      users.set(userId, user);
    }
    q = {
      remaining: PIXELS_PER_INTERVAL + bonus + quotaBonus(user),
      max: PIXELS_PER_INTERVAL + bonus + quotaBonus(user),
      resetAt: now + COOLDOWN_MS,
    };
    quotas.set(userId, q);
  }
  return q;
}

function quotaForClient(userId) {
  const user = users.get(userId);
  const q = getQuota(userId);
  const max = q.max ?? (PIXELS_PER_INTERVAL + quotaBonus(user));
  return {
    remaining: Math.max(0, q.remaining),
    max,
    resetIn: Math.max(0, q.resetAt - Date.now()),
    cooldownMs: COOLDOWN_MS,
  };
}

function buildPixelUpdate(pixel) {
  return {
    x: pixel.x,
    y: pixel.y,
    c: pixel.c,
    u: pixel.u,
    n: pixel.n,
    a: pixel.a,
  };
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
  const reward = Math.floor(mission.reward * coinMultiplier(user));
  user.coins += reward;
  users.set(user.id, user);
  if (socket) {
    socket.emit('mission_complete', { id: missionId, reward, coins: user.coins });
    socket.emit('wallet', { coins: user.coins });
    if (socket.request?.session) socket.request.session.user = user;
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
  if (!tokenRes.ok) throw new Error('Token exchange failed');
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
    req.session.user = user;
    saveAll();
    res.redirect('/');
  } catch (err) {
    console.error('Discord auth error:', err.message);
    res.redirect('/?error=auth_failed');
  }
});

app.get('/auth/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('pixelmania.sid');
    res.redirect('/');
  });
});

io.on('connection', (socket) => {
  onlineUsers.add(socket.id);
  let user = getFreshUser(socket.request);
  if (user) {
    user = users.get(user.id) || user;
    trackLoginStreak(user);
    users.set(user.id, user);
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
    shop: GAME.SHOP,
    shopCategories: GAME.SHOP_CATEGORIES,
    tycoonUpgrades: tycoonUpgradeListFor(user),
    tycoonConfig: {
      startClicks: GAME.TYCOON_START_CLICKS,
      minClicks: GAME.TYCOON_MIN_CLICKS,
    },
    zoomLens: {
      maxLevel: zoomLens.ZOOM_LENS_MAX_LEVEL,
    },
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

  socket.on('place_pixel', ({ x, y, color }) => {
    user = getFreshUser(socket.request);
    if (!user) return socket.emit('error_msg', { message: 'Inicia sesión con Discord' });
    user = users.get(user.id) || user;

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

    const existing = pixels.get(pixelKey(xi, yi));
    if (existing && existing.u === user.id && existing.c.toUpperCase() === colorNorm) return;

    const territory = getTerritoryAt(xi, yi);
    if (territory && !canPaintInTerritory(user, territory)) {
      return socket.emit('error_msg', {
        message: `Territorio protegido de ${territory.ownerName}. Inicia un asedio para conquistarlo.`,
        zoneId: territory.id,
      });
    }

    const quota = getQuota(user.id);
    if (quota.remaining <= 0) {
      socket.emit('quota', quotaForClient(user.id));
      return socket.emit('error_msg', {
        message: `Sin píxeles. Recarga en ${Math.ceil((quota.resetAt - Date.now()) / 60000)} min`,
      });
    }

    const hasBrush = user.gadgets?.includes(GAME.GADGET_BRUSH_CORRIDO);
    const now = Date.now();
    const cellKey = pixelKey(xi, yi);
    if (!hasBrush) {
      const lastKey = paintLastKey.get(user.id) || '';
      const last = paintLastAt.get(user.id) || 0;
      const minMs = lastKey === cellKey ? GAME.CHISEL_SAME_PIXEL_MS : GAME.CLICK_ONLY_PAINT_MS;
      if (now - last < minMs) return;
      paintLastAt.set(user.id, now);
      paintLastKey.set(user.id, cellKey);
    }

    let required = clicksRequired(user);
    if (existing && existing.u === user.id) required = 1;

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
        return;
      }
      chiselProgress.delete(ck);
    }

    if (quota.remaining <= 0) {
      socket.emit('quota', quotaForClient(user.id));
      return socket.emit('error_msg', {
        message: `Sin píxeles. Recarga en ${Math.ceil((quota.resetAt - Date.now()) / 60000)} min`,
      });
    }

    quota.remaining -= 1;
    user = users.get(user.id) || user;
    const pub = publicUser(user);
    const pixel = { x: xi, y: yi, c: colorNorm, u: pub.id, n: pub.username, a: pub.avatar };
    pixels.set(pixelKey(xi, yi), pixel);

    const ty = normalizeTycoon(user);
    ty.totalPixels += 1;
    ty.lastPassiveAt = now;
    const coinGain = Math.floor(GAME.TYCOON_COINS_PER_PIXEL * coinMultiplier(user));
    user.coins = (user.coins || 0) + coinGain;
    const xpGain = grantTycoonXp(user, GAME.TYCOON_XP_PER_PIXEL);
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
  });

  socket.on('disconnect', () => {
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
  console.log(`Territorios: ${territories.length} | Misiones: ${GAME.MISSIONS.length} | Tienda: ${GAME.SHOP.length} items`);
  if (IS_PROD && !DISCORD_CLIENT_ID) console.warn('Discord OAuth desactivado — configura DISCORD_* en .env');
});
