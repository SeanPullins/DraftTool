#!/usr/bin/env python3

import json
import re
import sys
import zipfile
from pathlib import Path

import pandas as pd


# Archive file number -> season.
# Duplicates are included; rows are deduped after import.
FILE_NUM_TO_SEASON = {
    32: 2015,
    30: 2016,
    20: 2017,

    29: 2018,
    21: 2018,
    19: 2018,

    28: 2019,
    22: 2019,
    18: 2019,
    8: 2019,

    31: 2020,
    27: 2020,
    23: 2020,
    17: 2020,
    9: 2020,
    7: 2020,

    26: 2021,
    24: 2021,
    16: 2021,
    10: 2021,
    6: 2021,

    25: 2022,
    15: 2022,
    11: 2022,
    5: 2022,

    14: 2023,
    12: 2023,
    4: 2023,

    13: 2024,
    3: 2024,

    2: 2025,
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
        raise SystemExit(
            "Usage: python3 scripts/import_qb_pff_from_archive.py /path/to/Archive\\(2\\).zip"
        )

    archive_path = Path(sys.argv[1]).expanduser()
    if not archive_path.exists():
        raise SystemExit(f"[ERROR] File not found: {archive_path}")

    out_path = Path("public/data/qb_pff_seasons.json")
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
                df = df[df["position"].astype(str).str.upper().eq("QB")]

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
                    "position": "QB",
                    "pos": "QB",
                    "team": pick(row, "team_name", "team"),
                    "team_name": pick(row, "team_name", "team"),
                    "source_file": member,

                    # Volume / baseline
                    "player_game_count": as_num(pick(row, "player_game_count")),
                    "dropbacks": as_num(pick(row, "dropbacks")),
                    "attempts": as_num(pick(row, "attempts")),
                    "completions": as_num(pick(row, "completions")),
                    "completion_percent": as_num(pick(row, "completion_percent")),
                    "yards": as_num(pick(row, "yards")),
                    "ypa": as_num(pick(row, "ypa")),
                    "touchdowns": as_num(pick(row, "touchdowns")),
                    "interceptions": as_num(pick(row, "interceptions")),
                    "first_downs": as_num(pick(row, "first_downs")),

                    # PFF grades
                    "grades_pass": as_num(pick(row, "grades_pass")),
                    "pass_grade": as_num(pick(row, "grades_pass")),
                    "grades_offense": as_num(pick(row, "grades_offense")),
                    "offense_grade": as_num(pick(row, "grades_offense")),
                    "grades_run": as_num(pick(row, "grades_run")),
                    "run_grade": as_num(pick(row, "grades_run")),
                    "grades_hands_fumble": as_num(pick(row, "grades_hands_fumble")),
                    "fumble_grade": as_num(pick(row, "grades_hands_fumble")),

                    # Accuracy / depth / process
                    "accuracy_percent": as_num(pick(row, "accuracy_percent")),
                    "adjusted_completion_percent": as_num(pick(row, "accuracy_percent")),
                    "aimed_passes": as_num(pick(row, "aimed_passes")),
                    "avg_depth_of_target": as_num(pick(row, "avg_depth_of_target")),
                    "adot": as_num(pick(row, "avg_depth_of_target")),
                    "avg_time_to_throw": as_num(pick(row, "avg_time_to_throw")),
                    "time_to_throw": as_num(pick(row, "avg_time_to_throw")),

                    # Big-time / turnover-worthy
                    "big_time_throws": as_num(pick(row, "big_time_throws")),
                    "btt": as_num(pick(row, "big_time_throws")),
                    "btt_rate": as_num(pick(row, "btt_rate")),
                    "btt_pct": as_num(pick(row, "btt_rate")),
                    "turnover_worthy_plays": as_num(pick(row, "turnover_worthy_plays")),
                    "twp": as_num(pick(row, "turnover_worthy_plays")),
                    "twp_rate": as_num(pick(row, "twp_rate")),
                    "twp_pct": as_num(pick(row, "twp_rate")),

                    # Pressure / sacks
                    "def_gen_pressures": as_num(pick(row, "def_gen_pressures")),
                    "pressure_to_sack_rate": as_num(pick(row, "pressure_to_sack_rate")),
                    "pressure_to_sack_pct": as_num(pick(row, "pressure_to_sack_rate")),
                    "sack_percent": as_num(pick(row, "sack_percent")),
                    "sack_pct": as_num(pick(row, "sack_percent")),
                    "sacks": as_num(pick(row, "sacks")),
                    "scrambles": as_num(pick(row, "scrambles")),

                    # EPA / efficiency
                    "epa": as_num(pick(row, "epa")),
                    "positive_epa_percent": as_num(pick(row, "positive_epa_percent")),
                    "qb_rating": as_num(pick(row, "qb_rating")),

                    # Supporting row metadata
                    "drops": as_num(pick(row, "drops")),
                    "drop_rate": as_num(pick(row, "drop_rate")),
                    "thrown_aways": as_num(pick(row, "thrown_aways")),
                    "spikes": as_num(pick(row, "spikes")),
                    "bats": as_num(pick(row, "bats")),
                    "penalties": as_num(pick(row, "penalties")),
                }

                records.append(rec)

            included_files.append({"file": member, "season": season, "rows": int(len(df))})

    # Deduplicate duplicate exports.
    # Keep the first row for each season/player/team/player_id combo.
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

    print(f"Wrote {out_path} ({len(deduped)} QB seasons)")
    print("Included seasons:", payload["summary"]["includedSeasons"])

    # Quick sanity checks for current top prospects
    checks = [
        "Julian Sayin",
        "Dante Moore",
        "Brendan Sorsby",
        "Arch Manning",
        "Fernando Mendoza",
        "Byrum Brown",
        "Anthony Colandrea",
        "Jayden Maiava",
    ]

    print("\nSanity checks:")
    for name in checks:
        hits = [r for r in deduped if clean_name(r["name"]) == clean_name(name)]
        if not hits:
            print(f"  MISSING: {name}")
            continue

        latest = sorted(hits, key=lambda r: r["season"])[-1]
        print(
            f"  FOUND: {name} {latest['season']} {latest['team_name']} "
            f"pass={latest['pass_grade']} off={latest['offense_grade']} "
            f"BTT%={latest['btt_rate']} TWP%={latest['twp_rate']}"
        )


if __name__ == "__main__":
    main()
