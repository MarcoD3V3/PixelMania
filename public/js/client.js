(function () {
  'use strict';

  const canvas = document.getElementById('canvas');
  const ctx = canvas.getContext('2d', { alpha: false });
  const blueprintLayer = document.getElementById('blueprint-layer');
  const blueprintCtx = blueprintLayer.getContext('2d', { alpha: true });
  const territoryLayer = document.getElementById('territory-layer');
  const tctx = territoryLayer.getContext('2d');
  const minimap = document.getElementById('minimap');
  const minimapCtx = minimap.getContext('2d', { alpha: false });
  const minimapBase = document.getElementById('minimap-base');
  const minimapBaseCtx = minimapBase.getContext('2d', { alpha: false });
  const wrap = document.getElementById('canvas-wrap');
  const claimPreview = document.getElementById('claim-preview');
  const cursorPreview = document.getElementById('cursor-preview');
  const pixelCard = document.getElementById('pixel-card');
  const paletteEl = document.getElementById('color-palette');
  const selectedSwatch = document.getElementById('selected-swatch');
  const selectedHex = document.getElementById('selected-hex');
  const customColor = document.getElementById('custom-color');
  const onlineCount = document.getElementById('online-count');
  const coinsStat = document.getElementById('coins-stat');
  const coinsCount = document.getElementById('coins-count');
  const cooldownTimer = document.getElementById('cooldown-timer');
  const cooldownStat = document.getElementById('cooldown-stat');
  const cooldownLabel = document.getElementById('cooldown-label');
  const quotaStat = document.getElementById('quota-stat');
  const quotaCount = document.getElementById('quota-count');
  const zoomLevelEl = document.getElementById('zoom-level');
  const coordDisplay = document.getElementById('coord-display');
  const toastEl = document.getElementById('toast');
  const authArea = document.getElementById('auth-area');
  const claimPanel = document.getElementById('claim-panel');
  const claimModeBtn = document.getElementById('claim-mode-btn');
  const claimStatus = document.getElementById('claim-status');
  const territoryBalance = document.getElementById('territory-balance');
  const territoryList = document.getElementById('territory-list');
  const missionsList = document.getElementById('missions-list');
  const shopList = document.getElementById('shop-list');
  const claimColorInput = document.getElementById('claim-color');
  const claimColorForm = document.getElementById('claim-color-form');
  const modalOverlay = document.getElementById('modal-overlay');
  const shopBalanceEl = document.getElementById('shop-balance');
  const shopTabsEl = document.getElementById('shop-tabs');
  const shopSearchEl = document.getElementById('shop-search');
  const shopItemCountEl = document.getElementById('shop-item-count');
  const tycoonPanel = document.getElementById('tycoon-panel');
  const chiselBadge = document.getElementById('chisel-badge');
  const brushPanel = document.getElementById('brush-panel');
  const brushListEl = document.getElementById('brush-list');
  const brushSizesEl = document.getElementById('brush-sizes');
  const brushPanelHint = document.getElementById('brush-panel-hint');
  const toolsLoginHint = document.getElementById('tools-login-hint');
  const sidebarTabs = document.getElementById('sidebar-tabs');
  const modals = {
    territory: document.getElementById('modal-territory'),
    missions: document.getElementById('modal-missions'),
    shop: document.getElementById('modal-shop'),
    arcade: document.getElementById('modal-arcade'),
  };
  let paintZones = [];
  let arcadeLive = [];
  let arcadeInited = false;

  function ensureArcadeInit(data = {}) {
    if (typeof Arcade === 'undefined') return;
    const zones = data.zones || data.paintZones || paintZones || [];
    const games = data.games || data.arcadeGames || [];
    if (zones.length) paintZones = zones;
    const opts = {
      zones,
      games,
      reflex: data.reflex,
      getUser: () => currentUser,
      getUserId: () => currentUser?.id,
      goTo: (x, y) => goToCoords(x, y, scale),
      closeModals,
      toast: showToast,
      onUserUpdate: (u) => renderAuth(u),
      onWallet: (w) => updateWallet(w),
    };
    if (!arcadeInited) {
      Arcade.init(opts);
      Arcade.bindUI();
      arcadeInited = true;
    } else {
      if (zones.length) Arcade.setZones(zones);
      if (games.length) Arcade.setGames(games);
    }
  }

  const MINIMAP_SIZE = 168;
  const MISSION_ICONS = {
    explorador: '🧭', maraton: '🏃', octantes: '🗺', constancia: '📅',
    artesano: '🎨', conquistador: '👑', cincelador: '⛏', inversor: '💎',
  };
  const SHOP_TAB_SHORT = {
    dibujo: 'Pintura',
    territorio: 'Territorio',
    combate: 'Combate',
    utilidades: 'Utilidades',
    tycoon: 'Tycoon',
    skins: 'Skins',
    personalizacion: 'Perfil',
    pinceles: 'Pinceles',
    colores: 'Colores',
    decoracion: 'Decoración',
  };
  const SHOP_ICONS = {
    territory_500: '🏰', territory_2000: '🏯', siege_token: '⚔',
    gadget_heatmap: '🔥', paint_boost: '⚡', brush_corrido: '🖌',
    pixel_blueprint_token: '🖼',
    zoom_lens: '🔭',
  };

  const CHUNK_SIZE = 128;
  const MINIMAP_RADIUS = 480;

  let selectedColor = '#000000';
  let availableColors = [...(window.FREE_COLORS || ['#000000', '#FFFFFF'])];
  let freeColors = [...(window.FREE_COLORS || ['#000000', '#FFFFFF'])];
  let scale = 1;
  let zoomLensMaxLevel = 10;
  let zoomLimitToastAt = 0;
  let offsetX = 0;
  let offsetY = 0;
  let quotaCooldownSec = 600;
  let quotaRechargeLevel = 0;
  let quotaEnd = 0;
  let quotaRemaining = 0;
  let quotaMax = 1000;
  let quotaInterval = null;
  let isPanning = false;
  let panStart = { x: 0, y: 0, ox: 0, oy: 0 };
  let spaceHeld = false;
  let toastTimeout = null;
  let currentUser = null;
  let missions = [];
  let shop = [];
  let shopCategories = [];
  let tycoonUpgrades = [];
  let activeShopCategory = 'all';
  let pendingShopCategory = null;
  let shopSearchQuery = '';
  let shopLoading = false;
  let shopCatalogLoaded = false;
  const shopCategoryPages = {};
  const SHOP_PAGE_SIZE = 36;
  const SHOP_PREVIEW_IN_ALL = 8;
  const chiselLocal = new Map();
  const CHISEL_STALE_MS = 10_000;
  let chiselPruneTimer = null;
  let chiselComboTimer = null;
  let territories = [];
  let claimMode = false;
  let blueprintDragging = false;
  let showTerritoryFrames = false;
  let claimDragging = false;
  let claimStart = null;
  let hoverCoord = { x: 0, y: 0 };
  let isDrawing = false;
  let lastDrawKey = null;
  let brushDragHintShown = false;
  let drawPointerDown = null;
  const pixelMeta = new Map();
  const pixelChunks = new Map();
  const pixelColorCache = new Map();
  const PIXEL_COLOR_CACHE_MAX = 16000;
  let saveViewportTimer = null;
  let renderScheduled = false;
  let minimapScheduled = false;
  let blueprintLayerKey = '';
  let blueprintProgressTimer = null;
  let minimapPanSkip = 0;
  let blueprintPaletteTimer = null;
  let blueprintPaletteBound = false;
  let urlCoordsTimer = null;
  let pendingUrlCoord = null;
  let viewportDpr = 1;

  const savedPrefs = PMStorage.loadPrefs();
  const savedViewport = PMStorage.loadViewport();
  const savedUserCache = PMStorage.loadUser();

  if (savedPrefs.color) selectedColor = String(savedPrefs.color).trim().toUpperCase();
  if (savedPrefs.claimMode) claimMode = savedPrefs.claimMode;
  if (savedPrefs.showTerritoryFrames) showTerritoryFrames = true;

  function rebuildAvailableColors(user) {
    const set = new Set(freeColors.map((c) => String(c).toUpperCase()));
    if (user?.unlockedColors?.length) {
      user.unlockedColors.forEach((c) => {
        const h = String(c).trim().toUpperCase();
        if (/^#[0-9A-F]{6}$/.test(h)) set.add(h);
      });
    }
    availableColors = [...set];
  }

  function normalizeSelectedColor() {
    const h = String(selectedColor || '').trim().toUpperCase();
    if (!/^#[0-9A-F]{6}$/.test(h) || !availableColors.includes(h)) {
      selectedColor = availableColors[0] || '#000000';
    } else {
      selectedColor = h;
    }
  }

  function syncColorAccess(user) {
    if (user?.freeColors?.length) {
      freeColors = user.freeColors.map((c) => String(c).toUpperCase());
    }
    if (user?.availableColors?.length) {
      availableColors = user.availableColors.map((c) => String(c).toUpperCase());
    } else {
      rebuildAvailableColors(user);
    }
    normalizeSelectedColor();
  }

  function colorIsUnlocked(hex) {
    const h = String(hex || '').trim().toUpperCase();
    return /^#[0-9A-F]{6}$/.test(h) && availableColors.includes(h);
  }

  if (savedUserCache?.user) {
    syncColorAccess(savedUserCache.user);
  } else {
    rebuildAvailableColors(null);
    normalizeSelectedColor();
  }

  const showTerritoryFramesCheck = document.getElementById('show-territory-frames');
  if (showTerritoryFramesCheck) {
    showTerritoryFramesCheck.checked = showTerritoryFrames;
    showTerritoryFramesCheck.addEventListener('change', () => {
      showTerritoryFrames = showTerritoryFramesCheck.checked;
      persistPrefs({ showTerritoryFrames });
      drawTerritories();
    });
  }

  const socket = io({ withCredentials: true, autoConnect: false });

  function canvasBgColor() {
    const v = getComputedStyle(document.documentElement).getPropertyValue('--canvas-bg').trim();
    return v || '#1a1a2e';
  }

  function pruneStaleChiselLocal() {
    const now = Date.now();
    let changed = false;
    for (const [key, prog] of chiselLocal) {
      if (now - (prog.updatedAt || 0) >= CHISEL_STALE_MS) {
        chiselLocal.delete(key);
        changed = true;
      }
    }
    if (changed) scheduleRender();
  }

  function ensureChiselPruneTimer() {
    if (chiselPruneTimer) return;
    chiselPruneTimer = setInterval(pruneStaleChiselLocal, 2000);
  }

  function applyActiveSkin(user) {
    if (typeof SkinThemes !== 'undefined') {
      SkinThemes.applySkin(user?.activeSkin || null);
    }
  }

  async function equipSkin(skinId) {
    try {
      const res = await fetch('/api/equip-skin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ id: skinId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      currentUser = data.user;
      renderAuth(data.user);
      applyActiveSkin(data.user);
      renderShop(shop, shopCategories);
      const name = shop.find((s) => s.unlockKey === skinId || s.id === skinId)?.name || 'Skin';
      showToast(`Skin equipada: ${name}`);
    } catch (err) {
      showToast(err.message, true);
    }
  }

  function initSidebarTabs() {
    if (!sidebarTabs) return;
    const panels = {
      paint: document.getElementById('tab-paint'),
      tools: document.getElementById('tab-tools'),
      blueprint: document.getElementById('tab-blueprint'),
      profile: document.getElementById('tab-profile'),
      nav: document.getElementById('tab-nav'),
    };
    sidebarTabs.querySelectorAll('.tab').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.tab;
        sidebarTabs.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t === btn));
        Object.entries(panels).forEach(([key, panel]) => {
          if (panel) panel.hidden = key !== id;
        });
        if (id === 'blueprint' && typeof PixelBlueprint !== 'undefined') {
          PixelBlueprint.renderPanel();
        }
        if (id === 'profile' && currentUser && typeof ProfileCosmetics !== 'undefined') {
          ProfileCosmetics.renderProfilePanel(currentUser, document.getElementById('profile-panel'), {
            onSaved: (data) => { renderAuth(data.user); showToast('Perfil actualizado'); },
            toast: showToast,
          });
        }
      });
    });
  }

  function openShopCategory(catId) {
    pendingShopCategory = catId || 'dibujo';
    openModal('shop');
  }

  initSidebarTabs();

  const COLOR_UNLOCK_START = 32;
  const COLOR_UNLOCK_MAX = 1_000_000_000;

  function colorUnlockPriceAtClient(n) {
    const count = Math.max(0, Math.trunc(n));
    if (count === 0) return COLOR_UNLOCK_START;
    let price = COLOR_UNLOCK_START;
    for (let i = 0; i < count; i++) {
      price += (i % 3 === 0) ? 4 : 3;
    }
    return Math.min(COLOR_UNLOCK_MAX, price);
  }

  async function loadBlueprintConfig() {
    if (typeof PixelBlueprint === 'undefined') return;
    const deps = {
      getUser: () => currentUser,
      getPalette: () => availableColors,
      getViewCenter: getViewCenterWorld,
      getVisibleBounds: getVisibleWorldBounds,
      getPixelColor: getPlacedPixelColor,
      forEachPixelInBounds,
      scheduleRender,
      toast: showToast,
      openShop: openShopCategory,
      goToBlueprint: (x, y) => goToCoords(x, y, scale),
      onMoveModeChange: (on) => {
        wrap.classList.toggle('blueprint-move-mode', on);
      },
      onUserUpdate: (user) => { if (user) renderAuth(user); },
      onWallet: (w) => updateWallet(w),
      colorIsUnlocked: (hex) => colorIsUnlocked(hex),
      getPremiumColorCount: () => currentUser?.premiumColorCount ?? 0,
      getSelectedColor: () => selectedColor,
      getColorPriceAt: (n) => colorUnlockPriceAtClient(n),
      getNextColorPrice: () => currentUser?.nextColorUnlockPrice ?? colorUnlockPriceAtClient(currentUser?.premiumColorCount ?? 0),
      onBlueprintPaletteChange: () => buildBlueprintPalette(),
      renderBlueprintPalette: () => buildBlueprintPalette(),
      isPanning: () => isPanning,
      markBlueprintLayerDirty: () => { blueprintLayerKey = ''; },
    };
    try {
      const res = await fetch('/api/config');
      const data = await res.json();
      PixelBlueprint.init(deps, data.blueprint || undefined);
    } catch (_) {
      PixelBlueprint.init(deps);
    }
  }

  async function equipBrush(brush, blockSize, opts = {}) {
    try {
      const body = {};
      if (!opts.keepBrush || brush !== undefined) body.brush = brush;
      if (blockSize !== undefined) body.blockSize = blockSize;
      if (opts.mirrorEnabled != null) body.mirrorEnabled = opts.mirrorEnabled;
      if (opts.mirrorAxis) body.mirrorAxis = opts.mirrorAxis;
      const res = await fetch('/api/equip-brush', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      currentUser = data.user;
      renderAuth(data.user);
      renderBrushesPanel(data.user);
      showToast('Pincel actualizado');
    } catch (err) {
      showToast(err.message, true);
    }
  }

  function renderBrushesPanel(user) {
    if (!brushPanel) return;
    brushPanel.querySelector('.brush-mirror-row')?.remove();
    if (!user) {
      brushPanel.hidden = true;
      if (toolsLoginHint) toolsLoginHint.hidden = false;
      return;
    }
    brushPanel.hidden = false;
    if (toolsLoginHint) toolsLoginHint.hidden = true;
    const state = user.brushState || {
      activeBrush: user.activeBrush || null,
      activeBlockSize: user.activeBlockSize || 1,
      unlockedBrushes: [{ key: null, name: 'Píxel único', icon: '▪' }],
      blockSizes: [1],
    };
    const sizes = state.blockSizes || [1];
    const brushes = state.unlockedBrushes || [{ key: null, name: 'Píxel único', icon: '▪' }];
    const activeSize = state.activeBlockSize || 1;
    const activeBrush = state.activeBrush || null;
    const mirrorOn = Boolean(state.mirrorEnabled);
    const mirrorAxis = state.mirrorAxis || 'v';
    const hasMirror = (user.gadgets || []).includes('mirror_brush');

    if (brushPanelHint) {
      const hasExtra = sizes.length > 1 || brushes.length > 1;
      brushPanelHint.textContent = hasExtra
        ? 'Formas en Pintura y Pinceles. Equípalas aquí.'
        : 'Compra sellos y herramientas en Tienda → Pintura o Pinceles.';
    }

    if (hasMirror && brushListEl) {
      const mirrorHtml = `<div class="brush-mirror-row">
        <button type="button" class="brush-btn${mirrorOn ? ' active' : ''}" data-mirror-toggle="1">🪞 Espejo ${mirrorAxis === 'h' ? 'H' : 'V'}</button>
        <button type="button" class="brush-btn" data-mirror-axis="toggle" title="Cambiar eje">↔</button>
      </div>`;
      brushListEl.insertAdjacentHTML('beforebegin', mirrorHtml);
      const row = brushPanel.querySelector('.brush-mirror-row');
      row?.querySelector('[data-mirror-toggle]')?.addEventListener('click', () => {
        equipBrush(activeBrush, activeSize, { mirrorEnabled: !mirrorOn, mirrorAxis, keepBrush: true });
      });
      row?.querySelector('[data-mirror-axis]')?.addEventListener('click', () => {
        equipBrush(activeBrush, activeSize, { mirrorEnabled: true, mirrorAxis: mirrorAxis === 'h' ? 'v' : 'h', keepBrush: true });
      });
    } else {
      brushPanel?.querySelector('.brush-mirror-row')?.remove();
    }

    if (brushSizesEl) {
      brushSizesEl.innerHTML = sizes.map((sz) => (
        `<button type="button" class="brush-btn${sz === activeSize ? ' active' : ''}" data-brush-size="${sz}">${sz}×${sz}</button>`
      )).join('');
      brushSizesEl.querySelectorAll('[data-brush-size]').forEach((btn) => {
        btn.addEventListener('click', () => equipBrush(activeBrush, Number(btn.dataset.brushSize)));
      });
    }

    if (brushListEl) {
      brushListEl.innerHTML = brushes.map((b) => {
        const key = b.key == null ? '' : b.key;
        const isActive = (key || null) === activeBrush && (activeSize === 1 || b.kind === 'stamp' || b.kind === 'pattern' || b.kind === 'bucket');
        const label = b.icon ? `${b.icon} ${b.name}` : b.name;
        return `<button type="button" class="brush-btn${isActive ? ' active' : ''}" data-brush-key="${escapeHtml(key)}" title="${escapeHtml(b.desc || '')}">${escapeHtml(label)}</button>`;
      }).join('');
      brushListEl.querySelectorAll('[data-brush-key]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const key = btn.dataset.brushKey || null;
          equipBrush(key, activeSize);
        });
      });
    }
  }

  function handleWindowResize() {
    const rect = wrap.getBoundingClientRect();
    const centerX = (rect.width / 2 - offsetX) / scale;
    const centerY = (rect.height / 2 - offsetY) / scale;
    resizeViewportCanvas();
    const newRect = wrap.getBoundingClientRect();
    offsetX = newRect.width / 2 - centerX * scale;
    offsetY = newRect.height / 2 - centerY * scale;
    applyTransform();
  }

  function hasBrushCorrido() {
    return Boolean(currentUser?.gadgets?.includes('brush_corrido'));
  }

  function updateDrawModeHint() {
    const tip = document.getElementById('draw-tip');
    if (!tip) return;
    if (!currentUser) {
      tip.textContent = 'Inicia sesión para pintar';
      return;
    }
    const clicks = currentUser.tycoon?.clicksRequired ?? 10;
    const chiselTxt = clicks <= 1
      ? '<kbd>Click</kbd> → 1 píxel por celda'
      : `<kbd>Click</kbd> ×${clicks} en celdas vacías · <strong>Mejoras</strong> para acelerar`;
    if (hasBrushCorrido()) {
      tip.innerHTML = `${chiselTxt} · arrastrar con pincel corrido`;
    } else {
      tip.innerHTML = `${chiselTxt} · compra en <strong>Tienda</strong>`;
    }
  }

  function fmtLevel(n) {
    const display = Math.max(1, Math.floor(Number(n) || 1));
    if (typeof NumberFormat !== 'undefined') {
      return NumberFormat.formatLevel(display);
    }
    return String(display);
  }

  function fmtXp(n) {
    if (typeof NumberFormat !== 'undefined') {
      return NumberFormat.formatCompact(n, { threshold: 1_000_000, digits: 2 });
    }
    return String(Math.trunc(n));
  }

  function fmtFull(n) {
    if (typeof NumberFormat !== 'undefined') return NumberFormat.fullLabel(n);
    return String(Math.trunc(n));
  }

  function updateTycoonUI(tycoon) {
    const t = tycoon || currentUser?.tycoon;
    if (!tycoonPanel) return;
    if (!currentUser || !t) {
      tycoonPanel.hidden = true;
      return;
    }
    tycoonPanel.hidden = false;
    const lvlEl = document.getElementById('tycoon-level');
    const clicksEl = document.getElementById('tycoon-clicks');
    const xpFill = document.getElementById('tycoon-xp-fill');
    const xpText = document.getElementById('tycoon-xp-text');
    const passiveEl = document.getElementById('tycoon-passive');
    const displayLevel = t.levelDisplay ?? (t.level + 1);
    if (lvlEl) {
      lvlEl.textContent = fmtLevel(displayLevel);
      lvlEl.title = `Nivel exacto: ${fmtFull(displayLevel)}`;
    }
    if (clicksEl) {
      clicksEl.textContent = t.clicksRequired <= 1 ? '1 clic/celda ✓' : `${t.clicksRequired} clics/celda`;
    }
    const pct = t.xpNext > 0 ? Math.min(100, (t.xpCurrent / t.xpNext) * 100) : 100;
    if (xpFill) xpFill.style.width = `${pct}%`;
    if (xpText) {
      const cur = fmtXp(t.xpCurrent);
      const need = fmtXp(t.xpNext);
      xpText.textContent = `${cur} / ${need} XP`;
      const perLvl = t.xpPerLevel ?? t.xpNext;
      xpText.title = `${fmtFull(t.xpCurrent)} / ${fmtFull(t.xpNext)} XP · Total: ${fmtFull(t.xp ?? 0)} XP · Siguiente nv.: ${fmtFull(perLvl)} XP`;
    }
    if (passiveEl) {
      if (t.passivePerMin > 0) {
        passiveEl.hidden = false;
        const coins = typeof NumberFormat !== 'undefined'
          ? NumberFormat.formatCompact(t.passivePerMin, { threshold: 1_000_000, digits: 2 })
          : t.passivePerMin;
        const idleMin = Math.floor((t.passiveIdleSec || 0) / 60);
        const idleHint = idleMin >= 1 ? ` · acumulando ${idleMin} min` : ' · deja de pintar 1 min';
        passiveEl.textContent = `⚡ +${coins}🪙/min idle${idleHint}`;
      } else passiveEl.hidden = true;
    }
    currentUser.tycoon = t;
    updateDrawModeHint();
  }

  async function buyTycoonUpgrade(key) {
    try {
      const res = await fetch('/api/tycoon/upgrade', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ key }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      currentUser = data.user;
      renderAuth(data.user);
      updateTycoonUI(data.user.tycoon);
      if (data.tycoonUpgrades) tycoonUpgrades = data.tycoonUpgrades;
      renderShop(shop, shopCategories);
      if (data.missions) renderMissions(data.missions);
      showToast('¡Mejora comprada!');
    } catch (err) {
      showToast(err.message, true);
    }
  }

  function positionChiselBadge(sx, sy) {
    if (!chiselBadge || chiselBadge.hidden) return;
    chiselBadge.style.left = `${sx}px`;
    chiselBadge.style.top = `${sy}px`;
  }

  function flashChiselCombo() {
    if (!chiselBadge) return;
    chiselBadge.classList.add('chisel-badge--combo');
    clearTimeout(chiselComboTimer);
    chiselComboTimer = setTimeout(() => chiselBadge.classList.remove('chisel-badge--combo'), 350);
  }

  function persistPrefs(extra) {
    PMStorage.savePrefs({ color: selectedColor, claimMode, showTerritoryFrames, ...extra });
  }

  function canPlacePixels() {
    return quotaRemaining > 0;
  }

  async function loadShopCatalog() {
    shopLoading = true;
    renderShopLoading();
    try {
      const res = await fetch('/api/shop', { cache: 'no-store' });
      const data = await res.json();
      if (data.shop?.length) {
        shop = data.shop;
        shopCatalogLoaded = true;
      }
      if (data.shopCategories?.length) shopCategories = data.shopCategories;
      if (data.tycoonUpgrades?.length && !tycoonUpgrades.length) {
        tycoonUpgrades = data.tycoonUpgrades;
      }
      if (data.zoomLens?.maxLevel) zoomLensMaxLevel = data.zoomLens.maxLevel;
    } catch (err) {
      console.error('Tienda:', err);
    } finally {
      shopLoading = false;
      if (modals.shop && !modals.shop.hidden) renderShop(null, null);
    }
  }

  function renderShopLoading() {
    if (!shopList || !shopLoading) return;
    if (modals.shop?.hidden === false) {
      shopList.innerHTML = '<p class="panel-desc shop-loading">Cargando catálogo…</p>';
    }
  }

  async function refreshShopData() {
    await loadShopCatalog();
    if (currentUser) {
      try {
        const meRes = await fetch('/api/me', { credentials: 'include', cache: 'no-store' }).then((r) => r.json());
        if (meRes.tycoonUpgrades?.length) tycoonUpgrades = meRes.tycoonUpgrades;
      } catch (_) { /* ignore */ }
    }
  }

  function applyShopCatalog(list, categories) {
    if (Array.isArray(list) && list.length > 0) {
      if (!shop.length || list.length >= shop.length) {
        shop = list;
        if (list.length >= 20) shopCatalogLoaded = true;
      }
    }
    if (categories?.length && (!shopCategories.length || categories.length >= shopCategories.length)) {
      shopCategories = categories;
    }
  }

  function openModal(name) {
    modalOverlay.hidden = false;
    Object.values(modals).forEach((m) => { m.hidden = true; });
    if (modals[name]) modals[name].hidden = false;
    if (name === 'shop') {
      if (pendingShopCategory) {
        activeShopCategory = pendingShopCategory;
        pendingShopCategory = null;
      } else {
        activeShopCategory = 'all';
      }
      const paint = () => renderShop(null, null);
      renderShopLoading();
      refreshShopData().then(paint);
    }
    if (name === 'territory') updateTerritoryUI();
    if (name === 'arcade' && typeof Arcade !== 'undefined') {
      Arcade.renderZonesList();
      Arcade.renderGamesList();
    }
    PMStorage.savePrefs({ color: selectedColor, claimMode, lastModal: name });
  }

  function closeModals() {
    modalOverlay.hidden = true;
    Object.values(modals).forEach((m) => { m.hidden = true; });
  }

  function getZoomLensLevel() {
    return currentUser?.shopLevels?.zoom_lens ?? 0;
  }

  function computeZoomLimits(level) {
    const maxLv = zoomLensMaxLevel || 10;
    const l = Math.min(Math.max(0, Math.floor(level ?? 0)), maxLv);
    const minTable = [28, 22, 17, 12, 8, 5, 3, 1.8, 0.9, 0.35, 0.08];
    const maxTable = [36, 30, 24, 20, 22, 26, 30, 34, 38, 40, 40];
    const minScale = minTable[l] ?? 0.08;
    const maxScale = maxTable[l] ?? 40;
    return {
      level: l,
      maxLevel: maxLv,
      minScale: Math.max(0.05, Math.round(minScale * 100) / 100),
      maxScale: Math.min(40, Math.round(maxScale * 100) / 100),
    };
  }

  function clampScale(s) {
    const { minScale, maxScale } = computeZoomLimits(getZoomLensLevel());
    return Math.min(Math.max(s, minScale), maxScale);
  }

  function leveledItemPrice(item) {
    const lvl = getShopLevel(item);
    if (item.procedural === 'recharge' && typeof QuotaRecharge !== 'undefined') {
      return QuotaRecharge.priceForLevel(lvl);
    }
    const tier = item.levels?.[lvl];
    if (tier?.price != null) return tier.price;
    const base = item.basePrice ?? item.price ?? 100;
    const growth = item.priceGrowth ?? 1.4;
    return Math.floor(base * growth ** lvl);
  }

  function leveledMaxLevel(item) {
    if (item.procedural === 'recharge') return Infinity;
    return item.levels?.length || item.maxLevel || zoomLensMaxLevel;
  }

  function leveledMaxLabel(item) {
    const max = leveledMaxLevel(item);
    return max === Infinity ? '∞' : String(max);
  }

  function getShopLevel(item) {
    return currentUser?.shopLevels?.[item.upgradeKey || item.id] || 0;
  }

  function getNextLeveledTier(item) {
    const lvl = getShopLevel(item);
    if (item.procedural === 'recharge' && typeof QuotaRecharge !== 'undefined') {
      return QuotaRecharge.previewForLevel(lvl + 1);
    }
    if (item.procedural && item.procedural !== 'recharge' && typeof ProfileCosmetics !== 'undefined') {
      return ProfileCosmetics.tierPreview(item.procedural, lvl + 1);
    }
    return item.levels?.[lvl] || null;
  }

  function leveledStockLabel(item, lvl) {
    if (item.id === 'zoom_lens') {
      const next = computeZoomLimits(lvl + 1);
      return `Actual nv.${lvl} → nv.${lvl + 1} · alejar ${Math.round(next.minScale * 100)}%`;
    }
    if (item.procedural === 'recharge' && typeof QuotaRecharge !== 'undefined') {
      const next = QuotaRecharge.previewForLevel(lvl + 1);
      return `Nv.${lvl + 1}: ${next.name}`;
    }
    if (item.procedural && typeof ProfileCosmetics !== 'undefined') {
      const next = ProfileCosmetics.tierPreview(item.procedural, lvl + 1);
      return `Nv.${lvl + 1}: ${next.name}`;
    }
    const tier = item.levels?.[lvl];
    if (tier) return `Nv.${lvl + 1}: ${tier.name}`;
    return `Nivel ${lvl} → ${lvl + 1}`;
  }

  function maybeZoomLimitToast(wantedScale, appliedScale, zoomingOut) {
    if (!zoomingOut || appliedScale <= wantedScale) return;
    const now = Date.now();
    if (now - zoomLimitToastAt < 2500) return;
    zoomLimitToastAt = now;
    const lim = computeZoomLimits(getZoomLensLevel());
    if (lim.level >= lim.maxLevel) return;
    showToast(`🔭 Lente nv.${lim.level}: aleja hasta ${Math.round(lim.minScale * 100)}%. Sube nivel en Tienda.`, true);
  }

  function updateZoomLensUI() {
    const el = document.getElementById('zoom-lens-hint');
    scale = clampScale(scale);
    const lim = computeZoomLimits(getZoomLensLevel());
    if (el) {
      el.textContent = currentUser
        ? `🔭 Lente nv.${lim.level}/${lim.maxLevel} · alejar: ${Math.round(lim.minScale * 100)}% · acercar: ${Math.round(lim.maxScale * 100)}% · solo tu cuenta`
        : '🔭 Inicia sesión · mejora la lente en Tienda (solo afecta tu vista)';
    }
  }

  function updateShopBalance() {
    if (!shopBalanceEl) return;
    const coins = currentUser?.coins ?? 0;
    shopBalanceEl.innerHTML = currentUser
      ? `Tu saldo: <strong>${coins}</strong> 🪙`
      : 'Inicia sesión para comprar';
  }

  function userOwnsShopItem(item) {
    if (!currentUser) return false;
    if (item.type === 'leveled') {
      const lvl = getShopLevel(item);
      return lvl >= leveledMaxLevel(item);
    }
    if (item.type === 'gadget') return currentUser.gadgets?.includes(item.gadget);
    if (item.type === 'unlock') return currentUser.gadgets?.includes(item.unlockKey);
    if (item.type === 'color') {
      return colorIsUnlocked(item.hex);
    }
    if (item.type === 'palette') {
      const owned = currentUser.unlockedColors || [];
      return (item.colors || []).every((c) => owned.includes(String(c).toUpperCase()));
    }
    return false;
  }

  function filterShopItems(items) {
    if (!shopSearchQuery.trim()) return items;
    const q = shopSearchQuery.trim().toLowerCase();
    return items.filter((i) => (
      i.name.toLowerCase().includes(q)
      || i.desc.toLowerCase().includes(q)
      || (i.hint && i.hint.toLowerCase().includes(q))
      || (i.levels && i.levels.some((l) => l.name.toLowerCase().includes(q) || (l.desc && l.desc.toLowerCase().includes(q))))
    ));
  }

  function getShopItemsForCategory(catId) {
    if (catId === 'tycoon') return [];
    return filterShopItems(shop.filter((i) => (i.category || 'utilidades') === catId));
  }

  function getShopItemStatus(item) {
    if (item.type === 'leveled') {
      const lvl = getShopLevel(item);
      const max = leveledMaxLevel(item);
      if (Number.isFinite(max) && lvl >= max) {
        return { state: 'owned', label: `Nivel máximo (${max})`, stockLabel: null };
      }
      if (!currentUser) return { state: 'locked', label: 'Inicia sesión', stockLabel: null };
      const price = leveledItemPrice(item);
      const coins = currentUser.coins ?? 0;
      const stockLabel = leveledStockLabel(item, lvl);
      if (coins < price) {
        return { state: 'poor', label: `Te faltan ${price - coins}🪙`, stockLabel };
      }
      return { state: 'afford', label: null, stockLabel, leveledPrice: price };
    }
    if (userOwnsShopItem(item)) {
      if (item.type === 'color') {
        const isFree = freeColors.includes(String(item.hex).toUpperCase());
        return { state: 'owned', label: isFree ? 'Gratis en paleta ✓' : 'En tu paleta ✓', stockLabel: null };
      }
      return { state: 'owned', label: 'Desbloqueado ✓', stockLabel: null };
    }
    if (item.type === 'gadget' && currentUser?.gadgets?.includes(item.gadget)) {
      return { state: 'owned', label: 'Desbloqueado ✓', stockLabel: null };
    }
    if (!currentUser) return { state: 'locked', label: 'Inicia sesión', stockLabel: null };
    const coins = currentUser.coins ?? 0;
    const price = item.type === 'color' ? (currentUser.nextColorUnlockPrice ?? 80) : item.price;
    let stockLabel = null;
    if (item.type === 'item' && item.item) {
      const n = currentUser.inventory?.[item.item] || 0;
      if (n > 0) stockLabel = `En inventario: ${n}`;
    }
    if (item.type === 'color') {
      stockLabel = `Precio sube por color desbloqueado (${currentUser.premiumColorCount ?? 0} comprados)`;
    }
    if (coins < price) {
      return { state: 'poor', label: `Te faltan ${formatCoinPrice(price - coins)}🪙`, stockLabel, colorPrice: price };
    }
    return { state: 'afford', label: null, stockLabel, colorPrice: price };
  }

  function countShopInCategory(catId) {
    if (catId === 'tycoon') return tycoonUpgrades.length;
    return shop.filter((i) => (i.category || 'utilidades') === catId).length;
  }

  function renderShopTabs() {
    if (!shopTabsEl) return;
    const tabs = [
      { id: 'all', name: 'Todas', icon: '🏪' },
      ...shopCategories,
    ];

    shopTabsEl.innerHTML = tabs.map((t) => {
      const count = t.id === 'all'
        ? shop.length + (tycoonUpgrades.length ? tycoonUpgrades.length : 0)
        : countShopInCategory(t.id);
      const active = activeShopCategory === t.id ? ' active' : '';
      const label = t.id === 'all' ? 'Todas' : (SHOP_TAB_SHORT[t.id] || t.name);
      return `<button type="button" class="shop-tab${active}" data-shop-tab="${t.id}">`
        + `${t.icon || ''} ${escapeHtml(label)}`
        + `<span class="shop-tab__count${count === 0 ? ' shop-tab__count--empty' : ''}">${count}</span></button>`;
    }).join('');

    shopTabsEl.querySelectorAll('[data-shop-tab]').forEach((btn) => {
      btn.addEventListener('click', () => {
        activeShopCategory = btn.dataset.shopTab;
        shopCategoryPages[activeShopCategory] = 0;
        renderShop(shop, shopCategories);
      });
    });
  }

  function renderShopTycoonCard(def) {
    const owned = def.level || 0;
    const maxed = def.maxed;
    const canBuy = currentUser && !maxed && (currentUser.coins ?? 0) >= (def.price || 0);
    const effect = def.effectLabel || def.desc || '';
    let action = '';
    if (maxed) action = '<span class="shop-card__owned">Nivel máximo ✓</span>';
    else if (!currentUser) action = '<span class="shop-card__locked">Inicia sesión</span>';
    else if (!canBuy) action = `<span class="shop-card__missing">Te faltan ${def.price - (currentUser.coins ?? 0)}🪙</span>`;
    else action = `<button type="button" class="btn btn--sm btn--buy" data-tycoon="${def.key}">Mejorar · ${def.price}🪙</button>`;

    return `
      <article class="shop-card shop-card--tycoon${canBuy ? ' shop-card--can-buy' : ''}${maxed ? ' shop-card--owned' : ''}">
        <div class="shop-card__top">
          <span class="shop-card__icon">${def.icon}</span>
          <div class="shop-card__meta">
            <strong>${escapeHtml(def.name)}</strong>
            <span class="shop-card__kind">Mejora · ${owned}/${def.maxLevel}</span>
          </div>
          ${maxed ? '' : `<span class="shop-card__price">${def.price}🪙</span>`}
        </div>
        <p class="shop-card__desc">${escapeHtml(def.desc)}</p>
        <div class="shop-card__foot">
          <span class="shop-card__next">${escapeHtml(effect)}</span>
          <div class="shop-card__action">${action}</div>
        </div>
      </article>`;
  }

  function renderShopCategorySection(cat) {
    const showTip = activeShopCategory === cat.id;
    const tip = showTip && cat.tip ? `<p class="shop-category__tip">${escapeHtml(cat.tip)}</p>` : '';

    if (cat.id === 'tycoon') {
      if (!tycoonUpgrades.length) return '';
      const cards = tycoonUpgrades.map(renderShopTycoonCard).join('');
      const count = tycoonUpgrades.length;
      return `
        <section class="shop-category shop-category--tycoon" id="shop-cat-tycoon">
          <header class="shop-category__header">
            <span class="shop-category__icon" aria-hidden="true">${cat.icon}</span>
            <div class="shop-category__titles">
              <h3 class="shop-category__name">${escapeHtml(cat.name)}</h3>
              <span class="shop-category__count">${count} mejoras</span>
              ${tip}
            </div>
          </header>
          <div class="shop-category__grid">${cards}</div>
        </section>`;
    }

    const items = getShopItemsForCategory(cat.id);
    if (!items.length) return '';

    let pageItems = items;
    let pagination = '';
    const isSingleCat = activeShopCategory === cat.id;

    if (activeShopCategory === 'all' && items.length > SHOP_PREVIEW_IN_ALL && !shopSearchQuery.trim()) {
      pageItems = items.slice(0, SHOP_PREVIEW_IN_ALL);
      pagination = `<div class="shop-category__more">
        <button type="button" class="btn btn--sm btn--ghost shop-see-all" data-shop-tab="${cat.id}">
          Ver los ${items.length - SHOP_PREVIEW_IN_ALL} restantes →
        </button></div>`;
    } else if (isSingleCat && items.length > SHOP_PAGE_SIZE) {
      const page = shopCategoryPages[cat.id] || 0;
      const totalPages = Math.ceil(items.length / SHOP_PAGE_SIZE);
      pageItems = items.slice(page * SHOP_PAGE_SIZE, (page + 1) * SHOP_PAGE_SIZE);
      pagination = `<div class="shop-pagination">
        <button type="button" class="btn btn--sm btn--ghost shop-page" data-cat="${cat.id}" data-page="${page - 1}" ${page <= 0 ? 'disabled' : ''}>← Anterior</button>
        <span>Pág. ${page + 1} / ${totalPages}</span>
        <button type="button" class="btn btn--sm btn--ghost shop-page" data-cat="${cat.id}" data-page="${page + 1}" ${page >= totalPages - 1 ? 'disabled' : ''}>Siguiente →</button>
      </div>`;
    }

    const cards = pageItems.map(renderShopCard).join('');
    return `
      <section class="shop-category shop-category--${cat.id}" id="shop-cat-${cat.id}">
        <header class="shop-category__header">
          <span class="shop-category__icon" aria-hidden="true">${cat.icon}</span>
          <div class="shop-category__titles">
            <h3 class="shop-category__name">${escapeHtml(cat.name)}</h3>
            <span class="shop-category__count">${items.length} artículo${items.length === 1 ? '' : 's'}</span>
            ${tip}
          </div>
        </header>
        <div class="shop-category__grid">${cards}</div>
        ${pagination}
      </section>`;
  }

  function renderShopCard(item) {
    const icon = item.icon || SHOP_ICONS[item.id] || '📦';
    const swatch = item.colorSwatch
      ? `<span class="shop-card__swatch" style="background:${item.colorSwatch}" title="${item.colorSwatch}"></span>`
      : '';
    const status = getShopItemStatus(item);
    let kind = item.kind || (item.type === 'gadget' ? 'Permanente' : item.type === 'territory' ? 'Paquete' : 'Consumible');
    let cardName = item.name;
    let cardDesc = item.desc;
    if (item.type === 'leveled') {
      const lvl = getShopLevel(item);
      const max = leveledMaxLevel(item);
      kind = `Mejorable · nv.${lvl}/${leveledMaxLabel(item)}`;
      const next = getNextLeveledTier(item);
      if (next) {
        cardDesc = lvl === 0
          ? `Primer nivel: ${next.desc || next.name}.`
          : `${next.desc || next.name}`;
      }
      if (item.procedural === 'recharge' && typeof QuotaRecharge !== 'undefined' && lvl > 0) {
        cardDesc = `Ahora: ${QuotaRecharge.formatCooldown(QuotaRecharge.cooldownSecForLevel(lvl))} · ${cardDesc}`;
      }
    }
    const affordClass = status.state === 'afford' ? ' shop-card--can-buy' : '';
    const ownedClass = status.state === 'owned' ? ' shop-card--owned' : '';

    let action = '';
    if (status.state === 'owned') {
      if (item.type === 'unlock' && String(item.unlockKey || item.id).startsWith('skin_')) {
        const skinKey = item.unlockKey || item.id;
        const equipped = currentUser?.activeSkin === skinKey;
        action = equipped
          ? '<span class="shop-card__owned">Equipada ✓</span>'
          : `<button type="button" class="btn btn--sm btn--buy" data-equip-skin="${escapeHtml(skinKey)}">Equipar</button>`;
      } else if (item.type === 'unlock' && item.category === 'dibujo') {
        const toolKey = item.unlockKey || item.id;
        const equipped = currentUser?.activeBrush === toolKey;
        action = equipped
          ? '<span class="shop-card__owned">Equipado ✓</span>'
          : `<button type="button" class="btn btn--sm btn--buy" data-equip-brush="${escapeHtml(toolKey)}">Equipar</button>`;
      } else if (item.type === 'leveled') {
        action = '<span class="shop-card__owned">Nivel máximo ✓</span>';
      } else if (item.type === 'color') {
        action = `<span class="shop-card__owned">${escapeHtml(status.label)}</span>`;
      } else {
        action = '<span class="shop-card__owned">Desbloqueado ✓</span>';
      }
    } else if (!currentUser) {
      action = '<span class="shop-card__locked">Inicia sesión con Discord</span>';
    } else if (status.state === 'poor') {
      action = `<span class="shop-card__missing">${escapeHtml(status.label)}</span>`;
    } else if (item.type === 'leveled') {
      const price = status.leveledPrice ?? leveledItemPrice(item);
      const lvl = getShopLevel(item);
      const priceTxt = item.procedural === 'recharge' && typeof QuotaRecharge !== 'undefined'
        ? QuotaRecharge.fmtPrice(price)
        : price;
      action = `<button type="button" class="btn btn--sm btn--buy" data-buy="${item.id}">${lvl === 0 ? 'Comprar' : 'Subir'} nv.${lvl + 1} · ${priceTxt}🪙</button>`;
    } else {
      const buyPrice = item.type === 'color' ? (status.colorPrice ?? currentUser?.nextColorUnlockPrice ?? item.price) : item.price;
      action = `<button type="button" class="btn btn--sm btn--buy" data-buy="${item.id}">Comprar · ${formatCoinPrice(buyPrice)}🪙</button>`;
    }

    const price = item.type === 'leveled' && status.state !== 'owned'
      ? (status.leveledPrice ?? leveledItemPrice(item))
      : item.type === 'color' && status.state !== 'owned'
        ? (status.colorPrice ?? currentUser?.nextColorUnlockPrice ?? item.price)
        : item.price;
    const priceLabel = status.state === 'owned' && item.type === 'leveled' ? '' : `${formatCoinPrice(price)}🪙`;
    const footNote = status.stockLabel || (item.type !== 'leveled' ? item.hint : '');

    return `
      <article class="shop-card${item.type === 'leveled' ? ' shop-card--leveled' : ''}${affordClass}${ownedClass}">
        <div class="shop-card__top">
          <span class="shop-card__icon">${icon}</span>
          <div class="shop-card__meta">
            <strong>${escapeHtml(cardName)}</strong>
            <span class="shop-card__kind">${escapeHtml(kind)}</span>
          </div>
          ${priceLabel ? `<span class="shop-card__price">${priceLabel}</span>` : ''}
          ${swatch}
        </div>
        <p class="shop-card__desc">${escapeHtml(cardDesc)}</p>
        <div class="shop-card__foot">
          ${footNote ? `<span class="shop-card__next">${escapeHtml(footNote)}</span>` : ''}
          <div class="shop-card__action">${action}</div>
        </div>
      </article>`;
  }

  function renderShop(list, categories) {
    applyShopCatalog(list, categories);

    if (shopLoading && !shop.length) {
      renderShopLoading();
      return;
    }

    if (!shopCategories.length) {
      shopCategories = [
        { id: 'dibujo', name: 'Pintura', icon: '🎨', tip: '' },
        { id: 'territorio', name: 'Territorio', icon: '🛡', tip: '' },
        { id: 'combate', name: 'Combate', icon: '⚔', tip: '' },
        { id: 'utilidades', name: 'Utilidades', icon: '🔧', tip: '' },
        { id: 'tycoon', name: 'Mejoras Tycoon', icon: '⛏', tip: '' },
        { id: 'skins', name: 'Skins', icon: '👾', tip: '' },
        { id: 'personalizacion', name: 'Personalización', icon: '✨', tip: '' },
        { id: 'pinceles', name: 'Pinceles', icon: '🖌', tip: '' },
        { id: 'colores', name: 'Colores', icon: '🌈', tip: '' },
        { id: 'decoracion', name: 'Decoración', icon: '📢', tip: '' },
      ];
    }

    if (shopSearchEl && shopSearchEl.value !== shopSearchQuery) shopSearchEl.value = shopSearchQuery;

    renderShopTabs();

    const catsToShow = activeShopCategory === 'all'
      ? shopCategories
      : shopCategories.filter((c) => c.id === activeShopCategory);

    const sections = catsToShow.map(renderShopCategorySection).filter(Boolean).join('');

    if (!sections && shop.length && activeShopCategory === 'all' && !shopSearchQuery.trim()) {
      const cards = shop.slice(0, SHOP_PAGE_SIZE).map(renderShopCard).join('');
      shopList.innerHTML = `
        <section class="shop-category shop-category--all">
          <header class="shop-category__header">
            <span class="shop-category__icon">🏪</span>
            <div class="shop-category__titles">
              <h3 class="shop-category__name">Catálogo</h3>
              <span class="shop-category__count">${shop.length} artículos</span>
            </div>
          </header>
          <div class="shop-category__grid">${cards}</div>
        </section>`;
    } else {
      shopList.innerHTML = sections
        || (shop.length
          ? '<p class="panel-desc">Nada en esta categoría. Prueba otra pestaña arriba.</p>'
          : '<p class="panel-desc">No se pudo cargar la tienda. Reinicia el servidor (npm start) y recarga.</p>');
    }
    if (shopItemCountEl) {
      const visible = activeShopCategory === 'all'
        ? shop.filter((i) => filterShopItems([i]).length).length
        : getShopItemsForCategory(activeShopCategory).length;
      shopItemCountEl.textContent = shopSearchQuery
        ? `${visible} resultados`
        : `${shop.length} productos en total`;
    }
    shopList.querySelectorAll('[data-buy]').forEach((btn) => {
      btn.addEventListener('click', () => buyItem(btn.dataset.buy));
    });
    shopList.querySelectorAll('[data-equip-skin]').forEach((btn) => {
      btn.addEventListener('click', () => equipSkin(btn.dataset.equipSkin));
    });
    shopList.querySelectorAll('[data-equip-brush]').forEach((btn) => {
      btn.addEventListener('click', () => equipBrush(btn.dataset.equipBrush, 1));
    });
    shopList.querySelectorAll('[data-tycoon]').forEach((btn) => {
      btn.addEventListener('click', () => buyTycoonUpgrade(btn.dataset.tycoon));
    });
    shopList.querySelectorAll('.shop-see-all').forEach((btn) => {
      btn.addEventListener('click', () => {
        activeShopCategory = btn.dataset.shopTab;
        shopCategoryPages[activeShopCategory] = 0;
        renderShop(shop, shopCategories);
      });
    });
    shopList.querySelectorAll('.shop-page').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (btn.disabled) return;
        shopCategoryPages[btn.dataset.cat] = Number(btn.dataset.page);
        renderShop(shop, shopCategories);
      });
    });
    updateShopBalance();
  }

  if (shopSearchEl) {
    shopSearchEl.addEventListener('input', () => {
      shopSearchQuery = shopSearchEl.value;
      renderShop(shop, shopCategories);
    });
  }

  document.querySelectorAll('[data-modal]').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (btn.dataset.shopCat) pendingShopCategory = btn.dataset.shopCat;
      openModal(btn.dataset.modal);
    });
  });
  document.querySelectorAll('[data-scroll-to]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const target = document.getElementById(btn.dataset.scrollTo);
      if (target) {
        target.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        target.classList.add('map-hud--flash');
        setTimeout(() => target.classList.remove('map-hud--flash'), 700);
      }
      if (typeof Arcade !== 'undefined') Arcade.renderLeaderboard();
    });
  });
  document.querySelectorAll('[data-close-modal]').forEach((btn) => {
    btn.addEventListener('click', closeModals);
  });
  modalOverlay.addEventListener('click', (e) => {
    if (e.target === modalOverlay) closeModals();
  });
  document.addEventListener('keydown', (e) => {
    if (e.code !== 'Escape') return;
    if (typeof Arcade !== 'undefined' && Arcade.isAnyGameOpen?.()) {
      Arcade.cancelAny?.();
      return;
    }
    closeModals();
  });

  function persistUserState(quota, missionList) {
    if (currentUser) {
      PMStorage.saveUser(currentUser, quota ?? null, missionList ?? missions);
    }
  }

  function saveViewportDebounced() {
    clearTimeout(saveViewportTimer);
    saveViewportTimer = setTimeout(() => {
      PMStorage.saveViewport({
        scale,
        offsetX,
        offsetY,
        x: hoverCoord.x,
        y: hoverCoord.y,
      });
      persistPrefs();
    }, 400);
  }

  function applyClaimModeUI() {
    claimModeBtn.textContent = `Modo reclamar: ${claimMode ? 'ON' : 'OFF'}`;
    claimModeBtn.classList.toggle('active', claimMode);
    wrap.classList.toggle('claim-mode', claimMode);
    claimStatus.textContent = claimMode ? 'Cierra este modal y arrastra en el mapa' : '';
  }

  function restoreFromStorage() {
    applyClaimModeUI();
    if (savedUserCache?.user) {
      syncColorAccess(savedUserCache.user);
      renderAuth(savedUserCache.user);
    }
  }

  function hasSessionCookie() {
    return document.cookie.split(';').some((c) => c.trim().startsWith('pixelmania.sid='));
  }

  function metaKey(x, y) { return `${x},${y}`; }

  function escapeHtml(str) {
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function showToast(msg, isError) {
    toastEl.textContent = msg;
    toastEl.className = 'toast' + (isError ? ' error' : '');
    toastEl.hidden = false;
    clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => { toastEl.hidden = true; }, 3500);
  }

  function formatTime(ms) {
    if (ms <= 0) return 'Listo';
    const totalSec = Math.ceil(ms / 1000);
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    return m > 0 ? `${m}m ${s}s` : `${s}s`;
  }

  function updateWallet(data) {
    if (data.coins != null) {
      const coins = data.coins;
      if (typeof NumberFormat !== 'undefined' && coins >= 1_000_000) {
        coinsCount.textContent = NumberFormat.formatCompact(coins, { threshold: 1_000_000, digits: 2 });
        coinsStat.title = `${fmtFull(coins)} monedas`;
      } else {
        coinsCount.textContent = coins;
        coinsStat.title = '';
      }
      if (currentUser) currentUser.coins = coins;
    }
    if (data.territoryPixels != null && currentUser) {
      currentUser.territoryPixels = data.territoryPixels;
      updateTerritoryUI();
    }
    if (data.claimColor && currentUser) {
      currentUser.claimColor = data.claimColor;
      if (claimColorInput) claimColorInput.value = data.claimColor;
    }
    persistUserState();
    updateShopBalance();
  }

  function updateQuotaUI(quota) {
    if (!quota) {
      quotaStat.hidden = true;
      cooldownTimer.textContent = 'Inicia sesión';
      cooldownStat.className = 'stat';
      return;
    }
    quotaRemaining = quota.remaining;
    quotaMax = quota.max;
    quotaEnd = Date.now() + quota.resetIn;
    quotaCooldownSec = quota.cooldownSec ?? Math.ceil((quota.cooldownMs ?? 600000) / 1000);
    quotaRechargeLevel = quota.rechargeLevel ?? 0;
    quotaStat.hidden = false;
    quotaCount.textContent = `${quota.remaining}/${quota.max}`;
    cooldownLabel.textContent = quota.max;
    const cdLabel = typeof QuotaRecharge !== 'undefined'
      ? QuotaRecharge.formatCooldown(quotaCooldownSec)
      : `${Math.floor(quotaCooldownSec / 60)} min`;
    quotaStat.title = `Recarga cada ${cdLabel} · Acelerador nv.${quotaRechargeLevel}`;
    cooldownStat.title = 'Cuenta atrás segundo a segundo hasta la recarga';
    tickQuota();
    if (quota.remaining <= 0) {
      if (!quotaInterval) quotaInterval = setInterval(tickQuota, 1000);
    } else if (quotaInterval) {
      clearInterval(quotaInterval);
      quotaInterval = null;
    }
    persistUserState(quota);
  }

  function tickQuota() {
    const resetIn = Math.max(0, quotaEnd - Date.now());
    if (quotaRemaining > 0) {
      cooldownTimer.textContent = 'Listo';
      cooldownStat.className = 'stat ready';
      if (quotaInterval) {
        clearInterval(quotaInterval);
        quotaInterval = null;
      }
      return;
    }
    const totalSec = Math.max(0, Math.floor(resetIn / 1000));
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    if (totalSec < 120) {
      cooldownTimer.textContent = `${totalSec}s`;
    } else {
      cooldownTimer.textContent = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    }
    cooldownStat.className = 'stat waiting';
    if (resetIn <= 0) {
      fetch('/api/me', { credentials: 'include' })
        .then((r) => r.json())
        .then((d) => { if (d.quota) updateQuotaUI(d.quota); });
    }
    if (!quotaInterval) quotaInterval = setInterval(tickQuota, 1000);
  }

  function renderAuth(user) {
    currentUser = user;
    if (!user) {
      authArea.innerHTML = `<a href="/auth/discord" class="btn btn--discord">Discord</a>`;
      coinsStat.hidden = true;
      claimPanel.hidden = true;
      PMStorage.saveUser(null);
      if (tycoonPanel) tycoonPanel.hidden = true;
      if (brushPanel) brushPanel.hidden = true;
      if (toolsLoginHint) toolsLoginHint.hidden = false;
      applyActiveSkin(null);
      syncColorAccess(null);
      updateDrawModeHint();
      buildPalette();
      if (typeof PixelBlueprint !== 'undefined') PixelBlueprint.syncFromUser(null);
      return;
    }
    syncColorAccess(user);
    authArea.innerHTML = typeof ProfileCosmetics !== 'undefined'
      ? ProfileCosmetics.buildUserChipHTML(user)
      : `<div class="user-chip"><img src="${user.avatar}" alt="" class="user-chip__avatar" /><span class="user-chip__name">${escapeHtml(user.username)}</span><a href="/auth/logout" class="user-chip__logout" title="Cerrar sesión" id="logout-btn">×</a></div>`;
    coinsStat.hidden = false;
    coinsCount.textContent = user.coins ?? 0;
    if (claimColorInput && user.claimColor) claimColorInput.value = user.claimColor;
    updateTerritoryUI();
    updateDrawModeHint();
    updateTycoonUI(user?.tycoon);
    buildPalette();
    updateZoomLensUI();
    applyActiveSkin(user);
    renderBrushesPanel(user);
    if (typeof PixelBlueprint !== 'undefined') PixelBlueprint.syncFromUser(user);
    if (typeof GadgetEffects !== 'undefined') {
      GadgetEffects.applyGadgetEffects(user, {
        goToCoords: (x, y) => goToCoords(x, y, scale),
      });
    }
    if (typeof ProfileCosmetics !== 'undefined') ProfileCosmetics.applyCursorAura(user.profile);
    if (typeof ProfileCosmetics !== 'undefined') {
      ProfileCosmetics.renderProfilePanel(user, document.getElementById('profile-panel'), {
        onSaved: (data) => {
          renderAuth(data.user);
          showToast('Perfil actualizado');
        },
        toast: showToast,
      });
    }
    persistUserState();
    updateShopBalance();
    document.getElementById('logout-btn')?.addEventListener('click', () => {
      PMStorage.saveUser(null);
    });
  }

  function updateTerritoryUI() {
    claimPanel.hidden = !currentUser;
    territoryBalance.textContent = currentUser
      ? `Territorio disponible: ${currentUser.territoryPixels ?? 0} px`
      : 'Inicia sesión para reclamar territorio';
    renderTerritoryList();
  }

  function renderTerritoryList() {
    PMStorage.set('territories', territories);
    if (!territories.length) {
      territoryList.innerHTML = '<p class="panel-desc">Aún no hay territorios reclamados.</p>';
      return;
    }
    const own = currentUser
      ? territories.filter((t) => territoryOwnerId(t) === currentUser.id)
      : [];
    let html = '';
    if (own.length) {
      html += `<p class="panel-desc territory-own-hint">Tus ${own.length} zona${own.length === 1 ? '' : 's'} están guardadas. Pulsa <strong>Ir</strong> para centrar el mapa.</p>`;
      html += own.map((t) => {
        const siege = t.underSiege ? '<span class="siege-badge">⚔ Asedio</span>' : '';
        return `<div class="territory-item territory-item--own" style="--clan-color:${t.color}">
          <div class="territory-item__main">
            <span>Tu zona</span>
            <span class="territory-item__size">${t.w}×${t.h} · (${t.x}, ${t.y})</span>
          </div>
          <div class="territory-item__actions">
            ${siege}
            <button type="button" class="btn btn--sm btn--ghost" data-goto-territory="${t.id}">📍 Ir</button>
          </div>
        </div>`;
      }).join('');
      const others = territories.filter((t) => territoryOwnerId(t) !== currentUser.id);
      if (others.length) html += '<p class="panel-desc territory-others-label">Otros jugadores</p>';
      html += others.map(renderTerritoryListItem).join('');
    } else {
      html = territories.map(renderTerritoryListItem).join('');
    }
    territoryList.innerHTML = html;
    territoryList.querySelectorAll('[data-siege]').forEach((btn) => {
      btn.addEventListener('click', () => startSiege(btn.dataset.siege));
    });
    territoryList.querySelectorAll('[data-goto-territory]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const t = territories.find((x) => x.id === btn.dataset.gotoTerritory);
        if (t) {
          goToTerritory(t);
          showToast(`Centrado en tu zona (${t.x}, ${t.y})`);
        }
      });
    });
  }

  function renderTerritoryListItem(t) {
    const own = currentUser && territoryOwnerId(t) === currentUser.id;
    const siege = t.underSiege ? `<span class="siege-badge">⚔ Asedio</span>` : '';
    const btn = !own && currentUser
      ? `<button type="button" class="btn btn--sm btn--siege" data-siege="${t.id}">Asediar (75🪙)</button>`
      : (own ? `<button type="button" class="btn btn--sm btn--ghost" data-goto-territory="${t.id}">📍 Ir</button>` : '');
    return `<div class="territory-item${own ? ' territory-item--own' : ''}" style="--clan-color:${t.color}">
      <span>${escapeHtml(t.ownerName)}</span>
      <span class="territory-item__size">${t.w}×${t.h} · (${t.x}, ${t.y})</span>
      ${siege}${btn}
    </div>`;
  }

  async function startSiege(zoneId) {
    try {
      const res = await fetch('/api/siege/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ zoneId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      updateWallet({ coins: data.coins });
      showToast(`¡Asedio iniciado! ${formatTime(data.endsAt - Date.now())} de batalla`);
    } catch (err) {
      showToast(err.message, true);
    }
  }

  function renderMissions(list) {
    missions = list || missions;
    if (!missions.length) {
      missionsList.innerHTML = '<p class="panel-desc">Inicia sesión para ver misiones.</p>';
      return;
    }
    missionsList.innerHTML = missions.map((m) => {
      const pct = m.target ? Math.min(100, Math.round((m.progress / m.target) * 100)) : 0;
      const status = m.done ? '✓ Completada' : `${m.progress}/${m.target}`;
      const icon = MISSION_ICONS[m.id] || '🎯';
      return `<div class="mission-card${m.done ? ' mission-card--done' : ''}">
        <div class="mission-card__head">
          <strong>${icon} ${escapeHtml(m.name)}</strong>
          <span class="mission-card__reward">+${m.reward}🪙</span>
        </div>
        <p class="mission-card__desc">${escapeHtml(m.desc)}</p>
        <div class="mission-bar"><div class="mission-bar__fill" style="width:${pct}%"></div></div>
        <span class="mission-card__prog">${status}</span>
      </div>`;
    }).join('');
    persistUserState(null, missions);
  }

  async function buyItem(id) {
    try {
      const res = await fetch('/api/shop/buy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      currentUser = data.user;
      syncColorAccess(data.user);
      renderAuth(data.user);
      buildPalette();
      updateZoomLensUI();
      renderShop(shop, shopCategories);
      if (id === 'brush_corrido') showToast('¡Pincel corrido desbloqueado!');
      else if (id === 'zoom_lens') {
        const lim = computeZoomLimits(getZoomLensLevel());
        showToast(`🔭 Lente nv.${lim.level} · ahora puedes alejar hasta ${Math.round(lim.minScale * 100)}%`);
      } else {
        const bought = shop.find((s) => s.id === id);
        if (bought?.type === 'leveled') {
          const lvl = getShopLevel(bought);
          let msg = `¡Nv.${lvl} desbloqueado!`;
          if (bought.procedural === 'recharge' && typeof QuotaRecharge !== 'undefined') {
            const t = QuotaRecharge.previewForLevel(lvl);
            msg = `⏳ Nv.${lvl}: recarga ${QuotaRecharge.formatCooldown(t.cooldownSec)}`;
            if (data.quota) updateQuotaUI(data.quota);
          } else if (bought.procedural && typeof ProfileCosmetics !== 'undefined') {
            const t = ProfileCosmetics.tierPreview(bought.procedural, lvl);
            msg = `¡Nv.${lvl}: ${t.name}!`;
          } else {
            const tier = bought.levels?.[lvl - 1];
            if (tier) msg = `¡Nv.${lvl} desbloqueado: ${tier.name}!`;
          }
          showToast(msg);
          renderBrushesPanel(data.user);
        } else if (bought?.type === 'color') {
          showToast(`Color ${bought.hex} añadido a tu paleta`);
        } else if (bought?.type === 'unlock' && String(bought.unlockKey).startsWith('skin_')) {
          showToast('¡Skin comprada y equipada!');
        } else if (bought?.type === 'unlock' && bought.category === 'dibujo') {
          showToast(`¡${bought.name} equipado! Úsalo en el panel Pinceles.`);
        } else showToast('¡Compra exitosa!');
      }
    } catch (err) {
      showToast(err.message, true);
    }
  }

  claimModeBtn.addEventListener('click', () => {
    claimMode = !claimMode;
    applyClaimModeUI();
    persistPrefs();
  });

  claimColorForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const color = claimColorInput.value;
    try {
      const res = await fetch('/api/claim-color', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ color }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      currentUser.claimColor = data.claimColor;
      showToast('Color guardado');
      drawTerritories();
    } catch (err) {
      showToast(err.message, true);
    }
  });

  function formatCoinPrice(n) {
    const v = Math.max(0, Math.floor(Number(n) || 0));
    if (v >= 1_000_000_000) return `${(v / 1_000_000_000).toFixed(v % 1_000_000_000 === 0 ? 0 : 1)}B`;
    if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(v % 1_000_000 === 0 ? 0 : 1)}M`;
    if (v >= 10_000) return `${Math.round(v / 1000)}k`;
    return v.toLocaleString();
  }

  async function buyColorUnlock(hex) {
    if (!currentUser) return showToast('Inicia sesión con Discord', true);
    const h = String(hex || '').trim().toUpperCase();
    if (!/^#[0-9A-F]{6}$/.test(h)) return;
    if (colorIsUnlocked(h)) {
      selectColor(h);
      return;
    }
    const price = currentUser.nextColorUnlockPrice ?? colorUnlockPriceAtClient(currentUser.premiumColorCount ?? 0);
    if (!confirm(`Desbloquear ${h} por ${formatCoinPrice(price)} 🪙?\nLlevas ${currentUser.premiumColorCount ?? 0} colores premium · el siguiente sube de precio.`)) return;
    try {
      const res = await fetch('/api/colors/unlock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ hex: h }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'No se pudo comprar');
      if (data.user) renderAuth(data.user);
      selectColor(h);
      showToast(`Color ${h} desbloqueado (${formatCoinPrice(data.price)} 🪙)`);
      buildPalette();
      buildBlueprintPalette();
    } catch (err) {
      showToast(err.message, true);
    }
  }

  function buildBlueprintPalette() {
    clearTimeout(blueprintPaletteTimer);
    blueprintPaletteTimer = setTimeout(buildBlueprintPaletteNow, 150);
  }

  function bindBlueprintPaletteEvents() {
    if (blueprintPaletteBound) return;
    blueprintPaletteBound = true;
    document.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-bp-color]');
      if (!btn) return;
      const hex = btn.dataset.bpColor;
      if (!hex) return;
      if (!colorIsUnlocked(hex)) {
        buyColorUnlock(hex);
        return;
      }
      PixelBlueprint.setFocusColor(hex, { force: true });
      selectColor(hex);
      buildBlueprintPalette();
    });
  }

  function buildBlueprintPaletteNow() {
    const roots = [
      document.getElementById('blueprint-paint-palette'),
      document.getElementById('blueprint-paint-palette-side'),
    ].filter(Boolean);
    const sidePanel = document.getElementById('blueprint-palette-panel');
    const info = typeof PixelBlueprint !== 'undefined' ? PixelBlueprint.getBlueprintPaletteInfo?.() : null;
    const active = typeof PixelBlueprint !== 'undefined' && PixelBlueprint.getActive?.()?.visible !== false && info?.length;
    if (sidePanel) sidePanel.hidden = !active;
    if (!roots.length || !active) {
      roots.forEach((el) => { el.innerHTML = ''; });
      return;
    }
    const focus = PixelBlueprint.getFocusColor?.();
    const html = info.map((item) => {
      const done = item.remaining <= 0;
      const locked = !item.owned;
      const cls = [
        'bp-paint-swatch',
        item.focused || focus === item.hex ? 'bp-paint-swatch--focus' : '',
        locked ? 'bp-paint-swatch--locked' : '',
        done ? 'bp-paint-swatch--done' : '',
      ].filter(Boolean).join(' ');
      const label = locked
        ? (item.isNextUnlock
          ? `🔒 ${formatCoinPrice(item.price)}🪙`
          : `↗ ${formatCoinPrice(item.price)}🪙`)
        : `${item.remaining.toLocaleString()} px`;
      const priceHint = locked
        ? (item.isNextUnlock
          ? ' · Precio actual (sube con cada compra)'
          : ' · Precio futuro si compras los anteriores')
        : '';
      return `<button type="button" class="${cls}" data-bp-color="${item.hex}" style="--sw:${item.hex}" title="${item.hex} · ${item.count.toLocaleString()} celdas${priceHint}">
        <span class="bp-paint-swatch__chip"></span>
        <span class="bp-paint-swatch__meta">${label}</span>
      </button>`;
    }).join('');
    roots.forEach((el) => {
      el.innerHTML = html;
    });
  }

  bindBlueprintPaletteEvents();

  function buildPalette() {
    paletteEl.innerHTML = '';
    const premium = new Set((currentUser?.unlockedColors || []).map((c) => String(c).toUpperCase()));
    const colors = availableColors.length ? availableColors : [...freeColors];

    colors.forEach((color) => {
      const c = String(color).toUpperCase();
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.style.background = c;
      if (c === '#FFFFFF' || c === '#F1FAEE' || c === '#EDF2F4') {
        btn.style.border = '1px solid var(--border)';
      }
      const isFree = freeColors.includes(c);
      btn.title = isFree ? `${c} (gratis)` : premium.has(c) ? `${c} (comprado)` : c;
      btn.dataset.color = c;
      if (premium.has(c)) btn.classList.add('palette-btn--premium');
      if (isFree) btn.classList.add('palette-btn--free');
      if (c === selectedColor.toUpperCase()) btn.classList.add('selected');
      btn.addEventListener('click', () => selectColor(c, btn));
      paletteEl.appendChild(btn);
    });
    updateCustomColorUI();
    buildBlueprintPalette();
  }

  function selectColor(color, btnEl) {
    const h = String(color || '').trim().toUpperCase();
    if (!colorIsUnlocked(h)) {
      showToast('Ese color no está en tu paleta. Cómpralo en Tienda → Colores.', true);
      normalizeSelectedColor();
      buildPalette();
      return;
    }
    selectedColor = h;
    selectedSwatch.style.background = selectedColor;
    selectedHex.textContent = selectedColor;
    if (customColor) customColor.value = selectedColor;
    paletteEl.querySelectorAll('button').forEach((b) => b.classList.remove('selected'));
    if (btnEl) btnEl.classList.add('selected');
    else {
      const match = paletteEl.querySelector(`[data-color="${selectedColor}"]`);
      if (match) match.classList.add('selected');
    }
    cursorPreview.style.background = selectedColor;
    if (typeof PixelBlueprint !== 'undefined') {
      PixelBlueprint.syncFocusFromSelectedColor?.(selectedColor);
    }
    persistPrefs();
  }

  /** Oculta píxeles del mapa dentro del plano cuando hay color enfocado (solo se ve la guía). */
  function maskBlueprintFocusInterior(ctx, dpr) {
    if (typeof PixelBlueprint === 'undefined' || !PixelBlueprint.isFocusPaintMode?.()) return;
    const bp = PixelBlueprint.getActive?.();
    if (!bp || bp.visible === false) return;
    const { x0, y0, x1, y1 } = getVisibleWorldBounds();
    const bx0 = Math.max(bp.originX, x0);
    const by0 = Math.max(bp.originY, y0);
    const bx1 = Math.min(bp.originX + bp.width, x1);
    const by1 = Math.min(bp.originY + bp.height, y1);
    if (bx1 <= bx0 || by1 <= by0) return;
    const dx = (bx0 * scale + offsetX) * dpr;
    const dy = (by0 * scale + offsetY) * dpr;
    const dw = (bx1 - bx0) * scale * dpr;
    const dh = (by1 - by0) * scale * dpr;
    ctx.fillStyle = canvasBgColor();
    ctx.fillRect(dx, dy, dw, dh);
  }

  function updateCustomColorUI() {
    const hint = document.getElementById('custom-color-hint');
    const extra = availableColors.length > freeColors.length;
    if (customColor) {
      customColor.disabled = !extra;
      customColor.title = extra
        ? 'Elige un color que ya hayas desbloqueado'
        : 'Compra colores en Tienda para usar el selector';
    }
    if (hint) {
      hint.textContent = extra
        ? 'Selector: solo colores de tu paleta'
        : 'Compra colores en Tienda para más opciones';
    }
  }

  if (customColor) {
    customColor.addEventListener('input', (e) => {
      const hex = String(e.target.value || '').trim().toUpperCase();
      if (!colorIsUnlocked(hex)) {
        showToast('Ese color no está desbloqueado. Cómpralo en Tienda → Colores.', true);
        customColor.value = selectedColor;
        return;
      }
      selectColor(hex, paletteEl.querySelector(`[data-color="${hex}"]`));
    });
  }

  function chunkCoord(v) {
    return Math.floor(v / CHUNK_SIZE);
  }

  function chunkKey(cx, cy) {
    return `${cx},${cy}`;
  }

  function ensureChunk(cx, cy) {
    const key = chunkKey(cx, cy);
    if (!pixelChunks.has(key)) {
      const c = document.createElement('canvas');
      c.width = CHUNK_SIZE;
      c.height = CHUNK_SIZE;
      const cctx = c.getContext('2d', { alpha: false });
      cctx.fillStyle = '#1a1a2e';
      cctx.fillRect(0, 0, CHUNK_SIZE, CHUNK_SIZE);
      pixelChunks.set(key, { canvas: c, ctx: cctx });
    }
    return pixelChunks.get(key);
  }

  function getVisibleWorldBounds() {
    const rect = wrap.getBoundingClientRect();
    return {
      x0: Math.floor(-offsetX / scale),
      y0: Math.floor(-offsetY / scale),
      x1: Math.ceil((rect.width - offsetX) / scale),
      y1: Math.ceil((rect.height - offsetY) / scale),
    };
  }

  function getViewCenterWorld() {
    const rect = wrap.getBoundingClientRect();
    return {
      x: (rect.width / 2 - offsetX) / scale,
      y: (rect.height / 2 - offsetY) / scale,
    };
  }

  function initCanvas() {
    pixelChunks.clear();
    initMinimapCanvas();
    resizeViewportCanvas();
    applyTransform();
  }

  function effectiveViewportDpr() {
    const raw = window.devicePixelRatio || 1;
    if (scale >= 32) return Math.min(raw, 1);
    if (scale >= 20) return Math.min(raw, 1.25);
    if (scale >= 12) return Math.min(raw, 1.5);
    return Math.min(raw, 2);
  }

  function resizeViewportCanvas() {
    const rect = wrap.getBoundingClientRect();
    viewportDpr = effectiveViewportDpr();
    const cw = Math.max(1, Math.floor(rect.width * viewportDpr));
    const ch = Math.max(1, Math.floor(rect.height * viewportDpr));
    if (canvas.width !== cw || canvas.height !== ch) {
      canvas.width = cw;
      canvas.height = ch;
      blueprintLayer.width = cw;
      blueprintLayer.height = ch;
      territoryLayer.width = cw;
      territoryLayer.height = ch;
      blueprintLayerKey = '';
    }
  }

  function renderBlueprintLayer() {
    if (!blueprintCtx || typeof PixelBlueprint === 'undefined') return;
    const dpr = viewportDpr;
    const active = PixelBlueprint.getActive?.();
    const draft = PixelBlueprint.getDraft?.();
    const hasOverlay = (active && active.visible !== false) || draft?.cells?.length;
    const layerKey = hasOverlay
      ? `${scale}|${offsetX}|${offsetY}|${dpr}|${PixelBlueprint.getLayerKey?.() || ''}`
      : 'empty';
    if (layerKey === blueprintLayerKey) return;
    blueprintLayerKey = layerKey;
    blueprintCtx.setTransform(1, 0, 0, 1, 0, 0);
    blueprintCtx.clearRect(0, 0, blueprintLayer.width, blueprintLayer.height);
    if (!hasOverlay) return;
    PixelBlueprint.drawOverlay(blueprintCtx, scale, offsetX, offsetY, dpr);
    PixelBlueprint.drawDraftOverlay(blueprintCtx, scale, offsetX, offsetY, dpr);
  }

  /** Dibuja solo la porción visible del chunk (evita escalar 128×128 a miles de px en zoom alto). */
  function drawChunkVisible(ctx, chunk, wx, wy, visX0, visY0, visX1, visY1, dpr) {
    const lx0 = Math.max(0, Math.floor(visX0 - wx));
    const ly0 = Math.max(0, Math.floor(visY0 - wy));
    const lx1 = Math.min(CHUNK_SIZE, Math.ceil(visX1 - wx));
    const ly1 = Math.min(CHUNK_SIZE, Math.ceil(visY1 - wy));
    const srcW = lx1 - lx0;
    const srcH = ly1 - ly0;
    if (srcW <= 0 || srcH <= 0) return;
    const dx = ((wx + lx0) * scale + offsetX) * dpr;
    const dy = ((wy + ly0) * scale + offsetY) * dpr;
    const dw = srcW * scale * dpr;
    const dh = srcH * scale * dpr;
    ctx.drawImage(chunk.canvas, lx0, ly0, srcW, srcH, dx, dy, dw, dh);
  }

  function scheduleRender() {
    if (renderScheduled) return;
    renderScheduled = true;
    requestAnimationFrame(() => {
      renderScheduled = false;
      renderViewport();
      renderBlueprintLayer();
      if (!isPanning || ++minimapPanSkip % 3 === 0) {
        renderMinimapViewport();
      }
      if (!isPanning) updateCursorPreview(lastMouse.x, lastMouse.y);
      positionClaimPreview();
    });
  }

  function drawOriginGuides(dpr) {
    const { x0, y0, x1, y1 } = getVisibleWorldBounds();
    ctx.strokeStyle = 'rgba(124, 58, 237, 0.2)';
    ctx.lineWidth = 1;
    if (x0 <= 0 && x1 >= 0) {
      const sx = offsetX * dpr;
      ctx.beginPath();
      ctx.moveTo(sx, 0);
      ctx.lineTo(sx, canvas.height);
      ctx.stroke();
    }
    if (y0 <= 0 && y1 >= 0) {
      const sy = offsetY * dpr;
      ctx.beginPath();
      ctx.moveTo(0, sy);
      ctx.lineTo(canvas.width, sy);
      ctx.stroke();
    }
    if (x0 <= 0 && x1 > 0 && y0 <= 0 && y1 > 0) {
      const ox = offsetX * dpr;
      const oy = offsetY * dpr;
      const s = Math.max(scale * dpr, 4);
      ctx.fillStyle = 'rgba(124, 58, 237, 0.65)';
      ctx.fillRect(ox, oy, s, s);
    }
  }

  function renderViewport() {
    const rect = wrap.getBoundingClientRect();
    const dpr = viewportDpr;
    const { x0, y0, x1, y1 } = getVisibleWorldBounds();

    ctx.fillStyle = canvasBgColor();
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    tctx.clearRect(0, 0, territoryLayer.width, territoryLayer.height);

    const cx0 = chunkCoord(x0);
    const cy0 = chunkCoord(y0);
    const cx1 = chunkCoord(x1 - 1);
    const cy1 = chunkCoord(y1 - 1);

    ctx.imageSmoothingEnabled = false;
    for (let cy = cy0; cy <= cy1; cy++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        const chunk = pixelChunks.get(chunkKey(cx, cy));
        if (!chunk) continue;
        const wx = cx * CHUNK_SIZE;
        const wy = cy * CHUNK_SIZE;
        if (scale >= 8) {
          drawChunkVisible(ctx, chunk, wx, wy, x0, y0, x1, y1, dpr);
        } else {
          const dx = (wx * scale + offsetX) * dpr;
          const dy = (wy * scale + offsetY) * dpr;
          const dw = CHUNK_SIZE * scale * dpr;
          const dh = CHUNK_SIZE * scale * dpr;
          ctx.drawImage(chunk.canvas, dx, dy, dw, dh);
        }
      }
    }

    drawOriginGuides(dpr);
    drawChiselOverlays(dpr);
    maskBlueprintFocusInterior(ctx, dpr);
    drawZoomGrid(dpr);

    if (showTerritoryFrames) {
      const boosted = typeof GadgetEffects !== 'undefined'
        && GadgetEffects.hasGadget(currentUser, 'territory_highlight');
      drawMergedTerritoryOutlines(
        tctx, scale * dpr, scale * dpr, offsetX * dpr, offsetY * dpr,
        boosted ? { normal: 0.38, siege: 0.58 } : { normal: 0.22, siege: 0.4 },
      );
    }
    drawPaintZones(dpr);
  }

  function drawPaintZones(dpr) {
    if (!paintZones.length) return;
    const { x0, y0, x1, y1 } = getVisibleWorldBounds();
    for (const z of paintZones) {
      if (z.x + z.w < x0 || z.x > x1 || z.y + z.h < y0 || z.y > y1) continue;
      const dx = (z.x * scale + offsetX) * dpr;
      const dy = (z.y * scale + offsetY) * dpr;
      const dw = z.w * scale * dpr;
      const dh = z.h * scale * dpr;
      tctx.strokeStyle = z.color || '#ffbe0b';
      tctx.globalAlpha = 0.55;
      tctx.lineWidth = 2 * dpr;
      tctx.strokeRect(dx + 0.5, dy + 0.5, dw - 1, dh - 1);
      tctx.globalAlpha = 0.08;
      tctx.fillStyle = z.color || '#ffbe0b';
      tctx.fillRect(dx, dy, dw, dh);
      if (z.game && dw >= 28) {
        tctx.globalAlpha = 0.85;
        tctx.fillStyle = '#fff';
        tctx.font = `${Math.min(11 * dpr, 14)}px system-ui,sans-serif`;
        tctx.fillText('🎮', dx + 3 * dpr, dy + 12 * dpr);
      }
      tctx.globalAlpha = 1;
    }
    for (const p of arcadeLive) {
      const z = paintZones.find((zz) => zz.id === p.zoneId);
      if (!z) continue;
      if (z.x + z.w < x0 || z.x > x1 || z.y + z.h < y0 || z.y > y1) continue;
      const dx = ((z.x + z.w / 2) * scale + offsetX) * dpr;
      const dy = ((z.y - 1) * scale + offsetY) * dpr;
      const label = `${p.username}: ${p.score}`;
      tctx.font = `${Math.min(10 * dpr, 12)}px system-ui,sans-serif`;
      tctx.fillStyle = 'rgba(0,0,0,0.65)';
      const tw = tctx.measureText(label).width + 8 * dpr;
      tctx.fillRect(dx - tw / 2, dy - 14 * dpr, tw, 14 * dpr);
      tctx.fillStyle = '#06ffa5';
      tctx.fillText(label, dx - tw / 2 + 4 * dpr, dy - 4 * dpr);
    }
  }

  function drawChiselOverlays(dpr) {
    if (!chiselLocal.size) return;
    const { x0, y0, x1, y1 } = getVisibleWorldBounds();
    const pad = 1;
    for (const [key, prog] of chiselLocal) {
      const [x, y] = key.split(',').map(Number);
      if (x < x0 - pad || x > x1 + pad || y < y0 - pad || y > y1 + pad) continue;
      const alpha = 0.12 + (prog.current / prog.required) * 0.5;
      ctx.fillStyle = hexToRgba(prog.color, alpha);
      const dx = (x * scale + offsetX) * dpr;
      const dy = (y * scale + offsetY) * dpr;
      const s = Math.max(scale * dpr, 4);
      ctx.fillRect(dx, dy, s, s);
    }
  }

  function scheduleMinimapRedraw() {
    if (minimapScheduled) return;
    minimapScheduled = true;
    requestAnimationFrame(() => {
      minimapScheduled = false;
      drawMinimapFull();
    });
  }

  function parseUrlNavigation() {
    const params = new URLSearchParams(location.search);
    const xStr = params.get('x');
    const yStr = params.get('y');
    if (xStr == null || xStr === '' || yStr == null || yStr === '') return null;
    const x = Number(xStr);
    const y = Number(yStr);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    let z = null;
    const zStr = params.get('z');
    if (zStr != null && zStr !== '') {
      z = Number(zStr);
      if (!Number.isFinite(z)) z = null;
      else if (z > 100) z = z / 100;
    }
    return { x, y, z };
  }

  function whenLayoutReady(fn) {
    requestAnimationFrame(() => requestAnimationFrame(fn));
  }

  function applyUrlNavigation() {
    const nav = parseUrlNavigation();
    if (!nav) return false;
    goToCoords(nav.x, nav.y, nav.z);
    hoverCoord = { x: Math.trunc(nav.x), y: Math.trunc(nav.y) };
    if (coordDisplay) coordDisplay.textContent = `(${hoverCoord.x}, ${hoverCoord.y})`;
    return true;
  }

  function restoreInitialViewport(spawn) {
    whenLayoutReady(() => {
      if (applyUrlNavigation()) return;
      if (savedViewport?.x != null && savedViewport?.y != null) {
        goToCoords(
          savedViewport.x,
          savedViewport.y,
          savedViewport.scale != null ? savedViewport.scale : null,
        );
        hoverCoord = { x: savedViewport.x, y: savedViewport.y };
        if (coordDisplay) coordDisplay.textContent = `(${savedViewport.x}, ${savedViewport.y})`;
      } else if (savedViewport?.scale != null || savedViewport?.offsetX != null) {
        if (savedViewport.scale) scale = savedViewport.scale;
        if (savedViewport.offsetX != null) offsetX = savedViewport.offsetX;
        if (savedViewport.offsetY != null) offsetY = savedViewport.offsetY;
        applyTransform();
      } else {
        const own = currentUser?.id
          ? territories.filter((t) => territoryOwnerId(t) === currentUser.id)
          : [];
        if (own.length) {
          const latest = own.reduce((a, b) => ((a.claimedAt || 0) > (b.claimedAt || 0) ? a : b));
          goToCoords(latest.x + latest.w / 2, latest.y + latest.h / 2, 4);
        } else {
          goToCoords(spawn?.x ?? 0, spawn?.y ?? 0, 4);
        }
      }
    });
  }

  function goToTerritory(t) {
    if (!t) return;
    const cx = t.x + t.w / 2;
    const cy = t.y + t.h / 2;
    goToCoords(cx, cy, scale);
    hoverCoord = { x: Math.trunc(cx), y: Math.trunc(cy) };
    if (coordDisplay) coordDisplay.textContent = `(${hoverCoord.x}, ${hoverCoord.y})`;
  }

  /** Solo píxeles colocados por jugadores (pixelMeta). Usado por el plano para errores/progreso. */
  function getPlacedPixelColor(x, y) {
    const meta = pixelMeta.get(metaKey(x, y));
    return meta?.c ? String(meta.c).toUpperCase() : null;
  }

  function getPixelColorAt(x, y) {
    const placed = getPlacedPixelColor(x, y);
    if (placed) return placed;
    const key = metaKey(x, y);
    const cx = chunkCoord(x);
    const cy = chunkCoord(y);
    const chunk = pixelChunks.get(chunkKey(cx, cy));
    if (!chunk) return null;
    const lx = x - cx * CHUNK_SIZE;
    const ly = y - cy * CHUNK_SIZE;
    const d = chunk.ctx.getImageData(lx, ly, 1, 1).data;
    const bg = canvasBgColor().toUpperCase();
    const hex = `#${[d[0], d[1], d[2]].map((v) => v.toString(16).padStart(2, '0')).join('')}`.toUpperCase();
    if (hex === bg || hex === '#1A1A2E') return null;
    if (d[3] === 0) return null;
    return hex;
  }

  function forEachPixelInBounds(x0, y0, x1, y1, fn) {
    const minX = Math.min(x0, x1);
    const maxX = Math.max(x0, x1);
    const minY = Math.min(y0, y1);
    const maxY = Math.max(y0, y1);
    for (const [key] of pixelMeta) {
      const [x, y] = key.split(',').map(Number);
      if (x < minX || x > maxX || y < minY || y > maxY) continue;
      fn(x, y);
    }
  }

  function drawZoomGrid(dpr) {
    if (isPanning) return;
    if (!document.body.classList.contains('gadget-zoom-grid')) return;
    const step = scale >= 12 ? 1 : scale >= 6 ? 2 : scale >= 3 ? 5 : 10;
    const { x0, y0, x1, y1 } = getVisibleWorldBounds();
    const gx0 = Math.floor(x0 / step) * step;
    const gy0 = Math.floor(y0 / step) * step;
    ctx.strokeStyle = 'rgba(255,255,255,0.07)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = gx0; x <= x1; x += step) {
      const sx = (x * scale + offsetX) * dpr;
      ctx.moveTo(sx, 0);
      ctx.lineTo(sx, canvas.height);
    }
    for (let y = gy0; y <= y1; y += step) {
      const sy = (y * scale + offsetY) * dpr;
      ctx.moveTo(0, sy);
      ctx.lineTo(canvas.width, sy);
    }
    ctx.stroke();
  }

  function goToCoords(x, y, z) {
    const rect = wrap.getBoundingClientRect();
    if (z != null) scale = clampScale(Number(z));
    else scale = clampScale(scale);
    offsetX = rect.width / 2 - x * scale;
    offsetY = rect.height / 2 - y * scale;
    applyTransform();
  }

  function updateUrlCoords(x, y) {
    const params = new URLSearchParams(location.search);
    params.set('x', x);
    params.set('y', y);
    params.set('z', Math.round(scale * 10) / 10);
    history.replaceState(null, '', `${location.pathname}?${params}`);
    PMStorage.saveViewport({ scale, offsetX, offsetY, x, y });
  }

  function copyCoordLink() {
    const x = Math.trunc(hoverCoord.x);
    const y = Math.trunc(hoverCoord.y);
    const z = Math.round(scale * 10) / 10;
    const url = `${location.origin}${location.pathname}?x=${x}&y=${y}&z=${z}`;
    navigator.clipboard.writeText(url).then(() => showToast('Enlace copiado'));
    const params = new URLSearchParams(location.search);
    params.set('x', String(x));
    params.set('y', String(y));
    params.set('z', String(z));
    history.replaceState(null, '', `${location.pathname}?${params}`);
  }

  document.getElementById('copy-link').addEventListener('click', copyCoordLink);

  function debouncedUpdateUrlCoords(x, y) {
    pendingUrlCoord = { x, y };
    clearTimeout(urlCoordsTimer);
    urlCoordsTimer = setTimeout(() => {
      if (pendingUrlCoord) updateUrlCoords(pendingUrlCoord.x, pendingUrlCoord.y);
      pendingUrlCoord = null;
    }, 600);
  }

  function applyTransform() {
    resizeViewportCanvas();
    scale = clampScale(scale);
    const lim = computeZoomLimits(getZoomLensLevel());
    zoomLevelEl.textContent = `${Math.round(scale * 100)}%`;
    updateZoomLensUI();
    scheduleRender();
    saveViewportDebounced();
  }

  function screenToPixel(sx, sy) {
    const rect = wrap.getBoundingClientRect();
    return {
      x: Math.floor((sx - rect.left - offsetX) / scale),
      y: Math.floor((sy - rect.top - offsetY) / scale),
    };
  }

  function pixelToScreen(px, py) {
    const rect = wrap.getBoundingClientRect();
    return {
      x: rect.left + offsetX + px * scale,
      y: rect.top + offsetY + py * scale,
    };
  }

  function setPixel(x, y, color, meta, batch) {
    const cx = chunkCoord(x);
    const cy = chunkCoord(y);
    const chunk = ensureChunk(cx, cy);
    const lx = x - cx * CHUNK_SIZE;
    const ly = y - cy * CHUNK_SIZE;
    chunk.ctx.fillStyle = color;
    chunk.ctx.fillRect(lx, ly, 1, 1);
    if (meta) pixelMeta.set(metaKey(x, y), meta);
    if (!batch) {
      scheduleMinimapRedraw();
      scheduleRender();
    }
    if (typeof PixelBlueprint !== 'undefined') {
      PixelBlueprint.onPixelPlaced?.(x, y);
      clearTimeout(blueprintProgressTimer);
      blueprintProgressTimer = setTimeout(() => PixelBlueprint.updateProgressFromMap(), 220);
    }
  }

  function loadPixels(pixels) {
    pixelMeta.clear();
    pixelChunks.clear();
    pixelColorCache.clear();
    for (const p of pixels) {
      setPixel(p.x, p.y, p.c, p, true);
    }
    drawMinimapFull();
    scheduleRender();
  }

  function hexToRgba(hex, a) {
    const h = hex.replace('#', '');
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    return `rgba(${r},${g},${b},${a})`;
  }

  function territoryOwnerId(t) {
    return t.ownerId || t.leaderId;
  }

  function buildOwnerTerritoryGroups() {
    const groups = new Map();
    for (const t of territories) {
      const key = territoryOwnerId(t);
      if (!groups.has(key)) {
        groups.set(key, { color: t.color || t.clanColor || '#7c3aed', underSiege: false, rects: [] });
      }
      const g = groups.get(key);
      g.rects.push(t);
      if (t.underSiege) g.underSiege = true;
    }
    return groups;
  }

  function rectsOverlap(a, b) {
    return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  }

  function groupHasInternalOverlap(group) {
    const rects = group.rects;
    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        if (rectsOverlap(rects[i], rects[j])) return true;
      }
    }
    return false;
  }

  function getUnionOutlineEdges(group) {
    const cells = new Set();
    for (const r of group.rects) {
      for (let y = r.y; y < r.y + r.h; y++) {
        for (let x = r.x; x < r.x + r.w; x++) {
          cells.add(`${x},${y}`);
        }
      }
    }
    const edges = [];
    for (const key of cells) {
      const [x, y] = key.split(',').map(Number);
      if (!cells.has(`${x},${y - 1}`)) edges.push({ x1: x, y1: y, x2: x + 1, y2: y });
      if (!cells.has(`${x},${y + 1}`)) edges.push({ x1: x, y1: y + 1, x2: x + 1, y2: y + 1 });
      if (!cells.has(`${x - 1},${y}`)) edges.push({ x1: x, y1: y, x2: x, y2: y + 1 });
      if (!cells.has(`${x + 1},${y}`)) edges.push({ x1: x + 1, y1: y, x2: x + 1, y2: y + 1 });
    }
    return edges;
  }

  function getMergedOutlineEdges(group) {
    if (group.rects.length === 1) {
      const r = group.rects[0];
      return [
        { x1: r.x, y1: r.y, x2: r.x + r.w, y2: r.y },
        { x1: r.x, y1: r.y + r.h, x2: r.x + r.w, y2: r.y + r.h },
        { x1: r.x, y1: r.y, x2: r.x, y2: r.y + r.h },
        { x1: r.x + r.w, y1: r.y, x2: r.x + r.w, y2: r.y + r.h },
      ];
    }
    if (groupHasInternalOverlap(group)) return getUnionOutlineEdges(group);

    const edgeCount = new Map();
    const normKey = (x1, y1, x2, y2) => {
      if (x1 < x2 || (x1 === x2 && y1 < y2)) return `${x1},${y1},${x2},${y2}`;
      return `${x2},${y2},${x1},${y1}`;
    };
    const addEdge = (x1, y1, x2, y2) => {
      const k = normKey(x1, y1, x2, y2);
      edgeCount.set(k, (edgeCount.get(k) || 0) + 1);
    };
    for (const r of group.rects) {
      for (let x = r.x; x < r.x + r.w; x++) {
        addEdge(x, r.y, x + 1, r.y);
        addEdge(x, r.y + r.h, x + 1, r.y + r.h);
      }
      for (let y = r.y; y < r.y + r.h; y++) {
        addEdge(r.x, y, r.x, y + 1);
        addEdge(r.x + r.w, y, r.x + r.w, y + 1);
      }
    }
    const edges = [];
    for (const [key, count] of edgeCount) {
      if (count !== 1) continue;
      const [x1, y1, x2, y2] = key.split(',').map(Number);
      edges.push({ x1, y1, x2, y2 });
    }
    return edges;
  }

  function strokeOutlineEdges(ctx, edges, scaleX, scaleY, offsetX, offsetY) {
    ctx.beginPath();
    for (const e of edges) {
      if (e.y1 === e.y2) {
        const y = e.y1 * scaleY + offsetY;
        ctx.moveTo(e.x1 * scaleX + offsetX, y);
        ctx.lineTo(e.x2 * scaleX + offsetX, y);
      } else {
        const x = e.x1 * scaleX + offsetX;
        ctx.moveTo(x, e.y1 * scaleY + offsetY);
        ctx.lineTo(x, e.y2 * scaleY + offsetY);
      }
    }
    ctx.stroke();
  }

  function drawMergedTerritoryOutlines(ctx, scaleX, scaleY, offsetX, offsetY, opacity) {
    for (const group of buildOwnerTerritoryGroups().values()) {
      ctx.strokeStyle = group.underSiege
        ? `rgba(239, 71, 111, ${opacity.siege})`
        : hexToRgba(group.color, opacity.normal);
      ctx.lineWidth = 1;
      strokeOutlineEdges(ctx, getMergedOutlineEdges(group), scaleX, scaleY, offsetX, offsetY);
    }
  }

  function overlapsOwnTerritory(rect) {
    if (!currentUser) return false;
    return territories.some((t) => territoryOwnerId(t) === currentUser.id && rectsOverlap(rect, t));
  }

  function overlapsEnemyTerritory(rect) {
    if (!currentUser) return false;
    return territories.some((t) => territoryOwnerId(t) !== currentUser.id && rectsOverlap(rect, t));
  }

  function drawTerritories() {
    scheduleMinimapRedraw();
    scheduleRender();
  }

  function drawMinimapFull() {
    const center = getViewCenterWorld();
    const r = MINIMAP_RADIUS;
    const span = r * 2;
    const sx = MINIMAP_SIZE / span;

    minimapBaseCtx.setTransform(1, 0, 0, 1, 0, 0);
    minimapBaseCtx.fillStyle = '#1a1a2e';
    minimapBaseCtx.fillRect(0, 0, MINIMAP_SIZE, MINIMAP_SIZE);

    const pxMin = center.x - r;
    const pxMax = center.x + r;
    const pyMin = center.y - r;
    const pyMax = center.y + r;

    const heatmap = typeof GadgetEffects !== 'undefined' && GadgetEffects.hasGadget(currentUser, 'heatmap');
    for (const [key, meta] of pixelMeta) {
      const [px, py] = key.split(',').map(Number);
      if (px < pxMin || px > pxMax || py < pyMin || py > pyMax) continue;
      const mx = (px - center.x + r) * sx;
      const my = (py - center.y + r) * sx;
      minimapBaseCtx.fillStyle = meta.c || '#ffffff';
      if (heatmap) {
        minimapBaseCtx.globalAlpha = 1;
        minimapBaseCtx.fillRect(Math.floor(mx), Math.floor(my), Math.max(2, Math.ceil(sx * 1.2)), Math.max(2, Math.ceil(sx * 1.2)));
        minimapBaseCtx.globalAlpha = 1;
      } else {
        minimapBaseCtx.fillRect(Math.floor(mx), Math.floor(my), Math.max(1, Math.ceil(sx)), Math.max(1, Math.ceil(sx)));
      }
    }
    minimapBaseCtx.globalAlpha = 1;

    if (showTerritoryFrames) {
      drawMergedTerritoryOutlines(
        minimapBaseCtx, sx, sx,
        r * sx + 0.5 - center.x * sx,
        r * sx + 0.5 - center.y * sx,
        { normal: 0.35, siege: 0.55 },
      );
    }

    const ox = (0 - center.x + r) * sx;
    const oy = (0 - center.y + r) * sx;
    minimapBaseCtx.fillStyle = 'rgba(124, 58, 237, 0.7)';
    minimapBaseCtx.fillRect(Math.floor(ox), Math.floor(oy), 2, 2);

    renderMinimapViewport();
  }

  function initMinimapCanvas() {
    minimap.width = MINIMAP_SIZE;
    minimap.height = MINIMAP_SIZE;
    minimapBase.width = MINIMAP_SIZE;
    minimapBase.height = MINIMAP_SIZE;
  }

  function renderMinimapViewport() {
    const w = MINIMAP_SIZE;
    const h = MINIMAP_SIZE;
    minimapCtx.setTransform(1, 0, 0, 1, 0, 0);
    minimapCtx.clearRect(0, 0, w, h);
    minimapCtx.drawImage(minimapBase, 0, 0, w, h);

    const center = getViewCenterWorld();
    const r = MINIMAP_RADIUS;
    const span = r * 2;
    const sx = w / span;
    const { x0, y0, x1, y1 } = getVisibleWorldBounds();
    let vx = (x0 - center.x + r) * sx;
    let vy = (y0 - center.y + r) * sx;
    let vw = (x1 - x0) * sx;
    let vh = (y1 - y0) * sx;
    if (!Number.isFinite(vx) || !Number.isFinite(vy) || !Number.isFinite(vw) || !Number.isFinite(vh)) return;
    if (vw < 0.5 || vh < 0.5) return;

    vx = Math.max(0, Math.min(w - 1, vx));
    vy = Math.max(0, Math.min(h - 1, vy));
    vw = Math.max(1, Math.min(w - vx, vw));
    vh = Math.max(1, Math.min(h - vy, vh));

    minimapCtx.strokeStyle = 'rgba(124, 58, 237, 0.85)';
    minimapCtx.lineWidth = 1;
    minimapCtx.strokeRect(vx + 0.5, vy + 0.5, vw - 1, vh - 1);
  }

  const lastMouse = { x: 0, y: 0 };

  function capClaimRect(x1, y1, x2, y2, maxPx) {
    let x = Math.min(x1, x2);
    let y = Math.min(y1, y2);
    let w = Math.abs(x2 - x1) + 1;
    let h = Math.abs(y2 - y1) + 1;
    if (w * h <= maxPx) return { x, y, w, h, capped: false };
    const ratio = Math.sqrt(maxPx / (w * h));
    w = Math.max(1, Math.floor(w * ratio));
    h = Math.max(1, Math.floor(h * ratio));
    while (w * h > maxPx) { if (w > h) w--; else h--; }
    return { x, y, w, h, capped: true };
  }

  function positionClaimPreview() {
    if (!claimDragging || !claimStart) { claimPreview.hidden = true; return; }
    const { x, y } = screenToPixel(lastMouse.x, lastMouse.y);
    const maxPx = currentUser?.territoryPixels ?? 0;
    const rect = capClaimRect(claimStart.x, claimStart.y, x, y, maxPx);
    const tl = pixelToScreen(rect.x, rect.y);
    claimPreview.hidden = false;
    claimPreview.style.left = tl.x + 'px';
    claimPreview.style.top = tl.y + 'px';
    claimPreview.style.width = rect.w * scale + 'px';
    claimPreview.style.height = rect.h * scale + 'px';
    const invalid = overlapsOwnTerritory(rect) || overlapsEnemyTerritory(rect);
    claimPreview.style.borderColor = invalid
      ? '#ef476f'
      : (currentUser?.claimColor || '#7c3aed');
    claimPreview.classList.toggle('claim-preview--invalid', invalid);
    let status = `${rect.w}×${rect.h} = ${rect.w * rect.h} px${rect.capped ? ' · LÍMITE alcanzado' : ''}`;
    if (overlapsOwnTerritory(rect)) status = 'Solapa con tu territorio';
    else if (overlapsEnemyTerritory(rect)) status = 'Solapa con territorio de otro jugador';
    claimStatus.textContent = status;
  }

  function updateCursorPreview(sx, sy) {
    const { x, y } = screenToPixel(sx, sy);
    hoverCoord = { x, y };
    coordDisplay.textContent = `(${x}, ${y})`;
    const rect = wrap.getBoundingClientRect();
    if (!claimDragging) {
      cursorPreview.hidden = claimMode;
      cursorPreview.style.background = selectedColor;
      cursorPreview.style.left = (rect.left + offsetX + x * scale) + 'px';
      cursorPreview.style.top = (rect.top + offsetY + y * scale) + 'px';
      cursorPreview.style.width = Math.max(scale, 4) + 'px';
      cursorPreview.style.height = Math.max(scale, 4) + 'px';
      cursorPreview.style.position = 'fixed';
      const prog = chiselLocal.get(metaKey(Math.trunc(x), Math.trunc(y)));
      if (chiselBadge && prog && currentUser && !claimMode) {
        chiselBadge.hidden = false;
        chiselBadge.textContent = `${prog.current}/${prog.required}`;
        positionChiselBadge(
          rect.left + offsetX + x * scale + Math.max(scale, 4) / 2,
          rect.top + offsetY + y * scale,
        );
      } else if (chiselBadge) chiselBadge.hidden = true;
    }
    if (!claimMode && !isPanning && !isDrawing) showPixelCard(sx, sy, x, y);
    else if (isPanning || isDrawing) hidePixelCard();
    if (claimDragging) positionClaimPreview();
  }

  function hidePixelCard() {
    pixelCard.hidden = true;
    pixelCard.innerHTML = '';
  }

  function showPixelCard(sx, sy, x, y) {
    const meta = pixelMeta.get(metaKey(x, y));
    if (!meta?.n) {
      hidePixelCard();
      return;
    }

    const terr = territories.find((t) => x >= t.x && x < t.x + t.w && y >= t.y && y < t.y + t.h);

    let terrHtml = '';
    if (terr) {
      terrHtml = `<span class="pixel-card__zone" style="color:${terr.color || terr.clanColor}">${terr.underSiege ? '⚔ ' : '🛡 '}${escapeHtml(terr.ownerName || terr.clanName)}</span>`;
    }

    if (typeof ProfileCosmetics !== 'undefined') {
      const built = ProfileCosmetics.buildPixelCardHTML(meta, x, y, terrHtml);
      pixelCard.className = 'pixel-card' + (built.cos ? ' pixel-card--styled' : '');
      if (built.cos) pixelCard.style.cssText = ProfileCosmetics.cssVars(built.cos);
      else pixelCard.style.cssText = '';
      pixelCard.innerHTML = built.html;
    } else {
      let body = `<span class="pixel-card__name">${escapeHtml(meta.n)}</span>`;
      if (terrHtml) body += terrHtml;
      pixelCard.innerHTML = `
        <img class="pixel-card__avatar" src="${meta.a}" alt="" />
        <div class="pixel-card__body">${body}<span class="pixel-card__coords">${x}, ${y}</span></div>
        <span class="pixel-card__color" style="background:${meta.c}"></span>`;
    }

    pixelCard.hidden = false;
    let left = sx + 14, top = sy + 14;
    if (left + 200 > window.innerWidth - 8) left = sx - 200;
    if (top + 60 > window.innerHeight - 8) top = sy - 60;
    pixelCard.style.left = left + 'px';
    pixelCard.style.top = top + 'px';
  }

  function tryDrawAt(sx, sy) {
    if (!currentUser || claimMode) return;
    if (!canPlacePixels()) {
      showToast('Sin píxeles disponibles. Espera la recarga.', true);
      return;
    }
    const { x, y } = screenToPixel(sx, sy);
    const px = Math.trunc(x);
    const py = Math.trunc(y);
    const key = metaKey(px, py);
    if (key === lastDrawKey) return;
    lastDrawKey = key;
    const color = String(selectedColor).trim().toUpperCase();
    if (!colorIsUnlocked(color)) {
      showToast('Color no disponible. Elige negro/blanco o compra en Tienda.', true);
      normalizeSelectedColor();
      buildPalette();
      return;
    }
    socket.emit('place_pixel', {
      x: px,
      y: py,
      color,
      brush: currentUser.activeBrush ?? currentUser.brushState?.activeBrush ?? null,
      blockSize: currentUser.activeBlockSize || currentUser.brushState?.activeBlockSize || 1,
    });
    debouncedUpdateUrlCoords(px, py);
  }

  function placePixelAt(sx, sy) {
    if (!currentUser) return showToast('Inicia sesión con Discord', true);
    if (!canPlacePixels()) {
      showToast('Sin píxeles disponibles. Espera la recarga.', true);
      return;
    }
    tryDrawAt(sx, sy);
    lastDrawKey = null;
  }

  function finishClaim(sx, sy) {
    const { x, y } = screenToPixel(sx, sy);
    const maxPx = currentUser?.territoryPixels ?? 0;
    if (maxPx <= 0) {
      showToast('Sin píxeles de territorio. Cómpralos en la tienda.', true);
      claimDragging = false;
      claimPreview.hidden = true;
      return;
    }
    const rect = capClaimRect(claimStart.x, claimStart.y, x, y, maxPx);
    if (rect.w < 2 || rect.h < 2) {
      showToast('Área muy pequeña', true);
    } else if (overlapsOwnTerritory(rect)) {
      showToast('El área solapa con territorio que ya reclamaste', true);
    } else if (overlapsEnemyTerritory(rect)) {
      showToast('Solapa con territorio de otro jugador', true);
    } else {
      socket.emit('claim_territory', rect);
    }
    claimDragging = false;
    claimPreview.hidden = true;
    claimStatus.textContent = claimMode ? 'Arrastra en el mapa para marcar zona' : '';
  }

  wrap.addEventListener('mousemove', (e) => {
    lastMouse.x = e.clientX;
    lastMouse.y = e.clientY;
    if (isPanning) {
      offsetX = panStart.ox + (e.clientX - panStart.x);
      offsetY = panStart.oy + (e.clientY - panStart.y);
      applyTransform();
      return;
    }
    if (typeof PixelBlueprint !== 'undefined' && (blueprintDragging || PixelBlueprint.isDragging?.())) {
      const { x, y } = screenToPixel(e.clientX, e.clientY);
      if (PixelBlueprint.handlePointerMove(x, y)) return;
    }
    if (isDrawing && hasBrushCorrido() && !claimDragging) tryDrawAt(e.clientX, e.clientY);
    else if ((e.buttons & 1) && !hasBrushCorrido() && !claimDragging && !isPanning && drawPointerDown) {
      if (Math.hypot(e.clientX - drawPointerDown.x, e.clientY - drawPointerDown.y) > 8 && !brushDragHintShown) {
        brushDragHintShown = true;
        showToast('Compra Pincel corrido en la tienda (450🪙) para pintar arrastrando', true);
      }
      updateCursorPreview(e.clientX, e.clientY);
    }
    else updateCursorPreview(e.clientX, e.clientY);
  });

  wrap.addEventListener('mouseleave', () => {
    cursorPreview.hidden = true;
    hidePixelCard();
    isPanning = false;
    isDrawing = false;
    lastDrawKey = null;
    drawPointerDown = null;
    if (claimDragging) { claimDragging = false; claimPreview.hidden = true; }
  });

  wrap.addEventListener('dblclick', (e) => {
    if (!currentUser || claimMode || typeof Arcade === 'undefined') return;
    const { x, y } = screenToPixel(e.clientX, e.clientY);
    if (Arcade.tryLaunchAt?.(x, y)) {
      e.preventDefault();
      showToast('🎮 Minijuego iniciado en la zona del mapa');
    }
  });

  wrap.addEventListener('mousedown', (e) => {
    if (e.button === 1 || spaceHeld || e.button === 2) {
      isPanning = true;
      panStart = { x: e.clientX, y: e.clientY, ox: offsetX, oy: offsetY };
      hidePixelCard();
      e.preventDefault();
      return;
    }
    if (e.button !== 0) return;
    if (e.altKey && currentUser?.gadgets?.includes('eyedropper_pro')) {
      const { x, y } = screenToPixel(e.clientX, e.clientY);
      const c = getPixelColorAt(Math.trunc(x), Math.trunc(y));
      if (c) {
        if (colorIsUnlocked(c)) {
          selectColor(c);
          showToast(`Color ${c} seleccionado`);
        } else {
          showToast(`Color ${c} detectado — desbloquéalo en Tienda → Colores`, true);
        }
      } else showToast('No hay píxel en esta celda', true);
      e.preventDefault();
      return;
    }
    if (claimMode && currentUser) {
      claimDragging = true;
      claimStart = screenToPixel(e.clientX, e.clientY);
      e.preventDefault();
      return;
    }
    if (typeof PixelBlueprint !== 'undefined') {
      const { x, y } = screenToPixel(e.clientX, e.clientY);
      if (PixelBlueprint.handlePointerDown(x, y)) {
        blueprintDragging = true;
        wrap.classList.add('blueprint-dragging');
        e.preventDefault();
        return;
      }
    }
    drawPointerDown = { x: e.clientX, y: e.clientY };
    if (hasBrushCorrido()) {
      isDrawing = true;
      wrap.classList.add('is-drawing');
    }
    placePixelAt(e.clientX, e.clientY);
  });

  wrap.addEventListener('mouseup', (e) => {
    if (blueprintDragging && typeof PixelBlueprint !== 'undefined') {
      PixelBlueprint.handlePointerUp();
      blueprintDragging = false;
      wrap.classList.remove('blueprint-dragging');
    }
    if (claimDragging && e.button === 0) finishClaim(e.clientX, e.clientY);
    if (e.button === 0) {
      isDrawing = false;
      lastDrawKey = null;
      drawPointerDown = null;
      wrap.classList.remove('is-drawing');
      if (pendingUrlCoord) {
        clearTimeout(urlCoordsTimer);
        updateUrlCoords(pendingUrlCoord.x, pendingUrlCoord.y);
        pendingUrlCoord = null;
      }
      updateCursorPreview(lastMouse.x, lastMouse.y);
    }
    isPanning = false;
  });

  document.addEventListener('mouseup', () => {
    if (blueprintDragging && typeof PixelBlueprint !== 'undefined') {
      PixelBlueprint.handlePointerUp();
      blueprintDragging = false;
      wrap.classList.remove('blueprint-dragging');
    }
    isDrawing = false;
    lastDrawKey = null;
    drawPointerDown = null;
    wrap.classList.remove('is-drawing');
  });

  wrap.addEventListener('contextmenu', (e) => e.preventDefault());

  wrap.addEventListener('wheel', (e) => {
    e.preventDefault();
    const rect = wrap.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
    const wanted = scale * factor;
    const newScale = clampScale(wanted);
    maybeZoomLimitToast(wanted, newScale, factor < 1);
    offsetX = mx - (mx - offsetX) * (newScale / scale);
    offsetY = my - (my - offsetY) * (newScale / scale);
    scale = newScale;
    applyTransform();
  }, { passive: false });

  document.addEventListener('keydown', (e) => {
    if (e.code === 'Space') { spaceHeld = true; e.preventDefault(); }
    if (e.code === 'KeyC' && !e.ctrlKey) copyCoordLink();
    const num = parseInt(e.key, 10);
    if (num >= 1 && num <= 9 && availableColors[num - 1]) {
      const btn = paletteEl.querySelector(`[data-color="${availableColors[num - 1]}"]`);
      selectColor(availableColors[num - 1], btn);
    }
  });
  document.addEventListener('keyup', (e) => { if (e.code === 'Space') spaceHeld = false; });

  document.getElementById('zoom-in').addEventListener('click', () => {
    scale = clampScale(scale * 1.3);
    applyTransform();
  });
  document.getElementById('zoom-out').addEventListener('click', () => {
    const wanted = scale / 1.3;
    const next = clampScale(wanted);
    maybeZoomLimitToast(wanted, next, true);
    scale = next;
    applyTransform();
  });
  document.getElementById('zoom-reset').addEventListener('click', () => {
    goToCoords(0, 0, clampScale(4));
  });

  minimap.addEventListener('click', (e) => {
    const rect = minimap.getBoundingClientRect();
    const mx = (e.clientX - rect.left) / rect.width;
    const my = (e.clientY - rect.top) / rect.height;
    const center = getViewCenterWorld();
    const worldX = center.x - MINIMAP_RADIUS + mx * (MINIMAP_RADIUS * 2);
    const worldY = center.y - MINIMAP_RADIUS + my * (MINIMAP_RADIUS * 2);
    goToCoords(worldX, worldY, scale);
  });

  window.addEventListener('resize', handleWindowResize);

  const params = new URLSearchParams(location.search);
  const authErr = params.get('error');
  const authMessages = {
    auth_failed: 'Discord rechazó el login. Revisa Redirect URI y Client Secret en Developer Portal.',
    redirect_uri: 'Redirect URI incorrecta. Añade http://localhost:3000/auth/discord/callback en Discord → OAuth2 → Redirects.',
    invalid_secret: 'Client Secret incorrecto. Copia el secret nuevo de Discord Developer Portal a tu .env y reinicia el servidor.',
    invalid_grant: 'Código de login expirado o ya usado. Cierra Discord, vuelve a localhost:3000 e intenta otra vez.',
    no_code: 'Discord no devolvió código de autorización.',
  };
  if (authErr && authMessages[authErr]) showToast(authMessages[authErr], true);
  else if (authErr) showToast('Error al iniciar sesión con Discord', true);

  restoreFromStorage();

  loadShopCatalog().then(() => {
    if (shopCatalogLoaded) renderShop(null, null);
  });

  fetch('/api/me', { credentials: 'include', cache: 'no-store' }).then((r) => r.json()).then((data) => {
    if (!shopCatalogLoaded) applyShopCatalog(data.shop, data.shopCategories);
    if (data.freeColors?.length) freeColors = data.freeColors.map((c) => String(c).toUpperCase());
    if (data.loggedIn) {
      renderAuth(data.user);
      updateQuotaUI(data.quota);
      renderMissions(data.missions);
      persistUserState(data.quota, data.missions);
    } else {
      renderAuth(null);
      if (data.availableColors?.length) {
        availableColors = data.availableColors.map((c) => String(c).toUpperCase());
      }
      if (!hasSessionCookie()) PMStorage.saveUser(null);
    }
    if (data.tycoonUpgrades?.length) tycoonUpgrades = data.tycoonUpgrades;
    if (data.zoomLens?.maxLevel) zoomLensMaxLevel = data.zoomLens.maxLevel;
    renderShop(null, null);
    if (parseUrlNavigation()) whenLayoutReady(() => applyUrlNavigation());
  });

  socket.on('init', (data) => {
    if (data.zoomLens?.maxLevel) zoomLensMaxLevel = data.zoomLens.maxLevel;
    initCanvas();
    loadPixels(data.pixels);
    territories = data.territories || [];
    PMStorage.set('territories', territories);
    drawTerritories();
    renderTerritoryList();
    if (data.user) renderAuth(data.user);
    updateQuotaUI(data.quota);
    renderMissions(data.missions);
    if (data.tycoonUpgrades?.length) tycoonUpgrades = data.tycoonUpgrades;
    if (!shopCatalogLoaded && data.shop?.length) {
      applyShopCatalog(data.shop, data.shopCategories);
    }
    if (data.user?.tycoon) updateTycoonUI(data.user.tycoon);
    onlineCount.textContent = data.online;
    if (data.paintZones?.length || data.arcadeGames?.length) {
      ensureArcadeInit({
        paintZones: data.paintZones,
        arcadeGames: data.arcadeGames,
        reflex: data.reflex,
      });
    }
    if (data.arcadeLive?.length) {
      arcadeLive = data.arcadeLive;
      scheduleRender();
    }
    buildPalette();
    selectColor(selectedColor);
    applyClaimModeUI();
    restoreInitialViewport(data.spawn);

    persistUserState(data.quota, data.missions);
  });

  socket.on('pixel', (p) => {
    chiselLocal.delete(metaKey(p.x, p.y));
    setPixel(p.x, p.y, p.c, p);
  });
  socket.on('chisel_progress', ({ x, y, current, required, color, combo }) => {
    chiselLocal.set(metaKey(x, y), { current, required, color, comboFlash: combo, updatedAt: Date.now() });
    if (combo) flashChiselCombo();
    scheduleRender();
    updateCursorPreview(lastMouse.x, lastMouse.y);
  });
  socket.on('chisel_clear', ({ x, y }) => {
    chiselLocal.delete(metaKey(x, y));
    scheduleRender();
    updateCursorPreview(lastMouse.x, lastMouse.y);
  });
  socket.on('passive_income', ({ earned }) => {
    const txt = typeof NumberFormat !== 'undefined'
      ? NumberFormat.formatCompact(earned, { threshold: 1000, digits: 1 })
      : earned;
    showToast(`⚡ Idle +${txt}🪙`);
  });
  socket.on('tycoon', (t) => updateTycoonUI(t));
  socket.on('tycoon_level', ({ level, bonusCoins }) => {
    const lv = fmtLevel((level ?? 0) + 1);
    const bonus = bonusCoins
      ? ` +${typeof NumberFormat !== 'undefined' ? NumberFormat.formatCompact(bonusCoins, { threshold: 1_000_000, digits: 2 }) : bonusCoins}🪙`
      : '';
    showToast(`¡Nivel ${lv}!${bonus}`);
  });
  socket.on('online', (n) => { onlineCount.textContent = n; });
  socket.on('quota', (q) => updateQuotaUI(q));
  socket.on('wallet', (w) => { updateWallet(w); updateTerritoryUI(); });
  socket.on('missions', (m) => renderMissions(m));
  socket.on('mission_complete', ({ reward }) => showToast(`¡Misión completada! +${reward}🪙`));
  socket.on('error_msg', ({ message }) => showToast(message, true));
  socket.on('claim_limit', ({ message }) => showToast(message, true));
  socket.on('claim_result', ({ message, capped, territory }) => {
    if (territory) {
      if (!territories.find((x) => x.id === territory.id)) territories.push(territory);
      PMStorage.set('territories', territories);
      drawTerritories();
      renderTerritoryList();
      goToTerritory(territory);
      showToast(`${message} · Guardada en (${territory.x}, ${territory.y})`);
    } else {
      showToast(message, capped);
    }
    fetch('/api/me', { credentials: 'include' }).then((r) => r.json()).then((d) => {
      if (d.user) {
        currentUser = d.user;
        updateTerritoryUI();
        coinsCount.textContent = d.user.coins;
      }
    });
  });
  socket.on('territory_new', (t) => {
    if (!territories.find((x) => x.id === t.id)) territories.push(t);
    drawTerritories();
    renderTerritoryList();
  });
  socket.on('territories', (list) => {
    territories = list;
    PMStorage.set('territories', list);
    drawTerritories();
    renderTerritoryList();
  });
  socket.on('territory_update', (t) => {
    const i = territories.findIndex((x) => x.id === t.id);
    if (i >= 0) territories[i] = t;
    drawTerritories();
    renderTerritoryList();
  });
  socket.on('siege_start', ({ attacker }) => showToast(`⚔ Asedio contra ${attacker}!`, false));
  socket.on('siege_end', ({ captured, winner }) => {
    showToast(captured ? `¡${winner} conquistó el territorio!` : 'Asedio terminado sin conquista');
  });
  socket.on('arcade_live', (data) => {
    arcadeLive = data?.players || [];
    scheduleRender();
  });

  socket.on('disconnect', () => showToast('Desconectado — reconectando…', true));

  window.addEventListener('load', () => {
    loadBlueprintConfig();
    fetch('/api/minigames')
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data) => ensureArcadeInit(data))
      .catch(() => {
        ensureArcadeInit({ paintZones, arcadeGames: Arcade?.getGames?.() || [] });
      });
    if (parseUrlNavigation()) whenLayoutReady(() => applyUrlNavigation());
  });

  window.addEventListener('pm:bookmark-save', () => {
    if (!currentUser || !GadgetEffects?.hasGadget(currentUser, 'coord_bookmark')) return;
    const center = getViewCenterWorld();
    GadgetEffects.addBookmark(center.x, center.y);
    GadgetEffects.renderBookmarks((x, y) => goToCoords(x, y, scale));
    showToast(`Marcador guardado (${Math.trunc(center.x)}, ${Math.trunc(center.y)})`);
  });

  socket.connect();
})();
