// ─── EDH Power Level Exporter — Malformed URL Interceptor (Orion / Mobile) ────
//
// Runs as a content script at document_start on every edhpowerlevel.com page.
// Replaces the Chrome background service-worker approach (webNavigation API)
// with an in-page redirect — compatible with Orion on iOS/Android where
// persistent background workers are not available.
//
// Detects URLs of the form:
//   https://edhpowerlevel.com/https://archidekt.com/decks/…
//   https://edhpowerlevel.com/https://moxfield.com/decks/…
// (and URL-encoded / joiner variants)
// then fetches the deck via the source API and redirects to the correct URL.

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
  return { commander: commander[0] || null, mainboard };
}

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
  return { commander: commander[0] || null, mainboard };
}

function buildEDHUrl({ commander, mainboard }) {
  const enc = s => encodeURIComponent(s).replace(/%20/g, '+');
  const cmdQty  = commander?.qty  || 1;
  const cmdName = commander?.name || 'Unknown Commander';
  const commanderPart = `Commander~${cmdQty}+${enc(cmdName)}`;
  const mainPart = 'Mainboard~' + mainboard.map(c => `${c.qty}+${enc(c.name)}`).join('~');
  return `https://edhpowerlevel.com/?d=${commanderPart}~~${mainPart}~~Z~`;
}

(async () => {
  // Decode common percent-encodings so we can pattern-match cleanly
  const decoded = window.location.href
    .replace(/%20/gi, ' ')
    .replace(/%2B/gi, '+')
    .replace(/%2F/gi, '/')
    .replace(/%3A/gi, ':')
    .replace(/%3F/gi, '?')
    .replace(/%26/gi, '&')
    .replace(/%23/gi, '#');

  // Find any embedded Archidekt or Moxfield URL in the current location
  const sourceMatch = decoded.match(
    /https?:\/\/(?:www\.)?(?:archidekt\.com|moxfield\.com)\/[^\s"'<>]*/i
  );
  if (!sourceMatch) return;

  const embeddedUrl = sourceMatch[0].replace(/[+\s,;|]+$/, '');

  try {
    let deckData;
    if (embeddedUrl.includes('archidekt.com')) {
      const m = embeddedUrl.match(/\/decks\/(\d+)/);
      if (!m) throw new Error('Could not extract Archidekt deck ID');
      deckData = await fetchArchidektDeck(m[1]);
    } else if (embeddedUrl.includes('moxfield.com')) {
      const m = embeddedUrl.match(/\/decks\/([A-Za-z0-9_-]+)/);
      if (!m) throw new Error('Could not extract Moxfield deck ID');
      deckData = await fetchMoxfieldDeck(m[1]);
    } else {
      return;
    }
    window.location.replace(buildEDHUrl(deckData));
  } catch (err) {
    console.error('[EDH Exporter] redirect failed:', err);
  }
})();
