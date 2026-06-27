/** Persistencia local — localStorage + cookies de preferencias */
(function () {
  'use strict';

  const PREFIX = 'pixelmania_';
  const COOKIE_DAYS = 365;

  function get(key, fallback = null) {
    try {
      const raw = localStorage.getItem(PREFIX + key);
      if (raw == null) return fallback;
      return JSON.parse(raw);
    } catch {
      return fallback;
    }
  }

  function set(key, value) {
    try {
      localStorage.setItem(PREFIX + key, JSON.stringify(value));
    } catch (e) {
      console.warn('localStorage lleno o bloqueado', e);
    }
  }

  function remove(key) {
    localStorage.removeItem(PREFIX + key);
  }

  function setCookie(name, value, days = COOKIE_DAYS) {
    const maxAge = days * 24 * 60 * 60;
    document.cookie = `${name}=${encodeURIComponent(value)};path=/;max-age=${maxAge};SameSite=Lax`;
  }

  function getCookie(name) {
    const match = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
    return match ? decodeURIComponent(match[1]) : null;
  }

  function removeCookie(name) {
    document.cookie = `${name}=;path=/;max-age=0;SameSite=Lax`;
  }

  window.PMStorage = {
    get,
    set,
    remove,

    setCookie,
    getCookie,
    removeCookie,

    savePrefs(prefs) {
      const current = get('prefs', {});
      set('prefs', { ...current, ...prefs, updatedAt: Date.now() });
    },

    loadPrefs() {
      return get('prefs', {});
    },

    saveUser(user, quota, missions) {
      if (!user) {
        remove('user');
        removeCookie('pm_uid');
        removeCookie('pm_username');
        return;
      }
      set('user', { user, quota, missions, savedAt: Date.now() });
      setCookie('pm_uid', user.id);
      setCookie('pm_username', user.username);
    },

    loadUser() {
      return get('user', null);
    },

    saveViewport(view) {
      set('viewport', { ...view, savedAt: Date.now() });
    },

    loadViewport() {
      return get('viewport', null);
    },

    saveClanDraft(draft) {
      set('clan_draft', draft);
    },

    loadClanDraft() {
      return get('clan_draft', null);
    },

    clearAll() {
      Object.keys(localStorage).filter((k) => k.startsWith(PREFIX)).forEach((k) => localStorage.removeItem(k));
      removeCookie('pm_uid');
      removeCookie('pm_username');
    },
  };
})();
