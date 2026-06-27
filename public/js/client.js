(function () {
  'use strict';

  const canvas = document.getElementById('canvas');
  const ctx = canvas.getContext('2d', { alpha: false });
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
  const modals = {
    territory: document.getElementById('modal-territory'),
    missions: document.getElementById('modal-missions'),
    shop: document.getElementById('modal-shop'),
  };

  const MINIMAP_SIZE = 160;
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
    zoom_lens: '🔭',
  };

  const CHUNK_SIZE = 128;
  const MINIMAP_RADIUS = 220;

  let selectedColor = '#000000';
  let availableColors = [...(window.FREE_COLORS || ['#000000', '#FFFFFF'])];
  let freeColors = [...(window.FREE_COLORS || ['#000000', '#FFFFFF'])];
  let scale = 1;
  let zoomLensMaxLevel = 10;
  let zoomLimitToastAt = 0;
  let offsetX = 0;
  let offsetY = 0;
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
  let chiselComboTimer = null;
  let territories = [];
  let claimMode = false;
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
  let saveViewportTimer = null;
  let renderScheduled = false;
  let minimapScheduled = false;
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

  const socket = io({ withCredentials: true });

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
    if (lvlEl) lvlEl.textContent = String(t.level + 1);
    if (clicksEl) {
      clicksEl.textContent = t.clicksRequired <= 1 ? '1 clic/celda ✓' : `${t.clicksRequired} clics/celda`;
    }
    const pct = t.xpNext > 0 ? Math.min(100, (t.xpCurrent / t.xpNext) * 100) : 100;
    if (xpFill) xpFill.style.width = `${pct}%`;
    if (xpText) xpText.textContent = `${t.xpCurrent} / ${t.xpNext} XP`;
    if (passiveEl) {
      if (t.passivePerMin > 0) {
        passiveEl.hidden = false;
        passiveEl.textContent = `⚡ +${t.passivePerMin}🪙/min mientras no pintas`;
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
    const tier = item.levels?.[lvl];
    if (tier?.price != null) return tier.price;
    const base = item.basePrice ?? item.price ?? 100;
    const growth = item.priceGrowth ?? 1.4;
    return Math.floor(base * growth ** lvl);
  }

  function leveledMaxLevel(item) {
    return item.levels?.length || item.maxLevel || zoomLensMaxLevel;
  }

  function getShopLevel(item) {
    return currentUser?.shopLevels?.[item.upgradeKey || item.id] || 0;
  }

  function getNextLeveledTier(item) {
    return item.levels?.[getShopLevel(item)] || null;
  }

  function leveledStockLabel(item, lvl) {
    if (item.id === 'zoom_lens') {
      const next = computeZoomLimits(lvl + 1);
      return `Actual nv.${lvl} → nv.${lvl + 1} · alejar ${Math.round(next.minScale * 100)}%`;
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
      if (lvl >= max) {
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
    let stockLabel = null;
    if (item.type === 'item' && item.item) {
      const n = currentUser.inventory?.[item.item] || 0;
      if (n > 0) stockLabel = `En inventario: ${n}`;
    }
    if (coins < item.price) {
      return { state: 'poor', label: `Te faltan ${item.price - coins}🪙`, stockLabel };
    }
    return { state: 'afford', label: null, stockLabel };
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
    let effect = '';
    if (def.key === 'chisel') {
      const next = Math.max(1, 10 - owned - 1);
      effect = maxed ? '1 clic por celda vacía' : `Próximo: ${next} clics/celda`;
    } else if (def.key === 'quota') {
      effect = `+${(maxed ? owned : owned + 1) * 120} px por recarga`;
    } else if (def.key === 'combo') {
      effect = maxed ? `Combo +${owned} extra` : `Combo +${owned + 1} extra`;
    } else if (def.key === 'passive') {
      effect = `${(maxed ? owned : owned + 1) * 3}🪙/min idle`;
    } else if (def.key === 'coin_mult') {
      effect = `+${Math.round((maxed ? owned : owned + 1) * 12)}% monedas`;
    } else if (def.key === 'xp_boost') {
      effect = `+${Math.round((maxed ? owned : owned + 1) * 20)}% XP`;
    }

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
      kind = `Mejorable · nv.${lvl}/${max}`;
      const next = getNextLeveledTier(item);
      if (next) {
        cardDesc = lvl === 0
          ? `Primer desbloqueo: ${next.name}.`
          : `Siguiente nivel: ${next.name}.`;
      }
    }
    const affordClass = status.state === 'afford' ? ' shop-card--can-buy' : '';
    const ownedClass = status.state === 'owned' ? ' shop-card--owned' : '';

    let action = '';
    if (status.state === 'owned') {
      action = '<span class="shop-card__owned">Nivel máximo ✓</span>';
    } else if (!currentUser) {
      action = '<span class="shop-card__locked">Inicia sesión con Discord</span>';
    } else if (status.state === 'poor') {
      action = `<span class="shop-card__missing">${escapeHtml(status.label)}</span>`;
    } else if (item.type === 'leveled') {
      const price = status.leveledPrice ?? leveledItemPrice(item);
      const lvl = getShopLevel(item);
      action = `<button type="button" class="btn btn--sm btn--buy" data-buy="${item.id}">${lvl === 0 ? 'Comprar' : 'Subir'} nv.${lvl + 1} · ${price}🪙</button>`;
    } else {
      action = `<button type="button" class="btn btn--sm btn--buy" data-buy="${item.id}">Comprar · ${item.price}🪙</button>`;
    }

    const price = item.type === 'leveled' && status.state !== 'owned'
      ? (status.leveledPrice ?? leveledItemPrice(item))
      : item.price;
    const priceLabel = status.state === 'owned' && item.type === 'leveled' ? '' : `${price}🪙`;
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
  document.querySelectorAll('[data-close-modal]').forEach((btn) => {
    btn.addEventListener('click', closeModals);
  });
  modalOverlay.addEventListener('click', (e) => {
    if (e.target === modalOverlay) closeModals();
  });
  document.addEventListener('keydown', (e) => {
    if (e.code === 'Escape') closeModals();
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
    if (savedUserCache?.user && !currentUser) {
      renderAuth(savedUserCache.user);
      if (savedUserCache.quota) updateQuotaUI(savedUserCache.quota);
      if (savedUserCache.missions) renderMissions(savedUserCache.missions);
    }
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
      coinsCount.textContent = data.coins;
      if (currentUser) currentUser.coins = data.coins;
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
    quotaStat.hidden = false;
    quotaCount.textContent = `${quota.remaining}/${quota.max}`;
    cooldownLabel.textContent = quota.max;
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
    const totalSec = Math.ceil(resetIn / 1000);
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    cooldownTimer.textContent = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
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
      syncColorAccess(null);
      updateDrawModeHint();
      buildPalette();
      return;
    }
    syncColorAccess(user);
    authArea.innerHTML = `
      <div class="user-chip">
        <img src="${user.avatar}" alt="" class="user-chip__avatar" />
        <span class="user-chip__name">${escapeHtml(user.username)}</span>
        <a href="/auth/logout" class="user-chip__logout" title="Cerrar sesión" id="logout-btn">×</a>
      </div>`;
    coinsStat.hidden = false;
    coinsCount.textContent = user.coins ?? 0;
    if (claimColorInput && user.claimColor) claimColorInput.value = user.claimColor;
    updateTerritoryUI();
    updateDrawModeHint();
    updateTycoonUI(user?.tycoon);
    buildPalette();
    updateZoomLensUI();
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
    territoryList.innerHTML = territories.map((t) => {
      const own = currentUser && t.ownerId === currentUser.id;
      const siege = t.underSiege ? `<span class="siege-badge">⚔ Asedio</span>` : '';
      const btn = !own && currentUser
        ? `<button type="button" class="btn btn--sm btn--siege" data-siege="${t.id}">Asediar (75🪙)</button>`
        : '';
      return `<div class="territory-item" style="--clan-color:${t.color}">
        <span>${escapeHtml(t.ownerName)}</span>
        <span class="territory-item__size">${t.w}×${t.h} · ${t.w * t.h}px</span>
        ${siege}${btn}
      </div>`;
    }).join('');
    territoryList.querySelectorAll('[data-siege]').forEach((btn) => {
      btn.addEventListener('click', () => startSiege(btn.dataset.siege));
    });
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
          const tier = bought.levels?.[lvl - 1];
          showToast(tier ? `¡Nv.${lvl} desbloqueado: ${tier.name}!` : `¡Nivel ${lvl} desbloqueado!`);
        } else if (bought?.type === 'color') {
          showToast(`Color ${bought.hex} añadido a tu paleta`);
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
    persistPrefs();
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
    resizeViewportCanvas();
    applyTransform();
  }

  function resizeViewportCanvas() {
    const rect = wrap.getBoundingClientRect();
    viewportDpr = Math.min(window.devicePixelRatio || 1, 2);
    const cw = Math.max(1, Math.floor(rect.width * viewportDpr));
    const ch = Math.max(1, Math.floor(rect.height * viewportDpr));
    if (canvas.width !== cw || canvas.height !== ch) {
      canvas.width = cw;
      canvas.height = ch;
      territoryLayer.width = cw;
      territoryLayer.height = ch;
    }
  }

  function scheduleRender() {
    if (renderScheduled) return;
    renderScheduled = true;
    requestAnimationFrame(() => {
      renderScheduled = false;
      renderViewport();
      renderMinimapViewport();
      updateCursorPreview(lastMouse.x, lastMouse.y);
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

    ctx.fillStyle = '#1a1a2e';
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
        const dx = (wx * scale + offsetX) * dpr;
        const dy = (wy * scale + offsetY) * dpr;
        const dw = CHUNK_SIZE * scale * dpr;
        const dh = CHUNK_SIZE * scale * dpr;
        ctx.drawImage(chunk.canvas, dx, dy, dw, dh);
      }
    }

    drawOriginGuides(dpr);
    drawChiselOverlays(dpr);

    if (showTerritoryFrames) {
      drawMergedTerritoryOutlines(tctx, scale * dpr, scale * dpr, offsetX * dpr, offsetY * dpr, { normal: 0.22, siege: 0.4 });
    }
  }

  function drawChiselOverlays(dpr) {
    if (!chiselLocal.size) return;
    for (const [key, prog] of chiselLocal) {
      const [x, y] = key.split(',').map(Number);
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
    history.replaceState(null, '', `?${params}`);
    PMStorage.saveViewport({ scale, offsetX, offsetY, x, y });
  }

  function copyCoordLink() {
    const { x, y } = hoverCoord;
    const url = `${location.origin}${location.pathname}?x=${x}&y=${y}&z=${Math.round(scale * 10) / 10}`;
    navigator.clipboard.writeText(url).then(() => showToast('Enlace copiado'));
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
  }

  function loadPixels(pixels) {
    pixelMeta.clear();
    pixelChunks.clear();
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

    minimapBaseCtx.fillStyle = '#1a1a2e';
    minimapBaseCtx.fillRect(0, 0, MINIMAP_SIZE, MINIMAP_SIZE);

    const pxMin = center.x - r;
    const pxMax = center.x + r;
    const pyMin = center.y - r;
    const pyMax = center.y + r;

    for (const [key, meta] of pixelMeta) {
      const [px, py] = key.split(',').map(Number);
      if (px < pxMin || px > pxMax || py < pyMin || py > pyMax) continue;
      const mx = (px - center.x + r) * sx;
      const my = (py - center.y + r) * sx;
      minimapBaseCtx.fillStyle = meta.c || '#ffffff';
      minimapBaseCtx.fillRect(Math.floor(mx), Math.floor(my), Math.max(1, Math.ceil(sx)), Math.max(1, Math.ceil(sy)));
    }

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

  function renderMinimapViewport() {
    minimapCtx.drawImage(minimapBase, 0, 0);
    const center = getViewCenterWorld();
    const r = MINIMAP_RADIUS;
    const span = r * 2;
    const sx = MINIMAP_SIZE / span;
    const { x0, y0, x1, y1 } = getVisibleWorldBounds();
    const vx = (x0 - center.x + r) * sx;
    const vy = (y0 - center.y + r) * sx;
    const vw = (x1 - x0) * sx;
    const vh = (y1 - y0) * sx;
    minimapCtx.strokeStyle = 'rgba(124, 58, 237, 0.9)';
    minimapCtx.lineWidth = 1.5;
    minimapCtx.strokeRect(vx, vy, vw, vh);
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

    let body = `<span class="pixel-card__name">${escapeHtml(meta.n)}</span>`;
    if (terr) {
      body += `<span class="pixel-card__zone" style="color:${terr.color || terr.clanColor}">${terr.underSiege ? '⚔ ' : '🛡 '}${escapeHtml(terr.ownerName || terr.clanName)}</span>`;
    }

    pixelCard.innerHTML = `
      <img class="pixel-card__avatar" src="${meta.a}" alt="" />
      <div class="pixel-card__body">${body}<span class="pixel-card__coords">${x}, ${y}</span></div>
      <span class="pixel-card__color" style="background:${meta.c}"></span>`;

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
    socket.emit('place_pixel', { x: px, y: py, color });
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

  wrap.addEventListener('mousedown', (e) => {
    if (e.button === 1 || spaceHeld || e.button === 2) {
      isPanning = true;
      panStart = { x: e.clientX, y: e.clientY, ox: offsetX, oy: offsetY };
      hidePixelCard();
      e.preventDefault();
      return;
    }
    if (e.button !== 0) return;
    if (claimMode && currentUser) {
      claimDragging = true;
      claimStart = screenToPixel(e.clientX, e.clientY);
      e.preventDefault();
      return;
    }
    drawPointerDown = { x: e.clientX, y: e.clientY };
    if (hasBrushCorrido()) {
      isDrawing = true;
      wrap.classList.add('is-drawing');
    }
    placePixelAt(e.clientX, e.clientY);
  });

  wrap.addEventListener('mouseup', (e) => {
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

  window.addEventListener('resize', () => applyTransform());

  const params = new URLSearchParams(location.search);
  if (params.get('error')) showToast('Error al iniciar sesión con Discord', true);
  const urlX = params.get('x');
  const urlY = params.get('y');
  const urlZ = params.get('z');

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
      PMStorage.saveUser(null);
    }
    if (data.tycoonUpgrades?.length) tycoonUpgrades = data.tycoonUpgrades;
    if (data.zoomLens?.maxLevel) zoomLensMaxLevel = data.zoomLens.maxLevel;
    renderShop(null, null);
  });

  socket.on('init', (data) => {
    if (data.zoomLens?.maxLevel) zoomLensMaxLevel = data.zoomLens.maxLevel;
    initCanvas();
    loadPixels(data.pixels);
    territories = data.territories || [];
    drawTerritories();
    if (data.user) renderAuth(data.user);
    updateQuotaUI(data.quota);
    renderMissions(data.missions);
    if (data.tycoonUpgrades?.length) tycoonUpgrades = data.tycoonUpgrades;
    if (!shopCatalogLoaded && data.shop?.length) {
      applyShopCatalog(data.shop, data.shopCategories);
    }
    if (data.user?.tycoon) updateTycoonUI(data.user.tycoon);
    onlineCount.textContent = data.online;
    buildPalette();
    selectColor(selectedColor);
    applyClaimModeUI();

    const hasUrlCoords = urlX != null && urlY != null;
    if (hasUrlCoords) {
      setTimeout(() => goToCoords(Number(urlX), Number(urlY), urlZ ? Number(urlZ) : null), 100);
    } else if (savedViewport) {
      setTimeout(() => {
        if (savedViewport.scale) scale = savedViewport.scale;
        if (savedViewport.offsetX != null) offsetX = savedViewport.offsetX;
        if (savedViewport.offsetY != null) offsetY = savedViewport.offsetY;
        applyTransform();
        if (savedViewport.x != null && savedViewport.y != null) {
          hoverCoord = { x: savedViewport.x, y: savedViewport.y };
          coordDisplay.textContent = `(${savedViewport.x}, ${savedViewport.y})`;
        }
      }, 100);
    } else {
      setTimeout(() => goToCoords(data.spawn?.x ?? 0, data.spawn?.y ?? 0, 4), 100);
    }

    const cachedTerritories = PMStorage.get('territories');
    if (cachedTerritories?.length && !territories.length) {
      territories = cachedTerritories;
      drawTerritories();
    }
    persistUserState(data.quota, data.missions);
  });

  socket.on('pixel', (p) => {
    chiselLocal.delete(metaKey(p.x, p.y));
    setPixel(p.x, p.y, p.c, p);
  });
  socket.on('chisel_progress', ({ x, y, current, required, color, combo }) => {
    chiselLocal.set(metaKey(x, y), { current, required, color, comboFlash: combo });
    if (combo) flashChiselCombo();
    scheduleRender();
    updateCursorPreview(lastMouse.x, lastMouse.y);
  });
  socket.on('tycoon', (t) => updateTycoonUI(t));
  socket.on('tycoon_level', ({ level, bonusCoins }) => {
    showToast(`¡Nivel ${level + 1}!${bonusCoins ? ` +${bonusCoins}🪙` : ''}`);
  });
  socket.on('online', (n) => { onlineCount.textContent = n; });
  socket.on('quota', (q) => updateQuotaUI(q));
  socket.on('wallet', (w) => { updateWallet(w); updateTerritoryUI(); });
  socket.on('missions', (m) => renderMissions(m));
  socket.on('mission_complete', ({ reward }) => showToast(`¡Misión completada! +${reward}🪙`));
  socket.on('error_msg', ({ message }) => showToast(message, true));
  socket.on('claim_limit', ({ message }) => showToast(message, true));
  socket.on('claim_result', ({ message, capped, territory }) => {
    showToast(message, capped);
    if (territory) {
      territories.push(territory);
      drawTerritories();
      renderTerritoryList();
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
  socket.on('disconnect', () => showToast('Desconectado — reconectando…', true));
})();
