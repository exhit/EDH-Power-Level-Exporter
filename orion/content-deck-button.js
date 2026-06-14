// ─── EDH Power Level Exporter — Mobile Floating Button (Orion iOS) ───────────
//
// Injects a floating button on Archidekt and Moxfield deck pages.
// Tap → fetch deck → navigate to edhpowerlevel.com with the deck pre-loaded.

// ─── Category exclusions ─────────────────────────────────────────────────────
const EXCLUDED_NAMES = [
  'sideboard', 'side board', 'maybeboard', 'maybe board',
  'maybe-board', 'side-board', 'wishlist', 'watch list',
  'acquiring', 'to acquire', 'on the chopping block'
];

function nameIsExcluded(cat) {
  return EXCLUDED_NAMES.some(ex => (cat || '').toLowerCase().trim() === ex);
}

// ─── Site + deck detection ───────────────────────────────────────────────────
function detectSite() {
  const h = window.location.hostname;
  if (h.includes('archidekt.com')) return 'archidekt';
  if (h.includes('moxfield.com'))  return 'moxfield';
  return null;
}

function getDeckId(site) {
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
  for (const cat of (data.categories || []))
    if (!cat.includedInDeck || nameIsExcluded(cat.name)) excludedCats.add(cat.name);

  const commander = [], mainboard = [];
  for (const entry of (data.cards || [])) {
    const name = entry.card?.oracleCard?.name || entry.card?.name || '';
    const qty  = entry.quantity || 1;
    if (!name) continue;
    const cat = (Array.isArray(entry.categories) ? entry.categories : [])[0] || '';
    if (cat.toLowerCase() === 'commander') commander.push({ qty, name });
    else if (!excludedCats.has(cat))       mainboard.push({ qty, name });
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
  const enc  = s => encodeURIComponent(s).replace(/%20/g, '+');
  const cmd  = `Commander~${commander?.qty || 1}+${enc(commander?.name || 'Unknown Commander')}`;
  const main = 'Mainboard~' + mainboard.map(c => `${c.qty}+${enc(c.name)}`).join('~');
  return `https://edhpowerlevel.com/?d=${cmd}~~${main}~~Z~`;
}

// ─── Floating button ─────────────────────────────────────────────────────────
const FAB_ID = 'edh-powerlevel-fab';

function removeButton() {
  document.getElementById(FAB_ID)?.remove();
}

function injectButton(site, deckId) {
  if (document.getElementById(FAB_ID)) return;

  const btn = document.createElement('button');
  btn.id = FAB_ID;
  btn.textContent = '⚔  Open on EDH Power Level';

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
    border:                  'none',
    borderRadius:            '50px',
    cursor:                  'pointer',
    boxShadow:               '0 4px 20px rgba(139,43,226,0.55)',
    WebkitTapHighlightColor: 'transparent',
    touchAction:             'manipulation',
    userSelect:              'none',
  });

  btn.addEventListener('click', async () => {
    btn.textContent = '⏳  Loading…';
    btn.disabled    = true;

    try {
      const deck = site === 'archidekt'
        ? await fetchArchidektDeck(deckId)
        : await fetchMoxfieldDeck(deckId);

      window.location.href = buildEDHUrl(deck);
    } catch (err) {
      console.error('[EDH Exporter]', err);
      btn.textContent = '⚠  Error — tap to retry';
      btn.disabled    = false;
      setTimeout(() => { btn.textContent = '⚔  Open on EDH Power Level'; }, 3000);
    }
  });

  document.body.appendChild(btn);
}

// ─── SPA navigation awareness ─────────────────────────────────────────────────
function checkPage() {
  const site   = detectSite();
  const deckId = getDeckId(site);
  if (site && deckId) injectButton(site, deckId);
  else                removeButton();
}

checkPage();

let lastHref = location.href;
new MutationObserver(() => {
  if (location.href !== lastHref) {
    lastHref = location.href;
    checkPage();
  }
}).observe(document.documentElement, { subtree: true, childList: true });
