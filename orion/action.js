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

function parseArchidektRef(param) {
  const m = (param || '').match(/^([ds])_(\d+)$/);
  if (!m) return null;
  return m[1] === 's' ? `snapshots/${m[2]}` : m[2];
}

function getDeckRefs(url, site) {
  if (site === 'archidekt') {
    const params = new URLSearchParams(url.split('?')[1] || '');
    const one = parseArchidektRef(params.get('one'));
    const two = parseArchidektRef(params.get('two'));
    if (one && two) return [one, two];
    if (one) return [one];
    const snapshotM   = url.match(/\/snapshots\/(\d+)/);
    if (snapshotM) return [`snapshots/${snapshotM[1]}`];
    const playtesterM = url.match(/\/playtester[^/]*\/(\d+)/);
    if (playtesterM) return [playtesterM[1]];
    const m = url.match(/\/decks\/(\d+)/);
    return m ? [m[1]] : [];
  }
  const m = url.match(/\/decks\/([A-Za-z0-9_-]+)/);
  return m ? [m[1]] : [];
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
  return { commanders: commander, mainboard };
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
  return { commanders: commander, mainboard };
}

function buildEDHUrl({ commanders, mainboard }) {
  const enc     = s => encodeURIComponent(s).replace(/%20/g, '+');
  const cmdList = (commanders?.length)
    ? commanders.map(c => `${c.qty}+${enc(c.name)}`).join('~')
    : `1+${enc('Unknown Commander')}`;
  const cmd  = `Commander~${cmdList}`;
  const main = 'Mainboard~' + mainboard.map(c => `${c.qty}+${enc(c.name)}`).join('~');
  return `https://edhpowerlevel.com/?d=${cmd}~~${main}~~Z~`;
}

async function run() {
  const msg = document.getElementById('msg');
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const url  = tab?.url || '';
    const site = detectSite(url);
    const refs = site ? getDeckRefs(url, site) : [];

    if (!site || !refs.length) {
      msg.textContent = 'Open an Archidekt or Moxfield deck page first.';
      return;
    }

    const fetchFn = site === 'archidekt' ? fetchArchidektDeck : fetchMoxfieldDeck;
    const decks   = await Promise.all(refs.map(ref => fetchFn(ref)));
    for (const deck of decks) {
      chrome.tabs.create({ url: buildEDHUrl(deck) });
    }
    window.close();
  } catch (err) {
    console.error('[EDH Exporter]', err);
    msg.textContent = '⚠ ' + err.message;
  }
}

run();
