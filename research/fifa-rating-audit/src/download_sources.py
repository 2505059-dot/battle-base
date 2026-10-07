from __future__ import annotations
import csv, hashlib, json, pathlib, sys, time, urllib.request, urllib.error

ROOT = pathlib.Path(__file__).resolve().parents[2]
CACHE = ROOT / "cache" / "fifa-rating-audit"
CACHE.mkdir(parents=True, exist_ok=True)
SOURCES = [
    {
        "name": "lbenz730/fifa_model player_stats.csv",
        "file": "lbenz_fifa05_20_player_stats.csv",
        "url": "https://raw.githubusercontent.com/lbenz730/fifa_model/master/player_stats.csv",
        "coverage": "FIFA05-FIFA20",
        "type": "community mirror of FIFAIndex data",
        "license": "No dataset license identified; redistribution permission unresolved. Cache only.",
    }
]
SOURCES += [
    {
        "name": f"mzafram2001/ea-fc {edition} dataset",
        "file": f"mzafram_{edition}.csv",
        "url": f"https://raw.githubusercontent.com/mzafram2001/ea-fc/main/data/{filename}",
        "coverage": edition,
        "type": "SoFIFA-derived community dataset",
        "license": "Repository code is MIT; dataset rights/redistribution permission unresolved. Cache only.",
    }
    for edition, filename in (
        [(f"FIFA{y:02d}", f"dataset_fifa_{y:02d}.csv") for y in range(7, 24)]
        + [(f"FC{y}", f"dataset_ea_fc_{y}.csv") for y in range(24, 27)]
    )
]
manifest = []
for i, src in enumerate(SOURCES, 1):
    path = CACHE / src["file"]
    if not path.exists() or path.stat().st_size == 0:
        req = urllib.request.Request(src["url"], headers={"User-Agent": "BattleBase-Historical-Rating-Audit/1.0"})
        tmp = path.with_suffix(path.suffix + ".part")
        try:
            with urllib.request.urlopen(req, timeout=90) as response, tmp.open("wb") as out:
                while True:
                    chunk = response.read(1024 * 1024)
                    if not chunk:
                        break
                    out.write(chunk)
            tmp.replace(path)
            status = "downloaded"
        except Exception as exc:
            try:
                tmp.unlink(missing_ok=True)
            except Exception:
                pass
            manifest.append({**src, "status": "unavailable", "error": f"{type(exc).__name__}: {exc}"})
            print(f"[{i}/{len(SOURCES)}] unavailable {src['file']}: {type(exc).__name__}: {exc}", flush=True)
            continue
    else:
        status = "reused"
    digest = hashlib.sha256()
    size = 0
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            size += len(chunk)
            digest.update(chunk)
    header = []
    rows = 0
    try:
        with path.open("r", encoding="utf-8-sig", newline="", errors="replace") as stream:
            reader = csv.reader(stream)
            header = next(reader, [])
            rows = sum(1 for _ in reader)
    except Exception as exc:
        manifest.append({**src, "status": "unreadable", "size_bytes": size, "sha256": digest.hexdigest(), "error": str(exc)})
        print(f"[{i}/{len(SOURCES)}] unreadable {src['file']}", flush=True)
        continue
    manifest.append({**src, "status": status, "size_bytes": size, "sha256": digest.hexdigest(), "row_count": rows, "column_count": len(header), "columns": header})
    print(f"[{i}/{len(SOURCES)}] {status} {src['file']} bytes={size} rows={rows} cols={len(header)} sha256={digest.hexdigest()}", flush=True)
    time.sleep(0.1)
(CACHE / "downloads.json").write_text(json.dumps(manifest, indent=2, ensure_ascii=False), encoding="utf-8")
print(f"MANIFEST={CACHE / 'downloads.json'} sources={len(manifest)} available={sum(x.get('status') in ('downloaded','reused') for x in manifest)}", flush=True)
