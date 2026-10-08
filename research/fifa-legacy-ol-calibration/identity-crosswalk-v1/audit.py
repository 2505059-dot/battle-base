#!/usr/bin/env python3
"""Offline Identity Crosswalk v1 audit; reads committed evidence and this package only."""
from __future__ import annotations

import argparse
import csv
import json
import os
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
WORK = ROOT / "research" / "fifa-legacy-ol-calibration"
PACKAGE = Path(__file__).resolve().parent


def load(path: Path):
    return json.loads(path.read_text(encoding="utf-8-sig"))


def atomic_text(path: Path, text: str) -> None:
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_text(text, encoding="utf-8", newline="\n")
    if tmp.read_text(encoding="utf-8") != text:
        raise ValueError(f"Read-back mismatch: {path}")
    os.replace(tmp, path)


def atomic_json(path: Path, obj) -> None:
    text = json.dumps(obj, ensure_ascii=False, indent=2, sort_keys=True) + "\n"
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_text(text, encoding="utf-8", newline="\n")
    if load(tmp) != obj:
        raise ValueError(f"JSON read-back mismatch: {path}")
    os.replace(tmp, path)


def parts(value):
    return [x for x in (value or "").split(";") if x]


def full_record(row):
    count = int(row.get("attribute_field_count") or 0)
    available = int(row.get("attribute_available_field_count") or 0)
    return count > 0 and available >= count and row.get("full_edition_detail_available", True)


def edition_year(value):
    try:
        return 2000 + int(str(value).split()[-1])
    except (ValueError, IndexError):
        return None


def time_bin(gap):
    if gap is None:
        return "unavailable"
    if gap == 0:
        return "same_year_0"
    if gap <= 2:
        return "near_1_2"
    if gap <= 4:
        return "mid_3_4"
    return "far_5_plus"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.parse_args()
    cohort = load(WORK / "cohort.json")
    evidence = load(WORK / "evidence.json")
    mapping = load(PACKAGE / "mapping.json")
    attributes = load(PACKAGE / "source-attributes.json")
    with (WORK / "coverage.csv").open(encoding="utf-8-sig", newline="") as stream:
        old = {r["playerSeasonId"]: r for r in csv.DictReader(stream)}

    groups = {g["canonical_player_id"]: g for g in mapping["fresh_mappings"]}
    fresh_records = defaultdict(list)
    inherited_records = defaultdict(list)
    availability = defaultdict(list)
    for row in attributes["records"]:
        fresh_records[row["canonical_player_id"]].append(row)
    for row in evidence["fifaindex_records"]:
        inherited_records[row["canonical_player_id"]].append(row)
    for row in attributes["candidate_availability"]:
        availability[(row["canonical_player_id"], row["fifaindex_id"])].append(row)

    rows = []
    for player in cohort["rows"]:
        cid = player["canonicalPlayerId"]
        group = groups.get(cid)
        previous = old.get(player["playerSeasonId"], {})
        fresh_id = group.get("selected_fresh_fifaindex_id") if group else None
        candidates = fresh_records[cid] if fresh_id else inherited_records[cid]
        full = sorted(
            (r for r in candidates if full_record(r)),
            key=lambda r: int(r.get("edition_code") or r.get("game_version", "FIFA 99").split()[-1]),
        )
        selected = full[0] if full else None

        if fresh_id:
            identity = (
                "fresh_page_confirmed_partial_group"
                if group["group_status"] == "partial_disambiguation"
                else "fresh_page_confirmed"
            )
            mapped_id = fresh_id
        elif inherited_records[cid]:
            identity = "inherited_v1_not_reverified"
            mapped_id = str(inherited_records[cid][0]["source_player_id"])
        elif group and group["group_status"] in {"unresolved", "unresolved_after_rejected_candidate"}:
            identity = "unresolved_or_rejected_candidate"
            mapped_id = ""
        elif group:
            identity = "unresolved_candidate_group"
            mapped_id = ""
        else:
            identity = "no_fifaindex_candidate_or_baseline"
            mapped_id = ""

        candidate_ids = parts(previous.get("fifaindexCandidateIdsUnverified"))
        unverified_potential = False
        if not fresh_id and not inherited_records[cid]:
            adjudications = {x["fifaindex_id"]: x for x in (group or {}).get("candidate_ids", [])}
            for pid in candidate_ids:
                decision = adjudications.get(pid)
                if decision and decision["identity_status"] not in {
                    "rejected_wrong_namesake",
                    "fresh_page_confirmed",
                    "fresh_page_confirmed_selected_id",
                }:
                    if any(x["full_edition_detail_available"] for x in availability.get((cid, pid), [])):
                        unverified_potential = True

        target_year = int(player["targetSeasonYear"])
        source_year = edition_year(selected.get("game_version")) if selected else None
        gap = source_year - target_year if source_year is not None else None
        fut_full = sum(int(previous.get(k) or 0) for k in ("futFull29AttributeRecords", "futPhaseUnknownFullRecords"))
        ol_full = int(previous.get("olFullProfileBaseUnverifiedCount") or 0)
        rows.append(
            {
                "playerSeasonId": player["playerSeasonId"],
                "canonicalPlayerId": cid,
                "canonicalName": player["canonicalName"],
                "teamSeasonId": player["teamSeasonId"],
                "targetSeasonYear": target_year,
                "teamPositions": ";".join(player.get("teamPositions") or []),
                "oldV1CoverageClass": previous.get("primaryCoverageClass", ""),
                "identityConfirmationStatus": identity,
                "mappedFifaIndexId": mapped_id,
                "freshFifaIndexId": fresh_id or "",
                "fifaIndexFullDetailAvailable": bool(selected),
                "fifaIndexCompleteRecordCount": len(full),
                "fifaIndexRecordIds": ";".join(r.get("record_id", "") for r in full),
                "selectedFifaIndexEdition": selected.get("game_version", "") if selected else "",
                "selectedFifaIndexSourceUrl": selected.get("source_url", "") if selected else "",
                "rawAttributeFieldCount": selected.get("attribute_field_count", "") if selected else "",
                "rawAttributeAvailableFieldCount": selected.get("attribute_available_field_count", "") if selected else "",
                "nominalEditionYear": source_year if source_year is not None else "",
                "nominalEditionGapYears": gap if gap is not None else "",
                "nominalTimeBin": time_bin(gap),
                "oldCandidateRowConvertedToReliableFifa": bool(
                    previous.get("primaryCoverageClass") == "identity_candidate_unverified" and fresh_id and selected
                ),
                "unverifiedCandidateRawProfilePotential": unverified_potential,
                "unverifiedCandidateIds": ";".join(candidate_ids),
                "priorFutFullRecords": fut_full,
                "priorOlFullProfileRecords": ol_full,
            }
        )

    if len(rows) != 99 or len({r["canonicalPlayerId"] for r in rows}) != 95:
        raise ValueError("Unexpected cohort cardinality")
    fresh = [r for r in rows if r["identityConfirmationStatus"].startswith("fresh_page_confirmed")]
    inherited = [r for r in rows if r["identityConfirmationStatus"] == "inherited_v1_not_reverified"]
    full_rows = [r for r in rows if r["fifaIndexFullDetailAvailable"]]
    prior_65 = [r for r in rows if r["oldV1CoverageClass"] == "identity_candidate_unverified"]
    converted = [r for r in prior_65 if r["oldCandidateRowConvertedToReliableFifa"]]
    bins = Counter(r["nominalTimeBin"] for r in rows)

    unresolved_single = []
    unresolved_alternatives = []
    for group in mapping["fresh_mappings"]:
        for candidate in group["candidate_ids"]:
            status = candidate["identity_status"]
            if status in {"unresolved_page_inaccessible", "unresolved_insufficient_corroboration"}:
                unresolved_single.append(
                    {
                        "canonical_player_id": group["canonical_player_id"],
                        "fifaindex_id": candidate["fifaindex_id"],
                        "reason": candidate["identity_observation"].get("decision_note"),
                    }
                )
            elif status == "unresolved_alternative_not_read":
                unresolved_alternatives.append(
                    {
                        "canonical_player_id": group["canonical_player_id"],
                        "fifaindex_id": candidate["fifaindex_id"],
                        "candidate_editions": candidate["candidate_editions"],
                    }
                )

    teams = defaultdict(list)
    for row in rows:
        teams[row["teamSeasonId"]].append(row)
    per_team = {}
    for team, team_rows in sorted(teams.items()):
        per_team[team] = {
            "playerSeasonRows": len(team_rows),
            "fifaIndexFullDetailRows": sum(r["fifaIndexFullDetailAvailable"] for r in team_rows),
            "freshIdentityRows": sum(r["identityConfirmationStatus"].startswith("fresh_page_confirmed") for r in team_rows),
            "inheritedV1IdentityRows": sum(r["identityConfirmationStatus"] == "inherited_v1_not_reverified" for r in team_rows),
            "unresolvedIdentityRows": sum("unresolved" in r["identityConfirmationStatus"] for r in team_rows),
            "nominalTimeBins": dict(Counter(r["nominalTimeBin"] for r in team_rows)),
        }

    summary = {
        "schema_version": "identity-crosswalk-v1",
        "cohort": {"playerSeasonRows": 99, "uniqueCanonicalPlayers": 95, "teamSeasonCount": len(teams)},
        "identity_confirmation": {
            "freshPageConfirmedUniquePlayers": mapping["counts"]["fresh_selected_ids"],
            "freshPageConfirmedPlayerSeasonRows": len(fresh),
            "inheritedV1NotReverifiedUniquePlayers": len(mapping["inherited_v1_baseline_mappings"]),
            "inheritedV1NotReverifiedPlayerSeasonRows": len(inherited),
            "combinedExplicitMappingPlayerSeasonRows": len(fresh) + len(inherited),
            "combinedExplicitMappingRatePercent": round(100 * (len(fresh) + len(inherited)) / 99, 1),
            "unresolvedSingleGroups": unresolved_single,
            "rejectedSingleCandidateGroups": mapping["counts"].get("rejected_single_candidates", 0),
            "unresolvedAlternativeIds": unresolved_alternatives,
            "partialMultiIdGroups": mapping["counts"]["partial_multigroups"],
        },
        "raw_attribute_coverage": {
            "fifaIndexFullDetailRows": len(full_rows),
            "denominator": 99,
            "ratePercent": round(100 * len(full_rows) / 99, 1),
            "uniqueCanonicalPlayersWithFullDetails": len({r["canonicalPlayerId"] for r in full_rows}),
            "unverifiedCandidateRawProfilePotentialRows": sum(r["unverifiedCandidateRawProfilePotential"] for r in rows),
            "priorFutFullRecordRows": sum(r["priorFutFullRecords"] > 0 for r in rows),
            "priorOlFullProfileRows": sum(r["priorOlFullProfileRecords"] > 0 for r in rows),
            "meaning": "Direct original FIFAIndex-attributed CSV values under a fresh page-supported ID or inherited v1 mapping. Unresolved/rejected candidate rows never count as confirmed attributes.",
        },
        "old65_candidate_conversion": {
            "oldIdentityCandidateRows": len(prior_65),
            "convertedToReliableFifaRowsWithoutNewDatabaseDownload": len(converted),
            "convertedUniquePlayers": len({r["canonicalPlayerId"] for r in converted}),
            "remainingRows": len(prior_65) - len(converted),
            "remainingUniquePlayers": len({r["canonicalPlayerId"] for r in prior_65 if not r["oldCandidateRowConvertedToReliableFifa"]}),
            "unverifiedCandidateRawProfilePotentialRowsAmongOld65": sum(r["unverifiedCandidateRawProfilePotential"] for r in prior_65),
        },
        "nominal_edition_time_closeness": {
            "bins": dict(bins),
            "definition": "Earliest complete FIFA 05/06/07 record retained for the identity in this package (fresh mapping) or v1 evidence (inherited mapping); inherited mappings are not refreshed from the pinned CSV, so this is not a cache-wide earliest-edition scan. Edition year minus targetSeasonYear is nominal, not the exact source snapshot date.",
        },
        "per_team": per_team,
        "source_cache": attributes["source_cache"],
        "research_scope": "No new data source or download; no roster-membership research; no runtime/list/identity-index/ability-v2 changes.",
    }
    buffer = []
    import io
    stream = io.StringIO(newline="")
    writer = csv.DictWriter(stream, fieldnames=list(rows[0]), lineterminator="\n")
    writer.writeheader()
    writer.writerows(rows)
    atomic_text(PACKAGE / "coverage.csv", stream.getvalue())
    atomic_json(PACKAGE / "summary.json", summary)
    print(json.dumps({
        "playerSeasonRows": len(rows),
        "freshUniquePlayers": mapping["counts"]["fresh_selected_ids"],
        "freshRows": len(fresh),
        "inheritedRows": len(inherited),
        "fullRawAttributeRows": len(full_rows),
        "oldCandidateRows": len(prior_65),
        "convertedOldCandidateRows": len(converted),
        "remainingOldCandidateRows": len(prior_65) - len(converted),
        "timeBins": dict(bins),
    }, ensure_ascii=False))


if __name__ == "__main__":
    main()
