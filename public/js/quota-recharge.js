/** Vista previa acelerador de recarga (cliente) */
(function () {
  'use strict';

  const BASE_SEC = 600;
  const MIN_SEC = 60;
  const MAX_USEFUL = BASE_SEC - MIN_SEC;

  function cooldownSecForLevel(level) {
    const lv = Math.max(0, Math.trunc(level));
    const red = Math.min(MAX_USEFUL, lv);
    return Math.max(MIN_SEC, BASE_SEC - red);
  }

  function formatCooldown(sec) {
    const s = Math.max(0, Math.trunc(sec));
    const m = Math.floor(s / 60);
    const r = s % 60;
    return `${m}:${String(r).padStart(2, '0')}`;
  }

  function priceForLevel(currentLevel) {
    const lv = Math.max(0, Math.trunc(currentLevel));
    const base = 340;
    const growth = 1.116;
    let price = base * (growth ** lv);
    price *= 1 + Math.floor(lv / 35) * 0.42;
    if (lv > 0 && lv % 50 === 0) price *= 1.85;
    if (lv >= 180) price *= 1.06 ** (lv - 180);
    if (lv >= 240) price *= 1.04 ** (lv - 240);
    return Math.max(1, Math.floor(price));
  }

  function previewForLevel(level) {
    const lv = Math.max(1, Math.trunc(level));
    const sec = cooldownSecForLevel(lv);
    const red = Math.min(MAX_USEFUL, lv);
    return {
      name: `Recarga ${formatCooldown(sec)}`,
      desc: red >= MAX_USEFUL
        ? 'Tiempo mínimo alcanzado (1 min). Sigue subiendo = prestigio.'
        : `−${red}s vs 10 min · próximo: ${formatCooldown(sec)}`,
      cooldownSec: sec,
    };
  }

  function fmtPrice(n) {
    if (typeof NumberFormat !== 'undefined') {
      return NumberFormat.formatCompact(n, { threshold: 1_000_000, digits: 2 });
    }
    if (n >= 1e12) return `${(n / 1e12).toFixed(2)}T`;
    if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
    if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
    return String(Math.trunc(n));
  }

  window.QuotaRecharge = {
    cooldownSecForLevel,
    formatCooldown,
    priceForLevel,
    previewForLevel,
    fmtPrice,
    MAX_USEFUL,
  };
})();
