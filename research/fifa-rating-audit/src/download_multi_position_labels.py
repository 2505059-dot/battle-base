from __future__ import annotations
import collections, csv, hashlib, io, json, pathlib, urllib.request, zipfile
ROOT = pathlib.Path(__file__).resolve().parents[3]
CACHE = ROOT / "research" / "cache" / "fifa-rating-audit"
CACHE.mkdir(parents=True, exist_ok=True)
slug = "stefanoleone992/fifa-23-complete-player-dataset"
api_url = f"https://www.kaggle.com/api/v1/datasets/download/{slug}"
meta_url = f"https://www.kaggle.com/api/v1/datasets/view/{slug}"
headers = {"User-Agent": "BattleBase-Historical-Rating-Audit/1.0"}
metadata = {}
try:
    with urllib.request.urlopen(urllib.request.Request(meta_url, headers=headers), timeout=30) as r:
        metadata = json.loads(r.read().decode("utf-8", "replace"))
except Exception as exc:
    metadata = {"metadata_fetch_error": f"{type(exc).__name__}: {exc}"}
zip_path = CACHE / "stefanoleone_fifa23_complete.zip"
if not zip_path.exists():
    with urllib.request.urlopen(urllib.request.Request(api_url, headers=headers), timeout=180) as r, zip_path.open("wb") as out:
        while True:
            chunk = r.read(1024 * 1024)
            if not chunk:
                break
            out.write(chunk)
hash_state = hashlib.sha256()
with zip_path.open("rb") as f:
    for chunk in iter(lambda: f.read(1024 * 1024), b""):
        hash_state.update(chunk)
source_files = []
with zipfile.ZipFile(zip_path) as z:
    matches = [i for i in z.infolist() if pathlib.PurePosixPath(i.filename).name.lower() == "male_players (legacy).csv"]
    if len(matches) != 1:
        raise RuntimeError(f"expected one legacy snapshot member, found {len(matches)}")
    info = matches[0]
    counts = collections.Counter()
    with z.open(info) as raw, io.TextIOWrapper(raw, encoding="utf-8-sig", errors="replace", newline="") as stream:
        reader = csv.DictReader(stream)
        header = reader.fieldnames or []
        for row in reader:
            version = str(row.get("fifa_version", "")).strip()
            if version in {str(y) for y in range(15, 24)}:
                counts[version] += 1
    source_files.append({"file": pathlib.PurePosixPath(info.filename).name, "archive_member": info.filename,
        "uncompressed_size_bytes": info.file_size, "row_count_by_edition": dict(sorted(counts.items())),
        "row_count": sum(counts.values()), "column_count": len(header), "columns": header,
        "extracted_to_cache": False})
result = {"name": "Stefano Leone FIFA complete player dataset", "slug": slug, "origin": api_url,
    "metadata": metadata, "archive_file": zip_path.name, "archive_size_bytes": zip_path.stat().st_size,
    "archive_sha256": hash_state.hexdigest(), "source_files": source_files,
    "read_policy": "Inspect the legacy member in-place; never extract or read the 5.64GB male_players.csv all-updates member."}
(CACHE / "stefanoleone_download.json").write_text(json.dumps(result, indent=2, ensure_ascii=False), encoding="utf-8")
print(json.dumps({"archive_size_bytes": result["archive_size_bytes"], "archive_sha256": result["archive_sha256"],
    "metadata": metadata, "files": [{k:v for k,v in x.items() if k != "columns"} for x in source_files]}, ensure_ascii=False))
print("COLUMNS", ",".join(source_files[0]["columns"]))