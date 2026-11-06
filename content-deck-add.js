// ─── Add a Cardmarket want list to an Archidekt/Moxfield deck ─────────────
// Second half of content-cardmarket-wants.js's "Add to Deck" button: that
// button stores the list as `pendingDeckAdd` and background.js opens the
// saved deck in a new tab. This script runs on that tab, picks the list up
// (once — it's cleared immediately so a reload doesn't add it twice), and
// pastes it in through the deck site's OWN editor, so the change is saved
// under the user's own logged-in session exactly as if done by hand:
//   • Moxfield:  Bulk Edit → append to the textarea → Save
//   • Archidekt: Import    → paste into the textarea → Import
//
// Neither site has a public write API, so this drives their UI by visible
// button text. If a step can't be found (not logged in, not the deck's
// owner, or the site's UI changed), it stops and shows a banner with a
// "Copy list" button instead of guessing — the list was also already
// copied to the clipboard on the Cardmarket page.
(function () {
  const HOST = location.hostname.replace(/^www\./, '');
  const SITE = HOST === 'archidekt.com' ? 'archidekt' : HOST === 'moxfield.com' ? 'moxfield' : null;
  if (!SITE) return;

  const PENDING_KEY = 'pendingDeckAdd';
  const MAX_AGE_MS = 10 * 60 * 1000;
  const STEPS = {
    moxfield: {
      open:    [/^bulk edit$/i],
      confirm: [/^save$/i, /^save changes$/i]
    },
    archidekt: {
      open:    [/^import$/i, /^import cards$/i],
      confirm: [/^import$/i, /^import cards$/i, /^add cards$/i, /^save$/i]
    }
  };

  function currentDeckId() {
    const m = location.pathname.match(SITE === 'archidekt' ? /^\/decks\/(\d+)/ : /^\/decks\/([A-Za-z0-9_-]+)/);
    return m ? m[1] : null;
  }

  // ── Banner ──
  let banner;
  function showBanner(msg, { text, error } = {}) {
    if (!banner) {
      banner = document.createElement('div');
      banner.style.cssText = 'position:fixed;top:16px;right:16px;z-index:2147483647;max-width:360px;' +
        'padding:12px 14px;border-radius:8px;font:13px/1.45 -apple-system,system-ui,sans-serif;' +
        'color:#e8e4d8;background:#1c1c28;border:1px solid #2a2a3a;box-shadow:0 6px 24px rgba(0,0,0,.4);';
      document.body.appendChild(banner);
    }
    banner.style.borderColor = error ? '#c0392b' : '#8b2be2';
    banner.textContent = '';
    const p = document.createElement('div');
    p.textContent = `EDHPORT — ${msg}`;
    banner.appendChild(p);
    const actions = document.createElement('div');
    actions.style.cssText = 'display:flex;gap:8px;margin-top:8px;justify-content:flex-end;';
    if (text) {
      const copy = document.createElement('button');
      copy.textContent = 'Copy list';
      copy.style.cssText = btnCss();
      copy.onclick = async () => {
        try { await navigator.clipboard.writeText(text); copy.textContent = '✓ Copied'; }
        catch (_) { copy.textContent = '⚠ Copy failed'; }
      };
      actions.appendChild(copy);
    }
    const close = document.createElement('button');
    close.textContent = 'Close';
    close.style.cssText = btnCss();
    close.onclick = () => { banner.remove(); banner = null; };
    actions.appendChild(close);
    banner.appendChild(actions);
  }
  const btnCss = () => 'padding:4px 10px;border-radius:6px;border:1px solid #2a2a3a;background:#0d0d12;color:#e8e4d8;cursor:pointer;font:inherit;';

  // ── DOM helpers ──
  const isVisible = (el) => !!el && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
  const labelOf = (el) => (el.innerText || el.textContent || el.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim();

  function findClickable(patterns, root = document, exclude = null) {
    const els = root.querySelectorAll('button, a, [role="button"], [role="menuitem"], input[type="submit"]');
    for (const re of patterns) {
      for (const el of els) {
        if (el === exclude || banner?.contains(el) || !isVisible(el) || el.disabled) continue;
        if (re.test(labelOf(el) || el.value || '')) return el;
      }
    }
    return null;
  }

  function waitFor(fn, timeoutMs) {
    return new Promise((resolve) => {
      const start = Date.now();
      const tick = () => {
        const found = fn();
        if (found) return resolve(found);
        if (Date.now() - start > timeoutMs) return resolve(null);
        setTimeout(tick, 250);
      };
      tick();
    });
  }

  const visibleTextarea = () => [...document.querySelectorAll('textarea')].find(isVisible) || null;

  // Both sites are React apps, which track input values internally — setting
  // `.value` directly is ignored on the next render unless it goes through
  // the native setter and fires an `input` event React listens for.
  function setTextareaValue(el, value) {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
    setter.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  // The confirm button belongs to whatever dialog/form holds the textarea —
  // searched there first so e.g. Archidekt's page-level "Import" trigger
  // isn't mistaken for the modal's own "Import" submit button.
  function confirmScope(textarea) {
    return textarea.closest('[role="dialog"], .modal, form, [class*="modal" i], [class*="Modal"]') || document;
  }

  async function run(pending) {
    const { text } = pending;
    const steps = STEPS[SITE];
    const count = text.split('\n').filter(Boolean).length;
    showBanner(`Adding ${count} cards to this deck…`);

    const opener = await waitFor(() => findClickable(steps.open), 20000);
    if (!opener) {
      showBanner(`Couldn't find the "${SITE === 'moxfield' ? 'Bulk Edit' : 'Import'}" button. Make sure you're logged in as this deck's owner. The list is on your clipboard — paste it in manually.`, { text, error: true });
      return;
    }
    opener.click();

    const textarea = await waitFor(visibleTextarea, 10000);
    if (!textarea) {
      showBanner('Opened the editor but couldn\'t find its text box. The list is on your clipboard — paste it in manually.', { text, error: true });
      return;
    }
    // Bulk Edit shows the deck's full current list (append to it); Import
    // starts empty and adds whatever is pasted (just set it).
    const existing = textarea.value.replace(/\s+$/, '');
    setTextareaValue(textarea, existing ? `${existing}\n${text}` : text);

    await new Promise(r => setTimeout(r, 300));
    const scope = confirmScope(textarea);
    const confirm = findClickable(steps.confirm, scope, opener) || findClickable(steps.confirm, document, opener);
    if (!confirm) {
      showBanner('Pasted the list into the editor, but couldn\'t find its Save/Import button — please review and confirm it yourself.', { text, error: true });
      return;
    }
    confirm.click();
    showBanner(`✓ Added ${count} cards. Give the deck a second to refresh, then double-check it.`);
  }

  (async () => {
    const { [PENDING_KEY]: pending } = await chrome.storage.local.get(PENDING_KEY);
    if (!pending || pending.site !== SITE || pending.id !== currentDeckId()) return;
    await chrome.storage.local.remove(PENDING_KEY);
    if (Date.now() - (pending.ts || 0) > MAX_AGE_MS) return;
    try {
      await run(pending);
    } catch (err) {
      console.warn('[EDHPORT] add-to-deck failed', err);
      showBanner('Something went wrong adding the cards. The list is on your clipboard — paste it in manually.', { text: pending.text, error: true });
    }
  })();
})();
