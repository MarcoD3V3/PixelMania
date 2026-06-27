/** Herramientas de pintura — sellos, pinceles, patrones (cliente + servidor) */

const { BRUSHES, PIXEL_BLOCKS, DIBUJO_ITEMS } = require('./shop-items-data');

const BRUSH_COLLECTION_KEY = 'pincel_coleccion';
const BLOCK_COLLECTION_KEY = 'pixel_bloques';

const PAINT_TOOL_IDS = new Set(
  DIBUJO_ITEMS.filter((d) => !d.item).map((d) => d.id),
);

const STAMP_BITMAP = {
  stamp_heart: [
    '..#..',
    '.#.#.',
    '#...#',
    '.###.',
    '..#..',
  ],
  stamp_star: [
    '..#..',
    '.###.',
    '#####',
    '..#..',
    '.#.#.',
  ],
  stamp_skull: [
    '.###.',
    '#.#.#',
    '.###.',
    '.#.#.',
    '..#..',
  ],
  stamp_arrow: [
    '..#..',
    '.###.',
    '#####',
    '..#..',
    '..#..',
  ],
  stamp_smiley: [
    '.###.',
    '#...#',
    '#.#.#',
    '#...#',
    '.###.',
  ],
  pattern_checker: [
    '#.#.#.#.',
    '.#.#.#.#',
    '#.#.#.#.',
    '.#.#.#.#',
  ],
  pattern_dots: [
    '#...#',
    '.....',
    '..#..',
    '.....',
    '#...#',
  ],
  pattern_stripes: [
    '#####',
    '.....',
    '#####',
    '.....',
    '#####',
  ],
};

function brushUnlockKey(name) {
  return String(name).toLowerCase().replace(/\s+/g, '_');
}

function bitmapToCells(bitmap, cx, cy) {
  const h = bitmap.length;
  const w = bitmap[0].length;
  const ox = cx - Math.floor(w / 2);
  const oy = cy - Math.floor(h / 2);
  const cells = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (bitmap[y][x] === '#') cells.push([ox + x, oy + y]);
    }
  }
  return cells;
}

function uniqueCells(cells) {
  const seen = new Set();
  const out = [];
  for (const [x, y] of cells) {
    const k = `${x},${y}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push([x, y]);
  }
  return out;
}

function squareCells(cx, cy, size) {
  const half = Math.floor(size / 2);
  const cells = [];
  for (let dy = 0; dy < size; dy++) {
    for (let dx = 0; dx < size; dx++) {
      cells.push([cx - half + dx, cy - half + dy]);
    }
  }
  return cells;
}

function starCells(cx, cy, radius) {
  const cells = [[cx, cy]];
  for (let i = -radius; i <= radius; i++) {
    cells.push([cx + i, cy - radius], [cx + i, cy + radius], [cx - radius, cy + i], [cx + radius, cy + i]);
  }
  return uniqueCells(cells);
}

function circleCells(cx, cy, radius) {
  const cells = [];
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      if (dx * dx + dy * dy <= radius * radius + 0.5) cells.push([cx + dx, cy + dy]);
    }
  }
  return cells;
}

function sprayCells(cx, cy, radius, seed) {
  const cells = [[cx, cy]];
  let s = seed || ((cx * 73856093) ^ (cy * 19349663)) >>> 0;
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      if (dx === 0 && dy === 0) continue;
      s = (s * 1664525 + 1013904223) >>> 0;
      if ((s % 100) < 55) cells.push([cx + dx, cy + dy]);
    }
  }
  return uniqueCells(cells);
}

function diamondCells(cx, cy, radius) {
  const cells = [];
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      if (Math.abs(dx) + Math.abs(dy) <= radius) cells.push([cx + dx, cy + dy]);
    }
  }
  return cells;
}

function crossCells(cx, cy, radius) {
  const cells = [[cx, cy]];
  for (let i = 1; i <= radius; i++) {
    cells.push([cx + i, cy], [cx - i, cy], [cx, cy + i], [cx, cy - i]);
  }
  return uniqueCells(cells);
}

function applyMirror(cells, cx, cy, axis) {
  const mirrored = [];
  for (const [x, y] of cells) {
    if (axis === 'h' || axis === 'both') mirrored.push([x, 2 * cy - y]);
    if (axis === 'v' || axis === 'both') mirrored.push([2 * cx - x, y]);
  }
  return uniqueCells([...cells, ...mirrored]);
}

function cellsForTool(toolKey, cx, cy, blockSize) {
  const size = Math.max(1, blockSize || 1);
  if (size > 1) {
    return uniqueCells(squareCells(cx, cy, size));
  }

  if (!toolKey || toolKey === 'grid_snap') return [[cx, cy]];

  if (STAMP_BITMAP[toolKey]) {
    return bitmapToCells(STAMP_BITMAP[toolKey], cx, cy);
  }

  switch (toolKey) {
    case 'spray_urbano':
      return sprayCells(cx, cy, 1);
    case 'estrella_fugaz':
      return starCells(cx, cy, 2);
    case 'sello_cuadrado':
      return squareCells(cx, cy, 3);
    case 'discóbolo':
      return circleCells(cx, cy, 2);
    case 'panal_hex':
    case 'diamante_facetado':
      return diamondCells(cx, cy, 2);
    case 'punteado_seurat':
      return sprayCells(cx, cy, 2, cx * 17 + cy);
    case 'corte_laser':
      return crossCells(cx, cy, 3);
    case 'mirror_brush':
      return [[cx, cy]];
    default:
      return [[cx, cy]];
  }
}

function userOwnsTool(user, toolKey) {
  if (!toolKey) return true;
  return (user.gadgets || []).includes(toolKey);
}

function maxBlockLevel(user) {
  return user.shopLevels?.[BLOCK_COLLECTION_KEY] || 0;
}

function maxBlockSizeForUser(user) {
  const lvl = maxBlockLevel(user);
  if (lvl <= 0) return 1;
  return PIXEL_BLOCKS[lvl - 1]?.size || 1;
}

function unlockedBlockSizes(user) {
  const lvl = maxBlockLevel(user);
  if (lvl <= 0) return [1];
  const sizes = new Set([1]);
  for (let i = 0; i < lvl && i < PIXEL_BLOCKS.length; i++) {
    sizes.add(PIXEL_BLOCKS[i].size);
  }
  return [...sizes].sort((a, b) => a - b);
}

function unlockedPaintTools(user) {
  const gadgets = user.gadgets || [];
  const out = [{ key: null, name: 'Píxel único', icon: '▪', desc: 'Una celda por clic.', kind: 'basic' }];

  for (const b of BRUSHES) {
    const key = brushUnlockKey(b.name);
    if (gadgets.includes(key)) {
      out.push({ key, name: b.name, icon: b.icon || '🖌', desc: b.desc, kind: 'brush' });
    }
  }

  for (const d of DIBUJO_ITEMS) {
    if (d.item) continue;
    if (!gadgets.includes(d.id)) continue;
    let kind = 'tool';
    if (d.id.startsWith('stamp_')) kind = 'stamp';
    else if (d.id.startsWith('pattern_')) kind = 'pattern';
    else if (d.id === 'mirror_brush') kind = 'mirror';
    else if (d.id === 'paint_bucket') kind = 'bucket';
    out.push({ key: d.id, name: d.name, icon: d.icon || '🖌', desc: d.desc, kind });
  }

  return out;
}

function resolveEquippedTool(user, override) {
  if (override === null || override === '') return null;
  const tool = override !== undefined ? override : user.activeBrush;
  if (!tool) return null;
  if (userOwnsTool(user, tool)) return tool;
  return null;
}

function resolveEquippedBlockSize(user, override) {
  const max = maxBlockSizeForUser(user);
  const want = override != null ? Math.trunc(Number(override)) : (user.activeBlockSize || 1);
  const allowed = unlockedBlockSizes(user);
  if (allowed.includes(want)) return want;
  if (want <= max && max > 1) return want;
  return 1;
}

function resolveMirrorAxis(user) {
  if (!userOwnsTool(user, 'mirror_brush')) return null;
  if (user.activeBrush === 'mirror_brush') return user.mirrorAxis || 'v';
  if (user.mirrorEnabled) return user.mirrorAxis || 'v';
  return null;
}

function isBatchPaint(user, cells, tool, blockSize, clientBlockSize) {
  const max = maxBlockSizeForUser(user);
  const clientSize = clientBlockSize != null ? Math.trunc(Number(clientBlockSize)) : 0;
  if (clientSize > 1 && clientSize <= max) return true;
  const size = blockSize || resolveEquippedBlockSize(user);
  if (size > 1) return true;
  if (cells.length > 1) return true;
  if (tool && tool !== 'grid_snap' && tool !== 'mirror_brush') return true;
  if (tool && STAMP_BITMAP[tool]) return true;
  return false;
}

function paintCellsForUser(user, cx, cy, opts = {}) {
  const tool = resolveEquippedTool(user, opts.brush);
  const size = resolveEquippedBlockSize(user, opts.blockSize);
  let cells = cellsForTool(tool, cx, cy, size);
  const mirror = resolveMirrorAxis(user);
  if (mirror && tool !== 'paint_bucket') {
    cells = applyMirror(cells, cx, cy, mirror);
  }
  return cells;
}

function isPaintToolId(id) {
  return PAINT_TOOL_IDS.has(id) || id === null;
}

function floodFillCells(startX, startY, getPixelColor, targetColor, maxCells = 180) {
  const target = String(targetColor).toUpperCase();
  const startColor = getPixelColor(startX, startY);
  if (startColor == null || String(startColor).toUpperCase() === target) return [];

  const out = [];
  const queue = [[startX, startY]];
  const visited = new Set([`${startX},${startY}`]);
  const match = (c) => String(c).toUpperCase() === String(startColor).toUpperCase();

  while (queue.length && out.length < maxCells) {
    const [x, y] = queue.shift();
    const c = getPixelColor(x, y);
    if (c == null || !match(c)) continue;
    out.push([x, y]);
    for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
      const k = `${nx},${ny}`;
      if (visited.has(k)) continue;
      visited.add(k);
      queue.push([nx, ny]);
    }
  }
  return out;
}

module.exports = {
  BRUSH_COLLECTION_KEY,
  BLOCK_COLLECTION_KEY,
  PAINT_TOOL_IDS,
  brushUnlockKey,
  maxBlockLevel,
  maxBlockSizeForUser,
  unlockedBlockSizes,
  unlockedPaintTools,
  cellsForTool,
  paintCellsForUser,
  resolveEquippedTool,
  resolveEquippedBlockSize,
  resolveMirrorAxis,
  isBatchPaint,
  userOwnsTool,
  isPaintToolId,
  floodFillCells,
  applyMirror,
};
