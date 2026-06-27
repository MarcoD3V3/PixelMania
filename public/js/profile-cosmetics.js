/** Renderizado de personalización de perfil (cliente) */
(function () {
  'use strict';

  const TIER_NAMES = ['', 'Bronce', 'Plata', 'Oro', 'Platino', 'Diamante', 'Maestro', 'Leyenda'];

  function tierForLevel(level) {
    const lv = Math.max(0, Math.trunc(level));
    if (lv <= 0) return 0;
    if (lv <= 50) return 1;
    if (lv <= 150) return 2;
    if (lv <= 300) return 3;
    if (lv <= 500) return 4;
    if (lv <= 750) return 5;
    if (lv <= 900) return 6;
    return 7;
  }

  function hueForLevel(level) {
    return (Math.trunc(level) * 137.508) % 360;
  }

  function frameDef(level) {
    const lv = Math.max(0, Math.trunc(level));
    if (lv <= 0) return { level: 0, tier: 0, name: 'Sin marco', hue: 0, width: 0 };
    const tier = tierForLevel(lv);
    return {
      level: lv, tier, name: `Marco ${TIER_NAMES[tier]} ${lv}`, hue: hueForLevel(lv),
      width: 2 + Math.min(8, Math.floor(lv / 80)),
      gradient: lv >= 8, animate: lv >= 45, glow: lv >= 150, pulse: lv >= 350, holo: lv >= 750, double: lv >= 250,
    };
  }

  function badgeDef(level) {
    const lv = Math.max(0, Math.trunc(level));
    if (lv <= 0) return { level: 0, tier: 0, name: 'Sin insignia', icon: '' };
    const tier = tierForLevel(lv);
    const icons = ['', '⭐', '🏅', '🎖', '💎', '👑', '🔥', '✨'];
    return { level: lv, tier, name: `Insignia ${TIER_NAMES[tier]} ${lv}`, icon: icons[tier] || '✨', shine: lv >= 200 };
  }

  function titleDef(level) {
    const lv = Math.max(0, Math.trunc(level));
    if (lv <= 0) return { level: 0, tier: 0, name: '', text: '' };
    const tier = tierForLevel(lv);
    const prefixes = ['', 'Novato', 'Artista', 'Veterano', 'Élite', 'Campeón', 'Mítico', 'Leyenda'];
    return {
      level: lv, tier, name: `Título nv.${lv}`,
      text: `${prefixes[tier] || 'Pixel'} Nv.${lv}`,
      gradient: lv >= 100, glow: lv >= 450,
    };
  }

  function auraDef(level) {
    const lv = Math.max(0, Math.trunc(level));
    if (lv <= 0) return { level: 0, tier: 0, name: 'Sin aura', hue: 0, size: 0 };
    const tier = tierForLevel(lv);
    return {
      level: lv, tier, name: `Aura ${TIER_NAMES[tier]} ${lv}`, hue: hueForLevel(lv + 40),
      size: 12 + Math.min(40, Math.floor(lv / 25)), particles: lv >= 80, trail: lv >= 250, rainbow: lv >= 600,
    };
  }

  function bannerDef(level) {
    const lv = Math.max(0, Math.trunc(level));
    if (lv <= 0) return { level: 0, tier: 0, name: 'Sin banner', hue: 0 };
    const tier = tierForLevel(lv);
    return {
      level: lv, tier, name: `Banner ${TIER_NAMES[tier]} ${lv}`, hue: hueForLevel(lv + 90),
      gradient: lv >= 30, pattern: lv >= 180, shimmer: lv >= 420,
    };
  }

  function expandSnapshot(pr) {
    if (!pr || typeof pr !== 'object') return null;
    const title = titleDef(pr.t || 0);
    if (pr.tt) title.text = String(pr.tt).slice(0, 64);
    return {
      frame: frameDef(pr.f || 0),
      badge: badgeDef(pr.b || 0),
      title,
      aura: auraDef(pr.a || 0),
      banner: bannerDef(pr.bn || 0),
      statusText: pr.st ? String(pr.st).slice(0, 80) : '',
      nameColor: pr.nc ? String(pr.nc).toUpperCase() : null,
    };
  }

  function resolveFromUser(user) {
    if (!user?.profile) return null;
    return user.profile;
  }

  function cssVars(cos) {
    if (!cos) return '';
    const f = cos.frame || {};
    const b = cos.banner || {};
    const h = f.hue || 0;
    const bh = b.hue || h;
    return `--pf-frame-h:${h};--pf-banner-h:${bh};--pf-frame-w:${f.width || 2}px;--pf-name:${cos.nameColor || 'inherit'};`;
  }

  function frameClasses(cos) {
    if (!cos?.frame?.level) return '';
    const f = cos.frame;
    const parts = ['pf-frame'];
    if (f.gradient) parts.push('pf-frame--gradient');
    if (f.animate) parts.push('pf-frame--animate');
    if (f.glow) parts.push('pf-frame--glow');
    if (f.pulse) parts.push('pf-frame--pulse');
    if (f.holo) parts.push('pf-frame--holo');
    if (f.double) parts.push('pf-frame--double');
    parts.push(`pf-frame--t${f.tier}`);
    return parts.join(' ');
  }

  function tierPreview(procedural, level) {
    const lv = Math.max(1, Math.trunc(level));
    switch (procedural) {
      case 'frame': return { name: frameDef(lv).name, desc: `Marco ${TIER_NAMES[frameDef(lv).tier]} nv.${lv}` };
      case 'badge': return { name: badgeDef(lv).name, desc: `Insignia ${badgeDef(lv).icon}` };
      case 'title': return { name: titleDef(lv).name, desc: titleDef(lv).text };
      case 'aura': return { name: auraDef(lv).name, desc: `Aura ${auraDef(lv).size}px` };
      case 'banner': return { name: bannerDef(lv).name, desc: `Banner ${TIER_NAMES[bannerDef(lv).tier]}` };
      default: return { name: `Nivel ${lv}`, desc: '' };
    }
  }

  function buildUserChipHTML(user) {
    const cos = resolveFromUser(user);
    const bannerStyle = cos?.banner?.level
      ? `background: linear-gradient(135deg, hsl(${cos.banner.hue} 55% 28%), hsl(${(cos.banner.hue + 40) % 360} 50% 18%));`
      : '';
    const nameStyle = cos?.nameColor ? `color:${cos.nameColor}` : '';
    const titleHtml = cos?.title?.text
      ? `<span class="user-chip__title">${escapeHtml(cos.title.text)}</span>` : '';
    const statusHtml = cos?.statusText
      ? `<span class="user-chip__status">${escapeHtml(cos.statusText)}</span>` : '';
    const badgeHtml = cos?.badge?.icon
      ? `<span class="user-chip__badge" title="${escapeHtml(cos.badge.name)}">${cos.badge.icon}</span>` : '';
    const frameCls = frameClasses(cos);

    return `
      <div class="user-chip user-chip--styled" style="${cssVars(cos)}">
        ${cos?.banner?.level ? `<div class="user-chip__banner" style="${bannerStyle}"></div>` : ''}
        <div class="user-chip__main">
          <div class="user-chip__avatar-wrap ${frameCls}">
            <img src="${user.avatar}" alt="" class="user-chip__avatar" />
          </div>
          <div class="user-chip__text">
            <span class="user-chip__name-row">
              <span class="user-chip__name" style="${nameStyle}">${escapeHtml(user.username)}</span>
              ${badgeHtml}
            </span>
            ${titleHtml}
            ${statusHtml}
          </div>
          <a href="/auth/logout" class="user-chip__logout" title="Cerrar sesión" id="logout-btn">×</a>
        </div>
      </div>`;
  }

  function buildPixelCardHTML(meta, x, y, terrHtml) {
    const cos = meta.pr ? expandSnapshot(meta.pr) : null;
    const bannerStyle = cos?.banner?.level
      ? `background: linear-gradient(135deg, hsl(${cos.banner.hue} 50% 22%), hsl(${(cos.banner.hue + 50) % 360} 45% 14%));`
      : '';
    const nameStyle = cos?.nameColor ? `color:${cos.nameColor}` : '';
    const titleHtml = cos?.title?.text
      ? `<span class="pixel-card__title">${escapeHtml(cos.title.text)}</span>` : '';
    const statusHtml = cos?.statusText
      ? `<span class="pixel-card__status">${escapeHtml(cos.statusText)}</span>` : '';
    const badgeHtml = cos?.badge?.icon
      ? `<span class="pixel-card__badge">${cos.badge.icon}</span>` : '';
    const frameCls = frameClasses(cos);

    return {
      cos,
      html: `
        ${cos?.banner?.level ? `<div class="pixel-card__banner" style="${bannerStyle}"></div>` : ''}
        <div class="pixel-card__inner">
          <div class="pixel-card__avatar-wrap ${frameCls}">
            <img class="pixel-card__avatar" src="${meta.a}" alt="" />
          </div>
          <div class="pixel-card__body">
            <span class="pixel-card__name-row">
              <span class="pixel-card__name" style="${nameStyle}">${escapeHtml(meta.n)}</span>
              ${badgeHtml}
            </span>
            ${titleHtml}
            ${statusHtml}
            ${terrHtml || ''}
            <span class="pixel-card__coords">${x}, ${y}</span>
          </div>
          <span class="pixel-card__color" style="background:${meta.c}"></span>
        </div>`,
    };
  }

  let auraEl = null;
  let currentAura = null;

  function ensureAuraEl() {
    if (auraEl) return auraEl;
    auraEl = document.getElementById('cursor-aura');
    return auraEl;
  }

  function applyCursorAura(cos) {
    currentAura = cos?.aura?.level ? cos.aura : null;
    const el = ensureAuraEl();
    if (!el) return;
    if (!currentAura?.level) {
      el.hidden = true;
      el.className = 'cursor-aura';
      return;
    }
    el.hidden = false;
    const a = currentAura;
    el.className = 'cursor-aura';
    el.style.setProperty('--aura-h', String(a.hue));
    el.style.setProperty('--aura-size', `${a.size}px`);
    if (a.particles) el.classList.add('cursor-aura--particles');
    if (a.trail) el.classList.add('cursor-aura--trail');
    if (a.rainbow) el.classList.add('cursor-aura--rainbow');
    el.classList.add(`cursor-aura--t${a.tier}`);
  }

  function trackCursorAura() {
    const el = ensureAuraEl();
    if (!el || el.hidden) return;
    document.addEventListener('mousemove', (e) => {
      if (!currentAura?.level || !auraEl) return;
      auraEl.style.left = `${e.clientX}px`;
      auraEl.style.top = `${e.clientY}px`;
    }, { passive: true });
  }

  function renderProfilePanel(user, root, deps) {
    if (!root || !user) {
      if (root) root.innerHTML = '<p class="panel-desc">Inicia sesión para personalizar tu perfil.</p>';
      return;
    }
    const p = user.profile || {};
    const u = p.unlocked || {};
    const caps = p.caps || {};

    root.innerHTML = `
      <p class="panel-desc">Estilo Discord: compra en Tienda → Perfil y elige aquí qué mostrar (hasta nv.1000).</p>
      <div class="profile-preview" id="profile-preview">${buildUserChipHTML({ ...user, profile: p })}</div>
      ${sliderField('Marco', 'pf-frame', u.frame, user.profileStyle?.activeFrame ?? u.frame)}
      ${sliderField('Insignia', 'pf-badge', u.badge, user.profileStyle?.activeBadge ?? u.badge)}
      ${sliderField('Título', 'pf-title', u.title, user.profileStyle?.activeTitle ?? u.title)}
      ${sliderField('Aura cursor', 'pf-aura', u.aura, user.profileStyle?.activeAura ?? u.aura)}
      ${sliderField('Banner', 'pf-banner', u.banner, user.profileStyle?.activeBanner ?? u.banner)}
      <label class="field">
        <span>Estado personal ${u.title >= 15 ? '' : '(nv. título 15+)'}</span>
        <input type="text" id="pf-status" maxlength="80" value="${escapeHtml(user.profileStyle?.statusText || p.statusText || '')}" ${u.title >= 15 ? '' : 'disabled'} placeholder="🍄 Tu mensaje…" />
      </label>
      <label class="field field--inline">
        <span>Color nombre ${u.title >= 60 ? '' : '(nv. título 60+)'}</span>
        <input type="color" id="pf-name-color" value="${user.profileStyle?.nameColor || p.nameColor || '#ffffff'}" ${u.title >= 60 ? '' : 'disabled'} />
      </label>
      <button type="button" class="btn btn--accent btn--sm" id="pf-save">Guardar perfil</button>
      <p class="panel-desc panel-desc--tiny">Nv. desbloqueados: marco ${u.frame}/1000 · insignia ${u.badge} · título ${u.title} · aura ${u.aura} · banner ${u.banner}</p>`;

    root.querySelectorAll('[data-pf-slider]').forEach((input) => {
      input.addEventListener('input', () => previewLocal(user, root));
    });
    root.querySelector('#pf-save')?.addEventListener('click', async () => {
      try {
        const data = await saveProfile(root);
        deps?.onSaved?.(data);
      } catch (err) {
        deps?.toast?.(err.message, true);
      }
    });
  }

  function sliderField(label, id, max, value) {
    if (!max) {
      return `<p class="panel-desc panel-desc--tiny">${label}: compra en Tienda → Perfil</p>`;
    }
    const v = Math.min(max, Math.max(1, Math.trunc(value || max)));
    return `<label class="field"><span>${label} (1–${max})</span><input type="range" data-pf-slider="${id}" min="1" max="${max}" value="${v}" /><output data-pf-out="${id}">nv.${v}</output></label>`;
  }

  function readPanelValues(root) {
    const body = {};
    const map = {
      'pf-frame': 'activeFrame', 'pf-badge': 'activeBadge', 'pf-title': 'activeTitle',
      'pf-aura': 'activeAura', 'pf-banner': 'activeBanner',
    };
    for (const [id, key] of Object.entries(map)) {
      const el = root.querySelector(`[data-pf-slider="${id}"]`);
      if (el) body[key] = Number(el.value);
    }
    body.statusText = root.querySelector('#pf-status')?.value || '';
    body.nameColor = root.querySelector('#pf-name-color')?.value || '';
    return body;
  }

  function previewLocal(user, root) {
    root.querySelectorAll('[data-pf-out]').forEach((out) => {
      const id = out.dataset.pfOut;
      const el = root.querySelector(`[data-pf-slider="${id}"]`);
      if (el) out.textContent = `nv.${el.value}`;
    });
  }

  async function saveProfile(root) {
    const body = readPanelValues(root);
    const res = await fetch('/api/profile/style', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error al guardar');
    return data;
  }

  function escapeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  trackCursorAura();

  window.ProfileCosmetics = {
    tierPreview,
    buildUserChipHTML,
    buildPixelCardHTML,
    applyCursorAura,
    resolveFromUser,
    expandSnapshot,
    renderProfilePanel,
    saveProfile,
    cssVars,
    frameDef,
    badgeDef,
    titleDef,
    auraDef,
    bannerDef,
  };
})();
