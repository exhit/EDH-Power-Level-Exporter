// Archidekt content script
// Intercepts the Archidekt API to cache deck data for the popup

(function () {
  if (window._edhExporterInjected) return;
  window._edhExporterInjected = true;

  // Archidekt fetches deck data via /api/decks/<id>/
  // We intercept fetch to cache the response
  const _fetch = window.fetch;
  window.fetch = async function (...args) {
    const response = await _fetch.apply(this, args);
    const url = typeof args[0] === 'string' ? args[0] : args[0]?.url || '';

    if (url.includes('/api/decks/') && !url.includes('/cards')) {
      try {
        const cloned = response.clone();
        const json   = await cloned.json();
        // Store on window for the popup script to read
        window.__EDH_ARCHIDEKT_DECK__ = json;
      } catch (_) { /* ignore */ }
    }

    return response;
  };
})();
