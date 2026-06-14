// ─── EDH Power Level Exporter — Mobile Floating Button ───────────────────────
//
// Injects a floating "Analyze Deck" button on Archidekt and Moxfield deck pages.
// Single tap: fetches the deck and opens EDH Power Level in a new tab.
// Handles SPA navigation so the button appears/disappears as the URL changes.

const EXCLUDED_NAMES = [
  'sideboard', 'side board', 'maybeboard', 'maybe board',
  'maybe-board', 'side-board', 'wishlist', 'watch list',
  'acquiring', 'to acquire', 'on the chopping block'
];

function nameIsExcluded(cat) {
  const lower = (cat || '').toLowerCase().trim();
  return EXCLUDED_NAMES.some(ex => lower === ex);
}

// ─── Site + deck detection ───────────────────────────────────────────────────
function detectSite() {
  const host = window.location.hostname;
  if (host.includes('archidekt.com')) return 'archidekt';
  if (host.includes('moxfield.com'))  return 'moxfield';
  return null;
}

function getDeckId(site) {
  if (!site) return null;
  const m = site === 'archidekt'
    ? window.location.pathname.match(/\/decks\/(\d+)/)
    : window.location.pathname.match(/\/decks\/([A-Za-z0-9_-]+)/);
  return m ? m[1] : null;
}

// ─── Archidekt fetch ─────────────────────────────────────────────────────────
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

  const commander = [], mainboard = [];
  for (const entry of (data.cards || [])) {
    const name = entry.card?.oracleCard?.name || entry.card?.name || '';
    const qty  = entry.quantity || 1;
    if (!name) continue;
    const primaryCat = (Array.isArray(entry.categories) ? entry.categories : [])[0] || '';
    if (primaryCat.toLowerCase() === 'commander') commander.push({ qty, name });
    else if (!excludedCats.has(primaryCat)) mainboard.push({ qty, name });
  }
  return { commander: commander[0] || null, mainboard };
}

// ─── Moxfield fetch ──────────────────────────────────────────────────────────
async function fetchMoxfieldDeck(deckId) {
  const resp = await fetch(`https://api.moxfield.com/v2/decks/all/${deckId}`, {
    headers: { 'Accept': 'application/json', 'User-Agent': 'EDH-PowerLevel-Exporter/1.0' }
  });
  if (!resp.ok) throw new Error(`Moxfield API ${resp.status}`);
  const data = await resp.json();

  const commander = [], mainboard = [];
  for (const [, e] of Object.entries(data.commanders || {})) {
    const name = e.card?.name || '';
    if (name) commander.push({ qty: e.quantity || 1, name });
  }
  for (const board of ['mainboard', 'companions']) {
    for (const [, e] of Object.entries(data[board] || {})) {
      const name = e.card?.name || '';
      if (name) mainboard.push({ qty: e.quantity || 1, name });
    }
  }
  return { commander: commander[0] || null, mainboard };
}

// ─── URL builder ─────────────────────────────────────────────────────────────
function buildEDHUrl({ commander, mainboard }) {
  const enc = s => encodeURIComponent(s).replace(/%20/g, '+');
  const cmdQty  = commander?.qty  || 1;
  const cmdName = commander?.name || 'Unknown Commander';
  const commanderPart = `Commander~${cmdQty}+${enc(cmdName)}`;
  const mainPart = 'Mainboard~' + mainboard.map(c => `${c.qty}+${enc(c.name)}`).join('~');
  return `https://edhpowerlevel.com/?d=${commanderPart}~~${mainPart}~~Z~`;
}

// ─── Floating action button ───────────────────────────────────────────────────
const FAB_ID = 'edh-powerlevel-fab';

function removeButton() {
  document.getElementById(FAB_ID)?.remove();
}

function injectButton(site, deckId) {
  if (document.getElementById(FAB_ID)) return;

  const btn = document.createElement('button');
  btn.id = FAB_ID;
  btn.textContent = '⚔  Analyze Deck';

  Object.assign(btn.style, {
    position:                'fixed',
    bottom:                  '24px',
    right:                   '16px',
    zIndex:                  '2147483647',
    padding:                 '14px 22px',
    background:              'linear-gradient(135deg, #8b2be2 0%, #5a1fa0 100%)',
    color:                   '#fff',
    fontFamily:              '-apple-system, system-ui, sans-serif',
    fontSize:                '15px',
    fontWeight:              '600',
    letterSpacing:           '0.03em',
    border:                  'none',
    borderRadius:            '50px',
    cursor:                  'pointer',
    boxShadow:               '0 4px 20px rgba(139,43,226,0.55)',
    transition:              'opacity 0.15s, transform 0.1s',
    WebkitTapHighlightColor: 'transparent',
    touchAction:             'manipulation',
    userSelect:              'none',
  });

  btn.addEventListener('touchstart', () => { btn.style.transform = 'scale(0.96)'; }, { passive: true });
  btn.addEventListener('touchend',   () => { btn.style.transform = 'scale(1)'; },   { passive: true });

  btn.addEventListener('click', async () => {
    btn.disabled = true;
    btn.textContent = '⏳  Analyzing…';
    btn.style.opacity = '0.75';

    // Open a blank tab synchronously within the gesture so iOS doesn't block it
    const win = window.open('', '_blank');

    try {
      const deckData = site === 'archidekt'
        ? await fetchArchidektDeck(deckId)
        : await fetchMoxfieldDeck(deckId);

      const url = buildEDHUrl(deckData);

      if (win) {
        win.location.href = url;
      } else {
        // Popup was blocked — navigate current tab as fallback
        window.location.href = url;
      }

      btn.textContent = '✓  Opened!';
      btn.style.background = 'linear-gradient(135deg, #3ecf7e 0%, #1a8c50 100%)';
      btn.style.opacity = '1';
      setTimeout(() => {
        btn.textContent = '⚔  Analyze Deck';
        btn.style.background = 'linear-gradient(135deg, #8b2be2 0%, #5a1fa0 100%)';
        btn.disabled = false;
      }, 2500);

    } catch (err) {
      if (win) win.close();
      btn.textContent = '⚠  Error — tap to retry';
      btn.style.background = 'linear-gradient(135deg, #e2483d 0%, #8b1a1a 100%)';
      btn.style.opacity = '1';
      btn.disabled = false;
      setTimeout(() => {
        btn.textContent = '⚔  Analyze Deck';
        btn.style.background = 'linear-gradient(135deg, #8b2be2 0%, #5a1fa0 100%)';
      }, 3000);
    }
  });

  document.body.appendChild(btn);
}

// ─── Page state tracking (SPA navigation aware) ───────────────────────────────
function checkPage() {
  const site   = detectSite();
  const deckId = getDeckId(site);
  if (site && deckId) {
    injectButton(site, deckId);
  } else {
    removeButton();
  }
}

checkPage();

// Re-evaluate whenever the SPA changes the URL without a full page reload
let lastHref = location.href;
new MutationObserver(() => {
  if (location.href !== lastHref) {
    lastHref = location.href;
    checkPage();
  }
}).observe(document.documentElement, { subtree: true, childList: true });
