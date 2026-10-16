# EDHPORT

A Manifest V3 Chrome Extension that exports Commander decks from **Archidekt** and **Moxfield** directly to [edhpowerlevel.com](https://edhpowerlevel.com) and [commanderspellbook.com](https://commanderspellbook.com), and automatically fixes malformed links on either site that embed a source deck URL.

---

## Installation

> **No store listing** — install manually in a few steps. Takes about 2 minutes.

---

### Desktop — Chrome

**Step 1 — Download**

- **ZIP (easiest):** [Download ZIP](https://github.com/exhit/EDH-Power-Level-Exporter/archive/refs/heads/main.zip) and unzip it somewhere permanent (e.g. `Documents/EDH-Power-Level-Exporter`)
- **Git:** `git clone https://github.com/exhit/EDH-Power-Level-Exporter.git`

**Step 2 — Open the Extensions page**

Paste into your Chrome address bar and press Enter:
```
chrome://extensions
```

**Step 3 — Enable Developer Mode**

Flip the **Developer mode** toggle in the top-right corner **ON**.

**Step 4 — Load the extension**

1. Click **Load unpacked** (top-left)
2. Select the **`chrome/`** folder inside the downloaded/cloned directory
3. Click **Select Folder**

The **EDHPORT** icon will appear in your toolbar. Pin it via the puzzle-piece icon next to the address bar.

**Updating**

ZIP: re-download, replace folder contents, then click **↺** next to the extension on `chrome://extensions`.

Git:
```bash
git pull
```
Then click **↺** on `chrome://extensions`.

---

### Mobile — Orion Browser (iOS)

[Orion](https://kagi.com/orion/) is a free WebKit browser by Kagi that supports Chrome extensions natively on iPhone and iPad.

**Step 1 — Download**

Same as above — download the ZIP or clone the repo.

**Step 2 — Open Orion Settings**

In Orion on iOS, go to: **Settings → Extensions**

**Step 3 — Load the extension**

Tap **Load Unpacked Extension** and select the **`orion/`** folder inside the downloaded/cloned directory.

The **EDHPORT** will appear in Orion's extension list and is ready to use on Archidekt and Moxfield deck pages.

---

## Usage

### Manual export

1. Navigate to a deck page on **Archidekt** (`archidekt.com/decks/<id>`) or **Moxfield** (`moxfield.com/decks/<id>`)
2. Click the extension icon
3. Pick a destination:
   - **EDH Power Level** — always available
   - **Archidekt Sandbox** — shown when your deck is on Moxfield; opens Archidekt's sandbox pre-loaded with the full decklist
   - **Moxfield Import** — shown when your deck is on Archidekt; copies a plain-text decklist to your clipboard and opens Moxfield's deck list so you can paste it into a new deck
4. Click **Analyze Deck** — the extension reads your deck and shows the commander, card count, and any skipped categories
5. Click the destination's export button (e.g. **Open on EDH Power Level**) — a new tab opens with your deck pre-loaded (or, for Moxfield Import, ready to paste)

### On-page export buttons

Deck pages on Archidekt and Moxfield also get a small floating panel (bottom-right) with a logo button per available destination — no need to open the toolbar popup first. Click a logo to fetch and export that deck directly; for Archidekt Sandbox, any required printing swaps are confirmed in an on-page popup before it opens, same as the extension popup's flow.

### Auto mode

Toggle **Auto-analyze & open on EDH Power Level** in the popup. When on, picking a destination will immediately analyze and export — no further clicks needed. The preference is saved across sessions.

### Cardmarket want list export

On any [cardmarket.com](https://cardmarket.com) want list page (`cardmarket.com/en/Magic/Wants/<id>`), a **Copy as Decklist** button appears right next to the page's own "X Wants - Y Cards" heading. Click it to copy every card currently listed in the want list table to your clipboard as a plain-text decklist (`qty name`, one per line) — ready to paste into Archidekt, Moxfield, or anywhere else that accepts a decklist. Only cards on the currently loaded page are read (want lists spanning multiple pages need each page copied separately).

### Malformed link interception

If you click a link of the form `https://edhpowerlevel.com/https://archidekt.com/decks/…` (or with any other joiner: `+`, `%20`, `?`, `&`, `#`, `|`, etc.), the extension automatically:

1. Blocks the broken navigation
2. Fetches the deck from the source site's API
3. Redirects to the correct `edhpowerlevel.com/?d=…` URL

---

## How it works

### Archidekt

Calls `https://archidekt.com/api/decks/<id>/` directly. The response includes a `categories` array on the deck object — each category has an `includedInDeck` boolean. Categories with `includedInDeck: false` are custom maybeboards and are excluded regardless of their name. The commander is identified by a category named `"Commander"`.

### Moxfield

Calls `https://api.moxfield.com/v2/decks/all/<publicId>`. The response has top-level board keys: `commanders`, `mainboard`, `sideboard`, `maybeboard`, etc. The `commanders` board becomes the commander; `mainboard` and `companions` become the mainboard; all others are skipped.

### Category filtering

Only these category names are excluded by name (exact match, Moxfield boards):
`sideboard`, `side board`, `maybeboard`, `maybe board`, `maybe-board`, `side-board`, `wishlist`, `watch list`, `acquiring`, `to acquire`, `on the chopping block`

For Archidekt, `includedInDeck: false` is the authoritative signal — name matching is only a fallback.

### Archidekt Sandbox destination

Archidekt's sandbox reads a `deck` query parameter: a JSON array of `{ c: "c"|"m", f: 0, q: <qty>, u: <id> }` entries, where `c` marks commander vs. mainboard and `u` is a card identifier. That identifier is a Scryfall printing ID — confirmed by comparing Archidekt's own `card.uid` field against Scryfall's `id` for the same printing. Moxfield's API exposes the same Scryfall ID per card (`card.scryfall_id`), so a Moxfield-sourced deck can be translated directly into an Archidekt sandbox link. Cards without a resolvable ID are dropped rather than producing a broken entry.

### Moxfield Import destination

Moxfield does have a URL scheme for pre-loading a decklist: `moxfield.com/import?c=<list>`, where `<list>` is one `qty name` pair per line (no `Commander`/`Deck` section headers — the commander is just the first entry). This destination builds that URL directly and opens it — no clipboard involved.

---

## Versioning

This project uses [Semantic Versioning](https://semver.org). See [CHANGELOG.md](CHANGELOG.md) for the full history.

To create a new release:

```bash
# bump version in manifest.json, then:
git add -A
git commit -m "feat: description of changes"
git tag v1.x.x
git push && git push --tags
```

---

## Permissions

| Permission | Reason |
|---|---|
| `activeTab` | Read the current tab's URL |
| `scripting` | Inject scripts for DOM-based fallbacks |
| `tabs` | Open new tabs and update tab URLs |
| `storage` | Persist the auto-open toggle preference |
| `webNavigation` | Intercept malformed edhpowerlevel.com navigations |
| `webRequest` | Detect HTTP 429 responses during the Archidekt debug export, so it can back off instead of leaving tabs stuck on an error page |
| Host: archidekt.com | Fetch deck data from Archidekt's API |
| Host: moxfield.com / api.moxfield.com | Fetch deck data from Moxfield's API |
| Host: edhpowerlevel.com | Intercept and redirect malformed links |
| Host: cardmarket.com | Inject the "Copy as Decklist" button on want list pages |
