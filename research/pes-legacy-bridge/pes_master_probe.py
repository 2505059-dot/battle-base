#!/usr/bin/env python3
"""Rate-limited public PES Master PES 5 team/search/player-page probe.

Requests only explicit team pages and targeted name queries. Raw HTML stays in
memory. HTTP errors/challenges stop the run; there are no retries or bypasses.
"""
from __future__ import annotations
import argparse
import json
import re
import sys
import time
import unicodedata
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, urljoin, urlparse
from urllib.request import Request, urlopen

BASE = "https://www.pesmaster.com"
ABILITY_LABELS = [
    "Attack", "Defence", "Balance", "Stamina", "Top Speed", "Acceleration",
    "Reponse", "Agility", "Dribble Accuracy", "Dribble Speed",
    "Short Pass Accuracy", "Short Pass Speed", "Long Pass Accuracy",
    "Long Pass Speed", "Shot Accuracy", "Shot Power", "Shot Technique",
    "Free Kick Accuracy", "Swerve", "Heading", "Jump", "Technique",
    "Aggression", "Mentality", "Goalkeeping", "Teamwork", "Consistency", "Condition",
]
CHALLENGE_MARKERS = (
    "captcha", "verify you are human", "checking your browser",
    "attention required", "security checkpoint",
)

def clean(value):
    return re.sub(r"\s+", " ", value).strip()

def key(value):
    value = unicodedata.normalize("NFKD", value)
    value = "".join(ch for ch in value if not unicodedata.combining(ch))
    return re.sub(r"[^a-z0-9]", "", value.casefold())

def number(value):
    match = re.search(r"-?\d+", value.replace(",", ""))
    return int(match.group()) if match else None

class PESMasterParser(HTMLParser):
    def __init__(self, is_search=False):
        super().__init__(convert_charrefs=True)
        self.is_search = is_search
        self.rows = []
        self.abilities = {}
        self.h1 = ""
        self.heading = ""
        self.in_h1 = False
        self.in_h3 = False
        self.in_ability_table = False
        self.row = None
        self.cell = None
        self.link_text = None
        self.player_name = None
        self.player_href = None

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == "h1":
            self.in_h1 = True
            self.h1 = ""
        elif tag == "h3":
            self.in_h3 = True
            self.heading = ""
        elif tag == "table" and self.heading.casefold() == "ability settings":
            self.in_ability_table = True
        elif tag == "tr":
            self.row = []
            self.player_href = None
            self.link_text = None
            self.player_name = None
        elif tag == "td" and self.row is not None:
            self.cell = ""
        elif tag == "a" and self.row is not None:
            href = attrs.get("href", "")
            if re.search(r"/pes-5/player/\d+/", href):
                self.player_href = urljoin(BASE, href)
                self.link_text = ""
        elif tag == "img" and self.cell is not None:
            title = attrs.get("title") or attrs.get("alt")
            if title:
                self.cell += " " + title

    def handle_data(self, data):
        if self.in_h1:
            self.h1 += data
        if self.in_h3:
            self.heading += data
        if self.cell is not None:
            self.cell += data
        if self.link_text is not None:
            self.link_text += data

    def handle_endtag(self, tag):
        if tag == "h1":
            self.in_h1 = False
        elif tag == "h3":
            self.in_h3 = False
        elif tag == "a" and self.link_text is not None:
            self.player_name = clean(self.link_text)
            self.link_text = None
        elif tag == "td" and self.cell is not None:
            self.row.append(clean(self.cell))
            self.cell = None
        elif tag == "tr" and self.row is not None:
            cells = self.row
            if self.in_ability_table and len(cells) >= 2:
                label = cells[1]
                if label in ABILITY_LABELS:
                    self.abilities[label] = number(cells[0])
            elif self.player_href and len(cells) >= 13:
                self.rows.append(self.make_player(cells))
            self.row = None
            self.player_href = None
            self.link_text = None
            self.player_name = None
        elif tag == "table" and self.in_ability_table:
            self.in_ability_table = False

    def make_player(self, cells):
        return {
            "name": clean(self.player_name or cells[0]),
            "club": cells[1] if self.is_search else None,
            "shirt_number": None if self.is_search else number(cells[1]),
            "nationality": cells[2] or None,
            "age": number(cells[3]),
            "height_cm": number(cells[4]),
            "position": cells[5] or None,
            "displayed_ovr": number(cells[6]),
            "summary": {
                "Pas": number(cells[7]), "Sht": number(cells[8]),
                "Phy": number(cells[9]), "Def": number(cells[10]),
                "Spd": number(cells[11]), "Dri": number(cells[12]),
            },
            "player_url": self.player_href,
        }

def parse(html, is_search=False):
    parser = PESMasterParser(is_search=is_search)
    parser.feed(html)
    parser.close()
    return parser

class Requester:
    def __init__(self, max_requests, delay):
        self.max_requests = max_requests
        self.delay = delay
        self.log = []
        self.stop_reason = None
        self.last_request = None

    def get(self, url, purpose):
        if self.stop_reason:
            return None
        if len(self.log) >= self.max_requests:
            self.stop_reason = "request_budget_exhausted"
            return None
        parsed = urlparse(url)
        if parsed.scheme != "https" or parsed.hostname not in ("www.pesmaster.com", "pesmaster.com"):
            self.stop_reason = "refused_non_pesmaster_url"
            return None
        if self.last_request is not None:
            wait = self.delay - (time.monotonic() - self.last_request)
            if wait > 0:
                time.sleep(wait)
        request = Request(url, headers={"User-Agent": "PES-Legacy-Bridge-research/0.1"})
        self.last_request = time.monotonic()
        try:
            with urlopen(request, timeout=20) as response:
                if urlparse(response.geturl()).hostname not in ("www.pesmaster.com", "pesmaster.com"):
                    self.stop_reason = "redirected_off_pesmaster"
                    return None
                body = response.read()
                html = body.decode(response.headers.get_content_charset() or "utf-8", errors="replace")
                self.log.append({"url": url, "status": response.status, "bytes": len(body), "requested_at_utc": datetime.now(timezone.utc).isoformat(), "purpose": purpose})
        except (HTTPError, URLError, TimeoutError) as exc:
            status = getattr(exc, "code", None)
            self.log.append({"url": url, "status": status or "network_error", "requested_at_utc": datetime.now(timezone.utc).isoformat(), "purpose": purpose, "error": str(exc)[:180]})
            self.stop_reason = "http_or_network_error"
            return None
        if any(marker in html.casefold() for marker in CHALLENGE_MARKERS):
            self.stop_reason = "challenge_detected_stop_without_retry"
            return None
        return html

def aliases_for(name, manifest):
    return {key(name), *(key(x) for x in manifest.get("manualAliases", {}).get(name, []))}

def match_status(target_name, found_name, manifest):
    if key(target_name) == key(found_name):
        return "verified_exact_name"
    if key(found_name) in aliases_for(target_name, manifest):
        return "verified_manual_alias"
    return None

def search_term(name, manifest):
    if name in manifest.get("searchNameOverrides", {}):
        return manifest["searchNameOverrides"][name]
    words = re.findall(r"[\wÀ-ž'-]+", name, flags=re.UNICODE)
    return words[-1] if words else name

def search_url(term):
    query = urlencode({"name": term, "sort": "ovr", "sort_order": "desc"})
    return f"{BASE}/pes-5/search/search.php?{query}"

def target_key(season_id, name):
    return f"{season_id}::{name}"

def unique_by_url(candidates):
    result, seen = [], set()
    for candidate in candidates:
        url = candidate.get("player_url")
        if url and url not in seen:
            result.append(candidate)
            seen.add(url)
    return result

def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--manifest", type=Path, required=True)
    ap.add_argument("--targets", type=Path, required=True)
    ap.add_argument("--output", type=Path, required=True)
    ap.add_argument("--max-requests", type=int, default=100, help="hard stop; no retries")
    ap.add_argument("--delay", type=float, default=1.5, help="seconds between requests")
    args = ap.parse_args()
    manifest = json.loads(args.manifest.read_text(encoding="utf-8"))
    source = json.loads(args.targets.read_text(encoding="utf-8"))
    wanted = set(manifest["targetSeasonIds"])
    seasons = [s for s in source if s["id"] in wanted]
    if {s["id"] for s in seasons} != wanted:
        raise SystemExit("targetSeasonIds do not all exist in target JSON")

    requester = Requester(args.max_requests, args.delay)
    team_pages, page_by_url = [], {}
    urls = list(dict.fromkeys(manifest["teamPageUrlBySeasonId"][sid] for sid in manifest["targetSeasonIds"]))
    for url in urls:
        html = requester.get(url, "target-team roster page")
        if html is None:
            break
        page = parse(html)
        record = {"url": url, "team_label": clean(page.h1), "players": page.rows}
        team_pages.append(record)
        page_by_url[url] = record

    roster_hits = {}
    for season in seasons:
        for player in season["players"]:
            hits = []
            for page in team_pages:
                for candidate in page["players"]:
                    status = match_status(player["name"], candidate["name"], manifest)
                    if status:
                        hits.append({**candidate, "match_status": status,
                                     "team_page_url": page["url"], "team_label": page["team_label"]})
            roster_hits[target_key(season["id"], player["name"])] = unique_by_url(hits)

    pilot_ids = set(manifest["pilotSeasonIds"])
    ordered = [(s, p) for s in seasons for p in s["players"]]
    ordered.sort(key=lambda pair: (pair[0]["id"] not in pilot_ids, pair[0]["id"], pair[1]["name"]))
    search_cache = {}
    search_for_target = {}

    def search_one(season, player):
        k = target_key(season["id"], player["name"])
        term = search_term(player["name"], manifest)
        if term not in search_cache:
            html = requester.get(search_url(term), "targeted PES 5 name search")
            if html is None:
                return
            result = parse(html, is_search=True)
            search_cache[term] = result.rows
        rows = search_cache[term]
        confirmed = []
        for row in rows:
            status = match_status(player["name"], row["name"], manifest)
            if status:
                confirmed.append({**row, "match_status": status, "search_term": term})
        possible = confirmed
        if not possible and len(rows) == 1:
            possible = [{**rows[0], "match_status": "unresolved_unique_surname", "search_term": term}]
        elif not possible:
            possible = [{**r, "match_status": "unresolved_search_candidate", "search_term": term} for r in rows[:30]]
        search_for_target[k] = {
            "term": term,
            "result_count_on_page": len(rows),
            "possible_more_than_first_30": len(rows) >= 30,
            "candidates": possible,
        }

    def candidates_for(season, player):
        k = target_key(season["id"], player["name"])
        hits = roster_hits[k]
        if hits:
            return hits
        return search_for_target.get(k, {}).get("candidates", [])

    # Search the first 36 misses, then their confirmed detail pages.
    for season, player in ordered:
        if season["id"] in pilot_ids and not roster_hits[target_key(season["id"], player["name"])]:
            search_one(season, player)
            if requester.stop_reason:
                break

    detail_by_url = {}
    def fetch_details(urls_to_fetch):
        for url in urls_to_fetch:
            if requester.stop_reason:
                break
            html = requester.get(url, "linked detail page for confirmed candidate")
            if html is None:
                break
            page = parse(html)
            heading = clean(page.h1)
            rating = re.match(r"#?\s*(\d{1,3})\s+(.+)", heading)
            detail_by_url[url] = {
                "url": url, "page_heading": heading,
                "displayed_ovr": int(rating.group(1)) if rating else None,
                "raw_attributes": page.abilities,
                "complete_detail_attributes": set(page.abilities) == set(ABILITY_LABELS),
            }

    pilot_urls = []
    for season, player in ordered:
        if season["id"] in pilot_ids:
            for candidate in candidates_for(season, player):
                if candidate.get("match_status", "").startswith("verified_"):
                    pilot_urls.append(candidate["player_url"])
    fetch_details(list(dict.fromkeys(pilot_urls)))

    # Expand to all remaining early-99 records, respecting the same hard cap.
    for season, player in ordered:
        if season["id"] not in pilot_ids and not roster_hits[target_key(season["id"], player["name"])]:
            search_one(season, player)
            if requester.stop_reason:
                break

    # Spend any remaining request budget on other unique matched detail pages.
    all_detail_urls = []
    for season, player in ordered:
        for candidate in candidates_for(season, player):
            if candidate.get("match_status", "").startswith("verified_"):
                all_detail_urls.append(candidate["player_url"])
    fetch_details([u for u in dict.fromkeys(all_detail_urls) if u not in detail_by_url])

    output_seasons = []
    for season in seasons:
        output_players = []
        for player in season["players"]:
            k = target_key(season["id"], player["name"])
            candidates = candidates_for(season, player)
            verified = [c for c in candidates if c.get("match_status", "").startswith("verified_")]
            if verified:
                status = "verified_pes5_record"
            elif candidates:
                status = "identity_unresolved"
            elif k in search_for_target:
                status = "no_candidate_in_targeted_name_search"
            else:
                status = "not_searched_or_budget_stopped"
            output_players.append({
                "target_player_name": player["name"],
                "target_positions": player.get("positions", []),
                "identity_status": status,
                "search": search_for_target.get(k),
                "candidates": [{**c, "identity_confidence": ("high" if c.get("match_status") == "verified_exact_name" else "medium" if c.get("match_status") == "verified_manual_alias" else "unresolved"), "identity_evidence": {"rule": c.get("match_status"), "candidate_name": c.get("name"), "team_label": c.get("team_label") or c.get("club"), "nationality": c.get("nationality"), "age": c.get("age"), "position": c.get("position"), "source_url": c.get("team_page_url") or c.get("player_url")}, "detail_page": detail_by_url.get(c.get("player_url"))} for c in candidates],
            })
        output_seasons.append({
            "target_season_id": season["id"], "target_club": season["club"],
            "target_year": season["year"], "players": output_players,
        })

    output = {
        "schema_version": "0.1",
        "generated_at_utc": datetime.now(timezone.utc).isoformat(),
        "source": "PES Master public PES 5 team/search/player pages",
        "request_policy": {
            "max_requests_this_run": args.max_requests, "delay_seconds": args.delay,
            "requests_made": len(requester.log), "raw_html_saved": False,
            "stop_reason": requester.stop_reason, "request_log": requester.log,
        },
        "team_pages_checked": [
            {"url": p["url"], "team_label": p["team_label"], "roster_rows": len(p["players"])}
            for p in team_pages
        ],
        "target_seasons": output_seasons,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(output, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    summary = {
        "requests_made": len(requester.log), "team_pages_checked": len(team_pages),
        "target_seasons": len(output_seasons),
        "target_players": sum(len(s["players"]) for s in output_seasons),
        "verified_records": sum(p["identity_status"] == "verified_pes5_record" for s in output_seasons for p in s["players"]),
        "identity_unresolved": sum(p["identity_status"] == "identity_unresolved" for s in output_seasons for p in s["players"]),
        "targeted_no_hit": sum(p["identity_status"] == "no_candidate_in_targeted_name_search" for s in output_seasons for p in s["players"]),
        "not_searched": sum(p["identity_status"] == "not_searched_or_budget_stopped" for s in output_seasons for p in s["players"]),
        "complete_detail_records": sum(
            bool((c.get("detail_page") or {}).get("complete_detail_attributes"))
            for s in output_seasons for p in s["players"] for c in p["candidates"]
        ),
        "stop_reason": requester.stop_reason, "output": str(args.output),
    }
    print(json.dumps(summary, ensure_ascii=False, indent=2))

if __name__ == "__main__":
    main()
