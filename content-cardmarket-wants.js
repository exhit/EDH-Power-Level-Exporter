// ─── Cardmarket want list → decklist buttons ───────────────────────────────
// Injects buttons directly beside the want list's own "X Wants - Y Cards"
// heading (inside #WantsListTable):
//   • Copy as Decklist — copies the list as a plain `qty name` decklist
//   • Add to Deck      — adds the list to a saved Archidekt/Moxfield deck
//   • ⚙ Deck link      — sets/changes which deck "Add to Deck" targets
//
// Cardmarket's want list table stays in the DOM at every viewport width —
// there's a separate mobile accordion list further down the page covering
// the same wants, but the desktop table itself is only CSS-hidden (`d-none`)
// below the `lg` breakpoint, not removed — so reading it directly, scoped to
// this section, avoids double-counting from that accordion markup.
(function () {
  const HOST = location.hostname.replace(/^www\./, '');
  if (HOST !== 'cardmarket.com') return;

  const BTN_ID = 'edh-exporter-cardmarket-btn';
  const ADD_BTN_ID = 'edh-exporter-cardmarket-add-btn';
  const SET_BTN_ID = 'edh-exporter-cardmarket-set-btn';
  const DEFAULT_LABEL = 'Copy as Decklist';
  const ADD_LABEL = 'Add to Deck';
  const SET_LABEL = '⚙ Deck link';
  const DECK_KEY = 'wantsTargetDeckUrl';

  // Only plain /decks/<id> links — the target has to be a deck the user
  // owns and can edit, not a snapshot, playtester or sandbox view.
  function parseDeckUrl(raw) {
    let url;
    try { url = new URL((raw || '').trim()); } catch (_) { return null; }
    const host = url.hostname.replace(/^www\./, '');
    if (host === 'archidekt.com') {
      const m = url.pathname.match(/^\/decks\/(\d+)/);
      return m ? { site: 'archidekt', id: m[1], url: `https://archidekt.com/decks/${m[1]}` } : null;
    }
    if (host === 'moxfield.com') {
      const m = url.pathname.match(/^\/decks\/([A-Za-z0-9_-]+)/);
      return m ? { site: 'moxfield', id: m[1], url: `https://moxfield.com/decks/${m[1]}` } : null;
    }
    return null;
  }

  async function getSavedDeck() {
    const { [DECK_KEY]: saved } = await chrome.storage.local.get(DECK_KEY);
    return parseDeckUrl(saved);
  }

  async function promptForDeck() {
    const current = await getSavedDeck();
    const input = prompt(
      'Paste the Archidekt or Moxfield link of the deck to add want list cards to\n' +
      '(it must be a deck you own and can edit):',
      current?.url || ''
    );
    if (input === null) return current; // cancelled — keep whatever was saved
    const deck = parseDeckUrl(input);
    if (!deck) {
      alert('That doesn\'t look like an Archidekt (archidekt.com/decks/<id>) or Moxfield (moxfield.com/decks/<id>) deck link.');
      return current;
    }
    await chrome.storage.local.set({ [DECK_KEY]: deck.url });
    updateDeckTooltip(deck);
    return deck;
  }

  function updateDeckTooltip(deck) {
    const btn = document.getElementById(ADD_BTN_ID);
    if (btn) btn.title = deck ? `Adds this list to ${deck.url}` : 'No deck link saved yet — you\'ll be asked for one';
  }

  function extractWantlist() {
    const scope = document.getElementById('WantsListTable') || document;
    const rows = scope.querySelectorAll('tr[role="row"]');
    const lines = [];
    rows.forEach(row => {
      const nameLink = row.querySelector('td.name a');
      if (!nameLink) return; // skips the header row, which has no td.name
      const name = nameLink.textContent.trim();
      if (!name) return;
      const amountCell = row.querySelector('td.amount, td[data-amount]');
      const qty = parseInt(amountCell?.dataset.amount ?? amountCell?.textContent ?? '1', 10) || 1;
      lines.push(`${qty} ${name}`);
    });
    return lines;
  }

  function flashLabel(btn, label, restore = DEFAULT_LABEL) {
    btn.textContent = label;
    btn.disabled = true;
    setTimeout(() => {
      btn.textContent = restore;
      btn.disabled = false;
    }, 1800);
  }

  async function handleClick(e) {
    const btn = e.currentTarget;
    const lines = extractWantlist();
    if (!lines.length) { flashLabel(btn, '⚠ No cards found'); return; }
    try {
      await navigator.clipboard.writeText(lines.join('\n'));
      flashLabel(btn, `✓ Copied ${lines.length} card${lines.length === 1 ? '' : 's'}!`);
    } catch (err) {
      console.warn('[EDHPORT] clipboard copy failed', err);
      flashLabel(btn, '⚠ Copy failed');
    }
  }

  // Hands the list to background.js, which stashes it and opens the deck in
  // a new tab, where content-deck-add.js picks it up and pastes it in via the
  // site's own editor. Also copied to the clipboard first (while this click
  // still counts as a user gesture) so a manual paste is always possible if
  // the deck site's UI has changed and the automation can't finish the job.
  async function handleAddClick(e) {
    const btn = e.currentTarget;
    const lines = extractWantlist();
    if (!lines.length) { flashLabel(btn, '⚠ No cards found', ADD_LABEL); return; }
    const text = lines.join('\n');
    try { await navigator.clipboard.writeText(text); } catch (_) { /* fallback only */ }
    const deck = (await getSavedDeck()) || (await promptForDeck());
    if (!deck) return;
    try {
      const resp = await chrome.runtime.sendMessage({ type: 'wantsAddToDeck', deck, text });
      if (!resp?.success) throw new Error(resp?.error || 'no response');
      flashLabel(btn, `✓ Opening deck (${lines.length} cards)…`, ADD_LABEL);
    } catch (err) {
      console.warn('[EDHPORT] add-to-deck hand-off failed', err);
      flashLabel(btn, '⚠ Failed — list copied', ADD_LABEL);
    }
  }

  function buildButton(id, label, onClick) {
    const btn = document.createElement('button');
    btn.id = id;
    btn.type = 'button';
    // Cardmarket's own Bootstrap button classes, so this picks up the
    // site's real button look instead of needing custom styling.
    btn.className = 'btn btn-sm btn-outline-primary ms-2';
    btn.textContent = label;
    btn.addEventListener('click', onClick);
    return btn;
  }

  // Wraps the heading in a flex row rather than changing the heading's own
  // `display` (it carries Bootstrap's `h3` class, which may have margin/
  // line-height rules elsewhere that assume block layout) so the buttons
  // sit beside it without disturbing the heading's own styling.
  function inject() {
    if (document.getElementById(BTN_ID)) return;
    const heading = document.querySelector('#WantsListTable > h2.h3, #WantsListTable h2.h3');
    if (!heading) return;

    const row = document.createElement('div');
    row.style.cssText = 'display:flex; align-items:center; flex-wrap:wrap; gap:4px 0;';
    heading.replaceWith(row);
    row.appendChild(heading);
    row.appendChild(buildButton(BTN_ID, DEFAULT_LABEL, handleClick));
    row.appendChild(buildButton(ADD_BTN_ID, ADD_LABEL, handleAddClick));
    row.appendChild(buildButton(SET_BTN_ID, SET_LABEL, () => { promptForDeck(); }));
    getSavedDeck().then(updateDeckTooltip);
  }

  inject();

  // The want list table updates in place without a full page reload on
  // delete (its `tbody` has `aria-live="polite"`, confirming Cardmarket
  // patches it via AJAX) — watch for the heading/buttons being replaced by
  // one of those updates and re-inject if so. `inject` is idempotent (a
  // no-op once the button already exists), so this is cheap.
  new MutationObserver(inject).observe(document.documentElement, { subtree: true, childList: true });
})();
