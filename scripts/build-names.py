#!/usr/bin/env python3
"""Build data/boys.json and data/girls.json from the raw files in data-src/.

Development only - not needed at runtime. Run `python scripts/fetch-data.py`
first to download the raw files, then `python scripts/build-names.py`.

Processing rules (see BRIEF.md):
  1. modern names: last 5 years of each source (YEARS), counts summed across ONS, NRS, NISRA and CSO
  2. spellings that differ only by accents/case are grouped (key = stripped, lowercased)
  3. rank within sex by combined recent count
  4. names under MIN_TOTAL recent births are dropped ...
  5. ... unless they qualify as "classic" names from the longer history (see below)
  6. Irish-origin tag from data-src/irish-names.txt plus a pattern heuristic

Classic names (HISTORY windows: ONS 1996+, NISRA 1997+, NRS 1974+, CSO 1964+) are names that fail the
recent-births rule but are kept because either
  - they are on the curated Irish list and have at least IRISH_HISTORY_MIN births across all years, or
  - they peaked by CLASSIC_PEAK_BY, have at least CLASSIC_MIN_TOTAL births across all years, and are
    rare today (under MIN_TOTAL recent births).
They are ranked after every modern name, so existing ranks never change.
"""
import csv
import json
import pathlib
import re
import unicodedata
from collections import defaultdict

import openpyxl

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ROOT / "data-src"
OUT = ROOT / "data"

YEARS = range(2021, 2026)      # recent window: drives counts, ranks, trends and country ranks
MIN_TOTAL = 15                 # minimum recent births to keep a modern name
IRISH_MIN_TOTAL = 5            # lower recent floor for names on the curated Irish list (still drops typos)
VERSION = "2026-10-2"

# Longer history used only to find "classic" names.
HISTORY = {"ONS": range(1996, 2026), "NISRA": range(1997, 2026), "NRS": range(1974, 2026), "CSO": range(1964, 2026)}
CLASSIC_PEAK_BY = 2005         # a classic must have peaked in or before this year
CLASSIC_MIN_TOTAL = 100        # ... and have at least this many births across all years
IRISH_HISTORY_MIN = 5          # curated Irish-list names qualify with this many births across all years

# An accented spelling is shown as the main card if it holds at least this share
# of the group's total. NRS, NISRA and (mostly) ONS strip accents, so accented
# forms are undercounted relative to their plain-ASCII twins.
ACCENT_SHARE = 0.15

# Irish-language letter patterns used to catch names missing from the curated list.
# Only applied to names that appear in the CSO (Republic of Ireland) data.
IRISH_PATTERN = re.compile(r"bh|dh|mh|aoi|ío|íó|ae?idh|eadh|fh")
# Names matching the pattern that are NOT Irish (reviewed by hand).
HEURISTIC_EXCLUDE = {
    "aadhya", "aadhira", "adhira", "adhvik", "adhav", "adhyan", "bhavya", "bhavika", "dhruv", "dhruva",
    "dhanvi", "dhiya", "dhyana", "mohammedhassan", "abhay", "abhinav", "abhi", "abhishek", "bhavin",
    "subhan", "shubhan", "shubh", "subhaan", "rubhan", "sobhan", "ubhaya", "madhav", "madhavi",
    "madhu", "radhika", "radhya", "sudhir", "vedhika", "vidhi", "vidhan", "vidhya", "medha", "mehdhi",
    "kadhim", "aadhav", "aadhavan", "adhrit", "dhairya", "dhaval", "dheeraj", "dhillon", "bhaskar",
    "bhargav", "bhumi", "bhuvan", "bhuvi", "rishabh", "gaurabh", "saubhagya", "prabhav", "prabhjot",
    "prabhleen", "prabh", "shobha", "subhi", "shubhi", "shubhra", "mehdi", "ahmed",
    "bodhi", "brodhi", "radha", "siddharth", "dhriti", "vedha", "aaradhya", "eilidh",
    "dhiren", "dhanyal", "dharam", "dhru", "dhiyan", "bhavik", "bhavesh", "abhiraj", "ridhwan", "siddhant",
    "siddhartha", "abhijot", "abhijeet", "bhavneet", "dhruvin", "dhyan", "mohib",
}
# Heuristic tags also need at least this share of the name's total to come from the CSO.
HEURISTIC_CSO_SHARE = 0.5
# Names with a fada (á é í ó ú) that are almost only found in the CSO data are Irish-language spellings.
FADA = re.compile("[áéíóú]")
FADA_CSO_SHARE = 0.8

NAME_OK = re.compile(r"^[^\W\d_][^\W\d_'’ \-]*(?:['’ \-][^\W\d_]+)*$", re.UNICODE)


def strip_accents(s: str) -> str:
    s = s.replace("’", "'")
    return "".join(c for c in unicodedata.normalize("NFKD", s) if not unicodedata.combining(c)).lower()


def tidy(raw) -> str | None:
    if raw is None:
        return None
    n = unicodedata.normalize("NFC", str(raw).strip())
    if len(n) < 2 or not NAME_OK.match(n):
        return None
    if n.isupper() or n.islower():
        n = re.sub(r"[^\W\d_]+", lambda m: m.group(0).capitalize(), n)
    return n


def num(v) -> int:
    try:
        return int(str(v).replace(",", "").strip())
    except (ValueError, TypeError):
        return 0     # '[x]', '-', '..' etc. (suppressed small counts)


# data[sex][name][source][year] = count   (every year each source covers, see HISTORY)
data = {sex: defaultdict(lambda: defaultdict(lambda: defaultdict(int))) for sex in ("boys", "girls")}

# Order matters: it is the order of the per-country arrays in the output.
SOURCES = ("ONS", "NRS", "NISRA", "CSO")
COUNTRIES = ["England & Wales", "Scotland", "Northern Ireland", "Republic of Ireland"]


def add(sex, raw_name, count, source, year):
    n = tidy(raw_name)
    if n and count > 0:
        data[sex][n][source][year] += count


def load_ons():
    wb = openpyxl.load_workbook(SRC / "ons-1996-2025.xlsx", read_only=True)
    for sheet, sex in (("Table_1", "girls"), ("Table_2", "boys")):
        rows = wb[sheet].iter_rows(values_only=True)
        header = None
        for r in rows:
            if header is None:
                if r and r[0] == "Name":
                    header = {str(c).strip(): i for i, c in enumerate(r) if c}
                continue
            for y in HISTORY["ONS"]:
                add(sex, r[0], num(r[header[f"{y} Count"]]), "ONS", y)


def load_nisra():
    wb = openpyxl.load_workbook(SRC / "nisra-full-1997-2025.xlsx", read_only=True)
    for sheet, sex in (("Table 1", "boys"), ("Table 2", "girls")):
        rows = list(wb[sheet].iter_rows(values_only=True))
        hi = next(i for i, r in enumerate(rows) if r and r[0] and str(r[0]).strip().endswith(" Name"))
        cols = {}
        for i, c in enumerate(rows[hi]):
            if c and str(c).strip().endswith(" Name"):
                cols[int(str(c).split()[0])] = i
        for r in rows[hi + 1:]:
            for y in HISTORY["NISRA"]:
                i = cols[y]
                add(sex, r[i], num(r[i + 1]), "NISRA", y)


def load_nrs():
    with open(SRC / "nrs-full-1974-2025.csv", encoding="utf-8-sig", newline="") as f:
        for r in csv.DictReader(f):
            if int(r["Year"]) in HISTORY["NRS"]:
                add("boys" if r["Sex"] == "Boy" else "girls", r["Name"], num(r["Number"]), "NRS", int(r["Year"]))


def load_cso():
    for code, sex in (("VSA50", "boys"), ("VSA60", "girls")):
        with open(SRC / f"cso-{code}.csv", encoding="utf-8-sig", newline="") as f:
            rd = csv.reader(f)
            next(rd)
            for r in rd:
                if r[0] == f"{code}C01" and int(r[3]) in HISTORY["CSO"] and r[7]:
                    add(sex, r[5], num(r[7]), "CSO", int(r[3]))


def load_irish_list():
    certain, uncertain = set(), set()
    for line in (SRC / "irish-names.txt").read_text(encoding="utf-8").splitlines():
        if not line.strip() or line.startswith("#"):
            continue
        name, _, comment = line.partition("#")
        (uncertain if comment.strip().startswith("?") else certain).add(strip_accents(name.strip()))
    return certain, uncertain - certain


def competition_ranks(counts):
    """{key: count} -> {key: rank}; equal counts share a rank (1, 2, 2, 4...)."""
    ordered = sorted(counts.values(), reverse=True)
    first = {}
    for i, c in enumerate(ordered):
        first.setdefault(c, i + 1)
    return {k: first[c] for k, c in counts.items()}


def build(sex, irish, uncertain, review):
    # recent = counts in YEARS only (this is what existing names are built from);
    # all = every year, used only to find classic names.
    groups = defaultdict(lambda: {"spell": defaultdict(int), "src": defaultdict(int), "yrs": defaultdict(int),
                                  "allspell": defaultdict(int), "allsrc": defaultdict(int), "allyrs": defaultdict(int)})
    for name, srcs in data[sex].items():
        g = groups[strip_accents(name)]
        for s, years in srcs.items():
            for y, c in years.items():
                g["allspell"][name] += c
                g["allsrc"][s] += c
                g["allyrs"][y] += c
                if y in YEARS:
                    g["spell"][name] += c
                    g["src"][s] += c
                    g["yrs"][y] += c

    # Per-country rank among every name that country recorded in the recent window.
    country_rank, country_size = {}, []
    for s in SOURCES:
        counts = {k: g["src"][s] for k, g in groups.items() if g["src"].get(s)}
        country_rank[s] = competition_ranks(counts)
        country_size.append(len(counts))
    year_totals = [sum(g["yrs"].get(y, 0) for g in groups.values()) for y in YEARS]

    modern, classic = [], []
    for key, g in groups.items():
        recent = sum(g["spell"].values())
        full = sum(g["allspell"].values())
        is_modern = recent >= (IRISH_MIN_TOTAL if key in irish else MIN_TOTAL)
        history = None
        if not is_modern:
            peak_year, peak_count = max(g["allyrs"].items(), key=lambda kv: (kv[1], -kv[0])) if g["allyrs"] else (0, 0)
            if key in irish and full >= IRISH_HISTORY_MIN:
                pass
            elif peak_year and peak_year <= CLASSIC_PEAK_BY and full >= CLASSIC_MIN_TOTAL and recent < MIN_TOTAL:
                pass
            else:
                continue
            history = [peak_year, peak_count, full]

        spell_counts = g["spell"] if is_modern else g["allspell"]      # spelling choice: recent for modern, all years for classics
        src_counts = g["src"] if is_modern else g["allsrc"]
        total_for_tags = recent if is_modern else full
        spells = sorted(spell_counts.items(), key=lambda kv: (-kv[1], kv[0]))
        spell_total = sum(spell_counts.values())
        accented = [kv for kv in spells if strip_accents(kv[0]) != kv[0].lower().replace("’", "'")]
        display = spells[0][0]
        if accented and accented[0][1] >= ACCENT_SHARE * spell_total:
            display = accented[0][0]
        variants = [s for s, _ in spells if s != display]

        flag = key in irish
        cso = src_counts.get("CSO", 0)
        by_pattern = cso >= HEURISTIC_CSO_SHARE * total_for_tags and IRISH_PATTERN.search(key)
        by_fada = cso >= FADA_CSO_SHARE * total_for_tags and FADA.search(display.lower())
        if not flag and (by_pattern or by_fada) and key not in HEURISTIC_EXCLUDE:
            flag = True
            review["heuristic"].append((sex, display + ("  [classic]" if history else ""), total_for_tags))
        if not flag and key in uncertain:
            review["uncertain"].append((sex, display, total_for_tags))
        yrs = [g["yrs"].get(y, 0) for y in YEARS]
        counts = [g["src"].get(s, 0) for s in SOURCES]
        ranks = [country_rank[s].get(key, 0) for s in SOURCES]
        row = (display, recent, key, int(flag), variants, yrs, counts, ranks, history, full)
        (modern if is_modern else classic).append(row)

    modern.sort(key=lambda r: (-r[1], r[2]))                 # same order as before: recent births, then key
    classic.sort(key=lambda r: (-r[9], r[2]))                # classics last, biggest history first
    names = []
    for i, (d, t, _k, f, v, y, c, r, hist, _full) in enumerate(modern + classic):
        if hist:
            # classic names carry no per-year or per-country arrays (cards show peak info instead); keeps files small
            names.append([d, t, i + 1, f, v, [], [], [], hist])      # hist = [peakYear, peakCount, totalAllYears]
        else:
            names.append([d, t, i + 1, f, v, y, c, r])
    meta = {"yearTotals": year_totals, "countrySizes": country_size, "modern": len(modern), "classic": len(classic)}
    return names, meta


def main():
    load_ons(); load_nisra(); load_nrs(); load_cso()
    irish, uncertain = load_irish_list()
    review = {"heuristic": [], "uncertain": []}
    OUT.mkdir(exist_ok=True)
    y0, y1 = YEARS[0], YEARS[-1]
    sources = [f"ONS {y0}–{y1}", f"NRS {y0}–{y1}", f"NISRA {y0}–{y1}", f"CSO {y0}–{y1}"]
    history = {s: [r[0], r[-1]] for s, r in HISTORY.items()}
    for sex in ("boys", "girls"):
        names, meta = build(sex, irish, uncertain, review)
        path = OUT / f"{sex}.json"
        # name tuple: [display, recentTotal, rank, irish(0/1), variants[], perYear[5], perCountry[4], countryRank[4]]
        #             + [peakYear, peakCount, totalAllYears] for classic (historical-only) names
        out = {"version": VERSION, "sources": sources, "history": history, "years": list(YEARS), "countries": COUNTRIES,
               **meta, "names": names}
        path.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        n_irish = sum(r[3] for r in names)
        print(f"{sex}: {len(names)} names ({meta['modern']} modern + {meta['classic']} classic), {n_irish} Irish-tagged, {path.stat().st_size // 1024} KB")
    with open(SRC / "irish-review.txt", "w", encoding="utf-8") as f:
        f.write("# Tagged Irish by pattern heuristic only (not in curated list) - please review\n")
        for sex, n, t in sorted(review["heuristic"], key=lambda r: -r[2]):
            f.write(f"{sex}\t{n}\t{t}\n")
        f.write("\n# In curated list but marked uncertain (# ?) - NOT tagged\n")
        for sex, n, t in sorted(review["uncertain"], key=lambda r: -r[2]):
            f.write(f"{sex}\t{n}\t{t}\n")


if __name__ == "__main__":
    main()
