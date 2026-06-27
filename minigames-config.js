/** Minijuegos, zonas del mapa y arenas en vivo */
const REFLEX_GAME = {
  id: 'reflex',
  name: 'Reflejos pixel',
  desc: 'Clic en objetivos antes de que desaparezcan. 15 s.',
  icon: '🎯',
  durationMs: 15_000,
  cooldownMs: 5 * 60 * 1000,
  baseCoinPerHit: 3,
  maxScore: 55,
  minElapsedMs: 12_000,
  maxElapsedMs: 22_000,
  scoreKey: 'hits',
};

const PIANO_GAME = {
  id: 'piano',
  name: 'Piano Tiles',
  desc: 'Teclas D F J K · acierta las baldosas blancas al ritmo.',
  icon: '🎹',
  durationMs: 28_000,
  cooldownMs: 4 * 60 * 1000,
  baseCoinPerHit: 4,
  maxScore: 80,
  minElapsedMs: 22_000,
  maxElapsedMs: 35_000,
  scoreKey: 'hits',
};

const RHYTHM_GAME = {
  id: 'rhythm',
  name: 'Ritmo Pixel',
  desc: 'Espacio en el beat · círculo al compás.',
  icon: '🥁',
  durationMs: 25_000,
  cooldownMs: 4 * 60 * 1000,
  baseCoinPerHit: 5,
  maxScore: 45,
  minElapsedMs: 20_000,
  maxElapsedMs: 32_000,
  scoreKey: 'hits',
};

const BULLET_GAME = {
  id: 'bullet',
  name: 'Esquiva CORE',
  desc: 'Estilo bullet-hell · mueve el corazón y sobrevive.',
  icon: '💛',
  durationMs: 22_000,
  cooldownMs: 5 * 60 * 1000,
  baseCoinPerHit: 6,
  maxScore: 120,
  minElapsedMs: 18_000,
  maxElapsedMs: 28_000,
  scoreKey: 'score',
};

const FLAPPY_GAME = {
  id: 'flappy',
  name: 'Flappy Pixel',
  desc: 'Espacio para volar · esquiva los tubos verdes.',
  icon: '🐦',
  durationMs: 30_000,
  cooldownMs: 4 * 60 * 1000,
  baseCoinPerHit: 5,
  maxScore: 60,
  minElapsedMs: 24_000,
  maxElapsedMs: 38_000,
  scoreKey: 'score',
};

const SNAKE_GAME = {
  id: 'snake',
  name: 'Serpiente Retro',
  desc: 'Flechas · come cuadrados sin chocar.',
  icon: '🐍',
  durationMs: 35_000,
  cooldownMs: 4 * 60 * 1000,
  baseCoinPerHit: 4,
  maxScore: 90,
  minElapsedMs: 28_000,
  maxElapsedMs: 42_000,
  scoreKey: 'score',
};

const BREAKOUT_GAME = {
  id: 'breakout',
  name: 'Breakout Pixel',
  desc: 'Flechas mueven la pala · rompe ladrillos.',
  icon: '🧱',
  durationMs: 32_000,
  cooldownMs: 4 * 60 * 1000,
  baseCoinPerHit: 3,
  maxScore: 100,
  minElapsedMs: 26_000,
  maxElapsedMs: 40_000,
  scoreKey: 'score',
};

const ARCADE_GAMES = {
  reflex: REFLEX_GAME,
  piano: PIANO_GAME,
  rhythm: RHYTHM_GAME,
  bullet: BULLET_GAME,
  flappy: FLAPPY_GAME,
  snake: SNAKE_GAME,
  breakout: BREAKOUT_GAME,
};

const PAINT_ZONES = [
  {
    id: 'golden_plaza',
    name: 'Plaza Dorada',
    x: 80,
    y: -80,
    w: 32,
    h: 32,
    paintCoinMult: 2,
    color: '#ffbe0b',
    game: 'reflex',
  },
  {
    id: 'arcade_ne',
    name: 'Piano District NE',
    x: 200,
    y: -160,
    w: 28,
    h: 28,
    paintCoinMult: 1.5,
    color: '#7c3aed',
    game: 'piano',
  },
  {
    id: 'arcade_sw',
    name: 'Ritmo Arcade SW',
    x: -140,
    y: 120,
    w: 28,
    h: 28,
    paintCoinMult: 1.5,
    color: '#06ffa5',
    game: 'rhythm',
  },
  {
    id: 'core_arena',
    name: 'Arena CORE',
    x: -200,
    y: -120,
    w: 30,
    h: 30,
    paintCoinMult: 1.6,
    color: '#ff006e',
    game: 'bullet',
  },
  {
    id: 'live_hub',
    name: 'Hub Arcade Central',
    x: 0,
    y: 0,
    w: 24,
    h: 24,
    paintCoinMult: 1.4,
    color: '#fb5607',
    game: null,
  },
  {
    id: 'flappy_nest',
    name: 'Nido Flappy',
    x: 120,
    y: 100,
    w: 26,
    h: 26,
    paintCoinMult: 1.5,
    color: '#38b000',
    game: 'flappy',
  },
  {
    id: 'snake_pit',
    name: 'Foso Serpiente',
    x: -180,
    y: 40,
    w: 26,
    h: 26,
    paintCoinMult: 1.5,
    color: '#70e000',
    game: 'snake',
  },
  {
    id: 'breakout_w',
    name: 'Muro Breakout',
    x: 160,
    y: 80,
    w: 28,
    h: 28,
    paintCoinMult: 1.55,
    color: '#3a86ff',
    game: 'breakout',
  },
];

function inRect(x, y, rect) {
  return x >= rect.x && x < rect.x + rect.w && y >= rect.y && y < rect.y + rect.h;
}

function paintZoneMult(x, y) {
  let mult = 1;
  for (const z of PAINT_ZONES) {
    if (inRect(x, y, z)) mult = Math.max(mult, z.paintCoinMult);
  }
  return mult;
}

function findZoneAt(x, y) {
  return PAINT_ZONES.find((z) => inRect(x, y, z)) || null;
}

function findGameArenaAt(x, y) {
  const z = findZoneAt(x, y);
  if (!z?.game || !ARCADE_GAMES[z.game]) return null;
  return { zone: z, game: ARCADE_GAMES[z.game] };
}

function getGame(id) {
  return ARCADE_GAMES[id] || null;
}

function listGames() {
  return Object.values(ARCADE_GAMES);
}

module.exports = {
  REFLEX_GAME,
  ARCADE_GAMES,
  PIANO_GAME,
  RHYTHM_GAME,
  BULLET_GAME,
  FLAPPY_GAME,
  SNAKE_GAME,
  BREAKOUT_GAME,
  PAINT_ZONES,
  inRect,
  paintZoneMult,
  findZoneAt,
  findGameArenaAt,
  getGame,
  listGames,
};
