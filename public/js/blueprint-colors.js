/** Utilidades de color para plano píxel (cliente) — distancia perceptual Lab */
(function () {
  'use strict';

  function hexToRgb(hex) {
    const h = String(hex).replace('#', '');
    if (h.length !== 6) return [0, 0, 0];
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }

  function rgbToHex(r, g, b) {
    return `#${[r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')}`.toUpperCase();
  }

  function srgbToLinear(c) {
    const v = c / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  }

  function rgbToLab(r, g, b) {
    let R = srgbToLinear(r);
    let G = srgbToLinear(g);
    let B = srgbToLinear(b);
    let X = (0.4124564 * R + 0.3575761 * G + 0.1804375 * B) / 0.95047;
    let Y = (0.2126729 * R + 0.7151522 * G + 0.0721750 * B) / 1.0;
    let Z = (0.0193339 * R + 0.1191920 * G + 0.9503041 * B) / 1.08883;
    const f = (t) => (t > 0.008856 ? t ** (1 / 3) : (7.787 * t) + (16 / 116));
    X = f(X);
    Y = f(Y);
    Z = f(Z);
    return {
      L: (116 * Y) - 16,
      a: 500 * (X - Y),
      b: 200 * (Y - Z),
    };
  }

  function hexToLab(hex) {
    const [r, g, b] = hexToRgb(hex);
    return rgbToLab(r, g, b);
  }

  function deltaE76(lab1, lab2) {
    const dL = lab1.L - lab2.L;
    const da = lab1.a - lab2.a;
    const db = lab1.b - lab2.b;
    return Math.sqrt(dL * dL + da * da + db * db);
  }

  function colorDistance(a, b) {
    return deltaE76(hexToLab(a), hexToLab(b));
  }

  /** Tolerancia UI 0–80 → ΔE máx. ~0–36 */
  function toleranceToDeltaE(tol) {
    return Math.max(0, Number(tol) || 0) * 0.45;
  }

  function colorsMatch(a, b, tolerance) {
    return colorDistance(a, b) <= toleranceToDeltaE(tolerance);
  }

  function denoiseRgb(r, g, b, bits = 4) {
    const shift = 8 - bits;
    return [
      (r >> shift) << shift,
      (g >> shift) << shift,
      (b >> shift) << shift,
    ];
  }

  function blendWithBg(r, g, b, a, bgHex) {
    if (a >= 250) return [r, g, b];
    const alpha = a / 255;
    const [br, bg, bb] = hexToRgb(bgHex || '#000000');
    return [
      r * alpha + br * (1 - alpha),
      g * alpha + bg * (1 - alpha),
      b * alpha + bb * (1 - alpha),
    ];
  }

  function snapToPalette(hex, palette) {
    const up = String(hex).toUpperCase();
    if (!palette?.length) return up;
    if (palette.includes(up)) return up;
    let best = palette[0];
    let bestD = Infinity;
    const target = hexToLab(up);
    for (const c of palette) {
      const d = deltaE76(target, hexToLab(c));
      if (d < bestD) { bestD = d; best = c; }
    }
    return best;
  }

  function countUnique(cells) {
    const set = new Set();
    for (const c of cells) set.add(String(c.c).toUpperCase());
    return set.size;
  }

  function analyzePalette(cells, maxSwatches = 24) {
    const freq = new Map();
    for (const c of cells) {
      const col = String(c.c).toUpperCase();
      freq.set(col, (freq.get(col) || 0) + 1);
    }
    const sorted = [...freq.entries()].sort((a, b) => b[1] - a[1]);
    return {
      unique: sorted.length,
      swatches: sorted.slice(0, maxSwatches).map(([hex, count]) => ({ hex, count })),
    };
  }

  function mergeSimilarColors(cells, maxDeltaE = 5) {
    if (!cells.length) return cells;
    const centroids = [];
    const map = new Map();

    for (const cell of cells) {
      const hex = String(cell.c).toUpperCase();
      let merged = false;
      for (const cen of centroids) {
        if (deltaE76(hexToLab(hex), hexToLab(cen)) <= maxDeltaE) {
          map.set(hex, cen);
          merged = true;
          break;
        }
      }
      if (!merged) {
        centroids.push(hex);
        map.set(hex, hex);
      }
    }
    return cells.map((cell) => ({ ...cell, c: map.get(String(cell.c).toUpperCase()) || cell.c }));
  }

  function kMeansQuantize(cells, k, maxIter = 14) {
    if (!k || k >= 256 || cells.length <= k) return cells;
    const freq = new Map();
    for (const c of cells) freq.set(c.c, (freq.get(c.c) || 0) + 1);
    let centroids = [...freq.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, k)
      .map(([hex]) => hexToLab(hex));

    for (let iter = 0; iter < maxIter; iter++) {
      const buckets = Array.from({ length: centroids.length }, () => []);
      for (const cell of cells) {
        const lab = hexToLab(cell.c);
        let best = 0;
        let bestD = Infinity;
        for (let i = 0; i < centroids.length; i++) {
          const d = deltaE76(lab, centroids[i]);
          if (d < bestD) { bestD = d; best = i; }
        }
        buckets[best].push(cell);
      }
      let moved = false;
      for (let i = 0; i < centroids.length; i++) {
        if (!buckets[i].length) continue;
        let sumL = 0; let sumA = 0; let sumB = 0;
        for (const cell of buckets[i]) {
          const lab = hexToLab(cell.c);
          sumL += lab.L; sumA += lab.a; sumB += lab.b;
        }
        const n = buckets[i].length;
        const next = { L: sumL / n, a: sumA / n, b: sumB / n };
        if (deltaE76(next, centroids[i]) > 0.5) moved = true;
        centroids[i] = next;
      }
      if (!moved) break;
    }

    const centroidHex = centroids.map((lab) => {
      const y = (lab.L + 16) / 116;
      const x = lab.a / 500 + y;
      const z = y - lab.b / 200;
      const f = (t) => (t ** 3 > 0.008856 ? t ** 3 : (t - 16 / 116) / 7.787);
      const X = 0.95047 * f(x);
      const Y = 1.0 * f(y);
      const Z = 1.08883 * f(z);
      let R = 3.2404542 * X - 1.5371385 * Y - 0.4985314 * Z;
      let G = -0.9692660 * X + 1.8760108 * Y + 0.0415560 * Z;
      let B = 0.0556434 * X - 0.2040259 * Y + 1.0572252 * Z;
      const linToSrgb = (c) => {
        const v = Math.max(0, Math.min(1, c));
        return v <= 0.0031308 ? 255 * v * 12.92 : 255 * ((1.055 * v ** (1 / 2.4)) - 0.055);
      };
      return rgbToHex(linToSrgb(R), linToSrgb(G), linToSrgb(B));
    });

    return cells.map((cell) => {
      const lab = hexToLab(cell.c);
      let best = 0;
      let bestD = Infinity;
      for (let i = 0; i < centroids.length; i++) {
        const d = deltaE76(lab, centroids[i]);
        if (d < bestD) { bestD = d; best = i; }
      }
      return { ...cell, c: centroidHex[best] };
    });
  }

  function dominantFromSamples(samples) {
    if (!samples.length) return null;
    const freq = new Map();
    for (const hex of samples) freq.set(hex, (freq.get(hex) || 0) + 1);
    let best = samples[0];
    let bestN = 0;
    for (const [hex, n] of freq) {
      if (n > bestN) { bestN = n; best = hex; }
    }
    return best;
  }

  window.BlueprintColors = {
    hexToRgb,
    rgbToHex,
    rgbToLab,
    hexToLab,
    deltaE76,
    colorDistance,
    toleranceToDeltaE,
    colorsMatch,
    denoiseRgb,
    blendWithBg,
    snapToPalette,
    countUnique,
    analyzePalette,
    mergeSimilarColors,
    kMeansQuantize,
    dominantFromSamples,
  };
})();
