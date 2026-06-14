# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.5.0] - 2026-06-14

### Added
- Background service worker that intercepts malformed `edhpowerlevel.com` URLs
  embedding a source deck URL (e.g. `edhpowerlevel.com/https://archidekt.com/decks/…`)
  and automatically fetches the deck and redirects to the correct export URL
- Broad joiner support: handles `/`, `+`, `%20`, `?`, `&`, `#`, `|`, `,`, `;`,
  URL-encoded variants, and no separator at all

## [1.4.0] - 2026-06-14

### Added
- Auto-analyze toggle: when enabled, opening the popup on a deck page immediately
  analyzes and opens EDH Power Level without any clicks
- Toggle state persists via `chrome.storage.sync`

## [1.3.0] - 2026-06-14

### Removed
- Manabox support (no reliable public API or stable DOM structure)

## [1.2.0] - 2026-06-14

### Changed
- Category exclusion switched from substring matching to exact matching, fixing
  false exclusions of gameplay categories like "Tokens", "Removal", "Cuts"
- Removed "token", "tokens", "emblem", "cut", "cuts", "considering", "trade",
  "acquire" from name-based exclusion list — Archidekt's `includedInDeck` flag
  is the authoritative signal for custom maybeboards

### Fixed
- Bitterbloom Bearer (and any card in a "Tokens" gameplay category) no longer
  incorrectly excluded from the export

## [1.1.0] - 2026-06-14

### Changed
- Archidekt: switched from DOM scraping to direct API call
  (`archidekt.com/api/decks/<id>/`), using `includedInDeck` flag per category
- Moxfield: switched to correct API shape — `data.mainboard` / `data.commanders`
  at top level (not nested inside a `boards` wrapper as previously assumed)
- Commander now carried as `{ qty, name }` object throughout; quantity included
  in the EDH Power Level URL

### Fixed
- Moxfield returning 0 cards (wrong response shape assumed)
- Commander missing from card count in popup

## [1.0.0] - 2026-06-14

### Added
- Initial release
- Export Commander decks from Archidekt and Moxfield to EDH Power Level
- Two-step flow: Analyze Deck → Open on EDH Power Level
- Manifest V3 Chrome Extension
