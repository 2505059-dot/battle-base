#!/usr/bin/env python3
"""Offline, bounded FIFA/FUT/Online legacy-rating audit for the committed 99-row cohort.

Default mode uses only embedded evidence.json + cohort.json. --refresh-cache optionally
rebuilds exact-ID and exact-name candidate samples from the pinned ignored CSV cache.
No network access, runtime-data writes, or model deployment is performed.
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import json
import math
import re
import statistics
import sys
import unicodedata
from collections import defaultdict
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
WORK = ROOT / "research" / "fifa-legacy-ol-calibration"
COHORT_PATH = WORK / "cohort.json"
EVIDENCE_PATH = WORK / "evidence.json"
COVERAGE_PATH = WORK / "coverage.csv"
RESULTS_PATH = WORK / "calibration-results.json"
CACHE_PATH = ROOT / "research" / "cache" / "fifa-rating-audit" / "lbenz_fifa05_20_player_stats.csv"
EXPECTED_BYTES = 62733624
EXPECTED_SHA256 = "90403e4a7d30e94198b4c031d805fe06f170833efcae0d738e04108bba436758"
EXTRACTED_ON = "2026-10-08"

# These are the 36 detailed numeric fields present in the source export.
FIFA_ATTRIBUTE_FIELDS = [
    "ball_control", "dribbling", "marking", "slide_tackle", "stand_tackle",
    "aggression", "reactions", "att_position", "interceptions", "vision",
    "composure", "crossing", "short_pass", "long_pass", "acceleration",
    "stamina", "strength", "balance", "sprint_speed", "agility", "jumping",
    "creativity", "heading", "shot_power", "finishing", "long_shots", "curve",
    "free_kick_accuracy", "shot_accuracy", "penalties", "gk_positioning",
    "gk_diving", "gk_handling", "gk_kicking", "gk_reflexes", "gk_rushing",
]
FUT_TO_FIFA = {
    "Acceleration": "acceleration", "Sprint Speed": "sprint_speed",
    "Att Positioning": "att_position", "Finishing": "finishing",
    "Shot Power": "shot_power", "Long Shots": "long_shots", "Penalties": "penalties",
    "Vision": "vision", "Crossing": "crossing", "FK Accuracy": "free_kick_accuracy",
    "Short Pass": "short_pass", "Long Pass": "long_pass", "Curve": "curve",
    "Agility": "agility", "Balance": "balance", "Reactions": "reactions",
    "Ball Control": "ball_control", "Dribbling": "dribbling", "Composure": "composure",
    "Interceptions": "interceptions", "Standing Tackle": "stand_tackle",
    "Sliding Tackle": "slide_tackle", "Jumping": "jumping", "Stamina": "stamina",
    "Strength": "strength", "Aggression": "aggression",
}

# Only these three explicit numeric page IDs are crosswalked manually; all other
# cohort numeric IDs come directly from the repository identity index.
MANUAL_ID_CROSSWALK = {
    "1625": "thierry-henry",
    "4000": "dennis-bergkamp",
    "1419": "patrick-vieira",
}


def read_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8-sig"))


def write_json(path: Path, value: Any) -> None:
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def norm_name(value: Any) -> str:
    text = unicodedata.normalize("NFKD", str(value or ""))
    text = "".join(ch for ch in text if not unicodedata.combining(ch)).casefold()
    return re.sub(r"[^a-z0-9]+", "", text)


def parse_number(value: Any) -> int | float | None:
    if value is None:
        return None
    text = str(value).strip()
    if not text:
        return None
    try:
        number = float(text)
    except ValueError:
        return None
    if not math.isfinite(number):
        return None
    return int(number) if number.is_integer() else number


def sha256_file(path: Path) -> tuple[int, str]:
    digest = hashlib.sha256()
    size = 0
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            size += len(block)
            digest.update(block)
    return size, digest.hexdigest()


def cohort_identity_maps(cohort: dict[str, Any]) -> tuple[dict[str, str], dict[str, set[str]]]:
    ids: dict[str, str] = {}
    for row in cohort["rows"]:
        value = row.get("fifaIndexExternalId")
        if value not in (None, ""):
            key = str(value)
            if key in ids and ids[key] != row["canonicalPlayerId"]:
                raise ValueError(f"numeric FIFAIndex ID {key} maps to multiple cohort identities")
            ids[key] = row["canonicalPlayerId"]
    ids.update(MANUAL_ID_CROSSWALK)
    names: dict[str, set[str]] = defaultdict(set)
    for row in cohort["rows"]:
        values = [row.get("canonicalName"), row.get("playerName")]
        aliases = row.get("aliases") or []
        if isinstance(aliases, list):
            for alias in aliases:
                values.append(alias.get("name") if isinstance(alias, dict) else alias)
        for value in values:
            key = norm_name(value)
            if key:
                names[key].add(row["canonicalPlayerId"])
    return ids, names


def fifa_record(raw: dict[str, str], canonical_id: str, expected_fields: set[str]) -> dict[str, Any]:
    season = str(raw.get("season", "")).zfill(2)
    source_id = str(raw.get("player_id", ""))
    attributes = {field: parse_number(raw.get(field)) for field in FIFA_ATTRIBUTE_FIELDS}
    numeric_id_kind = "manual_page_id_crosswalk" if source_id in MANUAL_ID_CROSSWALK else "repository_numeric_id"
    return {
        "record_id": f"fifaindex-{source_id}-{season}",
        "status": "observed",
        "canonical_player_id": canonical_id,
        "source": "FIFAIndex-attributed lbenz730/fifa_model export; not independently verified official EA data",
        "source_player_id": source_id,
        "identity_match": numeric_id_kind,
        "source_player_name": raw.get("name"),
        "source_url": raw.get("page_url"),
        "game_version": f"FIFA {season}",
        "edition_code": season,
        "source_record_date": "unknown; export snapshot/update vintage not exposed",
        "extracted_from_local_cache_on": EXTRACTED_ON,
        "position": raw.get("preferred_positions") or None,
        "club_position": raw.get("club_position") or None,
        "ovr": parse_number(raw.get("rating")),
        "attribute_schema": "edition-specific fields with nonzero presence in the existing schema matrix",
        "attributes_observed": attributes,
        "attribute_field_count": len(expected_fields),
        "attribute_available_field_count": sum(attributes.get(field) is not None for field in expected_fields),
        "attribute_missing_fields": sorted(field for field in expected_fields if attributes.get(field) is None),
        "non_applicable_or_not_present_fields": sorted(field for field, value in attributes.items() if value is None and field not in expected_fields),
        "source_cache_version_uncertainty": "source endpoint is mutable master; source revision and exact edition capture vintage unresolved",
    }


def rebuild_fifa_samples(cohort: dict[str, Any], evidence: dict[str, Any]) -> None:
    if not CACHE_PATH.exists():
        raise FileNotFoundError(f"requested cache refresh requires {CACHE_PATH}")
    size, digest = sha256_file(CACHE_PATH)
    if size != EXPECTED_BYTES or digest != EXPECTED_SHA256:
        raise ValueError(f"cache does not match manifest pin: bytes={size} sha256={digest}")
    ids, names = cohort_identity_maps(cohort)
    schema_path = ROOT / "research" / "fifa-rating-audit" / "outputs" / "schema-matrix.csv"
    expected_by_edition: dict[str, set[str]] = defaultdict(set)
    with schema_path.open("r", encoding="utf-8-sig", newline="") as schema_stream:
        for schema_row in csv.DictReader(schema_stream):
            if schema_row.get("source") == "lbenz FIFAIndex" and schema_row.get("edition") in {"05", "06", "07"} and schema_row.get("raw_field") in FIFA_ATTRIBUTE_FIELDS and int(schema_row.get("nonnull_count") or 0) > 0:
                expected_by_edition[schema_row["edition"]].add(schema_row["raw_field"])
    records: dict[tuple[str, str], dict[str, Any]] = {}
    candidates: dict[tuple[str, str], dict[str, Any]] = {}
    with CACHE_PATH.open("r", encoding="utf-8-sig", newline="") as stream:
        for raw in csv.DictReader(stream):
            season = str(raw.get("season", "")).zfill(2)
            if season not in {"05", "06", "07"}:
                continue
            source_id = str(raw.get("player_id", ""))
            canonical = ids.get(source_id)
            if canonical:
                key = (source_id, season)
                records[key] = fifa_record(raw, canonical, expected_by_edition[season])
                continue
            candidates_for_name = names.get(norm_name(raw.get("name")), set())
            if candidates_for_name:
                key = (source_id, season)
                candidates[key] = {
                    "record_id": f"candidate-{source_id}-{season}",
                    "candidate_canonical_ids": sorted(candidates_for_name),
                    "status": "unverified_name_candidate",
                    "source_player_name": raw.get("name"),
                    "source_player_id": source_id,
                    "source_url": raw.get("page_url"),
                    "game_version": f"FIFA {season}",
                    "position": raw.get("preferred_positions") or None,
                    "ovr": parse_number(raw.get("rating")),
                    "identity_warning": "exact normalized name only; no approved numeric-ID crosswalk; not counted as observed cohort coverage",
                }
    evidence["fifaindex_records"] = sorted(records.values(), key=lambda item: (item["canonical_player_id"], item["edition_code"], item["source_player_id"]))
    evidence["fifaindex_name_candidates"] = sorted(candidates.values(), key=lambda item: (item["source_player_name"] or "", item["game_version"], item["source_player_id"]))
    evidence["source_cache"] = {
        **evidence.get("source_cache", {}),
        "verified_bytes": size,
        "verified_sha256": digest,
        "cache_verified_on": EXTRACTED_ON,
        "filter": "FIFA 05/06/07 editions; exact numeric IDs from runtime identity index plus three explicit page-ID crosswalks; exact normalized-name candidates retained separately and not counted",
    }


def aggregate_coverage(cohort: dict[str, Any], evidence: dict[str, Any]) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    fifa_by_player: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for record in evidence.get("fifaindex_records", []):
        fifa_by_player[record["canonical_player_id"]].append(record)
    candidates_by_player: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for candidate in evidence.get("fifaindex_name_candidates", []):
        for canonical in candidate.get("candidate_canonical_ids", []):
            candidates_by_player[canonical].append(candidate)
    fut_by_player: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for record in evidence.get("fut_records", []):
        fut_by_player[record["canonical_player_id"]].append(record)
    ol_by_player: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for record in evidence.get("ol_records", []):
        ol_by_player[record["canonical_player_id"]].append(record)
    rows: list[dict[str, Any]] = []
    ol_attempts = evidence.get("ol_source_attempts", [])
    for item in cohort["rows"]:
        canonical = item["canonicalPlayerId"]
        fifa = fifa_by_player.get(canonical, [])
        fut = fut_by_player.get(canonical, [])
        ol = ol_by_player.get(canonical, [])
        candidates = candidates_by_player.get(canonical, [])
        full_fifa = [r for r in fifa if not r.get("attribute_missing_fields")]
        full_fut = [r for r in fut if r.get("detail_completeness") == "complete_29_outfield_attributes"]
        full_ol = [r for r in ol if r.get("detail_completeness") == "complete_attributes" and r.get("base_state_confirmed")]
        unverified_ol_profiles = [r for r in ol if r.get("detail_completeness") == "complete_attributes" and not r.get("base_state_confirmed")]
        partial = [r for r in fut if r not in full_fut] + [r for r in ol if r not in full_ol and r not in unverified_ol_profiles]
        if full_fifa:
            primary = "A_fifa_regular_exact_ID_full_details"
        elif full_fut:
            primary = "B_fut_full_details_phase_or_season_unvalidated"
        elif full_ol:
            primary = "C_online_only_full_details_base_state_confirmed"
        elif unverified_ol_profiles:
            primary = "D_online_full_profile_base_state_unverified"
        elif partial:
            primary = "partial_only_no_complete_source"
        elif candidates:
            primary = "identity_candidate_unverified"
        else:
            primary = "no_record_found_in_bounded_checks"
        ids = sorted({r["source_player_id"] for r in full_fifa})
        fut_phase_unknown = [r for r in full_fut if not r.get("target_season_phase_validated", False)]
        if any(a.get("canonical_player_id") == canonical and a.get("source_family") == "FIFA Online 3" for a in ol_attempts):
            ol3_full = any(r in full_ol and r.get("source_family") == "FIFA Online 3" for r in ol)
            ol3_status = "full_detail_base_state_confirmed_phase_unvalidated" if ol3_full else "attempted_no_reliable_full_record"
        else:
            ol3_status = "not_attempted"
        if any(a.get("canonical_player_id") == canonical and a.get("source_family") == "FIFA Online 4" for a in ol_attempts):
            ol4_full = any(r in full_ol and r.get("source_family") == "FIFA Online 4" for r in ol)
            ol4_unverified = any(r in unverified_ol_profiles and r.get("source_family") == "FIFA Online 4" for r in ol)
            ol4_status = "full_detail_base_state_confirmed_phase_unvalidated" if ol4_full else ("full_profile_state_unverified_excluded" if ol4_unverified else "partial_or_candidate_no_reliable_full_record")
        else:
            ol4_status = "not_attempted"
        candidate_ids = sorted({r["source_player_id"] for r in candidates})
        rows.append({
            "playerSeasonId": item["playerSeasonId"],
            "canonicalPlayerId": canonical,
            "canonicalName": item["canonicalName"],
            "teamSeasonId": item["teamSeasonId"],
            "targetSeasonYear": item["targetSeasonYear"],
            "slot": item["slot"],
            "targetPositions": ";".join(item.get("teamPositions") or []),
            "targetOvrExisting": item.get("teamOverall"),
            "primaryCoverageClass": primary,
            "fifaindexExactIds": ";".join(ids),
            "fifaindexEditionsFullDetail": ";".join(sorted({r["game_version"] for r in full_fifa})),
            "fifaindexRecordIds": ";".join(r["record_id"] for r in full_fifa),
            "fifaindexSourceUrls": ";".join(r["source_url"] or "" for r in full_fifa),
            "fifaindexFullDetailRecords": len(full_fifa),
            "fifaindexRawAttributeFields": ";".join(f"{r['attribute_available_field_count']}/{r['attribute_field_count']} edition-supported fields" for r in full_fifa),
            "fifaindexNameCandidateCountUnverified": len(candidates),
            "fifaindexCandidateIdsUnverified": ";".join(candidate_ids),
            "futRecords": ";".join(r["record_id"] for r in fut),
            "futFull29AttributeRecords": len(full_fut),
            "futPhaseUnknownFullRecords": len(fut_phase_unknown),
            "futPartialRecords": ";".join(r["record_id"] for r in partial if r in fut),
            "olRecords": ";".join(r.get("record_id", "") for r in ol),
            "olFullProfileBaseUnverifiedCount": len(unverified_ol_profiles),
            "olFullProfileBaseUnverifiedRecordIds": ";".join(r.get("record_id", "") for r in unverified_ol_profiles),
            "olPartialAttempts": ";".join(a.get("attempt_id", "") for a in ol_attempts if a.get("canonical_player_id") == canonical),
            "ol3Status": ol3_status,
            "ol4Status": ol4_status,
            "sourceNotes": "; ".join([r.get("detail_completeness", "") for r in fut + ol if r.get("detail_completeness")]) or "",
        })
    class_counts: dict[str, int] = defaultdict(int)
    for row in rows:
        class_counts[row["primaryCoverageClass"]] += 1
    unique_ids = {row["canonicalPlayerId"] for row in rows}
    unique_class_counts: dict[str, int] = defaultdict(int)
    by_canonical: dict[str, set[str]] = defaultdict(set)
    for row in rows:
        by_canonical[row["canonicalPlayerId"]].add(row["primaryCoverageClass"])
    for canonical, classes in by_canonical.items():
        if len(classes) == 1:
            unique_class_counts[next(iter(classes))] += 1
        else:
            unique_class_counts["mixed_across_team_seasons"] += 1
    team_counts = defaultdict(int)
    for row in rows:
        team_counts[row["teamSeasonId"]] += 1
    summary = {
        "team_season_rows": len(rows),
        "unique_canonical_players": len(unique_ids),
        "primary_class_counts_team_season_rows": dict(sorted(class_counts.items())),
        "primary_class_counts_unique_players": dict(sorted(unique_class_counts.items())),
        "additional_source_overlap_counts": {
            "team_season_rows_with_any_full_fifaindex": sum(bool(fifa_by_player.get(r["canonicalPlayerId"])) for r in rows),
            "team_season_rows_with_any_full_fut": sum(any(x.get("detail_completeness") == "complete_29_outfield_attributes" for x in fut_by_player.get(r["canonicalPlayerId"], [])) for r in rows),
            "unique_players_with_any_full_fut": sum(bool([x for x in fut_by_player.get(c, []) if x.get("detail_completeness") == "complete_29_outfield_attributes"]) for c in unique_ids),
            "team_season_rows_with_confirmed_ol_full": sum(bool([x for x in ol_by_player.get(r["canonicalPlayerId"], []) if x.get("detail_completeness") == "complete_attributes" and x.get("base_state_confirmed")]) for r in rows),
            "team_season_rows_with_full_ol_profile_state_unverified": sum(bool([x for x in ol_by_player.get(r["canonicalPlayerId"], []) if x.get("detail_completeness") == "complete_attributes" and not x.get("base_state_confirmed")]) for r in rows),
        },
        "per_team_roster_gaps_to_11": {team: {"current_players": count, "gap": max(0, 11 - count)} for team, count in sorted(team_counts.items())},
        "total_slots_to_11_each": sum(max(0, 11 - n) for n in team_counts.values()),
        "online_status_counts": {
            "ol3_attempts": sum(a.get("source_family") == "FIFA Online 3" for a in ol_attempts),
            "ol4_attempts": sum(a.get("source_family") == "FIFA Online 4" for a in ol_attempts),
            "full_confirmed_online_only": sum(1 for row in rows if row["primaryCoverageClass"] == "C_online_only_full_details_base_state_confirmed"),
            "full_profile_state_unverified": sum(1 for row in rows if row["primaryCoverageClass"] == "D_online_full_profile_base_state_unverified"),
        },
        "caveat": "No record found means only not found/confirmed in this bounded survey; it is not evidence that no such game card exists.",
    }
    return rows, summary


ONLINE_ATTRIBUTE_ALIASES = {
    "Att Positioning": ("Positioning",), "Shot Power": ("Shoot power",),
    "Long Shots": ("Long shot",), "Penalties": ("Penalty kick",),
    "FK Accuracy": ("Free kick",), "Curve": ("Shoot curve",),
    "Crossing": ("Cross",), "Reactions": ("Reaction",),
    "Dribbling": ("Dribble",), "Interceptions": ("Interception",),
    "Standing Tackle": ("Tackle",), "Sliding Tackle": ("Sliding tackle",),
    "Jumping": ("Jump",), "Aggression": ("Aggresion",),
}


def source_value(pair: dict[str, Any], metric: str, record_index: dict[str, dict[str, Any]]) -> tuple[float | None, float | None]:
    left = record_index.get(pair["from_record_id"])
    right = record_index.get(pair["to_record_id"])
    if not left or not right:
        return None, None
    if metric == "OVR":
        return parse_number(left.get("ovr")), parse_number(right.get("ovr"))

    def observed(record: dict[str, Any]) -> float | None:
        if str(record.get("record_id", "")).startswith("fifaindex-"):
            return parse_number((record.get("attributes_observed") or {}).get(FUT_TO_FIFA[metric]))
        attrs = record.get("attributes_observed") or {}
        normalized = {re.sub(r"[^a-z0-9]+", "", str(k).casefold()): v for k, v in attrs.items()}
        candidates = (metric, *ONLINE_ATTRIBUTE_ALIASES.get(metric, ()))
        for name in candidates:
            key = re.sub(r"[^a-z0-9]+", "", name.casefold())
            if key in normalized:
                return parse_number(normalized[key])
        return None

    return observed(left), observed(right)

def predict_scores(samples: list[tuple[str, float, float]], metric: str) -> dict[str, Any]:
    groups = len({p[0] for p in samples})
    result: dict[str, Any] = {
        "metric": metric,
        "paired_observations": len(samples),
        "unique_player_groups": groups,
        "production_fit": None,
        "production_fit_reason": "fewer than 8 distinct players; coefficients withheld",
        "models": {},
    }
    if groups < 3:
        result["models"] = {
            "direct_value": {"status": "not_scored", "mae": None, "bias_prediction_minus_actual": None, "n": 0, "reason": "fewer than 3 distinct player groups"},
            "fixed_offset": {"status": "not_scored", "mae": None, "bias_prediction_minus_actual": None, "n": 0, "reason": "fewer than 3 distinct player groups"},
            "linear_regression": {"status": "failed_insufficient_sample", "mae": None, "bias_prediction_minus_actual": None, "n": 0, "reason": "fewer than 4 distinct groups required for leave-one-player-out training"},
        }
        return result
    scored: dict[str, list[tuple[float, float, str, dict[str, Any]]]] = {"direct_value": [], "fixed_offset": [], "linear_regression": []}
    failures: dict[str, list[str]] = {"direct_value": [], "fixed_offset": [], "linear_regression": []}
    for held_name, actual_x, actual_y in samples:
        train = [(x, y) for name, x, y in samples if name != held_name]
        # 1:1 is the uncalibrated baseline; every prediction is clamped to [1,99].
        direct = min(99.0, max(1.0, actual_x))
        scored["direct_value"].append((direct, actual_y, held_name, {"prediction": round(direct, 4), "actual": actual_y, "training_players": len(train)}))
        if len(train) >= 2:
            offset = statistics.mean(y - x for x, y in train)
            prediction = min(99.0, max(1.0, actual_x + offset))
            scored["fixed_offset"].append((prediction, actual_y, held_name, {"training_offset": round(offset, 4), "prediction": round(prediction, 4), "actual": actual_y, "training_players": len(train)}))
        else:
            failures["fixed_offset"].append(held_name)
        if len(train) >= 3:
            xs = [x for x, _ in train]
            ys = [y for _, y in train]
            mean_x, mean_y = statistics.mean(xs), statistics.mean(ys)
            variance = sum((x - mean_x) ** 2 for x in xs)
            if variance > 0:
                slope = sum((x - mean_x) * (y - mean_y) for x, y in train) / variance
                intercept = mean_y - slope * mean_x
                prediction = min(99.0, max(1.0, intercept + slope * actual_x))
                scored["linear_regression"].append((prediction, actual_y, held_name, {"intercept": round(intercept, 4), "slope": round(slope, 4), "prediction": round(prediction, 4), "actual": actual_y, "training_players": len(train)}))
            else:
                failures["linear_regression"].append(f"{held_name}: zero training variance")
        else:
            failures["linear_regression"].append(f"{held_name}: only {len(train)} training player groups; need 3")
    for model in scored:
        values = scored[model]
        errors = [pred - actual for pred, actual, _, _ in values]
        status = "scored_small_sample" if len(values) == len(samples) else "partial_or_failed"
        result["models"][model] = {
            "status": status,
            "mae": round(statistics.mean(abs(error) for error in errors), 4) if errors else None,
            "bias_prediction_minus_actual": round(statistics.mean(errors), 4) if errors else None,
            "n": len(values),
            "failed_cases": failures[model],
            "leave_one_player_out_cases": [case for _, _, _, case in values],
        }
    return result


def build_calibration(evidence: dict[str, Any]) -> dict[str, Any]:
    record_index = {r["record_id"]: r for family in ("fifaindex_records", "fut_records", "ol_records") for r in evidence.get(family, [])}
    pair_records = evidence.get("pair_candidates", [])
    grouped: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for pair in pair_records:
        left, right = record_index.get(pair.get("from_record_id")), record_index.get(pair.get("to_record_id"))
        if not left or not right:
            continue
        # Online records require an explicit eligibility decision; state-unknown FO4 profiles stay out.
        if str(right.get("source_family", "")).startswith("FIFA Online") and pair.get("comparison_eligible") is not True:
            continue
        grouped[pair["pair_type"]].append(pair)
    requested_relations = {
        "fifa_regular_to_ol3_ordinary": "FIFA regular vs OL3 ordinary season card",
        "ol3_ordinary_to_legend": "OL3 ordinary season card vs OL3 Legend",
        "fifa_regular_to_ol4": "FIFA regular vs OL4 relevant card",
        "fifa_regular_to_fut20_icon_total_difference": "FIFA regular vs FIFA20 FUT Icon total difference (phase unknown)",
        "fifa_regular_to_fut17_legend_total_difference": "FIFA regular vs FIFA17 FUT Legend total difference (career stage unknown)",
    }
    relations: dict[str, Any] = {}
    for relation, title in requested_relations.items():
        pairs = grouped.get(relation, [])
        metric_results = []
        metrics = ["OVR", *FUT_TO_FIFA.keys()]
        for metric in metrics:
            samples = []
            raw_pairs = []
            for pair in pairs:
                x, y = source_value(pair, metric, record_index)
                if x is not None and y is not None:
                    samples.append((pair["player_id"], float(x), float(y)))
                    raw_pairs.append({"player_id": pair["player_id"], "from_record_id": pair["from_record_id"], "to_record_id": pair["to_record_id"], "from_observed": x, "to_observed": y, "observed_total_difference_to_minus_from": round(float(y) - float(x), 4), "value_status": "observed"})
            score = predict_scores(samples, metric)
            score["observed_pairs"] = raw_pairs
            metric_results.append(score)
        relations[relation] = {
            "title": title,
            "paired_players": sorted({p["player_id"] for p in pairs}),
            "paired_player_count": len({p["player_id"] for p in pairs}),
            "pair_count": len(pairs),
            "status": "exploratory_total_difference_only; no target-season card phase validation" if pairs else "unavailable_no_verified_pairs",
            "metrics": metric_results,
        }
    icon = relations["fifa_regular_to_fut20_icon_total_difference"]
    ovr = next(metric for metric in icon["metrics"] if metric["metric"] == "OVR")
    metrics_with_cv = [metric for metric in icon["metrics"] if metric["metric"] != "OVR"]
    return {
        "schema_version": "legacy-ol-calibration-results-v1",
        "value_status_definitions": {
            "observed": "directly transcribed from an identified source record",
            "derived": "out-of-fold comparison/prediction computed by this script; diagnostic only, no historical-season assignment",
            "estimated": "no values emitted in this experiment",
            "unavailable": "no verified source value in this bounded evidence set; JSON null is used for missing values",
        },
        "prediction_range": [1, 99],
        "training_threshold_distinct_players": 8,
        "attribute_matching": {"mapped_fields": list(FUT_TO_FIFA), "excluded_or_unmatched": ["Heading/Heading Accuracy label variance", "Marking/Def Awareness", "Volleys", "Creativity", "Shot Accuracy", "goalkeeper-specific FUT fields"]},
        "relations": relations,
        "online_profile_assessments": [
            {"record_id": r["record_id"], "canonical_player_id": r["canonical_player_id"], "source_family": r["source_family"], "game_version": r["game_version"], "card_type": r["card_type"], "position": r.get("position"), "observed_ovr": r.get("ovr"), "detail_field_count": r.get("attribute_labels_count"), "base_state_confirmed": r.get("base_state_confirmed", False), "target_season_phase_validated": r.get("target_season_phase_validated", False), "training_eligible": False, "exclusion_reason": ("one descriptive FIFA05/OL3 pair exists, but only one distinct player and Season 2010 is later than the 1999 target; no model or target estimate" if r["record_id"] == "fifaaddict-fo3-ryan-giggs-10000241" else "no ordinary OL3 counterpart or regular FIFA record verified for this player; Legend phase is not target-matched" if r["record_id"] == "fifaaddict-fo3-schmeichel-wl" else "grade/base state or add-on/training state unresolved" if not r.get("base_state_confirmed") else "no same-player ordinary-card comparison verified")}
            for r in evidence.get("ol_records", [])
        ],
        "model_readiness": {
            "fifa_regular_to_fut20_icon_ovr": {"paired_unique_players": icon["paired_player_count"], "direct_oof_mae": ovr["models"]["direct_value"].get("mae"), "direct_oof_bias": ovr["models"]["direct_value"].get("bias_prediction_minus_actual"), "offset_oof_mae": ovr["models"]["fixed_offset"].get("mae"), "offset_oof_bias": ovr["models"]["fixed_offset"].get("bias_prediction_minus_actual"), "linear_oof_mae": ovr["models"]["linear_regression"].get("mae"), "final_coefficients": None, "decision": "not reliable for calibration; 3 players below 8-player fit threshold and Icon career phase unknown"},
            "ordinary_fifa_to_ol3": {"paired_unique_players": relations["fifa_regular_to_ol3_ordinary"]["paired_player_count"], "mae": next(m for m in relations["fifa_regular_to_ol3_ordinary"]["metrics"] if m["metric"] == "OVR")["models"]["direct_value"]["mae"], "bias": next(m for m in relations["fifa_regular_to_ol3_ordinary"]["metrics"] if m["metric"] == "OVR")["models"]["direct_value"]["bias_prediction_minus_actual"], "final_coefficients": None, "decision": "single player only: report observed total difference, no holdout metric or calibration coefficient; 2010 card phase is later than target"},
            "ol3_ordinary_to_legend": {"paired_unique_players": 0, "mae": None, "bias": None, "final_coefficients": None, "decision": "no verified paired records"},
            "fifa_regular_to_ol4": {"paired_unique_players": 0, "mae": None, "bias": None, "final_coefficients": None, "decision": "no full state-confirmed paired records"},
        },
        "caveats": [
            "FIFA20 Icon phase is unknown; no Base/Mid/Prime career-stage mapping is asserted.",
            "FIFA17 Vieira Legend and FIFA15 Schmeichel Legend are not assigned to a target-season phase.",
            "A FUT-vs-FIFA difference is a total version/card difference, not a separately identified online-inflation or Legend-inflation effect.",
            "The 3-player OVR holdout metrics are descriptive only; no coefficient is approved for production or historical player-season estimates.",
            "One explicit FIFA05-to-OL3 Season 2010 Ryan Giggs pair is observed (OVR 92 to 74, total difference -18); it is one player and a later card phase, so no OL3 model or target-season estimate is produced.",
            "Schmeichel has a full OL3 WL vector; Roberto Carlos, Beckham CAP, and Zidane BTB have full OL4 raw profiles but unresolved grade/base state and are excluded from calibration. The separate OL4 Zidane ICON page exposes only six summary values plus zero placeholders.",
        ],
    }


def write_coverage_csv(rows: list[dict[str, Any]]) -> None:
    fields = list(rows[0]) if rows else []
    with COVERAGE_PATH.open("w", encoding="utf-8-sig", newline="") as stream:
        writer = csv.DictWriter(stream, fieldnames=fields)
        writer.writeheader()
        writer.writerows(rows)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--refresh-cache", action="store_true", help="verify the pinned ignored CSV and rebuild embedded exact-ID/name-candidate samples")
    args = parser.parse_args()
    cohort = read_json(COHORT_PATH)
    evidence = read_json(EVIDENCE_PATH)
    if args.refresh_cache:
        rebuild_fifa_samples(cohort, evidence)
        write_json(EVIDENCE_PATH, evidence)
    coverage, coverage_summary = aggregate_coverage(cohort, evidence)
    write_coverage_csv(coverage)
    calibration = build_calibration(evidence)
    calibration["coverage"] = coverage_summary
    calibration["source_snapshot"] = {
        "cohort_rows": len(cohort["rows"]),
        "unique_canonical_players": len({row["canonicalPlayerId"] for row in cohort["rows"]}),
        "embedded_fifaindex_exact_id_records": len(evidence.get("fifaindex_records", [])),
        "embedded_fifaindex_name_candidates_not_counted": len(evidence.get("fifaindex_name_candidates", [])),
        "fut_records": len(evidence.get("fut_records", [])),
        "ol_records": len(evidence.get("ol_records", [])),
        "ol_attempts": len(evidence.get("ol_source_attempts", [])),
    }
    write_json(RESULTS_PATH, calibration)
    print(json.dumps({"coverage": coverage_summary, "sources": calibration["source_snapshot"], "ovr_icon_cv": calibration["model_readiness"]["fifa_regular_to_fut20_icon_ovr"]}, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
