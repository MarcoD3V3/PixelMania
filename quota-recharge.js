/** Acelerador de recarga de píxeles — niveles infinitos, mínimo 1 min, precios hasta trillones */
const SHOP_KEY = 'recharge_accelerator';
const BASE_COOLDOWN_MS = 10 * 60 * 1000;
const MIN_COOLDOWN_MS = 60 * 1000;
const SEC_REDUCTION_PER_LEVEL = 1;
const MAX_USEFUL_LEVEL = Math.floor((BASE_COOLDOWN_MS - MIN_COOLDOWN_MS) / 1000);

function levelFromUser(user) {
  return Math.max(0, Math.trunc(user?.shopLevels?.[SHOP_KEY] || 0));
}

function secondsReduction(level) {
  const lv = Math.max(0, Math.trunc(level));
  return Math.min(MAX_USEFUL_LEVEL, lv * SEC_REDUCTION_PER_LEVEL);
}

function cooldownMsForLevel(level, user) {
  let ms = BASE_COOLDOWN_MS - secondsReduction(level) * 1000;
  ms = Math.max(MIN_COOLDOWN_MS, ms);
  if (user) {
    const tycoonFx = require('./tycoon-effects');
    ms = Math.floor(ms * tycoonFx.quotaCooldownMult(user));
  }
  return Math.max(MIN_COOLDOWN_MS, ms);
}

function cooldownMsForUser(user) {
  return cooldownMsForLevel(levelFromUser(user), user);
}

function cooldownSecForLevel(level, user) {
  return Math.ceil(cooldownMsForLevel(level, user) / 1000);
}

function formatCooldown(sec) {
  const s = Math.max(0, Math.trunc(sec));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, '0')}`;
}

function priceForLevel(currentLevel) {
  const lv = Math.max(0, Math.trunc(currentLevel));
  const base = 340;
  const growth = 1.116;
  let price = base * (growth ** lv);
  price *= 1 + Math.floor(lv / 35) * 0.42;
  if (lv > 0 && lv % 50 === 0) price *= 1.85;
  if (lv >= 180) price *= 1.06 ** (lv - 180);
  if (lv >= 240) price *= 1.04 ** (lv - 240);
  return Math.max(1, Math.floor(price));
}

function previewForLevel(level) {
  const lv = Math.max(1, Math.trunc(level));
  const sec = cooldownSecForLevel(lv, null);
  const red = secondsReduction(lv);
  return {
    name: `Acelerador nv.${lv}`,
    desc: red >= MAX_USEFUL_LEVEL
      ? `Recarga mínima: ${formatCooldown(MIN_COOLDOWN_MS / 1000)} (1 min)`
      : `Recarga en ${formatCooldown(sec)} (−${red}s vs base)`,
    cooldownSec: sec,
    reductionSec: red,
  };
}

function onLevelUp(userId, oldLevel, newLevel, user, quotasMap) {
  const q = quotasMap.get(userId);
  if (!q || q.remaining > 0) return;
  const now = Date.now();
  if (now >= q.resetAt) return;
  const remaining = q.resetAt - now;
  const oldCd = cooldownMsForLevel(oldLevel, user);
  const newCd = cooldownMsForLevel(newLevel, user);
  if (oldCd <= 0) return;
  const scaled = Math.floor(remaining * (newCd / oldCd));
  q.resetAt = now + Math.max(1000, Math.min(remaining, scaled));
}

module.exports = {
  SHOP_KEY,
  BASE_COOLDOWN_MS,
  MIN_COOLDOWN_MS,
  MAX_USEFUL_LEVEL,
  levelFromUser,
  cooldownMsForUser,
  cooldownMsForLevel,
  cooldownSecForLevel,
  formatCooldown,
  priceForLevel,
  previewForLevel,
  onLevelUp,
};
