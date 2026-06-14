# EDH Power Level Exporter

A Manifest V3 Chrome Extension that exports Commander decks from **Archidekt** and **Moxfield** directly to [edhpowerlevel.com](https://edhpowerlevel.com), and automatically fixes malformed edhpowerlevel.com links that embed a source deck URL.

---

## Installation

> **No Chrome Web Store listing** — install manually in a few steps. Takes about 2 minutes.

### Step 1 — Download the extension

**Option A (easiest): Download as ZIP**
1. [Download](https://github.com/exhit/EDH-Power-Level-Exporter/archive/refs/heads/main.zip)
2. Unzip the folder somewhere you won't accidentally delete it (e.g. `Documents/EDH-Power-Level-Exporter`)
3. Go to [chrome extension page](chrome://extensions/)
4. Turn on "Developer Mode" on the top right corner
5. Click the "Load unpacked" on the top left corner
6. Choose the unpacked zip folder

**Option B: Clone with Git**
```bash
git clone https://github.com/YOUR_USERNAME/edh-powerlevel-exporter.git
```

---

### Step 2 — Open Chrome Extensions

Paste this into your Chrome address bar and press Enter:

```
chrome://extensions
```

Or go to: **Chrome menu (⋮) → Extensions → Manage Extensions**

---

### Step 3 — Enable Developer Mode

In the top-right corner of the Extensions page, flip the **Developer mode** toggle **ON**.

---

### Step 4 — Load the extension

1. Click the **Load unpacked** button (top-left, appears after enabling Developer mode)
2. Select the folder you downloaded/cloned in Step 1
3. Click **Select Folder**

The **EDH Power Level Exporter** icon will appear in your Chrome toolbar. Pin it for easy access via the puzzle-piece icon (🧩) next to the address bar.

---

### Updating

**Option A (ZIP):** Re-download the ZIP, replace the folder contents, then click **↺** (refresh) next to the extension on `chrome://extensions`.

**Option B (Git):**
```bash
git pull
```
Then click **↺** next to the extension on `chrome://extensions`.

---

## Usage

### Manual export

1. Navigate to a deck page on **Archidekt** (`archidekt.com/decks/<id>`) or **Moxfield** (`moxfield.com/decks/<id>`)
2. Click the extension icon
3. Click **Analyze Deck** — the extension reads your deck and shows the commander, card count, and any skipped categories
4. Click **Open on EDH Power Level** — a new tab opens with your deck pre-loaded

### Auto mode

Toggle **Auto-analyze & open on EDH Power Level** in the popup. When on, opening the popup on any deck page will immediately analyze and open EDH Power Level — no clicks needed. The preference is saved across sessions.

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
| Host: archidekt.com | Fetch deck data from Archidekt's API |
| Host: moxfield.com / api.moxfield.com | Fetch deck data from Moxfield's API |
| Host: edhpowerlevel.com | Intercept and redirect malformed links |
