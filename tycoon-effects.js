/** Efectos de mejoras Tycoon — lógica compartida del servidor */
const GAME = require('./game-config');

function upgradeLevel(user, key) {
  return user?.tycoon?.upgrades?.[key] || 0;
}

function upgradeDef(key) {
  const list = GAME.TYCOON_UPGRADES;
  if (!Array.isArray(list)) return undefined;
  return list.find((u) => u.key === key);
}

function passiveBaseRate(user) {
  const lvl = upgradeLevel(user, 'passive');
  const def = upgradeDef('passive');
  return lvl * (def?.effect || 3);
}

function passiveRatePerMin(user) {
  let rate = passiveBaseRate(user);
  if (rate <= 0) return 0;
  rate *= 1 + upgradeLevel(user, 'investor') * 0.08;
  const harvest = upgradeLevel(user, 'harvester');
  if (harvest > 0) {
    const pixels = user?.tycoon?.totalPixels || 0;
    rate += Math.floor(pixels / 1000) * harvest * 0.05;
  }
  return Math.max(0, Math.floor(rate));
}

function maxIdleMinutes(user) {
  const vault = upgradeLevel(user, 'vault');
  if (vault <= 0) return 12 * 60;
  return 60 + vault * 45;
}

function coinMultiplier(user) {
  const lvl = upgradeLevel(user, 'coin_mult');
  return 1 + lvl * (upgradeDef('coin_mult')?.effect || 0.12);
}

function missionRewardMult(user) {
  return 1 + upgradeLevel(user, 'mission_bonus') * 0.08;
}

function xpMultiplier(user) {
  const lvl = upgradeLevel(user, 'xp_boost');
  return 1 + lvl * (upgradeDef('xp_boost')?.effect || 0.2);
}

function comboBonusTaps(user) {
  return 1 + upgradeLevel(user, 'combo') * (upgradeDef('combo')?.effect || 1);
}

function quotaBonus(user) {
  const lvl = upgradeLevel(user, 'quota');
  return lvl * (upgradeDef('quota')?.effect || 120);
}

function quotaCooldownMult(user) {
  return Math.max(0.65, 1 - upgradeLevel(user, 'reload') * 0.05);
}

function clicksRequired(user) {
  const chisel = upgradeLevel(user, 'chisel');
  const minClicks = GAME.TYCOON_MIN_CLICKS ?? 1;
  const startClicks = GAME.TYCOON_START_CLICKS ?? 10;
  return Math.max(minClicks, startClicks - chisel);
}

function paintCooldownMs(user, sameCell) {
  let ms = sameCell ? GAME.CHISEL_SAME_PIXEL_MS : GAME.CLICK_ONLY_PAINT_MS;
  ms -= upgradeLevel(user, 'brush_speed') * 40;
  return Math.max(80, ms);
}

function tycoonUpgradePrice(user, key, basePrice) {
  const discount = upgradeLevel(user, 'discount') * 0.05;
  return Math.max(1, Math.floor(basePrice * (1 - discount)));
}

function minigameRewardMult(user) {
  return 1 + upgradeLevel(user, 'minigame_boost') * 0.15;
}

function minigameCooldownMult(user) {
  return Math.max(0.5, 1 - upgradeLevel(user, 'arcade_pass') * 0.1);
}

function rollLuckyBonus(user) {
  const lvl = upgradeLevel(user, 'lucky_pixel');
  if (lvl <= 0) return 0;
  if (Math.random() < lvl * 0.03) return 4 + lvl;
  return 0;
}

function rollDoublePaint(user) {
  const lvl = upgradeLevel(user, 'double_paint');
  if (lvl <= 0) return false;
  return Math.random() < lvl * 0.02;
}

function rollFreeQuota(user) {
  const lvl = upgradeLevel(user, 'efficiency');
  if (lvl <= 0) return false;
  return Math.random() < lvl * 0.02;
}

function rushPixelBonus(user, pixelsThisCycle) {
  const lvl = upgradeLevel(user, 'rush_pixels');
  if (lvl <= 0) return 0;
  const limit = 40 + lvl * 10;
  if (pixelsThisCycle > limit) return 0;
  return lvl;
}

function comboCoinBonus(user, tapGain) {
  const lvl = upgradeLevel(user, 'combo_coins');
  if (lvl <= 0 || tapGain <= 1) return 0;
  return lvl;
}

function salvageBonus(user, existing, painterId) {
  const lvl = upgradeLevel(user, 'salvage');
  if (lvl <= 0 || !existing || existing.u !== painterId) return 0;
  return lvl;
}

function territoryPaintBonus(user, x, y, getTerritoryAt, ownerId) {
  const lvl = upgradeLevel(user, 'territory_yield');
  if (lvl <= 0) return 0;
  const t = getTerritoryAt?.(x, y);
  if (!t || String(t.ownerId) !== String(ownerId)) return 0;
  return lvl * 2;
}

function xpPerPixelBonus(user) {
  return upgradeLevel(user, 'xp_turbo') * 5;
}

function scoutXpPerMinute(user) {
  return upgradeLevel(user, 'scout_xp');
}

function describeUpgradeEffect(def, level, maxed) {
  const cur = level;
  const next = maxed ? level : level + 1;
  const eff = def.effect || 1;
  switch (def.key) {
    case 'chisel':
      return maxed ? '1 clic por celda vacía' : `${Math.max(1, 10 - cur - 1)} → ${Math.max(1, 10 - next - 1)} clics/celda`;
    case 'quota':
      return `+${cur * 120} px recarga${maxed ? '' : ` → +${next * 120}`}`;
    case 'combo':
      return `Combo +${cur} extra${maxed ? '' : ` → +${next}`}`;
    case 'passive':
      return `${cur * 3}🪙/min${maxed ? '' : ` → ${next * 3}🪙/min`} (idle)`;
    case 'coin_mult':
      return `+${Math.round(cur * 12)}% monedas${maxed ? '' : ` → +${Math.round(next * 12)}%`}`;
    case 'xp_boost':
      return `+${Math.round(cur * 20)}% XP${maxed ? '' : ` → +${Math.round(next * 20)}%`}`;
    case 'investor':
      return `+${Math.round(cur * 8)}% idle${maxed ? '' : ` → +${Math.round(next * 8)}%`}`;
    case 'harvester':
      return `Idle +${(cur * 0.05).toFixed(2)}/1k px pintados`;
    case 'lucky_pixel':
      return `${cur * 3}% suerte +${4 + cur}🪙`;
    case 'reload':
      return `Recarga ${Math.round(cur * 5)}% más rápida`;
    case 'mission_bonus':
      return `+${Math.round(cur * 8)}% misiones`;
    case 'rush_pixels':
      return `+${cur}🪙 en primeros ${40 + cur * 10} px/ciclo`;
    case 'combo_coins':
      return `+${cur}🪙 por combo de cincel`;
    case 'salvage':
      return `+${cur}🪙 al repintar tus píxeles`;
    case 'brush_speed':
      return `−${cur * 40}ms cooldown pintura`;
    case 'minigame_boost':
      return `+${Math.round(cur * 15)}% recompensa arcade`;
    case 'double_paint':
      return `${cur * 2}% doble moneda al pintar`;
    case 'xp_turbo':
      return `+${cur * 5} XP por píxel`;
    case 'territory_yield':
      return `+${cur * 2}🪙 en tu territorio`;
    case 'efficiency':
      return `${cur * 2}% no gastar carga de px`;
    case 'vault':
      return `Idle cap ${60 + cur * 45}min · +${cur * 2}🪙/min`;
    case 'discount':
      return `−${Math.round(cur * 5)}% precio mejoras`;
    case 'streak_boost':
      return `+${cur * 2}🪙 bonus racha login`;
    case 'scout_xp':
      return `+${cur} XP/min idle`;
    case 'arcade_pass':
      return `−${Math.round(cur * 10)}% cooldown arcade`;
    case 'neighbor_bonus':
      return `+${cur}🪙 cerca de arte ajeno`;
    default:
      return def.desc || '';
  }
}

module.exports = {
  upgradeLevel,
  upgradeDef,
  passiveBaseRate,
  passiveRatePerMin,
  maxIdleMinutes,
  coinMultiplier,
  missionRewardMult,
  xpMultiplier,
  comboBonusTaps,
  quotaBonus,
  quotaCooldownMult,
  clicksRequired,
  paintCooldownMs,
  tycoonUpgradePrice,
  minigameRewardMult,
  minigameCooldownMult,
  rollLuckyBonus,
  rollDoublePaint,
  rollFreeQuota,
  rushPixelBonus,
  comboCoinBonus,
  salvageBonus,
  territoryPaintBonus,
  xpPerPixelBonus,
  scoutXpPerMinute,
  describeUpgradeEffect,
};
