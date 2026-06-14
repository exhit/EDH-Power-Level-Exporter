# EDH Power Level Exporter — Chrome Extension

A Manifest V3 Chrome Extension that reads Commander decks from **Archidekt**, **Moxfield**, and **Manabox**, then opens them directly on [edhpowerlevel.com](https://edhpowerlevel.com).

---

## Installation

1. Open Chrome and navigate to `chrome://extensions`
2. Enable **Developer mode** (toggle in the top-right corner)
3. Click **Load unpacked**
4. Select the `edh-exporter` folder (this folder)

The extension icon will appear in your Chrome toolbar.

---

## Usage

1. Navigate to a deck page on one of:
   - **Archidekt** — `archidekt.com/decks/<id>`
   - **Moxfield** — `moxfield.com/decks/<id>`
   - **Manabox** — `manabox.app/decks/<id>`

2. Click the extension icon in the toolbar
3. Click **Analyze Deck** — the extension reads your deck and shows:
   - Commander name
   - Main deck card count
   - Any skipped categories (sideboard, maybeboard, tokens, etc.)
4. Click **Open on EDH Power Level** — a new tab opens with your deck pre-loaded

---

## How it works

### Category filtering

The extension automatically excludes these category types from the export:
- Sideboard / Side Board
- Maybeboard / Maybe Board / Maybe
- Tokens / Emblems
- Wishlist / Acquire / Trade
- Cuts / Considering

Only cards in the main 100-card deck (including the Commander category) are exported.

### URL format

The extension builds URLs in this format:
```
https://edhpowerlevel.com/?d=Commander~1+<CommanderName>~~Mainboard~1+<Card1>~1+<Card2>...~~Z~
```

### Data extraction

The extension reads deck data in order of reliability:
1. **API interception** — content scripts intercept `fetch()` calls to the site's own API when the page loads, caching the structured JSON for instant access
2. **Next.js hydration data** — reads from `window.__NEXT_DATA__` if available (Archidekt, Moxfield)
3. **DOM scraping** — falls back to reading the rendered card list from the page

---

## Supported sites

| Site       | API intercept | Next.js data | DOM fallback |
|------------|:---:|:---:|:---:|
| Archidekt  | ✓   | ✓   | ✓   |
| Moxfield   | ✓   | ✓   | ✓   |
| Manabox    | ✓   | —   | ✓   |

---

## Troubleshooting

**"Could not find card elements"**
→ Wait for the deck to fully load, then try again.

**Wrong card count**
→ Make sure you're on the deck view (not the print/export view). Some categories with custom names that aren't in the exclude list may be included — check the "Skipped categories" field.

**Commander not detected**
→ The Commander must be in a category named "Commander" (case-insensitive). If your deck uses a custom category name, rename it in the deck builder.

---

## Permissions

- `activeTab` — to read the current tab's URL and inject scripts
- `scripting` — to run the extraction script in the page context
- Host permissions for Archidekt, Moxfield, Manabox — to allow script injection on those domains
