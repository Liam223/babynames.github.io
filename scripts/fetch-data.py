#!/usr/bin/env python3
"""Download the raw name statistics into data-src/ (development only).

Sources (latest at time of writing, covering up to 2025):
  ONS   - Baby names in England and Wales, 1996 to 2025 (OGL v3)
  NRS   - Babies' first names, Scotland, 1974 to 2025 (OGL)
  NISRA - First forenames given to babies registered in NI, 1997 to 2025 (OGL)
  CSO   - Irish babies' names, VSA50 (boys) and VSA60 (girls) (CC BY 4.0)

When a new year is published, update the URLs below (find them on each
publisher's page) and the YEARS constant in build-names.py.
"""
import pathlib, sys, time, urllib.request, zipfile, io

DEST = pathlib.Path(__file__).resolve().parent.parent / "data-src"
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/124 Safari/537.36"
ONS = "https://www.ons.gov.uk/file?uri=/peoplepopulationandcommunity/birthsdeathsandmarriages/livebirths/datasets/babynamesinenglandandwalesfrom1996/1996to2025/babynames1996to2025.xlsx"
CSO = "https://ws.cso.ie/public/api.restful/PxStat.Data.Cube_API.ReadDataset/%s/CSV/1.0/en"

FILES = {
    "ons-1996-2025.xlsx": ONS,
    "nisra-full-1997-2025.xlsx": "https://www.nisra.gov.uk/files/nisra/documents/2026-04/Full_Name_List_NI_97_25.xlsx",
    "nrs-full-1974-2025.csv": ("https://www.nrscotland.gov.uk/media/0ytjopcq/all-names-given-to-babies-between-1974-to-2025.zip", "full-list-1974-2025.csv"),
    "cso-VSA50.csv": CSO % "VSA50",
    "cso-VSA60.csv": CSO % "VSA60",
}

def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=300) as r:
        return r.read()

def main():
    DEST.mkdir(exist_ok=True)
    for name, src in FILES.items():
        out = DEST / name
        if out.exists() and "--force" not in sys.argv:
            print("have", name); continue
        url, member = (src, None) if isinstance(src, str) else src
        data = get(url)
        if member:
            data = zipfile.ZipFile(io.BytesIO(data)).read(member)
        out.write_bytes(data)
        print("got ", name, len(data)); time.sleep(2)

if __name__ == "__main__":
    main()
