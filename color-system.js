/** Colores gratis, básicos de tienda y validación de paleta */

const FREE_COLORS = ['#000000', '#FFFFFF'];

/** Primer color premium tras negro/blanco gratis. */
const COLOR_UNLOCK_START = 32;
/** Tope de seguridad (progresión lineal suave, no debería acercarse en la práctica). */
const COLOR_UNLOCK_MAX_PRICE = 1_000_000_000;

/** Precio del desbloqueo n-ésimo (n=0 → 32, n=1 → 36, n=2 → 39, n=3 → 42, …). */
function colorUnlockPriceAt(unlockIndex) {
  const n = Math.max(0, Math.trunc(unlockIndex));
  if (n === 0) return COLOR_UNLOCK_START;
  let price = COLOR_UNLOCK_START;
  for (let i = 0; i < n; i++) {
    price += (i % 3 === 0) ? 4 : 3;
  }
  return Math.min(COLOR_UNLOCK_MAX_PRICE, price);
}

const CORE_SHOP_COLORS = [
  {
    id: 'color_negro',
    name: 'Negro puro',
    desc: 'Negro absoluto para contornos y sombras.',
    hex: '#000000',
    price: 12,
  },
  {
    id: 'color_blanco',
    name: 'Blanco puro',
    desc: 'Blanco limpio para luces y detalles.',
    hex: '#FFFFFF',
    price: 12,
  },
  {
    id: 'color_rojo',
    name: 'Rojo primario',
    desc: 'Rojo intenso — uno de los tres colores base.',
    hex: '#FF0000',
    price: 20,
  },
  {
    id: 'color_verde',
    name: 'Verde primario',
    desc: 'Verde brillante — color base RGB.',
    hex: '#00CC44',
    price: 20,
  },
  {
    id: 'color_azul',
    name: 'Azul primario',
    desc: 'Azul eléctrico — color base RGB.',
    hex: '#0066FF',
    price: 20,
  },
];

const CORE_HEX_SET = new Set(CORE_SHOP_COLORS.map((c) => normalizeHex(c.hex)));

function normalizeHex(hex) {
  const h = String(hex || '').trim().toUpperCase();
  if (/^#[0-9A-F]{6}$/.test(h)) return h;
  return '';
}

function colorsForUser(user) {
  const set = new Set(FREE_COLORS.map(normalizeHex));
  for (const c of user?.unlockedColors || []) {
    const h = normalizeHex(c);
    if (h) set.add(h);
  }
  return [...set];
}

function canUseColor(user, hex) {
  const h = normalizeHex(hex);
  if (!h) return false;
  return colorsForUser(user).includes(h);
}

function userOwnsColor(user, hex) {
  return canUseColor(user, hex);
}

/** Colores premium ya comprados (sin contar negro/blanco gratis). */
function premiumUnlockCount(user) {
  return (user?.unlockedColors || []).filter((c) => normalizeHex(c)).length;
}

/** Precio del próximo desbloqueo según cuántos premium ya tiene el usuario. */
function colorUnlockPrice(user) {
  return colorUnlockPriceAt(premiumUnlockCount(user));
}

function unlockColorForUser(user, hex) {
  const h = normalizeHex(hex);
  if (!h) return { ok: false, error: 'Color inválido' };
  if (canUseColor(user, h)) return { ok: false, error: 'Ya tienes este color' };
  const price = colorUnlockPrice(user);
  if ((user?.coins ?? 0) < price) {
    return { ok: false, error: `Monedas insuficientes (tienes ${user.coins}, necesitas ${price.toLocaleString()})`, price };
  }
  if (!user.unlockedColors) user.unlockedColors = [];
  user.unlockedColors.push(h);
  user.coins -= price;
  return { ok: true, price, hex: h };
}

module.exports = {
  FREE_COLORS,
  CORE_SHOP_COLORS,
  CORE_HEX_SET,
  COLOR_UNLOCK_START,
  COLOR_UNLOCK_MAX_PRICE,
  normalizeHex,
  colorsForUser,
  canUseColor,
  userOwnsColor,
  premiumUnlockCount,
  colorUnlockPriceAt,
  colorUnlockPrice,
  unlockColorForUser,
};
