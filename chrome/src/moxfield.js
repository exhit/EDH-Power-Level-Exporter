// Moxfield content script
// Intercepts fetch to cache the deck API response

(function () {
  if (window._edhExporterInjected) return;
  window._edhExporterInjected = true;

  const _fetch = window.fetch;
  window.fetch = async function (...args) {
    const response = await _fetch.apply(this, args);
    const url = typeof args[0] === 'string' ? args[0] : args[0]?.url || '';

    // Moxfield API: /api/v2/decks/<publicId>
    if (url.includes('/api/v2/decks/') && !url.includes('/cards')) {
      try {
        const cloned = response.clone();
        const json   = await cloned.json();
        window.__EDH_MOXFIELD_DECK__ = json;
      } catch (_) { /* ignore */ }
    }

    return response;
  };

  // Also intercept XHR for older API patterns
  const _open = XMLHttpRequest.prototype.open;
  const _send = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function (method, url) {
    this._edhUrl = url;
    return _open.apply(this, arguments);
  };

  XMLHttpRequest.prototype.send = function () {
    if (this._edhUrl && this._edhUrl.includes('/api/v2/decks/')) {
      this.addEventListener('load', () => {
        try {
          const json = JSON.parse(this.responseText);
          window.__EDH_MOXFIELD_DECK__ = json;
        } catch (_) { /* ignore */ }
      });
    }
    return _send.apply(this, arguments);
  };
})();
