#!/usr/bin/env python3

import json
import re
import sys
import zipfile
from pathlib import Path

import pandas as pd


# Archive 3 appears to contain receiving_summary (22) through (12)
# mapping 2015 through 2025.
FILE_NUM_TO_SEASON = {
    22: 2015,
    21: 2016,
    20: 2017,
    19: 2018,
    18: 2019,
    17: 2020,
    16: 2021,
    15: 2022,
    14: 2023,
    13: 2024,
    12: 2025,
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
        raise SystemExit("Usage: python3 scripts/import_te_pff_from_archive.py /path/to/Archive\\ 3.zip")

    archive_path = Path(sys.argv[1]).expanduser()
    if not archive_path.exists():
        raise SystemExit(f"[ERROR] File not found: {archive_path}")

    out_path = Path("public/data/te_pff_seasons.json")
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
                df = df[df["position"].astype(str).str.upper().eq("TE")]

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
                    "avg_depth_of_target": as_num(pick(row, "avg_depth_of_target")),
                    "adot": as_num(pick(row, "avg_depth_of_target")),
                    "avoided_tackles": as_num(pick(row, "avoided_tackles")),
                    "caught_percent": as_num(pick(row, "caught_percent")),
                    "contested_catch_rate": as_num(pick(row, "contested_catch_rate")),
                    "contested_receptions": as_num(pick(row, "contested_receptions")),
                    "contested_targets": as_num(pick(row, "contested_targets")),
                    "drop_rate": as_num(pick(row, "drop_rate")),
                    "drops": as_num(pick(row, "drops")),
                    "epa": as_num(pick(row, "epa")),
                    "first_downs": as_num(pick(row, "first_downs")),
                    "fumbles": as_num(pick(row, "fumbles")),

                    "grades_hands_drop": as_num(pick(row, "grades_hands_drop")),
                    "grades_hands_fumble": as_num(pick(row, "grades_hands_fumble")),
                    "grades_offense": as_num(pick(row, "grades_offense")),
                    "offense_grade": as_num(pick(row, "grades_offense")),
                    "grades_pass_block": as_num(pick(row, "grades_pass_block")),
                    "pass_block_grade": as_num(pick(row, "grades_pass_block")),
                    "grades_pass_route": as_num(pick(row, "grades_pass_route")),
                    "route_grade": as_num(pick(row, "grades_pass_route")),

                    "inline_rate": as_num(pick(row, "inline_rate")),
                    "inline_snaps": as_num(pick(row, "inline_snaps")),
                    "slot_rate": as_num(pick(row, "slot_rate")),
                    "slot_snaps": as_num(pick(row, "slot_snaps")),
                    "wide_rate": as_num(pick(row, "wide_rate")),
                    "wide_snaps": as_num(pick(row, "wide_snaps")),
                    "pass_block_rate": as_num(pick(row, "pass_block_rate")),
                    "pass_blocks": as_num(pick(row, "pass_blocks")),
                    "pass_plays": as_num(pick(row, "pass_plays")),

                    "positive_epa_percent": as_num(pick(row, "positive_epa_percent")),
                    "receptions": as_num(pick(row, "receptions")),
                    "route_rate": as_num(pick(row, "route_rate")),
                    "routes": as_num(pick(row, "routes")),
                    "targeted_qb_rating": as_num(pick(row, "targeted_qb_rating")),
                    "targets": as_num(pick(row, "targets")),
                    "touchdowns": as_num(pick(row, "touchdowns")),
                    "yards": as_num(pick(row, "yards")),
                    "yards_after_catch": as_num(pick(row, "yards_after_catch")),
                    "yards_after_catch_per_reception": as_num(pick(row, "yards_after_catch_per_reception")),
                    "yards_per_reception": as_num(pick(row, "yards_per_reception")),
                    "yprr": as_num(pick(row, "yprr")),
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

    print(f"Wrote {out_path} ({len(deduped)} TE seasons)")
    print("Included seasons:", payload["summary"]["includedSeasons"])

    print("\\nTop 2025 TE rows by route grade:")
    latest = [r for r in deduped if r["season"] == 2025]
    latest = sorted(latest, key=lambda r: r.get("route_grade") or 0, reverse=True)[:15]
    for r in latest:
        print(
            f"  {r['name']} ({r['team_name']}) "
            f"route={r.get('route_grade')} off={r.get('offense_grade')} "
            f"yprr={r.get('yprr')} yards={r.get('yards')} inline%={r.get('inline_rate')}"
        )


if __name__ == "__main__":
    main()
