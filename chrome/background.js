// ─── Background Service Worker ────────────────────────────────────────────────
// Intercepts malformed edhpowerlevel.com URLs that embed a deck source URL
// as their path, e.g.:
//   https://edhpowerlevel.com/https://archidekt.com/decks/19912927/...
//   https://edhpowerlevel.com/https://moxfield.com/decks/oEJFxU4VPkCO.../...
//
// When detected: blocks navigation, fetches the deck via the site API,
// builds the correct edhpowerlevel.com/?d=... URL, and redirects.

const EXCLUDED_NAMES = [
  'sideboard', 'side board', 'maybeboard', 'maybe board',
  'maybe-board', 'side-board', 'wishlist', 'watch list',
  'acquiring', 'to acquire', 'on the chopping block'
];

function nameIsExcluded(cat) {
  const lower = (cat || '').toLowerCase().trim();
  return EXCLUDED_NAMES.some(ex => lower === ex);
}

// ─── Archidekt fetch (same logic as popup.js) ─────────────────────────────────
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
    if (name) commander.push({ qty: e.quantity || 1, name });
  }
  for (const board of ['mainboard', 'companions']) {
    for (const [, e] of Object.entries(data[board] || {})) {
      const name = e.card?.name || '';
      if (name) mainboard.push({ qty: e.quantity || 1, name });
    }
  }
  return { commanders: commander, mainboard };
}

// ─── URL builder ──────────────────────────────────────────────────────────────
function buildEDHUrl({ commanders, mainboard }) {
  const enc = s => encodeURIComponent(s).replace(/%20/g, '+');
  const cmdList = (commanders?.length)
    ? commanders.map(c => `${c.qty}+${enc(c.name)}`).join('~')
    : `1+${enc('Unknown Commander')}`;
  const commanderPart = `Commander~${cmdList}`;
  const mainPart = 'Mainboard~' + mainboard.map(c => `${c.qty}+${enc(c.name)}`).join('~');
  return `https://edhpowerlevel.com/?d=${commanderPart}~~${mainPart}~~Z~`;
}

// ─── Navigation listener ──────────────────────────────────────────────────────
chrome.webNavigation.onBeforeNavigate.addListener(async (details) => {
  // Only top-level navigations
  if (details.frameId !== 0) return;

  const url = details.url;

  // Match edhpowerlevel.com URLs that have a deck source URL embedded after
  // any kind of joiner. Known joiners: / + %20 ? & # | , ; or none.
  // Also handles URL-encoded variants (%2F, %3A, %2B, etc.).

  // Step 1: decode common percent-encodings so we can parse cleanly
  const decoded = url
    .replace(/%20/gi, ' ')
    .replace(/%2B/gi, '+')
    .replace(/%2F/gi, '/')
    .replace(/%3A/gi, ':')
    .replace(/%3F/gi, '?')
    .replace(/%26/gi, '&')
    .replace(/%23/gi, '#');

  // Step 2: only act on edhpowerlevel.com navigations
  if (!decoded.startsWith('https://edhpowerlevel.com')) return;

  // Step 3: find any embedded archidekt or moxfield URL in the full string
  const sourceMatch = decoded.match(/https?:\/\/(?:www\.)?(?:archidekt\.com|moxfield\.com)\/[^\s"'<>]*/i);
  if (!sourceMatch) return;

  // Trim trailing punctuation that may have been appended by the link generator
  const embeddedUrl = sourceMatch[0].replace(/[+\s,;|]+$/, '');
  const tabId = details.tabId;

  // Immediately redirect to a blank state while we work
  chrome.tabs.update(tabId, { url: 'about:blank' });

  try {
    let deckData;

    if (embeddedUrl.includes('archidekt.com')) {
      const parseRef = p => { const m = (p||'').match(/^([ds])_(\d+)$/); return m ? (m[1]==='s'?`snapshots/${m[2]}`:m[2]) : null; };
      const params   = new URLSearchParams(embeddedUrl.split('?')[1] || '');
      const one = parseRef(params.get('one'));
      const two = parseRef(params.get('two'));
      if (one && two) {
        const [data1, data2] = await Promise.all([fetchArchidektDeck(one), fetchArchidektDeck(two)]);
        chrome.tabs.update(tabId, { url: buildEDHUrl(data1) });
        chrome.tabs.create({ url: buildEDHUrl(data2) });
        return;
      }
      const snapshotM   = embeddedUrl.match(/\/snapshots\/(\d+)/);
      const playtesterM = embeddedUrl.match(/\/playtester[^/]*\/(\d+)/);
      const deckM       = embeddedUrl.match(/\/decks\/(\d+)/);
      const deckId      = snapshotM ? `snapshots/${snapshotM[1]}` : (playtesterM?.[1] ?? deckM?.[1]);
      if (!deckId) throw new Error('Could not extract Archidekt deck ID');
      deckData = await fetchArchidektDeck(deckId);
    } else if (embeddedUrl.includes('moxfield.com')) {
      const m = embeddedUrl.match(/\/decks\/([A-Za-z0-9_-]+)/);
      if (!m) throw new Error('Could not extract Moxfield deck ID');
      deckData = await fetchMoxfieldDeck(m[1]);
    } else {
      throw new Error('Unrecognised deck source');
    }

    const correctUrl = buildEDHUrl(deckData);
    chrome.tabs.update(tabId, { url: correctUrl });

  } catch (err) {
    // On failure, just go to the edhpowerlevel homepage so the user isn't stuck on about:blank
    console.error('[EDH Exporter] redirect failed:', err);
    chrome.tabs.update(tabId, { url: 'https://edhpowerlevel.com/' });
  }
});
