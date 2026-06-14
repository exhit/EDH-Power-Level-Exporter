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
  return { commander: commander[0] || null, mainboard };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type !== "fetchDeck") {
    return;
  }

  (async () => {
    try {
      let deckData;

      switch (message.site) {
        case "archidekt":
          deckData = await fetchArchidektDeck(message.deckId);
          break;

        case "moxfield":
          deckData = await fetchMoxfieldDeck(message.deckId);
          break;

        default:
          throw new Error(`Unknown site: ${message.site}`);
      }

      sendResponse({
        success: true,
        data: deckData
      });
    } catch (err) {
      console.error(err);

      sendResponse({
        success: false,
        error: err instanceof Error ? err.message : String(err)
      });
    }
  })();

  // Keep the message channel open for the async response.
  return true;
});