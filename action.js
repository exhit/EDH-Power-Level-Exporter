// Runs as the extension action popup.
// Lets the user pick an export destination, then detects the current deck,
// fetches it, opens the destination, and closes.

const EXCLUDED_NAMES = [
  'sideboard', 'side board', 'maybeboard', 'maybe board',
  'maybe-board', 'side-board', 'wishlist', 'watch list',
  'acquiring', 'to acquire', 'on the chopping block'
];

function nameIsExcluded(cat) {
  return EXCLUDED_NAMES.some(ex => (cat || '').toLowerCase().trim() === ex);
}

function detectSite(url) {
  url = url || '';
  if (url.includes('archidekt.com'))          return 'archidekt';
  if (url.includes('moxfield.com'))           return 'moxfield';
  if (url.includes('edhpowerlevel.com'))      return 'edhpowerlevel';
  if (url.includes('commanderspellbook.com')) return 'commanderspellbook';
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
    if (name) commander.push({ qty: e.quantity || 1, name, scryfallId: e.card?.scryfall_id });
  }
  for (const board of ['mainboard', 'companions']) {
    for (const [, e] of Object.entries(data[board] || {})) {
      const name = e.card?.name || '';
      if (name) mainboard.push({ qty: e.quantity || 1, name, scryfallId: e.card?.scryfall_id });
    }
  }
  return { commanders: commander, mainboard };
}

// Reverse of buildEDHUrl below: EDH Power Level's own page JS reads its `?d=`
// param on load AND rewrites it (history.pushState) every time "Analyze List"
// runs on a manually-pasted list — so the current tab URL reliably reflects
// whatever decklist is currently in that page's input box, without needing
// to read the DOM at all.
function parseEDHPowerLevelUrl(url) {
  let d;
  try { d = new URL(url).searchParams.get('d'); } catch (_) { return null; }
  if (!d) return null;
  d = d.replace(/~Z~?$/, '');

  const parseSection = (raw) => {
    const tokens = (raw || '').split('~').map(t => t.trim()).filter(Boolean);
    if (tokens.length && !/^\d/.test(tokens[0])) tokens.shift(); // drop "Commander"/"Mainboard" label
    return tokens.map(entry => {
      const m = entry.match(/^(\d+)\s+(.*)$/);
      return m ? { qty: parseInt(m[1], 10) || 1, name: m[2].trim() } : { qty: 1, name: entry };
    }).filter(c => c.name);
  };

  const sections = d.split('~~');
  if (sections.length >= 2) {
    const commanders = parseSection(sections[0]).filter(c => c.name !== 'Unknown Commander');
    const mainboard  = parseSection(sections[1]);
    if (mainboard.length || commanders.length) return { commanders, mainboard };
  }
  // No recognizable Commander/Mainboard split (e.g. a manually-pasted flat
  // list with no section labels) — fall back to one undifferentiated list.
  const flat = parseSection(d);
  return flat.length ? { commanders: [], mainboard: flat } : null;
}

// Lenient parser for the plain decklist text formats Commander Spellbook's
// own textarea placeholder advertises: "Card", "1 Card", "1x Card",
// "Card (SET) 123", "1 Card (SET) 123 *F*".
function parseCardListText(text) {
  const cards = [];
  for (const raw of (text || '').split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const m = line.match(/^(\d+)\s*x?\s+(.+)$/i);
    let qty = 1, name = line;
    if (m) { qty = parseInt(m[1], 10) || 1; name = m[2]; }
    name = name.replace(/\s*\([A-Za-z0-9]{2,6}\)\s*[\w-]*\s*(\*F\*)?\s*$/i, '').trim();
    if (name) cards.push({ qty, name });
  }
  return cards;
}

// Commander Spellbook keeps the decklist/commander textareas as local React
// state, not synced back to the URL (its own "Find New Combos!" button
// clears the query string), so the only reliable read is the live DOM.
async function getCommanderSpellbookDeck(tabId) {
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => ({
      commanders: document.getElementById('commander-input')?.value || '',
      decklist:   document.getElementById('decklist-input')?.value || ''
    })
  });
  const commanders = parseCardListText(result.commanders);
  const mainboard  = parseCardListText(result.decklist);
  if (!commanders.length && !mainboard.length) {
    throw new Error('Paste a decklist into Commander Spellbook first.');
  }
  return { commanders, mainboard };
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

// Commander Spellbook's find-my-combos page also reads `decklist`/`commanders`
// query params directly (its own `?deckUrl=` mode re-fetches the deck from
// Archidekt/Moxfield itself, which doesn't apply the same excluded-category
// filtering fetchArchidektDeck/fetchMoxfieldDeck already did above — that
// let sideboard/maybeboard cards leak in). Reusing the same already-filtered
// commanders/mainboard used for buildEDHUrl guarantees the two exports agree.
function buildCommanderSpellbookUrl({ commanders, mainboard }) {
  const toLines = arr => arr.map(c => `${c.qty} ${c.name}`).join('\n');
  const params = new URLSearchParams();
  if (commanders.length) params.set('commanders', toLines(commanders));
  params.set('decklist', toLines(mainboard));
  return `https://commanderspellbook.com/find-my-combos/?${params.toString()}`;
}

// Batches identifiers through Scryfall's /cards/collection (max 75 per
// request) and returns the raw matched card objects.
async function fetchScryfallCollection(identifiers) {
  if (!identifiers.length) {
    console.warn('[EDHPORT] fetchScryfallCollection called with 0 identifiers — nothing to look up');
    return [];
  }
  const found = [];
  for (let i = 0; i < identifiers.length; i += 75) {
    const chunk = identifiers.slice(i, i + 75);
    try {
      const resp = await fetch('https://api.scryfall.com/cards/collection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({ identifiers: chunk })
      });
      if (!resp.ok) {
        const bodyText = await resp.text().catch(() => '(no body)');
        console.warn(`[EDHPORT] Scryfall /cards/collection returned ${resp.status} for a chunk of ${chunk.length} identifiers`, bodyText);
        continue;
      }
      const data = await resp.json();
      if (data.not_found?.length) {
        console.warn('[EDHPORT] Scryfall could not find these identifiers', data.not_found);
      }
      found.push(...(data.data || []));
    } catch (err) {
      console.warn('[EDHPORT] Scryfall lookup failed', err);
    }
  }
  return found;
}

// Scryfall's "default" exact-name match isn't necessarily a printing other
// sites carry — it can be whatever's newest, including a Secret Lair or
// crossover promo. This fetches every printing of a name ordered by release
// date and returns the oldest one that ISN'T itself risky (the whole card
// object, not just its id, so callers can also show what set/year it's
// from). Plain "oldest" isn't enough on its own: some cards' regular and
// promo printings release on the exact same day (confirmed with Ygra,
// Eater of All — its Bloomburrow set card and promo variant both released
// 2024-08-02), and Scryfall doesn't order same-day prints regular-first, so
// picking data[0] blindly can still hand back the promo.
async function fetchBestScryfallPrinting(name) {
  const url = 'https://api.scryfall.com/cards/search?q='
    + encodeURIComponent(`!"${name}"`) + '&unique=prints&order=released&dir=asc';
  try {
    const resp = await fetch(url, { headers: { 'Accept': 'application/json' } });
    if (!resp.ok) return null;
    const data = await resp.json();
    const prints = (data.data || []).filter(c => !c.digital);
    return prints.find(c => !isRiskyPrinting(c)) || prints[0] || null;
  } catch (err) {
    console.warn('[EDHPORT] Scryfall printing search failed', err);
    return null;
  }
}

function printLabel(card) {
  const year = (card.released_at || '').slice(0, 4);
  return `${card.set_name || card.set}${year ? ' (' + year + ')' : ''}`;
}

// Verified against real decks: a printing with a `flavor_name` (Secret
// Lair "reskins" like Sylvan Library as "La abundancia de Yucahú") is one
// kind of print Archidekt's card pool tends not to carry. Confirmed
// separately that promo/box prints WITHOUT a flavor_name mismatch (Ygra,
// Eater of All's Bloomburrow promo; Secret Lair Commander cards like
// Krark-Clan Ironworks/Phyrexian Altar) also break the sandbox — a single
// unresolvable uid fails the whole load, not just that one card — so
// set_type has to be checked too, not just name mismatches.
// A digital-only printing (Arena/MTGO exclusive, `digital: true`) has no
// physical card behind it at all, so it's just as unusable for Archidekt
// as a flavor-name reskin — flagged as risky here so it goes through the
// same swap-to-a-real-printing-and-confirm flow instead of silently ending
// up in the export.
const RISKY_SET_TYPES = new Set(['box', 'memorabilia', 'funny', 'promo']);
const isRiskyPrinting = (card) => !!card.flavor_name || RISKY_SET_TYPES.has(card.set_type) || !!card.digital;

// Shared by the "Copy full decklist" and "Debug: open + copy each card"
// buttons — a qty+name+set(+collector#) dump of exactly what's about to be
// sent, so both card counts AND which specific printing each one resolved
// to can be sanity-checked by hand, without needing to decode the sandbox
// URL.
function buildResolvedDecklistText(allCards) {
  return allCards.map(c => {
    const name = c.lookupName || c.name;
    const qty  = c.qty || 1;
    if (c.resolvedCard) return `${qty} ${name} (${c.resolvedCard.set})${c.resolvedCard.collector_number ? ' ' + c.resolvedCard.collector_number : ''}`;
    if (c.scryfallId)   return `${qty} ${name} (original printing)`;
    return `${qty} ${name} — ⚠ NOT RESOLVED, will be dropped`;
  }).join('\n');
}

function setButtonLabel(btn, text) {
  const span = btn.querySelector('span');
  if (span) span.textContent = text; else btn.textContent = text;
}

// Asks the user to confirm any printing swaps before they happen. This runs
// inside the popup itself rather than injecting a confirm() into the tab —
// that was tried first, but showing a native dialog on the tab hands it
// focus, and Chrome closes popups that lose focus, killing the export
// mid-flight before the result ever came back.
//
// allCards (the full commander+mainboard list, WITH each entry's resolved
// print already attached as .resolvedCard) backs both the "Copy full
// decklist" button and the debug button below.
async function confirmPrintingChanges(changes, allCards) {
  const picker          = document.getElementById('picker');
  const msg             = document.getElementById('msg');
  const confirmBox      = document.getElementById('printConfirm');
  const textEl          = document.getElementById('printConfirmText');
  const copyBtn         = document.getElementById('printConfirmCopyList');
  const continueBtn     = document.getElementById('printConfirmContinue');
  const copyContinueBtn = document.getElementById('printConfirmCopyContinue');
  const cancelBtn       = document.getElementById('printConfirmCancel');
  const debugBtn        = document.getElementById('printConfirmDebugEach'); // hidden; kept wired in case it's re-enabled
  picker.classList.add('hidden');
  msg.classList.add('hidden');

  const lines = changes.map(c => `${c.name}\n  ${c.from} → ${c.to}`);
  textEl.textContent = `Some card printings will be changed for Archidekt compatibility:\n\n${lines.join('\n\n')}`;
  confirmBox.classList.remove('hidden');

  const copyDecklist = () => navigator.clipboard.writeText(buildResolvedDecklistText(allCards));

  const copyLabel = copyBtn.querySelector('span')?.textContent ?? copyBtn.textContent;
  copyBtn.onclick = async () => {
    try {
      await copyDecklist();
      setButtonLabel(copyBtn, 'Copied!');
    } catch (err) {
      console.warn('[EDHPORT] clipboard copy failed', err);
      setButtonLabel(copyBtn, "Couldn't copy");
    }
    setTimeout(() => setButtonLabel(copyBtn, copyLabel), 1500);
  };

  // Debug-only: opens ONE Archidekt sandbox per card instead of the combined
  // deck, so a single card Archidekt can't resolve shows up as one broken
  // tab among many working ones, instead of taking down the whole combined
  // sandbox with no way to tell which specific card did it. The actual
  // tab-opening loop (and its progress/Stop UI) is handed off to
  // background.js and a dedicated control window so it keeps running, with
  // a working Stop button, even if this popup gets closed partway through.
  const debugLabel = debugBtn.querySelector('span')?.textContent ?? debugBtn.textContent;
  debugBtn.onclick = async () => {
    try { await copyDecklist(); }
    catch (err) { console.warn('[EDHPORT] clipboard copy failed', err); }

    const withUid = allCards
      .map(c => ({ boardCat: c.boardCat || 'm', qty: c.qty || 1, uid: c.resolvedCard?.id || c.scryfallId }))
      .filter(c => c.uid);

    chrome.runtime.sendMessage({ type: 'openDebugSandboxTabs', cards: withUid });
    setButtonLabel(debugBtn, 'Opened in a new window →');
    setTimeout(() => setButtonLabel(debugBtn, debugLabel), 3000);
  };

  return new Promise((resolve) => {
    const finish = (proceed) => {
      confirmBox.classList.add('hidden');
      msg.classList.remove('hidden');
      resolve(proceed);
    };
    continueBtn.onclick = () => finish(true);
    cancelBtn.onclick   = () => finish(false);
    copyContinueBtn.onclick = async () => {
      try { await copyDecklist(); }
      catch (err) { console.warn('[EDHPORT] clipboard copy failed', err); }
      finish(true);
    };
  });
}

// Archidekt's card database doesn't mirror every Scryfall printing, so the
// exact printing Moxfield happens to store can point at a uid Archidekt
// doesn't have — which fails the whole sandbox load, not just that one
// card. Resolve each card by NAME first to get Scryfall's default printing;
// only fall back to Moxfield's own printing id if the name lookup misses
// (e.g. a custom/proxy card). Any match that looks risky gets swapped for
// that card's oldest printing — but only after the user confirms it.
//
// The name used for that lookup must be the true oracle name, not whatever
// Moxfield reports as `card.name` — reskinned cards carry their flavor name
// there, and Scryfall's exact-name search only matches oracle names, so
// looking that flavor name up would silently fail. Cards with a scryfallId
// get their oracle name confirmed via an id lookup first.
async function resolveArchidektIds(cards) {
  const withScryfallId = cards.filter(c => c.scryfallId);
  const oracleNameById = new Map();
  if (withScryfallId.length) {
    const idMatches = await fetchScryfallCollection(withScryfallId.map(c => ({ id: c.scryfallId })));
    for (const card of idMatches) oracleNameById.set(card.id, card.name);
  }
  const withOracleName = cards.map(c => ({
    ...c,
    lookupName: (c.scryfallId && oracleNameById.get(c.scryfallId)) || c.name
  }));

  const identifiers = [];
  for (const c of withOracleName) {
    if (c.lookupName)  identifiers.push({ name: c.lookupName });
    if (c.scryfallId)  identifiers.push({ id: c.scryfallId });
  }
  const nameMatches = await fetchScryfallCollection(identifiers);
  const byName = new Map();
  const byId   = new Set();
  for (const card of nameMatches) {
    byName.set(card.name, card);
    byId.add(card.id);
  }

  // A failed id lookup above (e.g. Moxfield caching a scryfall_id Scryfall
  // has since retired) is usually harmless on its own — the name lookup
  // right above it, from the SAME card, independently recovers it. This is
  // the check for whether a card is actually about to be dropped from the
  // export: no match by name AND no fallback via its own (still-valid) id.
  const unresolved = withOracleName.filter(c => !byName.get(c.lookupName) && !(c.scryfallId && byId.has(c.scryfallId)));
  if (unresolved.length) {
    console.warn('[EDHPORT] These cards could not be matched on Scryfall at all and will be DROPPED from the export:',
      unresolved.map(c => `${c.qty || 1}x "${c.lookupName}"${c.scryfallId ? ` (Moxfield scryfallId: ${c.scryfallId})` : ''}`));
  }

  const riskyCards = [...new Map(
    withOracleName
      .map(c => byName.get(c.lookupName))
      .filter(card => card && isRiskyPrinting(card))
      .map(card => [card.name, card])
  ).values()];

  const replacementByName = new Map(); // name -> replacement CARD OBJECT (not just its id)
  const changes = [];
  for (const original of riskyCards) {
    const replacement = await fetchBestScryfallPrinting(original.name);
    if (replacement && replacement.id !== original.id) {
      replacementByName.set(original.name, replacement);
      changes.push({
        name: original.name,
        from: printLabel(original) + (original.flavor_name ? ` — "${original.flavor_name}"` : ''),
        to: printLabel(replacement)
      });
    }
  }

  // Attach the actual resolved card (post-swap) to every entry BEFORE the
  // confirm screen renders, not after — this is what the "copy full
  // decklist" button reads to show each card's set/printing, so it has to
  // exist by the time that screen is built, not just by the time the URL
  // itself gets built afterward.
  const withResolvedCard = withOracleName.map(c => {
    const match = byName.get(c.lookupName);
    const resolvedCard = (match && replacementByName.get(match.name)) || match || null;
    return { ...c, resolvedCard };
  });

  if (changes.length) {
    const proceed = await confirmPrintingChanges(changes, withResolvedCard);
    if (!proceed) throw new Error('Export cancelled.');
  }

  return withResolvedCard.map(c => ({
    ...c,
    resolvedId: c.resolvedCard?.id || (c.scryfallId && byId.has(c.scryfallId) ? c.scryfallId : null)
  }));
}

// Archidekt's sandbox reads a `deck` query param: a JSON array of
// { c: 'c'|'m' (commander/mainboard), f: foil (0/1), q: qty, u: <scryfall id> }.
// Confirmed against Scryfall's API that Archidekt's card uid IS the Scryfall
// printing id. Cards without a resolvable id are dropped rather than
// producing a broken entry. Commanders and mainboard are resolved together
// so a card appearing risky in both only prompts the user once.
//
// A ~93-card deck produced a ~10,175-char URL, which a real browser (adding
// its own cookies/headers on top) turned into an HTTP 431 "Request Header
// Fields Too Large" from Archidekt's server. Tried shrinking the URL by
// omitting `f`/`q` when they're at their default (0/1) instead of always
// writing them — but that produced an EMPTY sandbox instead, meaning
// Archidekt's parser does NOT gracefully default a missing key; it more
// likely aborts parsing the whole array the moment one entry doesn't match
// its expected shape. Reverted to always sending all four keys — a working
// sandbox that might occasionally 431 beats a shorter URL that reliably
// opens empty.
async function buildArchidektSandboxUrl({ commanders, mainboard }) {
  const tagged = [
    ...commanders.map(c => ({ ...c, boardCat: 'c' })),
    ...mainboard.map(c => ({ ...c, boardCat: 'm' }))
  ];
  const resolved = await resolveArchidektIds(tagged);
  const entries = resolved
    .map(c => c.resolvedId ? { c: c.boardCat, f: 0, q: c.qty || 1, u: c.resolvedId } : null)
    .filter(Boolean);
  if (!entries.length) throw new Error("Couldn't match any cards to Archidekt's database.");
  return `https://archidekt.com/sandbox?deck=${encodeURIComponent(JSON.stringify(entries))}`;
}

// Moxfield DOES have a URL scheme for pre-loading a decklist after all —
// `moxfield.com/import?c=<list>`, confirmed against a real, working example
// URL — despite earlier assuming otherwise (which led to a clipboard-copy +
// "open the decks list and paste it in yourself" flow that actually landed
// on the user's existing-decks dashboard, not an import screen at all). No
// section headers here: the commander is just the first entry in one flat
// `qty name` list, same as everything else.
function buildMoxfieldImportUrl({ commanders, mainboard }) {
  const text = [...commanders, ...mainboard].map(c => `${c.qty} ${c.name}`).join('\n');
  return `https://moxfield.com/import?c=${encodeURIComponent(text)}`;
}

// Each destination knows how to turn fetched deck(s) into an action. Add new
// destinations here — the picker in action.html renders one button per key.
const DESTINATIONS = {
  edhpowerlevel: {
    async apply(decks) {
      for (const deck of decks) chrome.tabs.create({ url: buildEDHUrl(deck) });
      window.close();
    }
  },
  archidektSandbox: {
    async apply(decks) {
      for (const deck of decks) {
        const url = await buildArchidektSandboxUrl(deck);
        chrome.tabs.create({ url });
      }
      window.close();
    }
  },
  moxfieldImport: {
    async apply(decks) {
      chrome.tabs.create({ url: buildMoxfieldImportUrl(decks[0]) });
      window.close();
    }
  },
  commanderSpellbook: {
    async apply(decks) {
      for (const deck of decks) chrome.tabs.create({ url: buildCommanderSpellbookUrl(deck) });
      window.close();
    }
  }
};

// Each source site knows how to turn the current tab into deck(s). Archidekt
// and Moxfield are fetched from their APIs; EDH Power Level and Commander
// Spellbook are read back out of that site's own input box (URL or DOM).
const SOURCE_SITES = {
  archidekt: {
    destId: 'destArchidektSandbox',
    async getDecks(tab) {
      const refs = getDeckRefs(tab.url, 'archidekt');
      if (!refs.length) throw new Error('Navigate to a specific deck page to export.');
      return Promise.all(refs.map(fetchArchidektDeck));
    }
  },
  moxfield: {
    destId: 'destMoxfieldImport',
    async getDecks(tab) {
      const refs = getDeckRefs(tab.url, 'moxfield');
      if (!refs.length) throw new Error('Navigate to a specific deck page to export.');
      return Promise.all(refs.map(fetchMoxfieldDeck));
    }
  },
  edhpowerlevel: {
    destId: 'destEdhPowerLevel',
    async getDecks(tab) {
      const deck = parseEDHPowerLevelUrl(tab.url);
      if (!deck) throw new Error('Paste a decklist and click Analyze List on EDH Power Level first.');
      return [deck];
    }
  },
  commanderspellbook: {
    destId: 'destCommanderSpellbook',
    async getDecks(tab) {
      if (!/\/find-my-combos\/?/.test(tab.url)) {
        throw new Error('Go to the Find My Combos page on Commander Spellbook first.');
      }
      return [await getCommanderSpellbookDeck(tab.id)];
    }
  }
};

let cachedTab  = null;
let cachedSite = null;

async function detectCurrentTab() {
  if (!cachedTab) {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    cachedTab  = tab;
    cachedSite = detectSite(tab?.url || '');
  }
  return { tab: cachedTab, site: cachedSite };
}

async function exportTo(destKey) {
  const picker = document.getElementById('picker');
  const msg    = document.getElementById('msg');
  picker.classList.add('hidden');
  msg.classList.remove('hidden');
  msg.textContent = '⏳ Loading deck…';

  try {
    const { tab, site } = await detectCurrentTab();
    if (!site) {
      msg.textContent = 'Open a deck on Archidekt, Moxfield, EDH Power Level, or Commander Spellbook first.';
      return;
    }

    const decks = await SOURCE_SITES[site].getDecks(tab);
    await DESTINATIONS[destKey].apply(decks, msg);
  } catch (err) {
    console.error('[EDHPORT]', err);
    msg.textContent = '⚠ ' + err.message;
  }
}

document.getElementById('destEdhPowerLevel')
  .addEventListener('click', () => exportTo('edhpowerlevel'));
document.getElementById('destArchidektSandbox')
  .addEventListener('click', () => exportTo('archidektSandbox'));
document.getElementById('destMoxfieldImport')
  .addEventListener('click', () => exportTo('moxfieldImport'));
document.getElementById('destCommanderSpellbook')
  .addEventListener('click', () => exportTo('commanderSpellbook'));

// Hide the destination that matches the site you're already on — no point
// exporting a deck to the site it's already on.
(async () => {
  const { site } = await detectCurrentTab();
  const destId = site && SOURCE_SITES[site]?.destId;
  if (destId) document.getElementById(destId).classList.add('hidden');
})();
