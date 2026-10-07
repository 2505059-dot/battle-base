from __future__ import annotations
import csv, hashlib, json, pathlib, time, urllib.request, zipfile
ROOT = pathlib.Path(__file__).resolve().parents[3]
CACHE = ROOT / "research" / "cache" / "fifa-rating-audit"
CACHE.mkdir(parents=True, exist_ok=True)
archive = CACHE / "kaggle_fifa18_demo.zip"
csv_path = CACHE / "kaggle_fifa18_CompleteDataset.csv"
url = "https://www.kaggle.com/api/v1/datasets/download/thec03u5/fifa-18-demo-player-dataset"
req = urllib.request.Request(url, headers={"User-Agent": "BattleBase-Historical-Rating-Audit/1.0"})
if not archive.exists():
    tmp = archive.with_suffix(".zip.part")
    with urllib.request.urlopen(req, timeout=120) as response, tmp.open("wb") as out:
        while True:
            chunk = response.read(1024 * 1024)
            if not chunk:
                break
            out.write(chunk)
    tmp.replace(archive)
h = hashlib.sha256()
with archive.open("rb") as f:
    for chunk in iter(lambda: f.read(1024 * 1024), b""):
        h.update(chunk)
with zipfile.ZipFile(archive) as z:
    names = z.namelist()
    candidates = [n for n in names if pathlib.PurePosixPath(n).name.lower() == "completedataset.csv"]
    if not candidates:
        raise RuntimeError(f"CompleteDataset.csv absent in archive; members={names[:20]}")
    with z.open(candidates[0]) as src, csv_path.open("wb") as out:
        while True:
            chunk = src.read(1024 * 1024)
            if not chunk:
                break
            out.write(chunk)
ch = hashlib.sha256()
with csv_path.open("rb") as f:
    for chunk in iter(lambda: f.read(1024 * 1024), b""):
        ch.update(chunk)
with csv_path.open("r", encoding="utf-8-sig", newline="", errors="replace") as f:
    reader = csv.reader(f)
    header = next(reader, [])
    rows = sum(1 for _ in reader)
meta = {
    "name": "thec03u5 FIFA 18 Demo Player Dataset CompleteDataset.csv",
    "file": csv_path.name,
    "archive_file": archive.name,
    "origin": url,
    "coverage": "FIFA18",
    "source_site": "Kaggle",
    "download_method": "Public Kaggle dataset download API; one sequential archive request",
    "source_type": "SoFIFA-derived community dataset with per-position rating labels",
    "license_redistribution": "CC BY-NC-SA 4.0 per source child; research cache only, do not redistribute full CSV",
    "license_reference": "https://creativecommons.org/licenses/by-nc-sa/4.0/",
    "archive_size_bytes": archive.stat().st_size,
    "archive_sha256": h.hexdigest(),
    "size_bytes": csv_path.stat().st_size,
    "sha256": ch.hexdigest(),
    "row_count": rows,
    "column_count": len(header),
    "columns": header,
    "verified_date": "2026-10-07",
    "reliability_notes": "Kaggle mirror; derived from SoFIFA; independently verify a sample before using as target-label evidence.",
}
(CACHE / "position_labels.json").write_text(json.dumps(meta, indent=2, ensure_ascii=False), encoding="utf-8")
print(json.dumps({k: meta[k] for k in ("name","archive_size_bytes","archive_sha256","size_bytes","sha256","row_count","column_count","columns")}, ensure_ascii=False))
