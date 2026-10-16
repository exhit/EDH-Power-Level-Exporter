# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.1.0] - 2026-08-12

### Added
- Cardmarket want list export: a **Copy as Decklist** button now appears next to the "X Wants - Y Cards" heading on any Cardmarket want list page (`cardmarket.com/*/Wants/*`). Clicking it reads every row in the want list table and copies it to the clipboard as a plain `qty name` decklist, one card per line — the same shape used elsewhere in this extension (e.g. Moxfield Import). Built as a new content script (`content-cardmarket-wants.js`), scoped to the `#WantsListTable` section specifically so it reads the desktop table (which stays in the DOM at every viewport width, just CSS-hidden below the `lg` breakpoint) rather than the separate mobile accordion markup covering the same wants, avoiding double-counting. Re-injects itself if Cardmarket's own AJAX row updates (its `tbody` is `aria-live="polite"`) wipe the button
- Added `https://www.cardmarket.com/*` and `https://cardmarket.com/*` to host permissions to support the above

## [2.0.0] - 2026-07-30

Major version bump reflecting the scope of changes since 1.7.0: a destination picker with four export targets (EDH Power Level, Archidekt Sandbox, Moxfield Import, Commander Spellbook), reverse exports (EDH Power Level/Commander Spellbook as source), and Archidekt printing-compatibility resolution with user confirmation.

### Added
- On-page export buttons: a small floating panel with each destination's real logo (EDH Power Level, Archidekt Sandbox, Moxfield Import, Commander Spellbook — never the one matching the site you're already on) now appears directly on Archidekt and Moxfield deck pages, so exporting no longer requires opening the toolbar popup first. Built as a content script (`content-export.js`) rendering into a Shadow DOM (so the host page's CSS can't bleed in or out), with its own printing-swap confirm modal for the Archidekt Sandbox destination — reusing the same background.js logic (deck fetch, Scryfall printing resolution, and the debug-tabs run) as the popup. Stays in sync with in-app navigation between decks on both sites (they're client-routed SPAs, so a content script's one-time page load wouldn't otherwise notice)
- `background.js` (both builds) gained message handlers (`exportFetchDeck`, `exportResolveArchidekt`) backing the on-page buttons above — deck fetching and printing resolution have to happen there rather than in the content script itself, since a content script's own `fetch()` runs under the PAGE's origin and doesn't get the CORS bypass `host_permissions` gives extension pages; confirmed neither archidekt.com's nor moxfield.com's API sends an `Access-Control-Allow-Origin` covering the other site's own origin
- The Archidekt debug export (per-card sandbox tabs) now opens a dedicated small control window instead of only updating the popup's button label. That window shows live "Opening X/Y" progress and a **Stop** button, and — unlike the popup — doesn't close itself when it loses focus (e.g. when one of the tabs it just opened steals focus), so it stays usable for the full run. Closing the window has the same effect as clicking Stop: the run halts before opening any more tabs
- Added the `webRequest` permission (both builds) so the debug run can see when Archidekt responds to a sandbox tab with HTTP 429 "Too Many Requests"
- "Copy full decklist" button on the Archidekt printing-changes confirmation screen: copies a `qty name (set) collector#` list of every card about to be sent (using the resolved oracle name and its actual resolved printing, not a reskin/flavor name), so the export can be sanity-checked by hand against the source deck without decoding the sandbox URL. Cards that fail to resolve entirely are flagged inline instead of silently vanishing from the list
- Debug-only "open + copy each card separately" button on the same screen: reuses the decklist-copy logic above, then opens one single-card Archidekt Sandbox tab per card (staggered, in the background) instead of the one combined-deck link. Lets a failing combined sandbox be narrowed down to whichever specific card's uid Archidekt can't resolve, rather than only knowing the whole load failed

### Fixed
- Moxfield Import didn't actually import anything: it copied the decklist to the clipboard and opened `moxfield.com/decks/personal`, which turned out to be the user's *existing* decks dashboard, not an import screen — so nothing appeared to happen even when the copy succeeded. Moxfield actually has a URL-based import scheme after all (`moxfield.com/import?c=<qty name, one per line>`, confirmed against a real working example), so this destination now builds and opens that URL directly. No clipboard, no manual paste step, no "open the wrong page" bug. Applies to both the popup's Moxfield Import destination and the on-page button of the same name
- The debug export still hit Archidekt's rate limit on larger decks even at the existing 2s-per-tab spacing, and a tab that got 429'd just sat on a dead error page for the rest of the run with no recovery. The run now detects 429 responses directly (via `webRequest`), backs off by doubling the delay between remaining tabs (capped at 15s), and reloads that specific tab in place once the longer cooldown passes (up to 3 retries per card) instead of leaving it broken. Where `webRequest` visibility isn't available (host-dependent), the run still works — just without the adaptive backoff
- The debug button's tab-opening loop first ran inside the popup's own script, same as everything else in this file — but a ~90-tab loop takes long enough that the user closing (or just clicking away from) the popup partway through killed it mid-run, and opening tabs every 200ms got Archidekt's server to start responding with "too many requests". Moved the loop into `background.js` (a Manifest V3 service worker, which keeps running independently of the popup's lifecycle) and lengthened the delay between tabs to 2 seconds. The popup now hands the card list off with `chrome.runtime.sendMessage` and only shows live progress for as long as it happens to stay open — the tabs keep opening in the background either way
- `fetchScryfallCollection` silently swallowed non-OK responses and Scryfall's `not_found` list, so a "Couldn't match any cards to Archidekt's database" failure gave no clue why. Now logs the actual HTTP status/body on failure, logs any `not_found` identifiers, and `resolveArchidektIds` separately logs exactly which cards (by name and qty) will actually be dropped from the export — as opposed to a failed id-only lookup that a same-card name lookup already recovered, which is harmless and previously indistinguishable from a real drop in the console
- `isRiskyPrinting` didn't check `card.digital`, so a name-based Scryfall match landing on a digital-only (Arena/MTGO-exclusive) printing would sail through unflagged and end up in the export instead of being swapped for a real paper printing through the existing confirm-and-swap flow. Surfaced by a Moxfield deck caching a since-retired `scryfall_id` for a basic Plains — the id lookup 404ing was itself harmless (its name-based fallback still resolved to a real paper printing), but it highlighted that nothing was actually guaranteeing "paper" for any fallback match. `digital` prints are now treated as risky like any other unusable printing

### Changed
- `resolveArchidektIds` now computes each card's actual resolved printing (`.resolvedCard`) *before* the confirmation screen renders, rather than after — the copy button needs that data to show set/printing info, and it wasn't available yet at the point the screen used to be built. Verified via direct simulation against both a raw and an already-swapped deck that this produces byte-identical `resolvedId` output to the previous version — a pure refactor, not a behavior change

### Fixed
- The 1.9.4 URL-shrink (omitting `f`/`q` when at their default) made Archidekt Sandbox open a completely empty deck instead of a partially-working one. Confirmed via the new copy-decklist button that the card list itself was intact going into the export, which narrowed it to the URL-building step — Archidekt's parser apparently doesn't default a missing key, it more likely aborts the whole array on the first entry that doesn't match its expected shape. Reverted to always sending all four keys (`c`, `f`, `q`, `u`) per entry. This means the underlying HTTP 431 risk on very large decks is back and unresolved — a working sandbox that might occasionally hit it beats a shorter URL that reliably opens empty

## [1.9.4] - 2026-07-30

### Fixed
- Archidekt Sandbox failing entirely even with every printing correctly swapped, showing HTTP 431 "Request Header Fields Too Large" — a genuinely different root cause from anything before it. A ~93-card deck produces a ~10,175-character `deck=` URL; a plain request for that exact URL returned a clean 200, but a real browser (adding its own cookies/headers on top of the URL) tipped the combined request over Archidekt's server-side header-size limit. Since a Commander deck is always ~100 cards, this isn't an edge case — it will hit most exports through this destination. `f` (always 0 — foil isn't tracked) and `q` (1 for all but a few basic lands) are now omitted from each entry when at their default instead of always being written out, cutting this deck's URL by ~25% (10,175 → 7,613 chars) without changing what Archidekt receives for cards that do have a non-default value

## [1.9.3] - 2026-07-29

### Fixed
- Archidekt Sandbox risk detection narrowed to only flag a `flavor_name` mismatch (true reskins like Sylvan Library), on the theory that promo/Secret Lair prints with a normal oracle name resolve fine on Archidekt. Tested against a real deck: the whole sandbox still failed to load with promo-only prints in it (Ygra, Eater of All's Bloomburrow promo; Secret Lair Commander cards like Krark-Clan Ironworks and Phyrexian Altar), confirming a single unresolvable uid breaks the entire load regardless of whether the name matches. Restored the `set_type` check (`box`/`memorabilia`/`funny`/`promo`) alongside the `flavor_name` check — verified end-to-end against the exact deck that surfaced this, correctly swapping all 6 affected cards to a mainstream printing

## [1.9.2] - 2026-07-29

### Added
- Archidekt Sandbox now asks for confirmation before silently swapping any card's printing: a Continue/Cancel prompt inside the popup itself lists each affected card's original printing and its replacement. Cancelling aborts the export instead of opening Archidekt
- Commanders and mainboard are now resolved together so a card flagged as risky in both only triggers one confirmation, not two

### Changed
- The confirmation prompt was first built as a native `confirm()` injected into the source tab, on the reasoning that Chrome popups don't support `alert`/`confirm`/`prompt` at all. Testing showed it silently broke the export: showing a dialog on the tab hands it focus, and Chrome closes popups that lose focus — killing the popup's JS mid-await before the result ever came back, so nothing opened and no dialog was visibly shown. Replaced with a prompt rendered inside the popup's own DOM, which has no such risk

### Fixed
- The "swap risky printing for the oldest one" logic could still hand back a risky printing: it blindly took the first result of a release-date-ascending search, but some cards' regular and promo printings release on the *exact same day* (confirmed with Ygra, Eater of All — its Bloomburrow set card and promo variant both released 2024-08-02), and Scryfall doesn't guarantee the regular one sorts first among same-day prints. `fetchBestScryfallPrinting` (renamed from `fetchOldestScryfallPrinting`) now explicitly skips risky prints when scanning the sorted list instead of trusting whichever one comes first. Verified against a real deck where this let Ygra's promo printing slip through unswapped

## [1.9.1] - 2026-07-28

### Fixed
- Archidekt Sandbox still breaking on reskinned/crossover cards after the 1.9.0 fix: that fix corrected the *name* used for the lookup (oracle name instead of Moxfield's reported flavor name), but Scryfall's "default" printing for an exact-name match isn't necessarily one Archidekt carries — for "Sylvan Library" it's literally the Secret Lair reskin printing itself. Verified against a real ~90-card decklist that failed specifically on this card and on "The Great Henge" (crossover-renamed "The Banyan Tree" in an Avatar: The Last Airbender set). Any matched printing carrying a `flavor_name`, or classified as a promo/Secret-Lair/Un-set/memorabilia printing, is now swapped for that card's *oldest* printing (ordered by release date via Scryfall search) — the version every deck site is virtually guaranteed to track. Normal cards are unaffected and incur no extra lookups

## [1.9.0] - 2026-07-25

### Added
- Reverse exports: EDH Power Level and Commander Spellbook now also work as the *source* of a deck, not just as destinations. If you have a decklist loaded in either site's input box, you can now export it to Archidekt Sandbox or Moxfield Import (or the other of the two)
- EDH Power Level's own page keeps its `?d=` URL param in sync with whatever's in its Decklist box (confirmed in its page JS: it reads `?d=` on load and rewrites it via `history.pushState` every time "Analyze List" runs), so reading the current tab URL is enough — no page scraping needed
- Commander Spellbook's "Commanders"/"Paste your decklist" boxes (`#commander-input`/`#decklist-input` on `/find-my-combos/`) aren't reflected in the URL, so this reads their live values directly via `chrome.scripting.executeScript`
- Added the `scripting` permission (orion build only — chrome already had it) and `commanderspellbook.com` to both builds' host permissions to support that DOM read

### Changed
- Each destination button is now hidden specifically on its own site (EDH Power Level hidden on EDH Power Level, Commander Spellbook hidden on Commander Spellbook), matching the existing Archidekt/Moxfield behavior

### Fixed
- Archidekt Sandbox export using a card's Secret Lair "reskin" name (e.g. Sylvan Library printed as "La abundancia de Yucahú") instead of its real name: Moxfield reports that flavor name as `card.name`, and Scryfall's exact-name search only matches oracle names, so the lookup was silently missing and falling back to that exact (often Archidekt-unavailable) printing. Cards with a Moxfield scryfallId now get their true oracle name confirmed via an id lookup first, then that name is used for the common-printing resolution — verified against the real card (Scryfall: `name: "Sylvan Library"`, `flavor_name: "La abundancia de Yucahú"`)

## [1.8.0] - 2026-07-10

### Added
- Destination picker: clicking the extension icon now first shows a "Where do you want to export this deck?" screen, with EDH Power Level, Archidekt Sandbox, and Moxfield Import as options
- Applies to both the `chrome/` and `orion/` builds
- **Archidekt Sandbox**: shown when the current deck is on Moxfield. Opens `archidekt.com/sandbox?deck=...` pre-loaded with every card, matched by Scryfall printing ID (confirmed Archidekt's own `card.uid` is the Scryfall id)
- **Moxfield Import**: shown when the current deck is on Archidekt. Moxfield has no URL-based decklist loader, so this copies a plain-text decklist to the clipboard and opens `moxfield.com/decks/personal` for a manual paste; if the clipboard write fails, the list is shown in a selectable text box instead
- **Commander Spellbook**: shown on both Archidekt and Moxfield deck pages. Opens `commanderspellbook.com/find-my-combos/?decklist=...&commanders=...`, reusing the same already-filtered commander/mainboard lists built for EDH Power Level (its own `?deckUrl=` mode re-fetches the deck itself and doesn't apply the same excluded-category filtering, so it was over-counting sideboard/maybeboard cards)
- Each destination is hidden when it matches the site you're already on (no "export to Archidekt" while already on Archidekt, and vice versa for Moxfield)

### Changed
- `orion/` popup no longer auto-fetches and opens on load — it now waits for the destination to be picked first
- `chrome/` version number synced to match feature parity with `orion/` (it had fallen behind despite already containing the 1.7.0 features)

### Fixed
- Archidekt Sandbox export failing on some Moxfield decks: Archidekt's card database doesn't carry every Scryfall printing (rare promos, World Championship prizes, etc.), so the exact printing Moxfield stores for a card could point at a uid Archidekt doesn't have, breaking the whole sandbox load. Each card is now re-resolved by name against Scryfall's collection endpoint to prefer a common/default printing, falling back to Moxfield's original id only if that lookup misses
- Moxfield Import appearing to do nothing: the new tab it opened (`moxfield.com/decks/personal`) stole focus, and Chrome closes popups that lose focus — so the "✓ Decklist copied" confirmation was dismissed before it could be read. The tab now opens in the background so the popup stays open long enough to show the message

## [1.7.0] - 2026-06-18

### Added
- Support for partner commanders and any 2-card commander pairs — both commanders are now included in the exported URL instead of only the first one
- Support for Archidekt playtester URLs (`archidekt.com/playtester-v2/<id>`) and any other Archidekt URL that contains the deck number in the path
- Support for Archidekt snapshot URLs (`archidekt.com/snapshots/<id>`) — uses the correct `api/decks/snapshots/<id>/` endpoint
- Support for Archidekt compare URLs (`archidekt.com/compare?one=d_<id>&two=s_<id>`) — fetches both decks and opens each in its own EDH Power Level tab; `d_` prefix is a deck, `s_` prefix is a snapshot

### Changed
- Popup now shows both commanders separated by ` + ` for partner decks
- Popup badge shows "compare #id1 & #id2" when on a compare page
- Export button label updates to "Analyze Decks" / "Open Both on EDH Power Level" for compare pages

## [1.6.1] - 2026-06-14

### Fixed
- Extension CORS issue when calling for an URL not directly from that URL's domain. Used sendMessage to service worker to bypass the issue

## [1.6.0] - 2026-06-14

### Removed
- Complex and unnecessary popup funcionalities

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
