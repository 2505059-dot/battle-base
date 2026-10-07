from __future__ import annotations
import importlib.util, json, pathlib
ROOT = pathlib.Path(__file__).resolve().parents[3]
CACHE = ROOT / "research" / "cache" / "fifa-rating-audit"
for mod in ("numpy", "pandas", "scipy", "sklearn", "matplotlib", "PIL"):
    print("LIB", mod, bool(importlib.util.find_spec(mod)))
downloads = json.loads((CACHE / "downloads.json").read_text(encoding="utf-8"))
print("DOWNLOADS", len(downloads), sum(bool(x.get("row_count")) for x in downloads))
for x in downloads:
    print("DATASET", x["file"], x.get("row_count"), x.get("column_count"), ",".join(x.get("columns", []))[:1100])
for rel in ("data/reports/build-report.json", "data/reports/era-calibration.json", "data/entities/players.json", "data/manual/fallback-team-seasons.json"):
    obj = json.loads((ROOT / rel).read_text(encoding="utf-8"))
    print("JSON", rel, type(obj).__name__)
    if isinstance(obj, dict):
        print("KEYS", list(obj.keys())[:25])
        for k, v in obj.items():
            if isinstance(v, list):
                print("LIST", k, len(v), (list(v[0].keys())[:30] if v and isinstance(v[0], dict) else ""))
            elif isinstance(v, dict):
                print("DICT", k, len(v), list(v.keys())[:10])
    elif isinstance(obj, list):
        print("LIST", len(obj), list(obj[0].keys())[:30] if obj and isinstance(obj[0], dict) else "")
