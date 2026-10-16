// ─── On-page export buttons ────────────────────────────────────────────────
// Injects destination-logo export buttons directly onto Archidekt and
// Moxfield deck pages, so exporting doesn't require opening the toolbar
// popup first. Deck fetching and Archidekt printing resolution are done by
// background.js (see the "Messages from the on-page export buttons" section
// there) rather than here — a content script's own fetch() runs under the
// PAGE's origin, not the extension's, so it doesn't get the CORS bypass
// host_permissions gives extension pages, and neither archidekt.com's nor
// moxfield.com's API sends an Access-Control-Allow-Origin covering the
// other site's own origin.
//
// Both sites get their buttons injected into their own deck-header area
// instead of a generic floating box:
// - Moxfield: into its existing Playtest/Buy Deck/Download/More toolbar,
//   found via the "More" item's stable id (`#subheader-more`) rather than
//   either site's hashed CSS-module class names, which get regenerated on
//   every deploy. If Moxfield's toolbar can't be found, there is NO
//   floating-panel fallback there (see syncPanel below) — only the
//   extension's own toolbar popup still works in that case.
// - Archidekt: as a new row inserted directly above its main deck-content
//   area (`decks_center`), matched via a CSS-module class-PREFIX match
//   rather than the full hashed class name; falls back to a small floating
//   panel if that anchor can't be found.
// Both are client-rendered (confirmed via raw fetches returning an
// empty/absent element for each), so finding either anchor is retried on
// every DOM mutation until it succeeds — see the MutationObserver below.
(function () {
  const HOST = location.hostname.replace(/^www\./, '');
  const SITE = HOST === 'archidekt.com' ? 'archidekt' : HOST === 'moxfield.com' ? 'moxfield' : null;
  if (!SITE) return;

  // Each destination's real brand logo. Backgrounds are picked per-logo
  // (not just inherited from the panel) because they're not colored for
  // interchangeable use: Moxfield's is white-on-transparent (needs a dark
  // chip) while the other three are dark-on-transparent (need a light one).
  const DESTINATIONS = {
    edhpowerlevel:      { label: 'EDH Power Level',    logo: 'https://edhpowerlevel.com/images/logo.svg',                  chip: '#f4f2ea' },
    archidektSandbox:   { label: 'Archidekt Sandbox',  logo: 'https://archidekt.com/images/logo.svg',                      chip: '#f4f2ea' },
    moxfieldImport:     { label: 'Moxfield Import',    logo: 'https://cloudflare.edhrec.com/_next/static/media/moxfield.d8e986ee.svg', chip: '#1a0a2e' },
    commanderSpellbook: { label: 'Commander Spellbook', logo: 'https://commanderspellbook.com/images/logo.svg',            chip: '#f4f2ea' }
  };

  // Never offer exporting to the site you're already on.
  const DESTS_BY_SITE = {
    archidekt: ['edhpowerlevel', 'moxfieldImport', 'commanderSpellbook'],
    moxfield:  ['edhpowerlevel', 'archidektSandbox', 'commanderSpellbook']
  };

  // ── Deck ref detection (mirrors action.js's getDeckRefs, trimmed to one site) ──
  function parseArchidektRef(param) {
    const m = (param || '').match(/^([ds])_(\d+)$/);
    if (!m) return null;
    return m[1] === 's' ? `snapshots/${m[2]}` : m[2];
  }

  function getDeckRefs() {
    const url = location.href;
    if (SITE === 'archidekt') {
      const params = new URLSearchParams(url.split('?')[1] || '');
      const one = parseArchidektRef(params.get('one'));
      const two = parseArchidektRef(params.get('two'));
      if (one && two) return [one, two];
      if (one) return [one];
      const snapshotM = url.match(/\/snapshots\/(\d+)/);
      if (snapshotM) return [`snapshots/${snapshotM[1]}`];
      const playtesterM = url.match(/\/playtester[^/]*\/(\d+)/);
      if (playtesterM) return [playtesterM[1]];
      const m = url.match(/\/decks\/(\d+)/);
      return m ? [m[1]] : [];
    }
    const m = url.match(/\/decks\/([A-Za-z0-9_-]+)/);
    return m ? [m[1]] : [];
  }

  // ── Messaging helpers ───────────────────────────────────────────────────
  function sendMessage(msg) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(msg, (resp) => {
        if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
        resolve(resp);
      });
    });
  }

  async function fetchDeck(deckId) {
    const resp = await sendMessage({ type: 'exportFetchDeck', site: SITE, deckId });
    if (!resp?.success) throw new Error(resp?.error || 'Failed to fetch deck');
    return resp.data;
  }

  async function resolveArchidekt(commanders, mainboard) {
    const resp = await sendMessage({ type: 'exportResolveArchidekt', commanders, mainboard });
    if (!resp?.success) throw new Error(resp?.error || 'Failed to resolve Archidekt printings');
    return resp;
  }

  // ── Pure URL/text builders (same shapes as action.js) ───────────────────
  function buildEDHUrl({ commanders, mainboard }) {
    const enc = s => encodeURIComponent(s).replace(/%20/g, '+');
    const cmdList = (commanders?.length)
      ? commanders.map(c => `${c.qty}+${enc(c.name)}`).join('~')
      : `1+${enc('Unknown Commander')}`;
    const commanderPart = `Commander~${cmdList}`;
    const mainPart = 'Mainboard~' + mainboard.map(c => `${c.qty}+${enc(c.name)}`).join('~');
    return `https://edhpowerlevel.com/?d=${commanderPart}~~${mainPart}~~Z~`;
  }

  function buildCommanderSpellbookUrl({ commanders, mainboard }) {
    const toLines = arr => arr.map(c => `${c.qty} ${c.name}`).join('\n');
    const params = new URLSearchParams();
    if (commanders.length) params.set('commanders', toLines(commanders));
    params.set('decklist', toLines(mainboard));
    return `https://commanderspellbook.com/find-my-combos/?${params.toString()}`;
  }

  // Moxfield DOES have a URL scheme for pre-loading a decklist after all —
  // `moxfield.com/import?c=<list>`, confirmed against a real, working
  // example URL — despite earlier assuming otherwise (which led to a
  // clipboard-copy + "open the decks list and paste it in yourself" flow
  // that actually landed on the user's existing-decks dashboard, not an
  // import screen at all). No section headers here: the commander is just
  // the first entry in one flat `qty name` list, same as everything else.
  function buildMoxfieldImportUrl({ commanders, mainboard }) {
    const text = [...commanders, ...mainboard].map(c => `${c.qty} ${c.name}`).join('\n');
    return `https://moxfield.com/import?c=${encodeURIComponent(text)}`;
  }

  // ── Overlay: status toast + Archidekt printing-confirm modal ───────────
  // Lives in a Shadow DOM (so the host page's CSS can't bleed in or out) and
  // is used regardless of whether buttons ended up inline or floating.
  let shadow = null;
  let els = null;
  let usingFloatingPanel = false; // true once syncPanel decides the floating panel (not Moxfield's inline row) owns the buttons

  function ensureOverlay() {
    if (shadow) return;
    const host = document.createElement('div');
    host.id = 'edh-exporter-overlay-host';
    host.style.all = 'initial';
    document.documentElement.appendChild(host);
    shadow = host.attachShadow({ mode: 'open' });

    shadow.innerHTML = `
      <style>
        :host { all: initial; }
        * { box-sizing: border-box; font-family: -apple-system, system-ui, sans-serif; }
        .panel {
          position: fixed; bottom: 20px; right: 20px; z-index: 2147483647;
          background: #16161f; border: 1px solid #2a2a3a; border-radius: 12px;
          padding: 10px; box-shadow: 0 6px 24px rgba(0,0,0,0.4);
          display: flex; flex-direction: column; gap: 8px; align-items: stretch;
        }
        .panel-title {
          font-size: 10px; letter-spacing: 0.06em; color: #6b6880;
          text-transform: uppercase; padding: 4px 2px;
          cursor: move; touch-action: none; user-select: none;
        }
        .row { display: flex; gap: 8px; }
        .dbtn {
          border: none; border-radius: 8px; padding: 7px 10px; cursor: pointer;
          display: flex; align-items: center; justify-content: center;
          min-width: 44px; height: 32px; transition: transform 0.1s, opacity 0.15s;
        }
        .dbtn:hover:not(:disabled) { transform: translateY(-1px); }
        .dbtn:disabled { opacity: 0.5; cursor: not-allowed; }
        .dbtn img { height: 16px; max-width: 72px; object-fit: contain; display: block; }
        .status {
          position: fixed; right: 20px; bottom: 20px; z-index: 2147483647;
          font-size: 11px; color: #e8e4d8; background: #1c1c28; border: 1px solid #2a2a3a;
          border-radius: 6px; padding: 6px 8px; max-width: 260px; line-height: 1.4;
        }
        .status.above-panel { bottom: 80px; }
        .status.error { color: #f08080; border-color: #5c1d1d; background: #2a0d0d; }
        .status.success { color: #3ecf7e; border-color: #1d5c38; background: #0d2a1a; }
        .hidden { display: none !important; }

        .modal-backdrop {
          position: fixed; inset: 0; z-index: 2147483647;
          background: rgba(0,0,0,0.6); display: flex; align-items: center; justify-content: center;
        }
        .modal {
          background: #16161f; border: 1px solid #2a2a3a; border-radius: 12px;
          padding: 18px; width: 360px; max-width: 90vw; display: flex; flex-direction: column; gap: 10px;
          color: #e8e4d8; font-size: 13px;
        }
        .modal-title { font-size: 12px; color: #6b6880; margin: 0; }
        .modal-text {
          white-space: pre-line; font-size: 12px; line-height: 1.5;
          background: #1c1c28; border: 1px solid #2a2a3a; border-radius: 8px;
          padding: 10px 12px; max-height: 220px; overflow-y: auto; margin: 0;
        }
        .modal button {
          width: 100%; padding: 10px; border: none; border-radius: 8px;
          font-size: 13px; font-weight: 600; cursor: pointer; color: #fff;
          background: linear-gradient(135deg, #8b2be2 0%, #5a1fa0 100%);
        }
        .modal button.secondary {
          background: none; border: 1px dashed #2a2a3a; color: #6b6880; font-weight: 500;
        }
        .modal-actions { display: flex; gap: 8px; }
        .modal-actions button { flex: 1; }
        .modal-actions button.cancel { background: #1c1c28; border: 1px solid #2a2a3a; }
      </style>
      <div class="panel hidden" id="edh-exporter-panel">
        <div class="panel-title" id="edh-exporter-panel-title" title="Drag to move">Export deck</div>
        <div class="row" id="btnRow"></div>
      </div>
      <div class="status hidden" id="status"></div>
      <div class="modal-backdrop hidden" id="modalBackdrop">
        <div class="modal">
          <p class="modal-title">Printing changes needed for Archidekt</p>
          <p class="modal-text" id="modalText"></p>
          <button class="secondary hidden" id="modalDebug" type="button">🐛 Debug: open + copy each card separately</button>
          <div class="modal-actions">
            <button class="cancel" id="modalCancel" type="button">Cancel</button>
            <button class="cancel" id="modalCopy" type="button">Copy Decklist</button>
          </div>
          <div class="modal-actions">
            <button id="modalContinue" type="button">Open In Sandbox</button>
            <button id="modalCopyContinue" type="button">Copy + Sandbox</button>
          </div>
        </div>
      </div>
    `;

    els = {
      panel: shadow.getElementById('edh-exporter-panel'),
      panelTitle: shadow.getElementById('edh-exporter-panel-title'),
      btnRow: shadow.getElementById('btnRow'),
      status: shadow.getElementById('status'),
      modalBackdrop: shadow.getElementById('modalBackdrop'),
      modalText: shadow.getElementById('modalText'),
      modalCopy: shadow.getElementById('modalCopy'),
      modalCopyContinue: shadow.getElementById('modalCopyContinue'),
      modalDebug: shadow.getElementById('modalDebug'),
      modalCancel: shadow.getElementById('modalCancel'),
      modalContinue: shadow.getElementById('modalContinue')
    };

    const savedPos = loadPanelPosition();
    if (savedPos) applyPanelPosition(els.panel, savedPos);
    makePanelDraggable(els.panel, els.panelTitle);
  }

  // ── Floating-panel position persistence ─────────────────────────────────
  // Positions are stored as a percentage offset from whichever edges the
  // panel was nearest to when last moved (not always bottom-right), so a
  // panel dragged to e.g. the top-left keeps behaving relative to the
  // top-left on reload/resize instead of drifting based on offsets measured
  // from the opposite side. Kept in the page's own localStorage rather than
  // chrome.storage specifically so it's scoped per domain automatically —
  // Archidekt and Moxfield each remember their own panel position.
  const PANEL_POSITION_KEY = 'edhExporterPanelPosition';

  function loadPanelPosition() {
    try {
      const pos = JSON.parse(localStorage.getItem(PANEL_POSITION_KEY));
      return pos && ('edgeX' in pos) && ('edgeY' in pos) ? pos : null;
    } catch { return null; }
  }

  function savePanelPosition(pos) {
    try { localStorage.setItem(PANEL_POSITION_KEY, JSON.stringify(pos)); } catch {}
  }

  // Recomputes which edges (left/right, top/bottom) the panel is CURRENTLY
  // closest to and expresses its offset as a percentage of the viewport
  // from those edges. Run fresh after every drag so a panel moved from one
  // side of the screen to the other is measured from its new nearest edges
  // instead of the ones it started from.
  function computePanelPosition(panel) {
    const rect = panel.getBoundingClientRect();
    const vw = window.innerWidth, vh = window.innerHeight;
    const distLeft = rect.left, distRight = vw - rect.right;
    const distTop = rect.top, distBottom = vh - rect.bottom;
    const edgeX = distLeft <= distRight ? 'left' : 'right';
    const edgeY = distTop <= distBottom ? 'top' : 'bottom';
    return {
      edgeX, edgeY,
      xPct: (edgeX === 'left' ? distLeft : distRight) / vw * 100,
      yPct: (edgeY === 'top' ? distTop : distBottom) / vh * 100
    };
  }

  function applyPanelPosition(panel, pos) {
    const vw = window.innerWidth, vh = window.innerHeight;
    panel.style.left = panel.style.right = panel.style.top = panel.style.bottom = 'auto';
    panel.style[pos.edgeX] = `${(pos.xPct / 100) * vw}px`;
    panel.style[pos.edgeY] = `${(pos.yPct / 100) * vh}px`;
  }

  // Drag is initiated from the title bar only (`.panel-title`, cursor: move)
  // rather than the whole panel, so the export buttons underneath stay
  // clickable. Pointer Events (rather than separate mouse/touch listeners)
  // cover mouse and touch drags with one code path, and setPointerCapture
  // keeps delivering move/up events to the handle even once the pointer
  // strays outside its bounds mid-drag.
  function makePanelDraggable(panel, handle) {
    let dragging = false;
    let startX = 0, startY = 0, startLeft = 0, startTop = 0;

    handle.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      dragging = true;
      handle.setPointerCapture(e.pointerId);
      const rect = panel.getBoundingClientRect();
      startX = e.clientX; startY = e.clientY;
      startLeft = rect.left; startTop = rect.top;
      panel.style.right = panel.style.bottom = 'auto';
      panel.style.left = `${startLeft}px`;
      panel.style.top = `${startTop}px`;
      e.preventDefault();
    });

    handle.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const rect = panel.getBoundingClientRect();
      const maxLeft = Math.max(0, window.innerWidth - rect.width);
      const maxTop = Math.max(0, window.innerHeight - rect.height);
      panel.style.left = `${Math.min(Math.max(0, startLeft + (e.clientX - startX)), maxLeft)}px`;
      panel.style.top = `${Math.min(Math.max(0, startTop + (e.clientY - startY)), maxTop)}px`;
    });

    const endDrag = (e) => {
      if (!dragging) return;
      dragging = false;
      handle.releasePointerCapture(e.pointerId);
      const pos = computePanelPosition(panel);
      applyPanelPosition(panel, pos);
      savePanelPosition(pos);
    };
    handle.addEventListener('pointerup', endDrag);
    handle.addEventListener('pointercancel', endDrag);

    // A resize can't change which edges the panel is anchored to (that's
    // decided at drag time), but it changes what those edges' saved
    // percentages resolve to in pixels — re-apply on resize so the panel
    // keeps its relative position instead of drifting toward one side.
    window.addEventListener('resize', () => {
      if (dragging) return;
      const saved = loadPanelPosition();
      if (saved) applyPanelPosition(panel, saved);
    });
  }

  function setStatus(msg, type) {
    const aboveClass = usingFloatingPanel ? ' above-panel' : '';
    els.status.className = msg ? `status${aboveClass} ${type || ''}` : `status${aboveClass} hidden`;
    els.status.textContent = msg || '';
  }

  function setButtonsDisabled(disabled) {
    document.querySelectorAll(`${INLINE_MARK} button`).forEach(b => { b.disabled = disabled; });
    if (els?.btnRow) els.btnRow.querySelectorAll('button').forEach(b => { b.disabled = disabled; });
  }

  // Shows the printing-swap confirmation, with the same Copy/Debug options
  // as the popup's version. Resolves true (continue) or false (cancelled).
  function confirmPrintingChanges(changes, decklistText, debugCards) {
    const lines = changes.map(c => `${c.name}\n  ${c.from} → ${c.to}`);
    els.modalText.textContent = `Some card printings will be changed for Archidekt compatibility:\n\n${lines.join('\n\n')}`;
    els.modalBackdrop.classList.remove('hidden');

    const copyDecklist = () => navigator.clipboard.writeText(decklistText);

    const copyLabel = els.modalCopy.textContent;
    els.modalCopy.onclick = async () => {
      try {
        await copyDecklist();
        els.modalCopy.textContent = 'Copied!';
      } catch (err) {
        console.warn('[EDHPORT] clipboard copy failed', err);
        els.modalCopy.textContent = "Couldn't copy";
      }
      setTimeout(() => { els.modalCopy.textContent = copyLabel; }, 1500);
    };

    // Hidden; kept wired in case it's re-enabled — see modalDebug in the template above.
    const debugLabel = els.modalDebug.textContent;
    els.modalDebug.onclick = async () => {
      try { await copyDecklist(); }
      catch (err) { console.warn('[EDHPORT] clipboard copy failed', err); }
      chrome.runtime.sendMessage({ type: 'openDebugSandboxTabs', cards: debugCards });
      els.modalDebug.textContent = 'Opened in a new window →';
      setTimeout(() => { els.modalDebug.textContent = debugLabel; }, 3000);
    };

    return new Promise((resolve) => {
      const finish = (proceed) => { els.modalBackdrop.classList.add('hidden'); resolve(proceed); };
      els.modalContinue.onclick = () => finish(true);
      els.modalCancel.onclick   = () => finish(false);
      els.modalCopyContinue.onclick = async () => {
        try { await copyDecklist(); }
        catch (err) { console.warn('[EDHPORT] clipboard copy failed', err); }
        finish(true);
      };
    });
  }

  // ── Per-destination export ──────────────────────────────────────────────
  async function exportEdhPowerLevel(deckRefs) {
    for (const ref of deckRefs) {
      const deck = await fetchDeck(ref);
      window.open(buildEDHUrl(deck), '_blank');
    }
    return `✓ Opened EDH Power Level${deckRefs.length > 1 ? ' (both decks)' : ''}!`;
  }

  async function exportCommanderSpellbook(deckRefs) {
    for (const ref of deckRefs) {
      const deck = await fetchDeck(ref);
      window.open(buildCommanderSpellbookUrl(deck), '_blank');
    }
    return `✓ Opened Commander Spellbook${deckRefs.length > 1 ? ' (both decks)' : ''}!`;
  }

  async function exportMoxfieldImport(deckRefs) {
    const deck = await fetchDeck(deckRefs[0]);
    window.open(buildMoxfieldImportUrl(deck), '_blank');
    return '✓ Opened Moxfield import — review and save the deck there.';
  }

  async function exportArchidektSandbox(deckRefs) {
    const deck = await fetchDeck(deckRefs[0]);
    const { entries, changes, decklistText } = await resolveArchidekt(deck.commanders, deck.mainboard);
    if (!entries.length) throw new Error("Couldn't match any cards to Archidekt's database.");

    if (changes.length) {
      const debugCards = entries.map(e => ({ boardCat: e.c, qty: e.q, uid: e.u }));
      const proceed = await confirmPrintingChanges(changes, decklistText, debugCards);
      if (!proceed) throw new Error('Export cancelled.');
    }

    window.open(`https://archidekt.com/sandbox?deck=${encodeURIComponent(JSON.stringify(entries))}`, '_blank');
    return '✓ Opened Archidekt Sandbox!';
  }

  const EXPORTERS = {
    edhpowerlevel: exportEdhPowerLevel,
    commanderSpellbook: exportCommanderSpellbook,
    moxfieldImport: exportMoxfieldImport,
    archidektSandbox: exportArchidektSandbox
  };

  async function handleExport(key) {
    const deckRefs = getDeckRefs();
    ensureOverlay();
    if (!deckRefs.length) { setStatus('Navigate to a specific deck page to export.', 'error'); return; }
    setButtonsDisabled(true);
    setStatus('Reading deck…', '');
    try {
      const result = await EXPORTERS[key](deckRefs);
      setStatus(result, 'success');
    } catch (err) {
      setStatus('⚠ ' + err.message, 'error');
    } finally {
      setButtonsDisabled(false);
      setTimeout(() => setStatus(''), 4000);
    }
  }

  // ── Inline injection: each site's own deck-header area ──────────────────
  const INLINE_MARK = '[data-edh-exporter="true"]';

  // Moxfield: the "More" item has a stable id (`subheader-more` — a real,
  // deliberately-named id, not a build-specific hash), confirmed from a
  // real DevTools inspection of the actual toolbar (Playtest/Buy Deck/
  // Download/More — no "Primer" item; an earlier version of this finder
  // assumed one existed and could never match as a result). Walking up
  // from that id to the nearest `.col-auto.d-flex` ancestor (Bootstrap
  // utility classes, also confirmed from the same inspection) survives
  // Moxfield changing the exact wrapper nesting around it, unlike a fixed
  // selector chain would.
  const MOX_TOOLBAR_SELECTORS = [
    '.deckheader-wrapper .row.justify-content-between .col-auto.d-flex',
    '.deckheader-wrapper .col-auto.d-flex'
  ];

  function findMoxToolbar() {
    const container = document.getElementById('subheader-more')?.closest('.col-auto.d-flex');
    if (container) return container;
    // Fallback selectors, kept in case the id or those exact classes ever
    // change — unverified against real markup, so tried last.
    for (const sel of MOX_TOOLBAR_SELECTORS) {
      const el = document.querySelector(sel);
      if (el) return el;
    }
    return null;
  }

  // Archidekt: anchored on the `decks_center` block (the deck's main card
  // content area, a sibling of the header further up the tree) via a
  // CSS-module class-PREFIX match rather than the full hashed class name
  // (`decks_center__aKdPY`, confirmed from a real DevTools inspection) —
  // Next.js/webpack CSS modules append a build-specific hash after `__`
  // but keep the human-readable part stable across deploys, so a substring
  // match survives a redeploy that a full-class match wouldn't.
  //
  // Unlike Moxfield, there's no existing row of icons to join here — the
  // ask was for a new row above the deck content, not merged into an
  // existing one. So this creates an (initially empty) flex row, inserts
  // it right before that block, and hands that back as the "container" —
  // tryInjectInline below fills it in exactly the same way it fills
  // Moxfield's row.
  function findArchidektRow() {
    const anchorEl = document.querySelector('[class*="decks_center"]');
    if (!anchorEl) return null;
    const row = document.createElement('div');
    row.style.cssText = 'display:flex; align-items:center; justify-content:center; gap:8px; margin:8px 0; width:100%;';
    anchorEl.before(row);
    return row;
  }

  const TOOLBAR_FINDERS = { moxfield: findMoxToolbar, archidekt: findArchidektRow };

  // `me-2` (Bootstrap's 0.5rem spacing step) rather than Moxfield's own
  // `me-5` — a tighter gap that reads as part of the row instead of a
  // separated block. Archidekt has no entry here: its row (built above)
  // spaces buttons via its own flex `gap` instead of a per-button class.
  const INLINE_WRAPPER_CLASS = { moxfield: 'me-2' };

  // Archidekt-only: its own "phat button" pill styling (confirmed from a
  // real DevTools inspection — the same class "Clone deck"/"More" use in
  // its primary-actions row), so our buttons pick up Archidekt's actual
  // background/padding/hover instead of our own generic transparent style.
  // Moxfield has no entry — its buttons stay transparent, matching its
  // icon-only row.
  const EXTRA_BTN_CLASS = { archidekt: 'phatButton_button__9cZcg' };

  function injectInlineStyles() {
    if (document.getElementById('edh-exporter-inline-style')) return;
    const style = document.createElement('style');
    style.id = 'edh-exporter-inline-style';
    style.textContent = `
      .edh-exporter-inline-btn {
        border-radius: 6px; cursor: pointer;
        display: inline-flex; align-items: center; justify-content: center;
        height: 28px; min-width: 34px; margin-left: 5px; vertical-align: middle;
        transition: transform 0.1s, opacity 0.15s;
      }
      .edh-exporter-inline-btn:not([class*="phatButton_button"]) { background: transparent; padding: 0; border: none; }
      .edh-exporter-inline-btn[class*="phatButton_button"] {
        height: 48px; min-width: 56px; padding: .5rem .75rem;
      }
      .edh-exporter-inline-btn:hover:not(:disabled) { transform: translateY(-1px); }
      .edh-exporter-inline-btn:disabled { opacity: 0.5; cursor: not-allowed; }
      .edh-exporter-inline-btn img { height: 100%; width: auto; object-fit: contain; display: block; }
    `;
    document.head.appendChild(style);
  }

  function buildInlineButton(key) {
    const dest = DESTINATIONS[key];
    const span = document.createElement('span');
    const wrapperClass = INLINE_WRAPPER_CLASS[SITE];
    if (wrapperClass) span.className = wrapperClass;
    span.setAttribute('data-edh-exporter', 'true');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'edh-exporter-inline-btn';
    const extraClass = EXTRA_BTN_CLASS[SITE];
    if (extraClass) btn.classList.add(extraClass);
    btn.title = `Open on ${dest.label}`;
    const img = document.createElement('img');
    img.src = dest.logo;
    img.alt = dest.label;
    btn.appendChild(img);
    btn.addEventListener('click', () => handleExport(key));
    span.appendChild(btn);
    return span;
  }

  // Finds the specific child of `container` that IS (or contains) Moxfield's
  // "More" item (`#subheader-more`), so new buttons can be inserted
  // immediately before it rather than at an arbitrary position in the row.
  // Walks up to whichever ancestor is a direct child of `container`, since
  // the id sits on the inner `<a>`, not the wrapping `<div>` itself. Returns
  // null on Archidekt (no such id there at all) or if this container simply
  // doesn't contain it, so the caller falls back to inserting at the start.
  function findMoreChild(container) {
    const moreLink = document.getElementById('subheader-more');
    if (!moreLink || !container.contains(moreLink)) return null;
    let node = moreLink;
    while (node.parentElement && node.parentElement !== container) node = node.parentElement;
    return node.parentElement === container ? node : null;
  }

  // Idempotent + self-healing: a no-op if our buttons are already present,
  // re-injects if the site's own re-render wiped them (e.g. switching decks
  // client-side re-renders this exact row), returns false if the toolbar
  // isn't found at all so the caller can fall back to the floating panel.
  function tryInjectInline() {
    if (document.querySelector(INLINE_MARK)) return true;
    const container = TOOLBAR_FINDERS[SITE]?.();
    if (!container) return false;
    injectInlineStyles();
    // A single fragment insert keeps the buttons in DESTS_BY_SITE order —
    // inserting one at a time before the same reference node would reverse
    // it. Placed right before the "More" item specifically (not just
    // "somewhere before everything"); falls back to the start of the row
    // if this container has no "More" item to anchor on.
    const frag = document.createDocumentFragment();
    for (const key of DESTS_BY_SITE[SITE]) {
      frag.appendChild(buildInlineButton(key));
    }
    container.insertBefore(frag, findMoreChild(container) || container.firstChild);
    return true;
  }

  // ── Floating panel (fallback for either site if its toolbar isn't found) ─
  function renderButtons() {
    els.btnRow.innerHTML = '';
    for (const key of DESTS_BY_SITE[SITE]) {
      const dest = DESTINATIONS[key];
      const btn = document.createElement('button');
      btn.className = 'dbtn';
      btn.type = 'button';
      btn.title = `Open on ${dest.label}`;
      btn.style.background = dest.chip;
      const img = document.createElement('img');
      img.src = dest.logo;
      img.alt = dest.label;
      btn.appendChild(img);
      btn.addEventListener('click', () => handleExport(key));
      els.btnRow.appendChild(btn);
    }
  }

  // ── Show/hide + keep in sync with SPA navigation ────────────────────────
  function syncPanel() {
    const deckRefs = getDeckRefs();
    if (!deckRefs.length) {
      if (shadow) els.panel.classList.add('hidden');
      return;
    }

    if (tryInjectInline()) {
      usingFloatingPanel = false;
      if (shadow) els.panel.classList.add('hidden');
      return;
    }

    // Moxfield has no floating-panel fallback: if its toolbar can't be
    // found, no export UI shows there at all (the toolbar popup still
    // works regardless) rather than a mismatched floating box standing in
    // for a broken inline placement.
    if (SITE === 'moxfield') {
      usingFloatingPanel = false;
      if (shadow) els.panel.classList.add('hidden');
      return;
    }

    usingFloatingPanel = true;
    ensureOverlay();
    if (!els.btnRow.childElementCount) renderButtons();
    els.panel.classList.remove('hidden');
  }

  syncPanel();

  // Archidekt/Moxfield are both client-routed SPAs — a content script only
  // runs once per real page load, so navigating between decks without a
  // full reload wouldn't otherwise be noticed. A content script's own
  // window.history is a separate object from the page's (isolated world),
  // so patching pushState here wouldn't see the page's own navigations —
  // watching the DOM (plus popstate for back/forward) is the reliable way
  // to detect the URL actually changing. This also doubles as the retry
  // loop for each site's inline anchor: both render client-side (confirmed
  // empty/absent in the raw page source for both), so it may not exist yet
  // on the very first sync — every subsequent DOM mutation gets another
  // shot at finding it until tryInjectInline succeeds. Gated on
  // TOOLBAR_FINDERS[SITE] existing at all so that a site with no finder
  // configured doesn't leave `inlinePending` stuck true forever (the mark
  // could never appear) and re-run syncPanel() on every single DOM
  // mutation for as long as the page stays open.
  let lastHref = location.href;
  const checkUrlChange = () => {
    const hrefChanged = location.href !== lastHref;
    if (hrefChanged) lastHref = location.href;
    const inlinePending = !!TOOLBAR_FINDERS[SITE] && !document.querySelector(INLINE_MARK);
    if (hrefChanged || inlinePending) syncPanel();
  };
  new MutationObserver(checkUrlChange).observe(document.documentElement, { subtree: true, childList: true });
  window.addEventListener('popstate', checkUrlChange);
})();
