/** Colores gratis, básicos de tienda y validación de paleta */

const FREE_COLORS = ['#000000', '#FFFFFF'];

/** Los 5 principales (negro, blanco + RGB) — primeros en la tienda */
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

module.exports = {
  FREE_COLORS,
  CORE_SHOP_COLORS,
  CORE_HEX_SET,
  normalizeHex,
  colorsForUser,
  canUseColor,
  userOwnsColor,
};
