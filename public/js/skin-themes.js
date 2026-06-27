(function (global) {
  'use strict';

  const SKIN_OVERRIDES = {
    skin_synthwave: { bg: '#12061f', surface: '#1a0a2e', accent: '#ff6bcb', canvasBg: '#1a0533' },
    skin_gameboy: { bg: '#8b956d', surface: '#9da77a', accent: '#2d321c', canvasBg: '#7a8459' },
    skin_terminal: { bg: '#020502', surface: '#0a140a', accent: '#39ff14', canvasBg: '#000800' },
    skin_sakura: { bg: '#1f1218', surface: '#2a1a22', accent: '#ffb7c5', canvasBg: '#2d1820' },
    skin_deepsea: { bg: '#061220', surface: '#0c1a2e', accent: '#22d3ee', canvasBg: '#0a1628' },
    skin_desert: { bg: '#1a1208', surface: '#261a0c', accent: '#e8a838', canvasBg: '#2a1c0e' },
    skin_arctic: { bg: '#0e1418', surface: '#141c24', accent: '#a8d4f0', canvasBg: '#121a22' },
    skin_lavaforge: { bg: '#140808', surface: '#1f0c0c', accent: '#ff4422', canvasBg: '#1a0808' },
    skin_candy: { bg: '#1a1020', surface: '#241428', accent: '#ff88cc', canvasBg: '#201018' },
    skin_noir: { bg: '#0a0a0a', surface: '#141414', accent: '#cc1122', canvasBg: '#111111' },
    skin_space: { bg: '#050510', surface: '#0c0c1a', accent: '#88ccff', canvasBg: '#080818' },
    skin_forest: { bg: '#0a140c', surface: '#101c12', accent: '#5cb85c', canvasBg: '#0c180e' },
  };

  function hashCode(str) {
    let h = 0;
    for (let i = 0; i < str.length; i++) h = ((h << 5) - h + str.charCodeAt(i)) | 0;
    return Math.abs(h);
  }

  function getSkinTheme(skinId) {
    if (SKIN_OVERRIDES[skinId]) return SKIN_OVERRIDES[skinId];
    const hue = hashCode(skinId || 'default') % 360;
    return {
      bg: `hsl(${hue}, 20%, 7%)`,
      surface: `hsl(${hue}, 18%, 11%)`,
      accent: `hsl(${(hue + 48) % 360}, 62%, 58%)`,
      canvasBg: `hsl(${hue}, 24%, 10%)`,
    };
  }

  function applySkin(skinId) {
    const root = document.documentElement;
    const body = document.body;
    if (!skinId) {
      body.removeAttribute('data-skin');
      ['--bg', '--surface', '--surface2', '--accent', '--canvas-bg', '--accent-glow'].forEach((p) => {
        root.style.removeProperty(p);
      });
      return;
    }
    const t = getSkinTheme(skinId);
    body.dataset.skin = skinId;
    root.style.setProperty('--bg', t.bg);
    root.style.setProperty('--surface', t.surface);
    root.style.setProperty('--surface2', t.surface);
    root.style.setProperty('--accent', t.accent);
    root.style.setProperty('--canvas-bg', t.canvasBg);
    root.style.setProperty('--accent-glow', `${t.accent}66`);
  }

  global.SkinThemes = { getSkinTheme, applySkin, SKIN_OVERRIDES };
})(typeof window !== 'undefined' ? window : globalThis);
