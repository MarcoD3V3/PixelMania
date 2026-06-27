/** Personalización de perfil estilo Discord — hasta 1000 niveles por categoría */
const MAX_LEVEL = 1000;

const TIER_NAMES = ['', 'Bronce', 'Plata', 'Oro', 'Platino', 'Diamante', 'Maestro', 'Leyenda'];

const SHOP_KEYS = {
  frame: 'perso_marcos',
  badge: 'perso_insignias',
  title: 'perso_titulos',
  aura: 'perso_auras',
  banner: 'perso_banners',
};

const ACTIVE_FIELDS = {
  frame: 'activeFrame',
  badge: 'activeBadge',
  title: 'activeTitle',
  aura: 'activeAura',
  banner: 'activeBanner',
};

function tierForLevel(level) {
  const lv = Math.max(0, Math.trunc(level));
  if (lv <= 0) return 0;
  if (lv <= 50) return 1;
  if (lv <= 150) return 2;
  if (lv <= 300) return 3;
  if (lv <= 500) return 4;
  if (lv <= 750) return 5;
  if (lv <= 900) return 6;
  return 7;
}

function hueForLevel(level) {
  return (Math.trunc(level) * 137.508) % 360;
}

function clampActive(value, max) {
  const v = Math.trunc(Number(value));
  const m = Math.max(0, Math.trunc(max));
  if (m <= 0) return 0;
  if (!Number.isFinite(v) || v <= 0) return m;
  return Math.min(v, m);
}

function frameDef(level) {
  const lv = Math.max(0, Math.trunc(level));
  if (lv <= 0) return { level: 0, tier: 0, name: 'Sin marco', hue: 0, width: 0 };
  const tier = tierForLevel(lv);
  return {
    level: lv,
    tier,
    name: `Marco ${TIER_NAMES[tier]} ${lv}`,
    hue: hueForLevel(lv),
    width: 2 + Math.min(8, Math.floor(lv / 80)),
    gradient: lv >= 8,
    animate: lv >= 45,
    glow: lv >= 150,
    pulse: lv >= 350,
    holo: lv >= 750,
    double: lv >= 250,
  };
}

function badgeDef(level) {
  const lv = Math.max(0, Math.trunc(level));
  if (lv <= 0) return { level: 0, tier: 0, name: 'Sin insignia', icon: '' };
  const tier = tierForLevel(lv);
  const icons = ['', '⭐', '🏅', '🎖', '💎', '👑', '🔥', '✨'];
  return {
    level: lv,
    tier,
    name: `Insignia ${TIER_NAMES[tier]} ${lv}`,
    icon: icons[tier] || '✨',
    shine: lv >= 200,
  };
}

function titleDef(level) {
  const lv = Math.max(0, Math.trunc(level));
  if (lv <= 0) return { level: 0, tier: 0, name: '', text: '' };
  const tier = tierForLevel(lv);
  const prefixes = ['', 'Novato', 'Artista', 'Veterano', 'Élite', 'Campeón', 'Mítico', 'Leyenda'];
  const prefix = prefixes[tier] || 'Pixel';
  return {
    level: lv,
    tier,
    name: `Título nv.${lv}`,
    text: `${prefix} Nv.${lv}`,
    gradient: lv >= 100,
    glow: lv >= 450,
  };
}

function auraDef(level) {
  const lv = Math.max(0, Math.trunc(level));
  if (lv <= 0) return { level: 0, tier: 0, name: 'Sin aura', hue: 0 };
  const tier = tierForLevel(lv);
  return {
    level: lv,
    tier,
    name: `Aura ${TIER_NAMES[tier]} ${lv}`,
    hue: hueForLevel(lv + 40),
    size: 12 + Math.min(40, Math.floor(lv / 25)),
    particles: lv >= 80,
    trail: lv >= 250,
    rainbow: lv >= 600,
  };
}

function bannerDef(level) {
  const lv = Math.max(0, Math.trunc(level));
  if (lv <= 0) return { level: 0, tier: 0, name: 'Sin banner', hue: 0 };
  const tier = tierForLevel(lv);
  return {
    level: lv,
    tier,
    name: `Banner ${TIER_NAMES[tier]} ${lv}`,
    hue: hueForLevel(lv + 90),
    gradient: lv >= 30,
    pattern: lv >= 180,
    shimmer: lv >= 420,
    image: lv >= 700,
  };
}

function previewForKind(kind, level) {
  const lv = Math.max(1, Math.trunc(level));
  switch (kind) {
    case 'frame': {
      const d = frameDef(lv);
      return { name: d.name, desc: `Marco ${TIER_NAMES[d.tier]} con ${d.gradient ? 'degradado' : 'color sólido'}${d.glow ? ' y brillo' : ''}.` };
    }
    case 'badge': {
      const d = badgeDef(lv);
      return { name: d.name, desc: `Insignia ${d.icon} visible en tu tarjeta de píxel.` };
    }
    case 'title': {
      const d = titleDef(lv);
      return { name: d.name, desc: `Título: «${d.text}» bajo tu nombre.` };
    }
    case 'aura': {
      const d = auraDef(lv);
      return { name: d.name, desc: `Aura de cursor (${d.size}px)${d.rainbow ? ' arcoíris' : ''}.` };
    }
    case 'banner': {
      const d = bannerDef(lv);
      return { name: d.name, desc: `Fondo de tarjeta estilo Discord${d.shimmer ? ' con brillo' : ''}.` };
    }
    default:
      return { name: `Nivel ${lv}`, desc: 'Desbloqueo de personalización.' };
  }
}

function ensureProfileStyle(user) {
  if (!user.profileStyle || typeof user.profileStyle !== 'object') user.profileStyle = {};
  return user.profileStyle;
}

function maxUnlocked(user, kind) {
  const key = SHOP_KEYS[kind];
  return user.shopLevels?.[key] || 0;
}

function applyLevel(user, kind, shopKey, level) {
  const ps = ensureProfileStyle(user);
  const field = ACTIVE_FIELDS[kind];
  if (field && (!ps[field] || ps[field] < level)) ps[field] = level;
  const unlockKey = `${shopKey}_lv${level}`;
  if (!user.gadgets.includes(unlockKey)) user.gadgets.push(unlockKey);
}

function resolveCosmetics(user) {
  if (!user) return null;
  const ps = ensureProfileStyle(user);
  const frameLv = clampActive(ps.activeFrame, maxUnlocked(user, 'frame'));
  const badgeLv = clampActive(ps.activeBadge, maxUnlocked(user, 'badge'));
  const titleLv = clampActive(ps.activeTitle, maxUnlocked(user, 'title'));
  const auraLv = clampActive(ps.activeAura, maxUnlocked(user, 'aura'));
  const bannerLv = clampActive(ps.activeBanner, maxUnlocked(user, 'banner'));

  const title = titleDef(titleLv);
  const statusUnlocked = titleLv >= 15;
  const nameColorUnlocked = titleLv >= 60;

  return {
    frame: frameDef(frameLv),
    badge: badgeDef(badgeLv),
    title,
    aura: auraDef(auraLv),
    banner: bannerDef(bannerLv),
    statusText: statusUnlocked ? String(ps.statusText || '').slice(0, 80) : '',
    nameColor: nameColorUnlocked && /^#[0-9A-F]{6}$/i.test(ps.nameColor || '')
      ? String(ps.nameColor).toUpperCase()
      : null,
    unlocked: {
      frame: maxUnlocked(user, 'frame'),
      badge: maxUnlocked(user, 'badge'),
      title: maxUnlocked(user, 'title'),
      aura: maxUnlocked(user, 'aura'),
      banner: maxUnlocked(user, 'banner'),
    },
    caps: { statusUnlocked, nameColorUnlocked, maxLevel: MAX_LEVEL },
  };
}

function compactSnapshot(user) {
  const c = resolveCosmetics(user);
  if (!c) return null;
  if (!c.frame.level && !c.badge.level && !c.title.level && !c.aura.level && !c.banner.level) {
    return null;
  }
  const out = {
    f: c.frame.level || undefined,
    b: c.badge.level || undefined,
    t: c.title.level || undefined,
    a: c.aura.level || undefined,
    bn: c.banner.level || undefined,
  };
  if (c.statusText) out.st = c.statusText;
  if (c.nameColor) out.nc = c.nameColor;
  if (c.title.text) out.tt = c.title.text;
  return out;
}

function expandSnapshot(pr) {
  if (!pr || typeof pr !== 'object') return null;
  const frame = frameDef(pr.f || 0);
  const badge = badgeDef(pr.b || 0);
  const title = titleDef(pr.t || 0);
  if (pr.tt) title.text = String(pr.tt).slice(0, 64);
  return {
    frame,
    badge,
    title,
    aura: auraDef(pr.a || 0),
    banner: bannerDef(pr.bn || 0),
    statusText: pr.st ? String(pr.st).slice(0, 80) : '',
    nameColor: pr.nc ? String(pr.nc).toUpperCase() : null,
  };
}

function sanitizeStyleUpdate(user, body) {
  const ps = ensureProfileStyle(user);
  const unlocked = {
    frame: maxUnlocked(user, 'frame'),
    badge: maxUnlocked(user, 'badge'),
    title: maxUnlocked(user, 'title'),
    aura: maxUnlocked(user, 'aura'),
    banner: maxUnlocked(user, 'banner'),
  };

  if (body.activeFrame != null) {
    ps.activeFrame = clampActive(body.activeFrame, unlocked.frame);
  }
  if (body.activeBadge != null) {
    ps.activeBadge = clampActive(body.activeBadge, unlocked.badge);
  }
  if (body.activeTitle != null) {
    ps.activeTitle = clampActive(body.activeTitle, unlocked.title);
  }
  if (body.activeAura != null) {
    ps.activeAura = clampActive(body.activeAura, unlocked.aura);
  }
  if (body.activeBanner != null) {
    ps.activeBanner = clampActive(body.activeBanner, unlocked.banner);
  }
  if (body.statusText != null && unlocked.title >= 15) {
    ps.statusText = String(body.statusText).slice(0, 80);
  }
  if (body.nameColor != null && unlocked.title >= 60) {
    const hex = String(body.nameColor).trim().toUpperCase();
    ps.nameColor = /^#[0-9A-F]{6}$/.test(hex) ? hex : ps.nameColor;
  }
  return ps;
}

function syncLegacyProfile(user) {
  const ps = ensureProfileStyle(user);
  for (const kind of Object.keys(SHOP_KEYS)) {
    const key = SHOP_KEYS[kind];
    const max = user.shopLevels?.[key] || 0;
    const field = ACTIVE_FIELDS[kind];
    if (max > 0 && (!ps[field] || ps[field] > max)) ps[field] = max;
  }
}

module.exports = {
  MAX_LEVEL,
  TIER_NAMES,
  SHOP_KEYS,
  tierForLevel,
  previewForKind,
  applyLevel,
  resolveCosmetics,
  compactSnapshot,
  expandSnapshot,
  sanitizeStyleUpdate,
  syncLegacyProfile,
  frameDef,
  badgeDef,
  titleDef,
  auraDef,
  bannerDef,
};
