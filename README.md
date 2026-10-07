# Baby Name Swiper

Swipe through UK and Irish baby names, then rank your favourites head to head.
Static site (plain HTML, CSS and JavaScript), hosted on GitHub Pages. Everything
is saved in your own browser; nothing is uploaded.

Live: https://liam223.github.io/babynames.github.io/

## Run locally

```
python scripts/serve.py        # http://localhost:8080
```

## Rebuilding the name data

The app reads `data/boys.json` and `data/girls.json`, generated from official
statistics. You only need to rebuild when new years are published.

```
pip install openpyxl
python scripts/fetch-data.py   # downloads raw files into data-src/ (git-ignored, ~100 MB)
python scripts/build-names.py  # writes data/*.json and data-src/irish-review.txt
```

- Sources: ONS (England and Wales), NRS (Scotland), NISRA (Northern Ireland), CSO (Republic of Ireland).
- Last five years of each source (`YEARS` in `build-names.py`), counts summed, accent-only spelling variants grouped into one card.
- Each name also carries per-year counts (for the trend) and per-country counts and ranks (England & Wales, Scotland, Northern Ireland, Republic of Ireland).
- Names with fewer than 15 combined births are dropped (`MIN_TOTAL`); names on the curated Irish list keep a lower floor (`IRISH_MIN_TOTAL`).
- Irish tagging: `data-src/irish-names.txt` (one name per line, accent-insensitive; `# ?` marks uncertain names, which are not tagged), plus a pattern heuristic for Irish-language spellings found in the CSO data. `data-src/irish-review.txt` lists what the heuristic tagged and which uncertain names were left out.
- When a new year is published, update the URLs in `fetch-data.py` and `YEARS`/`VERSION` in `build-names.py`.

## Licences

Fonts: Fraunces (SIL Open Font License 1.1), self-hosted subsets in `fonts/`.

Contains public sector information licensed under the Open Government Licence v3.0
(ONS, National Records of Scotland, NISRA). Irish data from the CSO, licensed under CC BY 4.0.
