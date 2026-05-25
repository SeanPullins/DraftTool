#!/usr/bin/env python3

import json
import re
import sys
import zipfile
from pathlib import Path

import pandas as pd


# Archive 5 shape:
# rushing_summary.csv = 2014
# rushing_summary (1).csv = 2015
# ...
# rushing_summary (11).csv = 2025
FILE_NUM_TO_SEASON = {
    None: 2014,
    1: 2015,
    2: 2016,
    3: 2017,
    4: 2018,
    5: 2019,
    6: 2020,
    7: 2021,
    8: 2022,
    9: 2023,
    10: 2024,
    11: 2025,
}


def clean_name(value: str) -> str:
    return re.sub(r"[^a-z0-9]", "", str(value).lower())


def file_number(name: str):
    m = re.search(r"\((\d+)\)", name)
    return int(m.group(1)) if m else None


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


def main():
    if len(sys.argv) < 2:
        raise SystemExit("Usage: python3 scripts/import_rb_pff_from_archive.py /path/to/Archive\\ 5.zip")

    archive_path = Path(sys.argv[1]).expanduser()
    if not archive_path.exists():
        raise SystemExit(f"[ERROR] File not found: {archive_path}")

    out_path = Path("public/data/rb_pff_seasons.json")
    out_path.parent.mkdir(parents=True, exist_ok=True)

    records = []
    included_files = []
    skipped_files = []

    with zipfile.ZipFile(archive_path) as z:
        for member in z.namelist():
            if member.startswith("__MACOSX/") or not member.lower().endswith(".csv"):
                continue

            num = file_number(member)
            season = FILE_NUM_TO_SEASON.get(num)

            if not season:
                skipped_files.append({"file": member, "reason": "no season mapping"})
                continue

            with z.open(member) as f:
                df = pd.read_csv(f)

            if "position" in df.columns:
                # PFF college rushing uses HB for RBs. Exclude QB rushing rows.
                df = df[df["position"].astype(str).str.upper().isin(["HB", "RB"])]

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
                    "position": "RB",
                    "pos": "RB",
                    "team": pick(row, "team_name", "team"),
                    "team_name": pick(row, "team_name", "team"),
                    "source_file": member,

                    "player_game_count": as_num(pick(row, "player_game_count")),
                    "attempts": as_num(pick(row, "attempts")),
                    "yards": as_num(pick(row, "yards")),
                    "ypa": as_num(pick(row, "ypa")),
                    "touchdowns": as_num(pick(row, "touchdowns")),
                    "first_downs": as_num(pick(row, "first_downs")),
                    "longest": as_num(pick(row, "longest")),
                    "fumbles": as_num(pick(row, "fumbles")),

                    "yards_after_contact": as_num(pick(row, "yards_after_contact")),
                    "yco_attempt": as_num(pick(row, "yco_attempt")),
                    "avoided_tackles": as_num(pick(row, "avoided_tackles")),
                    "elu_rush_mtf": as_num(pick(row, "elu_rush_mtf")),
                    "elu_recv_mtf": as_num(pick(row, "elu_recv_mtf")),
                    "elu_yco": as_num(pick(row, "elu_yco")),
                    "elusive_rating": as_num(pick(row, "elusive_rating")),

                    "breakaway_attempts": as_num(pick(row, "breakaway_attempts")),
                    "breakaway_percent": as_num(pick(row, "breakaway_percent")),
                    "breakaway_yards": as_num(pick(row, "breakaway_yards")),
                    "explosive": as_num(pick(row, "explosive")),

                    "designed_yards": as_num(pick(row, "designed_yards")),
                    "gap_attempts": as_num(pick(row, "gap_attempts")),
                    "zone_attempts": as_num(pick(row, "zone_attempts")),
                    "run_plays": as_num(pick(row, "run_plays")),

                    "grades_offense": as_num(pick(row, "grades_offense")),
                    "offense_grade": as_num(pick(row, "grades_offense")),
                    "grades_run": as_num(pick(row, "grades_run")),
                    "run_grade": as_num(pick(row, "grades_run")),
                    "grades_run_block": as_num(pick(row, "grades_run_block")),
                    "run_block_grade": as_num(pick(row, "grades_run_block")),
                    "grades_pass_block": as_num(pick(row, "grades_pass_block")),
                    "pass_block_grade": as_num(pick(row, "grades_pass_block")),
                    "grades_pass_route": as_num(pick(row, "grades_pass_route")),
                    "route_grade": as_num(pick(row, "grades_pass_route")),
                    "grades_hands_fumble": as_num(pick(row, "grades_hands_fumble")),
                    "fumble_grade": as_num(pick(row, "grades_hands_fumble")),

                    "targets": as_num(pick(row, "targets")),
                    "receptions": as_num(pick(row, "receptions")),
                    "rec_yards": as_num(pick(row, "rec_yards")),
                    "routes": as_num(pick(row, "routes")),
                    "drops": as_num(pick(row, "drops")),
                    "yprr": as_num(pick(row, "yprr")),
                    "total_touches": as_num(pick(row, "total_touches")),
                    "penalties": as_num(pick(row, "penalties")),
                    "declined_penalties": as_num(pick(row, "declined_penalties")),
                }

                records.append(rec)

            included_files.append({"file": member, "season": season, "rows": int(len(df))})

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

    print(f"Wrote {out_path} ({len(deduped)} RB seasons)")
    print("Included seasons:", payload["summary"]["includedSeasons"])

    print("\nTop 2025 RB rows by run grade:")
    latest = [r for r in deduped if r["season"] == 2025]
    latest = sorted(latest, key=lambda r: r.get("run_grade") or 0, reverse=True)[:15]
    for r in latest:
        print(
            f"  {r['name']} ({r['team_name']}) "
            f"run={r.get('run_grade')} off={r.get('offense_grade')} "
            f"yards={r.get('yards')} yco/att={r.get('yco_attempt')} "
            f"elusive={r.get('elusive_rating')}"
        )


if __name__ == "__main__":
    main()
