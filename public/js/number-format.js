/**
 * Formato compacto de números grandes (K, M, B, T, Qa… + 100+ sufijos).
 * UMD: Node (require) y navegador (window.NumberFormat).
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.NumberFormat = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /** Sufijos por grupo de ×1000 (índice 0 = unidades, 1 = K, 2 = M…) */
  function buildSuffixes(count) {
    const list = ['', 'K', 'M', 'B', 'T'];
    const extended = [
      'Qa', 'Qi', 'Sx', 'Sp', 'Oc', 'No', 'Dc',
      'Ud', 'Dd', 'Td', 'Qt', 'Qd', 'Sd', 'St', 'Od', 'Nd', 'Vg', 'Uvg', 'Dvg', 'Tvg', 'Qtv',
    ];
    for (const s of extended) {
      if (list.length >= count) return list;
      list.push(s);
    }
    let i = 0;
    while (list.length < count) {
      const a = String.fromCharCode(65 + (i % 26));
      const b = String.fromCharCode(65 + Math.floor(i / 26) % 26);
      list.push(a + b);
      i++;
    }
    return list;
  }

  const SUFFIXES = buildSuffixes(128);

  function trimFloat(n, digits) {
    const f = 10 ** digits;
    return Math.round(n * f) / f;
  }

  /**
   * @param {number} value
   * @param {{ threshold?: number, digits?: number, suffix?: string }} [opts]
   */
  function formatCompact(value, opts = {}) {
    const threshold = opts.threshold ?? 1_000_000;
    const digits = opts.digits ?? 2;
    const suffix = opts.suffix ?? '';
    const n = Number(value);
    if (!Number.isFinite(n)) return '—';

    const sign = n < 0 ? '-' : '';
    const abs = Math.abs(n);

    if (abs < threshold) {
      return sign + Math.trunc(abs).toLocaleString('es-ES') + suffix;
    }

    let tier = Math.floor(Math.log10(abs) / 3);
    if (tier < 1) tier = 1;
    const maxTier = SUFFIXES.length - 1;
    if (tier > maxTier) tier = maxTier;

    const scaled = abs / (1000 ** tier);
    let shown = trimFloat(scaled, digits);
    if (shown >= 1000 && tier < maxTier) {
      tier += 1;
      shown = trimFloat(abs / (1000 ** tier), digits);
    }

    const unit = SUFFIXES[tier] || '';
    const body = shown >= 100 || digits === 0
      ? String(Math.round(shown))
      : String(shown).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');

    return sign + body + unit + suffix;
  }

  function formatLevel(level) {
    const n = Math.max(1, Math.floor(Number(level) || 1));
    return formatCompact(n, { threshold: 1_000_000, digits: 2 });
  }

  function formatXp(value) {
    return formatCompact(value, { threshold: 1_000_000, digits: 2, suffix: ' XP' });
  }

  function formatCoins(value) {
    return formatCompact(value, { threshold: 1_000_000, digits: 2, suffix: '🪙' });
  }

  function fullLabel(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return '—';
    return Math.trunc(n).toLocaleString('es-ES');
  }

  return {
    SUFFIXES,
    formatCompact,
    formatLevel,
    formatXp,
    formatCoins,
    fullLabel,
  };
});
