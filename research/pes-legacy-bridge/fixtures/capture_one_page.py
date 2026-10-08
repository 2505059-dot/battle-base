import hashlib, json, re, time
from datetime import datetime, timezone
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse
from urllib.request import Request, urlopen

root=Path(__file__).resolve().parent.parent
url='https://www.pesmaster.com/vicente/pes-5/player/4037/'
time.sleep(1.6)
request=Request(url,headers={'User-Agent':'PES-Legacy-Bridge-research/0.1'})
now=datetime.now(timezone.utc).isoformat()
try:
    with urlopen(request,timeout=20) as response:
        status=response.status
        final_url=response.geturl()
        body=response.read()
        charset=response.headers.get_content_charset() or 'utf-8'
except (HTTPError,URLError,TimeoutError) as exc:
    entry={'url':url,'status':getattr(exc,'code',None) or 'network_error','requested_at_utc':now,'purpose':'one authorized final verification GET for a small authentic parser fixture','error':str(exc)[:180]}
    c=root/'candidates.json'; data=json.loads(c.read_text(encoding='utf-8')); pol=data['request_policy']; pol['request_log'].append(entry); pol['requests_made']=len(pol['request_log']); pol['fully_logged_request_count']=len(pol['request_log']); pol['total_observed_request_count']=len(pol['request_log'])+10; pol['final_verification_request']=entry; c.write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    raise SystemExit(json.dumps(entry))
logged_at=datetime.now(timezone.utc).isoformat()
entry={'url':url,'status':status,'bytes':len(body),'requested_at_utc':logged_at,'purpose':'one authorized final verification GET for a small authentic parser fixture'}
page_hash=hashlib.sha256(body).hexdigest()
parsed_url=urlparse(final_url)
if status!=200 or parsed_url.hostname not in ('www.pesmaster.com','pesmaster.com'):
    reason='non-200 response or off-site redirect; stop without retry'
elif any(x in body.decode('utf-8',errors='replace').casefold() for x in ('captcha','verify you are human','checking your browser','attention required','security checkpoint')):
    reason='challenge marker; stop without retry'
else:
    reason=None
rawdir=root/'raw-pages'; rawdir.mkdir(exist_ok=True)
rawfile=rawdir/'vicente-full-response.tmp.html'; rawfile.write_bytes(body)
html=body.decode(charset,errors='replace')
if reason:
    excerpt=None
else:
    h1m=re.search(r'<h1\b[^>]*>[\s\S]*?</h1>',html,re.I)
    h3m=None
    for m in re.finditer(r'<h3\b[^>]*>([\s\S]*?)</h3>',html,re.I):
        title=re.sub(r'<[^>]*>',' ',m.group(1)); title=re.sub(r'\s+',' ',title).strip()
        if title.casefold()=='ability settings': h3m=m; break
    tablem=None
    if h3m:
        start=re.search(r'<table\b[^>]*>',html[h3m.end():],re.I)
        if start:
            a=h3m.end()+start.start(); end=re.search(r'</table\s*>',html[a:],re.I)
            if end: tablem=html[a:a+end.end()]
    nationality=None
    for m in re.finditer(r'<tr\b[^>]*>[\s\S]*?</tr\s*>',html,re.I):
        row=m.group(0)
        text=re.sub(r'<[^>]*>',' ',row); text=re.sub(r'\s+',' ',text).strip()
        if re.search(r'nationality',text,re.I) and re.search(r'\bSpain\b',row,re.I):
            nationality=row; break
    if nationality is None:
        for m in re.finditer(r'<tr\b[^>]*>[\s\S]*?</tr\s*>',html,re.I):
            row=m.group(0)
            if re.search(r'\bSpain\b',row,re.I) and ('flag' in row.casefold() or 'national' in row.casefold()): nationality=row; break
    if nationality is None:
        m=re.search(r'<(?:img|span|div)\b[^>]*(?:title|alt|class)=["\'][^"\']*(?:spain|flag)[^"\']*["\'][^>]*>',html,re.I)
        if m: nationality=m.group(0)
    if not (h1m and h3m and tablem and nationality):
        reason='page loaded without a reliable compact h1/nationality/ability-table excerpt; no retry'
        excerpt=None
    else:
        excerpt='<!-- Authentic excerpts from one PES Master response.\nURL: '+url+'\nRetrieved UTC: '+logged_at+'\nHTTP status: '+str(status)+'\nSHA-256 of full response bytes: '+page_hash+'\nThe header, nationality element and ability table below are exact source substrings; unrelated page markup was omitted.\nLine endings are normalized to LF; the SHA-256 above remains the digest of the original full response bytes. -->\n'+h1m.group(0)+'\n'+nationality+'\n'+h3m.group(0)+'\n'+tablem+'\n'
        if excerpt is not None:
            excerpt=excerpt.replace('\r\n','\n').replace('\r','\n')
        if excerpt is not None and len(excerpt.encode('utf-8'))>10000:
            reason='compact source excerpt exceeded 10 KB; no retry'; excerpt=None

c=root/'candidates.json'; data=json.loads(c.read_text(encoding='utf-8')); pol=data['request_policy']; pol['request_log'].append(entry); pol['requests_made']=len(pol['request_log']); pol['fully_logged_request_count']=len(pol['request_log']); pol['total_observed_request_count']=len(pol['request_log'])+10; pol['final_verification_request']={**entry,'full_response_sha256':page_hash,'excerpt_saved':bool(excerpt),'stop_reason':reason}; pol['stop_reason']='one_page_fixture_check_complete' if not reason else 'one_page_fixture_check_stopped_without_retry'; c.write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
if excerpt:
    out=root/'fixtures'/'pes5-live-vicente-excerpt.html'
    with out.open('w',encoding='utf-8',newline='\n') as stream: stream.write(excerpt)
    m=root/'source-manifest.json'; manifest=json.loads(m.read_text(encoding='utf-8')); manifest['liveParserFixture']={'sourceUrl':url,'retrievedAtUtc':logged_at,'httpStatus':status,'fullResponseSha256':page_hash,'excerptFile':'fixtures/pes5-live-vicente-excerpt.html','excerptBytes':len(excerpt.encode('utf-8')),'excerptSha256':hashlib.sha256(excerpt.encode('utf-8')).hexdigest(),'excerptLineEndingNormalization':'LF; fullResponseSha256 is over original response bytes, not this normalized excerpt','fullResponseSha256Scope':'original unmodified full response bytes','sourceFields':'PES Master heading/OVR, nationality element, Ability Settings table; exact source substrings'}; manifest['requestAccounting']={'fullyLoggedRequests':len(pol['request_log']),'unloggedInitialExploratoryRequests':10,'totalObservedRequests':len(pol['request_log'])+10}; m.write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
rawfile.unlink(missing_ok=True)
print(json.dumps({'entry':entry,'full_response_sha256':page_hash,'excerpt_bytes':len(excerpt.encode('utf-8')) if excerpt else None,'excerpt_saved':bool(excerpt),'stop_reason':reason,'raw_response_removed':not rawfile.exists()},ensure_ascii=False,indent=2))
