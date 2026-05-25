#!/usr/bin/env python3

import json
import re
import sys
import zipfile
from pathlib import Path

import pandas as pd


def clean_name(value: str) -> str:
    return re.sub(r"[^a-z0-9]", "", str(value).lower())


def pick(row, *names, default=None):
    for name in names:
        if name in row and pd.notna(row[name]):
            return row[name]
    return default


def as_num(value):
    if value is None or pd.isna(value):
        return None
    try:
        return float(value)
    except Exception:
        return None


def infer_season(block_df, receiving_records):
    """
    Infer season by matching blocking rows to existing TE receiving rows.
    Uses player/team/offense grade similarity.
    """
    scores = {}

    for _, row in block_df.iterrows():
        player = clean_name(pick(row, "player", default=""))
        team = str(pick(row, "team_name", "team", default="")).upper()
        off = as_num(pick(row, "grades_offense"))

        if not player or not team or off is None:
            continue

        for r in receiving_records:
            if clean_name(r.get("name") or r.get("player") or "") != player:
                continue
            if str(r.get("team_name") or r.get("team") or "").upper() != team:
                continue

            r_off = as_num(r.get("offense_grade") or r.get("grades_offense"))
            if r_off is None:
                continue

            # same offense grade or very close = strong season match
            diff = abs(off - r_off)
            if diff <= 0.2:
                scores[r["season"]] = scores.get(r["season"], 0) + 5
            elif diff <= 1.0:
                scores[r["season"]] = scores.get(r["season"], 0) + 2

    if not scores:
        return None, scores

    season = max(scores.items(), key=lambda kv: kv[1])[0]
    return int(season), scores


def main():
    if len(sys.argv) < 2:
        raise SystemExit("Usage: python3 scripts/import_te_blocking_from_archive.py /path/to/Archive\\ 4.zip")

    archive_path = Path(sys.argv[1]).expanduser()
    if not archive_path.exists():
        raise SystemExit(f"[ERROR] File not found: {archive_path}")

    receiving_path = Path("public/data/te_pff_seasons.json")
    if not receiving_path.exists():
        raise SystemExit("[ERROR] Missing public/data/te_pff_seasons.json. Import TE receiving data first.")

    receiving_payload = json.loads(receiving_path.read_text())
    receiving_records = receiving_payload.get("records", [])

    out_path = Path("public/data/te_blocking_pff_seasons.json")
    out_path.parent.mkdir(parents=True, exist_ok=True)

    records = []
    included_files = []
    skipped_files = []

    with zipfile.ZipFile(archive_path) as z:
        for member in z.namelist():
            if member.startswith("__MACOSX/") or not member.lower().endswith(".csv"):
                continue

            with z.open(member) as f:
                df = pd.read_csv(f)

            if "position" in df.columns:
                df = df[df["position"].astype(str).str.upper().eq("TE")]

            season, season_scores = infer_season(df, receiving_records)

            if not season:
                skipped_files.append({
                    "file": member,
                    "reason": "could not infer season",
                    "seasonScores": season_scores
                })
                continue

            for _, row in df.iterrows():
                player = str(pick(row, "player", "name", "player_name", default="")).strip()
                if not player:
                    continue

                rec = {
                    "season": season,
                    "player": player,
                    "name": player,
                    "cleanName": clean_name(player),
                    "player_id": pick(row, "player_id"),
                    "position": "TE",
                    "pos": "TE",
                    "team": pick(row, "team_name", "team"),
                    "team_name": pick(row, "team_name", "team"),
                    "source_file": member,

                    "player_game_count": as_num(pick(row, "player_game_count")),
                    "block_percent": as_num(pick(row, "block_percent")),
                    "pass_block_percent": as_num(pick(row, "pass_block_percent")),
                    "non_spike_pass_block": as_num(pick(row, "non_spike_pass_block")),
                    "non_spike_pass_block_percentage": as_num(pick(row, "non_spike_pass_block_percentage")),

                    "grades_offense": as_num(pick(row, "grades_offense")),
                    "offense_grade": as_num(pick(row, "grades_offense")),
                    "grades_pass_block": as_num(pick(row, "grades_pass_block")),
                    "pass_block_grade": as_num(pick(row, "grades_pass_block")),
                    "grades_run_block": as_num(pick(row, "grades_run_block")),
                    "run_block_grade": as_num(pick(row, "grades_run_block")),

                    "hits_allowed": as_num(pick(row, "hits_allowed")),
                    "hurries_allowed": as_num(pick(row, "hurries_allowed")),
                    "pressures_allowed": as_num(pick(row, "pressures_allowed")),
                    "sacks_allowed": as_num(pick(row, "sacks_allowed")),
                    "pbe": as_num(pick(row, "pbe")),
                    "penalties": as_num(pick(row, "penalties")),
                    "declined_penalties": as_num(pick(row, "declined_penalties")),

                    "snap_counts_block": as_num(pick(row, "snap_counts_block")),
                    "snap_counts_offense": as_num(pick(row, "snap_counts_offense")),
                    "snap_counts_pass_block": as_num(pick(row, "snap_counts_pass_block")),
                    "snap_counts_pass_play": as_num(pick(row, "snap_counts_pass_play")),
                    "snap_counts_run_block": as_num(pick(row, "snap_counts_run_block")),
                    "snap_counts_te": as_num(pick(row, "snap_counts_te")),
                    "snap_counts_ce": as_num(pick(row, "snap_counts_ce")),
                    "snap_counts_lg": as_num(pick(row, "snap_counts_lg")),
                    "snap_counts_lt": as_num(pick(row, "snap_counts_lt")),
                    "snap_counts_rg": as_num(pick(row, "snap_counts_rg")),
                    "snap_counts_rt": as_num(pick(row, "snap_counts_rt")),
                }

                records.append(rec)

            included_files.append({
                "file": member,
                "season": season,
                "rows": int(len(df)),
                "seasonScores": season_scores
            })

    seen = set()
    deduped = []

    for rec in records:
        key = (
            rec["season"],
            rec.get("player_id"),
            rec["cleanName"],
            str(rec.get("team") or "").upper(),
        )
        if key in seen:
            continue
        seen.add(key)
        deduped.append(rec)

    deduped.sort(key=lambda r: (r["season"], r["team_name"] or "", r["name"]))

    payload = {
        "generatedAt": pd.Timestamp.utcnow().isoformat(),
        "sourceArchive": str(archive_path),
        "records": deduped,
        "summary": {
            "rawRows": len(records),
            "dedupedRows": len(deduped),
            "includedSeasons": sorted(set(r["season"] for r in deduped)),
            "includedFiles": included_files,
            "skippedFiles": skipped_files,
        },
    }

    out_path.write_text(json.dumps(payload, indent=2))

    print(f"Wrote {out_path} ({len(deduped)} TE blocking seasons)")
    print("Included seasons:", payload["summary"]["includedSeasons"])

    print("\nTop 2025 TE blocking rows by run-block grade:")
    latest = [r for r in deduped if r["season"] == 2025]
    latest = sorted(latest, key=lambda r: r.get("run_block_grade") or 0, reverse=True)[:15]
    for r in latest:
        print(
            f"  {r['name']} ({r['team_name']}) "
            f"run={r.get('run_block_grade')} pass={r.get('pass_block_grade')} "
            f"off={r.get('offense_grade')} TEsnaps={r.get('snap_counts_te')}"
        )


if __name__ == "__main__":
    main()
