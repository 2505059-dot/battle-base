import pathlib,zipfile,csv,io,json,urllib.request
root=pathlib.Path(__file__).resolve().parents[3]
path=root/"research/cache/fifa-rating-audit/stefanoleone_fifa23_complete.zip"
with zipfile.ZipFile(path) as z:
    for name in ("male_players.csv","male_players (legacy).csv"):
        info=z.getinfo(name)
        print("MEMBER",name,"compressed",info.compress_size,"uncompressed",info.file_size)
        with z.open(info) as raw:
            text=io.TextIOWrapper(raw,encoding="utf-8-sig",newline="")
            rd=csv.reader(text)
            hdr=next(rd,[])
            print("HEADER_COUNT",len(hdr),"POSITION_FIELDS",[x for x in hdr if x.lower() in {"ls","st","rs","lw","lf","cf","rf","rw","lam","cam","ram","lm","lcm","cm","rcm","rm","lwb","ldm","cdm","rdm","rwb","lb","lcb","cb","rcb","rb","gk"}])
            for row in (next(rd,[]) for _ in range(2)):
                if row:
                    small={hdr[i]:row[i] for i in range(min(len(hdr),len(row))) if hdr[i] in {"sofifa_id","player_id","short_name","long_name","overall","potential","fifa_version","fifa_update","club_name","player_positions","international_reputation","st"}}
                    print("SAMPLE",json.dumps(small,ensure_ascii=True))
url="https://www.kaggle.com/api/v1/datasets/download/stefanoleone992/fifa-23-complete-player-dataset/players_18.csv"
try:
    req=urllib.request.Request(url,method="HEAD",headers={"User-Agent":"BattleBase-Historical-Rating-Audit/1.0"})
    with urllib.request.urlopen(req,timeout=30) as r: print("FILE_ENDPOINT_HEAD",r.status,r.headers.get("Content-Length"),r.headers.get("Content-Type"),r.geturl())
except Exception as e: print("FILE_ENDPOINT_HEAD_ERROR",type(e).__name__,str(e))
