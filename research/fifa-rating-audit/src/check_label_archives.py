import csv,hashlib,pathlib,urllib.request,zipfile,json
root=pathlib.Path(__file__).resolve().parents[3]
cache=root/"research/cache/fifa-rating-audit"
zpath=cache/"stefanoleone_fifa23_complete.zip"
with zipfile.ZipFile(zpath) as z:
    names=z.namelist()
    print("ZIP_MEMBERS",len(names))
    print("CSV_MEMBERS",*[n for n in names if n.lower().endswith(".csv")][:40],sep="\n")
# Retry the known FC26 file through GitHub's raw redirect route.
url="https://github.com/mzafram2001/ea-fc/raw/refs/heads/main/data/dataset_ea_fc_26.csv"
dest=cache/"mzafram_FC26.csv"
try:
    req=urllib.request.Request(url,headers={"User-Agent":"BattleBase-Historical-Rating-Audit/1.0"})
    with urllib.request.urlopen(req,timeout=90) as r, dest.open("wb") as out:
        while True:
            chunk=r.read(1024*1024)
            if not chunk: break
            out.write(chunk)
    h=hashlib.sha256()
    with dest.open("rb") as f:
        for b in iter(lambda:f.read(1024*1024),b""):h.update(b)
    with dest.open("r",encoding="utf-8-sig",newline="",errors="replace") as f:
        rd=csv.reader(f); cols=next(rd,[]); rows=sum(1 for _ in rd)
    print("FC26",dest.stat().st_size,h.hexdigest(),rows,len(cols),",".join(cols)[:1000])
except Exception as e:
    print("FC26_RETRY_ERROR",type(e).__name__,str(e))
