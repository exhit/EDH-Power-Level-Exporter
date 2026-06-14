// ─── EDH Power Level Exporter — Popup Controller ─────────────────────────────

// Hard-coded name-based exclusions — ONLY unambiguous "not in deck" names.
// Do NOT add gameplay categories like "Tokens", "Removal", "Cuts" here.
// For Archidekt, includedInDeck:false is the authoritative signal.
// For Moxfield, board names like "sideboard"/"maybeboard" are structural.
const EXCLUDED_NAMES = [
  'sideboard', 'side board', 'maybeboard', 'maybe board',
  'maybe-board', 'side-board', 'wishlist', 'watch list',
  'acquiring', 'to acquire', 'on the chopping block'
];

function nameIsExcluded(category) {
  const lower = (category || '').toLowerCase().trim();
  // Use exact/boundary matching — never substring — to avoid catching
  // real gameplay categories like "Tokens" or "Cutting Board" etc.
  return EXCLUDED_NAMES.some(ex => lower === ex);
}

// ─── Site detection ───────────────────────────────────────────────────────────
function detectSite(url) {
  if (!url) return null;
  if (url.includes('archidekt.com')) return 'archidekt';
  if (url.includes('moxfield.com'))  return 'moxfield';
  return null;
}

function getDeckId(url, site) {
  if (!url) return null;
  try {
    if (site === 'archidekt') {
      const m = url.match(/\/decks\/(\d+)/);
      return m ? m[1] : null;
    }
    if (site === 'moxfield') {
      const m = url.match(/\/decks\/([A-Za-z0-9_-]+)/);
      return m ? m[1] : null;
    }
  } catch (_) {}
  return null;
}

// ─── Archidekt ────────────────────────────────────────────────────────────────
// API: GET https://archidekt.com/api/decks/<id>/
//
// Response shape:
// {
//   categories: [ { name: "Commander", isPrimary: true, includedInDeck: true }, ... ],
//   cards: [
//     {
//       quantity: 1,
//       categories: ["Commander"],          // primary category is FIRST
//       card: { oracleCard: { name: "..." } }
//     }, ...
//   ]
// }
//
// KEY INSIGHT: The deck-level `categories` array has `includedInDeck` on each
// category. If a category has `includedInDeck: false`, it is a custom
// maybeboard / sideboard and should be excluded regardless of its name.

async function fetchArchidekt(deckId) {
  const resp = await fetch(`https://archidekt.com/api/decks/${deckId}/`, {
    headers: { 'Accept': 'application/json' }
  });
  if (!resp.ok) throw new Error(`Archidekt API error ${resp.status}: ${resp.statusText}`);
  const data = await resp.json();

  // Build a set of excluded category names using the deck's own metadata
  const excludedCats = new Set();
  for (const cat of (data.categories || [])) {
    const name = cat.name || '';
    // Exclude if explicitly not in deck, OR if the name matches known patterns
    if (!cat.includedInDeck || nameIsExcluded(name)) {
      excludedCats.add(name);
    }
  }

  const commander = [];
  const mainboard = [];
  const skipped   = new Set();

  for (const entry of (data.cards || [])) {
    const name = entry.card?.oracleCard?.name || entry.card?.name || '';
    const qty  = entry.quantity || 1;
    if (!name) continue;

    // Primary category is always the first element
    const allCats = Array.isArray(entry.categories) ? entry.categories : [];
    const primaryCat = allCats[0] || '';

    if (primaryCat.toLowerCase() === 'commander') {
      commander.push({ qty, name });
    } else if (excludedCats.has(primaryCat)) {
      skipped.add(primaryCat);
    } else {
      mainboard.push({ qty, name });
    }
  }

  return {
    commander: commander[0] || null,   // { qty, name }
    mainboard,
    skipped: [...skipped],
    debug: {
      totalCards: data.cards?.length,
      deckCategories: (data.categories || []).map(c => `${c.name} (inDeck:${c.includedInDeck})`)
    }
  };
}

// ─── Moxfield ─────────────────────────────────────────────────────────────────
// API: GET https://api.moxfield.com/v2/decks/all/<publicId>
//
// Response shape (TOP LEVEL — no "boards" wrapper):
// {
//   commanders: { "Card Name": { quantity: 1, card: { name: "..." } }, ... },
//   mainboard:  { "Card Name": { quantity: 1, card: { name: "..." } }, ... },
//   sideboard:  { ... },
//   maybeboard: { ... },
//   companions: { ... },
//   attractions: { ... },
//   stickers: { ... },
//   ...
// }
//
// The card key IS the card name. `details.card.name` is the canonical name.
// Commander cards do NOT have a quantity field (default 1).

const MOXFIELD_EXCLUDED_BOARDS = new Set([
  'sideboard', 'maybeboard', 'tokens', 'emblems',
  'attractions', 'stickers', 'planes', 'schemes',
  'conspiracies', 'jundrakh', 'contraptions'
]);

async function fetchMoxfield(deckId) {
  const resp = await fetch(`https://api.moxfield.com/v2/decks/all/${deckId}`, {
    headers: {
      'Accept': 'application/json',
      'User-Agent': 'EDH-PowerLevel-Exporter/1.0'
    }
  });
  if (!resp.ok) throw new Error(`Moxfield API error ${resp.status}: ${resp.statusText}`);
  const data = await resp.json();

  const commander = [];
  const mainboard = [];
  const skipped   = [];

  // Commanders board
  for (const [, entry] of Object.entries(data.commanders || {})) {
    const name = entry.card?.name || '';
    const qty  = entry.quantity || 1;
    if (name) commander.push({ qty, name });
  }

  // Companions count as part of mainboard for EDH purposes
  const includeBoards = ['mainboard', 'companions'];
  for (const boardName of includeBoards) {
    for (const [, entry] of Object.entries(data[boardName] || {})) {
      const name = entry.card?.name || '';
      const qty  = entry.quantity || 1;
      if (name) mainboard.push({ qty, name });
    }
  }

  // Track what we skipped
  for (const boardName of MOXFIELD_EXCLUDED_BOARDS) {
    const board = data[boardName] || {};
    if (Object.keys(board).length > 0) skipped.push(boardName);
  }

  return {
    commander: commander[0] || null,
    mainboard,
    skipped,
    debug: {
      boardsFound: Object.keys(data).filter(k => typeof data[k] === 'object' && data[k] !== null)
    }
  };
}

// ─── URL builder ──────────────────────────────────────────────────────────────
function buildEDHUrl({ commander, mainboard }) {
  const enc = s => encodeURIComponent(s).replace(/%20/g, '+');
  // commander is { qty, name } or null
  const cmdQty  = commander?.qty  || 1;
  const cmdName = commander?.name || 'Unknown Commander';
  const commanderPart = `Commander~${cmdQty}+${enc(cmdName)}`;
  const mainPart = 'Mainboard~' + mainboard
    .map(c => `${c.qty}+${enc(c.name)}`)
    .join('~');
  return `https://edhpowerlevel.com/?d=${commanderPart}~~${mainPart}~~Z~`;
}

// ─── UI helpers ───────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);

function setSiteBadge(html, state) {
  $('siteLabel').innerHTML = html;
  $('siteDot').className = 'site-dot' + (state === 'ok' ? ' active' : state === 'err' ? ' error' : '');
}

function showWarning(msg) {
  const w = $('warningBox');
  if (msg) { w.innerHTML = msg; w.className = 'warning visible'; }
  else      { w.className = 'warning'; }
}

function showStatus(msg, type) {
  $('statusBox').innerHTML = msg;
  $('statusBox').className = `status visible ${type}`;
}

function showDeckInfo(commander, mainboard, skipped) {
  const mainTotal = mainboard.reduce((s, c) => s + c.qty, 0);
  const cmdTotal  = commander ? (commander.qty || 1) : 0;
  const total     = mainTotal + cmdTotal;
  $('infoCommander').textContent = commander ? commander.name : '(none found)';
  $('infoCount').textContent     = `${total} cards`;
  $('infoSkipped').textContent   = skipped.length ? skipped.join(', ') : 'none';
  $('deckInfo').className        = 'deck-info visible';
}

// ─── Main ─────────────────────────────────────────────────────────────────────
let currentTab  = null;
let currentSite = null;
let deckId      = null;
let deckData    = null;
let analyzed    = false;

const SITE_NAMES = { archidekt: 'Archidekt', moxfield: 'Moxfield' };

async function init() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  currentTab  = tab;
  currentSite = detectSite(tab?.url);

  // Restore toggle state
  const stored = await chrome.storage.sync.get('autoOpen');
  const autoOn = stored.autoOpen === true;
  $('autoOpen').checked = autoOn;
  $('autoOpen').addEventListener('change', () => {
    chrome.storage.sync.set({ autoOpen: $('autoOpen').checked });
  });

  if (!currentSite) {
    setSiteBadge('Not a supported site', 'err');
    showWarning('Navigate to a deck page on Archidekt or Moxfield.');
    return;
  }

  deckId = getDeckId(tab.url, currentSite);
  if (!deckId) {
    setSiteBadge(`<span class="site-name">${SITE_NAMES[currentSite]}</span> detected`, '');
    showWarning(`Navigate to a specific deck page to export.`);
    return;
  }

  setSiteBadge(`<span class="site-name">${SITE_NAMES[currentSite]}</span> — deck #${deckId}`, 'ok');
  $('btnExport').disabled = false;

  // Auto-run if toggle is on
  if (autoOn) $('btnExport').click();
}

$('btnExport').addEventListener('click', async () => {
  if (!analyzed) {
    $('btnExport').disabled = true;
    $('btnExport').innerHTML = '<span class="spinner"></span>Reading deck…';
    showStatus('', '');
    showWarning('');
    $('deckInfo').className = 'deck-info';

    try {
      let result;
      if (currentSite === 'archidekt') {
        result = await fetchArchidekt(deckId);
      } else if (currentSite === 'moxfield') {
        result = await fetchMoxfield(deckId);
      } else {
        throw new Error('Unsupported site.');
      }

      deckData = result;

      // Warnings
      const warnings = [];
      if (!deckData.commander) {
        warnings.push('⚠ No commander found. Make sure there is a "Commander" category.');
      }
      const total = deckData.mainboard.reduce((s, c) => s + c.qty, 0) + (deckData.commander?.qty || 1);
      if (total < 99 || total > 102) {
        warnings.push(`⚠ Deck has ${total} cards (expected 100).`);
      }

      showDeckInfo(deckData.commander, deckData.mainboard, deckData.skipped);
      if (warnings.length) showWarning(warnings.join('<br>'));

      analyzed = true;
      $('btnExport').disabled = false;
      $('btnExport').innerHTML = '<span class="btn-icon">⚡</span>Open on EDH Power Level';

      // Auto mode: immediately open if no blocking warnings
      if ($('autoOpen').checked) $('btnExport').click();

    } catch (err) {
      showStatus('⚠ ' + err.message, 'error');
      $('btnExport').innerHTML = '<span class="btn-icon">⚔</span>Analyze Deck';
      $('btnExport').disabled = false;
    }

  } else {
    if (!deckData) return;
    const url = buildEDHUrl({
      commander: deckData.commander || { qty: 1, name: 'Unknown Commander' },
      mainboard: deckData.mainboard
    });
    chrome.tabs.create({ url });
    showStatus('✓ Opened EDH Power Level in a new tab!', 'success');
    $('btnExport').innerHTML = '<span class="btn-icon">✓</span>Opened!';
    // In auto mode, close the popup immediately after opening
    if ($('autoOpen').checked) { window.close(); return; }
    setTimeout(() => {
      $('btnExport').innerHTML = '<span class="btn-icon">⚡</span>Open on EDH Power Level';
    }, 2000);
  }
});

init();

