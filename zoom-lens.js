/** Lente de cámara — un producto, múltiples niveles (más nivel = más alejamiento) */
const { leveledShopPrice } = require('./shop-levels');

const ZOOM_LENS_MAX_LEVEL = 10;

/** Escala mínima permitida por nivel (más alto = más cerca, menos alejamiento) */
const ZOOM_MIN_SCALE_BY_LEVEL = [28, 22, 17, 12, 8, 5, 3, 1.8, 0.9, 0.35, 0.08];
const ZOOM_MAX_SCALE_BY_LEVEL = [36, 30, 24, 20, 22, 26, 30, 34, 38, 40, 40];

const ZOOM_LENS_SHOP_ITEM = {
  id: 'zoom_lens',
  category: 'utilidades',
  name: 'Lente de cámara',
  desc: 'Amplía cuánto puedes alejar la vista del mapa. Un solo producto con niveles.',
  hint: 'Nv.0 = encima del píxel (2800%). Sube la lente en Tienda para alejar.',
  kind: 'Mejorable',
  icon: '🔭',
  type: 'leveled',
  upgradeKey: 'zoom_lens',
  maxLevel: ZOOM_LENS_MAX_LEVEL,
  basePrice: 90,
  priceGrowth: 1.4,
  price: 90,
};

function zoomLimitsForLevel(level) {
  const l = Math.min(Math.max(0, Math.floor(level)), ZOOM_LENS_MAX_LEVEL);
  const minScale = ZOOM_MIN_SCALE_BY_LEVEL[l] ?? 0.08;
  const maxScale = ZOOM_MAX_SCALE_BY_LEVEL[l] ?? 40;
  return {
    level: l,
    maxLevel: ZOOM_LENS_MAX_LEVEL,
    minScale: Math.max(0.05, Math.round(minScale * 100) / 100),
    maxScale: Math.min(40, Math.round(maxScale * 100) / 100),
    minZoomPct: Math.round(Math.max(0.05, minScale) * 100),
    maxZoomPct: Math.round(Math.min(40, maxScale) * 100),
  };
}

function zoomLensLevel(user) {
  return user?.shopLevels?.zoom_lens ?? 0;
}

module.exports = {
  ZOOM_LENS_MAX_LEVEL,
  ZOOM_MIN_SCALE_BY_LEVEL,
  ZOOM_MAX_SCALE_BY_LEVEL,
  ZOOM_LENS_SHOP_ITEM,
  zoomLimitsForLevel,
  leveledShopPrice,
  zoomLensLevel,
};
