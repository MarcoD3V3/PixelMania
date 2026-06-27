/** Plano píxel: imagen → guía consumible (hasta 20k×20k, sparse) */
(function () {
  'use strict';

/** Color marcador de errores — no está en la paleta del juego (#FF00FF magenta) */
const ERROR_MARKER = '#FF00FF';
const ERROR_MARKER_ALT = '#00FFFF';
const ERROR_EMOJI = '❌';
const STRAY_EMOJI = '🚫';
  const SAMPLE_TILE = 64;
  const LARGE_GRID_CELLS = 256 * 256;
  const HUGE_GRID_CELLS = 512 * 512;
  const MAX_FILE_MB = 24;
  const PROGRESS_THROTTLE_MS = 400;
  const PROGRESS_THROTTLE_HEAVY_MS = 1200;
  const PROGRESS_THROTTLE_HUGE_MS = 1800;
  const COLOR_REMAIN_HEAVY_MS = 3200;
  const ERROR_SCAN_THROTTLE_MS = 480;
  /** Rejilla del plano solo tiene sentido entre ~4px y ~18px por celda en pantalla */
  const GRID_MIN_SCREEN_PX = 4;
  const GRID_MAX_SCREEN_PX = 18;
  /** Niveles de detalle según zoom (screenPx = scale × dpr) */
  const LOD_FAR = 3;
  const LOD_MID = 8;
  const LOD_CLOSE = 20;
  const ERROR_DRAW_MAX = 500;
  const BC = () => window.BlueprintColors;

  const state = {
    draft: null,
    active: null,
    activeCells: null,
    cellIndex: null,
    progress: { filled: 0, total: 0, errors: 0, wrongColor: 0, stray: 0 },
    deps: null,
    sampling: false,
    sampleProgress: 0,
    lastProgressAt: 0,
    lastErrorScanAt: 0,
    lastErrors: null,
    colorStats: null,
    hexCellLists: null,
    focusColor: null,
    paintFilter: true,
    colorRemaining: null,
    lastColorRemainAt: 0,
    decodingId: 0,
    errorScanGen: 0,
    errorScanCursor: 0,
    lastErrorLod: '',
    loadedImage: null,
    rasterCache: null,
    ui: { lockAspect: true, aspect: 1 },
    placement: null,
    moveMode: false,
    drag: null,
    config: {
      presetSizes: [8, 16, 32, 64, 128, 256, 512, 1024, 2048, 4096],
      maxSide: 20000,
      maxCells: 2000000,
      baseCost: 1200,
      costPerCell: 2.35,
      costPerColor: 62,
      costPerSide: 2.4,
      areaEstimateRate: 0.0028,
      colorsIncluded: 1,
      minCost: 2500,
    },
  };

  function rgbToHex(r, g, b) {
    return BC()?.rgbToHex(r, g, b) || `#${[r, g, b].map((v) => Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0')).join('')}`.toUpperCase();
  }

  function hexToRgb(hex) {
    return BC()?.hexToRgb(hex) || [0, 0, 0];
  }

  function colorDistance(a, b) {
    if (BC()) return BC().colorDistance(a, b);
    const [r1, g1, b1] = hexToRgb(a);
    const [r2, g2, b2] = hexToRgb(b);
    return Math.sqrt((r1 - r2) ** 2 + (g1 - g2) ** 2 + (b1 - b2) ** 2);
  }

  function colorsMatch(a, b, tolerance) {
    if (BC()) return BC().colorsMatch(a, b, tolerance);
    return colorDistance(a, b) <= tolerance;
  }

  function snapColor(hex, palette) {
    if (BC()) return BC().snapToPalette(hex, palette);
    const up = String(hex).toUpperCase();
    if (!palette?.length) return up;
    if (palette.includes(up)) return up;
    let best = palette[0];
    let bestD = Infinity;
    for (const c of palette) {
      const d = colorDistance(up, c);
      if (d < bestD) { bestD = d; best = c; }
    }
    return best;
  }

  function clampSide(n) {
    const v = Math.trunc(Number(n));
    if (!Number.isFinite(v) || v < 1) return 1;
    return Math.min(state.config.maxSide || 20000, v);
  }

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

  function computeCost(w, h, cellCount = 0, colorCount = 0) {
    const width = clampSide(w);
    const height = clampSide(h);
    const cells = Math.max(0, Math.trunc(cellCount));
    const colors = Math.max(0, Math.trunc(colorCount));
    const cfg = state.config;
    const sideRate = cfg.costPerSide ?? 2.4;
    const areaRate = cfg.areaEstimateRate ?? 0.0028;
    if (cells <= 0) {
      const area = width * height;
      return Math.ceil((cfg.minCost || 2500) + area * areaRate + (width + height) * sideRate);
    }
    const colorFee = Math.max(0, colors - (cfg.colorsIncluded ?? 1)) * (cfg.costPerColor || 62);
    const dimFee = (width + height) * sideRate * 0.4;
    const raw = (cfg.baseCost || 1200) + cells * (cfg.costPerCell || 2.35) + colorFee + dimFee;
    const scaled = raw * planScaleMultiplier(width, height, cells);
    return Math.ceil(Math.max(cfg.minCost || 2500, scaled));
  }

  function costBreakdownText(w, h, cellCount, colorCount) {
    const cfg = state.config;
    const cells = Math.max(0, Math.trunc(cellCount));
    const colors = Math.max(0, Math.trunc(colorCount));
    const base = cfg.baseCost || 1200;
    const cellFee = Math.ceil(cells * (cfg.costPerCell || 2.35));
    const colorFee = Math.ceil(Math.max(0, colors - (cfg.colorsIncluded ?? 1)) * (cfg.costPerColor || 62));
    const total = computeCost(w, h, cells, colors);
    const scale = planScaleMultiplier(clampSide(w), clampSide(h), cells);
    if (cells <= 0) return `~${total.toLocaleString()} 🪙 (estimado por tamaño) + 1 token`;
    const parts = [`${base} base`, `${cellFee} (${cells.toLocaleString()} px)`];
    if (colorFee > 0) parts.push(`${colorFee} (${colors} colores)`);
    if (scale > 1) parts.push(`×${scale.toFixed(2)} plano grande`);
    return `${total.toLocaleString()} 🪙 · ${parts.join(' + ')} + 1 token`;
  }

  async function fetchServerQuote(w, h, cellCount, colorCount) {
    try {
      const q = new URLSearchParams({
        w: String(w), h: String(h), cells: String(cellCount), colors: String(colorCount),
      });
      const res = await fetch(`/api/blueprint/quote?${q}`, { credentials: 'include' });
      const data = await res.json();
      if (res.ok && data.cost != null) return data;
    } catch (_) { /* fallback local */ }
    return null;
  }

  function encodeCellsCompact(cells) {
    if (!cells?.length) return '';
    return cells.map((c) => `${c.x}:${c.y}:${c.c.slice(1)}`).join(';');
  }

  function decodeCellsCompact(raw, width, height) {
    const out = [];
    if (!raw) return out;
    for (const chunk of String(raw).split(';')) {
      if (!chunk) continue;
      const [xs, ys, hs] = chunk.split(':');
      const x = Math.trunc(Number(xs));
      const y = Math.trunc(Number(ys));
      const c = hs && hs.length === 6 ? `#${hs.toUpperCase()}` : null;
      if (!c || x < 0 || y < 0 || x >= width || y >= height) continue;
      out.push({ x, y, c });
    }
    return out;
  }

  async function decodeCellsCompactAsync(raw, width, height) {
    const parts = String(raw || '').split(';');
    const out = [];
    const slice = 6000;
    for (let i = 0; i < parts.length; i++) {
      const chunk = parts[i];
      if (!chunk) continue;
      const [xs, ys, hs] = chunk.split(':');
      const x = Math.trunc(Number(xs));
      const y = Math.trunc(Number(ys));
      const c = hs && hs.length === 6 ? `#${hs.toUpperCase()}` : null;
      if (!c || x < 0 || y < 0 || x >= width || y >= height) continue;
      out.push({ x, y, c });
      if (i > 0 && i % slice === 0) await yieldFrame();
    }
    return out;
  }

  function resolveCells(bp) {
    if (!bp) return [];
    if (Array.isArray(bp.cells) && bp.cells.length) return bp.cells;
    if (bp.cellsCompact) return decodeCellsCompact(bp.cellsCompact, bp.width, bp.height);
    return state.activeCells || [];
  }

  function buildCellIndex(cells) {
    const map = new Map();
    for (const cell of cells) map.set(`${cell.x},${cell.y}`, cell.c);
    return map;
  }

  function buildHexCellLists(cells) {
    const lists = new Map();
    for (const cell of cells) {
      const h = String(cell.c).toUpperCase();
      if (!lists.has(h)) lists.set(h, []);
      lists.get(h).push(cell);
    }
    return lists;
  }

  function getRenderLod(screenPx) {
    if (screenPx < LOD_FAR) return 'far';
    if (screenPx < LOD_MID) return 'mid';
    if (screenPx < LOD_CLOSE) return 'close';
    return 'near';
  }

  function countRemainingForHex(hex, list, getPx, bp, tol) {
    const step = list.length > 12000 ? Math.ceil(list.length / 12000) : 1;
    let left = 0;
    for (let i = 0; i < list.length; i += step) {
      const cell = list[i];
      const got = getPx(bp.originX + cell.x, bp.originY + cell.y);
      if (!got || !colorsMatch(String(got).toUpperCase(), hex, tol)) left++;
    }
    return step > 1 ? Math.min(list.length, Math.round(left * step)) : left;
  }

  function refreshColorRemainingCache(force) {
    const bp = state.active;
    const lists = state.hexCellLists;
    const getPx = state.deps?.getPixelColor;
    if (!bp || !lists?.size || !getPx) return;
    const now = Date.now();
    const heavy = (state.activeCells?.length || 0) >= 40000;
    const throttle = heavy ? COLOR_REMAIN_HEAVY_MS : 900;
    if (!force && now - state.lastColorRemainAt < throttle) return;
    state.lastColorRemainAt = now;
    const tol = bp.tolerance ?? 28;
    if (!state.colorRemaining) state.colorRemaining = new Map();

    if (heavy && state.focusColor && lists.has(state.focusColor)) {
      const h = String(state.focusColor).toUpperCase();
      state.colorRemaining.set(h, countRemainingForHex(h, lists.get(h), getPx, bp, tol));
      state.deps?.onBlueprintPaletteChange?.();
      return;
    }

    if (heavy && !force) {
      const keys = [...lists.keys()];
      let i = 0;
      const batch = () => {
        const end = Math.min(i + 4, keys.length);
        for (; i < end; i++) {
          const hex = keys[i];
          state.colorRemaining.set(hex, countRemainingForHex(hex, lists.get(hex), getPx, bp, tol));
        }
        if (i < keys.length) requestAnimationFrame(batch);
        else state.deps?.onBlueprintPaletteChange?.();
      };
      requestAnimationFrame(batch);
      return;
    }

    for (const [hex, list] of lists) {
      state.colorRemaining.set(hex, countRemainingForHex(hex, list, getPx, bp, tol));
    }
    state.deps?.onBlueprintPaletteChange?.();
  }

  function getBlueprintPaletteInfo() {
    const bp = state.active;
    const cells = state.activeCells;
    if (!bp || !cells?.length) return null;
    const canUse = state.deps?.colorIsUnlocked || (() => true);
    const premium = state.deps?.getPremiumColorCount?.() ?? 0;
    const priceAt = state.deps?.getColorPriceAt || ((n) => 80);
    const stats = state.colorStats?.swatches || [];
    let lockedSlot = 0;
    return stats.map(({ hex, count }) => {
      const h = String(hex).toUpperCase();
      const owned = canUse(h);
      const remaining = state.colorRemaining?.get(h) ?? count;
      let price = 0;
      let isNextUnlock = false;
      if (!owned) {
        price = priceAt(premium + lockedSlot);
        isNextUnlock = lockedSlot === 0;
        lockedSlot += 1;
      }
      return {
        hex: h, count, remaining, owned, price, isNextUnlock,
        focused: state.focusColor === h,
      };
    });
  }

  function yieldFrame() {
    return new Promise((r) => requestAnimationFrame(() => r()));
  }

  function gridArea(w, h) {
    return clampSide(w) * clampSide(h);
  }

  function sampleTileSize(w, h) {
    const area = gridArea(w, h);
    if (area >= 1024 * 1024) return 256;
    if (area >= HUGE_GRID_CELLS) return 128;
    if (area >= LARGE_GRID_CELLS) return 96;
    return SAMPLE_TILE;
  }

  function shouldYieldProgress(tileIdx, area) {
    if (area >= 1024 * 1024) return tileIdx % 12 === 0;
    if (area >= HUGE_GRID_CELLS) return tileIdx % 6 === 0;
    if (area >= LARGE_GRID_CELLS) return tileIdx % 4 === 0;
    return tileIdx % 2 === 0;
  }

  function getVisibleLocalRange(originX, originY, width, height, pad = 2) {
    const bounds = getVisibleBounds();
    if (!bounds) {
      return { lx0: 0, ly0: 0, lx1: width, ly1: height };
    }
    return {
      lx0: Math.max(0, Math.floor(bounds.x0 - originX - pad)),
      ly0: Math.max(0, Math.floor(bounds.y0 - originY - pad)),
      lx1: Math.min(width, Math.ceil(bounds.x1 - originX + pad + 1)),
      ly1: Math.min(height, Math.ceil(bounds.y1 - originY + pad + 1)),
    };
  }

  function invalidateRasterCache() {
    state.rasterCache = null;
  }

  function getRasterCache(cells, width, height, cacheKey) {
    if (!cells?.length || cells.length < 40000) return null;
    const key = `${cacheKey}:${width}x${height}:${cells.length}`;
    if (state.rasterCache?.key === key) return state.rasterCache;
    const maxSide = 640;
    const sc = Math.min(1, maxSide / Math.max(width, height));
    const cw = Math.max(1, Math.ceil(width * sc));
    const ch = Math.max(1, Math.ceil(height * sc));
    const cvs = document.createElement('canvas');
    cvs.width = cw;
    cvs.height = ch;
    const ctx = cvs.getContext('2d');
    const step = cells.length > 200000 ? Math.ceil(cells.length / 200000) : 1;
    for (let i = 0; i < cells.length; i += step) {
      const cell = cells[i];
      ctx.fillStyle = cell.c;
      ctx.fillRect(
        Math.floor(cell.x * sc),
        Math.floor(cell.y * sc),
        Math.max(1, Math.ceil(sc)),
        Math.max(1, Math.ceil(sc)),
      );
    }
    state.rasterCache = { key, canvas: cvs, sc, width, height };
    return state.rasterCache;
  }

  async function encodeCellsCompactAsync(cells) {
    if (!cells?.length) return '';
    const chunk = 80000;
    const parts = new Array(Math.ceil(cells.length / chunk));
    for (let i = 0, p = 0; i < cells.length; i += chunk, p++) {
      const slice = cells.slice(i, i + chunk);
      parts[p] = slice.map((c) => `${c.x}:${c.y}:${c.c.slice(1)}`).join(';');
      if (p % 3 === 2) await yieldFrame();
    }
    return parts.filter(Boolean).join(';');
  }

  function fitSourceRect(img, gridW, gridH, fitMode) {
    const iw = img.naturalWidth || img.width;
    const ih = img.naturalHeight || img.height;
    if (fitMode === 'stretch' || !iw || !ih) {
      return { sx: 0, sy: 0, sw: iw, sh: ih, dx: 0, dy: 0, dw: gridW, dh: gridH };
    }
    const scale = fitMode === 'cover'
      ? Math.max(gridW / iw, gridH / ih)
      : Math.min(gridW / iw, gridH / ih);
    const dw = iw * scale;
    const dh = ih * scale;
    const dx = (gridW - dw) / 2;
    const dy = (gridH - dh) / 2;
    return { sx: 0, sy: 0, sw: iw, sh: ih, dx, dy, dw, dh };
  }

  function quantizeCells(cells, maxColors, opts = {}) {
    let out = cells;
    const bc = BC();
    const area = cells.length;
    if (bc && opts.mergeSimilar !== false && area <= LARGE_GRID_CELLS) {
      out = bc.mergeSimilarColors(out, opts.mergeDeltaE ?? 5);
    }
    if (opts.palette?.length && opts.snapPalette !== false) {
      out = out.map((cell) => ({ ...cell, c: snapColor(cell.c, opts.palette) }));
    }
    if (!maxColors || maxColors >= 256 || out.length <= maxColors) return out;
    if (bc) return bc.kMeansQuantize(out, maxColors);
    const freq = new Map();
    for (const c of out) freq.set(c.c, (freq.get(c.c) || 0) + 1);
    const palette = [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, maxColors).map(([c]) => c);
    return out.map((cell) => ({ ...cell, c: snapColor(cell.c, palette) }));
  }

  function extractCellColor(data, tw, x, y, opts) {
    const i = (y * tw + x) * 4;
    const a = data[i + 3];
    if (opts.skipTransparent && a < 12) return null;
    let r = data[i];
    let g = data[i + 1];
    let b = data[i + 2];
    if (a < 250 && opts.bgColor) {
      [r, g, b] = BC()?.blendWithBg(r, g, b, a, opts.bgColor) || [r, g, b];
    }
    if (BC()) {
      [r, g, b] = BC().denoiseRgb(r, g, b, opts.denoiseBits ?? 4);
    }
    return rgbToHex(r, g, b);
  }

  async function sampleImageTiled(img, gridW, gridH, opts = {}, onProgress) {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const fit = fitSourceRect(img, gridW, gridH, opts.fitMode || 'stretch');
    const palette = opts.palette || null;
    const bg = opts.bgColor ? String(opts.bgColor).toUpperCase() : null;
    const area = gridW * gridH;
    const fast = area >= LARGE_GRID_CELLS;
    const tileSize = sampleTileSize(gridW, gridH);
    const maxCells = state.config.maxCells || 2000000;
    const cells = [];
    const totalTiles = Math.ceil(gridW / tileSize) * Math.ceil(gridH / tileSize);
    let tileIdx = 0;
    const sampleOpts = {
      skipTransparent: opts.skipTransparent !== false,
      bgColor: opts.bgColor,
      denoiseBits: fast ? 3 : (opts.denoiseBits ?? 4),
    };

    for (let ty = 0; ty < gridH; ty += tileSize) {
      for (let tx = 0; tx < gridW; tx += tileSize) {
        const tw = Math.min(tileSize, gridW - tx);
        const th = Math.min(tileSize, gridH - ty);
        canvas.width = tw;
        canvas.height = th;
        ctx.imageSmoothingEnabled = false;
        ctx.clearRect(0, 0, tw, th);
        if (bg) {
          ctx.fillStyle = bg;
          ctx.fillRect(0, 0, tw, th);
        }
        const destX = tx;
        const destY = ty;
        const srcX = fit.sx + ((destX - fit.dx) / fit.dw) * fit.sw;
        const srcY = fit.sy + ((destY - fit.dy) / fit.dh) * fit.sh;
        const srcW = (tw / fit.dw) * fit.sw;
        const srcH = (th / fit.dh) * fit.sh;
        if (opts.fitMode === 'contain' && (destX + tw <= fit.dx || destY + th <= fit.dy
          || destX >= fit.dx + fit.dw || destY >= fit.dy + fit.dh)) {
          tileIdx++;
          onProgress?.(tileIdx / totalTiles);
          if (shouldYieldProgress(tileIdx, area)) await yieldFrame();
          continue;
        }
        ctx.drawImage(img, srcX, srcY, srcW, srcH, 0, 0, tw, th);
        const data = ctx.getImageData(0, 0, tw, th).data;

        for (let gy = ty; gy < ty + th; gy++) {
          for (let gx = tx; gx < tx + tw; gx++) {
            if (opts.fitMode === 'contain' && (gx < fit.dx || gy < fit.dy
              || gx >= fit.dx + fit.dw || gy >= fit.dy + fit.dh)) continue;
            const lx = gx - tx;
            const ly = gy - ty;
            let hex = extractCellColor(data, tw, lx, ly, sampleOpts);
            if (!hex && BC() && !fast) {
              const samples = [];
              for (let dy = -1; dy <= 1; dy++) {
                for (let dx = -1; dx <= 1; dx++) {
                  const h = extractCellColor(data, tw, lx + dx, ly + dy, sampleOpts);
                  if (h) samples.push(h);
                }
              }
              hex = BC().dominantFromSamples(samples);
            }
            if (!hex) continue;
            cells.push({
              x: gx,
              y: gy,
              c: opts.snapPalette !== false && palette ? snapColor(hex, palette) : hex,
            });
          }
        }
        tileIdx++;
        onProgress?.(tileIdx / totalTiles);
        if (shouldYieldProgress(tileIdx, area)) await yieldFrame();
      }
    }

    if (cells.length > maxCells) {
      throw new Error(`La imagen genera ${cells.length.toLocaleString()} píxeles (máx. ${maxCells.toLocaleString()}). Usa transparencia, reduce tamaño o elige "Contener".`);
    }
    return quantizeCells(cells, opts.maxColors, { ...opts, mergeSimilar: !fast && opts.mergeSimilar !== false });
  }

  function loadImageFile(file) {
    return new Promise((resolve, reject) => {
      if (!file || !file.type.startsWith('image/')) {
        reject(new Error('Sube PNG, JPG, GIF o WebP'));
        return;
      }
      if (file.size > MAX_FILE_MB * 1024 * 1024) {
        reject(new Error(`Imagen demasiado grande (máx. ${MAX_FILE_MB} MB)`));
        return;
      }
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        resolve(img);
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('No se pudo leer la imagen'));
      };
      img.src = url;
    });
  }

  function renderDraftPreview(cells, w, h) {
    const cvs = document.createElement('canvas');
    const scale = Math.min(1, 128 / Math.max(w, h));
    cvs.width = Math.max(1, Math.floor(w * scale));
    cvs.height = Math.max(1, Math.floor(h * scale));
    const ctx = cvs.getContext('2d');
    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(0, 0, cvs.width, cvs.height);
    const step = cells.length > 80000 ? Math.ceil(cells.length / 80000) : 1;
    for (let i = 0; i < cells.length; i += step) {
      const cell = cells[i];
      ctx.fillStyle = cell.c;
      ctx.fillRect(
        Math.floor(cell.x * scale),
        Math.floor(cell.y * scale),
        Math.max(1, Math.ceil(scale)),
        Math.max(1, Math.ceil(scale)),
      );
    }
    return cvs.toDataURL('image/png');
  }

  async function buildDraftFromImage(img, w, h, opts) {
    state.sampling = true;
    state.sampleProgress = 0;
    renderPanel();
    try {
      const cells = await sampleImageTiled(img, w, h, opts, (p) => {
        state.sampleProgress = p;
        const bar = document.getElementById('blueprint-sample-bar');
        if (bar) bar.style.width = `${Math.round(p * 100)}%`;
        const txt = document.getElementById('blueprint-sample-text');
        if (txt) txt.textContent = `Procesando imagen… ${Math.round(p * 100)}%`;
      });
      state.draft = {
        width: w,
        height: h,
        cells,
        cellCount: cells.length,
        colorCount: BC()?.countUnique(cells) ?? new Set(cells.map((c) => c.c)).size,
        colorStats: cells.length <= 120000 ? (BC()?.analyzePalette(cells) ?? null) : null,
        previewUrl: renderDraftPreview(cells, w, h),
        tolerance: opts.tolerance ?? 28,
        showGrid: opts.showGrid !== false,
        hideCompleted: opts.hideCompleted !== false,
        opacity: opts.opacity ?? 0.55,
        fitMode: opts.fitMode || 'stretch',
        colorMode: opts.colorMode || 'exact',
        name: opts.name || '',
        quote: null,
      };
      const quote = await fetchServerQuote(w, h, state.draft.cellCount, state.draft.colorCount);
      if (quote) state.draft.quote = quote;
      return state.draft;
    } finally {
      state.sampling = false;
      state.sampleProgress = 0;
      renderPanel();
    }
  }

  function finishBlueprintLoad(cells) {
    state.activeCells = cells;
    state.cellIndex = cells.length < 40000 ? buildCellIndex(cells) : null;
    state.hexCellLists = cells.length < 40000 ? buildHexCellLists(cells) : null;
    state.colorStats = cells.length < 120000 ? computeColorStats(cells) : null;
    if (state.focusColor && !state.hexCellLists?.has(String(state.focusColor).toUpperCase())) {
      state.focusColor = null;
    }
    if (cells.length >= 40000) {
      setTimeout(() => finishHeavyBlueprintIndex(), 0);
    } else {
      updateProgressFromMap(true);
    }
    state.deps?.markBlueprintLayerDirty?.();
    state.deps?.onBlueprintPaletteChange?.();
    state.deps?.scheduleRender?.();
    const sel = state.deps?.getSelectedColor?.();
    if (sel) syncFocusFromSelectedColor(sel);
  }

  function setActiveBlueprint(bp) {
    state.active = bp;
    state.decodingId = (state.decodingId || 0) + 1;
    const decodeToken = state.decodingId;
    invalidateRasterCache();

    if (Array.isArray(bp?.cells) && bp.cells.length) {
      finishBlueprintLoad(bp.cells);
      return;
    }
    if (bp?.cellsCompact) {
      state.activeCells = null;
      state.cellIndex = null;
      state.hexCellLists = null;
      state.colorStats = null;
      state.colorRemaining = null;
      decodeCellsCompactAsync(bp.cellsCompact, bp.width, bp.height).then((cells) => {
        if (state.decodingId !== decodeToken || state.active !== bp) return;
        finishBlueprintLoad(cells);
      });
      return;
    }
    finishBlueprintLoad(resolveCells(bp));
  }

  async function finishHeavyBlueprintIndex() {
    if (!state.activeCells?.length) return;
    await yieldFrame();
    state.cellIndex = buildCellIndex(state.activeCells);
    await yieldFrame();
    state.hexCellLists = buildHexCellLists(state.activeCells);
    state.colorStats = computeColorStats(state.activeCells);
    if (state.focusColor && !state.hexCellLists?.has(String(state.focusColor).toUpperCase())) {
      state.focusColor = null;
    }
    updateProgressFromMap(true);
    state.deps?.markBlueprintLayerDirty?.();
    state.deps?.onBlueprintPaletteChange?.();
    state.deps?.scheduleRender?.();
    const sel = state.deps?.getSelectedColor?.();
    if (sel) syncFocusFromSelectedColor(sel);
  }

  function setFocusColor(hex, opts = {}) {
    const h = hex ? String(hex).toUpperCase() : null;
    if (h && !state.hexCellLists?.has(h)) {
      if (opts.force) state.focusColor = null;
      return;
    }
    if (opts.force) {
      state.focusColor = h;
    } else {
      state.focusColor = state.focusColor === h ? null : h;
    }
    state.deps?.markBlueprintLayerDirty?.();
    state.deps?.onBlueprintPaletteChange?.();
    state.deps?.scheduleRender?.();
  }

  function syncFocusFromSelectedColor(hex) {
    if (!state.active || state.active.visible === false || !state.paintFilter) {
      if (state.focusColor) {
        state.focusColor = null;
        state.deps?.markBlueprintLayerDirty?.();
        state.deps?.scheduleRender?.();
      }
      return;
    }
    const h = hex ? String(hex).toUpperCase() : null;
    const canUse = state.deps?.colorIsUnlocked || (() => true);
    const next = h && state.hexCellLists?.has(h) && canUse(h) ? h : null;
    if (next === state.focusColor) return;
    state.focusColor = next;
    state.deps?.markBlueprintLayerDirty?.();
    state.deps?.onBlueprintPaletteChange?.();
    state.deps?.scheduleRender?.();
  }

  function isFocusPaintMode() {
    return Boolean(state.active && state.active.visible !== false && state.focusColor && state.paintFilter);
  }

  function computeColorStats(cells) {
    if (!cells?.length) return null;
    return BC()?.analyzePalette(cells, 512) ?? null;
  }

  async function fetchFullBlueprint() {
    try {
      const res = await fetch('/api/blueprint', { credentials: 'include', cache: 'no-store' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'No se pudo cargar el plano');
      if (data.blueprint) {
        setActiveBlueprint(data.blueprint);
        state.deps?.scheduleRender?.();
        return true;
      }
      if (state.active?.cellCount > 0) {
        state.deps?.toast?.('El plano está dañado (sin píxeles guía). Descártalo y colócalo de nuevo.', true);
      }
    } catch (err) {
      state.deps?.toast?.(err.message || 'Error al cargar el plano', true);
    }
    return false;
  }

  function syncFromUser(user) {
    if (!user?.activeBlueprint) {
      state.active = null;
      state.activeCells = null;
      state.cellIndex = null;
      state.hexCellLists = null;
      state.colorStats = null;
      state.colorRemaining = null;
      state.focusColor = null;
      renderPanel();
      state.deps?.markBlueprintLayerDirty?.();
      state.deps?.onBlueprintPaletteChange?.();
      return;
    }
    const bp = user.activeBlueprint;
    if (bp.cells?.length || bp.cellsCompact) {
      state.active = bp;
      state.activeCells = null;
      renderPanel();
      setTimeout(() => setActiveBlueprint(bp), 50);
      return;
    }
    state.active = bp;
    fetchFullBlueprint();
    renderPanel();
  }

  function updateProgressUI(filled, total, errStats) {
    const pct = total ? Math.round((filled / total) * 100) : 0;
    const bar = document.getElementById('blueprint-progress-fill');
    const txt = document.getElementById('blueprint-progress-text');
    const err = errStats || state.progress;
    const errTotal = err?.errors ?? 0;
    if (bar) bar.style.width = `${pct}%`;
    if (txt) {
      let line = `${filled.toLocaleString()} / ${total.toLocaleString()} (${pct}%)`;
      if (errTotal > 0) line += ` · ${ERROR_EMOJI} ${errTotal} error${errTotal === 1 ? '' : 'es'}`;
      txt.textContent = line;
    }
    const floatBar = document.getElementById('blueprint-float-bar');
    if (floatBar && state.active?.visible !== false) {
      floatBar.hidden = false;
      const fillEl = floatBar.querySelector('.blueprint-float-bar__fill');
      if (fillEl) fillEl.style.width = `${pct}%`;
      const errHint = errTotal > 0 ? ` · ${ERROR_EMOJI}${errTotal}` : '';
      floatBar.querySelector('.blueprint-float-bar__label').textContent = `${pct}% · ${filled.toLocaleString()}/${total.toLocaleString()}${errHint}`;
      floatBar.classList.toggle('blueprint-float-bar--errors', errTotal > 0);
    } else if (floatBar) floatBar.hidden = true;
  }

  function invalidateErrors() {
    state.lastErrorScanAt = 0;
    state.errorScanGen += 1;
    state.deps?.markBlueprintLayerDirty?.();
    if (isFocusPaintMode()) {
      refreshColorRemainingCache(true);
    }
  }

  function forEachVisibleGuideCell(bp, cells, callback) {
    const bounds = getVisibleBounds();
    const pad = 2;
    const heavy = cells.length >= 40000;
    if (heavy && state.cellIndex) {
      const { lx0, ly0, lx1, ly1 } = getVisibleLocalRange(bp.originX, bp.originY, bp.width, bp.height, pad);
      for (let ly = ly0; ly < ly1; ly++) {
        for (let lx = lx0; lx < lx1; lx++) {
          const color = state.cellIndex.get(`${lx},${ly}`);
          if (color) callback(lx, ly, color);
        }
      }
      return;
    }
    for (const cell of cells) {
      const wx = bp.originX + cell.x;
      const wy = bp.originY + cell.y;
      if (bounds) {
        if (wx < bounds.x0 - pad || wx > bounds.x1 + pad || wy < bounds.y0 - pad || wy > bounds.y1 + pad) continue;
      }
      callback(cell.x, cell.y, cell.c);
    }
  }

  function collectBlueprintErrors(bp, cells, tol) {
    const getPx = state.deps?.getPixelColor;
    const forEachPx = state.deps?.forEachPixelInBounds;
    if (!getPx || !bp) return { errors: 0, wrongColor: 0, stray: 0, wrongCells: [], strayCells: [] };

    const wrongCells = [];
    const strayCells = [];
    const bounds = getVisibleBounds();
    const pad = 2;
    const heavy = cells.length >= 40000;
    const maxWrong = ERROR_DRAW_MAX * 3;
    let checked = 0;
    const maxChecks = heavy ? 12000 : 25000;

    forEachVisibleGuideCell(bp, cells, (lx, ly, expected) => {
      if (checked >= maxChecks) return;
      checked++;
      const wx = bp.originX + lx;
      const wy = bp.originY + ly;
      const got = getPx(wx, wy);
      if (!got) return;
      if (!colorsMatch(String(got).toUpperCase(), expected, tol)) {
        wrongCells.push({ x: wx, y: wy, kind: 'wrong', got, expected });
      }
    });

    if (heavy && checked >= maxChecks && cells.length > maxChecks) {
      let extra = 0;
      const start = state.errorScanCursor % Math.max(1, cells.length);
      for (let i = 0; i < cells.length && extra < 4000 && wrongCells.length < maxWrong; i++) {
        const cell = cells[(start + i) % cells.length];
        const wx = bp.originX + cell.x;
        const wy = bp.originY + cell.y;
        if (bounds) {
          if (wx < bounds.x0 - pad || wx > bounds.x1 + pad || wy < bounds.y0 - pad || wy > bounds.y1 + pad) continue;
        }
        const got = getPx(wx, wy);
        if (!got) continue;
        if (!colorsMatch(String(got).toUpperCase(), cell.c, tol)) {
          wrongCells.push({ x: wx, y: wy, kind: 'wrong', got, expected: cell.c });
          extra++;
        }
      }
      state.errorScanCursor = (start + extra) % Math.max(1, cells.length);
    }

    if (bp.markStray !== false && forEachPx && bounds) {
      const bx0 = Math.max(bp.originX, bounds.x0 - pad);
      const by0 = Math.max(bp.originY, bounds.y0 - pad);
      const bx1 = Math.min(bp.originX + bp.width, bounds.x1 + pad);
      const by1 = Math.min(bp.originY + bp.height, bounds.y1 + pad);
      forEachPx(bx0, by0, bx1, by1, (wx, wy) => {
        if (strayCells.length >= ERROR_DRAW_MAX) return;
        const lx = wx - bp.originX;
        const ly = wy - bp.originY;
        if (lx < 0 || ly < 0 || lx >= bp.width || ly >= bp.height) return;
        if (state.cellIndex?.has(`${lx},${ly}`)) return;
        strayCells.push({ x: wx, y: wy, kind: 'stray' });
      });
    }

    return {
      errors: wrongCells.length + strayCells.length,
      wrongColor: wrongCells.length,
      stray: strayCells.length,
      wrongCells,
      strayCells,
    };
  }

  function drawErrorMarker(ctx, dx, dy, s, kind) {
    ctx.fillStyle = kind === 'stray' ? ERROR_MARKER_ALT : ERROR_MARKER;
    ctx.globalAlpha = 0.88;
    ctx.fillRect(dx, dy, s, s);
    ctx.globalAlpha = 1;
    if (s >= 6) {
      ctx.strokeStyle = kind === 'stray' ? '#004444' : '#FFFF00';
      ctx.lineWidth = Math.max(1, Math.min(2, s * 0.2));
      ctx.strokeRect(dx + 0.5, dy + 0.5, Math.max(0, s - 1), Math.max(0, s - 1));
    }
  }

  function drawErrorMarkersBatched(ctx, items, scale, offsetX, offsetY, dpr, lod, kind, bounds, pad) {
    if (lod === 'far' || !items?.length) return;
    const s = Math.max(scale * dpr, 1);
    const max = lod === 'near' ? 400 : ERROR_DRAW_MAX;
    let n = 0;
    for (const err of items) {
      if (n >= max) break;
      if (bounds) {
        if (err.x < bounds.x0 - pad || err.x > bounds.x1 + pad || err.y < bounds.y0 - pad || err.y > bounds.y1 + pad) continue;
      }
      const dx = (err.x * scale + offsetX) * dpr;
      const dy = (err.y * scale + offsetY) * dpr;
      drawErrorMarker(ctx, dx, dy, s, kind);
      n++;
    }
  }

  function iterVisibleGuideCells(bp, cells, heavy, callback) {
    const pad = 2;
    const focus = state.focusColor && state.paintFilter ? String(state.focusColor).toUpperCase() : null;
    if (focus && state.hexCellLists?.has(focus)) {
      const list = state.hexCellLists.get(focus);
      const { lx0, ly0, lx1, ly1 } = getVisibleLocalRange(bp.originX, bp.originY, bp.width, bp.height, pad);
      for (const cell of list) {
        if (cell.x < lx0 || cell.x >= lx1 || cell.y < ly0 || cell.y >= ly1) continue;
        callback(cell.x, cell.y, focus);
      }
      return;
    }
    if (heavy && state.cellIndex) {
      const { lx0, ly0, lx1, ly1 } = getVisibleLocalRange(bp.originX, bp.originY, bp.width, bp.height, pad);
      for (let ly = ly0; ly < ly1; ly++) {
        for (let lx = lx0; lx < lx1; lx++) {
          const color = state.cellIndex.get(`${lx},${ly}`);
          if (color) callback(lx, ly, color);
        }
      }
      return;
    }
    const bounds = getVisibleBounds();
    for (const cell of cells) {
      const wx = bp.originX + cell.x;
      const wy = bp.originY + cell.y;
      if (bounds) {
        if (wx < bounds.x0 - pad || wx > bounds.x1 + pad || wy < bounds.y0 - pad || wy > bounds.y1 + pad) continue;
      }
      callback(cell.x, cell.y, cell.c);
    }
  }

  function updateProgressFromMap(force) {
    const bp = state.active;
    const cells = state.activeCells || resolveCells(bp);
    if (!bp || !cells.length) {
      state.progress = { filled: 0, total: cells.length, errors: 0, wrongColor: 0, stray: 0 };
      return;
    }
    const now = Date.now();
    const huge = cells.length > 80000;
    const heavy = cells.length >= 40000;
    const throttle = huge ? PROGRESS_THROTTLE_HUGE_MS : heavy ? PROGRESS_THROTTLE_HEAVY_MS : PROGRESS_THROTTLE_MS;
    if (!force && now - state.lastProgressAt < throttle) return;
    state.lastProgressAt = now;

    const tol = bp.tolerance ?? 28;
    const getPx = state.deps?.getPixelColor;
    if (!getPx) {
      updateProgressUI(0, cells.length, state.progress);
      return;
    }
    let filled = 0;
    const scanStep = huge ? Math.max(1, Math.floor(cells.length / 50000)) : (heavy ? Math.max(1, Math.floor(cells.length / 80000)) : 1);
    for (let i = 0; i < cells.length; i += scanStep) {
      const cell = cells[i];
      const got = getPx(bp.originX + cell.x, bp.originY + cell.y);
      if (got && colorsMatch(String(got).toUpperCase(), cell.c, tol)) filled++;
    }
    if (scanStep > 1 && filled > 0) {
      filled = Math.min(cells.length, Math.round(filled * scanStep));
    }
    const errStats = state.lastErrors || { errors: 0, wrongColor: 0, stray: 0 };
    state.progress = { filled, total: cells.length, errors: errStats.errors ?? 0, wrongColor: errStats.wrongColor ?? 0, stray: errStats.stray ?? 0 };
    updateProgressUI(filled, cells.length, errStats);
    refreshColorRemainingCache(force);
  }

  function getVisibleBounds() {
    return state.deps?.getVisibleBounds?.() || null;
  }

  function initPlacementFromView() {
    const c = state.deps?.getViewCenter?.();
    const d = state.draft;
    if (!c || !d) return;
    state.placement = {
      originX: Math.trunc(c.x - d.width / 2),
      originY: Math.trunc(c.y - d.height / 2),
    };
  }

  function getDraftOrigin() {
    if (!state.draft) return null;
    if (!state.placement) initPlacementFromView();
    return state.placement;
  }

  function pointInBlueprint(px, py, ox, oy, w, h) {
    return px >= ox && py >= oy && px < ox + w && py < oy + h;
  }

  function drawBoundsOutline(ctx, ox, oy, w, h, scale, offsetX, offsetY, dpr, color, dashed) {
    const rx = (ox * scale + offsetX) * dpr;
    const ry = (oy * scale + offsetY) * dpr;
    const rw = w * scale * dpr;
    const rh = h * scale * dpr;
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(1, 2 * dpr);
    if (dashed) ctx.setLineDash([6 * dpr, 4 * dpr]);
    ctx.strokeRect(rx + 0.5, ry + 0.5, Math.max(0, rw - 1), Math.max(0, rh - 1));
    ctx.restore();
  }

  function drawCellsAtOrigin(ctx, cells, originX, originY, width, height, scale, offsetX, offsetY, dpr, opts = {}, cellIndex = null, cacheKey = '') {
    const opacity = opts.opacity ?? 0.55;
    const bounds = getVisibleBounds();
    const pad = 2;
    const getPx = opts.getPixelColor;
    const tol = opts.tolerance ?? 28;
    const hideDone = opts.hideCompleted === true;
    const screenPx = scale * dpr;
    const heavy = cells.length >= 40000;
    const useRaster = heavy && screenPx < 24 && !opts.checkDone;
    const raster = useRaster ? getRasterCache(cells, width, height, cacheKey) : null;

    if (raster) {
      const wx0 = originX;
      const wy0 = originY;
      const dx = (wx0 * scale + offsetX) * dpr;
      const dy = (wy0 * scale + offsetY) * dpr;
      const dw = width * scale * dpr;
      const dh = height * scale * dpr;
      ctx.save();
      ctx.globalAlpha = opacity * 0.88;
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(raster.canvas, dx, dy, dw, dh);
      ctx.restore();
      return;
    }

    const showGrid = opts.showGrid !== false && screenPx >= GRID_MIN_SCREEN_PX && screenPx < GRID_MAX_SCREEN_PX && cells.length < 120000;
    const index = cellIndex || (heavy ? buildCellIndex(cells) : null);
    const drawCell = (lx, ly, color) => {
      const wx = originX + lx;
      const wy = originY + ly;
      if (bounds) {
        if (wx < bounds.x0 - pad || wx > bounds.x1 + pad || wy < bounds.y0 - pad || wy > bounds.y1 + pad) return;
      }
      const got = getPx?.(wx, wy);
      const done = opts.checkDone && got && colorsMatch(String(got).toUpperCase(), color, tol);
      if (hideDone && done) return;
      const dx = (wx * scale + offsetX) * dpr;
      const dy = (wy * scale + offsetY) * dpr;
      const s = Math.max(screenPx, 1);
      const [r, g, b] = hexToRgb(color);
      ctx.fillStyle = done
        ? `rgba(${r},${g},${b},${opacity * 0.25})`
        : `rgba(${r},${g},${b},${opacity * 0.88})`;
      ctx.fillRect(dx, dy, s, s);
      if (showGrid && !done) {
        ctx.strokeStyle = 'rgba(255,255,255,0.12)';
        ctx.lineWidth = 1;
        ctx.strokeRect(dx + 0.5, dy + 0.5, Math.max(0, s - 1), Math.max(0, s - 1));
      }
    };

    if (index && heavy) {
      const { lx0, ly0, lx1, ly1 } = getVisibleLocalRange(originX, originY, width, height, pad);
      for (let ly = ly0; ly < ly1; ly++) {
        for (let lx = lx0; lx < lx1; lx++) {
          const color = index.get(`${lx},${ly}`);
          if (color) drawCell(lx, ly, color);
        }
      }
      return;
    }

    for (const cell of cells) {
      drawCell(cell.x, cell.y, cell.c);
    }
  }

  function drawDraftOverlay(ctx, scale, offsetX, offsetY, dpr) {
    const draft = state.draft;
    const pl = getDraftOrigin();
    if (!draft?.cells?.length || !pl) return;
    drawCellsAtOrigin(ctx, draft.cells, pl.originX, pl.originY, draft.width, draft.height, scale, offsetX, offsetY, dpr, {
      opacity: draft.opacity ?? 0.45,
      showGrid: draft.showGrid && draft.cells.length < 120000,
      hideCompleted: false,
      checkDone: false,
    }, null, 'draft');
    drawBoundsOutline(
      ctx, pl.originX, pl.originY, draft.width, draft.height,
      scale, offsetX, offsetY, dpr, 'rgba(6, 255, 165, 0.85)', true,
    );
  }

  function handlePointerDown(worldX, worldY) {
    const wx = Math.trunc(worldX);
    const wy = Math.trunc(worldY);

    if (state.draft?.cells?.length) {
      const pl = getDraftOrigin();
      if (pl && pointInBlueprint(wx, wy, pl.originX, pl.originY, state.draft.width, state.draft.height)) {
        state.drag = { kind: 'draft', grabDx: wx - pl.originX, grabDy: wy - pl.originY };
        return true;
      }
    }

    const bp = state.active;
    if (bp && state.moveMode && pointInBlueprint(wx, wy, bp.originX, bp.originY, bp.width, bp.height)) {
      state.drag = {
        kind: 'active',
        grabDx: wx - bp.originX,
        grabDy: wy - bp.originY,
        originX: bp.originX,
        originY: bp.originY,
      };
      return true;
    }
    return false;
  }

  function handlePointerMove(worldX, worldY) {
    if (!state.drag) return false;
    const wx = Math.trunc(worldX);
    const wy = Math.trunc(worldY);
    if (state.drag.kind === 'draft' && state.draft) {
      state.placement = {
        originX: wx - state.drag.grabDx,
        originY: wy - state.drag.grabDy,
      };
      state.deps?.scheduleRender?.();
      return true;
    }
    if (state.drag.kind === 'active' && state.active) {
      state.active.originX = wx - state.drag.grabDx;
      state.active.originY = wy - state.drag.grabDy;
      state.deps?.scheduleRender?.();
      return true;
    }
    return false;
  }

  async function handlePointerUp() {
    if (!state.drag) return false;
    const kind = state.drag.kind;
    state.drag = null;
    if (kind === 'active' && state.active) {
      try {
        await relocateAt(state.active.originX, state.active.originY);
      } catch (err) {
        state.deps?.toast?.(err.message, true);
      }
      return true;
    }
    return kind === 'draft';
  }

  function isDragging() {
    return Boolean(state.drag);
  }

  function shouldBlockPaint() {
    return Boolean(state.drag);
  }

  function setMoveMode(on) {
    state.moveMode = Boolean(on);
    state.deps?.markBlueprintLayerDirty?.();
    state.deps?.onMoveModeChange?.(state.moveMode);
  }

  function getLayerKey() {
    const bp = state.active;
    if (!bp) return '';
    return [
      bp.id || '',
      bp.originX,
      bp.originY,
      bp.visible,
      bp.opacity,
      bp.showGrid,
      bp.hideCompleted,
      bp.showErrors,
      state.focusColor,
      state.paintFilter,
      state.moveMode,
      state.activeCells?.length || 0,
      state.errorScanGen,
    ].join('|');
  }

  function drawOverlay(ctx, scale, offsetX, offsetY, dpr) {
    const bp = state.active;
    const cells = state.activeCells;
    if (!bp || bp.visible === false || !cells?.length) return;

    const panFast = state.deps?.isPanning?.() === true;
    const opacity = bp.opacity ?? 0.55;
    const screenPx = scale * dpr;
    const lod = getRenderLod(screenPx);
    const tol = bp.tolerance ?? 28;
    const getPx = state.deps?.getPixelColor;
    const bounds = getVisibleBounds();
    const pad = 2;
    const heavy = cells.length >= 40000;
    const focusMode = Boolean(state.focusColor && state.paintFilter);
    const hideDone = focusMode || (!panFast && bp.hideCompleted !== false);
    const needPxCheck = focusMode || (!panFast && (hideDone || (bp.showErrors !== false && lod !== 'far')));
    const useRaster = !focusMode && heavy
      && (panFast || screenPx < 20)
      && (panFast || bp.showErrors === false || lod === 'far');

    const canDrawErrors = !focusMode && bp.showErrors !== false && lod !== 'far';
    if (!panFast && canDrawErrors) {
      const now = Date.now();
      const scanMs = heavy ? ERROR_SCAN_THROTTLE_MS : 280;
      const lodChanged = state.lastErrorLod !== lod;
      if (lodChanged || now - state.lastErrorScanAt >= scanMs || state.lastErrorScanAt === 0) {
        state.lastErrors = collectBlueprintErrors(bp, cells, tol);
        state.lastErrorScanAt = now;
        state.lastErrorLod = lod;
        state.errorScanGen += 1;
        state.deps?.markBlueprintLayerDirty?.();
      }
    } else if (bp.showErrors === false) {
      state.lastErrors = { errors: 0, wrongColor: 0, stray: 0, wrongCells: [], strayCells: [] };
    }

    if (useRaster) {
      drawCellsAtOrigin(ctx, cells, bp.originX, bp.originY, bp.width, bp.height, scale, offsetX, offsetY, dpr, {
        opacity,
        showGrid: false,
        hideCompleted: hideDone,
        checkDone: false,
      }, state.cellIndex, `active:${bp.id || ''}`);
    } else {
      const showGrid = bp.showGrid !== false && lod === 'close'
        && screenPx >= GRID_MIN_SCREEN_PX && screenPx < GRID_MAX_SCREEN_PX
        && cells.length < 120000 && !focusMode;
      iterVisibleGuideCells(bp, cells, heavy, (lx, ly, color) => {
        const wx = bp.originX + lx;
        const wy = bp.originY + ly;
        if (focusMode && getPx) {
          const got = getPx(wx, wy);
          if (got && colorsMatch(String(got).toUpperCase(), color, tol)) return;
        } else if (needPxCheck && getPx) {
          const got = getPx(wx, wy);
          const done = got && colorsMatch(String(got).toUpperCase(), color, tol);
          if (hideDone && done) return;
        }
        const dx = (wx * scale + offsetX) * dpr;
        const dy = (wy * scale + offsetY) * dpr;
        const s = Math.max(screenPx, 1);
        const [r, g, b] = hexToRgb(color);
        const alpha = focusMode ? 0.96 : (hideDone ? 0.88 : 0.88);
        ctx.fillStyle = `rgba(${r},${g},${b},${opacity * alpha})`;
        ctx.fillRect(dx, dy, s, s);
        if (showGrid && !focusMode) {
          ctx.strokeStyle = 'rgba(255,255,255,0.12)';
          ctx.lineWidth = 1;
          ctx.strokeRect(dx + 0.5, dy + 0.5, Math.max(0, s - 1), Math.max(0, s - 1));
        }
      });
    }

    if (!panFast && canDrawErrors && state.lastErrors) {
      drawErrorMarkersBatched(
        ctx, state.lastErrors.wrongCells, scale, offsetX, offsetY, dpr, lod, 'wrong', bounds, pad,
      );
      drawErrorMarkersBatched(
        ctx, state.lastErrors.strayCells, scale, offsetX, offsetY, dpr, lod, 'stray', bounds, pad,
      );
    }

    if (state.moveMode) {
      drawBoundsOutline(
        ctx, bp.originX, bp.originY, bp.width, bp.height,
        scale, offsetX, offsetY, dpr, 'rgba(6, 255, 165, 0.9)', true,
      );
    } else if (bounds) {
      const bx0 = Math.max(bp.originX, bounds.x0 - pad);
      const by0 = Math.max(bp.originY, bounds.y0 - pad);
      const bx1 = Math.min(bp.originX + bp.width, bounds.x1 + pad);
      const by1 = Math.min(bp.originY + bp.height, bounds.y1 + pad);
      if (bx1 > bx0 && by1 > by0) {
        drawBoundsOutline(ctx, bx0, by0, bx1 - bx0, by1 - by0, scale, offsetX, offsetY, dpr, 'rgba(255, 190, 11, 0.75)', false);
      }
    }
  }

  async function activateAt(originX, originY) {
    if (!state.draft?.cells?.length) throw new Error('Genera la vista previa primero');
    const user = state.deps?.getUser?.();
    if (!user) throw new Error('Inicia sesión con Discord');
    if ((user.inventory?.pixel_blueprint || 0) < 1) {
      throw new Error('Necesitas un Plano píxel (Tienda → Pintura)');
    }
    const cost = state.draft.quote?.cost ?? computeCost(state.draft.width, state.draft.height, state.draft.cellCount, state.draft.colorCount);
    if ((user.coins || 0) < cost) throw new Error(`Monedas insuficientes (necesitas ${cost.toLocaleString()}🪙)`);

    const res = await fetch('/api/blueprint/activate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        width: state.draft.width,
        height: state.draft.height,
        originX: Math.trunc(originX),
        originY: Math.trunc(originY),
        cellsCompact: await encodeCellsCompactAsync(state.draft.cells),
        colorMode: state.draft.colorMode,
        tolerance: state.draft.tolerance,
        showGrid: state.draft.showGrid,
        hideCompleted: state.draft.hideCompleted,
        opacity: state.draft.opacity,
        fitMode: state.draft.fitMode,
        name: state.draft.name,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'No se pudo activar');
    state.draft = null;
    state.loadedImage = null;
    state.placement = null;
    setMoveMode(false);
    setActiveBlueprint(data.blueprint);
    state.deps?.onUserUpdate?.(data.user);
    state.deps?.onWallet?.({ coins: data.coins });
    state.deps?.scheduleRender?.();
    renderPanel();
    return data;
  }

  async function updateSettings(body) {
    const res = await fetch('/api/blueprint/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error');
    setActiveBlueprint(data.blueprint);
    state.deps?.scheduleRender?.();
    renderPanel();
  }

  async function toggleVisible() {
    const res = await fetch('/api/blueprint/toggle', { method: 'POST', credentials: 'include' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error');
    setActiveBlueprint(data.blueprint);
    state.deps?.scheduleRender?.();
    renderPanel();
  }

  async function relocateAt(originX, originY) {
    const bp = state.active;
    if (!bp) return;
    const res = await fetch('/api/blueprint/relocate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        originX: Math.trunc(originX),
        originY: Math.trunc(originY),
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error');
    setActiveBlueprint(data.blueprint);
    state.deps?.scheduleRender?.();
    renderPanel();
  }

  async function relocate() {
    const c = state.deps?.getViewCenter?.();
    const bp = state.active;
    if (!c || !bp) return;
    await relocateAt(Math.trunc(c.x - bp.width / 2), Math.trunc(c.y - bp.height / 2));
  }

  async function cancelBlueprint() {
    const res = await fetch('/api/blueprint/cancel', { method: 'POST', credentials: 'include' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error');
    state.active = null;
    state.activeCells = null;
    state.cellIndex = null;
    state.draft = null;
    state.placement = null;
    setMoveMode(false);
    state.deps?.onUserUpdate?.(data.user);
    state.deps?.scheduleRender?.();
    renderPanel();
  }

  function formatCost(w, h, cellCount = 0, colorCount = 0) {
    return costBreakdownText(w, h, cellCount, colorCount);
  }

  function colorSwatchesHtml(stats) {
    if (!stats?.swatches?.length) return '';
    return `<div class="blueprint-colors">${stats.swatches.map((s) =>
      `<span class="blueprint-color-swatch" style="background:${s.hex}" title="${s.hex} · ${s.count.toLocaleString()} px"></span>`,
    ).join('')}<span class="panel-desc panel-desc--tiny">${stats.unique} colores</span></div>`;
  }

  function presetButtonsHtml() {
    return state.config.presetSizes.map((s) =>
      `<button type="button" class="btn btn--xs btn--ghost blueprint-preset" data-preset="${s}">${s}</button>`,
    ).join('');
  }

  function renderPanel() {
    const root = document.getElementById('blueprint-panel');
    if (!root) return;
    const user = state.deps?.getUser?.();
    const tokens = user?.inventory?.pixel_blueprint || 0;
    const draft = state.draft;
    const active = state.active;
    const maxSide = state.config.maxSide || 20000;

    if (state.sampling) {
      root.innerHTML = `
        <p class="panel-desc">Convirtiendo imagen…</p>
        <div class="blueprint-progress__track"><div class="blueprint-progress__fill" id="blueprint-sample-bar" style="width:${Math.round(state.sampleProgress * 100)}%"></div></div>
        <p class="blueprint-progress__text" id="blueprint-sample-text">Procesando… ${Math.round(state.sampleProgress * 100)}%</p>`;
      return;
    }

    root.innerHTML = `
      <p class="panel-desc">Sube una imagen → detectamos <strong>píxeles y colores</strong>. Pagas por lo que realmente se pinta, no por el área vacía.</p>
      <p class="blueprint-stock">Tokens: <strong>${tokens}</strong> · <a href="#" id="blueprint-shop-link">Tienda</a></p>

      ${active ? `
        <div class="blueprint-active">
          <div class="blueprint-active__head">
            <strong>${active.name ? escapeHtml(active.name) : 'Plano activo'}</strong>
            <span class="blueprint-active__size">${active.width.toLocaleString()}×${active.height.toLocaleString()}</span>
          </div>
          <div class="blueprint-progress">
            <div class="blueprint-progress__track"><div class="blueprint-progress__fill" id="blueprint-progress-fill"></div></div>
            <p class="blueprint-progress__text" id="blueprint-progress-text">—</p>
          </div>
          <p class="panel-desc panel-desc--tiny">Origen (${active.originX}, ${active.originY}) · ${(state.activeCells?.length || active.cellCount || 0).toLocaleString()} píxeles guía</p>
          ${!(state.activeCells?.length || active.cellCount) ? `
            <p class="panel-desc blueprint-empty-warn">⚠ La guía no tiene píxeles cargados. Pulsa «Descartar» y vuelve a colocar el plano desde una imagen.</p>
          ` : (state.activeCells?.length || 0) === 0 && (active.cellCount || 0) > 0 ? `
            <p class="panel-desc blueprint-empty-warn">⚠ Cargando guía… Si no aparece, descarta y coloca el plano otra vez.</p>
          ` : ''}
          <label class="field">
            <span>Tolerancia</span>
            <input type="range" id="bp-set-tol" min="0" max="80" value="${active.tolerance ?? 28}" />
          </label>
          <label class="field">
            <span>Opacidad</span>
            <input type="range" id="bp-set-opacity" min="15" max="92" value="${Math.round((active.opacity ?? 0.55) * 100)}" />
          </label>
          <label class="field field--check"><input type="checkbox" id="bp-set-grid" ${active.showGrid !== false ? 'checked' : ''} /> Rejilla</label>
          <label class="field field--check"><input type="checkbox" id="bp-set-hide" ${active.hideCompleted !== false ? 'checked' : ''} /> Ocultar celdas completadas</label>
          <label class="field field--check"><input type="checkbox" id="bp-set-errors" ${active.showErrors !== false ? 'checked' : ''} /> Marcar errores ${ERROR_EMOJI} (color fuera de paleta)</label>
          <label class="field field--check"><input type="checkbox" id="bp-set-stray" ${active.markStray !== false ? 'checked' : ''} /> Marcar píxeles de más ${STRAY_EMOJI}</label>
          <p class="panel-desc panel-desc--tiny blueprint-error-hint">Errores: magenta ${ERROR_MARKER} · de más: cian ${ERROR_MARKER_ALT} · no son colores de la paleta</p>
          <div class="blueprint-paint-section">
            <h3 class="blueprint-paint-section__title">Colores del plano</h3>
            <p class="panel-desc panel-desc--tiny">🔒 = precio actual · ↗ = precio futuro (sube con cada color comprado)</p>
            <div id="blueprint-paint-palette" class="blueprint-paint-palette"></div>
          </div>
          <div class="blueprint-actions">
            <button type="button" class="btn btn--sm btn--accent" id="blueprint-toggle">${active.visible !== false ? '👁 Ocultar' : '👁 Mostrar'}</button>
            <button type="button" class="btn btn--sm ${state.moveMode ? 'btn--accent' : 'btn--ghost'}" id="blueprint-move-toggle">🖐 Mover</button>
            <button type="button" class="btn btn--sm btn--ghost" id="blueprint-relocate">📍 Centrar aquí</button>
            <button type="button" class="btn btn--sm btn--ghost" id="blueprint-goto">🎯 Ir al plano</button>
            <button type="button" class="btn btn--sm btn--ghost blueprint-cancel" id="blueprint-cancel">✕ Descartar</button>
          </div>
          <p class="panel-desc panel-desc--tiny">${state.moveMode ? 'Modo mover: arrastra el plano en el mapa.' : 'Pulsa «Mover» y arrastra el plano donde quieras.'}</p>
        </div>
      ` : `
        <label class="field blueprint-upload">
          <span>Imagen (máx. ${MAX_FILE_MB} MB)</span>
          <input type="file" id="blueprint-file" accept="image/png,image/jpeg,image/webp,image/gif" />
        </label>
        <label class="field"><span>Nombre (opcional)</span><input type="text" id="blueprint-name" maxlength="48" placeholder="Mi pixel art" /></label>
        <div class="blueprint-presets">${presetButtonsHtml()}</div>
        <div class="blueprint-size-row">
          <label class="field field--inline">
            <span>Ancho</span>
            <input type="number" id="blueprint-width" min="1" max="${maxSide}" value="64" />
          </label>
          <label class="field field--inline">
            <span>Alto</span>
            <input type="number" id="blueprint-height" min="1" max="${maxSide}" value="64" />
          </label>
        </div>
        <label class="field field--check">
          <input type="checkbox" id="blueprint-lock-aspect" ${state.ui.lockAspect ? 'checked' : ''} />
          <span>Bloquear proporción</span>
        </label>
        <label class="field field--inline">
          <span>Ajuste</span>
          <select id="blueprint-fit">
            <option value="stretch">Estirar</option>
            <option value="contain">Contener (letterbox)</option>
            <option value="cover">Recortar (cover)</option>
          </select>
        </label>
        <label class="field field--inline">
          <span>Colores</span>
          <select id="blueprint-color-mode">
            <option value="exact">Exactos (Lab)</option>
            <option value="palette">Mi paleta</option>
            <option value="quantize">Reducir paleta</option>
          </select>
        </label>
        <label class="field field--inline">
          <span>Fondo transparente</span>
          <select id="blueprint-bg">
            <option value="">Ignorar</option>
            <option value="#000000">Negro</option>
            <option value="#FFFFFF">Blanco</option>
          </select>
        </label>
        <label class="field field--inline">
          <span>Máx. colores</span>
          <select id="blueprint-max-colors">
            <option value="0">Sin límite</option>
            <option value="8">8</option>
            <option value="16">16</option>
            <option value="32">32</option>
            <option value="64">64</option>
            <option value="128">128</option>
          </select>
        </label>
        <label class="field">
          <span>Tolerancia al pintar (ΔE perceptual)</span>
          <input type="range" id="blueprint-tolerance" min="0" max="80" value="28" />
        </label>
        <label class="field field--check"><input type="checkbox" id="blueprint-merge" checked /> Fusionar colores similares</label>
        <label class="field field--check"><input type="checkbox" id="blueprint-grid" checked /> Rejilla en guía</label>
        <label class="field field--check"><input type="checkbox" id="blueprint-hide-done" checked /> Ocultar completados</label>
        <label class="field"><span>Opacidad</span><input type="range" id="blueprint-opacity" min="15" max="92" value="55" /></label>
        <p class="blueprint-cost" id="blueprint-cost">${formatCost(64, 64)}</p>
        <div class="blueprint-preview-wrap" id="blueprint-preview-wrap" hidden>
          <img id="blueprint-preview-img" alt="Vista previa" />
          <p class="panel-desc panel-desc--tiny" id="blueprint-cell-count"></p>
          <div id="blueprint-color-swatches"></div>
        </div>
        <div class="blueprint-actions">
          <button type="button" class="btn btn--ghost btn--sm" id="blueprint-resample" disabled>Volver a generar</button>
          <button type="button" class="btn btn--accent" id="blueprint-activate" disabled>Colocar guía</button>
        </div>
        <p class="panel-desc panel-desc--tiny blueprint-placement-hint" id="blueprint-placement-hint" hidden>Arrastra la vista previa verde en el mapa para elegir posición.</p>
      `}
    `;

    root.querySelector('#blueprint-shop-link')?.addEventListener('click', (e) => {
      e.preventDefault();
      state.deps?.openShop?.('dibujo');
    });

    if (active) {
      updateProgressFromMap(true);
      root.querySelector('#blueprint-toggle')?.addEventListener('click', () => toggleVisible().catch((e) => state.deps?.toast?.(e.message, true)));
      root.querySelector('#blueprint-move-toggle')?.addEventListener('click', () => {
        setMoveMode(!state.moveMode);
        renderPanel();
        state.deps?.toast?.(state.moveMode ? 'Modo mover activo — arrastra el plano' : 'Modo mover desactivado');
      });
      root.querySelector('#blueprint-relocate')?.addEventListener('click', () => relocate().catch((e) => state.deps?.toast?.(e.message, true)));
      root.querySelector('#blueprint-goto')?.addEventListener('click', () => {
        state.deps?.goToBlueprint?.(active.originX + active.width / 2, active.originY + active.height / 2);
      });
      root.querySelector('#blueprint-cancel')?.addEventListener('click', () => {
        if (confirm('¿Descartar plano? No recuperas el token.')) {
          cancelBlueprint().catch((e) => state.deps?.toast?.(e.message, true));
        }
      });
      const applySettings = () => updateSettings({
        tolerance: Number(root.querySelector('#bp-set-tol')?.value),
        opacity: Number(root.querySelector('#bp-set-opacity')?.value) / 100,
        showGrid: root.querySelector('#bp-set-grid')?.checked,
        hideCompleted: root.querySelector('#bp-set-hide')?.checked,
        showErrors: root.querySelector('#bp-set-errors')?.checked,
        markStray: root.querySelector('#bp-set-stray')?.checked,
      }).catch((e) => state.deps?.toast?.(e.message, true));
      root.querySelector('#bp-set-tol')?.addEventListener('change', applySettings);
      root.querySelector('#bp-set-opacity')?.addEventListener('change', applySettings);
      root.querySelector('#bp-set-grid')?.addEventListener('change', applySettings);
      root.querySelector('#bp-set-hide')?.addEventListener('change', applySettings);
      root.querySelector('#bp-set-errors')?.addEventListener('change', applySettings);
      root.querySelector('#bp-set-stray')?.addEventListener('change', applySettings);
      state.deps?.renderBlueprintPalette?.();
      return;
    }

    const wIn = root.querySelector('#blueprint-width');
    const hIn = root.querySelector('#blueprint-height');
    const lockAsp = root.querySelector('#blueprint-lock-aspect');
    const costEl = root.querySelector('#blueprint-cost');
    const activateBtn = root.querySelector('#blueprint-activate');
    const resampleBtn = root.querySelector('#blueprint-resample');
    const previewWrap = root.querySelector('#blueprint-preview-wrap');
    const previewImg = root.querySelector('#blueprint-preview-img');
    const cellCountEl = root.querySelector('#blueprint-cell-count');

    function syncCost() {
      const w = clampSide(wIn?.value);
      const h = clampSide(hIn?.value);
      const draft = state.draft;
      if (draft?.cellCount) {
        if (costEl) {
          costEl.textContent = draft.quote?.breakdown
            ? `${draft.quote.cost.toLocaleString()} 🪙 · ${draft.cellCount.toLocaleString()} px · ${draft.colorCount} colores + 1 token`
            : costBreakdownText(w, h, draft.cellCount, draft.colorCount);
        }
      } else if (costEl) costEl.textContent = formatCost(w, h);
    }

    function readSampleOpts() {
      const colorMode = root.querySelector('#blueprint-color-mode')?.value || 'exact';
      const palette = (colorMode === 'palette') ? state.deps?.getPalette?.() : null;
      const maxColors = colorMode === 'quantize'
        ? Number(root.querySelector('#blueprint-max-colors')?.value) || 16
        : (Number(root.querySelector('#blueprint-max-colors')?.value) || 0);
      const bg = root.querySelector('#blueprint-bg')?.value || null;
      return {
        palette,
        snapPalette: colorMode === 'palette',
        colorMode,
        tolerance: Number(root.querySelector('#blueprint-tolerance')?.value),
        showGrid: root.querySelector('#blueprint-grid')?.checked,
        hideCompleted: root.querySelector('#blueprint-hide-done')?.checked,
        opacity: Number(root.querySelector('#blueprint-opacity')?.value) / 100,
        fitMode: root.querySelector('#blueprint-fit')?.value || 'stretch',
        maxColors: colorMode === 'quantize' ? maxColors : (Number(root.querySelector('#blueprint-max-colors')?.value) || 0),
        mergeSimilar: root.querySelector('#blueprint-merge')?.checked !== false,
        bgColor: bg || undefined,
        skipTransparent: !bg,
        name: root.querySelector('#blueprint-name')?.value?.trim() || '',
      };
    }

    function onWidthChange() {
      let w = clampSide(wIn.value);
      wIn.value = w;
      if (lockAsp?.checked && state.ui.aspect) {
        hIn.value = clampSide(Math.round(w / state.ui.aspect));
      }
      syncCost();
    }

    function onHeightChange() {
      let h = clampSide(hIn.value);
      hIn.value = h;
      if (lockAsp?.checked && state.ui.aspect) {
        wIn.value = clampSide(Math.round(h * state.ui.aspect));
      }
      syncCost();
    }

    wIn?.addEventListener('input', onWidthChange);
    hIn?.addEventListener('input', onHeightChange);
    lockAsp?.addEventListener('change', () => { state.ui.lockAspect = lockAsp.checked; });

    root.querySelectorAll('.blueprint-preset').forEach((btn) => {
      btn.addEventListener('click', () => {
        const s = Number(btn.dataset.preset);
        wIn.value = s;
        hIn.value = s;
        syncCost();
      });
    });

    async function runSample() {
      if (!state.loadedImage) return;
      const opts = readSampleOpts();
      const w = clampSide(wIn.value);
      const h = clampSide(hIn.value);
      try {
        await buildDraftFromImage(state.loadedImage, w, h, opts);
        if (previewWrap) previewWrap.hidden = false;
        if (previewImg && state.draft) previewImg.src = state.draft.previewUrl;
        if (cellCountEl && state.draft) {
          cellCountEl.textContent = `${state.draft.cellCount.toLocaleString()} píxeles · ${state.draft.colorCount} colores únicos detectados`;
        }
        const swEl = root.querySelector('#blueprint-color-swatches');
        if (swEl && state.draft?.colorStats) {
          swEl.innerHTML = colorSwatchesHtml(state.draft.colorStats);
        }
        syncCost();
        initPlacementFromView();
        const hint = document.getElementById('blueprint-placement-hint');
        if (hint) hint.hidden = false;
        state.deps?.scheduleRender?.();
        const user = state.deps?.getUser?.();
        const cost = state.draft.quote?.cost ?? computeCost(w, h, state.draft.cellCount, state.draft.colorCount);
        if (activateBtn) activateBtn.disabled = (user?.inventory?.pixel_blueprint || 0) < 1
          || (user?.coins ?? 0) < cost;
        if (resampleBtn) resampleBtn.disabled = false;
      } catch (err) {
        state.deps?.toast?.(err.message, true);
      }
    }

    root.querySelector('#blueprint-file')?.addEventListener('change', async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      try {
        state.loadedImage = await loadImageFile(file);
        state.ui.aspect = (state.loadedImage.naturalWidth || 1) / (state.loadedImage.naturalHeight || 1);
        await runSample();
        state.deps?.toast?.('Vista previa generada');
      } catch (err) {
        state.deps?.toast?.(err.message, true);
      }
    });

    resampleBtn?.addEventListener('click', () => runSample().catch((err) => state.deps?.toast?.(err.message, true)));
    activateBtn?.addEventListener('click', async () => {
      try {
        const pl = getDraftOrigin();
        if (!pl || !state.draft) throw new Error('Genera la vista previa y colócala en el mapa');
        await activateAt(pl.originX, pl.originY);
        state.deps?.toast?.('Plano colocado');
      } catch (err) {
        state.deps?.toast?.(err.message, true);
      }
    });

    syncCost();
    if (draft?.previewUrl) {
      previewWrap.hidden = false;
      previewImg.src = draft.previewUrl;
      activateBtn.disabled = tokens < 1;
      resampleBtn.disabled = false;
    }
  }

  function escapeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function init(deps, config) {
    state.deps = deps;
    if (config) state.config = { ...state.config, ...config };
    const user = deps?.getUser?.();
    if (user) syncFromUser(user);
    else renderPanel();
  }

  window.PixelBlueprint = {
    init,
    syncFromUser,
    updateProgressFromMap,
    drawOverlay,
    drawDraftOverlay,
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
    isDragging,
    shouldBlockPaint,
    setMoveMode,
    isMoveMode: () => state.moveMode,
    computeCost,
    getActive: () => state.active,
    getDraft: () => state.draft,
    getBlueprintPaletteInfo,
    setFocusColor,
    syncFocusFromSelectedColor,
    getFocusColor: () => state.focusColor,
    isFocusPaintMode,
    getLayerKey,
    invalidateErrors,
    onPixelPlaced: invalidateErrors,
    renderBlueprintPalette: () => state.deps?.renderBlueprintPalette?.(),
    renderPanel,
    fetchFullBlueprint,
  };
})();
