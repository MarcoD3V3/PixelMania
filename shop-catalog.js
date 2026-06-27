/** Catálogo de tienda — 300+ productos únicos curados */
const { ZOOM_LENS_SHOP_ITEM } = require('./zoom-lens');
const { makeLeveled } = require('./shop-levels');
const colorSystem = require('./color-system');
const D = require('./shop-items-data');

function hslToHex(h, s, l) {
  s /= 100;
  l /= 100;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => {
    const k = (n + h / 30) % 12;
    const col = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return Math.round(255 * col).toString(16).padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`.toUpperCase();
}

const CORE_SHOP = [
  {
    id: 'brush_corrido',
    category: 'dibujo',
    name: 'Pincel corrido',
    desc: 'Desbloquea pintar arrastrando el click.',
    hint: 'Sin esto solo puedes colocar 1 píxel por click.',
    kind: 'Permanente',
    icon: '🖌',
    price: 450,
    type: 'gadget',
    gadget: 'brush_corrido',
  },
  {
    id: 'paint_boost',
    category: 'dibujo',
    name: 'Boost de pintura',
    desc: '+300 píxeles en tu próxima recarga (10 min).',
    hint: 'Se aplica automáticamente en la siguiente barra de píxeles.',
    kind: 'Consumible',
    icon: '⚡',
    price: 180,
    type: 'item',
    item: 'paint_boost',
    amount: 300,
  },
  {
    id: 'territory_500',
    category: 'territorio',
    name: 'Paquete territorial 500',
    desc: '500 píxeles de claim para marcar una zona.',
    hint: 'Ideal para tu primera expansión en el mapa.',
    kind: 'Paquete',
    icon: '🏰',
    price: 200,
    type: 'territory',
    amount: 500,
  },
  {
    id: 'territory_2000',
    category: 'territorio',
    name: 'Paquete territorial 2000',
    desc: '2000 píxeles de claim para zonas grandes.',
    hint: 'Para jugadores que dominan mucho espacio.',
    kind: 'Paquete',
    icon: '🏯',
    price: 700,
    type: 'territory',
    amount: 2000,
  },
  {
    id: 'siege_token',
    category: 'combate',
    name: 'Token de asedio',
    desc: '1 asedio sin pagar las 75🪙 de coste.',
    hint: 'Se guarda en inventario hasta que lo uses al asediar.',
    kind: 'Consumible',
    icon: '⚔',
    price: 120,
    type: 'item',
    item: 'siege_token',
    amount: 1,
  },
  {
    id: 'gadget_heatmap',
    category: 'utilidades',
    name: 'Heatmap minimapa',
    desc: 'Resalta zonas activas en el minimapa.',
    hint: 'Permanente: compra una vez y queda en tu cuenta.',
    kind: 'Permanente',
    icon: '🔥',
    price: 150,
    type: 'gadget',
    gadget: 'heatmap',
  },
];

const SHOP_CATEGORIES_EXTRA = [
  {
    id: 'skins',
    name: 'Skins y temas',
    icon: '👾',
    tip: 'Aspecto del lienzo, cursor y UI. Cada skin es permanente.',
  },
  {
    id: 'personalizacion',
    name: 'Personalización',
    icon: '✨',
    tip: 'Marcos de avatar, badges, títulos y auras para tu perfil en el mapa.',
  },
  {
    id: 'pinceles',
    name: 'Pinceles y tamaños',
    icon: '🖌',
    tip: 'Pinceles especiales y tamaños de píxel (2×2, 3×3…) para pintar distinto.',
  },
  {
    id: 'colores',
    name: 'Colores exclusivos',
    icon: '🌈',
    tip: 'Negro, blanco y RGB al inicio; cientos de tonos premium por compra.',
  },
  {
    id: 'decoracion',
    name: 'Banners y publicidad',
    icon: '📢',
    tip: 'Banners, slots de publicidad y cubos de fondo de un solo uso.',
  },
];

function buildGeneratedItems() {
  const items = [];

  for (const s of D.SKINS) {
    items.push({
      id: s.id,
      category: 'skins',
      name: s.name,
      desc: s.desc,
      hint: s.hint,
      kind: 'Permanente',
      icon: s.icon,
      price: s.price,
      type: 'unlock',
      unlockKey: s.id,
    });
  }

  items.push(makeLeveled({
    id: 'perso_marcos',
    category: 'personalizacion',
    name: 'Marcos de avatar',
    desc: 'Un solo producto: desbloquea marcos progresivos para tu chip.',
    hint: 'Cada compra sube de nivel y desbloquea el siguiente marco.',
    icon: '🖼',
    basePrice: 48,
    priceGrowth: 1.22,
    levels: D.FRAMES.map((f) => ({ name: f.name, desc: f.desc, price: f.price })),
  }));

  items.push(makeLeveled({
    id: 'perso_insignias',
    category: 'personalizacion',
    name: 'Insignias de perfil',
    desc: 'Colección de badges que se desbloquean nivel a nivel.',
    hint: 'Visible en tu tarjeta de píxel al subir cada nivel.',
    icon: '🏅',
    basePrice: 42,
    priceGrowth: 1.24,
    levels: D.BADGES.map((b) => ({ name: b.name, desc: b.desc, price: b.price })),
  }));

  items.push(makeLeveled({
    id: 'perso_titulos',
    category: 'personalizacion',
    name: 'Títulos de perfil',
    desc: 'Un título bajo tu nombre — compra repetida = siguiente título.',
    hint: 'Como la lente: un producto, muchos niveles.',
    icon: '📛',
    basePrice: 72,
    priceGrowth: 1.26,
    levels: D.TITLES.map((t) => ({ name: t.name, desc: t.desc, price: t.price })),
  }));

  items.push(makeLeveled({
    id: 'perso_auras',
    category: 'personalizacion',
    name: 'Auras de cursor',
    desc: 'Efectos brillantes alrededor de tu cursor, nivel a nivel.',
    hint: 'Cada nivel desbloquea una aura distinta.',
    icon: '💫',
    basePrice: 88,
    priceGrowth: 1.28,
    levels: D.AURAS.map((a) => ({ name: a.name, desc: a.desc, price: a.price })),
  }));

  items.push(makeLeveled({
    id: 'pincel_coleccion',
    category: 'pinceles',
    name: 'Colección de pinceles',
    desc: 'Desbloquea pinceles especiales uno por compra.',
    hint: 'Spray, estrella, caligráfico… cada nivel es un pincel nuevo.',
    icon: '🖌',
    basePrice: 86,
    priceGrowth: 1.3,
    levels: D.BRUSHES.map((b) => ({
      name: b.name,
      desc: b.desc,
      price: b.price,
      unlockKey: b.name.toLowerCase().replace(/\s+/g, '_'),
    })),
  }));

  items.push(makeLeveled({
    id: 'pixel_bloques',
    category: 'pinceles',
    name: 'Tamaño de bloque',
    desc: 'Pinta bloques más grandes — un nivel por tamaño desbloqueado.',
    hint: '2×2, 3×3, 8×8… consume más cuota por golpe.',
    icon: '▣',
    basePrice: 140,
    priceGrowth: 1.32,
    levels: D.PIXEL_BLOCKS.map((b) => ({
      name: `${b.name} (${b.size}×${b.size})`,
      desc: b.desc,
      price: b.price,
    })),
  }));

  const usedColorHex = new Set(
    [...colorSystem.FREE_COLORS, ...colorSystem.CORE_SHOP_COLORS.map((c) => c.hex)]
      .map((h) => h.toUpperCase()),
  );

  for (const c of colorSystem.CORE_SHOP_COLORS) {
    items.push({
      id: c.id,
      category: 'colores',
      name: c.name,
      desc: c.desc,
      hint: `Desbloquea ${c.hex} en tu paleta para siempre.`,
      kind: 'Permanente',
      icon: '🎨',
      colorSwatch: c.hex,
      price: c.price,
      type: 'color',
      hex: c.hex,
    });
  }

  D.COLOR_NAMES.forEach(([name, desc], i) => {
    const hue = Math.floor((i * 137.508 + 17) % 360);
    const sat = 48 + (i % 28);
    const light = 34 + (i % 22);
    const hex = hslToHex(hue, sat, light);
    if (usedColorHex.has(hex)) return;
    usedColorHex.add(hex);
    items.push({
      id: `color_${i + 1}`,
      category: 'colores',
      name,
      desc,
      hint: `Desbloquea ${hex} en tu paleta para siempre.`,
      kind: 'Permanente',
      icon: '🎨',
      colorSwatch: hex,
      price: 18 + Math.floor((i % 12) * 4 + (i % 7) * 3),
      type: 'color',
      hex,
    });
  });

  items.push(makeLeveled({
    id: 'paletas_coleccion',
    category: 'colores',
    name: 'Colección de paletas',
    desc: 'Desbloquea packs de 8 colores coordinados, uno por nivel.',
    hint: 'Atardecer, Ártico, Neón Tokyo… cada compra = nueva paleta.',
    icon: '🌈',
    basePrice: 138,
    priceGrowth: 1.2,
    levels: D.PALETTES.map((p, i) => ({
      name: p.name,
      desc: p.desc,
      price: p.price,
      colors: Array.from({ length: 8 }, (_, k) => hslToHex((i * 37 + k * 47) % 360, 58, 44 + (k % 12))),
    })),
  }));

  for (const t of D.TERRITORY_PACKS) {
    items.push({
      id: t.id,
      category: 'territorio',
      name: t.name,
      desc: t.desc,
      hint: `${t.amount} píxeles de claim para territorio.`,
      kind: 'Paquete',
      icon: t.icon,
      price: t.price,
      type: 'territory',
      amount: t.amount,
    });
  }

  for (const c of D.COMBAT_ITEMS) {
    items.push({
      id: c.id,
      category: 'combate',
      name: c.name,
      desc: c.desc,
      hint: c.item ? 'Consumible · se guarda en inventario.' : 'Permanente en combate.',
      kind: c.item ? 'Consumible' : 'Permanente',
      icon: c.icon,
      price: c.price,
      type: c.item ? 'item' : 'unlock',
      ...(c.item ? { item: c.item, amount: c.amount || 1 } : { unlockKey: c.id }),
    });
  }

  for (const d of D.DIBUJO_ITEMS) {
    items.push({
      id: d.id,
      category: 'dibujo',
      name: d.name,
      desc: d.desc,
      hint: d.item ? 'Consumible · un solo uso.' : 'Permanente · herramienta de pintura.',
      kind: d.item ? 'Consumible' : 'Permanente',
      icon: d.icon,
      price: d.price,
      type: d.item ? 'item' : 'unlock',
      ...(d.item ? { item: d.item, amount: d.amount || 1 } : { unlockKey: d.id }),
    });
  }

  for (const u of D.UTILITIES) {
    items.push({
      id: u.id,
      category: 'utilidades',
      name: u.name,
      desc: u.desc,
      hint: 'Permanente · mejora tu experiencia en el mapa.',
      kind: 'Permanente',
      icon: u.icon,
      price: u.price,
      type: 'gadget',
      gadget: u.gadget,
    });
  }

  const bannersBySize = {};
  D.BANNERS.forEach((b, i) => {
    if (!bannersBySize[b.size]) bannersBySize[b.size] = [];
    bannersBySize[b.size].push({ ...b, idx: i + 1 });
  });
  for (const [size, list] of Object.entries(bannersBySize)) {
    items.push(makeLeveled({
      id: `banner_pack_${size}`,
      category: 'decoracion',
      name: `Banners ${size}px`,
      desc: `Variantes de bandera de ${size}px — un nivel por modelo.`,
      hint: 'Consumible por nivel · visible 24 h en el mapa.',
      icon: '🚩',
      basePrice: list[0].price,
      priceGrowth: 1.15,
      levels: list.map((b) => ({
        name: b.name,
        desc: b.desc,
        price: b.price,
        item: `banner_${size}_${b.idx}`,
        amount: 1,
      })),
    }));
  }

  for (const a of D.AD_SLOTS) {
    items.push(makeLeveled({
      id: `ad_slot_${a.w}`,
      category: 'decoracion',
      name: `Publicidad ${a.w}×${a.w}`,
      desc: a.desc,
      hint: 'Slot promocional — cada nivel reserva una variante.',
      icon: '📢',
      basePrice: a.price,
      priceGrowth: 1.12,
      levels: [1, 2, 3].map((v) => ({
        name: `${a.name} · variante ${v}`,
        desc: `${a.w}×${a.w} px · 48 h de visibilidad.`,
        price: a.price + v * 15,
        item: `ad_slot_${a.w}_v${v}`,
        amount: 1,
      })),
    }));
  }

  D.BG_CUBES.forEach((cube, ci) => {
    cube.sizes.forEach((sz) => {
      items.push({
        id: `bg_cube_${ci}_${sz}`,
        category: 'decoracion',
        name: `Cubo ${cube.color} ${sz}×${sz}`,
        desc: `Rellena ${sz}×${sz} px con tono ${cube.color.toLowerCase()}.`,
        hint: 'Consumible · ideal para bases rápidas.',
        kind: 'Consumible',
        icon: '🧊',
        colorSwatch: cube.hex,
        price: 35 + sz + ci * 3,
        type: 'item',
        item: `bg_cube_${ci}_${sz}`,
        amount: 1,
      });
    });
  });

  return items;
}

function buildShopCatalog() {
  return [...CORE_SHOP, ZOOM_LENS_SHOP_ITEM, ...buildGeneratedItems()];
}

const SHOP = buildShopCatalog();

module.exports = {
  CORE_SHOP,
  SHOP_CATEGORIES_EXTRA,
  SHOP,
  buildShopCatalog,
};
