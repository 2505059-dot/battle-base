import json,pathlib,re
root=pathlib.Path(__file__).resolve().parents[3]
rep=json.loads((root/"data/reports/build-report.json").read_text(encoding="utf-8"))
print("BUILD_SUMMARY",json.dumps(rep.get("summary"),ensure_ascii=True))
print("ATTRIBUTE_WEIGHTS",json.dumps(rep.get("attributeWeights"),ensure_ascii=True))
for p in rep.get("players",[]):
    if p.get("year")==2005 and "psv" in str(p.get("teamSeasonId","")).lower():
        print("PSV_REPORT_ROW",json.dumps(p,ensure_ascii=True))
print("SIX_CASE_COUNTS")
for club,year in [("PSV Eindhoven",2005),("AC Milan",2007),("Barcelona",2011),("Real Madrid",2017),("Bayern Munich",2020),("Manchester United",2008)]:
    rows=[p for p in rep.get("players",[]) if p.get("year")==year and (p.get("club","").lower()==club.lower() or (club=="PSV Eindhoven" and p.get("teamSeasonId","").startswith("psv-")))]
    print(club,year,len(rows),[(x.get("id"),x.get("name"),x.get("overall"),x.get("status"),x.get("provenance")) for x in rows[:2]])
era=json.loads((root/"data/reports/era-calibration.json").read_text(encoding="utf-8"))
print("CALIBRATION_MODEL_KEYS",list(era.get("calibrationModel",{})))
print("CALIBRATION_YEARS",list(era.get("calibrationModel",{}).get("years",{}))[:30])
path=root/"scripts/lib/calibrate.mjs"
for no,line in enumerate(path.read_text(encoding="utf-8").splitlines(),1):
    if re.search(r"direction|guard|sign|year.*(delta|drift)|overall.*delta|calibrat(e|ion)PlayerStats|mode",line,re.I):
        print("CALIBRATE",no,line.strip()[:240])
