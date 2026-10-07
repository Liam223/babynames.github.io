#!/usr/bin/env python3
"""Build data/history/<sex>-<letter>.json: every name's births per year, per country, over each source's full history.

Development only. Uses the raw files in data-src/ (run fetch-data.py first) and the names in data/boys.json and
data/girls.json (run build-names.py first). No network access needed.

Each file holds the names whose key starts with that letter (non-letters go in "_"):
    { "version": "...", "names": { "<key>": [ONS, NRS, NISRA, CSO] } }
Each country entry is 0 (no births recorded) or [firstYear, [count, count, ...]]: a dense run of yearly counts from the
first year with births to the last. Missing years inside the run are 0, meaning fewer than 3 births (the sources do not
publish smaller counts). The app loads one file when a details screen opens, never at start-up.
"""
import collections
import importlib.util
import json
import pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location("build_names", ROOT / "scripts" / "build-names.py")
b = importlib.util.module_from_spec(spec)
spec.loader.exec_module(b)

OUT = ROOT / "data" / "history"


def shard_of(key):
    return key[0] if "a" <= key[:1] <= "z" else "_"


def main():
    b.load_ons(); b.load_nisra(); b.load_nrs(); b.load_cso()
    version = json.load(open(ROOT / "data" / "boys.json", encoding="utf-8"))["version"]
    OUT.mkdir(parents=True, exist_ok=True)
    for old in OUT.glob("*.json"):
        old.unlink()
    total_names = total_bytes = 0
    for sex in ("boys", "girls"):
        keys = {b.strip_accents(n[0]) for n in json.load(open(ROOT / "data" / f"{sex}.json", encoding="utf-8"))["names"]}
        per_key = collections.defaultdict(lambda: [collections.defaultdict(int) for _ in b.SOURCES])
        for name, srcs in b.data[sex].items():
            k = b.strip_accents(name)
            if k not in keys:
                continue
            for i, s in enumerate(b.SOURCES):
                for year, count in srcs.get(s, {}).items():
                    per_key[k][i][year] += count
        shards = collections.defaultdict(dict)
        for k, series in per_key.items():
            entry = []
            for yrs in series:
                if not yrs:
                    entry.append(0)
                    continue
                lo, hi = min(yrs), max(yrs)
                entry.append([lo, [yrs.get(y, 0) for y in range(lo, hi + 1)]])
            shards[shard_of(k)][k] = entry
        for letter, names in sorted(shards.items()):
            path = OUT / f"{sex}-{letter}.json"
            path.write_text(json.dumps({"version": version, "names": names}, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
            total_bytes += path.stat().st_size
            total_names += len(names)
        print(f"{sex}: {len(keys)} names in {len(shards)} files")
    print(f"wrote {len(list(OUT.glob('*.json')))} files, {total_names} names, {total_bytes / 1024 / 1024:.2f} MB")


if __name__ == "__main__":
    main()
