/** Configuración del plano píxel (img → guía consumible) */
const MAX_SIDE = 20_000;
const MAX_GRID_AREA = MAX_SIDE * MAX_SIDE;
/** Celdas no vacías máximas (sparse) — hasta ~1024×1024 denso */
const MAX_CELLS = 2_000_000;
/** Token de tienda + monedas según píxeles y colores detectados */
const BASE_COST = 1_200;
const COST_PER_CELL = 2.35;
const COST_PER_COLOR = 62;
const COST_PER_SIDE = 2.4;
const MIN_COST = 2_500;
/** Estimación antes de muestrear imagen (solo por área del lienzo) */
const AREA_ESTIMATE_RATE = 0.0028;
/** Colores incluidos sin recargo extra */
const COLORS_INCLUDED = 1;
const ITEM_KEY = 'pixel_blueprint';
const DEFAULT_TOLERANCE = 28;
const MAX_PAYLOAD_CELLS = 2_000_000;
const MAX_COMPACT_BYTES = 32 * 1024 * 1024;

const PRESET_SIZES = [8, 12, 16, 24, 32, 48, 64, 96, 128, 192, 256, 384, 512, 768, 1024, 2048, 4096];

function clampSide(n) {
  const v = Math.trunc(Number(n));
  if (!Number.isFinite(v) || v < 1) return 1;
  return Math.min(MAX_SIDE, v);
}

function validateDimensions(width, height) {
  const w = clampSide(width);
  const h = clampSide(height);
  if (w * h > MAX_GRID_AREA) {
    return { ok: false, error: `El área máxima es ${MAX_SIDE.toLocaleString()}×${MAX_SIDE.toLocaleString()} px` };
  }
  return { ok: true, width: w, height: h, area: w * h };
}

function parseHexColor(raw) {
  const color = String(raw || '').trim().toUpperCase();
  if (/^#[0-9A-F]{6}$/.test(color)) return color;
  if (/^[0-9A-F]{6}$/.test(color)) return `#${color}`;
  return null;
}

function dedupeCells(cells) {
  const map = new Map();
  for (const c of cells) {
    if (!c || typeof c !== 'object') continue;
    const lx = Math.trunc(Number(c.x ?? c.lx));
    const ly = Math.trunc(Number(c.y ?? c.ly));
    const color = parseHexColor(c.c || c.color);
    if (!Number.isInteger(lx) || !Number.isInteger(ly) || !color) continue;
    map.set(`${lx},${ly}`, { x: lx, y: ly, c: color });
  }
  return [...map.values()];
}

function countUniqueColors(cells) {
  const set = new Set();
  for (const c of cells) {
    const color = parseHexColor(c.c || c.color);
    if (color) set.add(color);
  }
  return set.size;
}

function colorSurcharge(colorCount) {
  const colors = Math.max(0, Math.trunc(colorCount));
  return Math.max(0, colors - COLORS_INCLUDED) * COST_PER_COLOR;
}

/** Recargo por planos grandes / densos (arte detallada cuesta más). */
function planScaleMultiplier(width, height, cellCount) {
  const side = Math.max(width, height);
  const cells = Math.max(0, Math.trunc(cellCount));
  let m = 1;
  if (side >= 256) m += 0.08;
  if (side >= 512) m += 0.18;
  if (side >= 1024) m += 0.28;
  if (side >= 2048) m += 0.45;
  if (cells >= 80_000) m += 0.1;
  if (cells >= 200_000) m += 0.15;
  if (cells >= 500_000) m += 0.22;
  return m;
}

function blueprintCost(width, height, cellCount = 0, colorCount = 0) {
  const dim = validateDimensions(width, height);
  if (!dim.ok) return MIN_COST;
  const { width: w, height: h, area } = dim;
  const cells = Math.max(0, Math.trunc(cellCount));
  const colors = Math.max(0, Math.trunc(colorCount));

  if (cells <= 0) {
    return Math.ceil(MIN_COST + area * AREA_ESTIMATE_RATE + (w + h) * COST_PER_SIDE);
  }

  const cellFee = cells * COST_PER_CELL;
  const colorFee = colorSurcharge(colors);
  const dimFee = (w + h) * COST_PER_SIDE * 0.4;
  const raw = BASE_COST + cellFee + colorFee + dimFee;
  const scaled = raw * planScaleMultiplier(w, h, cells);
  return Math.ceil(Math.max(MIN_COST, scaled));
}

function costBreakdown(width, height, cellCount = 0, colorCount = 0) {
  const dim = validateDimensions(width, height);
  if (!dim.ok) return null;
  const { width: w, height: h } = dim;
  const cells = Math.max(0, Math.trunc(cellCount));
  const colors = Math.max(0, Math.trunc(colorCount));
  const cellFee = cells * COST_PER_CELL;
  const colorFee = colorSurcharge(colors);
  const dimFee = (w + h) * COST_PER_SIDE * 0.4;
  const raw = BASE_COST + cellFee + colorFee + dimFee;
  const scale = planScaleMultiplier(w, h, cells);
  const total = Math.ceil(Math.max(MIN_COST, raw * scale));
  return {
    base: BASE_COST,
    cells: Math.ceil(cellFee),
    colors: Math.ceil(colorFee),
    dimension: Math.ceil(dimFee),
    scale,
    total,
    cellCount: cells,
    colorCount: colors,
  };
}

/** Compacto: "x:y:RRGGBB;x:y:RRGGBB" */
function encodeCellsCompact(cells) {
  if (!Array.isArray(cells) || !cells.length) return '';
  const parts = new Array(cells.length);
  for (let i = 0; i < cells.length; i++) {
    const c = cells[i];
    const hex = parseHexColor(c.c || c.color);
    if (!hex) continue;
    parts[i] = `${Math.trunc(c.x ?? c.lx)}:${Math.trunc(c.y ?? c.ly)}:${hex.slice(1)}`;
  }
  return parts.filter(Boolean).join(';');
}

function decodeCellsCompact(raw, width, height) {
  const out = [];
  if (!raw || typeof raw !== 'string') return out;
  if (raw.length > MAX_COMPACT_BYTES) return out;
  const chunks = raw.split(';');
  for (const chunk of chunks) {
    if (!chunk) continue;
    const parts = chunk.split(':');
    if (parts.length !== 3) continue;
    const [xs, ys, hs] = parts;
    const lx = Math.trunc(Number(xs));
    const ly = Math.trunc(Number(ys));
    const color = parseHexColor(hs);
    if (!Number.isInteger(lx) || !Number.isInteger(ly) || !color) continue;
    if (lx < 0 || ly < 0 || lx >= width || ly >= height) continue;
    out.push({ x: lx, y: ly, c: color });
  }
  return out;
}

function normalizeCellsInput(body, width, height) {
  if (body?.cellsCompact) {
    if (String(body.cellsCompact).length > MAX_COMPACT_BYTES) return [];
    return dedupeCells(decodeCellsCompact(body.cellsCompact, width, height));
  }
  if (!Array.isArray(body?.cells)) return [];
  return dedupeCells(body.cells.map((c) => ({
    x: c.x ?? c.lx,
    y: c.y ?? c.ly,
    c: c.c || c.color,
  })));
}

function sanitizeBlueprint(bp, { requireCells = true } = {}) {
  if (!bp || typeof bp !== 'object') return null;
  const dim = validateDimensions(bp.width, bp.height);
  if (!dim.ok) return null;
  const { width: w, height: h } = dim;
  const ox = Math.trunc(Number(bp.originX));
  const oy = Math.trunc(Number(bp.originY));
  if (!Number.isFinite(ox) || !Number.isFinite(oy)) return null;

  let cells = Array.isArray(bp.cells) ? bp.cells : [];
  if (!cells.length && bp.cellsCompact) {
    cells = decodeCellsCompact(bp.cellsCompact, w, h);
  }
  cells = dedupeCells(cells);
  const out = [];
  for (const c of cells) {
    if (c.x < 0 || c.y < 0 || c.x >= w || c.y >= h) continue;
    out.push(c);
  }
  if (requireCells && !out.length) return null;
  if (out.length > MAX_CELLS) return null;

  const meta = {
    id: String(bp.id || `bp_${Date.now()}`),
    width: w,
    height: h,
    originX: ox,
    originY: oy,
    cellCount: out.length,
    colorCount: countUniqueColors(out),
    visible: bp.visible !== false,
    tolerance: Math.min(80, Math.max(0, Math.trunc(Number(bp.tolerance ?? DEFAULT_TOLERANCE)))),
    showGrid: bp.showGrid !== false,
    hideCompleted: bp.hideCompleted !== false,
    showErrors: bp.showErrors !== false,
    markStray: bp.markStray !== false,
    opacity: Math.min(0.92, Math.max(0.15, Number(bp.opacity) || 0.55)),
    fitMode: ['stretch', 'contain', 'cover'].includes(bp.fitMode) ? bp.fitMode : 'stretch',
    colorMode: ['exact', 'palette', 'quantize'].includes(bp.colorMode) ? bp.colorMode : 'exact',
    name: String(bp.name || '').slice(0, 48) || null,
    createdAt: bp.createdAt || Date.now(),
    updatedAt: bp.updatedAt || bp.createdAt || Date.now(),
  };

  if (out.length) {
    meta.cells = out;
    meta.cellsCompact = encodeCellsCompact(out);
  } else if (bp.cellsCompact) {
    meta.cellsCompact = bp.cellsCompact;
  }

  return meta;
}

/** Solo metadatos + cellsCompact (sin array cells) — para disco, sesión y API. */
function blueprintForStorage(bp) {
  if (!bp || typeof bp !== 'object') return null;
  const w = clampSide(bp.width);
  const h = clampSide(bp.height);
  if (w * h > MAX_GRID_AREA) return null;
  const ox = Math.trunc(Number(bp.originX));
  const oy = Math.trunc(Number(bp.originY));
  if (!Number.isFinite(ox) || !Number.isFinite(oy)) return null;

  let cellsCompact = bp.cellsCompact ? String(bp.cellsCompact) : '';
  let cellCount = Math.max(0, Math.trunc(Number(bp.cellCount) || 0));

  if (!cellsCompact && Array.isArray(bp.cells) && bp.cells.length) {
    const deduped = dedupeCells(bp.cells.map((c) => ({
      x: c.x ?? c.lx,
      y: c.y ?? c.ly,
      c: c.c || c.color,
    })));
    if (deduped.length > MAX_CELLS) return null;
    cellsCompact = encodeCellsCompact(deduped);
    cellCount = deduped.length;
  }

  if (!cellsCompact) return null;

  return {
    id: String(bp.id || `bp_${Date.now()}`),
    width: w,
    height: h,
    originX: ox,
    originY: oy,
    cellCount,
    colorCount: Math.max(0, Math.trunc(Number(bp.colorCount) || 0)),
    cellsCompact,
    visible: bp.visible !== false,
    tolerance: Math.min(80, Math.max(0, Math.trunc(Number(bp.tolerance ?? DEFAULT_TOLERANCE)))),
    showGrid: bp.showGrid !== false,
    hideCompleted: bp.hideCompleted !== false,
    showErrors: bp.showErrors !== false,
    markStray: bp.markStray !== false,
    opacity: Math.min(0.92, Math.max(0.15, Number(bp.opacity) || 0.55)),
    fitMode: ['stretch', 'contain', 'cover'].includes(bp.fitMode) ? bp.fitMode : 'stretch',
    colorMode: ['exact', 'palette', 'quantize'].includes(bp.colorMode) ? bp.colorMode : 'exact',
    name: String(bp.name || '').slice(0, 48) || null,
    createdAt: bp.createdAt || Date.now(),
    updatedAt: bp.updatedAt || bp.createdAt || Date.now(),
  };
}

function blueprintSummary(bp) {
  if (!bp || typeof bp !== 'object') return null;
  const w = clampSide(bp.width);
  const h = clampSide(bp.height);
  if (w * h > MAX_GRID_AREA) return null;
  const cellCount = bp.cellCount
    ?? (Array.isArray(bp.cells) ? bp.cells.length : 0)
    ?? (bp.cellsCompact ? decodeCellsCompact(bp.cellsCompact, w, h).length : 0);
  return {
    id: String(bp.id || ''),
    width: w,
    height: h,
    originX: Math.trunc(Number(bp.originX)),
    originY: Math.trunc(Number(bp.originY)),
    cellCount,
    colorCount: bp.colorCount ?? 0,
    visible: bp.visible !== false,
    tolerance: Math.min(80, Math.max(0, Math.trunc(Number(bp.tolerance ?? DEFAULT_TOLERANCE)))),
    showGrid: bp.showGrid !== false,
    hideCompleted: bp.hideCompleted !== false,
    showErrors: bp.showErrors !== false,
    markStray: bp.markStray !== false,
    opacity: Math.min(0.92, Math.max(0.15, Number(bp.opacity) || 0.55)),
    fitMode: bp.fitMode || 'stretch',
    colorMode: bp.colorMode || 'exact',
    name: bp.name || null,
    createdAt: bp.createdAt || Date.now(),
    updatedAt: bp.updatedAt || Date.now(),
  };
}

function publicBlueprint(bp, { includeCells = false } = {}) {
  const stored = blueprintForStorage(bp) || blueprintSummary(bp);
  if (!stored) return null;
  if (!includeCells) return stored;
  return stored;
}

function quoteForClient(width, height, cellCount = 0, colorCount = 0) {
  const dim = validateDimensions(width, height);
  if (!dim.ok) return { ok: false, error: dim.error };
  const cells = Math.max(0, Math.trunc(Number(cellCount) || 0));
  const colors = Math.max(0, Math.trunc(Number(colorCount) || 0));
  return {
    ok: true,
    width: dim.width,
    height: dim.height,
    area: dim.area,
    cellCount: cells,
    colorCount: colors,
    cost: blueprintCost(dim.width, dim.height, cells, colors),
    breakdown: costBreakdown(dim.width, dim.height, cells, colors),
    maxSide: MAX_SIDE,
    maxCells: MAX_CELLS,
    pricing: {
      baseCost: BASE_COST,
      costPerCell: COST_PER_CELL,
      costPerColor: COST_PER_COLOR,
      costPerSide: COST_PER_SIDE,
      areaEstimateRate: AREA_ESTIMATE_RATE,
      colorsIncluded: COLORS_INCLUDED,
      minCost: MIN_COST,
    },
  };
}

module.exports = {
  MAX_SIDE,
  MAX_GRID_AREA,
  MAX_CELLS,
  MAX_PAYLOAD_CELLS,
  MAX_COMPACT_BYTES,
  BASE_COST,
  COST_PER_CELL,
  COST_PER_COLOR,
  COST_PER_SIDE,
  AREA_ESTIMATE_RATE,
  COLORS_INCLUDED,
  MIN_COST,
  PRESET_SIZES,
  ITEM_KEY,
  DEFAULT_TOLERANCE,
  clampSide,
  validateDimensions,
  dedupeCells,
  countUniqueColors,
  blueprintCost,
  costBreakdown,
  planScaleMultiplier,
  encodeCellsCompact,
  decodeCellsCompact,
  normalizeCellsInput,
  sanitizeBlueprint,
  blueprintForStorage,
  blueprintSummary,
  publicBlueprint,
  quoteForClient,
};
