/** Minijuegos arcade + UI */
(function () {
  'use strict';

  let deps = null;
  let zones = [];
  let games = [];
  let reflexConfig = null;
  let reflexSession = null;
  let reflexTimer = null;
  let reflexHits = 0;
  let reflexTarget = null;
  let uiBound = false;

  function init(options) {
    deps = options;
    zones = options.zones || [];
    games = options.games || [];
    reflexConfig = options.reflex || { durationMs: 15000 };
    if (typeof ArcadeGames !== 'undefined') {
      ArcadeGames.init({
        getUser: options.getUser,
        toast: options.toast,
        closeModals: options.closeModals,
        onUserUpdate: options.onUserUpdate,
        onWallet: options.onWallet,
      });
    }
    renderLeaderboard();
    renderArcadePanel();
    renderZonesList();
    renderGamesList();
  }

  function fmtCoins(n) {
    if (typeof NumberFormat !== 'undefined') {
      return NumberFormat.formatCompact(n, { threshold: 1_000_000, digits: 2 });
    }
    return String(n);
  }

  async function fetchLeaderboard() {
    try {
      const res = await fetch('/api/leaderboard/wealth');
      return await res.json();
    } catch (_) {
      return { rows: [] };
    }
  }

  async function renderLeaderboard() {
    const el = document.getElementById('leaderboard-list');
    if (!el) return;
    el.innerHTML = '<tr><td colspan="3" class="leaderboard-table__empty">…</td></tr>';
    const data = await fetchLeaderboard();
    if (!data.rows?.length) {
      el.innerHTML = '<tr><td colspan="3" class="leaderboard-table__empty">Sin datos</td></tr>';
      return;
    }
    el.innerHTML = data.rows.map((r) => `
      <tr class="leaderboard-table__row${deps?.getUserId?.() === r.id ? ' leaderboard-table__row--you' : ''}">
        <td class="leaderboard-table__rank">${r.rank}</td>
        <td class="leaderboard-table__name" title="${escapeHtml(r.username)}">${escapeHtml(r.username)}</td>
        <td class="leaderboard-table__coins">${fmtCoins(r.coins)}</td>
      </tr>`).join('');
    const meta = document.getElementById('leaderboard-meta');
    if (meta) meta.textContent = `${data.totalPlayers || 0} jugadores · ${new Date(data.updatedAt).toLocaleTimeString()}`;
  }

  function renderGamesList() {
    const el = document.getElementById('arcade-games-list');
    if (!el) return;
    if (!games.length) {
      el.innerHTML = '<p class="panel-desc">Cargando juegos…</p>';
      return;
    }
    el.innerHTML = games.map((g) => `
      <div class="arcade-game-card">
        <strong>${g.icon || '🎮'} ${escapeHtml(g.name)}</strong>
        <p class="panel-desc panel-desc--tiny">${escapeHtml(g.desc || '')}</p>
        <p class="panel-desc panel-desc--tiny">${Math.round((g.durationMs || 0) / 1000)}s · cooldown ${Math.round((g.cooldownMs || 0) / 60000)} min</p>
        <button type="button" class="btn btn--sm btn--accent" data-play-game="${g.id}">▶ Jugar</button>
      </div>`).join('');
    el.querySelectorAll('[data-play-game]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.playGame;
        const game = games.find((x) => x.id === id);
        if (id === 'reflex') startReflex();
        else if (typeof ArcadeGames !== 'undefined') ArcadeGames.open(id, game);
      });
    });
  }

  function renderZonesList() {
    const el = document.getElementById('arcade-zones-list');
    if (!el) return;
    if (!zones.length) {
      el.innerHTML = '<p class="panel-desc">Sin zonas especiales cargadas.</p>';
      return;
    }
    el.innerHTML = zones.map((z) => `
      <div class="arcade-zone-card">
        <strong style="color:${z.color}">${escapeHtml(z.name)}</strong>
        <p class="panel-desc panel-desc--tiny">${z.w}×${z.h}${z.game ? ` · 🎮 ${escapeHtml(z.game)}` : ''} · ×${z.paintCoinMult} monedas</p>
        <p class="panel-desc panel-desc--tiny">(${z.x}, ${z.y}) · doble clic en el mapa para jugar</p>
        <button type="button" class="btn btn--sm btn--ghost" data-goto-zone="${z.x + Math.floor(z.w / 2)},${z.y + Math.floor(z.h / 2)}">📍 Ir</button>
        ${z.game ? `<button type="button" class="btn btn--sm btn--accent" data-zone-game="${z.game}" data-zone-id="${z.id}">▶ Jugar aquí</button>` : ''}
      </div>`).join('');
    el.querySelectorAll('[data-goto-zone]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const [x, y] = btn.dataset.gotoZone.split(',').map(Number);
        deps?.goTo?.(x, y);
        deps?.closeModals?.();
      });
    });
    el.querySelectorAll('[data-zone-game]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.zoneGame;
        const zone = zones.find((z) => z.id === btn.dataset.zoneId);
        const game = games.find((g) => g.id === id);
        if (zone) deps?.goTo?.(zone.x + Math.floor(zone.w / 2), zone.y + Math.floor(zone.h / 2));
        deps?.closeModals?.();
        if (id === 'reflex') startReflex();
        else if (typeof ArcadeGames !== 'undefined') ArcadeGames.open(id, game, { zone });
      });
    });
  }

  function renderArcadePanel() {
    const status = document.getElementById('reflex-status');
    if (status) status.textContent = reflexSession ? 'Partida en curso…' : 'Listo para jugar';
  }

  function spawnReflexTarget(container, retries = 0) {
    if (reflexTarget) reflexTarget.remove();
    const size = 44;
    const pad = 8;
    const w = container.clientWidth;
    const h = container.clientHeight;
    if (w < size + pad * 2 || h < size + pad * 2) {
      if (retries < 8) requestAnimationFrame(() => spawnReflexTarget(container, retries + 1));
      return;
    }
    const x = pad + Math.random() * (w - size - pad * 2);
    const y = pad + Math.random() * (h - size - pad * 2);
    reflexTarget = document.createElement('button');
    reflexTarget.type = 'button';
    reflexTarget.className = 'reflex-target';
    reflexTarget.style.left = `${x}px`;
    reflexTarget.style.top = `${y}px`;
    reflexTarget.addEventListener('click', (e) => {
      e.stopPropagation();
      reflexHits++;
      const score = document.getElementById('reflex-score');
      if (score) score.textContent = String(reflexHits);
      spawnReflexTarget(container);
    });
    container.appendChild(reflexTarget);
  }

  function isReflexOpen() {
    const overlay = document.getElementById('reflex-overlay');
    return overlay && !overlay.hidden;
  }

  function hideReflexOverlay() {
    const overlay = document.getElementById('reflex-overlay');
    if (overlay) overlay.hidden = true;
  }

  function isAnyGameOpen() {
    return isReflexOpen() || (typeof ArcadeGames !== 'undefined' && ArcadeGames.isOpen());
  }

  async function cancelReflex() {
    if (!isReflexOpen() && !reflexSession && !reflexTimer) return false;
    clearInterval(reflexTimer);
    reflexTimer = null;
    if (reflexTarget) { reflexTarget.remove(); reflexTarget = null; }
    hideReflexOverlay();
    const sessionId = reflexSession?.sessionId;
    reflexSession = null;
    reflexHits = 0;
    renderArcadePanel();
    if (sessionId) {
      try {
        await fetch('/api/minigame/reflex/cancel', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ sessionId }),
        });
      } catch (_) {}
    }
    return true;
  }

  async function startReflex() {
    if (!deps?.getUser?.()) {
      deps?.toast?.('Inicia sesión para jugar', true);
      return;
    }
    try {
      const res = await fetch('/api/minigame/reflex/start', { method: 'POST', credentials: 'include' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'No se pudo iniciar');
      reflexSession = data;
      reflexHits = 0;
      const overlay = document.getElementById('reflex-overlay');
      const arena = document.getElementById('reflex-arena');
      const score = document.getElementById('reflex-score');
      const timer = document.getElementById('reflex-timer');
      if (!overlay || !arena) return;
      deps?.closeModals?.();
      overlay.hidden = false;
      if (score) score.textContent = '0';
      clearInterval(reflexTimer);
      let left = Math.ceil((data.durationMs || reflexConfig?.durationMs || 15000) / 1000);
      if (timer) timer.textContent = `${left}s`;
      requestAnimationFrame(() => {
        requestAnimationFrame(() => spawnReflexTarget(arena));
      });
      reflexTimer = setInterval(() => {
        left -= 1;
        if (timer) timer.textContent = `${Math.max(0, left)}s`;
        if (left <= 0) finishReflex();
      }, 1000);
    } catch (err) {
      deps?.toast?.(err.message, true);
    }
  }

  async function finishReflex() {
    clearInterval(reflexTimer);
    reflexTimer = null;
    if (reflexTarget) { reflexTarget.remove(); reflexTarget = null; }
    hideReflexOverlay();
    if (!reflexSession) return;
    try {
      const res = await fetch('/api/minigame/reflex/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ sessionId: reflexSession.sessionId, hits: reflexHits }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Error al validar');
      deps?.toast?.(`¡Reflejos! +${fmtCoins(data.coins)}🪙 (${data.hits} aciertos)`);
      if (data.user) deps?.onUserUpdate?.(data.user);
      else deps?.onWallet?.({ coins: data.totalCoins });
    } catch (err) {
      deps?.toast?.(err.message, true);
    }
    reflexSession = null;
    renderArcadePanel();
  }

  function escapeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function tryLaunchAt(x, y) {
    if (typeof ArcadeGames !== 'undefined' && ArcadeGames.tryLaunchAt(x, y, games, zones)) return true;
    return false;
  }

  function bindUI() {
    if (uiBound) return;
    uiBound = true;
    document.getElementById('reflex-start')?.addEventListener('click', startReflex);
    document.getElementById('reflex-cancel')?.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      cancelReflex();
    });
    document.getElementById('reflex-overlay')?.addEventListener('click', (e) => {
      if (e.target.id === 'reflex-overlay') cancelReflex();
    });
    document.getElementById('leaderboard-refresh')?.addEventListener('click', renderLeaderboard);
    document.addEventListener('keydown', (e) => {
      if (e.code === 'Escape' && isReflexOpen()) {
        e.stopImmediatePropagation();
        cancelReflex();
      }
    }, true);
    hideReflexOverlay();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bindUI);
  } else {
    bindUI();
  }

  window.Arcade = {
    init,
    renderLeaderboard,
    renderZonesList,
    renderGamesList,
    setZones: (z) => { zones = z; renderZonesList(); },
    setGames: (g) => { games = g; renderGamesList(); },
    getZones: () => zones,
    getGames: () => games,
    bindUI,
    cancelReflex,
    cancelAny: async () => cancelReflex() || (typeof ArcadeGames !== 'undefined' && ArcadeGames.cancel()),
    isReflexOpen,
    isAnyGameOpen,
    tryLaunchAt,
  };
})();
