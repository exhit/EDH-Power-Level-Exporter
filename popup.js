// ─── EDH Power Level Exporter — Popup (Chrome & Orion) ─────────────────────────
//
// Browser-agnostic UI: popup.html is empty.
// This script detects the browser and builds the appropriate UI (Chrome or Orion).

// ─── Shared helpers ───────────────────────────────────────────────────────────
const EXCLUDED_NAMES = [
  'sideboard', 'side board', 'maybeboard', 'maybe board',
  'maybe-board', 'side-board', 'wishlist', 'watch list',
  'acquiring', 'to acquire', 'on the chopping block'
];

function nameIsExcluded(category) {
  return EXCLUDED_NAMES.some(ex => (category || '').toLowerCase().trim() === ex);
}

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
async function fetchArchidekt(deckId) {
  const resp = await fetch(`https://archidekt.com/api/decks/${deckId}/`, {
    headers: { 'Accept': 'application/json' }
  });
  if (!resp.ok) throw new Error(`Archidekt API error ${resp.status}: ${resp.statusText}`);
  const data = await resp.json();

  const excludedCats = new Set();
  for (const cat of (data.categories || [])) {
    const name = cat.name || '';
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
    commander: commander[0] || null,
    mainboard,
    skipped: [...skipped]
  };
}

// ─── Moxfield ─────────────────────────────────────────────────────────────────
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

  for (const [, entry] of Object.entries(data.commanders || {})) {
    const name = entry.card?.name || '';
    const qty  = entry.quantity || 1;
    if (name) commander.push({ qty, name });
  }

  const includeBoards = ['mainboard', 'companions'];
  for (const boardName of includeBoards) {
    for (const [, entry] of Object.entries(data[boardName] || {})) {
      const name = entry.card?.name || '';
      const qty  = entry.quantity || 1;
      if (name) mainboard.push({ qty, name });
    }
  }

  for (const boardName of MOXFIELD_EXCLUDED_BOARDS) {
    const board = data[boardName] || {};
    if (Object.keys(board).length > 0) skipped.push(boardName);
  }

  return {
    commander: commander[0] || null,
    mainboard,
    skipped
  };
}

// ─── URL builder ──────────────────────────────────────────────────────────────
function buildEDHUrl({ commander, mainboard }) {
  const enc = s => encodeURIComponent(s).replace(/%20/g, '+');
  const cmdQty  = commander?.qty  || 1;
  const cmdName = commander?.name || 'Unknown Commander';
  const commanderPart = `Commander~${cmdQty}+${enc(cmdName)}`;
  const mainPart = 'Mainboard~' + mainboard
    .map(c => `${c.qty}+${enc(c.name)}`)
    .join('~');
  return `https://edhpowerlevel.com/?d=${commanderPart}~~${mainPart}~~Z~`;
}

// ─── Browser detection ────────────────────────────────────────────────────────
const IS_CHROME = typeof chrome.webNavigation !== 'undefined';

// ─── Chrome UI (Full featured) ─────────────────────────────────────────────────
async function buildChromeUI() {
  const root = document.getElementById('root');

  root.innerHTML = `
    <div class="header">
      <svg class="logo" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect width="32" height="32" rx="8" fill="#1a0a2e"/>
        <path d="M16 4L28 10V22L16 28L4 22V10L16 4Z" fill="none" stroke="#c8973a" stroke-width="1.5"/>
        <path d="M16 8L24 12V20L16 24L8 20V12L16 8Z" fill="#2a1a4e"/>
        <path d="M13 16C13 14.34 14.34 13 16 13C17.66 13 19 14.34 19 16C19 17.66 17.66 19 16 19" stroke="#c8973a" stroke-width="1.5" stroke-linecap="round"/>
        <path d="M16 10V13M16 19V22M10 16H13M22 16H19" stroke="#8b2be2" stroke-width="1.5" stroke-linecap="round"/>
      </svg>
      <div class="header-text">
        <h1>EDH POWER LEVEL</h1>
        <p>Commander Deck Exporter</p>
      </div>
    </div>
    <div class="body">
      <div class="site-badge">
        <div class="site-dot" id="siteDot"></div>
        <div class="site-label"><span id="siteLabel">Detecting site…</span></div>
      </div>
      <div class="toggle-row">
        <span class="toggle-label">Auto-analyze &amp; open on EDH Power Level</span>
        <label class="toggle">
          <input type="checkbox" id="autoOpen">
          <span class="toggle-track"></span>
        </label>
      </div>
      <div class="deck-info" id="deckInfo">
        <div class="deck-info-row">
          <span class="di-label">Commander</span>
          <span class="di-value di-commander" id="infoCommander">—</span>
        </div>
        <div class="deck-info-row">
          <span class="di-label">Main deck cards</span>
          <span class="di-value" id="infoCount">—</span>
        </div>
        <div class="deck-info-row">
          <span class="di-label">Skipped categories</span>
          <span class="di-value" id="infoSkipped">—</span>
        </div>
      </div>
      <div class="warning" id="warningBox"></div>
      <button class="btn-export" id="btnExport" disabled>
        <span class="btn-icon">⚔</span>
        Analyze Deck
      </button>
      <div class="status" id="statusBox"></div>
    </div>
    <div class="footer">Supports Archidekt · Moxfield</div>
  `;

  // Attach Chrome UI logic
  await initChromeUI();
}

async function initChromeUI() {
  const $ = id => document.getElementById(id);

  let currentTab  = null;
  let currentSite = null;
  let deckId      = null;
  let deckData    = null;
  let analyzed    = false;

  const SITE_NAMES = { archidekt: 'Archidekt', moxfield: 'Moxfield' };

  const setSiteBadge = (html, state) => {
    $('siteLabel').innerHTML = html;
    $('siteDot').className = 'site-dot' + (state === 'ok' ? ' active' : state === 'err' ? ' error' : '');
  };

  const showWarning = (msg) => {
    const w = $('warningBox');
    if (msg) { w.innerHTML = msg; w.className = 'warning visible'; }
    else      { w.className = 'warning'; }
  };

  const showStatus = (msg, type) => {
    $('statusBox').innerHTML = msg;
    $('statusBox').className = `status visible ${type}`;
  };

  const showDeckInfo = (commander, mainboard, skipped) => {
    const mainTotal = mainboard.reduce((s, c) => s + c.qty, 0);
    const cmdTotal  = commander ? (commander.qty || 1) : 0;
    const total     = mainTotal + cmdTotal;
    $('infoCommander').textContent = commander ? commander.name : '(none found)';
    $('infoCount').textContent     = `${total} cards`;
    $('infoSkipped').textContent   = skipped.length ? skipped.join(', ') : 'none';
    $('deckInfo').className        = 'deck-info visible';
  };

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  currentTab  = tab;
  currentSite = detectSite(tab?.url);

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

  // Attach click handler BEFORE triggering auto-open
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
      if ($('autoOpen').checked) { window.close(); return; }
      setTimeout(() => {
        $('btnExport').innerHTML = '<span class="btn-icon">⚡</span>Open on EDH Power Level';
      }, 2000);
    }
  });

  // NOW trigger auto-open if enabled
  if (autoOn) $('btnExport').click();
}

// ─── Orion UI (Minimal) ────────────────────────────────────────────────────────
async function buildOrionUI() {
  const root = document.getElementById('root');
  root.style.cssText = 'margin:0;padding:16px 20px;background:#0d0d12;color:#e8e4d8;font-family:-apple-system,system-ui,sans-serif;font-size:14px;min-width:220px;width:auto;min-height:auto;';
  root.innerHTML = '<p id="orion-msg">⏳ Loading deck…</p>';

  const setMsg = t => { const el = document.getElementById('orion-msg'); if (el) el.textContent = t; };

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const url    = tab?.url || '';
    const site   = detectSite(url);
    const deckId = site ? getDeckId(url, site) : null;

    if (!site || !deckId) {
      setMsg('Open an Archidekt or Moxfield deck page first.');
      return;
    }

    const result = site === 'archidekt'
      ? await fetchArchidekt(deckId)
      : await fetchMoxfield(deckId);

    chrome.tabs.create({ url: buildEDHUrl(result) });
    window.close();
  } catch (err) {
    setMsg('⚠️ ' + err.message);
  }
}

// ─── Entry point ──────────────────────────────────────────────────────────────
if (IS_CHROME) {
  buildChromeUI();
} else {
  buildOrionUI();
}
