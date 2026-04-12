/**
 * Guards against "Extension context invalidated" after the extension is reloaded
 * while Gmail stays open — content scripts keep running but chrome.runtime is dead.
 */
(function () {
  function isExtensionAlive() {
    try {
      return typeof chrome !== 'undefined' && !!chrome.runtime?.id;
    } catch {
      return false;
    }
  }

  function isContextInvalidated(err) {
    const m = String(err?.message || err || '');
    return (
      m.includes('Extension context invalidated') ||
      m.includes('context invalidated') ||
      m.includes('Could not establish connection') ||
      m.includes('Receiving end does not exist')
    );
  }

  window.loopBackChrome = {
    isAlive: isExtensionAlive,

    async sendMessage(message) {
      try {
        if (!isExtensionAlive()) return undefined;
        return await chrome.runtime.sendMessage(message);
      } catch (err) {
        if (isContextInvalidated(err)) {
          try {
            window.loopBackChrome.showReloadHint();
          } catch (_) {}
          return undefined;
        }
        console.warn('[LoopBack] sendMessage failed:', err);
        return undefined;
      }
    },

    async storageLocalGet(keys) {
      try {
        if (!isExtensionAlive()) return {};
        return await chrome.storage.local.get(keys);
      } catch (err) {
        if (isContextInvalidated(err)) return {};
        throw err;
      }
    },

    onMessage(callback) {
      if (!isExtensionAlive()) return;
      try {
        chrome.runtime.onMessage.addListener(callback);
      } catch (err) {
        if (!isContextInvalidated(err)) throw err;
      }
    },

    showReloadHint() {
      const bar = document.getElementById('loop-back-dead-banner');
      if (bar) return;
      const el = document.createElement('div');
      el.id = 'loop-back-dead-banner';
      el.setAttribute(
        'style',
        'position:fixed;bottom:16px;right:16px;z-index:2147483647;max-width:320px;padding:12px 14px;background:#1a1a1a;color:#fff;font:13px system-ui,sans-serif;border-radius:8px;box-shadow:0 4px 20px rgba(0,0,0,.35)'
      );
      el.textContent =
        'Loop Back was updated. Refresh this Gmail tab (⌘R / F5) to reconnect the sidebar.';
      document.body.appendChild(el);
    },
  };
})();
