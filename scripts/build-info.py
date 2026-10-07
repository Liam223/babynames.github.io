#!/usr/bin/env python3
"""Build data/info.json: origin, meaning, pronunciation and links for names.

Development only. Reads data/boys.json and data/girls.json (run build-names.py first), then asks
Wiktionary and Wikipedia (public APIs, CC BY-SA) about the target names and writes a lazy-loaded file the
app opens only when you view a name's details.

Targets: every Irish-tagged name, plus the TOP_N most popular modern names of each sex.

What is taken from where
  Wiktionary  origin language (given-name template `from=`), IPA pronunciation, etymology (cleaned to plain text)
  Wikipedia   the opening of the "<Name> (given name)" article, where one exists
  respellings data-src/respellings.txt: hand-written, APPROXIMATE, UNVERIFIED pronunciation respellings

Usage:  python scripts/build-info.py [--limit N] [--no-wikipedia] [--names a,b,c] [--out file]
All text from Wiktionary and Wikipedia is licensed CC BY-SA 4.0; the app credits both and links to the pages.
"""
import json
import pathlib
import re
import sys
import time
import unicodedata
import urllib.parse
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
SRC = ROOT / "data-src"
UA = "Nameblocks-build/0.1 (https://github.com/Liam223/babynames.github.io)"
TOP_N = 1000                 # most popular modern names of each sex to look up (Irish-tagged names are always included)
WIKT_BATCH = 25
WIKI_BATCH = 20
PAUSE = 0.4                  # seconds between API calls
MAX_ETY = 240                # characters kept of an etymology
MAX_ABOUT = 300              # characters kept of a Wikipedia summary

LANG = {
    "ga": "Irish", "sga": "Old Irish", "mga": "Middle Irish", "pgl": "Primitive Irish", "gd": "Scottish Gaelic", "gv": "Manx",
    "cy": "Welsh", "wlm": "Middle Welsh", "owl": "Old Welsh", "br": "Breton", "kw": "Cornish", "en": "English",
    "enm": "Middle English", "ang": "Old English", "la": "Latin", "lat": "Latin", "ML.": "Medieval Latin", "LL.": "Late Latin",
    "fr": "French", "frm": "Middle French", "fro": "Old French", "xno": "Anglo-Norman", "de": "German", "nl": "Dutch",
    "non": "Old Norse", "is": "Icelandic", "sv": "Swedish", "da": "Danish", "no": "Norwegian", "he": "Hebrew", "hbo": "Biblical Hebrew",
    "grc": "Ancient Greek", "el": "Greek", "ar": "Arabic", "fa": "Persian", "hi": "Hindi", "sa": "Sanskrit", "it": "Italian",
    "es": "Spanish", "pt": "Portuguese", "ru": "Russian", "pl": "Polish", "lt": "Lithuanian", "ro": "Romanian", "tr": "Turkish",
    "gem-pro": "Proto-Germanic", "ine-pro": "Proto-Indo-European", "cel-pro": "Proto-Celtic", "ang-pro": "Proto-West Germanic",
    "gmw-pro": "Proto-West Germanic", "ofs": "Old Frisian", "goh": "Old High German", "gmh": "Middle High German",
}


def strip_accents(s):
    s = s.replace("’", "'")
    return "".join(c for c in unicodedata.normalize("NFKD", s) if not unicodedata.combining(c)).lower()


def get(url):
    for attempt in range(4):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=60) as r:
                return r.read().decode("utf-8", "replace")
        except Exception as e:                      # noqa: BLE001 - retry on any network hiccup
            if attempt == 3:
                raise
            time.sleep(2 * (attempt + 1))
    return ""


def api(host, params):
    return json.loads(get(f"https://{host}/w/api.php?" + urllib.parse.urlencode({**params, "format": "json", "formatversion": 2})))


# ---------------------------------------------------------------- targets
def load_targets(limit=None):
    targets = {}                                    # key -> {"title", "irish", "alt"}
    for sex in ("boys", "girls"):
        names = json.load(open(DATA / f"{sex}.json", encoding="utf-8"))["names"]
        for n in names:
            modern = len(n) >= 8
            if not (n[3] or (modern and n[2] <= TOP_N)):
                continue
            key = strip_accents(n[0])
            t = targets.setdefault(key, {"title": n[0], "irish": False, "alt": [v for v in n[4]]})
            t["irish"] = t["irish"] or bool(n[3])
    items = sorted(targets.items())
    return dict(items[:limit]) if limit else dict(items)


# ---------------------------------------------------------------- wikitext cleaning
def _split_args(inner):
    parts, depth, cur = [], 0, []
    i = 0
    while i < len(inner):
        two = inner[i:i + 2]
        if two in ("[[", "{{"):
            depth += 1; cur.append(two); i += 2; continue
        if two in ("]]", "}}"):
            depth -= 1; cur.append(two); i += 2; continue
        if inner[i] == "|" and depth == 0:
            parts.append("".join(cur)); cur = []
        else:
            cur.append(inner[i])
        i += 1
    parts.append("".join(cur))
    pos, named = [], {}
    for p in parts[1:]:
        m = re.match(r"^\s*([A-Za-z0-9_-]+)\s*=(.*)$", p, re.S)
        if m and not p.lstrip().startswith("["):
            named[m.group(1)] = m.group(2).strip()
        else:
            pos.append(p.strip())
    return parts[0].strip().lower(), pos, named


ODD_SCRIPTS = re.compile("[\u1680-\u169f\U00012000-\U0001254f\U00010300-\U0001032f\U00010380-\U000103df]")


def _term(text, alt, gloss, lang=None):
    t = alt or text
    if not t or t == "-" or ODD_SCRIPTS.search(t):
        return ""
    if gloss:
        t += f" (“{gloss}”)"
    return f"{lang} {t}" if lang else t


def _template(m):
    name, pos, named = _split_args(m.group(1))
    g = lambda i: pos[i] if len(pos) > i else ""
    gloss = named.get("t") or named.get("gloss") or ""
    if name in ("m", "l", "mention", "link", "m+", "l-self", "ll"):
        return _term(g(1), named.get("alt") or g(2), gloss or g(3))
    if name in ("der", "inh", "bor", "bor+", "inh+", "der+", "lbor", "slbor", "obor", "calque", "cal", "pclb", "psm", "uder", "derived", "inherited", "borrowed", "learned borrowing"):
        return _term(g(2), named.get("alt") or g(3), gloss or g(4), LANG.get(g(1), ""))
    if name in ("cog", "cognate", "noncog", "ncog"):
        return _term(g(1), named.get("alt") or g(2), gloss or g(3), LANG.get(g(0), ""))
    if name in ("w", "wikipedia", "pedia"):
        return g(1) or g(0)
    if name in ("af", "affix", "compound", "com", "suffix", "suf", "prefix", "pre", "confix", "con"):
        terms = [p for p in pos[1:] if p]
        return " + ".join(terms)
    if name == "unc":
        return "uncertain"
    if name in ("lang", "lg", "foreign", "smallcaps", "sc", "nowrap"):
        return g(1) or g(0)
    return ""                                       # ety, ref, R:..., sense, etc: dropped


def clean(text):
    text = re.sub(r"<ref[^>]*?/>|<ref[^>]*>.*?</ref>|<!--.*?-->", "", text, flags=re.S)
    prev = None
    while prev != text:
        prev = text
        text = re.sub(r"\{\{([^{}]*)\}\}", _template, text)
    text = re.sub(r"\[\[(?:[^\]|]*\|)?([^\]]*)\]\]", r"\1", text)
    text = re.sub(r"'{2,}", "", text)
    text = re.sub(r"<[^>]+>", "", text)
    text = re.sub(r"\s+", " ", text).strip()
    text = re.sub(r"\s+([,.;:)])", r"\1", text)
    text = re.sub(r"\(\s+", "(", text)
    text = re.sub(r",?\s*\b(?:from|whence|and|or|of|as|with)\s*(?=[,.;)]|$)", "", text)     # connectors left dangling
    text = re.sub(r"\s*,\s*,", ",", text)
    text = re.sub(r"\s*,\s*([.;])", r"\1", text)
    text = re.sub(r"\.{2,}", ".", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text


def shorten(text, limit):
    text = text.strip()
    if len(text) <= limit:
        return text
    cut = text[:limit]
    end = max(cut.rfind(". "), cut.rfind("; "))
    if end > limit * 0.5:
        return cut[:end + 1].rstrip(";")
    return cut.rsplit(" ", 1)[0].rstrip(",;:") + "…"


# ---------------------------------------------------------------- wiktionary
def language_sections(wt):
    parts = re.split(r"^==([^=\n][^\n]*?)==\s*$", wt, flags=re.M)
    return {parts[i].strip(): parts[i + 1] for i in range(1, len(parts) - 1, 2)}


def parse_wiktionary(wt):
    """-> {"lang": {"given": bool, "from": str, "ety": str, "ipa": [[ipa, label]]}} for languages with given-name entries."""
    out = {}
    for lang, sec in language_sections(wt).items():
        gn = re.search(r"\{\{given name\|(\w+)\|([^}]*?)\}\}", sec, re.I)
        ipa = []
        for m in re.finditer(r"\{\{IPA\|(\w+)\|([^}]*)\}\}", sec):
            args = _split_args("x|" + m.group(2))
            label = args[2].get("a", "")
            for p in args[1]:
                if re.match(r"^[/\[].+[/\]]$", p):
                    ipa.append([p, label])
        ety = ""
        em = re.search(r"===Etymology[^=\n]*===\s*(.+?)(?=\n===|\Z)", sec, re.S)
        if em:
            ety = clean(em.group(1).split("\n\n")[0])
        frm = ""
        if gn:
            fm = re.search(r"from=([^|}]+)", gn.group(2))
            if fm:
                frm = re.sub(r"\s*,\s*", ", ", fm.group(1).strip())
        out[lang] = {"given": bool(gn), "from": frm, "ety": ety, "ipa": ipa}
    return out


def fetch_wiktionary(targets):
    result = {}
    titles = {key: t["title"] for key, t in targets.items()}
    keys = list(titles)
    for i in range(0, len(keys), WIKT_BATCH):
        batch = keys[i:i + WIKT_BATCH]
        data = api("en.wiktionary.org", {"action": "query", "prop": "revisions", "rvprop": "content", "rvslots": "main",
                                         "redirects": 1, "titles": "|".join(titles[k] for k in batch)})
        by_title = {}
        for p in data.get("query", {}).get("pages", []):
            if "revisions" in p:
                by_title[p["title"]] = p["revisions"][0]["slots"]["main"]["content"]
        redirects = {r["from"]: r["to"] for r in data.get("query", {}).get("redirects", [])}
        for k in batch:
            t = titles[k]
            wt = by_title.get(redirects.get(t, t))
            if wt:
                result[k] = (redirects.get(t, t), parse_wiktionary(wt))
        print(f"  wiktionary {min(i + WIKT_BATCH, len(keys))}/{len(keys)}", end="\r")
        time.sleep(PAUSE)
    print()
    return result


# ---------------------------------------------------------------- wikipedia
NAME_WORDS = re.compile(r"\b(given name|first name|forename|masculine|feminine|unisex|male name|female name)\b", re.I)


def fetch_wikipedia(targets):
    found = {}                                      # key -> (title, text)
    pending = {k: t["title"] for k, t in targets.items()}
    for suffix in ("_(given_name)", "_(name)", ""):
        keys = [k for k in pending if k not in found]
        if not keys:
            break
        for i in range(0, len(keys), WIKI_BATCH):
            batch = keys[i:i + WIKI_BATCH]
            titles = [pending[k].replace(" ", "_") + suffix for k in batch]
            data = api("en.wikipedia.org", {"action": "query", "prop": "extracts|pageprops", "exintro": 1, "explaintext": 1,
                                            "exlimit": WIKI_BATCH, "redirects": 1, "titles": "|".join(titles)})
            q = data.get("query", {})
            norm = {n["from"]: n["to"] for n in q.get("normalized", [])}
            redir = {r["from"]: r["to"] for r in q.get("redirects", [])}
            pages = {p["title"]: p for p in q.get("pages", []) if not p.get("missing")}
            for k, raw in zip(batch, titles):
                title = norm.get(raw, raw)
                title = redir.get(title, title)
                p = pages.get(title)
                if not p or "disambiguation" in (p.get("pageprops") or {}):
                    continue
                text = re.sub(r"\s+", " ", (p.get("extract") or "")).strip()
                if text and NAME_WORDS.search(text[:260]):
                    found[k] = (title, text)
            print(f"  wikipedia pass '{suffix or 'bare'}' {min(i + WIKI_BATCH, len(keys))}/{len(keys)}", end="\r")
            time.sleep(PAUSE)
        print()
    return found


IPA_CHARS = re.compile("[ˈˌːəɪʊɛɔæʲɾˠ̪ʃʒθðŋ]")


def pronunciation_brackets(m):
    s = m.group(0)
    return "" if (IPA_CHARS.search(s) or re.search(r"[^\x00-\u024f]", s) or re.search(r"(Irish|Hebrew|Arabic|Greek|pronounced|IPA|romanized|listen)\b", s)) else s


def respellings_from(raw):
    """Wikipedia often puts a respelling in the opening brackets, e.g. '(EE-fə, Irish: [ˈiːfʲə])' -> ['EE-fuh']."""
    m = re.match(r"[^()]{0,60}?\(((?:[^()]|\([^()]*\))*)\)", raw[:200])
    out = []
    if m:
        for tok in re.split(r"[;,]| or ", m.group(1)):
            tok = tok.strip()
            if re.fullmatch(r"[A-Za-zəɪʊɛɔæ()'’\-·]+", tok) and re.search(r"[A-Z]{2,}", tok):
                tok = tok.replace("ə", "uh").replace("ɪ", "i").replace("ʊ", "u").replace("ɛ", "e").replace("ɔ", "o").replace("æ", "a")
                if tok not in out:
                    out.append(tok)
    return out[:2]


def about_text(text):
    text = re.sub(r"\((?:[^()]|\([^()]*\))*\)", pronunciation_brackets, text)
    text = re.sub(r"\b(St|Dr|Mr|Mrs|Ms|Jr|Sr)\.", r"\1", text)
    text = re.sub(r"\s+", " ", text).strip()
    sentences = re.split(r"(?<=[.!?])\s+(?=[A-Z])", text)
    out = ""
    for s in sentences[:3]:
        if len(out) + len(s) > MAX_ABOUT and out:
            break
        out = (out + " " + s).strip()
    return shorten(out, MAX_ABOUT)


# ---------------------------------------------------------------- respellings
def load_respellings():
    out = {}
    path = SRC / "respellings.txt"
    if path.exists():
        for line in path.read_text(encoding="utf-8").splitlines():
            line = line.split("#")[0].strip()
            if "=" in line:
                name, resp = line.split("=", 1)
                out[strip_accents(name.strip())] = resp.strip()
    return out


# ---------------------------------------------------------------- main
def main():
    limit = None
    if "--limit" in sys.argv:
        limit = int(sys.argv[sys.argv.index("--limit") + 1])
    targets = load_targets(limit)
    if "--names" in sys.argv:                       # testing: only these names (comma separated)
        wanted = {strip_accents(x.strip()) for x in sys.argv[sys.argv.index("--names") + 1].split(",")}
        targets = {k: v for k, v in targets.items() if k in wanted}
    print(f"{len(targets)} names to look up ({sum(1 for t in targets.values() if t['irish'])} Irish-tagged)")
    wikt = fetch_wiktionary(targets)
    wiki = {} if "--no-wikipedia" in sys.argv else fetch_wikipedia(targets)
    resp = load_respellings()

    items = {}
    for key, t in targets.items():
        item = {}
        wt = wikt.get(key)
        if wt:
            title, langs = wt
            # prefer the language the name is native to: Irish for Irish-tagged names, otherwise English
            order = (["Irish", "English"] if t["irish"] else ["English", "Irish"]) + [l for l in langs if l not in ("Irish", "English")]
            given = [l for l in order if l in langs and langs[l]["given"]]
            main_lang = given[0] if given else None
            if main_lang:
                d = langs[main_lang]
                if d["from"]:
                    item["o"] = d["from"]
                elif main_lang != "English":
                    item["o"] = main_lang
                if len(d["ety"]) >= 15 and "{{" not in d["ety"] and re.match(r"[A-ZÀ-ÿ“\"]", d["ety"]) and "(“”)" not in d["ety"]:
                    item["e"] = shorten(d["ety"], MAX_ETY)
                ipas = []
                for l in ([main_lang] + [x for x in ("English", "Irish") if x != main_lang and x in langs and langs[x]["given"]]):
                    tag = {"Irish": "Irish", "English": "English"}.get(l, l)
                    seen = {re.sub(r"[/\[\]]", "", x[0]) for x in ipas}
                    for ipa, label in langs[l]["ipa"][:3]:
                        if re.sub(r"[/\[\]]", "", ipa) in seen:
                            continue
                        seen.add(re.sub(r"[/\[\]]", "", ipa))
                        ipas.append([ipa, f"{tag}{' ' + label if label else ''}".strip()])
                        if sum(1 for x in ipas if x[1].startswith(tag)) >= 2:
                            break
                if ipas:
                    item["i"] = ipas[:3]
                item["t"] = title
        if key in wiki:
            item["w"], text = wiki[key]
            item["a"] = about_text(text)
            r = respellings_from(text)
            if r:
                item["r"] = r
        if key in resp:
            item["s"] = resp[key]
        if item:
            items[key] = item

    out = {"version": json.load(open(DATA / "boys.json", encoding="utf-8"))["version"], "items": items}
    path = pathlib.Path(sys.argv[sys.argv.index("--out") + 1]) if "--out" in sys.argv else DATA / "info.json"
    path.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    n = len(items)
    have = lambda f: sum(1 for v in items.values() if f in v)
    print(f"wrote {path.name}: {n} names | origin {have('o')} | etymology {have('e')} | IPA {have('i')} | wikipedia {have('a')} | respelling {have('s')} | {path.stat().st_size // 1024} KB")


if __name__ == "__main__":
    main()
