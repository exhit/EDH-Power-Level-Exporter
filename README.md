# EDH Power Level Exporter

A Manifest V3 Chrome Extension that exports Commander decks from **Archidekt** and **Moxfield** directly to [edhpowerlevel.com](https://edhpowerlevel.com), and automatically fixes malformed edhpowerlevel.com links that embed a source deck URL.

---

## Installation

### From source (developer mode)

1. Clone the repository:
   ```bash
   git clone https://github.com/YOUR_USERNAME/edh-powerlevel-exporter.git
   ```

2. Open Chrome and go to `chrome://extensions`

3. Enable **Developer mode** (toggle in the top-right corner)

4. Click **Load unpacked** and select the cloned folder

The extension icon will appear in your Chrome toolbar.

### Updating

```bash
git pull
```

Then click the **↺ refresh** button on `chrome://extensions`.

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
