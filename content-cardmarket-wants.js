// ─── Cardmarket want list → decklist button ────────────────────────────────
// Injects a "Copy as Decklist" button directly beside the want list's own
// "X Wants - Y Cards" heading (inside #WantsListTable), so the list on the
// page can be copied as a plain `qty name` decklist without leaving it.
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
  const DEFAULT_LABEL = 'Copy as Decklist';

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

  function flashLabel(btn, label) {
    btn.textContent = label;
    btn.disabled = true;
    setTimeout(() => {
      btn.textContent = DEFAULT_LABEL;
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

  function buildButton() {
    const btn = document.createElement('button');
    btn.id = BTN_ID;
    btn.type = 'button';
    // Cardmarket's own Bootstrap button classes, so this picks up the
    // site's real button look instead of needing custom styling.
    btn.className = 'btn btn-sm btn-outline-primary ms-2';
    btn.textContent = DEFAULT_LABEL;
    btn.addEventListener('click', handleClick);
    return btn;
  }

  // Wraps the heading in a flex row rather than changing the heading's own
  // `display` (it carries Bootstrap's `h3` class, which may have margin/
  // line-height rules elsewhere that assume block layout) so the button
  // sits beside it without disturbing the heading's own styling.
  function inject() {
    if (document.getElementById(BTN_ID)) return;
    const heading = document.querySelector('#WantsListTable > h2.h3, #WantsListTable h2.h3');
    if (!heading) return;

    const row = document.createElement('div');
    row.style.cssText = 'display:flex; align-items:center; flex-wrap:wrap;';
    heading.replaceWith(row);
    row.appendChild(heading);
    row.appendChild(buildButton());
  }

  inject();

  // The want list table updates in place without a full page reload on
  // delete (its `tbody` has `aria-live="polite"`, confirming Cardmarket
  // patches it via AJAX) — watch for the heading/button being replaced by
  // one of those updates and re-inject if so. `inject` is idempotent (a
  // no-op once the button already exists), so this is cheap.
  new MutationObserver(inject).observe(document.documentElement, { subtree: true, childList: true });
})();
