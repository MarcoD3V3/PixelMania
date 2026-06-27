/** Productos mejorables por niveles — precio y recompensas */
const profileCosmetics = require('./profile-cosmetics');
const quotaRecharge = require('./quota-recharge');

function leveledMaxLevel(item) {
  if (item.procedural === 'recharge') return Infinity;
  if (item.maxLevel != null) return item.maxLevel;
  if (item.levels?.length) return item.levels.length;
  return item.procedural ? profileCosmetics.MAX_LEVEL : 10;
}

function leveledShopPrice(item, currentLevel) {
  if (item.procedural === 'recharge' || item.upgradeKey === quotaRecharge.SHOP_KEY) {
    return quotaRecharge.priceForLevel(currentLevel);
  }
  const tier = item.levels?.[currentLevel];
  if (tier?.price != null) return tier.price;
  const base = item.basePrice ?? item.price ?? 100;
  const growth = item.priceGrowth ?? 1.35;
  const lv = Math.max(0, Math.trunc(currentLevel));
  if (item.procedural || (item.maxLevel != null && item.maxLevel >= 100)) {
    const tierBoost = 1 + Math.floor(lv / 100) * 0.35;
    const milestone = lv > 0 && lv % 100 === 0 ? 1.65 : 1;
    return Math.max(1, Math.floor(base * (growth ** lv) * tierBoost * milestone));
  }
  return Math.floor(base * growth ** lv);
}

function applyLeveledReward(user, item, newLevel) {
  if (item.procedural === 'recharge') return;
  if (item.procedural) {
    profileCosmetics.applyLevel(user, item.procedural, item.upgradeKey || item.id, newLevel);
    return;
  }
  const reward = item.levels?.[newLevel - 1];
  if (!reward) return;

  if (reward.unlockKey) {
    if (!user.gadgets.includes(reward.unlockKey)) user.gadgets.push(reward.unlockKey);
  }
  if (reward.gadget) {
    if (!user.gadgets.includes(reward.gadget)) user.gadgets.push(reward.gadget);
  }
  if (reward.hex) {
    if (!user.unlockedColors) user.unlockedColors = [];
    const hex = String(reward.hex).toUpperCase();
    if (!user.unlockedColors.includes(hex)) user.unlockedColors.push(hex);
  }
  if (reward.colors?.length) {
    if (!user.unlockedColors) user.unlockedColors = [];
    for (const c of reward.colors) {
      const hex = String(c).toUpperCase();
      if (!user.unlockedColors.includes(hex)) user.unlockedColors.push(hex);
    }
  }
  if (reward.item) {
    user.inventory[reward.item] = (user.inventory[reward.item] || 0) + (reward.amount || 1);
  }
  if (reward.territory) {
    user.territoryPixels = (user.territoryPixels || 0) + reward.territory;
  }
}

function makeLeveled(opts) {
  const key = opts.upgradeKey || opts.id;
  const levels = opts.levels.map((lv, i) => ({
    ...lv,
    unlockKey: lv.unlockKey || `${key}_lv${i + 1}`,
  }));
  return {
    id: opts.id,
    category: opts.category,
    name: opts.name,
    desc: opts.desc,
    hint: opts.hint || 'Un solo producto: cada compra sube al siguiente nivel.',
    kind: 'Mejorable',
    icon: opts.icon,
    type: 'leveled',
    upgradeKey: key,
    maxLevel: levels.length,
    levels,
    basePrice: opts.basePrice ?? 48,
    priceGrowth: opts.priceGrowth ?? 1.28,
    price: opts.basePrice ?? 48,
  };
}

module.exports = {
  leveledMaxLevel,
  leveledShopPrice,
  applyLeveledReward,
  makeLeveled,
};
