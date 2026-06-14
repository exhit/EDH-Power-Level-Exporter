// Runs as the extension action popup.
// Detects the current deck, fetches it, opens EDH Power Level, then closes.

const EXCLUDED_NAMES = [
  'sideboard', 'side board', 'maybeboard', 'maybe board',
  'maybe-board', 'side-board', 'wishlist', 'watch list',
  'acquiring', 'to acquire', 'on the chopping block'
];

function nameIsExcluded(cat) {
  return EXCLUDED_NAMES.some(ex => (cat || '').toLowerCase().trim() === ex);
}

function detectSite(url) {
  if (url.includes('archidekt.com')) return 'archidekt';
  if (url.includes('moxfield.com'))  return 'moxfield';
  return null;
}

function getDeckId(url, site) {
  const m = site === 'archidekt'
    ? url.match(/\/decks\/(\d+)/)
    : url.match(/\/decks\/([A-Za-z0-9_-]+)/);
  return m ? m[1] : null;
}

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

function buildEDHUrl({ commander, mainboard }) {
  const enc  = s => encodeURIComponent(s).replace(/%20/g, '+');
  const cmd  = `Commander~${commander?.qty || 1}+${enc(commander?.name || 'Unknown Commander')}`;
  const main = 'Mainboard~' + mainboard.map(c => `${c.qty}+${enc(c.name)}`).join('~');
  return `https://edhpowerlevel.com/?d=${cmd}~~${main}~~Z~`;
}

async function run() {
  const msg = document.getElementById('msg');
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const url   = tab?.url || '';
    const site  = detectSite(url);
    const deckId = site ? getDeckId(url, site) : null;

    if (!site || !deckId) {
      msg.textContent = 'Open an Archidekt or Moxfield deck page first.';
      return;
    }

    const deck = site === 'archidekt'
      ? await fetchArchidektDeck(deckId)
      : await fetchMoxfieldDeck(deckId);

    chrome.tabs.create({ url: buildEDHUrl(deck) });
    window.close();
  } catch (err) {
    console.error('[EDH Exporter]', err);
    msg.textContent = '⚠ ' + err.message;
  }
}

run();
