(function (global) {
  'use strict';

  let compassEl = null;
  let bookmarkPanel = null;

  function hasGadget(user, id) {
    return Boolean(user?.gadgets?.includes(id));
  }

  function applyNightMode(on) {
    document.body.classList.toggle('gadget-night-mode', on);
  }

  function applyZoomGrid(on) {
    document.body.classList.toggle('gadget-zoom-grid', on);
  }

  function ensureCompass() {
    if (compassEl) return compassEl;
    const wrap = document.getElementById('canvas-wrap');
    if (!wrap) return null;
    compassEl = document.createElement('div');
    compassEl.className = 'compass-hud';
    compassEl.innerHTML = '<span>N</span><span class="compass-hud__mid"><b>E</b><b>O</b></span><span>S</span>';
    wrap.appendChild(compassEl);
    return compassEl;
  }

  function applyCompass(on) {
    const el = ensureCompass();
    if (el) el.hidden = !on;
  }

  function ensureBookmarkPanel() {
    if (bookmarkPanel) return bookmarkPanel;
    const sidebar = document.querySelector('.sidebar');
    if (!sidebar) return null;
    bookmarkPanel = document.createElement('section');
    bookmarkPanel.className = 'panel panel--bookmarks';
    bookmarkPanel.id = 'bookmark-panel';
    bookmarkPanel.innerHTML = `
      <h2>Marcadores</h2>
      <p class="panel-desc">Guarda hasta 10 puntos favoritos del mapa.</p>
      <button type="button" class="btn btn--sm btn--ghost" id="bookmark-save">📌 Guardar aquí</button>
      <div id="bookmark-list" class="bookmark-list"></div>`;
    const mini = document.getElementById('tab-nav') || sidebar.querySelector('.sidebar-panels');
    if (mini) mini.appendChild(bookmarkPanel);
    else sidebar.appendChild(bookmarkPanel);
    bookmarkPanel.querySelector('#bookmark-save')?.addEventListener('click', () => {
      global.dispatchEvent(new CustomEvent('pm:bookmark-save'));
    });
    return bookmarkPanel;
  }

  function loadBookmarks() {
    try {
      return JSON.parse(localStorage.getItem('pixelmania_bookmarks') || '[]');
    } catch {
      return [];
    }
  }

  function saveBookmarks(list) {
    localStorage.setItem('pixelmania_bookmarks', JSON.stringify(list.slice(0, 10)));
  }

  function renderBookmarks(onGo) {
    const panel = ensureBookmarkPanel();
    if (!panel) return;
    const listEl = panel.querySelector('#bookmark-list');
    const marks = loadBookmarks();
    if (!listEl) return;
    if (!marks.length) {
      listEl.innerHTML = '<p class="panel-desc">Sin marcadores aún.</p>';
      return;
    }
    listEl.innerHTML = marks.map((m, i) => (
      `<div class="bookmark-item">
        <span>${m.label || `Punto ${i + 1}`} · (${m.x}, ${m.y})</span>
        <button type="button" class="btn btn--sm btn--ghost" data-bm-go="${i}">Ir</button>
        <button type="button" class="btn btn--sm btn--ghost" data-bm-del="${i}">×</button>
      </div>`
    )).join('');
    listEl.querySelectorAll('[data-bm-go]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const m = marks[Number(btn.dataset.bmGo)];
        if (m && onGo) onGo(m.x, m.y);
      });
    });
    listEl.querySelectorAll('[data-bm-del]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const i = Number(btn.dataset.bmDel);
        marks.splice(i, 1);
        saveBookmarks(marks);
        renderBookmarks(onGo);
      });
    });
  }

  function applyBookmarks(user, onGo) {
    const on = hasGadget(user, 'coord_bookmark');
    const panel = ensureBookmarkPanel();
    if (panel) panel.hidden = !on;
    if (on) renderBookmarks(onGo);
  }

  function applyTerritoryHighlight(on) {
    document.body.classList.toggle('gadget-territory-highlight', on);
  }

  function applyGadgetEffects(user, hooks) {
    applyNightMode(hasGadget(user, 'night_mode'));
    applyZoomGrid(hasGadget(user, 'zoom_grid'));
    applyCompass(hasGadget(user, 'compass_hud'));
    applyTerritoryHighlight(hasGadget(user, 'territory_highlight'));
    applyBookmarks(user, hooks?.goToCoords);
    if (bookmarkPanel) {
      bookmarkPanel.hidden = !hasGadget(user, 'coord_bookmark');
    }
  }

  function addBookmark(x, y, label) {
    const marks = loadBookmarks();
    marks.unshift({ x: Math.trunc(x), y: Math.trunc(y), label: label || '', at: Date.now() });
    saveBookmarks(marks);
    return marks;
  }

  global.GadgetEffects = {
    applyGadgetEffects,
    hasGadget,
    addBookmark,
    renderBookmarks,
    loadBookmarks,
  };
})(window);
