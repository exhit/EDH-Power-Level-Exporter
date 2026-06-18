// ─── EDH Power Level Exporter — Malformed URL Interceptor (Orion / Mobile) ────
// Detailed debugging: logs and catches errors at each step

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
  console.log('[Step 3.1] Fetching Archidekt deck:', deckId);
  try {
    const url = `https://archidekt.com/api/decks/${deckId}/`;
    console.log('[Step 3.1] URL:', url);
    const resp = await fetch(url, { headers: { 'Accept': 'application/json' } });
    console.log('[Step 3.1] Response status:', resp.status);
    if (!resp.ok) throw new Error(`Archidekt API ${resp.status}`);
    const data = await resp.json();
    console.log('[Step 3.1] Data received:', data);

    const excludedCats = new Set();
    for (const cat of (data.categories || [])) {
      if (!cat.includedInDeck || nameIsExcluded(cat.name)) excludedCats.add(cat.name);
    }

    const commander = [], mainboard = [];
    for (const entry of (data.cards || [])) {
      const name = entry.card?.oracleCard?.name || entry.card?.name || '';
      const qty = entry.quantity || 1;
      if (!name) continue;
      const primaryCat = (Array.isArray(entry.categories) ? entry.categories : [])[0] || '';
      if (primaryCat.toLowerCase() === 'commander') {
        commander.push({ qty, name });
      } else if (!excludedCats.has(primaryCat)) {
        mainboard.push({ qty, name });
      }
    }
    const result = { commanders: commander, mainboard };
    console.log('[Step 3.1] Processed deck:', result);
    return result;
  } catch (err) {
    console.error('[Step 3.1] Archidekt fetch failed:', err);
    throw err;
  }
}

async function fetchMoxfieldDeck(deckId) {
  console.log('[Step 3.2] Fetching Moxfield deck:', deckId);
  try {
    const url = `https://api.moxfield.com/v2/decks/all/${deckId}`;
    console.log('[Step 3.2] URL:', url);
    const resp = await fetch(url, {
      headers: { 'Accept': 'application/json', 'User-Agent': 'EDH-PowerLevel-Exporter/1.0' }
    });
    console.log('[Step 3.2] Response status:', resp.status);
    if (!resp.ok) throw new Error(`Moxfield API ${resp.status}`);
    const data = await resp.json();
    console.log('[Step 3.2] Data received:', data);

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
    const result = { commanders: commander, mainboard };
    console.log('[Step 3.2] Processed deck:', result);
    return result;
  } catch (err) {
    console.error('[Step 3.2] Moxfield fetch failed:', err);
    throw err;
  }
}

function buildEDHUrl({ commanders, mainboard }) {
  console.log('[Step 4] Building EDH URL');
  try {
    const enc = s => encodeURIComponent(s).replace(/%20/g, '+');
    const cmdList = (commanders?.length)
      ? commanders.map(c => `${c.qty}+${enc(c.name)}`).join('~')
      : `1+${enc('Unknown Commander')}`;
    const commanderPart = `Commander~${cmdList}`;
    const mainPart = 'Mainboard~' + mainboard.map(c => `${c.qty}+${enc(c.name)}`).join('~');
    const url = `https://edhpowerlevel.com/?d=${commanderPart}~~${mainPart}~~Z~`;
    console.log('[Step 4] Built URL:', url);
    return url;
  } catch (err) {
    console.error('[Step 4] URL building failed:', err);
    throw err;
  }
}

function fetchDeckViaBackground(site, deckId) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(
      {
        type: "fetchDeck",
        site,
        deckId
      },
      (response) => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
          return;
        }

        if (!response?.success) {
          reject(new Error(response?.error || "Unknown error"));
          return;
        }

        resolve(response.data);
      }
    );
  });
}

(async () => {
  console.log('[Step 1] Starting malformed URL check');

  try {
    // STEP 1: Get current URL from multiple sources
    console.log('[Step 1] Current URL (href):', window.location.href);
    console.log('[Step 1] pathname:', window.location.pathname);
    console.log('[Step 1] search:', window.location.search);
    console.log('[Step 1] hash:', window.location.hash);

    // Try document.location.toString() as well
    const docLocStr = document.location.toString();
    console.log('[Step 1] document.location.toString():', docLocStr);

    // The full URL might be in pathname if it wasn't properly parsed
    let url = window.location.href;
    if (window.location.pathname && window.location.pathname.length > 1) {
      // pathname might contain the embedded URL
      url = window.location.protocol + '//' + window.location.host + window.location.pathname;
      console.log('[Step 1] Using reconstructed URL from pathname:', url);
    }

    // STEP 2: Decode URL
    console.log('[Step 2] Decoding URL');
    const decoded = url
      .replace(/%20/gi, ' ')
      .replace(/%2B/gi, '+')
      .replace(/%2F/gi, '/')
      .replace(/%3A/gi, ':')
      .replace(/%3F/gi, '?')
      .replace(/%26/gi, '&')
      .replace(/%23/gi, '#');
    console.log('[Step 2] Decoded URL:', decoded);

    // STEP 2b: Check if this is edhpowerlevel.com
    if (!decoded.includes('edhpowerlevel.com')) {
      console.log('[Step 2b] Not an edhpowerlevel.com URL, exiting. URL = ' + decoded);
      return;
    }

    // STEP 2c: Look for embedded deck URL
    console.log('[Step 2c] Looking for embedded deck URL in: ' + decoded);
    const sourceMatch = decoded.match(
      /https?:\/+(?:www\.)?(?:archidekt\.com|moxfield\.com)\/[^\s"'<>]*/i
    );

    if (!sourceMatch) {
      console.log('[Step 2c] No embedded deck URL found in decoded URL');
      console.log('[Step 2c] Full decoded string to check:', decoded);
      return;
    }

    console.log('[Step 2c] Found embedded URL:', sourceMatch[0]);

    // STEP 3: Extract and normalize embedded URL
    console.log('[Step 3] Extracting deck source');
    const embeddedUrl = sourceMatch[0]
      .replace(/^https?:\/+/, 'https://')
      .replace(/[+\s,;|]+$/, '');
    console.log('[Step 3] Normalized embedded URL:', embeddedUrl);

    // STEP 3a: Determine site and extract deck ID
    let deckData;
    if (embeddedUrl.includes("archidekt.com")) {
      const parseRef = p => { const m = (p||'').match(/^([ds])_(\d+)$/); return m ? (m[1]==='s'?`snapshots/${m[2]}`:m[2]) : null; };
      const params   = new URLSearchParams(embeddedUrl.split('?')[1] || '');
      const one = parseRef(params.get('one'));
      const two = parseRef(params.get('two'));
      if (one && two) {
        const [data1, data2] = await Promise.all([
          fetchDeckViaBackground("archidekt", one),
          fetchDeckViaBackground("archidekt", two)
        ]);
        window.open(buildEDHUrl(data2), '_blank');
        window.location.replace(buildEDHUrl(data1));
        return;
      }
      const snapshotM   = embeddedUrl.match(/\/snapshots\/(\d+)/);
      const playtesterM = embeddedUrl.match(/\/playtester[^/]*\/(\d+)/);
      const deckM       = embeddedUrl.match(/\/decks\/(\d+)/);
      const deckId      = snapshotM ? `snapshots/${snapshotM[1]}` : (playtesterM?.[1] ?? deckM?.[1]);

      if (!deckId) {
        throw new Error(
          "Could not extract Archidekt deck ID from: " + embeddedUrl
        );
      }

      deckData = await fetchDeckViaBackground("archidekt", deckId);
    } else if (embeddedUrl.includes("moxfield.com")) {
      const m = embeddedUrl.match(/\/decks\/([A-Za-z0-9_-]+)/);

      if (!m) {
        throw new Error(
          "Could not extract Moxfield deck ID from: " + embeddedUrl
        );
      }

      deckData = await fetchDeckViaBackground("moxfield", m[1]);
    } else {
      throw new Error("Unknown deck source: " + embeddedUrl);
    }

    // STEP 5: Navigate
    console.log('[Step 5] Navigating to EDH Power Level');
    const correctUrl = buildEDHUrl(deckData);
    console.log('[Step 5] Final URL:', correctUrl);
    window.location.replace(correctUrl);

  } catch (err) {
    console.error('[ERROR]', err);
    console.error('[ERROR] Stack:', err.stack);
  }
})();
