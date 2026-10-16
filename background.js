const EXCLUDED_NAMES = [
  'sideboard', 'side board', 'maybeboard', 'maybe board',
  'maybe-board', 'side-board', 'wishlist', 'watch list',
  'acquiring', 'to acquire', 'on the chopping block'
];

function nameIsExcluded(cat) {
  const lower = (cat || '').toLowerCase().trim();
  return EXCLUDED_NAMES.some(ex => lower === ex);
}

async function fetchArchidektDeck(deckId) {
  const resp = await fetch(`https://archidekt.com/api/decks/${deckId}/`, {
    headers: { 'Accept': 'application/json' }
  });
  if (!resp.ok) throw new Error(`Archidekt API ${resp.status}`);
  const data = await resp.json();

  const excludedCats = new Set();
  for (const cat of (data.categories || [])) {
    if (!cat.includedInDeck || nameIsExcluded(cat.name)) excludedCats.add(cat.name);
  }

  const commander = [];
  const mainboard = [];
  for (const entry of (data.cards || [])) {
    const name = entry.card?.oracleCard?.name || entry.card?.name || '';
    const qty  = entry.quantity || 1;
    if (!name) continue;
    const primaryCat = (Array.isArray(entry.categories) ? entry.categories : [])[0] || '';
    if (primaryCat.toLowerCase() === 'commander') commander.push({ qty, name });
    else if (!excludedCats.has(primaryCat)) mainboard.push({ qty, name });
  }
  return { commanders: commander, mainboard };
}

// ─── Moxfield fetch ───────────────────────────────────────────────────────────
const MOXFIELD_EXCLUDED = new Set([
  'sideboard', 'maybeboard', 'tokens', 'emblems',
  'attractions', 'stickers', 'planes', 'schemes'
]);

async function fetchMoxfieldDeck(deckId) {
  const resp = await fetch(`https://api.moxfield.com/v2/decks/all/${deckId}`, {
    headers: { 'Accept': 'application/json', 'User-Agent': 'EDH-PowerLevel-Exporter/1.0' }
  });
  if (!resp.ok) throw new Error(`Moxfield API ${resp.status}`);
  const data = await resp.json();

  const commander = [];
  const mainboard = [];
  for (const [, e] of Object.entries(data.commanders || {})) {
    const name = e.card?.name || '';
    if (name) commander.push({ qty: e.quantity || 1, name, scryfallId: e.card?.scryfall_id });
  }
  for (const board of ['mainboard', 'companions']) {
    for (const [, e] of Object.entries(data[board] || {})) {
      const name = e.card?.name || '';
      if (name) mainboard.push({ qty: e.quantity || 1, name, scryfallId: e.card?.scryfall_id });
    }
  }
  return { commanders: commander, mainboard };
}

// ─── Archidekt printing resolution (Scryfall) ─────────────────────────────────
// Same logic as action.js's resolveArchidektIds, minus the confirm-screen
// step — this is the pure fetch/resolve half, reused by the on-page export
// buttons (content-export.js), which render their OWN confirm modal on the
// deck page instead of routing back through the extension popup for it.
async function fetchScryfallCollection(identifiers) {
  if (!identifiers.length) return [];
  const found = [];
  for (let i = 0; i < identifiers.length; i += 75) {
    const chunk = identifiers.slice(i, i + 75);
    try {
      const resp = await fetch('https://api.scryfall.com/cards/collection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({ identifiers: chunk })
      });
      if (!resp.ok) continue;
      const data = await resp.json();
      found.push(...(data.data || []));
    } catch (err) {
      console.warn('[EDHPORT] Scryfall lookup failed', err);
    }
  }
  return found;
}

async function fetchBestScryfallPrinting(name) {
  const url = 'https://api.scryfall.com/cards/search?q='
    + encodeURIComponent(`!"${name}"`) + '&unique=prints&order=released&dir=asc';
  try {
    const resp = await fetch(url, { headers: { 'Accept': 'application/json' } });
    if (!resp.ok) return null;
    const data = await resp.json();
    const prints = (data.data || []).filter(c => !c.digital);
    return prints.find(c => !isRiskyPrinting(c)) || prints[0] || null;
  } catch (err) {
    console.warn('[EDHPORT] Scryfall printing search failed', err);
    return null;
  }
}

function printLabel(card) {
  const year = (card.released_at || '').slice(0, 4);
  return `${card.set_name || card.set}${year ? ' (' + year + ')' : ''}`;
}

const RISKY_SET_TYPES = new Set(['box', 'memorabilia', 'funny', 'promo']);
const isRiskyPrinting = (card) => !!card.flavor_name || RISKY_SET_TYPES.has(card.set_type) || !!card.digital;

// `cards` is commanders+mainboard already tagged with boardCat ('c'/'m').
// Returns `entries` ready to embed in an Archidekt sandbox URL, any printing
// `changes` that need user confirmation before opening it (empty if none),
// and a `decklistText` dump for a "copy full decklist" button.
async function resolveArchidektExport(cards) {
  const withScryfallId = cards.filter(c => c.scryfallId);
  const oracleNameById = new Map();
  if (withScryfallId.length) {
    const idMatches = await fetchScryfallCollection(withScryfallId.map(c => ({ id: c.scryfallId })));
    for (const card of idMatches) oracleNameById.set(card.id, card.name);
  }
  const withOracleName = cards.map(c => ({
    ...c,
    lookupName: (c.scryfallId && oracleNameById.get(c.scryfallId)) || c.name
  }));

  const identifiers = [];
  for (const c of withOracleName) {
    if (c.lookupName) identifiers.push({ name: c.lookupName });
    if (c.scryfallId) identifiers.push({ id: c.scryfallId });
  }
  const nameMatches = await fetchScryfallCollection(identifiers);
  const byName = new Map();
  const byId = new Set();
  for (const card of nameMatches) {
    byName.set(card.name, card);
    byId.add(card.id);
  }

  const riskyCards = [...new Map(
    withOracleName
      .map(c => byName.get(c.lookupName))
      .filter(card => card && isRiskyPrinting(card))
      .map(card => [card.name, card])
  ).values()];

  const replacementByName = new Map();
  const changes = [];
  for (const original of riskyCards) {
    const replacement = await fetchBestScryfallPrinting(original.name);
    if (replacement && replacement.id !== original.id) {
      replacementByName.set(original.name, replacement);
      changes.push({
        name: original.name,
        from: printLabel(original) + (original.flavor_name ? ` — "${original.flavor_name}"` : ''),
        to: printLabel(replacement)
      });
    }
  }

  const resolved = withOracleName.map(c => {
    const match = byName.get(c.lookupName);
    const resolvedCard = (match && replacementByName.get(match.name)) || match || null;
    const resolvedId = resolvedCard?.id || (c.scryfallId && byId.has(c.scryfallId) ? c.scryfallId : null);
    return { ...c, resolvedCard, resolvedId };
  });

  const entries = resolved
    .map(c => c.resolvedId ? { c: c.boardCat, f: 0, q: c.qty || 1, u: c.resolvedId } : null)
    .filter(Boolean);

  const decklistText = resolved.map(c => {
    const name = c.lookupName || c.name;
    const qty  = c.qty || 1;
    if (c.resolvedCard) return `${qty} ${name} (${c.resolvedCard.set})${c.resolvedCard.collector_number ? ' ' + c.resolvedCard.collector_number : ''}`;
    if (c.scryfallId)   return `${qty} ${name} (original printing)`;
    return `${qty} ${name} — ⚠ NOT RESOLVED, will be dropped`;
  }).join('\n');

  return { entries, changes, decklistText };
}

// ─── Messages from the on-page export buttons (content-export.js) ────────────
// Deck data has to be fetched here rather than in the content script itself:
// a content script's own fetch() runs under the PAGE's origin, not the
// extension's, so it doesn't get the CORS bypass host_permissions gives
// extension pages — confirmed neither archidekt.com's nor moxfield.com's API
// sends an Access-Control-Allow-Origin covering the other site's own origin.
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Used by content-malformed-url.js's interceptor (edhpowerlevel.com and
  // commanderspellbook.com) — a content script's own fetch() can't reach
  // these APIs directly for the same CORS reason exportFetchDeck below
  // can't, so it round-trips through here too.
  if (message.type === 'fetchDeck') {
    (async () => {
      try {
        const data = message.site === 'archidekt'
          ? await fetchArchidektDeck(message.deckId)
          : await fetchMoxfieldDeck(message.deckId);
        sendResponse({ success: true, data });
      } catch (err) {
        sendResponse({ success: false, error: err instanceof Error ? err.message : String(err) });
      }
    })();
    return true;
  }
  if (message.type === 'exportFetchDeck') {
    (async () => {
      try {
        const data = message.site === 'archidekt'
          ? await fetchArchidektDeck(message.deckId)
          : await fetchMoxfieldDeck(message.deckId);
        sendResponse({ success: true, data });
      } catch (err) {
        sendResponse({ success: false, error: err instanceof Error ? err.message : String(err) });
      }
    })();
    return true;
  }
  if (message.type === 'exportResolveArchidekt') {
    (async () => {
      try {
        const tagged = [
          ...(message.commanders || []).map(c => ({ ...c, boardCat: 'c' })),
          ...(message.mainboard || []).map(c => ({ ...c, boardCat: 'm' }))
        ];
        const result = await resolveArchidektExport(tagged);
        sendResponse({ success: true, ...result });
      } catch (err) {
        sendResponse({ success: false, error: err instanceof Error ? err.message : String(err) });
      }
    })();
    return true;
  }
});

// ─── Archidekt debug sandbox tabs ──────────────────────────────────────────
// The debug button's per-card tab loop runs here, not in the popup itself —
// that's where it ran originally, but Chrome closes popups that lose focus,
// which killed a ~90-card loop the moment the user clicked away from it.
// Running it in the background keeps it going regardless of the popup.
//
// Progress and controls live in a dedicated small window (debug-control.html)
// instead of the popup, for the same reason: that window doesn't close when
// it loses focus, so it's a reliable place to show live progress and offer a
// Stop button for a run that can take minutes on a big deck. There's exactly
// one way to abort a run: close that window, or click Stop in it — both are
// wired to the same stopDebugRun() below.
const DEBUG_TAB_DELAY_MS     = 2000;
const DEBUG_TAB_DELAY_MAX_MS = 15000;
const DEBUG_MAX_RETRIES      = 3;

let debugRun = null; // { cards, total, opened, delay, stopped, controlWindowId, tabUrls, tabRetries, pendingTimeout }

function buildDebugSandboxUrl(c) {
  return `https://archidekt.com/sandbox?deck=${encodeURIComponent(JSON.stringify([
    { c: c.boardCat || 'm', f: 0, q: c.qty || 1, u: c.uid }
  ]))}`;
}

function sendDebugUpdate(patch) {
  chrome.runtime.sendMessage({ type: 'debugRunUpdate', ...patch }).catch(() => {});
}

// Resolves after `ms`, but resolves immediately (and clears the pending
// timer) if the run is stopped while waiting — otherwise Stop would only
// take effect on the NEXT loop iteration, up to one full delay later.
function debugWait(run, ms) {
  return new Promise((resolve) => {
    const id = setTimeout(() => { run.pendingTimeout = null; resolve(); }, ms);
    run.pendingTimeout = { id, resolve };
  });
}

async function startDebugRun(cards) {
  if (!cards.length) return;
  if (debugRun) {
    // Already running (e.g. clicking Debug again on a second deck in
    // compare mode) — surface the existing window instead of starting a
    // second, overlapping loop.
    chrome.windows.update(debugRun.controlWindowId, { focused: true }).catch(() => {});
    return;
  }

  const controlWindow = await chrome.windows.create({
    url: chrome.runtime.getURL('debug-control.html'),
    type: 'popup',
    width: 380,
    height: 300
  });

  const run = {
    cards, total: cards.length, opened: 0,
    delay: DEBUG_TAB_DELAY_MS,
    stopped: false,
    controlWindowId: controlWindow.id,
    tabUrls: new Map(),
    tabRetries: new Map(),
    pendingTimeout: null
  };
  debugRun = run;

  for (let i = 0; i < run.cards.length && !run.stopped; i++) {
    const c = run.cards[i];
    const url = buildDebugSandboxUrl(c);
    try {
      const tab = await chrome.tabs.create({ url, active: false });
      run.tabUrls.set(tab.id, url);
      run.tabRetries.set(tab.id, 0);
    } catch (err) {
      console.warn('[EDHPORT] failed to open debug tab', err);
    }
    run.opened = i + 1;
    sendDebugUpdate({ opened: run.opened, total: run.total, delay: run.delay });
    if (i < run.cards.length - 1 && !run.stopped) await debugWait(run, run.delay);
  }

  if (debugRun === run) {
    sendDebugUpdate({ done: true, stopped: run.stopped, opened: run.opened, total: run.total });
    debugRun = null;
  }
}

function stopDebugRun() {
  if (!debugRun) return;
  debugRun.stopped = true;
  if (debugRun.pendingTimeout) {
    clearTimeout(debugRun.pendingTimeout.id);
    debugRun.pendingTimeout.resolve();
  }
}

// Archidekt starts responding 429 "Too Many Requests" once enough sandbox
// tabs open in a short window, even at the base 2s spacing (confirmed on a
// ~90-card deck) — this backs off (doubles the delay between remaining tabs,
// capped) the moment that happens, and reloads that one tab once the
// cooldown passes instead of leaving it stuck on a dead error page for the
// rest of the run. Guarded with the `?.` because webRequest visibility isn't
// guaranteed on every WebExtension host (Orion's support is inconsistent
// across versions) — the run still works without it, just without adaptive
// backoff.
if (chrome.webRequest?.onCompleted) {
  chrome.webRequest.onCompleted.addListener(
    (details) => {
      if (!debugRun || debugRun.stopped) return;
      if (details.statusCode !== 429) return;
      if (!debugRun.tabUrls.has(details.tabId)) return;

      const run = debugRun;
      run.delay = Math.min(run.delay * 2, DEBUG_TAB_DELAY_MAX_MS);
      sendDebugUpdate({ opened: run.opened, total: run.total, delay: run.delay, rateLimited: true });

      const retries = run.tabRetries.get(details.tabId) || 0;
      if (retries >= DEBUG_MAX_RETRIES) return;
      run.tabRetries.set(details.tabId, retries + 1);
      const url = run.tabUrls.get(details.tabId);
      setTimeout(() => {
        if (!debugRun || debugRun.stopped) return;
        chrome.tabs.update(details.tabId, { url }).catch(() => {});
      }, run.delay);
    },
    { urls: ['https://archidekt.com/sandbox*'], types: ['main_frame'] }
  );
}

// The other way to abort a run: close its control window. It has no other
// purpose, so there's no reason to keep opening tabs once it's gone.
chrome.windows.onRemoved.addListener((windowId) => {
  if (debugRun && debugRun.controlWindowId === windowId) stopDebugRun();
});

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'openDebugSandboxTabs') {
    startDebugRun(message.cards || []);
  } else if (message.type === 'stopDebugRun') {
    stopDebugRun();
  } else if (message.type === 'requestDebugRunState' && debugRun) {
    sendDebugUpdate({ opened: debugRun.opened, total: debugRun.total, delay: debugRun.delay });
  }
});