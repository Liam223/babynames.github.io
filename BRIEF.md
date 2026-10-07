# Baby Name Swiper — Build Brief

## Overview
Build a small, fun, mobile-first web app for quickly sorting, ranking and eliminating baby names. Users swipe through names (Tinder style), then rank their favourites head to head (this-or-that). The names are UK and Ireland-centric, with good coverage of Irish names and names of Irish origin.

- **Repo:** https://github.com/Liam223/nameblocks
- **Hosting:** GitHub Pages, deployed from the `main` branch, `/ (root)` folder
- **Live URL:** `https://liam223.github.io/nameblocks/`. This is a project site, so the repo name appears in the path. All asset paths **must be relative** (`./data/boys.json`, not `/data/boys.json`).
- **Cost:** must be free to build and host. No paid services.
- **Audience:** UK/Ireland parents-to-be. Use UK English throughout (e.g. "favourites", "colour").

## Hard constraints
- **Static site only.** No server, no database, no login, no build step required to run. Plain HTML, CSS and vanilla JavaScript (ES modules are fine). Anything loaded from a CDN must be small and optional.
- **Mobile first.** Designed for phones in portrait (360–430px wide). It must also work on desktop with mouse and keyboard.
- **Persistence** uses `localStorage` only, on each person's own device. Wrap every storage read and write in try/catch so the app still runs (without saving) if storage is blocked.
- **Fast.** The first screen should load in under 2 seconds on 4G. Keep the name data compact.
- **Installable** as a PWA: `manifest.webmanifest` plus icons, and a simple service worker that caches the app shell and data for offline use.

## Name data

### Sources (all official, free to reuse)
| Source | Coverage | Licence |
|---|---|---|
| ONS – Baby names in England and Wales | Every name given to 3 or more babies, boys and girls separately, annual | Open Government Licence v3 |
| National Records of Scotland – Babies' first names | Full lists by sex, annual | Open Government Licence |
| NISRA – Baby names (Northern Ireland) | Full lists by sex, annual | Open Government Licence |
| CSO Ireland – Irish babies' names | Republic of Ireland, by sex, annual | CC BY 4.0 |

Check the latest available year for each source and the current download formats (usually XLSX or CSV). If the shell can't download them because of network restrictions, list the exact files needed and ask the user to download them into `data-src/`.

### Processing script
Write `scripts/build-names.py` (or Node, whichever you prefer). It reads the raw files from `data-src/` and outputs `data/boys.json` and `data/girls.json`. The script is for development only and is not needed at runtime. Commit both the script and the generated JSON. Raw source files may be committed to `data-src/` if they're small; otherwise add them to `.gitignore` and document where to get them in the README.

Processing rules:
1. **Use the last 5 years** from each source where available. This favours current names while keeping some depth.
2. **Merge across the four sources.** For each name and sex, sum the counts.
3. **Group spelling variants that differ only in accents.** Use the diacritic-stripped, lowercased form as the grouping key, so Oisín and Oisin become one card. Show the most common spelling and keep the other spellings as `variants`. Do **not** merge genuinely different spellings (Aoife vs Eva, Niamh vs Neve). Those stay as separate cards.
4. **Popularity score:** combined count, plus a rank within that sex.
5. **Minimum threshold:** drop names with a combined total below about 15 across all years and sources. This removes one-off names and typos. Make the threshold a constant so it's easy to change.
6. **Irish-origin tag:** create a curated list in `data-src/irish-names.txt`, one name per line, covering both Irish-language names (Saoirse, Tadhg, Caoimhe, Oisín, Ciarán, Niamh, Aoife, Róisín, Cillian, Fionn, Clodagh, Éabha, Rónán, Darragh, Siobhán, Aisling, Pádraig, Cathal, Bríd, Gráinne, Eoin, Dara, Orla, Ailbhe, Méabh, Sadhbh, etc.) and anglicised names of Irish origin (Kevin, Brendan, Ryan, Kennedy, Shannon, Kerry, Brian, Rory, Keira, Maeve, Riley, Kelly, Bridget, Declan, Colm, etc.). Aim for 300 or more names. Mark every name that matches, including accent-insensitive matches, with `irish: true`. Also mark every name that appears in CSO or NISRA data in a recognisably Irish-language form, using fadas or common Irish spelling patterns such as `bh`, `dh`, `mh`, `aoi`, `ío`. Flag uncertain cases in a comment rather than guessing.
7. **Unisex names** appear in both files, each with its own popularity. That's expected.

### Output format (compact)
```json
{
  "version": "2026-10",
  "sources": ["ONS 2020–2024", "NRS ...", "NISRA ...", "CSO ..."],
  "names": [
    ["Oisín", 1234, 87, 1, ["Oisin"]],
    ["Jack", 56789, 1, 0]
  ]
}
```
Each tuple is `[displayName, totalCount, rank, irishFlag(0/1), variants?]`, sorted by rank. Aim for each file to be under about 400 KB, and gzipped size much smaller.

## App flow

### 1. Welcome / setup
- Big friendly title and a one-line explanation.
- Choose **Boys / Girls / Both**.
- Optional filters:
  - **Irish names only** toggle
  - **Popularity**: All / Top 500 / Top 100 / Hidden gems (outside the top 500)
  - **Starting letter** (optional multi-select)
- A **Start swiping** button.
- If saved progress exists, show **Continue** prominently, along with a progress summary.

### 2. Swipe round (elimination)
- One large name card in the centre, showing:
  - the name in large type
  - a small Irish badge (e.g. ☘️) if it's tagged Irish
  - a popularity hint, e.g. "#12 in UK & Ireland" or "Rare"
  - variants shown in small text ("also: Oisin")
- Gestures (pointer events, which handle both touch and mouse):
  - **Swipe left** = No (eliminate)
  - **Swipe right** = Like
  - **Swipe up** = Love (super-like) with a small confetti burst
- Large tap buttons beneath the card for the same three actions: ✕ / ♥ / ★.
- **Undo** button that steps back through the history of decisions.
- Keyboard: ← / → / ↑, and Z for undo.
- The card tilts as it's dragged, with a green "LIKE" or red "NOPE" stamp fading in. Above a distance or speed threshold the card flies off; below it, the card springs back.
- Order: shuffled with a weighting towards popular names so the first cards feel familiar, while still mixing in rarer ones. Never show a name twice. Remember position across sessions.
- Progress indicator: "142 seen · 23 liked · 4 loved".
- Users can switch to the ranking round at any time once they have at least 4 liked or loved names.

### 3. This-or-that round (ranking)
- Two liked or loved names side by side (stacked on narrow screens). Tap the one you prefer.
- **Elo rating:**
  - Start at 1500 (Liked) or 1600 (Loved).
  - K = 32, dropping to 16 once a name has 10 or more comparisons.
- **Pair selection:**
  - Prefer names with the fewest comparisons.
  - Pair names with similar ratings.
  - Never repeat the previous pair.
  - Occasionally include a top name to test it.
- A "Can't decide" or skip option that records no result.
- A "Remove this one" option on each card that moves the name to eliminated.
- After about 20 comparisons, show a hint suggesting the user check their top 10.

### 4. Results / my list
- Ranked list showing position, name, rating bar and Irish badge.
- Tabs: **Ranked** · **Loved** · **Liked** · **Eliminated**. From Eliminated, a name can be restored to Liked.
- **Share my list** (see partner matching below).
- **Reset**, with a confirmation step, for the current sex or for everything.

### 5. Partner matching (no server)
- **Share my list** creates a URL with the person's liked and loved names encoded in the hash, e.g. `#share=<data>`.
  - Encoding: use each name's index in the JSON list together with the data `version`, then compress (base64url of a compact bitset or a list of index deltas). The URL must stay under about 2,000 characters for typical lists.
  - Use the Web Share API where available; otherwise copy the link to the clipboard.
- When someone opens a share link:
  - Show "**Liam's list**" (with an optional nickname set in settings).
  - Show **Matches**: names both people liked or loved, sorted with Loved/Loved first, then by combined rating.
  - Offer "Swipe these names too" to add the sharer's names to the front of the viewer's queue.
- This is all done in the browser. Nothing is uploaded anywhere.

## Persistence (localStorage)
- Key `bn:v1:state` holds JSON containing:
  - settings
  - per-sex decisions `{ nameKey: 'no'|'like'|'love' }`
  - Elo ratings and comparison counts
  - queue position and seed
  - undo history (cap at about 200)
- Use the grouping key (diacritic-stripped, lowercased) as `nameKey` so that saved data survives data rebuilds.
- Add a version number and a migration hook.
- Settings should include **Export / Import backup** (download or upload a JSON file) so users can move to a new phone.

## Look and feel
- Fun, warm and calm, not childish. Use a soft pastel palette with one confident accent colour. Avoid the cliché of all-pink and all-blue. Use gentle tints only to tell boys' and girls' screens apart.
- Rounded friendly display font for names (e.g. a Google Font such as "Fraunces" or "Nunito"; choose one) and a clean sans-serif for the interface.
- Large tap targets (at least 48px). Card shadow, subtle animations and a small celebration for "Love". Respect `prefers-reduced-motion`.
- Support dark mode via `prefers-color-scheme`.
- Accessibility: buttons are always available as an alternative to swiping, good contrast, ARIA labels on icon buttons, and a live region announcing decisions to screen readers.
- No ads, no tracking, no cookies banner needed.
- Footer: source attribution ("Contains public sector information licensed under the Open Government Licence v3.0" for ONS, NRS and NISRA, plus CC BY 4.0 credit for CSO Ireland). Also a one-line privacy note: "Your choices are saved only on this device."

## File structure
```
index.html
css/styles.css
js/app.js          # routing between screens, state
js/swipe.js        # gesture handling
js/elo.js          # rating + pairing
js/share.js        # encode/decode share links
js/storage.js      # localStorage wrapper, export/import
data/boys.json
data/girls.json
manifest.webmanifest
sw.js
icons/             # 192, 512, maskable, apple-touch-icon
scripts/build-names.py
data-src/irish-names.txt
README.md
.nojekyll
```
Add `.nojekyll` so GitHub Pages serves every file as-is.

## Acceptance criteria
- [ ] Loads at the live URL on iPhone Safari and Android Chrome. All paths work under the `/nameblocks/` subpath.
- [ ] Swiping works smoothly with touch, mouse and keyboard. Buttons work as alternatives.
- [ ] Undo restores the previous card and its decision.
- [ ] Closing and reopening the browser keeps all progress.
- [ ] Irish-only filter shows a good set of Irish names (sanity check: Saoirse, Tadhg, Caoimhe, Oisín, Fiadh and Cillian are all present and tagged).
- [ ] Oisín and Oisin appear as one card; Aoife and Eva stay separate.
- [ ] This-or-that produces a stable top 10 after about 30 comparisons.
- [ ] A share link opened in a private window shows the sharer's list and the correct matches with the viewer's own likes.
- [ ] Export, then reset, then import restores everything.
- [ ] Works offline after the first visit (PWA).
- [ ] Lighthouse mobile scores of 90 or above for Performance, Accessibility and Best Practices.

## Working approach
1. Clone the repo. Create the data pipeline first and report name counts per sex, the Irish-tagged count, and a sample of 20 Irish-tagged names for review.
2. Build the swipe round end to end with persistence, then push so the user can test on their phone early.
3. Add this-or-that, results, partner sharing, PWA and polish, pushing after each step.
4. Keep commits small with clear messages. Update the README with how to rebuild the data.

## Out of scope (for now)
- Accounts, a backend, or real-time syncing between partners. If wanted later, consider the free tier of Supabase.
- Name meanings and pronunciations. Possible later feature: add optional `meaning` and `say` fields for Irish names, e.g. Tadhg — "TYG", Caoimhe — "KEE-va".
