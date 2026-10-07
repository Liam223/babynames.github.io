#!/usr/bin/env python3
"""Build data/boys.json and data/girls.json from the raw files in data-src/.

Development only - not needed at runtime. Run `python scripts/fetch-data.py`
first to download the raw files, then `python scripts/build-names.py`.

Processing rules (see BRIEF.md):
  1. last 5 years of each source (YEARS)
  2. counts summed across ONS, NRS, NISRA and CSO
  3. spellings that differ only by accents/case are grouped (key = stripped, lowercased)
  4. rank within sex by combined count
  5. names under MIN_TOTAL combined are dropped
  6. Irish-origin tag from data-src/irish-names.txt plus a pattern heuristic
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

YEARS = range(2021, 2026)      # last 5 years available in every source
MIN_TOTAL = 15                 # minimum combined count to keep a name
IRISH_MIN_TOTAL = 5            # lower floor for names on the curated Irish list (still drops typos)
VERSION = "2026-10"
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


# data[sex][name] = {source: count}
data = {"boys": defaultdict(lambda: defaultdict(int)), "girls": defaultdict(lambda: defaultdict(int))}


def add(sex, raw_name, count, source):
    n = tidy(raw_name)
    if n and count > 0:
        data[sex][n][source] += count


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
            for y in YEARS:
                add(sex, r[0], num(r[header[f"{y} Count"]]), "ONS")


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
            for y in YEARS:
                i = cols[y]
                add(sex, r[i], num(r[i + 1]), "NISRA")


def load_nrs():
    with open(SRC / "nrs-full-1974-2025.csv", encoding="utf-8-sig", newline="") as f:
        for r in csv.DictReader(f):
            if int(r["Year"]) in YEARS:
                add("boys" if r["Sex"] == "Boy" else "girls", r["Name"], num(r["Number"]), "NRS")


def load_cso():
    for code, sex in (("VSA50", "boys"), ("VSA60", "girls")):
        with open(SRC / f"cso-{code}.csv", encoding="utf-8-sig", newline="") as f:
            rd = csv.reader(f)
            next(rd)
            for r in rd:
                if r[0] == f"{code}C01" and int(r[3]) in YEARS and r[7]:
                    add(sex, r[5], num(r[7]), "CSO")


def load_irish_list():
    certain, uncertain = set(), set()
    for line in (SRC / "irish-names.txt").read_text(encoding="utf-8").splitlines():
        if not line.strip() or line.startswith("#"):
            continue
        name, _, comment = line.partition("#")
        (uncertain if comment.strip().startswith("?") else certain).add(strip_accents(name.strip()))
    return certain, uncertain - certain


def build(sex, irish, uncertain, review):
    groups = defaultdict(lambda: {"spell": defaultdict(int), "src": defaultdict(int)})
    for name, srcs in data[sex].items():
        g = groups[strip_accents(name)]
        total = sum(srcs.values())
        g["spell"][name] += total
        for s, c in srcs.items():
            g["src"][s] += c

    rows = []
    for key, g in groups.items():
        total = sum(g["spell"].values())
        if total < (IRISH_MIN_TOTAL if key in irish else MIN_TOTAL):
            continue
        spells = sorted(g["spell"].items(), key=lambda kv: (-kv[1], kv[0]))
        accented = [kv for kv in spells if strip_accents(kv[0]) != kv[0].lower().replace("’", "'")]
        display = spells[0][0]
        if accented and accented[0][1] >= ACCENT_SHARE * total:
            display = accented[0][0]
        variants = [s for s, _ in spells if s != display]

        flag = key in irish
        cso = g["src"].get("CSO", 0)
        by_pattern = cso >= HEURISTIC_CSO_SHARE * total and IRISH_PATTERN.search(key)
        by_fada = cso >= FADA_CSO_SHARE * total and FADA.search(display.lower())
        if not flag and (by_pattern or by_fada) and key not in HEURISTIC_EXCLUDE:
            flag = True
            review["heuristic"].append((sex, display, total))
        if not flag and key in uncertain:
            review["uncertain"].append((sex, display, total))
        rows.append((display, total, key, int(flag), variants))

    rows.sort(key=lambda r: (-r[1], r[2]))
    return [[d, t, i + 1, f] + ([v] if v else []) for i, (d, t, _k, f, v) in enumerate(rows)]


def main():
    load_ons(); load_nisra(); load_nrs(); load_cso()
    irish, uncertain = load_irish_list()
    review = {"heuristic": [], "uncertain": []}
    OUT.mkdir(exist_ok=True)
    y0, y1 = YEARS[0], YEARS[-1]
    sources = [f"ONS {y0}–{y1}", f"NRS {y0}–{y1}", f"NISRA {y0}–{y1}", f"CSO {y0}–{y1}"]
    for sex in ("boys", "girls"):
        names = build(sex, irish, uncertain, review)
        path = OUT / f"{sex}.json"
        path.write_text(json.dumps({"version": VERSION, "sources": sources, "names": names},
                                   ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        n_irish = sum(r[3] for r in names)
        print(f"{sex}: {len(names)} names, {n_irish} Irish-tagged, {path.stat().st_size // 1024} KB")
    with open(SRC / "irish-review.txt", "w", encoding="utf-8") as f:
        f.write("# Tagged Irish by pattern heuristic only (not in curated list) - please review\n")
        for sex, n, t in sorted(review["heuristic"], key=lambda r: -r[2]):
            f.write(f"{sex}\t{n}\t{t}\n")
        f.write("\n# In curated list but marked uncertain (# ?) - NOT tagged\n")
        for sex, n, t in sorted(review["uncertain"], key=lambda r: -r[2]):
            f.write(f"{sex}\t{n}\t{t}\n")


if __name__ == "__main__":
    main()
